// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title AirbagLog
/// @notice A public, append-only record of what Airbag did on Perpl, one event per deploy and
/// per save (ADR 0009). It holds no funds and has no power over any position: the trims and
/// margin moves themselves happen on Perpl. Only the engine's hot wallet (the writer) can
/// append, and the owner can rotate the writer.
contract AirbagLog {
    /// @notice What a deploy did.
    /// Trim: a reduce-only close, then the released margin re-added. Margin: spare margin added.
    uint8 public constant REASON_TRIM = 0;
    uint8 public constant REASON_MARGIN = 1;

    address public owner;
    address public writer;
    /// @notice Number of deploys recorded; also the id of the latest one.
    uint256 public deploys;
    mapping(uint256 => bool) public saved;

    /// @param deployId Sequential, from 1.
    /// @param accountId The Perpl exchange account.
    /// @param market Perpl's perpetual id.
    /// @param perplTxHash The Perpl transaction that filled the close (zero for margin-only).
    /// @param sizeBefore Position size in Perpl lots (LNS) before the deploy.
    /// @param sizeAfter Position size in lots after.
    /// @param liqBefore Liquidation price in Perpl price units (PNS) before.
    /// @param liqAfter Liquidation price in PNS after (zero if the position closed).
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

    event WriterChanged(address indexed writer);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotWriter();
    error ZeroAddress();
    error UnknownDeploy(uint256 deployId);
    error BadReason(uint8 reason);
    error AlreadySaved(uint256 deployId);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyWriter() {
        if (msg.sender != writer) revert NotWriter();
        _;
    }

    constructor(address writer_) {
        if (writer_ == address(0)) revert ZeroAddress();
        owner = msg.sender;
        writer = writer_;
        emit OwnershipTransferred(address(0), msg.sender);
        emit WriterChanged(writer_);
    }

    function recordDeploy(
        uint256 accountId,
        uint256 market,
        bytes32 perplTxHash,
        uint256 sizeBefore,
        uint256 sizeAfter,
        uint256 liqBefore,
        uint256 liqAfter,
        uint8 reason
    ) external onlyWriter returns (uint256 deployId) {
        if (reason > REASON_MARGIN) revert BadReason(reason);
        deployId = ++deploys;
        emit DeployRecorded(
            deployId, accountId, market, perplTxHash, sizeBefore, sizeAfter, liqBefore, liqAfter, reason
        );
    }

    function recordSave(uint256 deployId, uint256 oldLiqHitBlock) external onlyWriter {
        if (deployId == 0 || deployId > deploys) revert UnknownDeploy(deployId);
        if (saved[deployId]) revert AlreadySaved(deployId);
        saved[deployId] = true;
        emit SaveRecorded(deployId, oldLiqHitBlock);
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
