// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title IPerplExchange
/// @notice The read-only parts of Perpl's Exchange that AirbagLog uses. Signatures and struct
/// layouts from PerplFoundation/dex-sdk crates/sdk/abi/dex/Exchange.json (MIT).
interface IPerplExchange {
    /// positionType is the contract's PositionEnum: 0 long, 1 short. No position has lotLNS 0.
    struct PositionInfoV2 {
        uint256 accountId;
        uint256 nextNodeId;
        uint256 prevNodeId;
        uint8 positionType;
        uint256 depositCNS;
        uint256 pricePNS;
        uint256 lotLNS;
        uint256 entryBlock;
        int256 pnlCNS;
        int256 deltaPnlCNS;
        int256 premiumPnlCNS;
        uint256 priceResiduePNSQ16;
    }

    struct PerpetualInfoV2 {
        string name;
        string symbol;
        uint256 priceDecimals;
        uint256 lotDecimals;
        bytes32 linkFeedId;
        uint256 priceTolPer100K;
        uint256 marginTol;
        uint256 marginTolDecimals;
        uint256 refPriceMaxAgeSec;
        uint256 positionBalanceCNS;
        uint256 insuranceBalanceCNS;
        uint256 markPNS;
        uint256 markTimestamp;
        uint256 lastPNS;
        uint256 lastTimestamp;
        uint256 oraclePNS;
        uint256 oracleTimestampSec;
        uint256 longOpenInterestLNS;
        uint256 shortOpenInterestLNS;
        uint256 fundingStartBlock;
        int16 fundingRatePct100k;
        uint256 absFundingClampPctPer100K;
        uint8 status;
        uint256 basePricePNS;
        uint256 maxBidPriceONS;
        uint256 minBidPriceONS;
        uint256 maxAskPriceONS;
        uint256 minAskPriceONS;
        uint256 numOrders;
        bool ignOracle;
        uint256 fundingSumScalingExp;
    }

    function getPositionV2(uint256 perpId, uint256 accountId)
        external
        view
        returns (PositionInfoV2 memory positionInfo, uint256 markPricePNS, bool markPriceValid);

    /// Margin fractions are leverage in hundredths: a maintenance of 2500 is 25x, so 4%.
    function getMarginFractions(uint256 perpId, uint256 lotLNS)
        external
        view
        returns (
            uint256 perpInitMarginFracHdths,
            uint256 perpMaintMarginFracHdths,
            uint256 dynamicInitMarginFracHdths,
            uint256 oiMaxLNS,
            uint256 unityDescentThreshHdths,
            uint256 overColDescentThreshHdths
        );

    function getPerpetualInfoV2(uint256 perpId) external view returns (PerpetualInfoV2 memory);
}
