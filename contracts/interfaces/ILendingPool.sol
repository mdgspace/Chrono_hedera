// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ILendingPool {
    function deposit(address token, uint256 amount) external returns (uint256 shares);
    function withdraw(address token, uint256 shares) external returns (uint256 amount);
    function reserveBorrowLiquidity(address token, uint256 amount) external;
    function returnBorrowLiquidity(address token, uint256 amount) external;
    function getTotalBorrowed(address token) external view returns (uint256);
    function getTotalDeposits(address token) external view returns (uint256);
}
