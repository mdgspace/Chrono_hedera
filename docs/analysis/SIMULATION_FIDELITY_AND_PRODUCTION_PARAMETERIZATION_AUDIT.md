# Comprehensive Architectural & Mathematical Audit: Simulation Framework (`sim/`) vs. Chrono Smart Contracts (`contracts/`) & Production Parameterization

**Date:** October 22, 2026  
**Audit Scope:**
1. **Fidelity Audit:** Rigorous comparative analysis of `sim/chrono_sim/`, `sim/configs/`, and simulation models (`NEG`, `SPEC`, `S1`, `B0_cap`) against the core smart contracts (`AssetRegistry.sol`, `BorrowVault.sol`, `RiskEngine.sol`, `LiquidationEngine.sol`, `InterestEngine.sol`, `StabilityPool.sol`, `MathLib.sol`) and architectural specifications (`docs/`).
2. **Missing Production Hyperparameters:** Industry comparative benchmark (Aave v3, Morpho Blue, Compound v3, Liquity v1/v2) and formal specification of essential, unparameterized production risk controls for Chrono Protocol on Hedera.

---

# SECTION 1: FIDELITY AUDIT (SIMULATION VS. ACTUAL CHRONO PROTOCOL)

## 1.1 Executive Architectural Divergence Summary
The Chrono codebase contains two distinct mathematical and architectural worlds that have drifted out of alignment:
1. **The Deployed On-Chain Reality (`contracts/`):**
   - Pure **per-asset configuration** (no concept of isolated or pair-wise parameterization in `AssetRegistry.sol`).
   - Pure **Negative Exponential Decay model (`NEG`)** for LTV and Liquidation Thresholds via `MathLib.sol` and `RiskEngine.sol`.
   - Rigid **static 50% close factor** in `LiquidationEngine.softLiquidate()` with asymmetric parameter queries (bonus from collateral, close factor from debt token).
   - Calibrated **3-Tier Hard Liquidation Waterfall** at loan expiration (12% penalty, 2.5% collateral floor, 75% Stability Pool / 25% Bad Debt Reserve split, solvency-gated residual refund).
   - **Severe Smart Contract Vulnerabilities:** An unhandled "final-hour revert" in `RiskEngine.sol` causing soft liquidations to revert when $T_{\text{rem}} < 1\text{ hour}$, and missing decimal normalization across token pairs in `BorrowVault.sol` / `LiquidationEngine.sol`.
2. **The Simulation Engine (`sim/`):**
   - Fundamentally designed around **pair-level configurations** (`PairRisk(coll, debt)` in `HBAR_USDC.yaml`).
   - Built to compare **four competing research models** (`NEG`, `SPEC`, `S1`, `B0_cap`), citing an uncommitted/off-chain research document (`docs/analysis/LTV_MODEL_SELECTION_FOR_CHRONO.md`).
   - Introduces theoretical concepts never ratified or implemented on-chain (e.g., `LTVcap`, `cap`, `lam`, `z`, `theta`, `v0`, confidence price adjustments).
   - Contains feature flags (`Switches`) that intentionally toggle between simulating the buggy contract code (`--switches as_coded`) and idealized mathematical fixes (`Switches.m0()`).
   - Completely omits the ratified **Chrono Dynamic-Discount Engine (CD3)** Dutch auction mechanics specified in `docs/analysis/SOFT_LIQUIDATION_DUTCH_AUCTION_ANALYSIS.md`.

---

## 1.2 On-Chain Parameter Registry (`AssetRegistry.sol` / `IAssetRegistry.sol`)
In the smart contracts, risk parameters are registered **per token** (not per pair). `AssetConfig` in `contracts/interfaces/IAssetRegistry.sol` is defined as:

```solidity
struct AssetConfig {
    address tokenAddress;
    uint8 decimals;
    bool isStablecoin;
    uint256 ltvBase;                   // Default: 0.75e18 (75%)
    uint256 ltvMax;                    // Default: 0.90e18 (90%)
    uint256 kDecay;                    // Default: 7_614_000_000_000 (7.614e-6 s^-1)
    uint256 liquidationBonus;          // Default: 0.05e18 (5%)
    uint256 closeFactor;               // Default: 0.5e18 (50%)
    uint256 ltBufferMin;               // Default: 0.05e18 (5%)
    uint256 ltBufferMax;               // Default: 0.25e18 (25%)
    uint256 kLtBuffer;                 // Default: 7_614_000_000_000 (7.614e-6 s^-1)
    uint256 hardLiqPenalty;            // Default: 0.12e18 (12%)
    uint256 hardLiqCollateralFloor;    // Default: 0.025e18 (2.5%)
    uint256 stabilityPoolPenaltyShare; // Default: 0.75e18 (75%)
    uint256 reservePenaltyShare;       // Default: 0.25e18 (25%)
    uint256 minBorrowDuration;         // Default: 3600 (1 hour)
    uint256 maxBorrowDuration;         // Default: 2,592,000 (30 days), Limit: 60 days
    bool isActive;                     // Default: true
}
```

