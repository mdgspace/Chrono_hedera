// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title PositionLib
 * @notice Position data structure and enums
 */
library PositionLib {
    enum HealthState {
        SAFE,
        WARNING,
        LIQUIDATABLE,
        EXPIRED
    }

    struct Position {
        bytes32 id;
        address borrower;
        address collateralToken;
        address debtToken;
        uint256 collateralAmount;
        uint256 borrowAmount; // Principal debt
        uint256 startTime;
        uint256 duration; // in seconds
        address scheduledTxAddress;
        bool active;
    }

    function remainingDuration(Position memory self, uint256 currentTime) internal pure returns (uint256) {
        uint256 endTime = self.startTime + self.duration;
        if (currentTime >= endTime) return 0;
        return endTime - currentTime;
    }

    function durationHoursWad(Position memory self) internal pure returns (uint256) {
        return (self.duration * 1e18) / 3600;
    }

    function totalDebt(Position memory self, uint256 accruedInterest) internal pure returns (uint256) {
        return self.borrowAmount + accruedInterest;
    }

    function classifyHealth(Position memory self, uint256 hf, uint256 currentTime) internal pure returns (HealthState) {
        if (currentTime >= self.startTime + self.duration) {
            return HealthState.EXPIRED;
        }
        if (hf <= 1e18) {
            return HealthState.LIQUIDATABLE;
        }
        if (hf <= 1.5e18) {
            return HealthState.WARNING;
        }
        return HealthState.SAFE;
    }
}
