// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISchedulerEngine} from "../interfaces/ISchedulerEngine.sol";
import {ILiquidationEngine} from "../interfaces/ILiquidationEngine.sol";
import {HederaScheduleService} from "@hiero-ledger/hiero-contracts/schedule-service/HederaScheduleService.sol";
import {IHRC1215ScheduleFacade} from "@hiero-ledger/hiero-contracts/schedule-service/IHRC1215ScheduleFacade.sol";
import {HederaResponseCodes} from "@hiero-ledger/hiero-contracts/common/HederaResponseCodes.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ErrorLib} from "../libraries/ErrorLib.sol";

contract SchedulerEngine is ISchedulerEngine, HederaScheduleService, Ownable {
    
    mapping(bytes32 => address) public positionSchedules;

    address public liquidationEngine;
    address public borrowVault;
    uint256 public executeGasLimit = 3_000_000;

    event ScheduleCreated(bytes32 indexed positionId, address scheduleAddress);
    event ScheduleCancelled(bytes32 indexed positionId, address scheduleAddress);
    event GasLimitUpdated(uint256 newGasLimit);

    constructor() Ownable(msg.sender) {}

    receive() external payable {}

    modifier onlyBorrowVault() {
        if (msg.sender != borrowVault) revert ErrorLib.Unauthorized(msg.sender, borrowVault);
        _;
    }

    function initialize(address _liquidationEngine, address _borrowVault) external onlyOwner {
        liquidationEngine = _liquidationEngine;
        borrowVault = _borrowVault;
    }

    function setExecuteGasLimit(uint256 _executeGasLimit) external onlyOwner {
        executeGasLimit = _executeGasLimit;
        emit GasLimitUpdated(_executeGasLimit);
    }

    function scheduleHardLiquidation(bytes32 positionId, uint256 expiryTimestamp) external onlyBorrowVault returns (address scheduleAddress) {
        bytes memory callData = abi.encodeCall(ILiquidationEngine.executeHardLiquidation, (positionId));
        
        bool capacity = hasScheduleCapacity(expiryTimestamp, executeGasLimit);
        uint256 finalExpiry = expiryTimestamp;
        
        if (!capacity) {
            // Jitter: try up to +5 seconds
            bool found = false;
            for (uint256 i = 1; i <= 5; i++) {
                if (hasScheduleCapacity(expiryTimestamp + i, executeGasLimit)) {
                    finalExpiry = expiryTimestamp + i;
                    found = true;
                    break;
                }
            }
            if (!found) revert ErrorLib.ScheduleCallFailed(positionId, 0); // No capacity
        }

        int64 rc;
        (rc, scheduleAddress) = scheduleCall(
            liquidationEngine,
            finalExpiry,
            executeGasLimit,
            0, // msg.value for call
            callData
        );

        if (rc != HederaResponseCodes.SUCCESS || scheduleAddress == address(0)) {
            revert ErrorLib.ScheduleCallFailed(positionId, uint256(uint64(rc)));
        }

        positionSchedules[positionId] = scheduleAddress;
        emit ScheduleCreated(positionId, scheduleAddress);
    }

    function cancelSchedule(bytes32 positionId) external onlyBorrowVault {
        address scheduleAddress = positionSchedules[positionId];
        if (scheduleAddress != address(0)) {
            int64 rc = deleteSchedule(scheduleAddress);
            if (rc != HederaResponseCodes.SUCCESS) {
                revert ErrorLib.ScheduleCancellationFailed(scheduleAddress, uint256(uint64(rc)));
            }
            delete positionSchedules[positionId];
            emit ScheduleCancelled(positionId, scheduleAddress);
        }
    }
}
