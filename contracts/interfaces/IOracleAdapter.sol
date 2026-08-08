// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IOracleAdapter {
    function getPrice(address token) external view returns (uint256);
    function updatePrice(address token, bytes[] calldata priceUpdateData) external payable;
    function getUpdateFee(bytes[] calldata priceUpdateData) external view returns (uint256);
}
