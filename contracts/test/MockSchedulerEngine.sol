// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/ISchedulerEngine.sol";

contract MockSchedulerEngine is ISchedulerEngine {
    function initialize(address, address) external {}

    function scheduleHardLiquidation(bytes32, uint256) external returns (address) {
        return address(0x123); // dummy address
    }

    function cancelSchedule(bytes32) external {}
}
