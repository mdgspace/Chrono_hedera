// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ILiquidationScheduler} from "./ILiquidationScheduler.sol";

interface ISchedulerEngine is ILiquidationScheduler {
    function initialize(address _liquidationEngine, address _borrowVault) external;
    function setInterestEngine(address _interestEngine) external;
    function setIndexKeeperEnabled(bool _enabled) external;
    function executePeriodicIndexUpdate() external returns (address nextSchedule);
    function startIndexKeeper() external returns (address scheduleAddress);
    function stopIndexKeeper() external;
}