### Critical Architectural Nuance: The Token Query Asymmetry
Because parameters are stored on a per-token basis rather than per-pair, the smart contracts query parameters with severe structural asymmetry:
- In `BorrowVault.openPosition`: `maxLtv` is computed strictly using the **collateral token's** `AssetConfig` (`riskEngine.computeMaxLTV(collateralToken, durationSeconds)`). The debt token's volatility or risk parameters are completely ignored.
- In `LiquidationEngine.softLiquidate`:
  - `closeFactor` is read from `registry.getConfig(pos.debtToken).closeFactor`.
  - `liquidationBonus` is read from `registry.getConfig(pos.collateralToken).liquidationBonus`.
- In `LiquidationEngine.executeHardLiquidation`:
  - `hardLiqPenalty`, `hardLiqCollateralFloor`, and `stabilityPoolPenaltyShare` are read strictly from `registry.getConfig(pos.debtToken)`. The collateral token's penalty configurations are ignored.

In `sim/`, this behavior is reproduced only when `switches.pair_config = False`. When `switches.pair_config = True`, `sim/` overrides this behavior with a unified `PairRisk` object.

---

## 1.3 Mathematical Formulations: Solidity vs. `sim/`

### 1. Loan-to-Value (LTV) Calculation
- **Solidity (`MathLib.computeLTV` via `RiskEngine.sol`):**
  $$\text{LTV}(t) = \text{ltvBase} + (\text{ltvMax} - \text{ltvBase}) \cdot e^{-k_{\text{decay}} \cdot t}$$
  - Evaluated in `UD60x18` fixed-point math using PRBMath's `expNeg(wadMul(kDecay, t * WAD))`.
  - Clamped to $[T_{\text{min}}, T_{\text{max}}]$ in `RiskEngine.computeMaxLTV`. If $t < T_{\text{min}}$ or $t > T_{\text{max}}$, it reverts with `ErrorLib.InvalidDuration`.
- **`sim/` Formulation:**
  - In `NEG` (`kernels.py` line 46): Evaluates `p[13] + (p[14] - p[13]) * exp(-p[15] * T_s)` matching the contracts.
  - In `SPEC` (`kernels.py` line 56-59): Ignores `ltvBase`/`ltvMax`/`kDecay` entirely! Computes a continuous Black-Scholes/GBM lognormal quantile:
    $$\text{LTV}(T_s) = \min\left(\text{cap}, \lambda \cdot \exp\left( -z \sigma \sqrt{t} - \frac{1}{2}\sigma^2 t - r t \right)\right)$$
  - In `S1`: Implements mean-reverting term variance via Ornstein-Uhlenbeck:
    $$v(t) = \theta + (v_0 - \theta) \frac{1 - e^{-\kappa t}}{\kappa t}, \quad \text{LTV}(T_s) = \min(\text{cap}, \lambda e^{-z\sqrt{v t} - \frac{1}{2}v t}) \cdot e^{-r t}$$
  - In `B0_cap`: Flat constant $LTV = \text{cap}$.

### 2. Health Factor (HF) and Liquidation Threshold (LT)
- **Solidity (`RiskEngine.computeHealthFactor`):**
  $$HF = \frac{\text{Collateral Value} \cdot LT(t_{\text{rem}}, t_{\text{el}})}{\text{Debt Value}}$$
  Where:
  $$LT = \min(\text{LTV}(t_{\text{remaining}}) + \text{Buffer}(t_{\text{elapsed}}), 1.0 \times 10^{18})$$
  $$\text{Buffer}(t_{\text{elapsed}}) = \text{ltBufferMin} + (\text{ltBufferMax} - \text{ltBufferMin}) \cdot (1 - e^{-k_{\text{ltBuffer}} \cdot t_{\text{elapsed}}})$$
- **The "Final-Hour Revert" Contract Vulnerability:**
  In `contracts/engines/RiskEngine.sol` (lines 46–47):
  ```solidity
  uint256 ltv = computeMaxLTV(collateralToken, remainingDuration);
  ```
  `PositionLib.remainingDuration` returns $0$ if $t \ge T_{\text{expiry}}$. When $t_{\text{remaining}} < \text{minBorrowDuration}$ (default: $3600\text{ s}$ / 1 hour), `computeMaxLTV` executes:
  ```solidity
  if (durationSeconds < config.minBorrowDuration || durationSeconds > config.maxBorrowDuration) {
      revert ErrorLib.InvalidDuration(durationSeconds, config.minBorrowDuration, config.maxBorrowDuration);
  }
  ```
  **Direct Impact:** In the real contracts, whenever a loan enters its final hour ($t_{\text{rem}} < 3600$) or expires, **`computeHealthFactor` unconditionally reverts!** Consequently, `softLiquidate` can NEVER be called during the final hour of a loan.
  - **In `sim/`:** The simulation engineers caught this bug and explicitly added the switch `fix_final_hour: bool = False` to `Switches` (`switches.py` line 12). Under `--switches as_coded`, `sim/` intentionally triggers `InvalidDuration` to match the broken smart contract. Under `Switches.m0()`, it clamps $t_{\text{remaining}}$ to 0 without reverting.

