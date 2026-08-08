// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ILiquidationEngine {
    function softLiquidate(bytes32 positionId, uint256 repayAmount, bytes[] calldata priceUpdateData) external payable;
    function executeHardLiquidation(bytes32 positionId) external;
}
