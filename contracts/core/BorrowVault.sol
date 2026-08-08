// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IBorrowVault} from "../interfaces/IBorrowVault.sol";
import {IAssetRegistry, AssetConfig} from "../interfaces/IAssetRegistry.sol";
import {IRiskEngine} from "../interfaces/IRiskEngine.sol";
import {IOracleAdapter} from "../interfaces/IOracleAdapter.sol";
import {ILendingPool} from "../interfaces/ILendingPool.sol";
import {IInterestEngine} from "../interfaces/IInterestEngine.sol";
import {ISchedulerEngine} from "../interfaces/ISchedulerEngine.sol";
import {PositionLib} from "../libraries/PositionLib.sol";
import {ErrorLib} from "../libraries/ErrorLib.sol";
import {MathLib} from "../libraries/MathLib.sol";

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract BorrowVault is IBorrowVault, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IAssetRegistry public registry;
    IRiskEngine public riskEngine;
    IOracleAdapter public oracle;
    ILendingPool public lendingPool;
    IInterestEngine public interestEngine;
    ISchedulerEngine public schedulerEngine;

    address public liquidationEngine;

    uint256 public nextPositionId = 1;
    mapping(bytes32 => PositionLib.Position) private _positions;

    event PositionOpened(bytes32 indexed positionId, address indexed borrower, address collateralToken, address debtToken);
    event Repaid(bytes32 indexed positionId, uint256 amount);
    event CollateralToppedUp(bytes32 indexed positionId, uint256 amount);

    constructor() Ownable(msg.sender) {}

    function initialize(
        address _registry,
        address _riskEngine,
        address _oracle,
        address _lendingPool,
        address _interestEngine,
        address _schedulerEngine,
        address _liquidationEngine
    ) external onlyOwner {
        registry = IAssetRegistry(_registry);
        riskEngine = IRiskEngine(_riskEngine);
        oracle = IOracleAdapter(_oracle);
        lendingPool = ILendingPool(_lendingPool);
        interestEngine = IInterestEngine(_interestEngine);
        schedulerEngine = ISchedulerEngine(_schedulerEngine);
        liquidationEngine = _liquidationEngine;
    }

    modifier onlyLiquidationEngine() {
        if (msg.sender != liquidationEngine) revert ErrorLib.Unauthorized(msg.sender, liquidationEngine);
        _;
    }

    function getPosition(bytes32 positionId) external view returns (PositionLib.Position memory) {
        return _positions[positionId];
    }

    function openPosition(
        address onBehalfOf,
        address collateralToken,
        address debtToken,
        uint256 collateralAmount,
        uint256 borrowAmount,
        uint256 durationSeconds
    ) external nonReentrant returns (bytes32 positionId) {
        if (!registry.isSupported(collateralToken)) revert ErrorLib.AssetNotSupported(collateralToken);
        if (!registry.isSupported(debtToken)) revert ErrorLib.AssetNotSupported(debtToken);
        if (collateralAmount == 0 || borrowAmount == 0) revert ErrorLib.ZeroAmount();

        uint256 maxLtv = riskEngine.computeMaxLTV(collateralToken, durationSeconds);
        
        uint256 collPrice = oracle.getPrice(collateralToken);
        uint256 debtPrice = oracle.getPrice(debtToken);

        uint256 requestedLtv = MathLib.wadDiv(MathLib.wadMul(borrowAmount, debtPrice), MathLib.wadMul(collateralAmount, collPrice));
        if (requestedLtv > maxLtv) revert ErrorLib.InsufficientLTV(requestedLtv, maxLtv);

        IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), collateralAmount);
        
        // This transfers borrowAmount of debtToken from LendingPool to BorrowVault
        lendingPool.reserveBorrowLiquidity(debtToken, borrowAmount);
        
        // Then we transfer to the user
        IERC20(debtToken).safeTransfer(msg.sender, borrowAmount);

        positionId = bytes32(nextPositionId++);
        
        uint256 expiry = block.timestamp + durationSeconds;
        address scheduleAddr = schedulerEngine.scheduleHardLiquidation(positionId, expiry);

        _positions[positionId] = PositionLib.Position({
            id: positionId,
            borrower: onBehalfOf,
            collateralToken: collateralToken,
            debtToken: debtToken,
            collateralAmount: collateralAmount,
            borrowAmount: borrowAmount,
            startTime: block.timestamp,
            duration: durationSeconds,
            scheduledTxAddress: scheduleAddr,
            active: true
        });

        interestEngine.initPosition(positionId, debtToken, borrowAmount);

        emit PositionOpened(positionId, onBehalfOf, collateralToken, debtToken);
    }

    function repay(bytes32 positionId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ErrorLib.ZeroAmount();
        PositionLib.Position storage pos = _positions[positionId];
        if (!pos.active) revert ErrorLib.PositionNotActive(positionId);
        // We do not strictly enforce msg.sender == pos.borrower, anyone can repay for the borrower

        uint256 accrued = interestEngine.accrueInterest(positionId);
        uint256 totalDebt = pos.borrowAmount + accrued;

        if (amount > totalDebt) {
            amount = totalDebt;
        }

        // Pay debt back to LendingPool
        IERC20(pos.debtToken).safeTransferFrom(msg.sender, address(lendingPool), amount);
        lendingPool.returnBorrowLiquidity(pos.debtToken, amount);

        if (amount == totalDebt) {
            // Full repay
            uint256 returnCollateral = pos.collateralAmount;
            pos.collateralAmount = 0;
            pos.borrowAmount = 0;
            pos.active = false;
            
            interestEngine.clearPosition(positionId);
            schedulerEngine.cancelSchedule(positionId);

            IERC20(pos.collateralToken).safeTransfer(pos.borrower, returnCollateral);
        } else {
            // Partial repay
            uint256 remainingPrincipal;
            uint256 remainingInterest;
            if (amount >= accrued) {
                remainingInterest = 0;
                uint256 principalRepaid = amount - accrued;
                pos.borrowAmount -= principalRepaid;
                remainingPrincipal = pos.borrowAmount;
            } else {
                remainingInterest = accrued - amount;
                remainingPrincipal = pos.borrowAmount;
            }
            interestEngine.updateAfterRepay(positionId, remainingPrincipal, remainingInterest);
        }

        emit Repaid(positionId, amount);
    }

    function topUpCollateral(bytes32 positionId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ErrorLib.ZeroAmount();
        PositionLib.Position storage pos = _positions[positionId];
        if (!pos.active) revert ErrorLib.PositionNotActive(positionId);

        IERC20(pos.collateralToken).safeTransferFrom(msg.sender, address(this), amount);
        pos.collateralAmount += amount;

        emit CollateralToppedUp(positionId, amount);
    }

    function seizeCollateral(bytes32 positionId, address liquidator, uint256 collateralAmount, bool closePosition) external onlyLiquidationEngine nonReentrant {
        PositionLib.Position storage pos = _positions[positionId];
        if (!pos.active) revert ErrorLib.PositionNotActive(positionId);

        if (collateralAmount > pos.collateralAmount) {
            collateralAmount = pos.collateralAmount;
        }
        pos.collateralAmount -= collateralAmount;

        if (closePosition) {
            pos.active = false;
            schedulerEngine.cancelSchedule(positionId);
            if (pos.collateralAmount > 0) {
                IERC20(pos.collateralToken).safeTransfer(pos.borrower, pos.collateralAmount);
                pos.collateralAmount = 0;
            }
        }

        if (collateralAmount > 0) {
            IERC20(pos.collateralToken).safeTransfer(liquidator, collateralAmount);
        }
    }
}
