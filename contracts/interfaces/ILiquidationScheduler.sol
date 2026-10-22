// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ILiquidationScheduler {
    function scheduleHardLiquidation(bytes32 positionId, uint256 maturityAt) external returns (address scheduleAddress);
    function cancelSchedule(bytes32 positionId) external;
}
