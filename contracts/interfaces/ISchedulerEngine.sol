// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ISchedulerEngine {
    function initialize(address _liquidationEngine, address _borrowVault) external;
    function scheduleHardLiquidation(bytes32 positionId, uint256 expiryTimestamp) external returns (address scheduleAddress);
    function cancelSchedule(bytes32 positionId) external;
}
