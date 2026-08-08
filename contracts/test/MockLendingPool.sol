// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/ILendingPool.sol";

contract MockLendingPool is ILendingPool {
    mapping(address => uint256) public borrowed;
    mapping(address => uint256) public deposits;

    function deposit(address, uint256, address) external pure returns (uint256) { return 0; }
    function withdraw(address, uint256) external pure returns (uint256) { return 0; }
    function reserveBorrowLiquidity(address, uint256) external pure {}
    function returnBorrowLiquidity(address, uint256) external pure {}

    function setBorrowed(address token, uint256 amount) external {
        borrowed[token] = amount;
    }

    function setDeposits(address token, uint256 amount) external {
        deposits[token] = amount;
    }

    function getTotalBorrowed(address token) external view returns (uint256) {
        return borrowed[token];
    }

    function getTotalDeposits(address token) external view returns (uint256) {
        return deposits[token];
    }
}
