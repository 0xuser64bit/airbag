// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AirbagLog} from "../src/AirbagLog.sol";
import {IPerplExchange} from "../src/IPerplExchange.sol";

/// The few Foundry cheatcodes these tests use, without pulling in forge-std.
interface Vm {
    function prank(address) external;
    function expectRevert(bytes calldata) external;
    function expectEmit(bool, bool, bool, bool) external;
    function roll(uint256) external;
}

/// Perpl's Exchange, reduced to the reads AirbagLog makes, with settable state.
contract MockExchange is IPerplExchange {
    mapping(uint256 => mapping(uint256 => PositionInfoV2)) internal positions;
    mapping(uint256 => uint256) public marks;
    mapping(uint256 => uint256) public maintenance;
    mapping(uint256 => uint256[2]) internal decimals;
    bool public markValid = true;

    function setMarket(uint256 perpId, uint256 priceDecimals, uint256 lotDecimals, uint256 maint, uint256 mark)
        external
    {
        decimals[perpId] = [priceDecimals, lotDecimals];
        maintenance[perpId] = maint;
        marks[perpId] = mark;
    }

    function setMark(uint256 perpId, uint256 mark) external {
        marks[perpId] = mark;
    }

    function setMarkValid(bool valid) external {
        markValid = valid;
    }

    function setPosition(
        uint256 perpId,
        uint256 accountId,
        uint8 positionType,
        uint256 depositCNS,
        uint256 pricePNS,
        uint256 residueQ16,
        uint256 lots,
        int256 premiumCNS
    ) external {
        PositionInfoV2 storage p = positions[perpId][accountId];
        p.accountId = accountId;
        p.positionType = positionType;
        p.depositCNS = depositCNS;
        p.pricePNS = pricePNS;
        p.priceResiduePNSQ16 = residueQ16;
        p.lotLNS = lots;
        p.premiumPnlCNS = premiumCNS;
    }

    function getPositionV2(uint256 perpId, uint256 accountId)
        external
        view
        returns (PositionInfoV2 memory, uint256, bool)
    {
        return (positions[perpId][accountId], marks[perpId], markValid);
    }

    function getMarginFractions(uint256 perpId, uint256)
        external
        view
        returns (uint256, uint256, uint256, uint256, uint256, uint256)
    {
        return (0, maintenance[perpId], 0, 0, 0, 0);
    }

    function getPerpetualInfoV2(uint256 perpId) external view returns (PerpetualInfoV2 memory info) {
        info.priceDecimals = decimals[perpId][0];
        info.lotDecimals = decimals[perpId][1];
        info.markPNS = marks[perpId];
    }
}