### 3. Soft Liquidation Mechanics
- **Solidity (`LiquidationEngine.sol` lines 56–129):**
  - Trigger: $HF \le 1.0 \times 10^{18}$.
  - Repayment Cap: Capped by static `closeFactor` (50%):
    $$\text{repayAmount} = \min(\text{repayAmount}, \text{totalDebt} \cdot \text{closeFactor})$$
  - Seized Collateral:
    $$\text{seizeCollateral} = \min\left(\frac{\text{repayAmount} \cdot P_{\text{debt}} \cdot (1 + \text{bonus})}{P_{\text{coll}}}, \text{collateralAmount}\right)$$
  - Routing: Binary check on `stabilityPool.canAbsorb(debtToken, repayAmount)`. If true, 100% is absorbed by the Stability Pool; if false, 100% is executed by the external liquidator.
  - Position Closure: `closePosition = (repayAmount == totalDebt)`. Because `repayAmount` is capped at $50\%$ by `closeFactor`, `closePosition` is **mathematically impossible** during soft liquidation in the contract!
- **`sim/` (`fast/liquidation.py` lines 42–79):**
  - Replicates this exact contract logic when `switches.pair_config = False`.
  - When `switches.pair_config = True`, it calls `risk_model.close_amount()` and `risk_model.bonus()`, which in `base.py` still evaluate to static multipliers (`debt * close_factor` and `bonus`).
  - **Neither the Solidity contracts nor `sim/` implement the ratified CD3 Dutch Auction Engine from `docs/analysis/SOFT_LIQUIDATION_DUTCH_AUCTION_ANALYSIS.md`.**

### 4. Hard Liquidation Settlement & The 3-Tier Waterfall
- **Solidity (`LiquidationEngine.executeHardLiquidation`):**
  - Trigger: $t \ge \text{startTime} + \text{duration} + \text{GRACE\_PERIOD}$ (where `GRACE_PERIOD = 900` seconds / 15 minutes).
  - Penalty Calculation:
    $$\text{penDebtVal} = \text{totalDebtValue} \cdot \text{hardLiqPenalty} \quad (12\%)$$
    $$\text{penFloorVal} = \text{totalCollValue} \cdot \text{hardLiqCollateralFloor} \quad (2.5\%)$$
    $$\text{penaltyValue} = \max(\text{penDebtVal}, \text{penFloorVal})$$
  - Tranche Allocation:
    $$\text{requiredCollateral} = \min\left(\frac{\text{totalDebtValue} + \text{penaltyValue}}{P_{\text{coll}}}, \text{collateralAmount}\right)$$
    $$\text{spPenaltyCollateral} = \text{penaltyCollateral} \cdot \text{stabilityPoolPenaltyShare} \quad (75\%)$$
    $$\text{reservePenaltyCollateral} = \text{penaltyCollateral} - \text{spPenaltyCollateral} \quad (25\%)$$
  - Solvency Gate:
    - If `stabilityPool.canAbsorb(debtToken, totalDebt)`:
      - Stability Pool absorbs debt and receives $\text{debtCollateral} + \text{spPenaltyCollateral}$.
      - Protocol Treasury receives $\text{reservePenaltyCollateral}$.
      - **Borrower receives 100% of residual surplus collateral** (`refundToBorrower = true`).
    - If Stability Pool is undercapitalized (`canAbsorb == false`):
      - Seizes `requiredCollateral` to `owner()` (Treasury).
      - **Zero refund to borrower!** (`refundToBorrower = false`, residual collateral locked).
- **`sim/` (`fast/liquidation.py` lines 101–129):**
  - Bit-exact replication of this 3-tier waterfall and solvency-gated refund logic.
  - Adds `switches.hard_liq_zero_collateral` to prevent zero-collateral revert bugs.

---

## 1.4 Provenance & Analysis of Simulation Concepts (`LTVcap`, `cap`, `lam`, `S1`, `SPEC`, `B0_cap`)

### Where do these terms come from?
In `sim/README.md`, `sim/chrono_sim/models/base.py`, and `sim/configs/models/*.yaml`, numerous references cite:
- `Source: docs/analysis/LTV_MODEL_SELECTION_FOR_CHRONO.md`
- `P3C_METHOD.md`
- Parameters: `cap`, `LTVcap`, `lam` ($\lambda$), `z`, `theta` ($\theta$), `kappa` ($\kappa$), `sigma_floor`, `v_max`, `L_eq`, `J_struct`, `gap_liq`, `gap_open`.

**Historical & Repository Reality:**
1. The document `docs/analysis/LTV_MODEL_SELECTION_FOR_CHRONO.md` does **not exist** in the repository. It was an off-chain design specification written during the "P3/P3C" simulation research phase (introduced in commit `0cf5aa6` on Oct 21, 2026).
2. The simulation was built by quantitative researchers to determine whether Chrono should replace its deployed negative exponential decay model (`NEG`) with an options-implied volatility model (`SPEC`) or a term-structure model (`S1`).

### The Four Models in `sim/`:
1. **`NEG` (Negative Exponential Decay - Code 7):**
   - **Status:** **The ONLY model that represents Chrono's current codebase.**
   - Uses the deployed contracts' formulas: $LTV(t) = base + (max - base)e^{-kt}$ and $LT(t) = LTV(t_{\text{rem}}) + buf(t_{\text{el}})$.
   - Flags: `time_free = False`, `snapshot_lt = False`.
