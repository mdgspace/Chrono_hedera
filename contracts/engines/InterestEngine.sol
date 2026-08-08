// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IInterestEngine.sol";
import "../interfaces/ILendingPool.sol";
import "../interfaces/IAssetRegistry.sol";
import "../libraries/MathLib.sol";
import "../libraries/ErrorLib.sol";

contract InterestEngine is IInterestEngine, Ownable {
    ILendingPool public lendingPool;
    IAssetRegistry public assetRegistry;

    uint256 public constant PROTOCOL_FEE = 0.10e18; // 10%

    // Stablecoin params
    uint256 public constant STABLE_R_BASE = 0.005e18;
    uint256 public constant STABLE_U_OPTIMAL = 0.90e18;
    uint256 public constant STABLE_R_SLOPE1 = 0.04e18;
    uint256 public constant STABLE_R_SLOPE2 = 0.60e18;

    // Volatile params
    uint256 public constant VOLATILE_R_BASE = 0.015e18;
    uint256 public constant VOLATILE_U_OPTIMAL = 0.80e18;
    uint256 public constant VOLATILE_R_SLOPE1 = 0.06e18;
    uint256 public constant VOLATILE_R_SLOPE2 = 1.00e18;

    mapping(address => bool) public isAuthorized;

    struct PositionInterest {
        address debtToken;
        uint256 principal;
        uint256 accruedInterest;
        uint256 lastAccrualTime;
    }

    mapping(bytes32 => PositionInterest) public positions;

    event AuthorizedSet(address indexed caller, bool authorized);
    event InterestAccrued(bytes32 indexed positionId, uint256 amount);

    modifier onlyAuthorized() {
        if (!isAuthorized[msg.sender]) {
            revert ErrorLib.Unauthorized(msg.sender, address(0));
        }
        _;
    }

    constructor(address _lendingPool, address _assetRegistry, address initialOwner) Ownable(initialOwner) {
        lendingPool = ILendingPool(_lendingPool);
        assetRegistry = IAssetRegistry(_assetRegistry);
    }

    function setAuthorized(address caller, bool authorized) external onlyOwner {
        isAuthorized[caller] = authorized;
        emit AuthorizedSet(caller, authorized);
    }

    function getUtilization(address token) public view returns (uint256) {
        uint256 borrowed = lendingPool.getTotalBorrowed(token);
        uint256 deposits = lendingPool.getTotalDeposits(token);
        if (deposits == 0) return 0;
        return MathLib.wadDiv(borrowed, deposits);
    }

    function getBorrowAPY(address token) public view returns (uint256) {
        AssetConfig memory config = assetRegistry.getConfig(token);
        uint256 u = getUtilization(token);

        if (config.isStablecoin) {
            return MathLib.kinkRate(u, STABLE_R_BASE, STABLE_U_OPTIMAL, STABLE_R_SLOPE1, STABLE_R_SLOPE2);
        } else {
            return MathLib.kinkRate(u, VOLATILE_R_BASE, VOLATILE_U_OPTIMAL, VOLATILE_R_SLOPE1, VOLATILE_R_SLOPE2);
        }
    }

    function getSupplyAPY(address token) external view returns (uint256) {
        uint256 borrowAPY = getBorrowAPY(token);
        uint256 u = getUtilization(token);
        uint256 rawSupplyRate = MathLib.wadMul(borrowAPY, u);
        return MathLib.wadMul(rawSupplyRate, MathLib.WAD - PROTOCOL_FEE);
    }

    function accrueInterest(bytes32 positionId) external onlyAuthorized returns (uint256 accrued) {
        PositionInterest storage pos = positions[positionId];
        if (pos.debtToken == address(0)) return 0;

        uint256 currentTime = block.timestamp;
        if (currentTime <= pos.lastAccrualTime) return 0;

        uint256 elapsed = currentTime - pos.lastAccrualTime;
        uint256 apy = getBorrowAPY(pos.debtToken);
        
        uint256 currentDebt = pos.principal + pos.accruedInterest;
        uint256 newTotalDebt = MathLib.compoundInterest(currentDebt, apy, elapsed);
        
        accrued = newTotalDebt - currentDebt;
        
        pos.accruedInterest += accrued;
        pos.lastAccrualTime = currentTime;

        if (accrued > 0) {
            emit InterestAccrued(positionId, accrued);
        }
    }

    function initPosition(bytes32 positionId, address debtToken, uint256 principal) external onlyAuthorized {
        positions[positionId] = PositionInterest({
            debtToken: debtToken,
            principal: principal,
            accruedInterest: 0,
            lastAccrualTime: block.timestamp
        });
    }

    function updateAfterRepay(bytes32 positionId, uint256 remainingPrincipal, uint256 remainingInterest) external onlyAuthorized {
        PositionInterest storage pos = positions[positionId];
        pos.principal = remainingPrincipal;
        pos.accruedInterest = remainingInterest;
    }

    function clearPosition(bytes32 positionId) external onlyAuthorized {
        delete positions[positionId];
    }
}
