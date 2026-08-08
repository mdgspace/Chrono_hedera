// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";

contract PythTestHelper {
    function createUpdateData(
        bytes32 id,
        int64 price,
        int32 expo,
        uint256 publishTime
    ) external pure returns (bytes memory) {
        PythStructs.PriceFeed memory feed;
        feed.id = id;
        feed.price.price = price;
        feed.price.conf = 0;
        feed.price.expo = expo;
        feed.price.publishTime = publishTime;
        return abi.encode(feed);
    }
}
