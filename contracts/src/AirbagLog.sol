// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IPerplExchange} from "./IPerplExchange.sol";

/// @title AirbagLog
/// @notice A public, append-only record of what Airbag did on Perpl, checked against Perpl's own
/// state on Monad (ADR 0016). A deploy's after-state is read from Perpl's Exchange when it is
/// recorded, not reported by Airbag: the position's size, and its liquidation price computed from
/// its deposit, funding and maintenance margin. A save is proven by anyone, at any block where
/// Perpl's mark is at or past the deploy's old liquidation price while the account still holds
/// the position, on the same side. The contract holds no funds and has no power over any
/// position; only the engine's hot wallet (the writer) can record a deploy.
contract AirbagLog {
    /// @notice What a deploy did. Trim: a reduce-only close, then the released margin re-added.
    /// Margin: spare margin added.
    uint8 public constant REASON_TRIM = 0;
    uint8 public constant REASON_MARGIN = 1;

    /// @notice Perpl's Exchange, read for every record and proof.
    IPerplExchange public immutable exchange;
    /// @notice Decimals of Perpl's collateral token (AUSD: 6), the unit of every CNS amount.
    uint256 public immutable collateralDecimals;

    address public owner;
    address public writer;
    /// @notice Number of deploys recorded; also the id of the latest one.
    uint256 public deploys;

    struct Record {
        uint64 perpId;
        uint64 accountId;
        bool short;
        bool saved;
        /// The liquidation price before the deploy, in PNS: the level a save has to reach.
        uint256 liqBefore;
    }

    mapping(uint256 => Record) public records;

    /// @param deployId Sequential, from 1.
    /// @param accountId The Perpl exchange account.
    /// @param market Perpl's perpetual id.
    /// @param perplTxHash The Perpl transaction that filled the close (zero for margin-only).
    /// @param sizeBefore Position size in Perpl lots (LNS) before the deploy, as Airbag saw it.
    /// @param sizeAfter Position size in lots after, read from Perpl.
    /// @param liqBefore Liquidation price in Perpl price units (PNS) before, as Airbag saw it.
    /// @param liqAfter Liquidation price in PNS after, computed from Perpl's state (zero if the
    /// position closed).
    event DeployRecorded(
        uint256 indexed deployId,
        uint256 indexed accountId,
        uint256 indexed market,
        bytes32 perplTxHash,
        uint256 sizeBefore,
        uint256 sizeAfter,
        uint256 liqBefore,
        uint256 liqAfter,
        uint8 reason
    );

    /// @notice The mark reached the pre-deploy liquidation price while the position was open.
    event SaveRecorded(uint256 indexed deployId, uint256 oldLiqHitBlock);

    /// @notice What the chain showed when the save was proven, and who proved it.
    event SaveProven(uint256 indexed deployId, uint256 markPNS, uint256 lotsOpen, address indexed prover);

    event WriterChanged(address indexed writer);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotWriter();
    error ZeroAddress();
    error UnknownDeploy(uint256 deployId);
    error BadReason(uint8 reason);
    error AlreadySaved(uint256 deployId);
    /// A trim must leave the position smaller; a margin add must leave its size alone.
    error SizeMismatch(uint8 reason, uint256 sizeBefore, uint256 sizeAfter);
    error MarkInvalid();
    error PositionGone(uint256 deployId);
    error NotReached(uint256 markPNS, uint256 liqBefore);
    /// Perpl returned a position type outside 0 (long) / 1 (short).
    error InvalidPositionType(uint8 positionType);
    /// Perpl returned no maintenance margin for this market/size.
    error ZeroMaintenance(uint256 perpId);
    /// An id that does not fit the stored uint64 (would truncate silently).
    error IdTooLarge(uint256 perpId, uint256 accountId);
    /// Decimals that would overflow 10**n (immutable, so a deploy-time misconfiguration).
    error BadDecimals(uint256 collateralDecimals, uint256 priceDecimals, uint256 lotDecimals);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyWriter() {
        if (msg.sender != writer) revert NotWriter();
        _;
    }

    constructor(address writer_, IPerplExchange exchange_, uint256 collateralDecimals_) {
        if (writer_ == address(0) || address(exchange_) == address(0)) revert ZeroAddress();
        if (collateralDecimals_ > 77) revert BadDecimals(collateralDecimals_, 0, 0);
        exchange = exchange_;
        collateralDecimals = collateralDecimals_;
        owner = msg.sender;
        writer = writer_;
        emit OwnershipTransferred(address(0), msg.sender);
        emit WriterChanged(writer_);
    }

    /// @notice A Perpl position's liquidation price in its market's price units (PNS), from
    /// Perpl's own state: the mark at which the deposit plus accrued funding plus unrealized PnL
    /// falls to the maintenance margin, charged on entry notional at the market's maintenance
    /// fraction. Entry carries Perpl's Q16 rounding residue. Rounded to a whole tick toward the
    /// mark. Zero when there is no position.
    /// The same arithmetic as Airbag's risk package (docs/RISK-MODEL.md), in integers.
    function liquidationPrice(uint256 perpId, uint256 accountId)
        public
        view
        returns (uint256 liqPNS, bool short, uint256 lots, uint256 markPNS, bool markValid)
    {
        IPerplExchange.PositionInfoV2 memory p;
        (p, markPNS, markValid) = exchange.getPositionV2(perpId, accountId);
        lots = p.lotLNS;
        if (lots == 0) return (0, false, 0, markPNS, markValid);
        if (p.positionType > 1) revert InvalidPositionType(p.positionType);
        short = p.positionType == 1;
        (, uint256 maint,,,,) = exchange.getMarginFractions(perpId, lots);
        if (maint == 0) revert ZeroMaintenance(perpId);
        IPerplExchange.PerpetualInfoV2 memory info = exchange.getPerpetualInfoV2(perpId);
        if (info.priceDecimals + info.lotDecimals > 77) {
            revert BadDecimals(collateralDecimals, info.priceDecimals, info.lotDecimals);
        }
        uint256 scale = 10 ** (info.priceDecimals + info.lotDecimals);
        uint256 unit = 10 ** collateralDecimals;
        // Effective entry, x 2^16: Perpl rounds a long's entry up and a short's down, keeping the
        // remainder in a Q16 residue (dex-sdk Position::effective_entry_price).
        uint256 entryQ16 = p.priceResiduePNSQ16 == 0
            ? p.pricePNS << 16
            : ((short || p.pricePNS == 0 ? p.pricePNS : p.pricePNS - 1) << 16) + p.priceResiduePNSQ16;
        // Maintenance on entry notional, in collateral: size x entry x 100 / maint.
        int256 mmr = int256((lots * entryQ16 * unit * 100) / (maint * scale << 16));
        int256 cushion = int256(p.depositCNS) + p.premiumPnlCNS - mmr;
        // How far the price can move against the position before the cushion is gone, x 2^16.
        int256 moveQ16 = (cushion * int256(scale) << 16) / (int256(lots) * int256(unit));
        int256 liqQ16 = short ? int256(entryQ16) + moveQ16 : int256(entryQ16) - moveQ16;
        // To a whole tick toward the mark, the safe side: a long's up, a short's down.
        if (liqQ16 > 0) liqPNS = short ? uint256(liqQ16) >> 16 : (uint256(liqQ16) + 0xffff) >> 16;
    }

    /// @notice Records a deploy. The size before and the liquidation price before are Airbag's
    /// reading; the size after and the liquidation price after are read from Perpl now.
    function recordDeploy(
        uint256 accountId,
        uint256 perpId,
        bytes32 perplTxHash,
        uint256 sizeBefore,
        uint256 liqBefore,
        uint8 reason
    ) external onlyWriter returns (uint256 deployId) {
        if (reason > REASON_MARGIN) revert BadReason(reason);
        if (perpId > type(uint64).max || accountId > type(uint64).max) {
            revert IdTooLarge(perpId, accountId);
        }
        (uint256 liqAfter, bool short, uint256 sizeAfter,,) = liquidationPrice(perpId, accountId);
        if (reason == REASON_TRIM ? sizeAfter >= sizeBefore : sizeAfter != sizeBefore) {
            revert SizeMismatch(reason, sizeBefore, sizeAfter);
        }
        deployId = ++deploys;
        records[deployId] = Record({
            // forge-lint: disable-next-line(unsafe-typecast)
            perpId: uint64(perpId),
            // forge-lint: disable-next-line(unsafe-typecast)
            accountId: uint64(accountId),
            short: short,
            saved: false,
            liqBefore: liqBefore
        });
        emit DeployRecorded(
            deployId, accountId, perpId, perplTxHash, sizeBefore, sizeAfter, liqBefore, liqAfter, reason
        );
    }

    /// @notice Proves a save, from Perpl's state in this block: the mark is valid and at or past
    /// the deploy's old liquidation price, and the account still holds a position in that market
    /// on the same side. Anyone can call it: the trader, a watcher, or Airbag's engine.
    function proveSave(uint256 deployId) external {
        Record storage r = records[deployId];
        if (deployId == 0 || deployId > deploys) revert UnknownDeploy(deployId);
        if (r.saved) revert AlreadySaved(deployId);
        (IPerplExchange.PositionInfoV2 memory p, uint256 mark, bool valid) =
            exchange.getPositionV2(r.perpId, r.accountId);
        if (!valid) revert MarkInvalid();
        if (p.lotLNS != 0 && p.positionType > 1) revert InvalidPositionType(p.positionType);
        if (p.lotLNS == 0 || (p.positionType == 1) != r.short) revert PositionGone(deployId);
        if (r.short ? mark < r.liqBefore : mark > r.liqBefore) revert NotReached(mark, r.liqBefore);
        r.saved = true;
        emit SaveRecorded(deployId, block.number);
        emit SaveProven(deployId, mark, p.lotLNS, msg.sender);
    }

    function setWriter(address writer_) external onlyOwner {
        if (writer_ == address(0)) revert ZeroAddress();
        writer = writer_;
        emit WriterChanged(writer_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
