// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IScheduleRecoveryQueue {
    function markPending(bytes32 positionId, uint64 generation, int64 responseCode) external;
    function clearPending(bytes32 positionId, uint64 generation) external;
}