2. **`SPEC` (Specification Candidate - Code 5):**
   - Derived from classic continuous-time Merton/Black-Scholes risk modeling.
   - Calculates allowable borrow limit from fixed historical volatility $\sigma$ and risk aversion $z$:
     $$LTV(T) = \min(\text{cap}, \lambda \cdot e^{-z \sigma \sqrt{T} - \frac{1}{2}\sigma^2 T - r T})$$
   - Uses a **floating, constant liquidation threshold** ($LT = \lambda$, e.g., 0.88). LT does not change over time.
3. **`S1` (Term Structure / Research Candidate - Code 0):**
   - Models volatility as an Ornstein-Uhlenbeck mean-reverting process with long-term variance $\theta$ and reversion speed $\kappa$.
   - Incorporates a **snapshotted liquidation threshold** (`snapshot_lt = True`), freezing the borrower's LT at loan origination.
   - Applies an explicit maturity-value discount $e^{-r T}$ after the curve calculation.
4. **`B0_cap` (Flat Control - Code 3):**
   - Traditional DeFi control model (Aave/Morpho style): constant LTV cap regardless of duration ($LTV(t) = \text{cap}$).

---

## 1.5 Resolution of Specific Architectural Inquiries

### Inquiry 1: Does the protocol specify an `LTVcap` anywhere in architecture docs or contracts?
- **In Smart Contracts (`contracts/`):** **NO.** There is no variable, constant, or parameter named `LTVcap` or `cap`. The contracts strictly define `ltvBase` (75%) and `ltvMax` (90%) in `AssetRegistry.sol`. The allowable LTV is naturally bounded by $[ltvBase, ltvMax]$.
- **In Architecture Docs (`docs/Chrono_Protocol_Whitepaper.md`, `docs/Chrono_Primer.md`):** **NO.** Section 2.3 of the Whitepaper defines $LTV(t) = LTV_{\text{base}} + (LTV_{\text{max}} - LTV_{\text{base}}) \cdot e^{-k \cdot t}$.
- **Where `LTVcap` / `cap` Lives:** It exists **exclusively inside `sim/`** (`sim/configs/models/SPEC.yaml`, `sim/configs/pairs/*.yaml`, `sim/chrono_sim/models/validation.py`, and `kernels.py`). In the simulation's `SPEC` and `S1` models, `cap` (e.g. 0.85 or 0.87) is introduced as an exogenous safety ceiling because continuous-time diffusion formulas approach $\lambda$ (e.g., 0.88) as $t \to 0$, which could allow excessive leverage without a hard cap.

### Inquiry 2: What is the reality of `closeFactor`? (Solidity vs. CD3 Dynamic $D^*$ vs. `sim/`)
- **In Solidity Contracts:**
  - `closeFactor` **exists explicitly** in `AssetConfig` in `AssetRegistry.sol` (default `0.5e18` = 50%).
  - In `LiquidationEngine.sol` (lines 74–79), it is read from the **debt token** and strictly enforces that a liquidator can repay at most 50% of the outstanding debt during a soft liquidation.
- **In Architectural Specs (`docs/analysis/SOFT_LIQUIDATION_DUTCH_AUCTION_ANALYSIS.md`):**
  - Section 1.1 explicitly denounces this static 50% `closeFactor` as an architectural defect that leaves underwater loans half-liquidated during market crashes.
  - The approved **Chrono Dynamic-Discount Engine (CD3)** design **completely eliminates static close factors**, replacing them with the **closed-form optimal debt repayment $\Delta D^*$**:
    $$\Delta D^* = \frac{D_0 \cdot (HF_{\text{target}} - HF_0)}{HF_{\text{target}} - (1 + \beta) \cdot LT}$$
    Where $HF_{\text{target}} = 1.05$. If $\Delta D^* \ge D_0$, the position is 100% liquidated in a single transaction (100% close factor).
- **In `sim/`:**
  - The simulation has **NOT implemented CD3 or $\Delta D^*$**.
  - `sim/chrono_sim/protocol/fast/liquidation.py` and `models/base.py` still execute the legacy static `close_factor` (e.g., 0.5 from `HBAR_USDC.yaml`).

---

## 1.6 Divergence Matrix: Solidity Contracts vs. `sim/`

