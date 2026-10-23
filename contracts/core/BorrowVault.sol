// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IBorrowVault} from "../interfaces/IBorrowVault.sol";
import {IAssetRegistry, AssetConfig} from "../interfaces/IAssetRegistry.sol";
import {IRiskEngine} from "../interfaces/IRiskEngine.sol";
import {IOracleAdapter} from "../interfaces/IOracleAdapter.sol";
import {ILendingPool} from "../interfaces/ILendingPool.sol";
import {IInterestEngine} from "../interfaces/IInterestEngine.sol";
import {ILiquidationScheduler} from "../interfaces/ILiquidationScheduler.sol";
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
    ILiquidationScheduler public schedulerEngine;

    address public liquidationEngine;
    bool public initialized;

    uint256 public nextPositionId = 1;
    mapping(bytes32 => PositionLib.Position) private _positions;

    uint256 public constant PROTOCOL_FEE = 0.10e18; // 10% of accrued interest
    uint256 public constant GRACE_PERIOD = 900; // 15 minutes
    uint256 public constant LATE_GRACE_FEE = 0.015e18; // 1.5%
    uint256 public constant MAX_BORROW_DURATION = 365 days;
    uint256 public constant RESERVE_LOOKBACK = 2 hours;
    uint256 public constant RESERVE_HORIZON = 48 hours;

    // debtToken => (expiry / 1 hours) => principal of fixed-term loans maturing in that hour
    mapping(address => mapping(uint256 => uint256)) private _scheduledDebt;

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
        require(!initialized, "BorrowVault already initialized");
        require(_registry != address(0) && _riskEngine != address(0) && _oracle != address(0)
            && _lendingPool != address(0) && _interestEngine != address(0)
            && _schedulerEngine != address(0) && _liquidationEngine != address(0), "Zero dependency");
        initialized = true;
        registry = IAssetRegistry(_registry);
        riskEngine = IRiskEngine(_riskEngine);
        oracle = IOracleAdapter(_oracle);
        lendingPool = ILendingPool(_lendingPool);
        interestEngine = IInterestEngine(_interestEngine);
        schedulerEngine = ILiquidationScheduler(_schedulerEngine);
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

        if (durationSeconds > MAX_BORROW_DURATION) {
            revert ErrorLib.DurationExceedsScheduleLimit(durationSeconds, MAX_BORROW_DURATION);
        }

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

        // The scheduler checks the stored position. Any failure still reverts the
        // entire borrow, including token transfers and this storage write.
        _positions[positionId] = PositionLib.Position({
            id: positionId,
            borrower: onBehalfOf,
            collateralToken: collateralToken,
            debtToken: debtToken,
            collateralAmount: collateralAmount,
            borrowAmount: borrowAmount,
            startTime: block.timestamp,
            duration: durationSeconds,
            scheduledTxAddress: address(0),
            active: true
        });

        // Infinite-duration loans (duration 0) have no maturity to reserve for.
        if (durationSeconds != 0) _scheduledDebt[debtToken][expiry / 1 hours] += borrowAmount;

        interestEngine.initPosition(positionId, debtToken, borrowAmount);
        _positions[positionId].scheduledTxAddress = schedulerEngine.scheduleHardLiquidation(positionId, expiry);

        emit PositionOpened(positionId, onBehalfOf, collateralToken, debtToken);
    }

    function repay(bytes32 positionId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ErrorLib.ZeroAmount();
        PositionLib.Position storage pos = _positions[positionId];
        if (!pos.active) revert ErrorLib.PositionNotActive(positionId);
        // We do not strictly enforce msg.sender == pos.borrower, anyone can repay for the borrower

        interestEngine.accrueInterest(positionId);
        uint256 totalDebt = interestEngine.getTotalDebt(positionId);
        uint256 accrued = totalDebt - pos.borrowAmount;

        if (block.timestamp > pos.startTime + pos.duration && block.timestamp <= pos.startTime + pos.duration + GRACE_PERIOD) {
            uint256 graceFee = MathLib.wadMul(totalDebt, LATE_GRACE_FEE);
            if (graceFee > 0) {
                IERC20(pos.debtToken).safeTransferFrom(msg.sender, protocolTreasury(), graceFee);
                emit ProtocolFeeCollected(positionId, protocolTreasury(), graceFee);
            }
        }

        if (amount > totalDebt) {
            amount = totalDebt;
        }

        uint256 principalRepaid;
        if (amount >= totalDebt) {
            principalRepaid = pos.borrowAmount;
        } else if (amount > accrued) {
            principalRepaid = amount - accrued;
        } else {
            principalRepaid = 0;
        }

        uint256 interestRepaid = amount - principalRepaid;
        uint256 protocolCut = (interestRepaid * PROTOCOL_FEE) / 1e18;

        // Pay debt back: protocol fee to treasury, lender share to LendingPool
        if (protocolCut > 0) {
            IERC20(pos.debtToken).safeTransferFrom(msg.sender, protocolTreasury(), protocolCut);
            emit ProtocolFeeCollected(positionId, protocolTreasury(), protocolCut);
        }

        uint256 lenderShare = amount - protocolCut;
        if (lenderShare > 0) {
            IERC20(pos.debtToken).safeTransferFrom(msg.sender, address(lendingPool), lenderShare);
        }
        
        if (principalRepaid > 0) {
            lendingPool.returnBorrowLiquidity(pos.debtToken, principalRepaid);
        }
        _unschedule(pos, principalRepaid);

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

    /// @notice Keeps the vault principal in step with the InterestEngine after a partial soft liquidation.
    function reducePrincipal(bytes32 positionId, uint256 principalRepaid) external onlyLiquidationEngine nonReentrant {
        PositionLib.Position storage pos = _positions[positionId];
        if (!pos.active) revert ErrorLib.PositionNotActive(positionId);
        pos.borrowAmount -= principalRepaid;
        _unschedule(pos, principalRepaid);
    }

    /// @notice Principal maturing between 2 h ago and 48 h from now, which the stability pool should hold back.
    function reservedDebt(address debtToken) external view returns (uint256 total) {
        // ponytail: principal only, so accrued interest is under-reserved, and an expiry whose hard liquidation
        // has not run within the 2 h lookback stops being reserved. Add an interest margin or a pending-expiry
        // tally if either gap shows up in practice.
        uint256 last = (block.timestamp + RESERVE_HORIZON) / 1 hours;
        for (uint256 b = (block.timestamp - RESERVE_LOOKBACK) / 1 hours; b <= last; b++) {
            total += _scheduledDebt[debtToken][b];
        }
    }

    function seizeCollateral(
        bytes32 positionId,
        address liquidator,
        uint256 collateralToLiquidator,
        uint256 collateralToReserve,
        bool closePosition,
        bool refundToBorrower
    ) external onlyLiquidationEngine nonReentrant {
        _executeSeizeCollateral(positionId, liquidator, collateralToLiquidator, collateralToReserve, closePosition, refundToBorrower);
    }

    function seizeCollateral(
        bytes32 positionId,
        address liquidator,
        uint256 collateralAmount,
        bool closePosition
    ) external onlyLiquidationEngine nonReentrant {
        _executeSeizeCollateral(positionId, liquidator, collateralAmount, 0, closePosition, true);
    }

    function _executeSeizeCollateral(
        bytes32 positionId,
        address liquidator,
        uint256 collateralToLiquidator,
        uint256 collateralToReserve,
        bool closePosition,
        bool refundToBorrower
    ) internal {
        PositionLib.Position storage pos = _positions[positionId];
        if (!pos.active) revert ErrorLib.PositionNotActive(positionId);

        uint256 totalSeize = collateralToLiquidator + collateralToReserve;
        if (totalSeize > pos.collateralAmount) {
            totalSeize = pos.collateralAmount;
            if (collateralToLiquidator > totalSeize) {
                collateralToLiquidator = totalSeize;
                collateralToReserve = 0;
            } else {
                collateralToReserve = totalSeize - collateralToLiquidator;
            }
        }
        pos.collateralAmount -= totalSeize;

        if (collateralToLiquidator > 0) {
            IERC20(pos.collateralToken).safeTransfer(liquidator, collateralToLiquidator);
        }
        if (collateralToReserve > 0) {
            IERC20(pos.collateralToken).safeTransfer(protocolTreasury(), collateralToReserve);
        }

        if (closePosition) {
            pos.active = false;
            _unschedule(pos, pos.borrowAmount);
            schedulerEngine.cancelSchedule(positionId);
            if (refundToBorrower && pos.collateralAmount > 0) {
                uint256 refundAmount = pos.collateralAmount;
                pos.collateralAmount = 0;
                IERC20(pos.collateralToken).safeTransfer(pos.borrower, refundAmount);
            }
        }
    }

    function _unschedule(PositionLib.Position storage pos, uint256 principal) internal {
        if (pos.duration == 0 || principal == 0) return;
        _scheduledDebt[pos.debtToken][(pos.startTime + pos.duration) / 1 hours] -= principal;
    }

    function protocolTreasury() public view returns (address) {
        return owner();
    }
}
