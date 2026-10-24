// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IRiskEngine.sol";
import "../interfaces/IAssetRegistry.sol";
import "../libraries/MathLib.sol";
import "../libraries/ErrorLib.sol";

contract RiskEngine is IRiskEngine {
    IAssetRegistry public assetRegistry;

    constructor(address _assetRegistry) { assetRegistry = IAssetRegistry(_assetRegistry); }

    function computeMaxLTV(address collateralToken, address debtToken, uint256 durationSeconds) public view returns (uint256) {
        PairConfig memory config = assetRegistry.getPairConfig(collateralToken, debtToken);
        if (!assetRegistry.isPairSupported(collateralToken, debtToken)) revert ErrorLib.PairNotSupported(collateralToken, debtToken);
        _checkDuration(config, durationSeconds);
        return MathLib.boundedExpDecay(config.ltvMax, config.ltvBase, config.kDecay,
            durationSeconds, config.minBorrowDuration, config.maxBorrowDuration);
    }

    /// @notice Threshold depends on the original loan duration, never elapsed or remaining time.
    function computeLiquidationThreshold(address collateralToken, address debtToken, uint256 durationSeconds)
        public view returns (uint256)
    {
        PairConfig memory config = assetRegistry.getPairConfig(collateralToken, debtToken);
        // Existing debt remains liquidatable after a market is deactivated or its term limits change.
        if (durationSeconds < config.minBorrowDuration) durationSeconds = config.minBorrowDuration;
        if (durationSeconds > config.maxBorrowDuration) durationSeconds = config.maxBorrowDuration;
        return MathLib.boundedExpDecay(config.ltMax, config.ltBase, config.kLtDecay,
            durationSeconds, config.minBorrowDuration, config.maxBorrowDuration);
    }

    function computeHealthFactor(
        uint256 collateralValue, uint256 debtValue,
        address collateralToken, address debtToken, uint256 durationSeconds
    ) external view returns (uint256) {
        if (debtValue == 0) return type(uint256).max;
        uint256 lt = computeLiquidationThreshold(collateralToken, debtToken, durationSeconds);
        return MathLib.wadDiv(MathLib.wadMul(collateralValue, lt), debtValue);
    }

    function _checkDuration(PairConfig memory config, uint256 durationSeconds) private pure {
        if (durationSeconds < config.minBorrowDuration || durationSeconds > config.maxBorrowDuration) {
            revert ErrorLib.InvalidDuration(durationSeconds, config.minBorrowDuration, config.maxBorrowDuration);
        }
    }
}