| Dimension | Real Smart Contracts (`contracts/`) | Simulation Engine (`sim/`) | Architectural Impact / Fidelity Verdict |
| :--- | :--- | :--- | :--- |
| **Configuration Architecture** | Per-token in `AssetRegistry.sol` | Per-pair in `PairRisk` (`HBAR_USDC.yaml`) | **Major Divergence.** `sim/` assumes pairs; contracts cannot isolate risk between collateral/debt pairs. |
| **LTV Decay Model** | Pure `NEG`: $LTV_{\text{base}} + \Delta LTV \cdot e^{-k t}$ | Evaluates `NEG`, `SPEC`, `S1`, `B0_cap` | Only `NEG` corresponds to current contracts. `SPEC` and `S1` are unratified research models. |
| **Final-Hour Health Factor** | **Reverts** when $T_{\text{rem}} < 3600\text{ s}$ (`InvalidDuration`) | Emulates bug via `fix_final_hour: False`; fixes via `Switches.m0()` | **Severe Contract Bug.** Deployed contracts cannot process soft liquidations in the final hour. |
| **Token Decimals** | No normalization (assumes all tokens are 18 decimals) | Emulates bug via `fix_decimals: False`; fixes via `Switches.m0()` | **Severe Contract Bug.** Contracts break on USDC (6 decimals) and WBTC (8 decimals). |
| **Soft Liquidation Sizing** | Static `closeFactor = 0.50` | Static `close_factor = 0.50` | Both lag behind the approved CD3 dynamic $D^*$ specification in `docs/analysis/`. |
| **Hard Liquidation Grace** | Hardcoded 900s (`GRACE_PERIOD`) | Hardcoded 900s in `fast/liquidation.py` | **Identical.** Both enforce 15-minute grace period before schedule execution. |
| **Hard Liquidation Waterfall** | 12% penalty, 2.5% floor, 75% SP / 25% Reserve, Solvency Gate | 12% penalty, 2.5% floor, 75% SP / 25% Reserve, Solvency Gate | **Bit-exact.** `sim/` faithfully models the hard liquidation waterfall. |
| **Upfront Origination Fee** | Not implemented (0% fee collected) | Stubs return `open_premium = 0.0` | Diverges from `docs/analysis/CRYPTO_STOCHASTIC_MODELING_AND_ES_PREMIUM_ANALYSIS.md`. |
| **Oracle Confidence Bounds** | Completely ignored in `PythOracleAdapter.sol` | Implemented via `conf_multiplier` and `max_open_conf_ratio` | Contracts expose protocol to oracle price manipulation; `sim/` models safe bounds. |

---

# SECTION 2: MISSING PRODUCTION HYPERPARAMETERS (INDUSTRY COMPARATIVE REFERENCE)

## 2.1 Architectural Benchmark: Chrono vs. Premier Lending Protocols

| Architectural Feature | Aave v3 [^1] | Morpho Blue [^7] | Compound v3 (Comet) | Liquity v1/v2 [^9][^10] | Chrono Protocol (Current Contracts) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Supply Caps (Deposit Caps)** | Granular per asset | Market-isolated pool limit | Per collateral asset | Unlimited (LUSD/BOLD minted) | **MISSING (None)** |
| **Borrow Caps** | Granular per asset | Isolated per market | Single borrow asset limit | System Debt Limit | **MISSING (None)** |
| **Collateral Debt Ceilings** | Enforced in Isolation Mode | Bound to isolated pair | Implicit in asset supply | Dedicated Stability Pool | **MISSING (None)** |
| **Dust Limits / Min Borrow** | Enforced ($>\$10-\$50$) | Enforced ($>\$10-\$50$) | Min borrow enforced | 2,000 LUSD / 2,000 BOLD | **MISSING (None, 1 wei allowed)** |
| **Oracle Heartbeats & Staleness** | Per-asset dynamic | Enforced in Oracle wrapper | Enforced per feed | Multi-oracle with fallback | **Static global 120s for all assets** |
| **Oracle Confidence Bands** | Deviation band filters | Hardcoded bound ($\epsilon_{\text{oracle}}$) | Anchor oracle deviation band | Dual oracle parity check | **MISSING (Pyth `conf` ignored)** |
| **Protocol Reserve Factor** | Configurable per asset (10–30%)| Bound to market fee (0–25%) | Built into rate curve | Origination fee (0.5–5%) | **Hardcoded constant 10%** |
| **Origination / ES Premium** | None (pure floating spread) | None | None | 0.5%–5% dynamic issuance fee | **MISSING (Contracts collect 0%)** |
| **Emergency Pause Guardian** | Granular per action/reserve | Stateless / Immutable | Pause Guardian per market | Pure immutability | **MISSING (Contracts unpausable)** |
| **Asset Freezing** | Freeze deposits/borrows | Irrevocable | Freeze supply/borrow | Dynamic Recovery Mode | **Binary `isActive` only** |

---

## 2.2 Category 1: Liquidity & Market Risk Caps

### 2.2.1 Supply Caps (`supplyCap`)
- **What It Does:** Limits the maximum aggregate quantity of a specific token that can be deposited into `LendingPool.sol`.
- **Why It Is Critical in Production:** Prevents "liquidity stuffing" attacks, where a malicious whale deposits massive liquidity to artificially suppress pool utilization (crashing borrow rates to $r_{\text{base}}$) or manipulates share valuations via vault inflation.
- **What Happens If Omitted:** An attacker can deposit hundreds of millions of unborrowed capital, diluting existing LP yields to near zero, or perform an ERC-4626 vault inflation/donation attack on first deposit.
- **Recommended Initial Range on Hedera Testnet/Mainnet:**
  - `wUSDC`: $1,000,000 – $5,000,000
  - `wETH`: 500 – 2,500 ETH
  - `HBAR`: 10,000,000 – 50,000,000 HBAR

### 2.2.2 Borrow Caps (`borrowCap`)
- **What It Does:** Caps the total principal debt that can be borrowed for a specific asset across all active positions in `BorrowVault.sol`.
- **Why It Is Critical in Production:** Limits protocol-wide insolvency liability. Bounding borrow volume ensures that the maximum potential bad debt from a sudden market failure cannot exceed the absorption capacity of the `StabilityPool` and the `LendingPool` Bad Debt Reserve.
- **What Happens If Omitted:** A runaway borrow frenzy on an illiquid or manipulated collateral asset can drain 100% of available stablecoin liquidity in `LendingPool.sol`, leaving depositors completely unable to withdraw (`InsufficientLiquidity`).
- **Recommended Initial Range on Hedera:**
  - `wUSDC`: $750,000 – $3,500,000 (70%–80% of Supply Cap)
  - `wETH`: 350 – 1,750 ETH
  - `HBAR`: 7,000,000 – 35,000,000 HBAR

