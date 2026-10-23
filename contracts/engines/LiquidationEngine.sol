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
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

contract LiquidationEngine is ILiquidationEngine, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IOracleAdapter public oracle;
    IAssetRegistry public registry;
    IInterestEngine public interestEngine;
    IRiskEngine public riskEngine;
    IStabilityPool public stabilityPool;
    IBorrowVault public borrowVault;
    ILendingPool public lendingPool;
    bool public initialized;

    uint256 public constant GRACE_PERIOD = 900; // 15 minutes
    uint256 public constant AUCTION_PHASE1 = 15 minutes; // oracle price -> floor price
    uint256 public constant AUCTION_DURATION = 45 minutes; // then floor price -> 0 over 30 minutes
    uint256 public constant HF_TARGET = 1.05e18; // soft liquidation restores HF to this
    uint256 public constant SP_MIN_HF = 0.85e18; // below this the Stability Pool never absorbs

    /// @dev Prices are debt tokens per collateral token (WAD), snapshotted from the oracle at start.
    struct Auction {
        uint40 startedAt;
        uint128 collateral;
        uint128 debt;
        uint128 penalty;
        uint128 principal;
        uint128 startPrice;
        uint128 floorPrice;
    }

    mapping(bytes32 => Auction) public auctions;

    event SoftLiquidation(bytes32 indexed positionId, address liquidator, uint256 debtRepaid, uint256 collateralSeized);
    event HardLiquidation(bytes32 indexed positionId, uint256 debtRepaid, uint256 collateralSeized);
    event AuctionStarted(bytes32 indexed positionId, uint256 startPrice, uint256 floorPrice, uint256 debt, uint256 penalty, uint256 collateral);
    event AuctionSettled(bytes32 indexed positionId, address indexed bidder, uint256 paid, uint256 toLender, uint256 toPenalty, uint256 toBorrower, uint256 shortfall);
    event AuctionExpired(bytes32 indexed positionId, uint256 shortfall);

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
        require(!initialized, "LiquidationEngine already initialized");
        require(_oracle != address(0) && _registry != address(0) && _interestEngine != address(0)
            && _riskEngine != address(0) && _stabilityPool != address(0)
            && _borrowVault != address(0) && _lendingPool != address(0), "Zero dependency");
        initialized = true;
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

        interestEngine.accrueInterest(positionId);
        uint256 totalDebt = interestEngine.getTotalDebt(positionId);
        uint256 accrued = totalDebt - pos.borrowAmount;

        uint256 collPrice = oracle.getPrice(pos.collateralToken);
        uint256 debtPrice = oracle.getPrice(pos.debtToken);
        uint256 remaining = PositionLib.remainingDuration(pos, block.timestamp);
        uint256 elapsed = block.timestamp > pos.startTime ? block.timestamp - pos.startTime : 0;

        uint256 hf = riskEngine.computeHealthFactor(
            MathLib.wadMul(pos.collateralAmount, collPrice),
            MathLib.wadMul(totalDebt, debtPrice),
            pos.collateralToken,
            remaining,
            elapsed
        );
        require(hf <= 1e18, "Position is healthy");

        // Repay only what lifts HF back to HF_TARGET, seizing at the HF-indexed bonus.
        uint256 beta = MathLib.dynamicBonus(hf);
        {
            uint256 dStar = MathLib.computeDStar(
                totalDebt,
                pos.collateralAmount,
                collPrice,
                debtPrice,
                riskEngine.computeLiquidationThreshold(pos.collateralToken, remaining, elapsed),
                HF_TARGET,
                beta
            );
            if (repayAmount > dStar) {
                repayAmount = dStar;
            }
        }
        if (repayAmount == 0) revert ErrorLib.ZeroAmount();

        uint256 seizeCollateralAmount = MathLib.wadDiv(MathLib.wadMul(MathLib.wadMul(repayAmount, debtPrice), 1e18 + beta), collPrice);

        if (seizeCollateralAmount > pos.collateralAmount) {
            seizeCollateralAmount = pos.collateralAmount;
        }

        bool closePosition = (repayAmount == totalDebt);

        // The pool absorbs only in the HF band [0.85, 1], and keeps enough back for maturities
        // in the next 48 h (forward reserve watermark). Everything else goes to the keeper.
        if (hf >= SP_MIN_HF && stabilityPool.canAbsorb(pos.debtToken, repayAmount + borrowVault.reservedDebt(pos.debtToken))) {
            stabilityPool.absorbDebt(pos.debtToken, repayAmount, pos.collateralToken, seizeCollateralAmount);
            IERC20(pos.debtToken).safeTransfer(address(lendingPool), repayAmount);
            borrowVault.seizeCollateral(positionId, address(stabilityPool), seizeCollateralAmount, 0, closePosition, closePosition);
        } else {
            IERC20(pos.debtToken).safeTransferFrom(msg.sender, address(lendingPool), repayAmount);
            borrowVault.seizeCollateral(positionId, msg.sender, seizeCollateralAmount, 0, closePosition, closePosition);
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
            if (principalRepaid > 0) borrowVault.reducePrincipal(positionId, principalRepaid);
        }

        emit SoftLiquidation(positionId, msg.sender, repayAmount, seizeCollateralAmount);
    }

    function executeHardLiquidation(bytes32 positionId) external nonReentrant {
        PositionLib.Position memory pos = borrowVault.getPosition(positionId);
        if (!pos.active) return; // Silent return for race condition
        
        require(block.timestamp >= pos.startTime + pos.duration + GRACE_PERIOD, "In grace period or not expired");

        interestEngine.accrueInterest(positionId);
        uint256 totalDebt = interestEngine.getTotalDebt(positionId);

        AssetConfig memory debtConfig = registry.getConfig(pos.debtToken);
        uint256 collPrice = oracle.getPrice(pos.collateralToken);
        uint256 debtPrice = oracle.getPrice(pos.debtToken);
        
        // Step 1: Compute Debt & Collateral Values
        uint256 totalDebtValue = MathLib.wadMul(totalDebt, debtPrice);
        uint256 totalCollValue = MathLib.wadMul(pos.collateralAmount, collPrice);
        
        // Step 2: Calibrated Default Penalty = max(12% debt, 2.5% coll floor)
        uint256 penDebtVal = MathLib.wadMul(totalDebtValue, debtConfig.hardLiqPenalty);
        uint256 penFloorVal = MathLib.wadMul(totalCollValue, debtConfig.hardLiqCollateralFloor);
        uint256 penaltyValue = penDebtVal > penFloorVal ? penDebtVal : penFloorVal;

        // The pool absorbs only debt it can cover against collateral worth at least that debt.
        // Everything else is sold in a public Dutch auction.
        if (totalCollValue < totalDebtValue || !stabilityPool.canAbsorb(pos.debtToken, totalDebt)) {
            _startAuction(positionId, pos, totalDebt, MathLib.wadDiv(penaltyValue, debtPrice), MathLib.wadDiv(collPrice, debtPrice));
            return;
        }

        // Step 3: Collateral Sizing & Tranche Split
        uint256 debtCollateral = MathLib.wadDiv(totalDebtValue, collPrice);
        uint256 penaltyCollateral = MathLib.wadDiv(penaltyValue, collPrice);
        
        uint256 requiredCollateral = debtCollateral + penaltyCollateral;
        if (requiredCollateral > pos.collateralAmount) {
            requiredCollateral = pos.collateralAmount;
            if (debtCollateral > requiredCollateral) {
                debtCollateral = requiredCollateral;
                penaltyCollateral = 0;
            } else {
                penaltyCollateral = requiredCollateral - debtCollateral;
            }
        }
        
        uint256 spPenaltyCollateral = MathLib.wadMul(penaltyCollateral, debtConfig.stabilityPoolPenaltyShare);
        uint256 reservePenaltyCollateral = penaltyCollateral - spPenaltyCollateral;
        uint256 spTotalCollateral = debtCollateral + spPenaltyCollateral;

        // Step 4: Stability Pool settlement; LendingPool made 100% whole
        stabilityPool.absorbDebt(pos.debtToken, totalDebt, pos.collateralToken, spTotalCollateral);
        IERC20(pos.debtToken).safeTransfer(address(lendingPool), totalDebt);
        lendingPool.returnBorrowLiquidity(pos.debtToken, pos.borrowAmount);

        // Remit surplus to borrower (refundToBorrower = true)
        borrowVault.seizeCollateral(
            positionId,
            address(stabilityPool),
            spTotalCollateral,
            reservePenaltyCollateral,
            true,
            true
        );

        interestEngine.clearPosition(positionId);
        emit HardLiquidation(positionId, totalDebt, requiredCollateral);
    }

    /// @notice Buys all of an auctioned position's collateral at the current price, paid in the debt token.
    function bid(bytes32 positionId) external nonReentrant {
        Auction memory a = auctions[positionId];
        uint256 price = _auctionPrice(positionId, a);
        delete auctions[positionId];

        PositionLib.Position memory pos = borrowVault.getPosition(positionId);
        uint256 paid = Math.mulDiv(a.collateral, price, MathLib.WAD);
        uint256 toLender = Math.min(paid, a.debt);
        uint256 toPenalty = Math.min(paid - toLender, a.penalty);
        uint256 toBorrower = paid - toLender - toPenalty;

        IERC20 debtToken = IERC20(pos.debtToken);
        if (toLender > 0) debtToken.safeTransferFrom(msg.sender, address(lendingPool), toLender);
        if (toPenalty > 0) debtToken.safeTransferFrom(msg.sender, borrowVault.protocolTreasury(), toPenalty);
        if (toBorrower > 0) debtToken.safeTransferFrom(msg.sender, pos.borrower, toBorrower);
        // Same books as the pool path: principal leaves totalBorrowed, interest stays with lenders.
        if (a.principal > 0) lendingPool.returnBorrowLiquidity(pos.debtToken, a.principal);
        IERC20(pos.collateralToken).safeTransfer(msg.sender, a.collateral);

        emit AuctionSettled(positionId, msg.sender, paid, toLender, toPenalty, toBorrower, a.debt - toLender);
    }

    /// @notice After 45 minutes without a bid: collateral to the treasury, principal written off.
    function expireAuction(bytes32 positionId) external nonReentrant {
        Auction memory a = auctions[positionId];
        if (a.startedAt == 0) revert ErrorLib.NoAuction(positionId);
        require(block.timestamp >= a.startedAt + AUCTION_DURATION, "Auction still running");
        delete auctions[positionId];

        PositionLib.Position memory pos = borrowVault.getPosition(positionId);
        if (a.principal > 0) lendingPool.returnBorrowLiquidity(pos.debtToken, a.principal);
        IERC20(pos.collateralToken).safeTransfer(borrowVault.protocolTreasury(), a.collateral);

        emit AuctionExpired(positionId, a.debt);
    }

    function auctionPrice(bytes32 positionId) external view returns (uint256) {
        return _auctionPrice(positionId, auctions[positionId]);
    }

    function _startAuction(
        bytes32 positionId,
        PositionLib.Position memory pos,
        uint256 debt,
        uint256 penalty,
        uint256 startPrice
    ) internal {
        uint256 collateral = pos.collateralAmount;
        // Lowest price that still covers debt + penalty, rounded up so a Phase 1 fill never leaves dust.
        uint256 floorPrice = collateral == 0
            ? type(uint256).max
            : Math.mulDiv(debt + penalty, MathLib.WAD, collateral, Math.Rounding.Ceil);
        uint256 startedAt = block.timestamp;
        if (floorPrice > startPrice) {
            // Distressed: collateral cannot cover debt + penalty at the oracle price, so skip Phase 1.
            floorPrice = startPrice;
            startedAt -= AUCTION_PHASE1;
        }

        auctions[positionId] = Auction({
            startedAt: SafeCast.toUint40(startedAt),
            collateral: SafeCast.toUint128(collateral),
            debt: SafeCast.toUint128(debt),
            penalty: SafeCast.toUint128(penalty),
            principal: SafeCast.toUint128(pos.borrowAmount),
            startPrice: SafeCast.toUint128(startPrice),
            floorPrice: SafeCast.toUint128(floorPrice)
        });

        // Engine takes custody of all collateral; the vault closes the position and cancels its HSS job.
        borrowVault.seizeCollateral(positionId, address(this), collateral, 0, true, false);
        interestEngine.clearPosition(positionId);
        emit AuctionStarted(positionId, startPrice, floorPrice, debt, penalty, collateral);
    }

    function _auctionPrice(bytes32 positionId, Auction memory a) internal view returns (uint256) {
        if (a.startedAt == 0) revert ErrorLib.NoAuction(positionId);
        uint256 elapsed = block.timestamp - a.startedAt;
        if (elapsed >= AUCTION_DURATION) revert ErrorLib.AuctionEnded(positionId);
        uint256 start = a.startPrice;
        uint256 floor = a.floorPrice;
        if (elapsed < AUCTION_PHASE1) return start - (start - floor) * elapsed / AUCTION_PHASE1;
        return floor - floor * (elapsed - AUCTION_PHASE1) / (AUCTION_DURATION - AUCTION_PHASE1);
    }
}
