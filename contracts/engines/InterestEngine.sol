// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IInterestEngine.sol";
import "../interfaces/ILendingPool.sol";
import "../interfaces/IAssetRegistry.sol";
import "../libraries/MathLib.sol";
import "../libraries/ErrorLib.sol";
import {wrap, unwrap} from "@prb/math/src/UD60x18.sol";
import {ln} from "@prb/math/src/ud60x18/Math.sol";

contract InterestEngine is IInterestEngine, Ownable {
    enum F2Shape { Linear, Quadratic, Cubic }

    ILendingPool public lendingPool;
    IAssetRegistry public assetRegistry;
    uint256 public constant PROTOCOL_FEE = 0.10e18;
    uint256 public constant TARGET_UTILIZATION = 0.85e18;
    uint256 public constant INITIAL_TARGET_RATE = 0.04e18;
    uint256 public constant ADJUSTMENT_TIME = 50 days;
    uint256 public constant REFERENCE_DURATION = 30 days;
    uint256 public constant HIGH_UTIL_MULTIPLIER = 4e18;
    uint256 public constant MIN_TARGET_RATE = 0.0001e18;
    uint256 public constant MAX_TARGET_RATE = 1e18;

    F2Shape public f2Shape = F2Shape.Linear;
    uint256 public hyperbolaRateAtZero = 0.08e18;
    uint256 public hyperbolaC = 1 days;
    uint256 public f2RateAtReference = 0.03e18;

    mapping(address => bool) public isAuthorized;

    struct PositionInterest {
        address debtToken;
        uint256 principal;
        uint256 accruedInterest;
        uint256 lastAccrualTime;
        uint256 fixedAnnualRate;
        uint256 utilizationIndexSnapshot;
    }

    struct AdaptiveState {
        uint256 targetRate;
        uint256 lastUpdateTimestamp;
        uint256 cumulativeRateSeconds;
    }

    struct ReserveInterestData {
        uint256 borrowIndex;
        uint256 lastUpdateTimestamp;
    }

    mapping(bytes32 => PositionInterest) public positions;
    mapping(address => AdaptiveState) public adaptiveState;
    mapping(address => ReserveInterestData) public reserveData;
    mapping(address => uint256) public totalPositionPrincipal;
    mapping(address => uint256) public totalFixedRateWeighted;

    event AuthorizedSet(address indexed caller, bool authorized);
    event InterestAccrued(bytes32 indexed positionId, uint256 amount);
    event F2ShapeSet(F2Shape shape);
    event DurationParametersSet(uint256 hyperbolaRateAtZero, uint256 hyperbolaC, uint256 f2RateAtReference);

    modifier onlyAuthorized() {
        if (!isAuthorized[msg.sender]) revert ErrorLib.Unauthorized(msg.sender, address(0));
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

    function setF2Shape(F2Shape shape) external onlyOwner {
        f2Shape = shape;
        emit F2ShapeSet(shape);
    }

    function setDurationParameters(uint256 rateAtZero, uint256 cSeconds, uint256 rateAtReference) external onlyOwner {
        if (rateAtZero > 1e18 || cSeconds == 0 || cSeconds > 365 days || rateAtReference > 1e18) {
            revert ErrorLib.InvalidPairConfig();
        }
        hyperbolaRateAtZero = rateAtZero;
        hyperbolaC = cSeconds;
        f2RateAtReference = rateAtReference;
        emit DurationParametersSet(rateAtZero, cSeconds, rateAtReference);
    }

    function getUtilization(address token) public view returns (uint256) {
        uint256 deposits = lendingPool.getTotalDeposits(token);
        if (deposits == 0) return 0;
        uint256 u = MathLib.wadDiv(lendingPool.getTotalBorrowed(token), deposits);
        return u > MathLib.WAD ? MathLib.WAD : u;
    }

    function durationRate(uint256 durationSeconds) public view returns (uint256) {
        uint256 f1 = (hyperbolaRateAtZero * hyperbolaC) / (durationSeconds + hyperbolaC);
        uint256 t = MathLib.wadDiv(durationSeconds, REFERENCE_DURATION);
        uint256 power = t;
        if (f2Shape >= F2Shape.Quadratic) power = MathLib.wadMul(power, t);
        if (f2Shape == F2Shape.Cubic) power = MathLib.wadMul(power, t);
        return f1 + MathLib.wadMul(f2RateAtReference, power);
    }

    function quoteBorrowAPY(address collateralToken, address debtToken, uint256 durationSeconds)
        external view returns (uint256)
    {
        PairConfig memory config = assetRegistry.getPairConfig(collateralToken, debtToken);
        if (!assetRegistry.isPairSupported(collateralToken, debtToken)) revert ErrorLib.PairNotSupported(collateralToken, debtToken);
        if (durationSeconds < config.minBorrowDuration || durationSeconds > config.maxBorrowDuration) {
            revert ErrorLib.InvalidDuration(durationSeconds, config.minBorrowDuration, config.maxBorrowDuration);
        }
        return durationRate(durationSeconds) + getAdaptiveRate(debtToken);
    }

    function _curveMultiplier(uint256 u) internal pure returns (uint256) {
        if (u <= TARGET_UTILIZATION) return MathLib.wadDiv(u, TARGET_UTILIZATION);
        return MathLib.WAD + MathLib.wadMul(HIGH_UTIL_MULTIPLIER,
            MathLib.wadDiv(u - TARGET_UTILIZATION, MathLib.WAD - TARGET_UTILIZATION));
    }

    function _nextTargetRate(uint256 oldRate, uint256 u, uint256 elapsed) internal pure returns (uint256) {
        if (elapsed == 0 || u == TARGET_UTILIZATION) return oldRate;
        bool rising = u > TARGET_UTILIZATION;
        uint256 error = rising
            ? MathLib.wadDiv(u - TARGET_UTILIZATION, MathLib.WAD - TARGET_UTILIZATION)
            : MathLib.wadDiv(TARGET_UTILIZATION - u, TARGET_UTILIZATION);
        uint256 exponent = (error * elapsed) / ADJUSTMENT_TIME;
        if (exponent > 10e18) exponent = 10e18;
        uint256 factor = MathLib.expNeg(exponent);
        uint256 next = rising ? MathLib.wadDiv(oldRate, factor) : MathLib.wadMul(oldRate, factor);
        if (next < MIN_TARGET_RATE) return MIN_TARGET_RATE;
        if (next > MAX_TARGET_RATE) return MAX_TARGET_RATE;
        return next;
    }

    /// @notice Exact integral of the exponential target rate while utilization is fixed.
    function _integratedTargetRate(uint256 oldRate, uint256 nextRate, uint256 u, uint256 elapsed)
        internal pure returns (uint256)
    {
        if (elapsed == 0) return 0;
        if (u == TARGET_UTILIZATION) return oldRate * elapsed;
        bool rising = u > TARGET_UTILIZATION;
        uint256 error = rising
            ? MathLib.wadDiv(u - TARGET_UTILIZATION, MathLib.WAD - TARGET_UTILIZATION)
            : MathLib.wadDiv(TARGET_UTILIZATION - u, TARGET_UTILIZATION);
        uint256 exponent = (error * elapsed) / ADJUSTMENT_TIME;
        if (exponent == 0) return oldRate * elapsed;

        uint256 boundary = rising ? MAX_TARGET_RATE : MIN_TARGET_RATE;
        if (oldRate == boundary) return boundary * elapsed;
        uint256 ratio = rising ? MathLib.wadDiv(boundary, oldRate) : MathLib.wadDiv(oldRate, boundary);
        uint256 crossingExponent = unwrap(ln(wrap(ratio)));
        if (exponent > crossingExponent) {
            uint256 beforeSeconds = (elapsed * crossingExponent) / exponent;
            uint256 boundaryDelta = rising ? boundary - oldRate : oldRate - boundary;
            uint256 beforeIntegral = (boundaryDelta * elapsed * MathLib.WAD) / exponent;
            return beforeIntegral + boundary * (elapsed - beforeSeconds);
        }
        uint256 delta = rising ? nextRate - oldRate : oldRate - nextRate;
        return (delta * elapsed * MathLib.WAD) / exponent;
    }

    function getTargetRate(address token) public view returns (uint256) {
        AdaptiveState memory state = adaptiveState[token];
        uint256 u = getUtilization(token);
        return state.lastUpdateTimestamp == 0 ? INITIAL_TARGET_RATE
            : _nextTargetRate(state.targetRate, u, block.timestamp - state.lastUpdateTimestamp);
    }

    function getAdaptiveRate(address token) public view returns (uint256) {
        return MathLib.wadMul(getTargetRate(token), _curveMultiplier(getUtilization(token)));
    }

    /// @notice Pool calls this before each deposit, withdrawal or principal change.
    function syncUtilization(address token) public {
        AdaptiveState storage state = adaptiveState[token];
        if (state.lastUpdateTimestamp == 0) {
            state.targetRate = INITIAL_TARGET_RATE;
            state.lastUpdateTimestamp = block.timestamp;
            return;
        }
        uint256 elapsed = block.timestamp - state.lastUpdateTimestamp;
        if (elapsed == 0) return;
        uint256 u = getUtilization(token);
        uint256 next = _nextTargetRate(state.targetRate, u, elapsed);
        uint256 targetIntegral = _integratedTargetRate(state.targetRate, next, u, elapsed);
        state.cumulativeRateSeconds += MathLib.wadMul(targetIntegral, _curveMultiplier(u));
        state.targetRate = next;
        state.lastUpdateTimestamp = block.timestamp;
    }

    /// @notice Pool-level APY for the reserve index and indicative supply APY.
    function getBorrowAPY(address token) public view returns (uint256) {
        uint256 principal = totalPositionPrincipal[token];
        uint256 fixedPart = principal == 0 ? 0 : totalFixedRateWeighted[token] / principal;
        return fixedPart + getAdaptiveRate(token);
    }

    function getSupplyAPY(address token) external view returns (uint256) {
        return MathLib.wadMul(MathLib.wadMul(getBorrowAPY(token), getUtilization(token)), MathLib.WAD - PROTOCOL_FEE);
    }

    function accrueInterest(bytes32 positionId) external onlyAuthorized returns (uint256 accrued) {
        PositionInterest storage pos = positions[positionId];
        if (pos.debtToken == address(0)) return 0;
        syncUtilization(pos.debtToken);
        uint256 elapsed = block.timestamp - pos.lastAccrualTime;
        if (elapsed == 0) return 0;
        uint256 rateSeconds = pos.fixedAnnualRate * elapsed
            + adaptiveState[pos.debtToken].cumulativeRateSeconds - pos.utilizationIndexSnapshot;
        uint256 currentDebt = pos.principal + pos.accruedInterest;
        accrued = MathLib.compoundInterestAccumulated(currentDebt, rateSeconds) - currentDebt;
        pos.accruedInterest += accrued;
        pos.lastAccrualTime = block.timestamp;
        pos.utilizationIndexSnapshot = adaptiveState[pos.debtToken].cumulativeRateSeconds;
        if (accrued > 0) emit InterestAccrued(positionId, accrued);
    }

    function getTotalDebt(bytes32 positionId) external view returns (uint256) {
        PositionInterest storage pos = positions[positionId];
        return pos.principal + pos.accruedInterest;
    }

    /// @notice Debt including interest that would accrue if the position were touched now.
    function previewTotalDebt(bytes32 positionId) external view returns (uint256) {
        PositionInterest memory pos = positions[positionId];
        if (pos.debtToken == address(0)) return 0;
        AdaptiveState memory state = adaptiveState[pos.debtToken];
        uint256 index = state.cumulativeRateSeconds;
        if (state.lastUpdateTimestamp != 0 && block.timestamp > state.lastUpdateTimestamp) {
            uint256 elapsed = block.timestamp - state.lastUpdateTimestamp;
            uint256 u = getUtilization(pos.debtToken);
            uint256 next = _nextTargetRate(state.targetRate, u, elapsed);
            index += MathLib.wadMul(_integratedTargetRate(state.targetRate, next, u, elapsed), _curveMultiplier(u));
        }
        uint256 rateSeconds = pos.fixedAnnualRate * (block.timestamp - pos.lastAccrualTime)
            + index - pos.utilizationIndexSnapshot;
        return MathLib.compoundInterestAccumulated(pos.principal + pos.accruedInterest, rateSeconds);
    }

    function initPosition(bytes32 positionId, address collateralToken, address debtToken, uint256 principal, uint256 durationSeconds)
        external onlyAuthorized
    {
        if (positions[positionId].debtToken != address(0)) revert ErrorLib.InvalidPairConfig();
        PairConfig memory config = assetRegistry.getPairConfig(collateralToken, debtToken);
        if (!assetRegistry.isPairSupported(collateralToken, debtToken)) revert ErrorLib.PairNotSupported(collateralToken, debtToken);
        if (durationSeconds < config.minBorrowDuration || durationSeconds > config.maxBorrowDuration) {
            revert ErrorLib.InvalidDuration(durationSeconds, config.minBorrowDuration, config.maxBorrowDuration);
        }
        syncUtilization(debtToken);
        uint256 fixedRate = durationRate(durationSeconds);
        positions[positionId] = PositionInterest(debtToken, principal, 0, block.timestamp, fixedRate,
            adaptiveState[debtToken].cumulativeRateSeconds);
        totalPositionPrincipal[debtToken] += principal;
        totalFixedRateWeighted[debtToken] += principal * fixedRate;
    }

    function updateAfterRepay(bytes32 positionId, uint256 remainingPrincipal, uint256 remainingInterest) external onlyAuthorized {
        PositionInterest storage pos = positions[positionId];
        uint256 oldPrincipal = pos.principal;
        if (remainingPrincipal > oldPrincipal) revert ErrorLib.InvalidPairConfig();
        totalPositionPrincipal[pos.debtToken] -= oldPrincipal - remainingPrincipal;
        totalFixedRateWeighted[pos.debtToken] -= (oldPrincipal - remainingPrincipal) * pos.fixedAnnualRate;
        pos.principal = remainingPrincipal;
        pos.accruedInterest = remainingInterest;
    }

    function clearPosition(bytes32 positionId) external onlyAuthorized {
        PositionInterest storage pos = positions[positionId];
        if (pos.debtToken != address(0)) {
            totalPositionPrincipal[pos.debtToken] -= pos.principal;
            totalFixedRateWeighted[pos.debtToken] -= pos.principal * pos.fixedAnnualRate;
        }
        delete positions[positionId];
    }

    function updateReserveIndices(address token) public returns (uint256 currentBorrowIndex) {
        ReserveInterestData storage data = reserveData[token];
        if (data.borrowIndex == 0) {
            data.borrowIndex = MathLib.WAD;
            data.lastUpdateTimestamp = block.timestamp;
            syncUtilization(token);
            return MathLib.WAD;
        }
        uint256 elapsed = block.timestamp - data.lastUpdateTimestamp;
        if (elapsed == 0) return data.borrowIndex;
        syncUtilization(token);
        uint256 apy = getBorrowAPY(token);
        data.borrowIndex += MathLib.wadMul(data.borrowIndex, (apy * elapsed) / MathLib.SECONDS_PER_YEAR);
        data.lastUpdateTimestamp = block.timestamp;
        emit IndexSnapshot(token, data.borrowIndex, apy, getUtilization(token), block.timestamp);
        return data.borrowIndex;
    }

    function updateAllReserveIndices() external returns (uint256 updatedCount) {
        address[] memory assets = assetRegistry.getAllAssets();
        for (uint256 i; i < assets.length; ++i) {
            if (assetRegistry.isSupported(assets[i])) { updateReserveIndices(assets[i]); ++updatedCount; }
        }
    }

    function getBorrowIndex(address token) external view returns (uint256) {
        uint256 index = reserveData[token].borrowIndex;
        return index == 0 ? MathLib.WAD : index;
    }
}
