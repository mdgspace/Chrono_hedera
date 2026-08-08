// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IRiskEngine.sol";
import "../interfaces/IAssetRegistry.sol";
import "../libraries/MathLib.sol";
import "../libraries/ErrorLib.sol";

contract RiskEngine is IRiskEngine {
    IAssetRegistry public assetRegistry;

    constructor(address _assetRegistry) {
        assetRegistry = IAssetRegistry(_assetRegistry);
    }

    function computeMaxLTV(address token, uint256 durationSeconds) public view returns (uint256) {
        AssetConfig memory config = assetRegistry.getConfig(token);

        if (durationSeconds < config.minBorrowDuration || durationSeconds > config.maxBorrowDuration) {
            revert ErrorLib.InvalidDuration(durationSeconds, config.minBorrowDuration, config.maxBorrowDuration);
        }

        return MathLib.computeLTV(config.ltvBase, config.ltvMax, config.kDecay, durationSeconds);
    }

    function computeHealthFactor(
        uint256 collateralValue,
        uint256 debtValue,
        address collateralToken,
        uint256 remainingDuration,
        uint256 elapsedSeconds
    ) external view returns (uint256) {
        if (debtValue == 0) {
            return type(uint256).max;
        }

        AssetConfig memory config = assetRegistry.getConfig(collateralToken);

        uint256 buf = MathLib.computeBuffer(
            config.ltBufferMin,
            config.ltBufferMax,
            config.kLtBuffer,
            elapsedSeconds
        );

        uint256 ltv = computeMaxLTV(collateralToken, remainingDuration);
        
        uint256 lt = ltv + buf;
        if (lt > MathLib.WAD) {
            lt = MathLib.WAD;
        }

        return MathLib.wadDiv(MathLib.wadMul(collateralValue, lt), debtValue);
    }
}