contract AirbagLogTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address constant WRITER = address(0xA11B);
    address constant STRANGER = address(0xBAD);
    uint256 constant BTC = 16;
    uint256 constant ACCOUNT = 4127;
    AirbagLog log;
    MockExchange perpl;

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
    event SaveRecorded(uint256 indexed deployId, uint256 oldLiqHitBlock);
    event SaveProven(uint256 indexed deployId, uint256 markPNS, uint256 lotsOpen, address indexed prover);

    function setUp() public {
        perpl = new MockExchange();
        // Perpl's BTC: 1 price decimal, 5 lot decimals, 4% maintenance (25x), mark $99,420.0.
        perpl.setMarket(BTC, 1, 5, 2500, 994_200);
        // The golden position: 1 BTC long from $100,000 with $10,000 deposited.
        perpl.setPosition(BTC, ACCOUNT, 0, 10_000e6, 1_000_000, 0, 100_000, 0);
        log = new AirbagLog(WRITER, perpl, 6);
    }

    /// After the golden trim: 0.51094 BTC left, the released margin back in ($8,532.82).
    function _trimmed() internal {
        perpl.setPosition(BTC, ACCOUNT, 0, 8_532_820_000, 1_000_000, 0, 51_094, 0);
    }

    function _deploy() internal returns (uint256) {
        _trimmed();
        vm.prank(WRITER);
        return log.recordDeploy(ACCOUNT, BTC, bytes32(uint256(0x9c4e)), 100_000, 940_000, 0);
    }

    function test_setsOwnerWriterAndExchange() public view {
        require(log.owner() == address(this), "owner");
        require(log.writer() == WRITER, "writer");
        require(address(log.exchange()) == address(perpl), "exchange");
        require(log.collateralDecimals() == 6, "decimals");
        require(log.deploys() == 0, "deploys");
    }

    function test_liquidationPriceMatchesTheRiskModel() public {
        (uint256 liq, bool short, uint256 lots, uint256 mark, bool valid) = log.liquidationPrice(BTC, ACCOUNT);
        require(liq == 940_000, "golden long liquidates at $94,000.0");
        require(!short && lots == 100_000 && mark == 994_200 && valid, "position");
        // The short mirrors it, at $106,000.0.
        perpl.setPosition(BTC, ACCOUNT, 1, 10_000e6, 1_000_000, 0, 100_000, 0);
        (liq, short,,,) = log.liquidationPrice(BTC, ACCOUNT);
        require(liq == 1_060_000 && short, "golden short");
        // Funding received is cushion: +$600 moves a 1 BTC long's liquidation $600 lower.
        perpl.setPosition(BTC, ACCOUNT, 0, 10_000e6, 1_000_000, 0, 100_000, 600e6);
        (liq,,,,) = log.liquidationPrice(BTC, ACCOUNT);
        require(liq == 934_000, "funding");
        // No position, no price.
        perpl.setPosition(BTC, ACCOUNT, 0, 0, 0, 0, 0, 0);
        (liq,, lots,,) = log.liquidationPrice(BTC, ACCOUNT);
        require(liq == 0 && lots == 0, "none");
    }

    function test_liquidationPriceUsesTheEntryResidueAndRoundsTowardTheMark() public {
        // A long stored at $100,000.0 with a residue of 1 really entered a hair above $99,999.9:
        // liquidation falls to $93,999.896, which rounds up to $93,999.9. Ignoring the residue
        // would give $94,000.0.
        perpl.setPosition(BTC, ACCOUNT, 0, 10_000e6, 1_000_000, 1, 100_000, 0);
        (uint256 liq,,,,) = log.liquidationPrice(BTC, ACCOUNT);
        require(liq == 939_999, "long residue, rounded up");
        // The trimmed position's $87,299.76 rounds up to $87,299.8.
        _trimmed();
        (liq,,,,) = log.liquidationPrice(BTC, ACCOUNT);
        require(liq == 872_998, "rounded up");
        // A short's rounds down: $106,000.048 is $106,000.0.
        perpl.setPosition(BTC, ACCOUNT, 1, 10_000e6, 1_000_000, 32_768, 100_000, 0);
        (liq,,,,) = log.liquidationPrice(BTC, ACCOUNT);
        require(liq == 1_060_000, "short rounded down");
    }

    function test_recordsTheAfterStateFromPerpl() public {
        _trimmed();
        // The size after and the liquidation price after come from the chain, not the writer.
        vm.expectEmit(true, true, true, true);
        emit DeployRecorded(1, ACCOUNT, BTC, bytes32(uint256(0x9c4e)), 100_000, 51_094, 940_000, 872_998, 0);
        vm.prank(WRITER);
        require(log.recordDeploy(ACCOUNT, BTC, bytes32(uint256(0x9c4e)), 100_000, 940_000, 0) == 1, "id");
        (uint64 perpId, uint64 accountId, bool short, bool saved, uint256 liqBefore) = log.records(1);
        require(perpId == BTC && accountId == ACCOUNT && !short && !saved && liqBefore == 940_000, "record");
        require(_deploy() == 2 && log.deploys() == 2, "sequential");
    }

    function test_refusesARecordPerplContradicts() public {
        // A trim that left the size where it was.
        vm.prank(WRITER);
        vm.expectRevert(abi.encodeWithSelector(AirbagLog.SizeMismatch.selector, 0, 100_000, 100_000));
        log.recordDeploy(ACCOUNT, BTC, bytes32(0), 100_000, 940_000, 0);
        // A margin add that changed it.
        _trimmed();
        vm.prank(WRITER);
        vm.expectRevert(abi.encodeWithSelector(AirbagLog.SizeMismatch.selector, 1, 100_000, 51_094));
        log.recordDeploy(ACCOUNT, BTC, bytes32(0), 100_000, 940_000, 1);
        vm.prank(WRITER);
        vm.expectRevert(abi.encodeWithSelector(AirbagLog.BadReason.selector, 2));
        log.recordDeploy(ACCOUNT, BTC, bytes32(0), 100_000, 940_000, 2);
    }

    function test_onlyTheWriterRecords() public {
        _trimmed();
        vm.prank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(AirbagLog.NotWriter.selector));
        log.recordDeploy(ACCOUNT, BTC, bytes32(0), 100_000, 940_000, 0);
    }

    function test_anyoneProvesASaveOnceTheMarkReachesTheOldLiquidationPrice() public {
        vm.expectRevert(abi.encodeWithSelector(AirbagLog.UnknownDeploy.selector, 1));
        log.proveSave(1);
        _deploy();
        // $94,000.1 is a tick short of the old liquidation price.
        perpl.setMark(BTC, 940_001);
        vm.expectRevert(abi.encodeWithSelector(AirbagLog.NotReached.selector, 940_001, 940_000));
        log.proveSave(1);
        perpl.setMark(BTC, 940_000);
        vm.roll(64_963_000);
        vm.expectEmit(true, false, false, true);
        emit SaveRecorded(1, 64_963_000);
        vm.expectEmit(true, true, false, true);
        emit SaveProven(1, 940_000, 51_094, STRANGER);
        vm.prank(STRANGER);
        log.proveSave(1);
        (,,, bool saved,) = log.records(1);
        require(saved, "saved");
        vm.expectRevert(abi.encodeWithSelector(AirbagLog.AlreadySaved.selector, 1));
        log.proveSave(1);
    }

    function test_noSaveForAPositionThatIsGoneFlippedOrUnpriced() public {
        _deploy();
        perpl.setMark(BTC, 930_000);
        perpl.setMarkValid(false);
        vm.expectRevert(abi.encodeWithSelector(AirbagLog.MarkInvalid.selector));
        log.proveSave(1);
        perpl.setMarkValid(true);
        // Closed before the old liquidation price came.
        perpl.setPosition(BTC, ACCOUNT, 0, 0, 0, 0, 0, 0);
        vm.expectRevert(abi.encodeWithSelector(AirbagLog.PositionGone.selector, 1));
        log.proveSave(1);
        // A short in its place is a different position.
        perpl.setPosition(BTC, ACCOUNT, 1, 5_000e6, 930_000, 0, 50_000, 0);
        vm.expectRevert(abi.encodeWithSelector(AirbagLog.PositionGone.selector, 1));
        log.proveSave(1);
    }

    function test_aShortIsSavedAboveItsOldLiquidationPrice() public {
        perpl.setPosition(BTC, ACCOUNT, 1, 8_532_820_000, 1_000_000, 0, 51_094, 0);
        vm.prank(WRITER);
        log.recordDeploy(ACCOUNT, BTC, bytes32(0), 100_000, 1_060_000, 0);
        perpl.setMark(BTC, 1_059_999);
        vm.expectRevert(abi.encodeWithSelector(AirbagLog.NotReached.selector, 1_059_999, 1_060_000));
        log.proveSave(1);
        perpl.setMark(BTC, 1_060_000);
        log.proveSave(1);
    }

    function test_ownerRotatesTheWriter() public {
        log.setWriter(STRANGER);
        require(log.writer() == STRANGER, "rotated");
        _trimmed();
        vm.prank(WRITER);
        vm.expectRevert(abi.encodeWithSelector(AirbagLog.NotWriter.selector));
        log.recordDeploy(ACCOUNT, BTC, bytes32(0), 100_000, 940_000, 0);
        vm.prank(STRANGER);
        log.recordDeploy(ACCOUNT, BTC, bytes32(0), 100_000, 940_000, 0);
    }

    function test_onlyTheOwnerAdministers() public {
        vm.prank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(AirbagLog.NotOwner.selector));
        log.setWriter(STRANGER);
        vm.prank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(AirbagLog.NotOwner.selector));
        log.transferOwnership(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(AirbagLog.ZeroAddress.selector));
        log.setWriter(address(0));
        log.transferOwnership(STRANGER);
        require(log.owner() == STRANGER, "transferred");
    }

    function test_refusesAZeroWriterOrExchange() public {
        vm.expectRevert(abi.encodeWithSelector(AirbagLog.ZeroAddress.selector));
        new AirbagLog(address(0), perpl, 6);
        vm.expectRevert(abi.encodeWithSelector(AirbagLog.ZeroAddress.selector));
        new AirbagLog(WRITER, IPerplExchange(address(0)), 6);
    }

    function test_holdsNoFunds() public {
        (bool ok,) = address(log).call{value: 0}("");
        require(!ok, "no receive function");
    }
}
