// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IOracleAdapter.sol";

contract MockOracleAdapter is IOracleAdapter {
    mapping(address => uint256) public prices;
    mapping(address => uint8) public decimals;

    function setPrice(address token, uint256 price, uint8 _decimals) external {
        prices[token] = price;
        decimals[token] = _decimals;
    }

    function getPrice(address token) external view returns (uint256) {
        return prices[token];
    }

    function updatePrice(address, bytes[] calldata) external payable {}

    function getUpdateFee(bytes[] calldata) external pure returns (uint256) {
        return 0;
    }
}
