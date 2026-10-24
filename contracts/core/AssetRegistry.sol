// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IAssetRegistry.sol";
import "../libraries/ErrorLib.sol";

contract AssetRegistry is IAssetRegistry, Ownable {
    mapping(address => AssetConfig) private _assets;
    address[] private _assetList;
    mapping(address => bool) private _isRegistered;
    mapping(address => mapping(address => PairConfig)) private _pairs;
    mapping(address => mapping(address => bool)) private _pairRegistered;

    event AssetRegistered(address indexed token, bool isStablecoin);
    event AssetUpdated(address indexed token);
    event AssetDeactivated(address indexed token);
    event PairRegistered(address indexed collateralToken, address indexed debtToken);
    event PairUpdated(address indexed collateralToken, address indexed debtToken);
    event PairDeactivated(address indexed collateralToken, address indexed debtToken);

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
        if (config.tokenAddress != token) revert ErrorLib.InvalidAssetConfig(token, "Token mismatch");

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

    function isSupported(address token) public view returns (bool) {
        return _isRegistered[token] && _assets[token].isActive;
    }

    function getAllAssets() external view returns (address[] memory) {
        return _assetList;
    }

    function registerPair(address collateralToken, address debtToken, PairConfig calldata config) external onlyOwner {
        if (collateralToken == debtToken || !isSupported(collateralToken) || !isSupported(debtToken)) {
            revert ErrorLib.PairNotSupported(collateralToken, debtToken);
        }
        if (_pairRegistered[collateralToken][debtToken]) {
            revert ErrorLib.PairAlreadyRegistered(collateralToken, debtToken);
        }
        PairConfig memory next = _withPairDefaults(config);
        _validatePair(next);
        next.isActive = true;
        _pairs[collateralToken][debtToken] = next;
        _pairRegistered[collateralToken][debtToken] = true;
        emit PairRegistered(collateralToken, debtToken);
    }

    function updatePairConfig(address collateralToken, address debtToken, PairConfig calldata config) external onlyOwner {
        if (!_pairRegistered[collateralToken][debtToken]) revert ErrorLib.PairNotSupported(collateralToken, debtToken);
        PairConfig memory next = config;
        _validatePair(next);
        _pairs[collateralToken][debtToken] = next;
        emit PairUpdated(collateralToken, debtToken);
    }

    function deactivatePair(address collateralToken, address debtToken) external onlyOwner {
        if (!_pairRegistered[collateralToken][debtToken]) revert ErrorLib.PairNotSupported(collateralToken, debtToken);
        _pairs[collateralToken][debtToken].isActive = false;
        emit PairDeactivated(collateralToken, debtToken);
    }

    function getPairConfig(address collateralToken, address debtToken) external view returns (PairConfig memory) {
        if (!_pairRegistered[collateralToken][debtToken]) revert ErrorLib.PairNotSupported(collateralToken, debtToken);
        return _pairs[collateralToken][debtToken];
    }

    function isPairSupported(address collateralToken, address debtToken) external view returns (bool) {
        return isSupported(collateralToken) && isSupported(debtToken)
            && _pairRegistered[collateralToken][debtToken] && _pairs[collateralToken][debtToken].isActive;
    }

    function _withPairDefaults(PairConfig calldata config) private pure returns (PairConfig memory next) {
        next = config;
        if (next.ltvBase == 0) next.ltvBase = 0.75e18;
        if (next.ltvMax == 0) next.ltvMax = 0.90e18;
        if (next.kDecay == 0) next.kDecay = 7_614_000_000_000;
        if (next.ltBase == 0) next.ltBase = 0.80e18;
        if (next.ltMax == 0) next.ltMax = 0.92e18;
        if (next.kLtDecay == 0) next.kLtDecay = 7_614_000_000_000;
        if (next.closeFactor == 0) next.closeFactor = 0.5e18;
        if (next.liquidationBonus == 0) next.liquidationBonus = 0.05e18;
        if (next.hardLiqPenalty == 0) next.hardLiqPenalty = 0.12e18;
        if (next.hardLiqCollateralFloor == 0) next.hardLiqCollateralFloor = 0.025e18;
        if (next.stabilityPoolPenaltyShare == 0) next.stabilityPoolPenaltyShare = 0.75e18;
        if (next.reservePenaltyShare == 0) next.reservePenaltyShare = 0.25e18;
        if (next.minBorrowDuration == 0) next.minBorrowDuration = 1 hours;
        if (next.maxBorrowDuration == 0) next.maxBorrowDuration = 30 days;
        if (next.auctionPhase1Duration == 0) next.auctionPhase1Duration = DEFAULT_AUCTION_PHASE1;
        if (next.auctionPhase2Duration == 0) next.auctionPhase2Duration = DEFAULT_AUCTION_PHASE2;
    }

    function _validatePair(PairConfig memory config) private pure {
        if (config.minBorrowDuration == 0 || config.maxBorrowDuration <= config.minBorrowDuration
            || config.maxBorrowDuration > MAX_BORROW_DURATION_LIMIT) {
            revert ErrorLib.InvalidDuration(config.maxBorrowDuration, config.minBorrowDuration, MAX_BORROW_DURATION_LIMIT);
        }
        if (config.ltvBase > config.ltvMax || config.ltvMax >= config.ltMax
            || config.ltBase <= config.ltvBase || config.ltBase > config.ltMax || config.ltMax > 1e18
            || config.kDecay == 0 || config.kDecay > 1e18
            || config.kLtDecay == 0 || config.kLtDecay > config.kDecay
            || config.closeFactor > 1e18
            || config.stabilityPoolPenaltyShare + config.reservePenaltyShare != 1e18) {
            revert ErrorLib.InvalidPairConfig();
        }
        if (config.auctionPhase1Duration < MIN_AUCTION_PHASE || config.auctionPhase1Duration > MAX_AUCTION_PHASE1
            || config.auctionPhase2Duration < MIN_AUCTION_PHASE || config.auctionPhase2Duration > MAX_AUCTION_PHASE2) {
            revert ErrorLib.InvalidPairConfig();
        }
    }

}
