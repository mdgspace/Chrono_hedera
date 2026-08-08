// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IInterestEngine {
    function getUtilization(address token) external view returns (uint256);
    function getBorrowAPY(address token) external view returns (uint256);
    function accrueInterest(bytes32 positionId) external returns (uint256 accrued);
    function initPosition(bytes32 positionId) external;
    function updateAfterRepay(bytes32 positionId) external;
}
