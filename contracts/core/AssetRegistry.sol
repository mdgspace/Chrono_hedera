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

    uint256 public constant MAX_BORROW_DURATION_LIMIT = 365 days;
    uint32 public constant DEFAULT_AUCTION_PHASE1 = 15 minutes;
    uint32 public constant DEFAULT_AUCTION_PHASE2 = 30 minutes;
    uint32 public constant MIN_AUCTION_PHASE = 1 minutes;
    uint32 public constant MAX_AUCTION_PHASE1 = 1 hours;
    uint32 public constant MAX_AUCTION_PHASE2 = 4 hours;

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
        
        // Calibrated Hard Liquidation Waterfall Defaults
        if (finalConfig.hardLiqPenalty == 0) finalConfig.hardLiqPenalty = 0.12e18; // 12%
        if (finalConfig.hardLiqCollateralFloor == 0) finalConfig.hardLiqCollateralFloor = 0.025e18; // 2.5%
        if (finalConfig.stabilityPoolPenaltyShare == 0) finalConfig.stabilityPoolPenaltyShare = 0.75e18; // 75%
        if (finalConfig.reservePenaltyShare == 0) finalConfig.reservePenaltyShare = 0.25e18; // 25%
        
        if (finalConfig.minBorrowDuration == 0) finalConfig.minBorrowDuration = 3600; // 1 hour
        if (finalConfig.maxBorrowDuration == 0) finalConfig.maxBorrowDuration = 30 days;
        if (finalConfig.maxBorrowDuration > MAX_BORROW_DURATION_LIMIT) {
            revert ErrorLib.DurationExceedsScheduleLimit(finalConfig.maxBorrowDuration, MAX_BORROW_DURATION_LIMIT);
        }
        if (finalConfig.maxBorrowDuration < finalConfig.minBorrowDuration) {
            revert ErrorLib.InvalidDuration(finalConfig.maxBorrowDuration, finalConfig.minBorrowDuration, MAX_BORROW_DURATION_LIMIT);
        }

        if (finalConfig.auctionPhase1Duration == 0) finalConfig.auctionPhase1Duration = DEFAULT_AUCTION_PHASE1;
        if (finalConfig.auctionPhase2Duration == 0) finalConfig.auctionPhase2Duration = DEFAULT_AUCTION_PHASE2;
        _validateAuctionDurations(finalConfig);

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
        if (config.maxBorrowDuration > MAX_BORROW_DURATION_LIMIT) {
            revert ErrorLib.DurationExceedsScheduleLimit(config.maxBorrowDuration, MAX_BORROW_DURATION_LIMIT);
        }
        if (config.maxBorrowDuration < config.minBorrowDuration) {
            revert ErrorLib.InvalidDuration(config.maxBorrowDuration, config.minBorrowDuration, MAX_BORROW_DURATION_LIMIT);
        }
        _validateAuctionDurations(config);

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

    function _validateAuctionDurations(AssetConfig memory config) private pure {
        uint256 p1 = config.auctionPhase1Duration;
        uint256 p2 = config.auctionPhase2Duration;
        if (p1 < MIN_AUCTION_PHASE || p1 > MAX_AUCTION_PHASE1) {
            revert ErrorLib.InvalidDuration(p1, MIN_AUCTION_PHASE, MAX_AUCTION_PHASE1);
        }
        if (p2 < MIN_AUCTION_PHASE || p2 > MAX_AUCTION_PHASE2) {
            revert ErrorLib.InvalidDuration(p2, MIN_AUCTION_PHASE, MAX_AUCTION_PHASE2);
        }
    }
}