### 2.2.3 Collateral Debt Ceilings (`debtCeiling`)
- **What It Does:** Limits the total USD value of debt that can be borrowed against a specific collateral asset across the entire protocol.
- **Why It Is Critical in Production:** Prevents long-tail or volatile collateral assets from dominating protocol debt. Even if an asset has high market cap, on-chain DEX liquidity on Hedera (e.g., SaucerSwap) may be shallow. A debt ceiling guarantees that total liquidated collateral never exceeds available secondary market depth.
- **What Happens If Omitted:** If a volatile altcoin experiences an exploit or depeg, borrowers default en masse. If debt backed by that token exceeds total Stability Pool capital, the entire LendingPool suffers catastrophic bad debt socialization.
- **Recommended Initial Range on Hedera:**
  - `wETH` Collateral: $2,500,000 Debt Ceiling
  - `HBAR` Collateral: $1,500,000 Debt Ceiling
  - High-Beta Altcoins: $100,000 – $250,000 Debt Ceiling

### 2.2.4 Dust Limits & Minimum Borrow Amounts (`minBorrowAmount`)
- **What It Does:** Enforces a minimum USD value for loan origination (e.g., min $50 – $100).
- **Why It Is Critical in Production:** Hedera Schedule Service (HSS / HIP-1215) charges transaction and rent fees to schedule hard liquidations. If users can borrow 1 wei or $0.01, attackers can spam millions of microscopic loans, exhausting SchedulerEngine HBAR gas reserves and clogging the Hedera consensus schedule queue.
- **What Happens If Omitted:** DoS attack on `SchedulerEngine.sol` through storage bloat and scheduled call spam; unprofitable micro-liquidations that external liquidators refuse to execute due to base gas costs.
- **Recommended Initial Range on Hedera:**
  - Minimum Borrow: **$50.00 – $100.00 USD equivalent** (e.g., 50–100 USDC, ~0.02–0.04 ETH).

---

## 2.3 Category 2: Solvency & Collateral Risk Controls

### 2.3.1 Isolation Mode (`isIsolatedCollateral`)
- **What It Does:** Flags newly listed or volatile collateral assets so that borrowers depositing them can **only borrow approved stablecoins** (e.g., USDC), and cannot use any other assets as collateral simultaneously.
- **Why It Is Critical in Production:** Standard Aave v3 risk primitive. It confines systemic contagion: if an isolated collateral token collapses to zero, only the isolated debt ceiling in stablecoins is at risk, preventing cross-collateral domino cascades.
- **What Happens If Omitted:** An exploited or manipulated collateral token can be used to borrow out blue-chip collateral (like wETH or WBTC), draining the protocol's highest-quality reserves.
- **Recommended Initial Calibration:**
  - `wETH`, `wUSDC`: Unisolated (Core Tier).
  - `HBAR`: Unisolated (Core Tier).
  - All new token listings: **Isolated Mode by default** with a $250,000 debt ceiling.

### 2.3.2 Asset Listing Tiering (`AssetRiskTier`)
- **What It Does:** Classifies registered assets into explicit risk tiers:
  - `TIER_1_CORE`: Eligible for supply, borrow, and collateral with maximum LTV (up to 90%).
  - `TIER_2_CROSS`: Eligible for supply and borrow, but lower LTV (max 70%) and lower borrow caps.
  - `TIER_3_ISOLATED`: Collateral-only; borrowable debt capped; isolated mode enforced.
- **Why It Is Critical in Production:** Replaces the naive binary `isActive` boolean in `AssetRegistry.sol` with granular risk segmentation.
- **What Happens If Omitted:** Risk parameters must be calibrated down to the lowest common denominator, destroying capital efficiency for blue chips.

### 2.3.3 Per-Asset Oracle Staleness Heartbeats (`stalenessThreshold[token]`)
- **What It Does:** Replaces the single global `stalenessThreshold = 120` in `PythOracleAdapter.sol` with asset-specific maximum allowable update intervals.
- **Why It Is Critical in Production:** Pyth price feeds update on different intervals based on trading activity. Highly volatile assets (HBAR, altcoins) require tight staleness checks (e.g., 30–60 seconds), whereas stablecoins (USDC) can tolerate 120–300 seconds.
- **What Happens If Omitted:** Volatile assets operate with stale prices for up to 2 minutes during extreme market crashes, causing liquidators to act on outdated pricing and saddling the protocol with bad debt.
- **Recommended Initial Range on Hedera:**
  - Volatile Crypto (`HBAR`, `wETH`): **30 – 60 seconds**
  - Stablecoins (`wUSDC`): **120 – 300 seconds**

### 2.3.4 Pyth Confidence Interval Ratio Cap (`maxConfRatio`)
- **What It Does:** Enforces that the Pyth confidence interval $\sigma_{\text{conf}}$ divided by spot price $P$ does not exceed a governance limit:
  $$\frac{\text{pythPrice.conf}}{\text{pythPrice.price}} \le \text{maxConfRatio} \quad (\text{e.g., } 1.5\% - 2.0\%)$$
