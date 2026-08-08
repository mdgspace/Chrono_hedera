// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IStabilityPool {
    function deposit(address debtToken, uint256 amount) external;
    function withdraw(address debtToken, uint256 amount) external;
    function absorbDebt(
        address debtToken,
        uint256 debtAmount,
        address collateralToken,
        uint256 collateralAmount
    ) external;
    function claimCollateralRewards(address debtToken) external;
}
