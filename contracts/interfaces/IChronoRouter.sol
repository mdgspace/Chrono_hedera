// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IChronoRouter {
    function openPosition(
        address collateralToken,
        address debtToken,
        uint256 collateralAmount,
        uint256 borrowAmount,
        uint256 durationSeconds
    ) external returns (bytes32 positionId);

    function deposit(
        address token,
        uint256 amount
    ) external returns (uint256 shares);

    function repay(
        bytes32 positionId,
        uint256 amount
    ) external;
}
