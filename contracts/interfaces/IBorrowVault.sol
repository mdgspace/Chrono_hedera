// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PositionLib} from "../libraries/PositionLib.sol";

interface IBorrowVault {
    function openPosition(
        address onBehalfOf,
        address collateralToken,
        address debtToken,
        uint256 collateralAmount,
        uint256 borrowAmount,
        uint256 durationSeconds
    ) external returns (bytes32 positionId);
    
    function repay(bytes32 positionId, uint256 amount) external;
    function topUpCollateral(bytes32 positionId, uint256 amount) external;
    function getPosition(bytes32 positionId) external view returns (PositionLib.Position memory);
    function seizeCollateral(bytes32 positionId, address liquidator, uint256 collateralAmount, bool closePosition) external;
}
