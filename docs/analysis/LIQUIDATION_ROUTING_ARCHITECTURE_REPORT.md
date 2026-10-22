# Liquidation Routing Architecture: Stability Pool Absorption vs. Open-Market Dutch Auctions

**Task Reference:** Task 10 (`docs/todo.md` / GitHub Issue #7)  
**Document Type:** Protocol Architectural Specification & Risk Analysis Report  
**Date:** October 22, 2026  
**Status:** Revised & Verified Specification (Draft 2)  

---

## 1. Executive Summary

### 1.1 Problem Statement & Core Objective
Chrono Protocol enforces two distinct liquidation triggers: pre-expiry soft liquidations driven by market price degradation ($HF \le 1.0$), and terminal hard liquidations executed at loan maturity ($t \ge T_{\text{expiry}}$) via the Hedera Schedule Service (HSS / HIP-1215) [^1][^2]. In current deployed contracts, liquidations follow a binary branch against the protocol's internal Stability Pool: if `canAbsorb()` returns true, debt is absorbed internally; otherwise, the execution defaults to external keeper clearance for soft liquidations, or transfers collateral to the contract owner for hard liquidations [^3].

This binary routing introduces two severe vulnerabilities:
1. **Reserve Cannibalization**: Unrestricted mid-loan soft liquidations drain Stability Pool stablecoin liquidity right before scheduled loan maturities arrive, rendering the pool incapable of absorbing terminal defaults [^4].
2. **Toxic Adverse Selection & Liquidity Freezes**: Forcing the Stability Pool to absorb rapidly crashing collateral during black swan drops saddles depositors with depreciating assets, while hard liquidations lacking adequate pool capital socialize debt haircuts directly onto lenders [^3][^4].

This report formulates a deterministic, mathematically grounded **Liquidation Routing Architecture** governing exact routing criteria between the Stability Pool and open-market Dutch Auctions.

### 1.2 Bottom Line Up Front (BLUF)
Chrono Protocol must implement a **Bifurcated Routing Matrix with Capacity-Gated Watermarks**:
- **Soft Liquidations ($HF \le 1.0$, Pre-Expiry)**: Must follow an **HSS Watermark-Gated Synchronous Routing** model. Instant Stability Pool absorption is permitted *only* when available liquidity strictly exceeds the **HSS Forward Watermark** ($D_{\text{reserved}}$ scheduled over the next 48 hours) and the position's Health Factor remains above the crash boundary ($HF \ge 0.85$). When $HF < 0.85$ or pool reserves fall below the watermark, soft liquidations route 100% to external keepers via the Chrono Dynamic-Discount Engine (CD3) [^4].
- **Hard Liquidations ($t \ge T_{\text{expiry}}$, Post-Expiry)**: Must differentiate **Solvent Liquidations** from **Distressed Liquidations**. Solvent liquidations ($V_{\text{coll}} \ge D_{\text{total}} + \text{Penalty}$) route with priority to the Stability Pool, returning excess surplus equity to the defaulting borrower under Uniform Commercial Code (UCC Article 9) principles [^2]. Distressed liquidations ($V_{\text{coll}} < D_{\text{total}}$) or under-capitalized pool events route to a proposed **Two-Phase Dutch Auction Fallback (Task 21)**, completely eliminating bad debt socialization [^3][^4].

### 1.3 Key Architectural Decisions & Recommendations
1. **P0 (Immediate)**: Implement an **HSS Forward Liquidity Watermark** in `LiquidationEngine.sol` that reserves Stability Pool stablecoins for deterministic upcoming loan expiries, preventing soft liquidations from depleting hard liquidation buffers [^4].
2. **P0 (Immediate)**: Replace the bad debt socialization branch in `executeHardLiquidation()` with a proposed **Open Dutch Auction Fallback** clearing underwater collateral against open market liquidity [^3][^4].
3. **P1 (Near-Term)**: Deploy the CD3 closed-form health-restoring partial debt calculation ($D^*$) to eliminate over-liquidation and preserve borrower equity [^4].
4. **P1 (Near-Term)**: Calibrate a dynamic risk-indexed threshold ($HF_{\text{crash}} = 0.85$) that shuts off Stability Pool absorption during high-volatility jump events, insulating depositors from adverse selection [^4].

---

## 2. Scope & Methodology

### 2.1 Scope Boundary
- **In-Scope**:
  - Routing logic for soft liquidations ($HF \le 1.0$, $t < T_{\text{expiry}}$) across varying pool liquidity states and volatility regimes.
  - Routing logic for hard liquidations ($t \ge T_{\text{expiry}}$) under solvent versus distressed collateral states.
  - Mathematical modeling of Stability Pool reserve constraints, adverse selection thresholds, and Dutch auction price curves.
  - Hedera Schedule Service (HIP-1215) interaction invariants and deterministic state transitions.
- **Explicitly Out-of-Scope**:
  - Off-chain frontend user interface rendering (deprecated in this monorepo) [^1].
  - Governance token voting tokenomics and DAO proposal tooling.
  - Custom cross-chain bridge contract development.

### 2.2 Sources Analyzed
- **Internal Smart Contracts**: [`LiquidationEngine.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/engines/LiquidationEngine.sol) [^3], [`StabilityPool.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/core/StabilityPool.sol) [^5], [`BorrowVault.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/core/BorrowVault.sol) [^6], [`AssetRegistry.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/core/AssetRegistry.sol) [^7].
- **Internal Research & Specs**: [`SOFT_LIQUIDATION_DUTCH_AUCTION_ANALYSIS.md`](file:///D:/MDG/personal_projects/chrono_hedera/docs/analysis/SOFT_LIQUIDATION_DUTCH_AUCTION_ANALYSIS.md) [^4], [`Chrono_Hard_Liquidation_Specification.md`](file:///D:/MDG/personal_projects/chrono_hedera/docs/Chrono_Hard_Liquidation_Specification.md) [^2], [`Chrono_Protocol_Whitepaper.md`](file:///D:/MDG/personal_projects/chrono_hedera/docs/Chrono_Protocol_Whitepaper.md) [^1].
- **External Benchmarks & Standards**: Euler Finance v2 Dutch Auction Architecture [^8], Morpho Blue Dynamic Liquidation Model [^9], Liquity v1/v2 Stability Pool Redistribution Mechanics [^10].

### 2.3 Evaluation Criteria & Scoring Rubric
Proposed routing mechanisms are evaluated along five quantitative and operational dimensions:
1. **Solvency Preservation (Weight: 30%)**: Immunity to bad debt accumulation across market flash crashes.
2. **Capital Efficiency & Depositor Yield (Weight: 25%)**: Maximization of organic yield generated for Stability Pool stakers without capital lockups.
3. **Execution Latency & MEV Immunity (Weight: 20%)**: Speed of execution on Hedera EVM and resistance to front-running or timer-reset griefing.
4. **Adverse Selection Protection (Weight: 15%)**: Shielding passive depositors from absorbing depreciating toxic collateral.
5. **Borrower Fairness & Loss Minimization (Weight: 10%)**: Minimization of penalty over-extraction and protection of residual surplus equity.

---

## 3. Technical & Domain Analysis

### 3.1 Structural Contrast: Soft vs. Hard Liquidations
Chrono Protocol's liquidation surface is bifurcated across operational triggers and liquidity prerequisites:

| Feature / Metric | Soft Liquidation ($HF \le 1.0$) [^4] | Hard Liquidation ($t \ge T_{\text{expiry}}$) [^2] |
| :--- | :--- | :--- |
| **Trigger Mechanism** | Continuous off-chain keeper or indexer detection [^3] | Deterministic autonomous HSS schedule (0x16b) [^1][^11] |
| **Position Condition** | Active loan, collateral price drop or interest accrual [^4] | Contractual maturity breach, loan expired [^2] |
| **Solvency State** | Undercollateralized ($HF \le 1.0$, but typically $V_{\text{coll}} > D_{\text{total}}$) [^1] | Typically overcollateralized ($HF > 1.0$), unless collateral crashed [^1] |
| **Repayment Sizing** | Partial health-restoring target debt ($D^*$) [^4] | Terminal 100% principal + accrued interest [^2] |
| **Borrower Status** | Retains loan; retains remaining collateral equity [^4] | Forfeits debt collateral + penalty; receives residual surplus [^2] |
| **Flash-Loan Viability** | 100% viable; external searchers supply capital just-in-time [^4] | Infeasible for autonomous scheduled transaction; requires internal liquidity [^4] |

### 3.2 Soft Liquidation Routing Dynamics

#### 3.2.1 The Limits of Continuous Dutch Auctions Under Market Crashes
Under a standalone continuous Dutch auction (Euler v2 model) [^8], collateral is auctioned over duration $T_{\text{auction}}$ with price decaying according to:
$$P(t) = P_{\text{oracle}} \cdot \left( (1 + \delta_{\text{start}}) - \frac{t}{T_{\text{auction}}} (\delta_{\text{start}} + \delta_{\text{max}}) \right)$$
Where $\delta_{\text{start}}$ is an initial premium (e.g. $+5\%$) and $\delta_{\text{max}}$ is the terminal discount (e.g. $-15\%$) [^4].

While effective in high-liquidity, slow-moving markets, this approach suffers from the **Fast-Crash Illiquidity Trap** on Hedera [^4]:
- In empirical stress modeling, if collateral price drops by 25% in 8 minutes, an auction decaying over 30 minutes with $\delta_{\text{max}} = 15\%$ remains completely out-of-the-money ($P_{\text{auction}} > P_{\text{market}}$) for the entire auction duration [^4].
- Liquidators refuse to execute because buying via the auction produces an immediate loss relative to spot markets [^4].
- Furthermore, keeper gas bounties create a free-rider coordination failure where no searcher initiates the transaction until profitability is guaranteed [^4].

#### 3.2.2 The CD3 Dynamic-Discount Engine
The Chrono Dynamic-Discount Engine (CD3) eliminates auction timers entirely by indexing the liquidation bonus directly to the real-time Health Factor [^4]:
$$\beta(HF) = \text{clamp}\left( \beta_{\text{base}} + \alpha_{\text{risk}} \cdot (1 - HF), \; \beta_{\text{base}}, \; \beta_{\text{max}} \right)$$
Where $\beta_{\text{base}} = 2.0\%$, $\alpha_{\text{risk}} = 0.50$, and $\beta_{\text{max}} = 12.0\%$ [^4].

Repayment is sized via the closed-form health-restoring quantity $D^*$, maintaining dimensional consistency across collateral and debt asset prices [^4]:
$$D^* = \frac{D \cdot HF_{\text{target}} - \frac{C \cdot P_{\text{coll}} \cdot LT}{P_{\text{debt}}}}{HF_{\text{target}} - LT \cdot (1 + \beta(HF))}$$
Where $D$ is current debt tokens, $C$ is collateral tokens, $LT$ is the liquidation threshold, $P_{\text{coll}}$ is collateral price in USD, $P_{\text{debt}}$ is debt price in USD, and $HF_{\text{target}} = 1.05$ [^4]. This sizing restores the loan to healthy status while eliminating excessive collateral seizure [^4].

#### 3.2.3 Routing Policy for Soft Liquidations
To prevent the Reserve Cannibalization Trap [^4], soft liquidations must follow a strict three-tier routing decision tree:

```
                            [ POSITION HEALTH FACTOR HF <= 1.0 ]
                                              │
                                              ▼
                             [ EVALUATE ADVERSE SELECTION ]
                                     Is HF < 0.85?
                                    ├─── YES ───► ROUTE TO EXTERNAL KEEPERS (CD3)
                                    │             (Zero Stability Pool Capital at Risk)
                                    └─── NO  ───┐
                                                ▼
                             [ EVALUATE HSS FORWARD WATERMARK ]
                                Is SP_balance - D* >= D_reserved?
                                    ├─── YES ───► ABSORB IN STABILITY POOL AT beta_SP
                                    │             (Yield to Passive Depositors)
                                    └─── NO  ───► ROUTE TO EXTERNAL KEEPERS (CD3)
                                                  (Preserve Liquidity for Loan Expiries)
```

1. **Adverse Selection Volatility Shield ($HF < 0.85$)**: When $HF < 0.85$, the collateral asset is in rapid price collapse. The Stability Pool is locked to prevent depositors from absorbing depreciating collateral ("falling knives") [^4]. External liquidators absorb 100% of the liquidation via CD3, hedging externally on decentralized exchanges [^4].
2. **HSS Forward Watermark Gate**: The Stability Pool contract evaluates scheduled expiries over the forward rolling window $\Delta t_{\text{forward}} = 48\text{ hours}$:
   $$D_{\text{reserved}} = \sum_{k} \text{ScheduledBucket}_k \quad \forall \; t_{k} \le \text{block.timestamp} + \Delta t_{\text{forward}}$$
   To avoid $O(N)$ iteration reverts on Hedera EVM, scheduled expiries are accumulated into discrete hourly maturity buckets (`mapping(uint256 => uint256) private _scheduledDebtByBucket`) updated on loan origination and repayment [^4][^6].
   If available stablecoin reserves minus $D^*$ would violate $D_{\text{reserved}}$, the pool rejects the soft liquidation, routing execution to external keepers [^4].

### 3.3 Hard Liquidation Routing Dynamics

#### 3.3.1 Differentiating Solvent vs. Distressed Liquidations
In `LiquidationEngine.sol`, an expired loan ($t \ge T_{\text{expiry}} + \text{GRACE\_PERIOD}$) is evaluated for total debt value and total collateral value [^3]:
$$V_{\text{debt}} = D_{\text{total}} \cdot P_{\text{debt}}, \quad V_{\text{coll}} = C \cdot P_{\text{coll}}$$
The default penalty is calculated as:
$$\text{Penalty} = \max\left( V_{\text{debt}} \cdot \text{hardLiqPenalty}, \; V_{\text{coll}} \cdot \text{hardLiqCollateralFloor} \right)$$
Where $\text{hardLiqPenalty} = 12\%$ and $\text{hardLiqCollateralFloor} = 2.5\%$ [^2][^3].

This creates two distinct liquidation regimes:
1. **Solvent Hard Liquidation ($V_{\text{coll}} \ge V_{\text{debt}} + \text{Penalty}$)**:
   - Required collateral $C_{\text{req}} = \frac{V_{\text{debt}} + \text{Penalty}}{P_{\text{coll}}}$ is less than total position collateral $C$ [^2][^3].
   - Residual collateral $C_{\text{surplus}} = C - C_{\text{req}}$ exists and must be remitted to `pos.borrower` [^2].
2. **Distressed Hard Liquidation ($V_{\text{coll}} < V_{\text{debt}} + \text{Penalty}$)**:
   - Position is underwater or near-water. All collateral $C$ is insufficient to cover both debt and the full penalty [^3].
   - If $V_{\text{coll}} < V_{\text{debt}}$, the position represents immediate bad debt [^3].

#### 3.3.2 Solvent Hard Liquidations: Stability Pool Priority & Surplus Remittance
For solvent positions, the Stability Pool is the optimal liquidation venue [^2]:
- **Instantaneous Settlement**: Stability Pool stablecoins are transferred directly to `LendingPool.sol`, satisfying the Lender Invariant ($100\%$ principal recovery) [^2][^3].
- **High Depositor Yield**: The 12% penalty is split: 75% ($9.0\%$ effective) to Stability Pool depositors, and 25% ($3.0\%$ effective) to the LendingPool Bad Debt Reserve [^2][^3].
- **Surplus Remittance**: Residual collateral $C_{\text{surplus}}$ is refunded directly to `pos.borrower` [^2][^3]. Under the Uniform Commercial Code (specifically UCC § 9-608 and § 9-615), a secured creditor who liquidates collateral must remit residual proceeds to the debtor after satisfaction of obligations and administrative expenses [^2]. Confiscating borrower surplus creates an inverted risk penalty that punishes conservative low-LTV borrowers and deters institutional capital [^2].

#### 3.3.3 Distressed Liquidations: Proposed Two-Phase Dutch Auction Fallback
Under status quo v1 (`LiquidationEngine.sol:196-206`), when `stabilityPool.canAbsorb()` returns false, the protocol seizes collateral to `owner()` and socializes bad debt onto lenders [^3].

This failure mode is resolved by introducing a **Two-Phase Dutch Auction Fallback (Task 21)** for Hard Liquidations [^4]:

```
                       [ HARD LIQUIDATION TRIGGERED AT EXPIRY ]
                                          │
                                          ▼
                         [ CAN STABILITY POOL ABSORB DEBT? ]
                           Is SP_balance >= TotalDebt AND
                                Collateral Solvent?
                                ├─── YES ───► STABILITY POOL ABSORPTION
                                │             • LendingPool made 100% whole
                                │             • 75/25 Penalty split to SP/Reserve
                                │             • Residual surplus refunded to borrower
                                └─── NO  ───┐
                                            ▼
                         [ ROUTE TO PUBLIC DUTCH AUCTION (TASK 21) ]
                         Phase 1: Rapid Clearing Window (15 mins)
                           • Auction price decays from P_coll to P_floor
                           • P_floor = (V_debt + Penalty) / C
                           • External liquidators repay debt tokens
                           • Residual surplus returned to borrower upon clearing
                                            │
                                  [ IF UNFILLED AFTER 15 MINS ]
                                            ▼
                         Phase 2: Distressed Solvency Window (30 mins)
                           • Auction decays below P_floor down to 0
                           • Maximizes capital recovery for LendingPool
                           • Borrower surplus permanently revoked (0 refund)
```

1. **Phase 1 (Solvent Clearing Window)**: Lasts 15 minutes. The auction price starts at $P_{\text{oracle}}$ and decays linearly toward the debt floor price $P_{\text{floor}} = \frac{V_{\text{debt}} + \text{Penalty}}{C}$. If an external bidder settles the auction, debt is repaid to `LendingPool`, the penalty is credited to protocol reserves, and residual collateral is remitted to the borrower [^2].
2. **Phase 2 (Distressed Deep Discount Window)**: If market conditions prevent Phase 1 execution, the auction price decays from $P_{\text{floor}}$ toward zero over 30 minutes. All proceeds go directly to `LendingPool` to minimize bad debt haircut size [^3]. Borrower surplus is strictly zero [^2].

---

### 3.4 Comprehensive Tradeoff Evaluation Matrix

We compare the three architectural regimes for liquidation routing:

| Evaluation Dimension | Regime 1: Binary SP / Socialization (Status Quo v1) [^3] | Regime 2: Unconstrained Hybrid Dutch Auction [^4] | Regime 3: Bifurcated Watermark-Gated Routing (Proposed) [^4] |
| :--- | :--- | :--- | :--- |
| **Solvency Preservation** | ❌ **High Risk**: Bad debt socialized whenever SP exhausted. | ⚠️ **Moderate**: Auction decay latency exposes protocol to crash slippage. | ✅ **Robust**: HSS forward watermark guarantees liquidity for scheduled expiries. |
| **SP Cannibalization** | ❌ **Unprotected**: Soft liquidations freely consume hard liquidation reserves. | ⚠️ **Unprotected**: Continuous competition between soft and hard liquidations. | ✅ **Protected**: Dynamic forward reserve watermark rings-fences loan maturity funds. |
| **Adverse Selection** | ❌ **Zero Shield**: SP absorbs toxic debt at fixed bonus regardless of market drop. | ⚠️ **Partial**: Auctions price drop, but SP takes early toxic fills. | ✅ **Shielded**: $HF < 0.85$ hard cutoff routes toxic crashes to external flash-loan keepers. |
| **Borrower Fairness** | ⚠️ **Flawed**: Surplus refunded even if lenders suffer bad debt haircut. | ⚠️ **Poor**: Dutch auction decay can erode borrower equity unnecessarily. | ✅ **Optimal**: Strict 3-tier waterfall protects surplus while enforcing lender recovery. |
| **Hedera EVM Overhead** | ✅ **Low Gas**: Stateless on-chain checks (<65k gas) [^3]. | ❌ **High Gas**: Storage-heavy auction clocks and timer tracking (>150k gas) [^4]. | ✅ **Optimized**: Stateless CD3 execution (<85k gas) [^4]; Dutch fallback storage writes incurred only on SP exhaustion. |

---

## 4. Synthesis & Risk Assessment

### 4.1 Synthesis of Findings
The analysis establishes that attempting to route all protocol liquidations through a single mechanism is fundamentally flawed. 
- The **Stability Pool** is the premier settlement vehicle for **scheduled, deterministic loan maturities**, where capital must be ready instantaneously without relying on external searcher participation [^2][^4].
- External **Dynamic CD3 Liquidations** are the premier settlement vehicle for **unpredictable, market-driven soft liquidations**, where global flash-loan liquidity can absorb unbounded volume at zero balance-sheet cost to protocol depositors [^4].

Coupling the two through an **HSS-aware forward liquidity watermark** eliminates the mutual vulnerability of reserve cannibalization while maximizing depositor returns [^4].

### 4.2 Failure Modes & Security Edge Cases

#### 4.2.1 The Cascading Maturity Cliff
- **Scenario**: A correlated market downturn coincides with a large cluster of loans expiring simultaneously via HSS [^4].
- **Failure Mode**: Even with watermark gating, aggregate default volume exceeds total Stability Pool capacity ($D_{\text{total}} > \text{SP}_{\text{balance}}$) [^3].
- **Proposed Protocol Defense (Task 21)**: The Two-Phase Dutch Auction Fallback activates immediately. The contract does not halt or socialize debt; instead, scheduled maturities that cannot be absorbed by the pool transition into Phase 1 public auctions [^4].

#### 4.2.2 Oracle Latency & Front-Running During Dutch Auctions
- **Scenario**: Collateral price drops rapidly while a Dutch auction is decaying [^4].
- **Failure Mode**: Keepers wait for the auction price to hit an extreme discount, capturing an excessive profit margin at the expense of protocol reserves [^4].
- **Protocol Defense**: The Dutch auction decay slope is governed by asset-tier decay parameters proposed for `AssetConfig`, and the CD3 dynamic bonus ceiling is clamped at $\beta_{\text{max}} = 12\%$ [^4][^7].

#### 4.2.3 Borrower Flapping & Front-Running Griefing
- **Scenario**: A distressed borrower submits a dust repayment transaction to interrupt an in-progress liquidation or reset their liquidation clock [^4].
- **Protocol Defense**: All routing gates and partial repayment calculations ($D^*$) are stateless and recomputed atomically at transaction execution time. A dust repayment merely reduces remaining debt by $\$0.01$ and fails to reset any protocol locks [^4].

### 4.3 Limitations of the Analysis
- **DEX Slippage Bounds**: The efficiency of external Dutch auctions relies on available secondary market liquidity (e.g. SaucerSwap V2 on Hedera) [^12]. If DEX liquidity is illiquid, keeper execution discounts will widen.
- **Hedera Consensus Timestamp Jitter**: Although HSS executions are deterministic, slight consensus timestamp variations require maintaining the calibrated 15-minute grace period buffer [^2][^3].

---

## 5. Actionable Recommendations

### 5.1 Prioritized Implementation Plan

| Priority | Task Description | Target File / Module | Rationale & Justification |
| :---: | :--- | :--- | :--- |
| **P0** | **Implement HSS Forward Reserve Watermark** | [`LiquidationEngine.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/engines/LiquidationEngine.sol), [`BorrowVault.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/core/BorrowVault.sol) | Accumulates scheduled debt into hourly maturity buckets; prevents soft liquidations from depleting loan default reserves [^4]. |
| **P0** | **Implement Two-Phase Dutch Auction Fallback (Task 21)** | [`LiquidationEngine.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/engines/LiquidationEngine.sol) | Replaces bad debt socialization (`seizeCollateral(owner)`) with two-phase open-market debt clearance [^3][^4]. |
| **P1** | **Integrate CD3 Closed-Form Partial Debt ($D^*$)** | [`LiquidationEngine.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/engines/LiquidationEngine.sol), [`MathLib.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/libraries/MathLib.sol) | Eliminates arbitrary 50% close factor; restores positions to $HF = 1.05$ with minimal borrower penalty [^4]. |
| **P1** | **Enforce Adverse Selection Cutoff ($HF < 0.85$)** | [`LiquidationEngine.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/engines/LiquidationEngine.sol) | Shields Stability Pool depositors from absorbing toxic falling-knife assets during market crashes [^4]. |
| **P2** | **Dynamic Grace-Period Penalty Ramp** | [`LiquidationEngine.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/engines/LiquidationEngine.sol) | Linear penalty scale over the 15-minute grace window to deter borrower concierge exit strategies [^2]. |
| **P2** | **Extend AssetConfig for Dutch Auction Parameters** | [`AssetRegistry.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/core/AssetRegistry.sol), [`IAssetRegistry.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/interfaces/IAssetRegistry.sol) | Adds `auctionDecaySlope` and `auctionDuration` parameters to configure per-asset Dutch auction rates [^7]. |

---

## 6. Glossary

| Term | Plain English Definition |
| :--- | :--- |
| **BLUF** | Bottom Line Up Front; an executive summary stating conclusions and strategic verdicts at the beginning of a document. |
| **CD3 Engine** | Chrono Dynamic-Discount Engine; a stateless liquidation pricing mechanism where the bonus scales dynamically with loan health factor [^4]. |
| **Close Factor** | The maximum percentage of a position's outstanding debt that can be liquidated in a single transaction (e.g. 50%) [^4]. |
| **Closed-Form Debt ($D^*$)** | The exact mathematical quantity of debt that must be repaid to return an undercollateralized loan to a target healthy status [^4]. |
| **Concierge Exit** | A moral hazard where borrowers intentionally neglect manual repayment because liquidation penalties are lower than repayment friction or trading slippage [^2]. |
| **Debt Floor Price ($P_{\text{floor}}$)** | The minimum price per collateral token required to fully settle outstanding principal, interest, and liquidation penalties without bad debt [^2]. |
| **Fast-Crash Illiquidity Trap** | A failure mode where market prices fall faster than an auction decays, leaving an auction out-of-the-money and causing bad debt [^4]. |
| **Hard Liquidation** | Protocol liquidation triggered strictly by the arrival of a loan's maturity date on the Hedera Schedule Service [^2]. |
| **Hedera Schedule Service (HSS)** | A native Hedera network precompile (0x16b / HIP-1215) that executes future transactions autonomously without keeper bots [^1][^11]. |
| **HSS Forward Watermark ($D_{\text{reserved}}$)** | A minimum threshold of Stability Pool capital locked to cover loans scheduled to expire within a rolling forward time window (e.g. 48 hours) [^4]. |
| **Maximal Extractable Value (MEV)** | Value that miners, validators, or searcher bots can extract by reordering, front-running, or inserting transactions within a consensus stream [^4]. |
| **Reserve Cannibalization** | The systemic risk where mid-loan soft liquidations consume pool stablecoins needed to backstop terminal loan defaults [^4]. |
| **Soft Liquidation** | Protocol liquidation triggered before loan maturity when collateral price decline causes Health Factor to drop below 1.0 [^4]. |
| **Solvent Hard Liquidation** | A hard liquidation where the total collateral value exceeds the outstanding debt plus the default penalty [^2]. |
| **Stability Pool** | An internal protocol pool of deposited stablecoins used as the primary liquidity source to instantly absorb defaulted debt [^5]. |
| **Uniform Commercial Code (UCC Article 9)** | Commercial law standard (§ 9-608 / § 9-615) requiring secured creditors to remit residual surplus collateral proceeds to the borrower upon debt settlement [^2]. |

---

## 7. References

[^1]: Chrono Protocol Architecture & Engineering Team, *Chrono Protocol Whitepaper: The Duration-Bound Money Market on Hedera*, Project Documentation, Section 3.1, 2026. [`docs/Chrono_Protocol_Whitepaper.md`](file:///D:/MDG/personal_projects/chrono_hedera/docs/Chrono_Protocol_Whitepaper.md).
[^2]: Chrono Risk Architecture Team, *Chrono Protocol: Hard Liquidation Architecture & Settlement Specification*, Project Specification, 2026. [`docs/Chrono_Hard_Liquidation_Specification.md`](file:///D:/MDG/personal_projects/chrono_hedera/docs/Chrono_Hard_Liquidation_Specification.md).
[^3]: Chrono Protocol Core Contracts, *LiquidationEngine.sol: Implementation of soft and hard liquidation routines*, Smart Contract Source Code, lines 54–211, 2026. [`contracts/engines/LiquidationEngine.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/engines/LiquidationEngine.sol).
[^4]: Chrono Chief Risk Decision-Maker, *Soft Liquidation Architecture: Strategic Risk Analysis, Mechanism Evaluation & Definitive Architectural Blueprint*, Architectural Research Report, Sections 1.3, 2.1, 2.2, 5.1, and 8.1–8.5, 2026. [`docs/analysis/SOFT_LIQUIDATION_DUTCH_AUCTION_ANALYSIS.md`](file:///D:/MDG/personal_projects/chrono_hedera/docs/analysis/SOFT_LIQUIDATION_DUTCH_AUCTION_ANALYSIS.md).
[^5]: Chrono Protocol Core, *StabilityPool.sol: Scaled deposit model and bad debt absorption*, Smart Contract Source Code, 2026. [`contracts/core/StabilityPool.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/core/StabilityPool.sol).
[^6]: Chrono Protocol Core, *BorrowVault.sol: Collateral custody and position management*, Smart Contract Source Code, 2026. [`contracts/core/BorrowVault.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/core/BorrowVault.sol).
[^7]: Chrono Protocol Core, *AssetRegistry.sol: Asset risk parameter storage and validation*, Smart Contract Source Code, 2026. [`contracts/core/AssetRegistry.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/core/AssetRegistry.sol).
[^8]: Euler Finance, *Euler Vault Kit (EVK) Technical Whitepaper & Liquidation Dutch Auction Specification*, Technical Specification, 2024. https://github.com/euler-xyz.
[^9]: Morpho Labs, *Morpho Blue Whitepaper: Stateless and Efficient Lending Primitive*, Protocol Whitepaper, 2024. https://morpho.org.
[^10]: Liquity AG, *Liquity Protocol: A Decentralized Borrowing Protocol with Instant Liquidation*, Technical Documentation, 2021. https://docs.liquity.org.
[^11]: Hedera Improvement Proposal (HIP), *HIP-1215: Hedera Schedule Service System Contract for Scheduled Transactions*, HSS Precompile at 0x16b, Hedera Standards, 2024. https://github.com/hiero-ledger/hiero-improvement-proposals/blob/main/HIP/hip-1215.md.
[^12]: SaucerSwap Community, *SaucerSwap V2 Automated Market Maker: Concentrated Liquidity and Swap Routing on Hedera*, Documentation, 2024. https://docs.saucerswap.finance.
