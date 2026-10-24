// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ILiquidationEngine {
    enum SoftLiquidationMode { CD3, DutchAuction }

    function setSoftLiquidationMode(SoftLiquidationMode mode) external;
    function setSoftAuctionConfig(uint32 duration, uint256 startMultiplier, uint256 floorMultiplier) external;
    function softLiquidate(bytes32 positionId, uint256 repayAmount) external;
    function bidSoftAuction(bytes32 positionId, uint256 maxDebtToRepay, uint256 minCollateralToReceive) external;
    function cancelSoftAuction(bytes32 positionId) external;
    function softAuctionPrice(bytes32 positionId) external view returns (uint256);
    function quoteSoftAuction(bytes32 positionId) external view returns (uint256 collateralToSell, uint256 debtToRepay, uint256 price);
    function executeHardLiquidation(bytes32 positionId) external;
    function bid(bytes32 positionId) external;
    function expireAuction(bytes32 positionId) external;
    function auctionPrice(bytes32 positionId) external view returns (uint256);
}
