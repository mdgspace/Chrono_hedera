// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MaturityCronScheduler} from "../engines/MaturityCronScheduler.sol";
import {PositionLib} from "../libraries/PositionLib.sol";
import {IBorrowVault} from "../interfaces/IBorrowVault.sol";
import {ILiquidationEngine} from "../interfaces/ILiquidationEngine.sol";

contract MockCronBorrowVault {
    mapping(bytes32 => PositionLib.Position) private _positions;
    MaturityCronScheduler public scheduler;

    function setScheduler(address value) external { scheduler = MaturityCronScheduler(payable(value)); }

    function create(bytes32 id, uint256 duration) external returns (address) {
        _positions[id] = PositionLib.Position({
            id: id, borrower: msg.sender, collateralToken: address(1), debtToken: address(2),
            collateralAmount: 1, borrowAmount: 1, startTime: block.timestamp,
            duration: duration, scheduledTxAddress: address(0), active: true
        });
        address first = scheduler.scheduleHardLiquidation(id, block.timestamp + duration);
        _positions[id].scheduledTxAddress = first;
        return first;
    }

    function getPosition(bytes32 id) external view returns (PositionLib.Position memory) { return _positions[id]; }
    function close(bytes32 id) external {
        _positions[id].active = false;
        scheduler.cancelSchedule(id);
    }
}

contract MockCronLiquidation {
    MockCronBorrowVault public vault;
    uint256 public calls;
    constructor(address value) { vault = MockCronBorrowVault(value); }
    function executeHardLiquidation(bytes32 id) external {
        calls++;
        vault.close(id);
    }
}

contract MockMaturityCronScheduler is MaturityCronScheduler {
    bool public available = true;
    int64 public createCode = 22;
    uint256 public blockedSecond;
    uint256 public createdCount;
    uint256 public lastExecutionAt;
    address public lastTarget;
    bytes public lastCallData;

    constructor(address vault, address liquidation, uint256 hop, uint256 grace, uint256 window, uint256 reserve)
        MaturityCronScheduler(vault, liquidation, hop, grace, window, 3_000_000, reserve) {}

    function setAvailable(bool value) external { available = value; }
    function setCreateCode(int64 value) external { createCode = value; }
    function setBlockedSecond(uint256 value) external { blockedSecond = value; }
    function triggerSelf(bytes32 id, uint64 generation) external returns (bool) {
        return this.advance(id, generation);
    }

    function _hasCapacity(uint256 second, uint256) internal view override returns (bool) {
        return available && second != blockedSecond;
    }

    function _createSchedule(address target, uint256 second, uint256, bytes memory callData)
        internal override returns (int64, address)
    {
        if (createCode != 22) return (createCode, address(0));
        createdCount++;
        lastTarget = target;
        lastExecutionAt = second;
        lastCallData = callData;
        return (22, address(uint160(createdCount + 100)));
    }

    function _deleteSchedule(address) internal pure override returns (int64) { return 22; }
}
