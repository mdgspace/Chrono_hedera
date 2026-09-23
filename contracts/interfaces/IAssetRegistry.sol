// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

struct AssetConfig {
    address tokenAddress;
    uint8 decimals;
    bool isStablecoin;
    uint256 ltvBase;
    uint256 ltvMax;
    uint256 kDecay;
    uint256 liquidationBonus;
    uint256 closeFactor;
    uint256 ltBufferMin;
    uint256 ltBufferMax;
    uint256 kLtBuffer;
    uint256 hardLiqPenalty;
    uint256 hardLiqCollateralFloor;
    uint256 stabilityPoolPenaltyShare;
    uint256 reservePenaltyShare;
    uint256 minBorrowDuration;
    uint256 maxBorrowDuration;
    bool isActive;
}

interface IAssetRegistry {
    function registerAsset(AssetConfig calldata config) external;
    function updateAssetConfig(address token, AssetConfig calldata config) external;
    function deactivateAsset(address token) external;
    function getConfig(address token) external view returns (AssetConfig memory);
    function isSupported(address token) external view returns (bool);
    function getAllAssets() external view returns (address[] memory);
}
