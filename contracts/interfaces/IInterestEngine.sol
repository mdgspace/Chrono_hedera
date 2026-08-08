// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IInterestEngine {
    function getUtilization(address token) external view returns (uint256);
    function getBorrowAPY(address token) external view returns (uint256);
    function getSupplyAPY(address token) external view returns (uint256);
    function accrueInterest(bytes32 positionId) external returns (uint256 accrued);
    function initPosition(bytes32 positionId, address debtToken, uint256 principal) external;
    function updateAfterRepay(bytes32 positionId, uint256 remainingPrincipal, uint256 remainingInterest) external;
    function clearPosition(bytes32 positionId) external;
}
