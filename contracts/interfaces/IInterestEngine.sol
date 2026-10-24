// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IInterestEngine {
    event IndexSnapshot(
        address indexed token,
        uint256 borrowIndex,
        uint256 borrowAPY,
        uint256 utilization,
        uint256 timestamp
    );

    function getUtilization(address token) external view returns (uint256);
    function getBorrowAPY(address token) external view returns (uint256);
    function getAdaptiveRate(address token) external view returns (uint256);
    function getTargetRate(address token) external view returns (uint256);
    function quoteBorrowAPY(address collateralToken, address debtToken, uint256 durationSeconds) external view returns (uint256);
    function syncUtilization(address token) external;
    function getSupplyAPY(address token) external view returns (uint256);
    function accrueInterest(bytes32 positionId) external returns (uint256 accrued);
    function getTotalDebt(bytes32 positionId) external view returns (uint256);
    function previewTotalDebt(bytes32 positionId) external view returns (uint256);
    function initPosition(bytes32 positionId, address collateralToken, address debtToken, uint256 principal, uint256 durationSeconds) external;
    function updateAfterRepay(bytes32 positionId, uint256 remainingPrincipal, uint256 remainingInterest) external;
    function clearPosition(bytes32 positionId) external;

    function updateReserveIndices(address token) external returns (uint256 currentBorrowIndex);
    function updateAllReserveIndices() external returns (uint256 updatedCount);
    function getBorrowIndex(address token) external view returns (uint256);
}
