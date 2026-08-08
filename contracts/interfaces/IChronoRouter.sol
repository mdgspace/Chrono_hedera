// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IChronoRouter {
    function openPositionWithPriceUpdate(
        bytes[] calldata priceUpdateData,
        address collateralToken,
        address debtToken,
        uint256 collateralAmount,
        uint256 borrowAmount,
        uint256 durationSeconds
    ) external payable returns (bytes32 positionId);

    function depositWithPriceUpdate(
        bytes[] calldata priceUpdateData,
        address token,
        uint256 amount
    ) external payable returns (uint256 shares);

    function repayWithPriceUpdate(
        bytes[] calldata priceUpdateData,
        bytes32 positionId,
        uint256 amount
    ) external payable;
}
