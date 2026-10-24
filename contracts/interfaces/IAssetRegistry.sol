// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

struct AssetConfig {
    address tokenAddress;
    uint8 decimals;
    bool isStablecoin;
    bool isActive;
}

/// @notice Ordered market risk parameters: collateralToken/debtToken is distinct from its reverse.
struct PairConfig {
    uint256 ltvBase;
    uint256 ltvMax;
    uint256 kDecay;
    uint256 ltBase;
    uint256 ltMax;
    uint256 kLtDecay;
    uint256 liquidationBonus;
    uint256 closeFactor;
    uint256 hardLiqPenalty;
    uint256 hardLiqCollateralFloor;
    uint256 stabilityPoolPenaltyShare;
    uint256 reservePenaltyShare;
    uint256 minBorrowDuration;
    uint256 maxBorrowDuration;
    bool isActive;
    uint32 auctionPhase1Duration;
    uint32 auctionPhase2Duration;
}

interface IAssetRegistry {
    function registerAsset(AssetConfig calldata config) external;
    function updateAssetConfig(address token, AssetConfig calldata config) external;
    function deactivateAsset(address token) external;
    function getConfig(address token) external view returns (AssetConfig memory);
    function isSupported(address token) external view returns (bool);
    function getAllAssets() external view returns (address[] memory);
    function registerPair(address collateralToken, address debtToken, PairConfig calldata config) external;
    function updatePairConfig(address collateralToken, address debtToken, PairConfig calldata config) external;
    function deactivatePair(address collateralToken, address debtToken) external;
    function getPairConfig(address collateralToken, address debtToken) external view returns (PairConfig memory);
    function isPairSupported(address collateralToken, address debtToken) external view returns (bool);
}