- **Why It Is Critical in Production:** Pyth publishes price confidence metrics. During extreme illiquidity, exchange disconnections, or network forks, `conf` widens drastically. The contracts currently call `pyth.getPriceUnsafe()` and **completely ignore `conf`**, accepting garbage prices.
- **What Happens If Omitted:** Flash loans or low-volume exchange manipulation can feed erroneous prices into `PythOracleAdapter.sol`, allowing attackers to borrow full protocol reserves against worthless collateral.
- **Recommended Initial Range on Hedera:**
  - Normal Operation Cap: **$1.5\% – 2.0\%$** of spot price.
  - If $\text{conf} / \text{price} > 2.0\%$, new borrow originations revert (`ErrorLib.ConfidenceTooWide`).

### 2.3.5 Price Deviation Circuit Breaker & Min/Max Price Bands
- **What It Does:** Establishes hardcoded absolute boundaries (`minPrice`, `maxPrice`) and epoch-over-epoch price deviation limits ($\Delta P_{\text{max}} = 20\%$ per 10 minutes).
- **Why It Is Critical in Production:** Protects against catastrophic upstream oracle malfunctions (e.g., the Chainlink LUNA $0.001 minimum price bug, or Pyth feed ID corruption).
- **What Happens If Omitted:** If an oracle feed reports $0 or $1,000,000 due to an upstream glitch, the protocol will either liquidate every solvent borrower instantly or allow unbounded borrowing.
- **Recommended Initial Calibration:**
  - Set hard sanity bands per asset (e.g., USDC: $0.80 – $1.20; HBAR: $0.01 – $1.00; ETH: $500 – $10,000).

---

## 2.4 Category 3: Fee & Economics Parameters

### 2.4.1 Configurable & Tiered Reserve Factor (`reserveFactor[token]`)
- **What It Does:** Parameterizes the percentage of borrower interest redirected to protocol reserves rather than paid to passive lenders.
- **Why It Is Critical in Production:** Currently, `PROTOCOL_FEE = 0.10e18` (10%) is **hardcoded as a constant** in `BorrowVault.sol` and `InterestEngine.sol`. Different assets have vastly different risk profiles: stablecoins should have low reserve factors (10%) to maximize depositor APY, whereas volatile assets require higher reserve factors (20%–30%) to rapidly accumulate bad debt buffers.
- **What Happens If Omitted:** Protocol cannot dynamically manage reserve growth or adjust lender yields in response to competitor interest rate wars.
- **Recommended Initial Range on Hedera:**
  - Stablecoins (`wUSDC`): **$10\%$**
  - Major Collateral (`wETH`): **$15\% – 20\%$**
  - High-Beta Altcoins: **$25\% – 35\%$**

### 2.4.2 Flash Loan Fee (`flashLoanFee`)
- **What It Does:** If flash loans are enabled in `LendingPool.sol`, charges an instantaneous borrowing fee (e.g., 0.05% – 0.09%).
- **Why It Is Critical in Production:** Standard revenue driver across DeFi (Aave charges 0.05% / 0.09%; Morpho Blue charges 0%). Yield generated from flash loans directly subsidizes Stability Pool and LendingPool reserves without locking capital.
- **Recommended Initial Calibration:** **$0.05\%$** (5 bps).

### 2.4.3 Upfront Term-Origination Premium / Expected Shortfall Fee (`originationPremium`)
- **What It Does:** Charges a duration- and LTV-dependent origination fee collected in debt tokens at loan inception in `BorrowVault.openPosition`.
- **Why It Is Critical in Production:** Comprehensively researched in `docs/analysis/CRYPTO_STOCHASTIC_MODELING_AND_ES_PREMIUM_ANALYSIS.md`. Because Chrono offers higher short-term LTVs (up to 90%), borrowers must pay an upfront Expected Shortfall (ES) risk premium to compensate Stability Pool depositors for underwriting tail volatility. Currently, `contracts/core/BorrowVault.sol` **charges 0% origination fee**.
- **What Happens If Omitted:** Borrowers obtain ultra-high leverage ($10\times$) for free, leaving Stability Pool depositors undercompensated for tail-risk absorption.
- **Recommended Initial Range on Hedera:**
  - 1-Hour / 90% LTV Loan: **0.15% – 0.30%** of principal.
  - 1-Day / 84% LTV Loan: **0.10% – 0.20%** of principal.
  - 30-Day / 75% LTV Loan: **0.05%** of principal.

### 2.4.4 Loan Extension / Refinance Fee (`refinanceFee`)
- **What It Does:** Charges a fee when a borrower extends their borrow duration prior to expiration.
- **Why It Is Critical in Production:** In Chrono, extending duration lowers allowable LTV (since $LTV(t)$ decays over time). If a user refinances, they must either deposit more collateral or pay an administrative fee to update the Hedera Scheduled Transaction hook in `SchedulerEngine.sol`.
- **Recommended Initial Calibration:** **0.10%** of outstanding principal + reimbursement of HSS scheduling gas fees.

---

## 2.5 Category 4: Governance & Emergency Risk Controls

