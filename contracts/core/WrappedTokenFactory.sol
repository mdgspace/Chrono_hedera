// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {HederaTokenService} from "@hiero-ledger/hiero-contracts/token-service/HederaTokenService.sol";
import {KeyHelper} from "@hiero-ledger/hiero-contracts/token-service/KeyHelper.sol";
import {ExpiryHelper} from "@hiero-ledger/hiero-contracts/token-service/ExpiryHelper.sol";
import {HederaResponseCodes} from "@hiero-ledger/hiero-contracts/common/HederaResponseCodes.sol";
import {IHederaTokenService} from "@hiero-ledger/hiero-contracts/token-service/IHederaTokenService.sol";

contract WrappedTokenFactory is HederaTokenService, KeyHelper, ExpiryHelper {
    mapping(string => address) public tokens;
    
    event TokenCreated(string symbol, address tokenAddress);

    function createWrappedToken(
        string memory name,
        string memory symbol,
        uint32 decimals,
        uint256 initialSupply
    ) external payable returns (address) {
        IHederaTokenService.HederaToken memory token;
        token.name = name;
        token.symbol = symbol;
        token.treasury = address(this);
        token.expiry = createAutoRenewExpiry(address(this), 7776000); // 90 days

        IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](1);
        keys[0] = getSingleKey(KeyType.SUPPLY, KeyValueType.CONTRACT_ID, address(this));
        token.tokenKeys = keys;

        (int responseCode, address created) = createFungibleToken(token, int64(int256(initialSupply)), int32(uint32(decimals)));
        require(responseCode == HederaResponseCodes.SUCCESS, "Token creation failed");

        tokens[symbol] = created;
        emit TokenCreated(symbol, created);
        
        return created;
    }

    function transferTokens(address token, address to, uint256 amount) external {
        // Simple helper for testnet distribution
        int responseCode = transferToken(token, address(this), to, int64(uint64(amount)));
        require(responseCode == HederaResponseCodes.SUCCESS, "Transfer failed");
    }
}
