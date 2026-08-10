// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IOracleAdapter.sol";
import "../libraries/ErrorLib.sol";

contract PythOracleAdapter is IOracleAdapter, Ownable {
    IPyth public pyth;
    uint256 public stalenessThreshold = 120; // Default 120 seconds
    address public keeper;

    mapping(address => bytes32) public priceFeeds;

    modifier onlyKeeper() {
        require(msg.sender == keeper, "Oracle: Not keeper");
        _;
    }

    constructor(address _pyth) Ownable(msg.sender) {
        pyth = IPyth(_pyth);
    }

    function setPythContract(address _pyth) external onlyOwner {
        pyth = IPyth(_pyth);
    }

    function setStalenessThreshold(uint256 _threshold) external onlyOwner {
        stalenessThreshold = _threshold;
    }

    function setKeeper(address _keeper) external onlyOwner {
        keeper = _keeper;
    }

    function registerPriceFeed(address token, bytes32 feedId) external onlyOwner {
        priceFeeds[token] = feedId;
    }

    function getPrice(address token) external view returns (uint256) {
        bytes32 feedId = priceFeeds[token];
        require(feedId != bytes32(0), "Oracle: Feed not registered");

        PythStructs.Price memory pythPrice = pyth.getPriceUnsafe(feedId);

        if (pythPrice.publishTime + stalenessThreshold < block.timestamp) {
            revert ErrorLib.StalePrice(token, pythPrice.publishTime, block.timestamp);
        }

        if (pythPrice.price < 0) {
            revert ErrorLib.NegativePrice(token, pythPrice.price);
        }

        uint256 absPrice = uint256(int256(pythPrice.price));
        int32 expo = pythPrice.expo;

        if (expo < 0) {
            uint32 shift = uint32(-expo);
            if (shift <= 18) {
                return absPrice * (10 ** (18 - shift));
            } else {
                return absPrice / (10 ** (shift - 18));
            }
        } else {
            return absPrice * (10 ** (18 + uint32(expo)));
        }
    }

    function updatePrice(bytes[] calldata priceUpdateData) external payable onlyKeeper {
        uint256 fee = pyth.getUpdateFee(priceUpdateData);
        require(msg.value >= fee, "Oracle: Insufficient fee");

        pyth.updatePriceFeeds{value: fee}(priceUpdateData);

        if (msg.value > fee) {
            (bool success, ) = msg.sender.call{value: msg.value - fee}("");
            require(success, "Oracle: Refund failed");
        }
    }

    function getUpdateFee(bytes[] calldata priceUpdateData) external view returns (uint256) {
        return pyth.getUpdateFee(priceUpdateData);
    }
}
