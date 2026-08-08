// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IBorrowVault {
    function openPosition(
        address collateralToken,
        address debtToken,
        uint256 collateralAmount,
        uint256 borrowAmount,
        uint256 durationSeconds
    ) external returns (bytes32 positionId);
    
    function repay(bytes32 positionId, uint256 amount) external;
    function topUpCollateral(bytes32 positionId, uint256 amount) external;
}
