// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IMaturityCronScheduler} from "../interfaces/IMaturityCronScheduler.sol";
import {IScheduleRecoveryQueue} from "../interfaces/IScheduleRecoveryQueue.sol";

/// @notice Enumerable records for loan hops whose next HSS schedule could not be created.
contract ScheduleRecoveryQueue is IScheduleRecoveryQueue {
    struct Pending {
        uint64 generation;
        uint64 firstFailedAt;
        uint64 lastFailedAt;
        int64 responseCode; // -1 means no second had capacity in the bounded search.
        uint256 indexPlusOne;
    }

    IMaturityCronScheduler public immutable scheduler;
    mapping(bytes32 => Pending) public pending;
    bytes32[] private _positionIds;

    event RecoveryQueued(bytes32 indexed positionId, uint64 indexed generation, int64 responseCode);
    event RecoveryCleared(bytes32 indexed positionId, uint64 indexed generation);
    event RecoveryRetried(bytes32 indexed positionId, uint64 indexed generation, bool scheduled);

    error OnlyScheduler();
    error NotPending(bytes32 positionId);

    constructor(address _scheduler) {
        require(_scheduler != address(0), "scheduler required");
        scheduler = IMaturityCronScheduler(_scheduler);
    }

    modifier onlyScheduler() {
        if (msg.sender != address(scheduler)) revert OnlyScheduler();
        _;
    }

    function pendingCount() external view returns (uint256) {
        return _positionIds.length;
    }

    function pendingAt(uint256 index) external view returns (bytes32) {
        return _positionIds[index];
    }

    function markPending(bytes32 positionId, uint64 generation, int64 responseCode) external onlyScheduler {
        Pending storage record = pending[positionId];
        if (record.indexPlusOne == 0) {
            _positionIds.push(positionId);
            record.indexPlusOne = _positionIds.length;
            record.firstFailedAt = uint64(block.timestamp);
        }
        record.generation = generation;
        record.lastFailedAt = uint64(block.timestamp);
        record.responseCode = responseCode;
        emit RecoveryQueued(positionId, generation, responseCode);
    }

    function clearPending(bytes32 positionId, uint64 generation) external onlyScheduler {
        Pending storage record = pending[positionId];
        uint256 indexPlusOne = record.indexPlusOne;
        if (indexPlusOne == 0 || record.generation != generation) return;

        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = _positionIds.length - 1;
        if (index != lastIndex) {
            bytes32 movedId = _positionIds[lastIndex];
            _positionIds[index] = movedId;
            pending[movedId].indexPlusOne = indexPlusOne;
        }
        _positionIds.pop();
        delete pending[positionId];
        emit RecoveryCleared(positionId, generation);
    }

    /// @notice Anyone may pay for one bounded retry; no caller-controlled target or maturity.
    function retry(bytes32 positionId) external returns (bool scheduled) {
        Pending memory record = pending[positionId];
        if (record.indexPlusOne == 0) revert NotPending(positionId);
        scheduled = scheduler.retryPending(positionId, record.generation);
        emit RecoveryRetried(positionId, record.generation, scheduled);
    }
}
