// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AirbagLog} from "../src/AirbagLog.sol";
import {IPerplExchange} from "../src/IPerplExchange.sol";

interface VmFork {
    function envOr(string calldata name, string calldata fallback_) external view returns (string memory);
    function createSelectFork(string calldata url) external returns (uint256);
}

interface IPerplPositions is IPerplExchange {
    function getPositionsV2(uint256 perpId, uint256 pageStartPositionId, uint256 positionsPerPage)
        external
        view
        returns (PositionInfoV2[] memory positions, uint256 numPositions, uint256 markPricePNS, bool markPriceValid);
}

/// AirbagLog against Perpl's real Exchange, on a fork of Monad mainnet. Runs only with
/// MONAD_FORK_RPC set (an RPC that serves state reads, like https://rpc1.monad.xyz):
///   MONAD_FORK_RPC=https://rpc1.monad.xyz forge test --match-contract Fork -vv
/// For real open positions in several markets, the liquidation price the contract computes must
/// be where Perpl's own accounting puts equity at the maintenance margin: equity now (deposit,
/// funding and Perpl's unrealized PnL at its mark) moved linearly to that price.
contract AirbagLogForkTest {
    VmFork constant vm = VmFork(address(uint160(uint256(keccak256("hevm cheat code")))));
    IPerplPositions constant PERPL = IPerplPositions(0x34B6552d57a35a1D042CcAe1951BD1C370112a6F);
    /// BTC, MON, ETH, SOL, ZEC on Perpl mainnet.
    uint256[5] internal markets = [uint256(1), 10, 20, 31, 50];

    event Checked(uint256 perpId, uint256 accountId, uint256 liqPNS, int256 equityAtLiq, int256 maintenance);

    function test_liquidationPriceAgreesWithPerplsAccounting() public {
        string memory rpc = vm.envOr("MONAD_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        AirbagLog log = new AirbagLog(address(1), PERPL, 6);
        uint256 checked;
        for (uint256 m; m < markets.length; m++) {
            uint256 perpId = markets[m];
            (IPerplExchange.PositionInfoV2[] memory ps,, uint256 mark, bool valid) = PERPL.getPositionsV2(perpId, 0, 4);
            if (!valid) continue;
            IPerplExchange.PerpetualInfoV2 memory info = PERPL.getPerpetualInfoV2(perpId);
            for (uint256 i; i < ps.length; i++) {
                if (ps[i].lotLNS == 0) continue;
                _check(log, perpId, ps[i], mark, int256(10 ** (info.priceDecimals + info.lotDecimals)));
                checked++;
            }
        }
        require(checked >= 5, "too few open positions to check");
    }

    function _check(AirbagLog log, uint256 perpId, IPerplExchange.PositionInfoV2 memory p, uint256 mark, int256 scale)
        internal
    {
        (uint256 liq, bool short,,,) = log.liquidationPrice(perpId, p.accountId);
        int256 lots = int256(p.lotLNS);
        // Perpl's equity now, moved to the liquidation price at the position's size.
        int256 equityAtLiq = int256(p.depositCNS) + p.premiumPnlCNS + p.deltaPnlCNS + (short ? -lots : lots)
            * (int256(liq) - int256(mark)) * 1e6 / scale;
        int256 mmr = _maintenance(perpId, p, short, scale);
        emit Checked(perpId, p.accountId, liq, equityAtLiq, mmr);
        // Within one tick's worth of value of the position, plus a cent of rounding.
        int256 tick = lots * 1e6 / scale + 10_000;
        int256 gap = equityAtLiq - mmr;
        require(gap <= tick && gap >= -tick, "liquidation price disagrees with Perpl");
    }

    function _maintenance(uint256 perpId, IPerplExchange.PositionInfoV2 memory p, bool short, int256 scale)
        internal
        view
        returns (int256)
    {
        (, uint256 maint,,,,) = PERPL.getMarginFractions(perpId, p.lotLNS);
        uint256 entryQ16 = p.priceResiduePNSQ16 == 0
            ? p.pricePNS << 16
            : ((short ? p.pricePNS : p.pricePNS - 1) << 16) + p.priceResiduePNSQ16;
        return int256((p.lotLNS * entryQ16 * 1e6 * 100) / (maint * uint256(scale) << 16));
    }
}
