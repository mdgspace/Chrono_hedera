// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRiskEngine {
    function computeMaxLTV(address token, uint256 durationSeconds) external view returns (uint256);
    function computeHealthFactor(
        uint256 collateralValue,
        uint256 debtValue,
        address collateralToken,
        uint256 remainingDuration,
        uint256 elapsedSeconds
    ) external view returns (uint256);
}
