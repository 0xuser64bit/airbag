// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AirbagLog} from "../src/AirbagLog.sol";

/// The few Foundry cheatcodes these tests use, without pulling in forge-std.
interface Vm {
    function prank(address) external;
    function expectRevert(bytes calldata) external;
    function expectEmit(bool, bool, bool, bool) external;
}

contract AirbagLogTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address constant WRITER = address(0xA11B);
    address constant STRANGER = address(0xBAD);
    AirbagLog log;

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

    function setUp() public {
        log = new AirbagLog(WRITER);
    }

    function _deploy() internal returns (uint256) {
        vm.prank(WRITER);
        // The golden BTC deploy: 1.00000 -> 0.51094 BTC (5 lot decimals), liquidation
        // $94,000.0 -> $87,299.8 (1 price decimal), a trim.
        return log.recordDeploy(4127, 16, bytes32(uint256(0x9c4e)), 100_000, 51_094, 940_000, 872_998, 0);
    }

    function test_setsOwnerAndWriter() public view {
        require(log.owner() == address(this), "owner");
        require(log.writer() == WRITER, "writer");
        require(log.deploys() == 0, "deploys");
    }

    function test_writerRecordsDeploysWithSequentialIds() public {
        vm.expectEmit(true, true, true, true);
        emit DeployRecorded(1, 4127, 16, bytes32(uint256(0x9c4e)), 100_000, 51_094, 940_000, 872_998, 0);
        require(_deploy() == 1, "first id");
        require(_deploy() == 2, "second id");
        require(log.deploys() == 2, "count");
    }

    function test_onlyTheWriterCanAppend() public {
        vm.prank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(AirbagLog.NotWriter.selector));
        log.recordDeploy(1, 1, bytes32(0), 1, 1, 1, 1, 0);
        vm.prank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(AirbagLog.NotWriter.selector));
        log.recordSave(1, 1);
    }

    function test_savesMustReferenceARecordedDeploy() public {
        vm.prank(WRITER);
        vm.expectRevert(abi.encodeWithSelector(AirbagLog.UnknownDeploy.selector, 1));
        log.recordSave(1, 123);
        _deploy();
        vm.expectEmit(true, false, false, true);
        emit SaveRecorded(1, 64_963_000);
        vm.prank(WRITER);
        log.recordSave(1, 64_963_000);
    }

    function test_rejectsUnknownReasons() public {
        vm.prank(WRITER);
        vm.expectRevert(abi.encodeWithSelector(AirbagLog.BadReason.selector, 2));
        log.recordDeploy(1, 1, bytes32(0), 1, 1, 1, 1, 2);
    }

    function test_aDeployCanOnlyBeSavedOnce() public {
        _deploy();
        vm.prank(WRITER);
        log.recordSave(1, 123);
        require(log.saved(1), "saved");
        vm.prank(WRITER);
        vm.expectRevert(abi.encodeWithSelector(AirbagLog.AlreadySaved.selector, 1));
        log.recordSave(1, 124);
    }

    function test_ownerRotatesTheWriter() public {
        log.setWriter(STRANGER);
        require(log.writer() == STRANGER, "rotated");
        vm.prank(WRITER);
        vm.expectRevert(abi.encodeWithSelector(AirbagLog.NotWriter.selector));
        log.recordDeploy(1, 1, bytes32(0), 1, 1, 1, 1, 0);
        vm.prank(STRANGER);
        log.recordDeploy(1, 1, bytes32(0), 1, 1, 1, 1, 0);
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

    function test_holdsNoFunds() public {
        (bool ok,) = address(log).call{value: 0}("");
        require(!ok, "no receive function");
    }
}
