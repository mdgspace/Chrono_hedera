// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IStabilityPool} from "../interfaces/IStabilityPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MathLib} from "../libraries/MathLib.sol";
import {ErrorLib} from "../libraries/ErrorLib.sol";

contract StabilityPool is IStabilityPool, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // debtToken -> scale (WAD)
    mapping(address => uint256) public depositScale;

    // debtToken -> total scaled deposits
    mapping(address => uint256) public totalScaledDeposits;
    
    // debtToken -> provider -> scaled deposit amount
    mapping(address => mapping(address => uint256)) public providerScaledDeposits;

    // debtToken -> collToken -> cumulative reward per scaled deposit (WAD)
    mapping(address => mapping(address => uint256)) public cumulativeRewardPerDeposit;

    // debtToken -> provider -> collToken -> last seen cumulative reward
    mapping(address => mapping(address => mapping(address => uint256))) public lastSeenRewardPerDeposit;

    // debtToken -> provider -> collToken -> pending claimable rewards
    mapping(address => mapping(address => mapping(address => uint256))) public pendingRewards;

    // debtToken -> array of collateral tokens that have been absorbed
    mapping(address => address[]) public absorbedCollateralTokens;
    // debtToken -> collToken -> is in array
    mapping(address => mapping(address => bool)) public hasAbsorbedToken;

    address public liquidationEngine;

    event Deposited(address indexed provider, address indexed debtToken, uint256 amount);
    event Withdrawn(address indexed provider, address indexed debtToken, uint256 amount);
    event DebtAbsorbed(address indexed debtToken, uint256 debtAmount, address indexed collateralToken, uint256 collateralAmount);
    event RewardsClaimed(address indexed provider, address indexed debtToken, address indexed collateralToken, uint256 amount);

    constructor() Ownable(msg.sender) {}

    modifier onlyLiquidationEngine() {
        if (msg.sender != liquidationEngine) {
            revert ErrorLib.Unauthorized(msg.sender, liquidationEngine);
        }
        _;
    }

    function setLiquidationEngine(address _liquidationEngine) external onlyOwner {
        liquidationEngine = _liquidationEngine;
    }

    function _updateRewards(address debtToken, address provider) internal {
        address[] memory collTokens = absorbedCollateralTokens[debtToken];
        uint256 scaledDep = providerScaledDeposits[debtToken][provider];
        
        for (uint256 i = 0; i < collTokens.length; i++) {
            address collToken = collTokens[i];
            uint256 cumulative = cumulativeRewardPerDeposit[debtToken][collToken];
            uint256 lastSeen = lastSeenRewardPerDeposit[debtToken][provider][collToken];
            
            if (cumulative > lastSeen) {
                uint256 newReward = MathLib.wadMul(scaledDep, cumulative - lastSeen);
                pendingRewards[debtToken][provider][collToken] += newReward;
                lastSeenRewardPerDeposit[debtToken][provider][collToken] = cumulative;
            }
        }
    }

    function _initScale(address debtToken) internal {
        if (depositScale[debtToken] == 0) {
            depositScale[debtToken] = 1e18; // WAD
        }
    }

    function deposit(address debtToken, uint256 amount) external nonReentrant {
        if (amount == 0) revert ErrorLib.ZeroAmount();
        _initScale(debtToken);
        _updateRewards(debtToken, msg.sender);

        uint256 scaledAmount = MathLib.wadDiv(amount, depositScale[debtToken]);
        
        totalScaledDeposits[debtToken] += scaledAmount;
        providerScaledDeposits[debtToken][msg.sender] += scaledAmount;
        
        IERC20(debtToken).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, debtToken, amount);
    }

    function withdraw(address debtToken, uint256 amount) external nonReentrant {
        if (amount == 0) revert ErrorLib.ZeroAmount();
        _initScale(debtToken);
        _updateRewards(debtToken, msg.sender);

        uint256 scaledAmount = MathLib.wadDiv(amount, depositScale[debtToken]);
        uint256 userScaledDeposit = providerScaledDeposits[debtToken][msg.sender];
        
        if (scaledAmount > userScaledDeposit) {
            // Allow exact full withdrawal despite rounding
            scaledAmount = userScaledDeposit;
            amount = MathLib.wadMul(scaledAmount, depositScale[debtToken]);
        }

        totalScaledDeposits[debtToken] -= scaledAmount;
        providerScaledDeposits[debtToken][msg.sender] -= scaledAmount;
        
        IERC20(debtToken).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, debtToken, amount);
    }

    function absorbDebt(
        address debtToken,
        uint256 debtAmount,
        address collateralToken,
        uint256 collateralAmount
    ) external nonReentrant onlyLiquidationEngine {
        if (debtAmount == 0 || collateralAmount == 0) revert ErrorLib.ZeroAmount();
        _initScale(debtToken);
        
        uint256 scale = depositScale[debtToken];
        uint256 currentTotal = MathLib.wadMul(totalScaledDeposits[debtToken], scale);
        
        if (currentTotal < debtAmount) revert ErrorLib.InsufficientBalance(debtToken, debtAmount, currentTotal);

        if (!hasAbsorbedToken[debtToken][collateralToken]) {
            hasAbsorbedToken[debtToken][collateralToken] = true;
            absorbedCollateralTokens[debtToken].push(collateralToken);
        }

        // Update reward per scaled deposit
        uint256 rewardPerScaled = MathLib.wadDiv(collateralAmount, totalScaledDeposits[debtToken]);
        cumulativeRewardPerDeposit[debtToken][collateralToken] += rewardPerScaled;

        // Update deposit scale (reduces user balances)
        uint256 newTotal = currentTotal - debtAmount;
        depositScale[debtToken] = MathLib.wadDiv(newTotal, totalScaledDeposits[debtToken]);

        // Debt tokens are burned (transferred out to LiquidationEngine which repays Vault)
        IERC20(debtToken).safeTransfer(msg.sender, debtAmount);
        
        emit DebtAbsorbed(debtToken, debtAmount, collateralToken, collateralAmount);
    }

    function claimCollateralRewards(address debtToken) external nonReentrant {
        _updateRewards(debtToken, msg.sender);
        
        address[] memory collTokens = absorbedCollateralTokens[debtToken];
        for (uint256 i = 0; i < collTokens.length; i++) {
            address collToken = collTokens[i];
            uint256 reward = pendingRewards[debtToken][msg.sender][collToken];
            if (reward > 0) {
                pendingRewards[debtToken][msg.sender][collToken] = 0;
                IERC20(collToken).safeTransfer(msg.sender, reward);
                emit RewardsClaimed(msg.sender, debtToken, collToken, reward);
            }
        }
    }

    function canAbsorb(address debtToken, uint256 amount) external view returns (bool) {
        if (depositScale[debtToken] == 0) return false;
        uint256 currentTotal = MathLib.wadMul(totalScaledDeposits[debtToken], depositScale[debtToken]);
        return currentTotal >= amount;
    }
}
