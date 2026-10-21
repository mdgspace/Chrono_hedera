// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {HederaScheduleService} from "@hiero-ledger/hiero-contracts/schedule-service/HederaScheduleService.sol";
import {HederaResponseCodes} from "@hiero-ledger/hiero-contracts/common/HederaResponseCodes.sol";
import {IMaturityCronScheduler} from "../interfaces/IMaturityCronScheduler.sol";
import {IScheduleRecoveryQueue} from "../interfaces/IScheduleRecoveryQueue.sol";
import {IBorrowVault} from "../interfaces/IBorrowVault.sol";
import {ILiquidationEngine} from "../interfaces/ILiquidationEngine.sol";
import {PositionLib} from "../libraries/PositionLib.sol";
import {ErrorLib} from "../libraries/ErrorLib.sol";

/// @notice One active HSS schedule at a time per fixed-maturity loan.
contract MaturityCronScheduler is IMaturityCronScheduler, HederaScheduleService, Ownable, ReentrancyGuard {
    uint256 public constant MAX_HOP_POLICY = 60 days;
    uint256 public constant TERMINAL_OFFSET = 5 seconds;
    uint256 public constant CALLBACK_CLOCK_SKEW = 3 seconds;
    int64 internal constant NO_CAPACITY = -1;
    int64 internal constant NO_RESERVE = -2;

    enum JobStatus { None, Scheduled, NeedsRecovery, Closed }

    struct Job {
        uint64 generation;
        uint64 successfulHops;
        uint64 nextExecutionAt;
        uint64 maturityAt;
        uint64 liquidationAt;
        address pendingSchedule;
        JobStatus status;
    }

    IBorrowVault public immutable borrowVault;
    ILiquidationEngine public immutable liquidationEngine;
    uint256 public immutable hopPolicy;
    uint256 public immutable gracePeriod;
    uint256 public immutable capacitySearchWindow;
    uint256 public immutable executeGasLimit;
    uint256 public immutable reservePerJob; // Native balance unit: tinybars on Hedera.

    IScheduleRecoveryQueue public recoveryQueue;
    uint256 public activeJobCount;
    mapping(bytes32 => Job) public jobs;

    event JobCreated(bytes32 indexed positionId, uint64 maturityAt, uint64 liquidationAt);
    event HopScheduled(bytes32 indexed positionId, uint64 indexed generation, address scheduleAddress, uint64 executionAt, bool terminal);
    event HopFailed(bytes32 indexed positionId, uint64 indexed generation, int64 responseCode);
    event HopAdvanced(bytes32 indexed positionId, uint64 indexed oldGeneration, uint64 newGeneration);
    event JobClosed(bytes32 indexed positionId, uint64 indexed generation);
    event ScheduleDeleteResult(bytes32 indexed positionId, address indexed scheduleAddress, int64 responseCode);

    error InvalidConfiguration();
    error RecoveryQueueNotConfigured();
    error RecoveryQueueAlreadyConfigured();
    error OnlyRecoveryQueue();
    error JobAlreadyExists(bytes32 positionId);
    error JobNotDue(bytes32 positionId, uint256 dueAt);
    error PositionMismatch(bytes32 positionId);
    error InsufficientHbarReserve(uint256 balance, uint256 required);
    error NoScheduleCapacity(bytes32 positionId);
    error NoExcessHbar();

    constructor(
        address _borrowVault,
        address _liquidationEngine,
        uint256 _hopPolicy,
        uint256 _gracePeriod,
        uint256 _capacitySearchWindow,
        uint256 _executeGasLimit,
        uint256 _reservePerJob
    ) Ownable(msg.sender) {
        if (
            _borrowVault == address(0) || _liquidationEngine == address(0) ||
            _hopPolicy == 0 || _hopPolicy > MAX_HOP_POLICY ||
            _capacitySearchWindow >= _hopPolicy || _executeGasLimit == 0
        ) revert InvalidConfiguration();
        borrowVault = IBorrowVault(_borrowVault);
        liquidationEngine = ILiquidationEngine(_liquidationEngine);
        hopPolicy = _hopPolicy;
        gracePeriod = _gracePeriod;
        capacitySearchWindow = _capacitySearchWindow;
        executeGasLimit = _executeGasLimit;
        reservePerJob = _reservePerJob;
    }

    receive() external payable {}

    modifier onlyBorrowVault() {
        if (msg.sender != address(borrowVault)) revert ErrorLib.Unauthorized(msg.sender, address(borrowVault));
        _;
    }

    modifier onlyRecoveryQueue() {
        if (msg.sender != address(recoveryQueue)) revert OnlyRecoveryQueue();
        _;
    }

    function setRecoveryQueue(address queue) external onlyOwner {
        if (address(recoveryQueue) != address(0)) revert RecoveryQueueAlreadyConfigured();
        if (queue == address(0)) revert InvalidConfiguration();
        recoveryQueue = IScheduleRecoveryQueue(queue);
    }

    function scheduleHardLiquidation(bytes32 positionId, uint256 maturityAt)
        external onlyBorrowVault nonReentrant returns (address scheduleAddress)
    {
        if (address(recoveryQueue) == address(0)) revert RecoveryQueueNotConfigured();
        if (jobs[positionId].status != JobStatus.None) revert JobAlreadyExists(positionId);
        PositionLib.Position memory position = borrowVault.getPosition(positionId);
        if (!position.active || position.id != positionId || position.startTime + position.duration != maturityAt) {
            revert PositionMismatch(positionId);
        }
        if (maturityAt <= block.timestamp || maturityAt > type(uint64).max - gracePeriod - TERMINAL_OFFSET) {
            revert InvalidConfiguration();
        }

        uint256 required = reservePerJob * (activeJobCount + 1);
        if (address(this).balance < required) revert InsufficientHbarReserve(address(this).balance, required);

        Job storage job = jobs[positionId];
        job.generation = 1;
        job.maturityAt = uint64(maturityAt);
        job.liquidationAt = uint64(maturityAt + gracePeriod + TERMINAL_OFFSET);

        (bool created, address nextAddress, uint64 at, bool terminal, int64 code) = _attemptNext(positionId, job, 1);
        if (!created) {
            if (code == NO_CAPACITY) revert NoScheduleCapacity(positionId);
            revert ErrorLib.ScheduleCallFailed(positionId, uint256(uint64(code)));
        }
        job.nextExecutionAt = at;
        job.pendingSchedule = nextAddress;
        job.status = JobStatus.Scheduled;
        activeJobCount++;
        emit JobCreated(positionId, job.maturityAt, job.liquidationAt);
        emit HopScheduled(positionId, 1, nextAddress, at, terminal);
        return nextAddress;
    }

    /// @notice HSS and keepers use the same generation-checked transition.
    function advance(bytes32 positionId, uint64 generation) external nonReentrant returns (bool scheduled) {
        return _advance(positionId, generation);
    }

    function retryPending(bytes32 positionId, uint64 generation)
        external onlyRecoveryQueue nonReentrant returns (bool scheduled)
    {
        if (jobs[positionId].status != JobStatus.NeedsRecovery) return false;
        return _advance(positionId, generation);
    }

    function _advance(bytes32 positionId, uint64 generation) internal returns (bool) {
        Job storage job = jobs[positionId];
        if (job.status == JobStatus.None) revert PositionMismatch(positionId);
        if (job.status == JobStatus.Closed || generation != job.generation) return false;
        // Hedera's scheduled consensus second can precede the EVM-visible
        // timestamp. Only an HSS self-call gets this small timing allowance;
        // public callers cannot force an extra schedule before the due second.
        uint256 allowedSkew = msg.sender == address(this) ? CALLBACK_CLOCK_SKEW : 0;
        if (block.timestamp + allowedSkew < job.nextExecutionAt) {
            revert JobNotDue(positionId, job.nextExecutionAt);
        }

        PositionLib.Position memory position = borrowVault.getPosition(positionId);
        if (!position.active) {
            _closeJob(positionId, job);
            return false;
        }
        if (position.id != positionId || position.startTime + position.duration != job.maturityAt) {
            revert PositionMismatch(positionId);
        }

        if (block.timestamp >= job.liquidationAt) {
            liquidationEngine.executeHardLiquidation(positionId);
            return false; // BorrowVault closes the job during successful liquidation.
        }

        (bool created, address nextAddress, uint64 at, bool terminal, int64 code) = _attemptNext(positionId, job, generation + 1);
        if (!created) {
            job.pendingSchedule = address(0);
            job.status = JobStatus.NeedsRecovery;
            recoveryQueue.markPending(positionId, generation, code);
            emit HopFailed(positionId, generation, code);
            return false;
        }

        address oldAddress = job.pendingSchedule;
        job.generation = generation + 1;
        job.successfulHops++;
        job.nextExecutionAt = at;
        job.pendingSchedule = nextAddress;
        job.status = JobStatus.Scheduled;
        recoveryQueue.clearPending(positionId, generation);
        emit HopAdvanced(positionId, generation, job.generation);
        emit HopScheduled(positionId, job.generation, nextAddress, at, terminal);

        // A manual advance may beat the old HSS callback. Failure to delete is
        // harmless because the old payload carries a stale generation.
        if (oldAddress != address(0)) {
            int64 deleteCode = _deleteSchedule(oldAddress);
            emit ScheduleDeleteResult(positionId, oldAddress, deleteCode);
        }
        return true;
    }

    // Hard liquidation reached through advance calls BorrowVault, which closes
    // the job here before the outer advance returns.
    function cancelSchedule(bytes32 positionId) external onlyBorrowVault {
        Job storage job = jobs[positionId];
        if (job.status == JobStatus.None || job.status == JobStatus.Closed) return;
        _closeJob(positionId, job);
    }

    function _closeJob(bytes32 positionId, Job storage job) internal {
        address oldAddress = job.pendingSchedule;
        uint64 oldGeneration = job.generation;
        JobStatus oldStatus = job.status;
        job.status = JobStatus.Closed;
        job.generation = oldGeneration + 1;
        job.pendingSchedule = address(0);
        activeJobCount--;
        if (oldStatus == JobStatus.NeedsRecovery) recoveryQueue.clearPending(positionId, oldGeneration);
        emit JobClosed(positionId, oldGeneration);
        if (oldAddress != address(0)) {
            int64 code = _deleteSchedule(oldAddress);
            emit ScheduleDeleteResult(positionId, oldAddress, code);
        }
    }

    /// @dev One bounded search. -1 is reserved for capacity exhaustion.
    function _attemptNext(bytes32 positionId, Job storage job, uint64 scheduledGeneration)
        internal returns (bool created, address scheduleAddress, uint64 executionAt, bool terminal, int64 responseCode)
    {
        if (activeJobCount != 0 && address(this).balance < activeJobCount * reservePerJob) {
            return (false, address(0), 0, false, NO_RESERVE);
        }
        uint256 latest = block.timestamp + hopPolicy;
        terminal = job.liquidationAt <= latest - capacitySearchWindow;
        uint256 ideal = terminal ? job.liquidationAt : latest - capacitySearchWindow;
        address target = terminal ? address(liquidationEngine) : address(this);
        bytes memory callData = terminal
            ? abi.encodeCall(ILiquidationEngine.executeHardLiquidation, (positionId))
            : abi.encodeCall(IMaturityCronScheduler.advance, (positionId, scheduledGeneration));

        // Probe ideal, powers-of-two later seconds, and the final allowed second.
        for (uint256 i = 0; i < 11; i++) {
            uint256 offset = i == 0 ? 0 : (i == 10 ? capacitySearchWindow : uint256(1) << (i - 1));
            if (offset > capacitySearchWindow) continue;
            uint256 candidate = ideal + offset;
            if (candidate <= block.timestamp || candidate > latest) continue;
            if (!_hasCapacity(candidate, executeGasLimit)) continue;
            (responseCode, scheduleAddress) = _createSchedule(target, candidate, executeGasLimit, callData);
            if (responseCode == HederaResponseCodes.SUCCESS && scheduleAddress != address(0)) {
                return (true, scheduleAddress, uint64(candidate), terminal, responseCode);
            }
            return (false, address(0), 0, terminal, responseCode);
        }
        return (false, address(0), 0, terminal, NO_CAPACITY);
    }

    function withdrawExcess(address payable recipient, uint256 amount) external onlyOwner nonReentrant {
        if (recipient == address(0) || amount > address(this).balance) revert NoExcessHbar();
        if (address(this).balance - amount < activeJobCount * reservePerJob) revert NoExcessHbar();
        (bool sent,) = recipient.call{value: amount}("");
        require(sent, "HBAR transfer failed");
    }

    function _hasCapacity(uint256 second, uint256 gasLimit) internal view virtual returns (bool) {
        return hasScheduleCapacity(second, gasLimit);
    }

    function _createSchedule(address target, uint256 second, uint256 gasLimit, bytes memory callData)
        internal virtual returns (int64 responseCode, address scheduleAddress)
    {
        return scheduleCall(target, second, gasLimit, 0, callData);
    }

    function _deleteSchedule(address scheduleAddress) internal virtual returns (int64) {
        return deleteSchedule(scheduleAddress);
    }
}
