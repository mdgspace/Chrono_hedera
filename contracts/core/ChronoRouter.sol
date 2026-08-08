// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IChronoRouter} from "../interfaces/IChronoRouter.sol";
import {IOracleAdapter} from "../interfaces/IOracleAdapter.sol";
import {IBorrowVault} from "../interfaces/IBorrowVault.sol";
import {ILendingPool} from "../interfaces/ILendingPool.sol";

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract ChronoRouter is IChronoRouter, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IOracleAdapter public oracle;
    IBorrowVault public borrowVault;
    ILendingPool public lendingPool;

    constructor() Ownable(msg.sender) {}

    function initialize(
        address _oracle,
        address _borrowVault,
        address _lendingPool
    ) external onlyOwner {
        oracle = IOracleAdapter(_oracle);
        borrowVault = IBorrowVault(_borrowVault);
        lendingPool = ILendingPool(_lendingPool);
    }


    function openPositionWithPriceUpdate(
        bytes[] calldata priceUpdateData,
        address collateralToken,
        address debtToken,
        uint256 collateralAmount,
        uint256 borrowAmount,
        uint256 durationSeconds
    ) external payable nonReentrant returns (bytes32 positionId) {
        if (priceUpdateData.length > 0) {
            oracle.updatePrice{value: msg.value}(collateralToken, priceUpdateData);
        }

        IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), collateralAmount);
        IERC20(collateralToken).safeIncreaseAllowance(address(borrowVault), collateralAmount);

        positionId = borrowVault.openPosition(
            msg.sender, // onBehalfOf
            collateralToken,
            debtToken,
            collateralAmount,
            borrowAmount,
            durationSeconds
        );
        
        // borrowVault sends borrowed debt tokens to its msg.sender (this router)
        // Router forwards them to the user
        IERC20(debtToken).safeTransfer(msg.sender, borrowAmount);
    }

    function depositWithPriceUpdate(
        bytes[] calldata priceUpdateData,
        address token,
        uint256 amount
    ) external payable nonReentrant returns (uint256 shares) {
        if (priceUpdateData.length > 0) {
            oracle.updatePrice{value: msg.value}(token, priceUpdateData);
        }

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(token).safeIncreaseAllowance(address(lendingPool), amount);
        
        shares = lendingPool.deposit(token, amount, msg.sender);
    }

    function repayWithPriceUpdate(
        bytes[] calldata priceUpdateData,
        bytes32 positionId,
        uint256 amount
    ) external payable nonReentrant {
        address debtToken = borrowVault.getPosition(positionId).debtToken;
        
        if (priceUpdateData.length > 0) {
            oracle.updatePrice{value: msg.value}(debtToken, priceUpdateData);
        }

        IERC20(debtToken).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(debtToken).safeIncreaseAllowance(address(borrowVault), amount);

        borrowVault.repay(positionId, amount);

        // Refund any unspent debt tokens
        uint256 remaining = IERC20(debtToken).allowance(address(this), address(borrowVault));
        if (remaining > 0) {
            IERC20(debtToken).safeDecreaseAllowance(address(borrowVault), remaining);
            IERC20(debtToken).safeTransfer(msg.sender, remaining);
        }
    }
}
