// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IAssetRegistry.sol";
import "../libraries/ErrorLib.sol";

contract AssetRegistry is IAssetRegistry, Ownable {
    mapping(address => AssetConfig) private _assets;
    address[] private _assetList;
    mapping(address => bool) private _isRegistered;

    event AssetRegistered(address indexed token, bool isStablecoin);
    event AssetUpdated(address indexed token);
    event AssetDeactivated(address indexed token);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function registerAsset(AssetConfig calldata config) external onlyOwner {
        if (_isRegistered[config.tokenAddress]) {
            revert ErrorLib.AssetAlreadyRegistered(config.tokenAddress);
        }
        if (config.tokenAddress == address(0)) {
            revert ErrorLib.InvalidAssetConfig(config.tokenAddress, "Zero address");
        }

        AssetConfig memory finalConfig = config;
        
        // Apply defaults if omitted (as per whitepaper/plan)
        if (finalConfig.ltvBase == 0) finalConfig.ltvBase = 0.75e18; // 75%
        if (finalConfig.ltvMax == 0) finalConfig.ltvMax = 0.90e18; // 90%
        if (finalConfig.kDecay == 0) finalConfig.kDecay = 7_614_000_000_000;
        
        if (finalConfig.closeFactor == 0) finalConfig.closeFactor = 0.5e18; // 50%
        if (finalConfig.liquidationBonus == 0) finalConfig.liquidationBonus = 0.05e18; // 5%
        
        if (finalConfig.ltBufferMin == 0) finalConfig.ltBufferMin = 0.05e18; // 5%
        if (finalConfig.ltBufferMax == 0) finalConfig.ltBufferMax = 0.25e18; // 25%
        if (finalConfig.kLtBuffer == 0) finalConfig.kLtBuffer = 7_614_000_000_000;
        
        // Default penalty = 5%
        if (finalConfig.hardLiqPenalty == 0) finalConfig.hardLiqPenalty = 0.05e18;
        
        if (finalConfig.minBorrowDuration == 0) finalConfig.minBorrowDuration = 3600; // 1 hour
        if (finalConfig.maxBorrowDuration == 0) finalConfig.maxBorrowDuration = 30 days;
        
        finalConfig.isActive = true;

        _assets[config.tokenAddress] = finalConfig;
        _assetList.push(config.tokenAddress);
        _isRegistered[config.tokenAddress] = true;

        emit AssetRegistered(config.tokenAddress, config.isStablecoin);
    }

    function updateAssetConfig(address token, AssetConfig calldata config) external onlyOwner {
        if (!_isRegistered[token]) {
            revert ErrorLib.AssetNotSupported(token);
        }
        
        _assets[token] = config;
        emit AssetUpdated(token);
    }

    function deactivateAsset(address token) external onlyOwner {
        if (!_isRegistered[token]) {
            revert ErrorLib.AssetNotSupported(token);
        }
        
        _assets[token].isActive = false;
        emit AssetDeactivated(token);
    }

    function getConfig(address token) external view returns (AssetConfig memory) {
        if (!_isRegistered[token]) {
            revert ErrorLib.AssetNotSupported(token);
        }
        return _assets[token];
    }

    function isSupported(address token) external view returns (bool) {
        return _isRegistered[token] && _assets[token].isActive;
    }

    function getAllAssets() external view returns (address[] memory) {
        return _assetList;
    }
}
