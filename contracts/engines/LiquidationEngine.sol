// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ILiquidationEngine} from "../interfaces/ILiquidationEngine.sol";
import {IOracleAdapter} from "../interfaces/IOracleAdapter.sol";
import {IAssetRegistry, AssetConfig} from "../interfaces/IAssetRegistry.sol";
import {IInterestEngine} from "../interfaces/IInterestEngine.sol";
import {IRiskEngine} from "../interfaces/IRiskEngine.sol";
import {IStabilityPool} from "../interfaces/IStabilityPool.sol";
import {IBorrowVault} from "../interfaces/IBorrowVault.sol";
import {ILendingPool} from "../interfaces/ILendingPool.sol";
import {PositionLib} from "../libraries/PositionLib.sol";
import {ErrorLib} from "../libraries/ErrorLib.sol";
import {MathLib} from "../libraries/MathLib.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract LiquidationEngine is ILiquidationEngine, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IOracleAdapter public oracle;
    IAssetRegistry public registry;
    IInterestEngine public interestEngine;
    IRiskEngine public riskEngine;
    IStabilityPool public stabilityPool;
    IBorrowVault public borrowVault;
    ILendingPool public lendingPool;

    event SoftLiquidation(bytes32 indexed positionId, address liquidator, uint256 debtRepaid, uint256 collateralSeized);
    event HardLiquidation(bytes32 indexed positionId, uint256 debtRepaid, uint256 collateralSeized);

    constructor() Ownable(msg.sender) {}

    function initialize(
        address _oracle,
        address _registry,
        address _interestEngine,
        address _riskEngine,
        address _stabilityPool,
        address _borrowVault,
        address _lendingPool
    ) external onlyOwner {
        oracle = IOracleAdapter(_oracle);
        registry = IAssetRegistry(_registry);
        interestEngine = IInterestEngine(_interestEngine);
        riskEngine = IRiskEngine(_riskEngine);
        stabilityPool = IStabilityPool(_stabilityPool);
        borrowVault = IBorrowVault(_borrowVault);
        lendingPool = ILendingPool(_lendingPool);
    }

    function softLiquidate(bytes32 positionId, uint256 repayAmount) external nonReentrant {
        PositionLib.Position memory pos = borrowVault.getPosition(positionId);
        if (!pos.active) revert ErrorLib.PositionNotActive(positionId);

        uint256 accrued = interestEngine.accrueInterest(positionId);
        uint256 totalDebt = pos.borrowAmount + accrued;

        uint256 collPrice = oracle.getPrice(pos.collateralToken);
        uint256 debtPrice = oracle.getPrice(pos.debtToken);
        
        require(riskEngine.computeHealthFactor(
            MathLib.wadMul(pos.collateralAmount, collPrice),
            MathLib.wadMul(totalDebt, debtPrice),
            pos.collateralToken,
            PositionLib.remainingDuration(pos, block.timestamp),
            block.timestamp > pos.startTime ? block.timestamp - pos.startTime : 0
        ) <= 1e18, "Position is healthy");

        AssetConfig memory config = registry.getConfig(pos.debtToken);
        {
            uint256 maxRepay = MathLib.wadMul(totalDebt, config.closeFactor);
            if (repayAmount > maxRepay) {
                repayAmount = maxRepay;
            }
        }
        if (repayAmount == 0) revert ErrorLib.ZeroAmount();

        uint256 seizeCollateralAmount = MathLib.wadDiv(MathLib.wadMul(MathLib.wadMul(repayAmount, debtPrice), 1e18 + registry.getConfig(pos.collateralToken).liquidationBonus), collPrice);

        if (seizeCollateralAmount > pos.collateralAmount) {
            seizeCollateralAmount = pos.collateralAmount;
        }

        bool closePosition = (repayAmount == totalDebt);

        if (stabilityPool.canAbsorb(pos.debtToken, repayAmount)) {
            stabilityPool.absorbDebt(pos.debtToken, repayAmount, pos.collateralToken, seizeCollateralAmount);
            IERC20(pos.debtToken).safeTransfer(address(lendingPool), repayAmount);
            borrowVault.seizeCollateral(positionId, address(stabilityPool), seizeCollateralAmount, closePosition);
        } else {
            IERC20(pos.debtToken).safeTransferFrom(msg.sender, address(lendingPool), repayAmount);
            borrowVault.seizeCollateral(positionId, msg.sender, seizeCollateralAmount, closePosition);
        }
        
        uint256 principalRepaid;
        if (repayAmount >= totalDebt) {
            principalRepaid = pos.borrowAmount;
        } else if (repayAmount > accrued) {
            principalRepaid = repayAmount - accrued;
        } else {
            principalRepaid = 0;
        }
        
        if (principalRepaid > 0) {
            lendingPool.returnBorrowLiquidity(pos.debtToken, principalRepaid);
        }

        if (closePosition) {
            interestEngine.clearPosition(positionId);
        } else {
            uint256 remainingPrincipal;
            uint256 remainingInterest;
            if (repayAmount >= accrued) {
                remainingInterest = 0;
                remainingPrincipal = pos.borrowAmount - (repayAmount - accrued);
            } else {
                remainingInterest = accrued - repayAmount;
                remainingPrincipal = pos.borrowAmount;
            }
            interestEngine.updateAfterRepay(positionId, remainingPrincipal, remainingInterest);
        }

        emit SoftLiquidation(positionId, msg.sender, repayAmount, seizeCollateralAmount);
    }

    function executeHardLiquidation(bytes32 positionId) external nonReentrant {
        PositionLib.Position memory pos = borrowVault.getPosition(positionId);
        if (!pos.active) return; // Silent return for race condition
        
        require(block.timestamp >= pos.startTime + pos.duration, "Not expired");

        uint256 accrued = interestEngine.accrueInterest(positionId);
        uint256 totalDebt = pos.borrowAmount + accrued;

        AssetConfig memory config = registry.getConfig(pos.debtToken);
        uint256 collPrice = oracle.getPrice(pos.collateralToken);
        uint256 debtPrice = oracle.getPrice(pos.debtToken);
        
        uint256 totalDebtValue = MathLib.wadMul(totalDebt, debtPrice);
        uint256 penaltyDebtValue = MathLib.wadMul(totalDebtValue, config.hardLiqPenalty);
        uint256 requiredValue = totalDebtValue + penaltyDebtValue;
        
        uint256 requiredCollateral = MathLib.wadDiv(requiredValue, collPrice);
        
        if (requiredCollateral > pos.collateralAmount) {
            requiredCollateral = pos.collateralAmount;
        }

        if (stabilityPool.canAbsorb(pos.debtToken, totalDebt)) {
            stabilityPool.absorbDebt(pos.debtToken, totalDebt, pos.collateralToken, requiredCollateral);
            IERC20(pos.debtToken).safeTransfer(address(lendingPool), totalDebt);
            borrowVault.seizeCollateral(positionId, address(stabilityPool), requiredCollateral, true);
        } else {
            // Bad debt socialization
            lendingPool.returnBorrowLiquidity(pos.debtToken, pos.borrowAmount);
            borrowVault.seizeCollateral(positionId, owner(), requiredCollateral, true);
        }
        
        interestEngine.clearPosition(positionId);
        emit HardLiquidation(positionId, totalDebt, requiredCollateral);
    }
}
