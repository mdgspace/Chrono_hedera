// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISchedulerEngine} from "../interfaces/ISchedulerEngine.sol";
import {ILiquidationEngine} from "../interfaces/ILiquidationEngine.sol";
import {IInterestEngine} from "../interfaces/IInterestEngine.sol";
import {HederaScheduleService} from "@hiero-ledger/hiero-contracts/schedule-service/HederaScheduleService.sol";
import {IHRC1215ScheduleFacade} from "@hiero-ledger/hiero-contracts/schedule-service/IHRC1215ScheduleFacade.sol";
import {HederaResponseCodes} from "@hiero-ledger/hiero-contracts/common/HederaResponseCodes.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ErrorLib} from "../libraries/ErrorLib.sol";

contract SchedulerEngine is ISchedulerEngine, HederaScheduleService, Ownable {
    uint256 public constant GRACE_PERIOD = 900; // 15 minutes
    uint256 public constant MAX_BORROW_DURATION = 60 days; // 5,184,000 seconds
    uint256 public constant INDEX_KEEPER_INTERVAL = 3600; // 1 hour
    
    mapping(bytes32 => address) public positionSchedules;

    address public liquidationEngine;
    address public borrowVault;
    address public interestEngine;
    address public currentIndexSchedule;
    bool public isIndexKeeperEnabled;
    uint256 public executeGasLimit = 3_000_000;

    event ScheduleCreated(bytes32 indexed positionId, address scheduleAddress);
    event ScheduleCancelled(bytes32 indexed positionId, address scheduleAddress);
    event GasLimitUpdated(uint256 newGasLimit);
    event IndexScheduleCreated(address scheduleAddress, uint256 nextExecutionTime);
    event IndexKeeperToggled(bool indexed enabled);
    event IndexScheduleCancelled(address indexed scheduleAddress);

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
        if (expiryTimestamp > block.timestamp + MAX_BORROW_DURATION) {
            revert ErrorLib.DurationExceedsScheduleLimit(expiryTimestamp - block.timestamp, MAX_BORROW_DURATION);
        }

        bytes memory callData = abi.encodeCall(ILiquidationEngine.executeHardLiquidation, (positionId));
        
        uint256 finalExpiry = expiryTimestamp + GRACE_PERIOD + 2;
        bool capacity = hasScheduleCapacity(finalExpiry, executeGasLimit);
        
        if (!capacity) {
            // Jitter: try up to +5 seconds
            bool found = false;
            for (uint256 i = 1; i <= 5; i++) {
                if (hasScheduleCapacity(finalExpiry + i, executeGasLimit)) {
                    finalExpiry = finalExpiry + i;
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
            // Ignore response code. If it's already executed/deleted by Hedera, it will fail,
            // but we don't want to block the entire liquidation or repayment flow.
            deleteSchedule(scheduleAddress);
            delete positionSchedules[positionId];
            emit ScheduleCancelled(positionId, scheduleAddress);
        }
    }

    function setInterestEngine(address _interestEngine) external onlyOwner {
        interestEngine = _interestEngine;
    }

    function setIndexKeeperEnabled(bool _enabled) external onlyOwner {
        isIndexKeeperEnabled = _enabled;
        emit IndexKeeperToggled(_enabled);
    }

    function executePeriodicIndexUpdate() external returns (address nextSchedule) {
        // 1. Advance index across all registered tokens
        if (interestEngine != address(0)) {
            IInterestEngine(interestEngine).updateAllReserveIndices();
        }

        // 2. Schedule next recurring execution window ONLY if enabled
        if (!isIndexKeeperEnabled) {
            currentIndexSchedule = address(0);
            return address(0);
        }

        uint256 nextExpiry = block.timestamp + INDEX_KEEPER_INTERVAL;
        bytes memory callData = abi.encodeCall(this.executePeriodicIndexUpdate, ());

        int64 rc;
        (rc, nextSchedule) = scheduleCall(
            address(this),
            nextExpiry,
            executeGasLimit,
            0,
            callData
        );

        if (rc == HederaResponseCodes.SUCCESS && nextSchedule != address(0)) {
            currentIndexSchedule = nextSchedule;
            emit IndexScheduleCreated(nextSchedule, nextExpiry);
        }
    }

    function startIndexKeeper() external onlyOwner returns (address scheduleAddress) {
        isIndexKeeperEnabled = true;
        emit IndexKeeperToggled(true);

        uint256 nextExpiry = block.timestamp + INDEX_KEEPER_INTERVAL;
        bytes memory callData = abi.encodeCall(this.executePeriodicIndexUpdate, ());

        int64 rc;
        (rc, scheduleAddress) = scheduleCall(
            address(this),
            nextExpiry,
            executeGasLimit,
            0,
            callData
        );

        require(rc == HederaResponseCodes.SUCCESS && scheduleAddress != address(0), "Failed to prime keeper");
        currentIndexSchedule = scheduleAddress;
        emit IndexScheduleCreated(scheduleAddress, nextExpiry);
    }

    function stopIndexKeeper() external onlyOwner {
        isIndexKeeperEnabled = false;
        emit IndexKeeperToggled(false);

        if (currentIndexSchedule != address(0)) {
            address scheduleToDelete = currentIndexSchedule;
            currentIndexSchedule = address(0);
            deleteSchedule(scheduleToDelete);
            emit IndexScheduleCancelled(scheduleToDelete);
        }
    }
}