### 2.5.1 Granular Emergency Pause Guardians (`pauseFlags`)
- **What It Does:** Implements a bitmask or granular function-level pause system managed by an Emergency Guardian multi-sig or automated bot:
  - `PAUSE_BORROW`: Disables new position creation in `BorrowVault.sol`.
  - `PAUSE_DEPOSIT`: Disables new liquidity deposits in `LendingPool.sol`.
  - `PAUSE_LIQUIDATION`: Halts soft/hard liquidations during an active oracle feed outage.
  - `PAUSE_HSS`: Prevents `SchedulerEngine.sol` from executing scheduled calls during network partition.
- **Why It Is Critical in Production:** Currently, **`LendingPool.sol`, `BorrowVault.sol`, and `LiquidationEngine.sol` HAVE NO PAUSE MECHANISM**. If a zero-day exploit, reentrancy bug, or oracle desynchronization occurs, the protocol cannot be paused, allowing attackers to completely drain all funds.
- **What Happens If Omitted:** Fatal vulnerability. A compromised oracle or math edge case leads to total, irreversible protocol depletion.
- **Recommended Implementation:** OpenZeppelin `Pausable` with granular roles (`EMERGENCY_GUARDIAN_ROLE`).

### 2.5.2 Granular Asset Freezing (`isFrozen` vs. `isActive`)
- **What It Does:** Separates "deactivating" an asset from "freezing" an asset. When an asset is frozen:
  - Deposits and new borrows are disabled.
  - Repayments, collateral top-ups, withdrawals, and liquidations remain enabled.
- **Why It Is Critical in Production:** In `AssetRegistry.sol`, `deactivateAsset()` sets `isActive = false`. But in `BorrowVault.sol`, if `isActive == false`, existing users cannot interact cleanly. A frozen asset should allow borrowers to repay and exit safely without allowing new exposure.
- **What Happens If Omitted:** Governance cannot wind down a deprecating token cleanly without breaking existing borrower positions.

### 2.5.3 Configurable Grace Period Parameterization (`gracePeriod[token]`)
- **What It Does:** Replaces the hardcoded `uint256 public constant GRACE_PERIOD = 900;` (15 minutes) in `BorrowVault.sol` and `LiquidationEngine.sol` with a configurable governance parameter.
- **Why It Is Critical in Production:** High-volatility tokens or shorter-duration loans (e.g., 1-hour borrows) cannot tolerate a 15-minute grace period. A 15-minute grace period represents **25% of the entire lifetime** of a 1-hour loan! During this window, collateral can plummet while hard liquidation is blocked.
- **What Happens If Omitted:** Borrowers default on 1-hour loans at 90% LTV, and the protocol is forced to wait 15 minutes before executing hard liquidation, guaranteeing bad debt.
- **Recommended Calibration:**
  - 1-Hour to 24-Hour Loans: **180 – 300 seconds** (3 – 5 minutes)
  - Multi-Day / 30-Day Loans: **900 seconds** (15 minutes)

### 2.5.4 Liquidation Rate Limiting / Outflow Circuit Breaker (`maxLiquidationPerEpoch`)
- **What It Does:** Caps the maximum USD value of debt that can be liquidated within a rolling time window (e.g., max $500,000 per 30 minutes).
- **Why It Is Critical in Production:** Defends against flash-crash oracle anomalies where a single faulty price tick triggers cascading mass liquidations across the entire protocol before governance or keepers can intervene.
- **What Happens If Omitted:** A 1-minute Pyth oracle glitch can trigger simultaneous liquidations of 100% of protocol positions, permanently destroying borrower equity.
- **Recommended Initial Calibration:** **$250,000 – $500,000 USD** per 30-minute rolling epoch.

---

# SECTION 3: SYNTHESIZED ARCHITECTURAL VERDICT & ACTION PLAN

1. **Immediate Smart Contract Bug Fixes Required:**
   - **Fix the Final-Hour Revert:** In `RiskEngine.sol`, clamp `remainingDuration` to 0 or `minBorrowDuration` when computing health factor so that `softLiquidate` does not revert when $t_{\text{rem}} < 3600\text{ s}$.
   - **Fix Decimal Scaling:** Introduce decimal normalization factors across `BorrowVault.sol`, `LiquidationEngine.sol`, and `LendingPool.sol` to support 6-decimal stablecoins (`wUSDC`) and 8-decimal assets (`HBAR`, `WBTC`).
   - **Add Emergency Pausing:** Inherit OpenZeppelin's `Pausable` across all core protocol contracts with an `EmergencyGuardian` address.
2. **Simulation Engine (`sim/`) Calibration:**
   - Acknowledge that `NEG` is the only active contract model. Update `sim/` scripts to benchmark `NEG` directly against the CD3 dynamic liquidation engine ($D^*$).
   - Implement the CD3 closed-form formula in `sim/chrono_sim/protocol/fast/liquidation.py` to test whether dynamic sizing outperforms the legacy 50% close factor under historical replay.
3. **Parameter Registry Evolution:**
   - Migrate `AssetRegistry.sol` from single-token configurations to dual-tier pair/risk structures (`PairConfig` or `MarketConfig`) supporting supply caps, borrow caps, per-asset oracle heartbeats, and confidence interval gates.
