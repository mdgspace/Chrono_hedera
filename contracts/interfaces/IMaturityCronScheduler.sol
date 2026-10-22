// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ILiquidationScheduler} from "./ILiquidationScheduler.sol";

interface IMaturityCronScheduler is ILiquidationScheduler {
    function advance(bytes32 positionId, uint64 generation) external returns (bool scheduled);
    function retryPending(bytes32 positionId, uint64 generation) external returns (bool scheduled);
}
