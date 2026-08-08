// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ErrorLib
 * @notice Custom error definitions for the protocol
 */
library ErrorLib {
    // Access
    error Unauthorized(address caller, address expected);
    
    // Registry
    error AssetNotSupported(address token);
    error AssetAlreadyRegistered(address token);
    error InvalidAssetConfig(address token, string reason);
    
    // Position
    error PositionNotActive(bytes32 positionId);
    error InvalidDuration(uint256 requested, uint256 min, uint256 max);
    
    // Risk
    error InsufficientLTV(uint256 requested, uint256 maxAllowed);
    error HealthFactorTooLow(uint256 hf, uint256 minAllowed);
    
    // Pool
    error InsufficientLiquidity(address token, uint256 requested, uint256 available);
    error ZeroAmount();
    
    // Oracle
    error StalePrice(address token, uint256 priceTimestamp, uint256 currentTime);
    error NegativePrice(address token, int64 price);
    
    // Scheduler
    error ScheduleCallFailed(bytes32 positionId, uint256 responseCode);
    error ScheduleCancellationFailed(address scheduledTxAddress, uint256 responseCode);
}
