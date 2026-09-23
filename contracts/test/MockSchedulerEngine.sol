// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/ISchedulerEngine.sol";

contract MockSchedulerEngine is ISchedulerEngine {
    bytes32 public lastPositionId;
    uint256 public lastExpiryTimestamp;

    function initialize(address, address) external {}

    function scheduleHardLiquidation(bytes32 positionId, uint256 expiryTimestamp) external returns (address) {
        lastPositionId = positionId;
        lastExpiryTimestamp = expiryTimestamp;
        return address(0x123); // dummy address
    }

    function cancelSchedule(bytes32) external {}
}
