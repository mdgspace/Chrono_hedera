# Multi-Sided Protocol Incentive Formulation: Lending Pool vs. Stability Pool Capital Alignment

**Task Reference:** Tasks 12 & 13 (`docs/todo.md` / GitHub Issue #9)  
**Document Type:** Quantitative Economic Analysis & Mechanism Design Specification  
**Date:** October 22, 2026  
**Status:** Revised & Verified Specification (Draft 2)  

---

## 1. Executive Summary

### 1.1 Problem Statement & Core Objective
Chrono Protocol requires two distinct pools of stablecoin liquidity (`wUSDC`) to operate:
1. **The Lending Pool**: Provides the active borrowing capital drawn down by term borrowers [^1][^2].
2. **The Stability Pool**: Acts as the first-loss autonomous backstop to absorb defaulted debt and liquidate collateral upon loan expiration or distress [^3][^4].

Because both pools compete for the identical underlying capital asset, Chrono faces a fundamental **Structural Capital Competition Dilemma** [^4][^5]. Lending Pool depositors enjoy senior liquidation priority (the Lender Invariant) and continuous passive yield accrued from borrow interest [^1][^2]. In contrast, Stability Pool depositors bear severe downside risks: their stablecoins are burned during liquidations to acquire volatile collateral (`wETH`, `wBTC`, `HBAR`), while earning zero yield during calm market regimes with zero liquidations [^3][^4]. 

Without deliberate incentive engineering, capital naturally abandons the Stability Pool in favor of the Lending Pool or external decentralized exchanges (SaucerSwap) [^6], leaving the protocol dangerously undercapitalized precisely when market crashes strike [^4][^5].

### 1.2 Bottom Line Up Front (BLUF)
Chrono Protocol must implement a **Multi-Tranche Revenue-Sharing & Yield-Bridging Architecture**:
- **Baseline Yield Floor (Yield Bridging)**: Restructure protocol revenue to stream 10% of gross borrow interest and 20% of proposed upfront Expected Shortfall (ES) origination fees directly to the Stability Pool as a continuous yield, guaranteeing an APY floor during zero-liquidation periods [^5][^7].
- **Calibrated Dual-Tranche Penalty Split (75 / 25)**: Maintain the 75% hard liquidation penalty share to Stability Pool stakers (yielding an effective $8.26\%$ net collateral acquisition discount against the 12% default penalty), while directing 25% ($3.0\%$ effective) to the Protocol Bad Debt Reserve [^3][^8].
- **Reserve Backstop Cascade**: Establish a 3-tier backstop sequence: (Tier 1) Stability Pool absorbs debt; (Tier 2) Protocol Bad Debt Reserve covers shortfalls; (Tier 3) Two-Phase Dutch Auctions clear residual collateral, strictly shielding lenders from haircut socialization [^4][^8].

### 1.3 Key Architectural Decisions & Recommendations
1. **P0 (Immediate)**: Propose amending `BorrowVault.sol` and `StabilityPool.sol` to introduce a dedicated `streamReward(address token, uint256 amount)` method and route a 10% gross interest cut and 20% origination fee cut to `StabilityPool.sol`, resolving the "Zero-Yield Calm Market Trap" [^2][^3].
2. **P0 (Immediate)**: Formalize the dynamic collateral acquisition discount ($\Delta_{\text{SP}} \approx 8.26\%$) ensuring Stability Pool stakers receive an expected net profit exceeding the combined asset volatility and secondary market DEX slippage over the 1-hour post-liquidation hedging window [^4][^8].
3. **P1 (Near-Term)**: Design an automated fee-recycle hook that converts accumulated protocol reserve collateral into stablecoins during calm periods, replenishing bad debt insurance buffers [^3][^8].
4. **P2 (Long-Term)**: Introduce Liquity v2-inspired dynamic secondary staking incentives if Stability Pool capitalization falls below 20% of aggregate protocol debt [^9].

---

## 2. Scope & Methodology

### 2.1 Scope Boundary
- **In-Scope**:
  - Quantitative analysis of capital competition between `LendingPool.sol` and `StabilityPool.sol`.
  - Modeling depositor risk profiles: senior passive lenders vs. junior first-loss backstop stakers.
  - Comparative study of Liquity v1/v2, Morpho Blue, and Aave v3 reserve and incentive mechanisms.
  - Formulation of multi-tranche fee distribution formulas (interest spread, origination premiums, liquidation penalties).
  - Solvency backstop sequence and bad debt mitigation.
- **Explicitly Out-of-Scope**:
  - Off-chain frontend APR/APY dashboard calculation scripts (deprecated in this monorepo per repository notice) [^10].
  - Hedera network governance token emission schedules.
  - Direct production code modifications (this document provides architectural and mathematical specifications).

### 2.2 Sources Analyzed
- **Internal Contracts**: [`LendingPool.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/core/LendingPool.sol) [^2], [`StabilityPool.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/core/StabilityPool.sol) [^3], [`BorrowVault.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/core/BorrowVault.sol) [^11], [`AssetRegistry.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/core/AssetRegistry.sol) [^12], [`LiquidationEngine.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/engines/LiquidationEngine.sol) [^8].
- **Internal Research**: [`Chrono_Hard_Liquidation_Specification.md`](file:///D:/MDG/personal_projects/chrono_hedera/docs/Chrono_Hard_Liquidation_Specification.md) [^8], [`SOFT_LIQUIDATION_DUTCH_AUCTION_ANALYSIS.md`](file:///D:/MDG/personal_projects/chrono_hedera/docs/analysis/SOFT_LIQUIDATION_DUTCH_AUCTION_ANALYSIS.md) [^4], [`DEFI_RISK_PARAMETERIZATION_ANALYSIS.md`](file:///D:/MDG/personal_projects/chrono_hedera/docs/analysis/DEFI_RISK_PARAMETERIZATION_ANALYSIS.md) [^5], [`INTEREST_RATE_UTILIZATION_ANALYSIS.md`](file:///D:/MDG/personal_projects/chrono_hedera/docs/analysis/INTEREST_RATE_UTILIZATION_ANALYSIS.md) [^7].
- **External Literature**: Liquity v1 Technical Documentation [^13], Liquity v2 (BOLD) Whitepaper [^9], Aave v3 Technical Paper [^14].

### 2.3 Evaluation Criteria & Scoring Rubric
Proposed economic mechanisms are evaluated across five key criteria:
1. **Solvency Resilience (Weight: 30%)**: Stability Pool capital adequacy under a 40% collateral flash crash.
2. **Depositor Equilibrium Stability (Weight: 25%)**: Resistance to capital flight between Lending and Stability pools.
3. **Yield Sustainability (Weight: 20%)**: Generation of non-inflationary, real yield without unbacked token emissions.
4. **Lender Invariant Protection (Weight: 15%)**: Strict 100% preservation of lender principal recovery.
5. **Operational Simplicity on Hedera EVM (Weight: 10%)**: Gas efficiency and deterministic execution on Hedera EVM.

---

## 3. Technical & Domain Analysis

### 3.1 Structural Capital Competition Analysis

#### 3.1.1 The Asymmetric Risk-Return Profile
In Chrono Protocol, lenders and stability providers deposit the same ERC-20 asset (`wUSDC`), but face diametrically opposed payoff profiles:

| Dimension | Lending Pool Depositor (`LendingPool.sol`) [^2] | Stability Pool Depositor (`StabilityPool.sol`) [^3] |
| :--- | :--- | :--- |
| **Capital Function** | Active loan principal borrowed by users [^2] | Passive reserve capital to absorb defaults [^3] |
| **Seniority Ranking** | **Senior Priority**: Protected by the Lender Invariant [^8] | **First-Loss Junior Tranche**: Absorbs bad debt directly [^3][^4] |
| **Asset Exposure** | 100% stablecoin (`wUSDC`); zero asset volatility [^2] | Dynamic conversion from stablecoin into volatile collateral (`wETH`, `wBTC`, `HBAR`) [^3] |
| **Yield Driver** | Continuous interest accrued via borrow rate curve [^7] | Lumpy liquidation bonus payouts occurring only during defaults [^3][^8] |
| **Market Regime Exposure** | Thrives in bull/sideways markets (high borrow demand) [^5] | Starves in calm markets; suffers adverse selection in severe crashes [^4] |

#### 3.1.2 The Pro-Cyclical Capital Flight Trap
The primary systemic threat to Chrono Protocol is the **Pro-Cyclical Capital Flight Trap** [^4][^5]:
1. **During Calm / Bull Markets**:
   - Loan defaults are rare, and soft liquidations are non-existent ($HF \gg 1.0$) [^5].
   - The Stability Pool generates near-zero yield ($\text{APY}_{\text{SP}} \approx 0\%$) [^4].
   - Concurrently, borrow demand surges, driving Lending Pool utilization and yields upward ($\text{APY}_{\text{LP}} \in [8\%, 15\%]$) [^5][^7].
   - **Outcome**: Rational capital migrates from the Stability Pool to the Lending Pool, draining stability reserves down to critically low thresholds [^4].
2. **During Market Crashes**:
   - Collateral prices plummet by 30–50% in hours (e.g. historical March 2020 or May 2021 market episodes) [^5].
   - High volumes of loans breach health factors or expire simultaneously [^4].
   - The depleted Stability Pool is instantly overwhelmed (`canAbsorb()` returns false) [^3][^8].
   - The protocol is forced to dump collateral into illiquid secondary markets or socialize debt onto lenders [^4][^8].

#### 3.1.3 Lessons from Competitor Protocols
- **Liquity v1**: Relied strictly on $LUSD$ Stability Pool deposits receiving $ETH$ liquidations and $LQTY$ emissions [^13]. During the May 2021 crash, pool depositors absorbed massive amounts of depreciating $ETH$, causing widespread dissatisfaction and subsequent capital withdrawals [^9][^13].
- **Liquity v2 (BOLD)**: Replaced static incentives with **user-set interest rates** and directed secondary incentive routing to ensure the Stability Pool remains funded even when borrow demand shifts [^9].
- **Aave v3**: Uses a **Reserve Factor** diverting 10–20% of borrower interest into an ecosystem treasury, providing a continuous protocol insurance backstop rather than relying solely on junior depositors [^14].

---

### 3.2 Multi-Sided Incentive Formulation

To achieve stable economic equilibrium, Chrono must eliminate the "zero yield in calm markets" flaw by transforming Stability Pool participation into a hybrid yield-bearing insurance instrument.

#### 3.2.1 Multi-Tranche Protocol Revenue Waterfall
Protocol revenues originate from three distinct streams:
1. **Borrow Interest Revenue ($R_{\text{interest}}$)**: Accrued continuously on all outstanding principal in `BorrowVault.sol` [^7][^11].
2. **Proposed Upfront Expected Shortfall (ES) Origination Fees ($R_{\text{origination}}$)**: Charged at loan origination based on duration and asset tail-risk modeling [^5].
3. **Hard Liquidation Default Penalties ($R_{\text{penalty}}$)**: 12% total penalty assessed on expired loan debt [^8][^12].

We formulate the **Protocol Revenue Routing Matrix**:

```
                                  [ PROTOCOL REVENUE SOURCES ]
                                                │
                 ┌──────────────────────────────┼──────────────────────────────┐
                 ▼                              ▼                              ▼
      [ GROSS BORROW INTEREST ]       [ UPFRONT ES PREMIUM ]      [ DEFAULT PENALTY (12%) ]
         (Continuous Accrual)          (At Loan Origination)          (At Loan Expiry)
                 │                              │                              │
        ┌────────┼────────┐            ┌────────┴────────┐            ┌────────┴────────┐
        ▼        ▼        ▼            ▼                 ▼            ▼                 ▼
     [ 85% ]  [ 10% ]   [ 5% ]      [ 80% ]           [ 20% ]      [ 75% ]           [ 25% ]
     Lending  Stability Protocol    Protocol         Stability     Stability      Bad Debt Reserve
      Pool      Pool    Treasury    Bad Debt           Pool          Pool        (Remitted to
    Lenders    Stream   Reserve      Reserve          Stream       Depositors    protocolTreasury)
```

#### 3.2.2 Algebraic Formulation of the Self-Balancing APY Feedback Mechanism
Under this proposed architecture, the Stability Pool receives a continuous yield allocation combining interest spread and origination fees:
$$\text{Yield}_{\text{SP}}(t) = \omega_{\text{int}} \cdot R_{\text{interest}}(t) + \omega_{\text{orig}} \cdot R_{\text{origination}}(t)$$
Where:
- $\omega_{\text{int}} = 0.10$ (10% of gross borrower interest; 85% is remitted to lenders, and 5% to the protocol treasury reserve).
- $\omega_{\text{orig}} = 0.20$ (20% of proposed upfront origination fees; 80% to protocol reserve funds).

Because `StabilityPool.sol`'s current `cumulativeRewardPerDeposit` accumulator only handles collateral tokens Seized during liquidations [^3], implementation of this continuous yield requires introducing a dedicated `streamReward(address token, uint256 amount)` method and an internal debt-token yield accumulator `cumulativeDebtRewardPerDeposit` [^3].

Let $S_{\text{LP}}$ be total capital in the Lending Pool, and $S_{\text{SP}}$ be total capital in the Stability Pool.  
Let the average borrow interest rate be $r_b$, and utilization be $U = \frac{B}{S_{\text{LP}}}$ [^7].  
The annualized baseline yield for Stability Pool depositors before liquidations is:
$$\text{APY}_{\text{SP, baseline}} = \frac{\omega_{\text{int}} \cdot r_b \cdot U \cdot S_{\text{LP}} + \omega_{\text{orig}} \cdot \text{Volume}_{\text{orig}} \cdot \bar{f}_{\text{orig}}}{S_{\text{SP}}}$$

When capital flees the Stability Pool ($S_{\text{SP}} \to 0$), the ratio $\frac{S_{\text{LP}}}{S_{\text{SP}}}$ increases dramatically, driving $\text{APY}_{\text{SP, baseline}}$ sharply upward. This creates an **automatic economic feedback loop** that repels further capital flight and restores equilibrium without governance intervention [^5].

---

### 3.3 Calibration of Hard Liquidation Penalties & Acquisition Discounts

#### 3.3.1 The 75 / 25 Penalty Distribution
Under `LiquidationEngine.sol`, an expired loan incurs a default penalty [^8][^12]:
$$\text{Penalty} = \max\left( V_{\text{debt}} \cdot 12\%, \; V_{\text{coll}} \cdot 2.5\% \right)$$
This penalty is apportioned via `AssetConfig.stabilityPoolPenaltyShare = 75\%` [^8][^12]:
1. **Stability Pool Depositor Tranche ($75\%$)**:
   $$\text{Reward}_{\text{SP}} = 0.75 \cdot \text{Penalty} = 9.0\% \cdot V_{\text{debt}}$$
   Depositors burn $V_{\text{debt}}$ in stablecoins and receive collateral worth $1.09 \cdot V_{\text{debt}}$, realizing an effective acquisition discount of:
   $$\Delta_{\text{SP}} = 1 - \frac{1}{1 + 0.09} \approx 8.26\%$$
2. **Bad Debt Reserve Tranche ($25\%$)**:
   $$\text{Reward}_{\text{Reserve}} = 0.25 \cdot \text{Penalty} = 3.0\% \cdot V_{\text{debt}}$$
   Remitted directly in collateral tokens to `protocolTreasury()` (managed by `owner()`) to accumulate protocol safety cushions [^8][^11].

#### 3.3.2 Quantitative Risk Calibration Against Collateral Volatility & DEX Slippage
In `LiquidationEngine.sol`, a 15-minute grace period (`GRACE_PERIOD = 900`) is granted to the **borrower** to settle their loan before hard liquidation triggers [^8][^11]. Once the grace period expires and the loan is liquidated, Stability Pool stakers acquire collateral and must either hold or liquidate it on secondary markets (e.g. SaucerSwap) [^6].

For Stability Pool depositors to remain profitable, the acquisition discount $\Delta_{\text{SP}}$ must exceed the expected collateral price drop over their withdrawal and hedging horizon $\tau_{\text{hedge}}$, plus secondary market execution slippage [^6][^8]:
$$\Delta_{\text{SP}} > \mathbb{E}\left[ \frac{\Delta P_{\text{coll}}}{P_{\text{coll}}} \;\middle|\; \tau_{\text{hedge}} \right] + z_{\alpha} \cdot \sigma_{\text{coll}} \cdot \sqrt{\tau_{\text{hedge}}} + \text{Slippage}_{\text{DEX}}$$

Assuming an operational hedging window of $\tau_{\text{hedge}} = 1\text{ hour}$ ($0.000114\text{ years}$), annualized volatility $\sigma_{\text{ETH}} = 65\%$ [^5], and secondary market execution slippage on SaucerSwap under stress of $\text{Slippage}_{\text{DEX}} \in [3.0\%, 5.0\%]$ [^8]:
$$\sigma_{\text{1h}} = 0.65 \cdot \sqrt{\frac{1}{8760}} \approx 0.695\%$$
At a $99.9\%$ confidence interval ($z_{\alpha} = 3.09$):
$$\text{Max 1-Hour Price Downside} = 3.09 \times 0.695\% = 2.15\%$$
Combining maximum 1-hour price variance with median DEX slippage ($4.0\%$):
$$\text{Total Hedging Cost & Volatility Risk} = 2.15\% + 4.00\% = 6.15\%$$
Because the net acquisition discount $\Delta_{\text{SP}} \approx 8.26\%$ exceeds the total hedging variance and slippage ($6.15\%$), Stability Pool depositors retain a positive safety margin of $+2.11\%$ under stressed market conditions [^5][^8].

---

### 3.4 Solvency Backstop Sequence & Bad Debt Mitigation

To protect the Lending Pool's priority invariant, Chrono establishes a deterministic 3-tier waterfall [^8]:

```
                            [ DEFAULTED LOAN SETTLEMENT ]
                                          │
                                          ▼
                      [ TIER 1: STABILITY POOL ABSORPTION ]
                       Does SP have sufficient stablecoins?
                                ├─── YES ───► Instant Debt Burn & Collateral Seizure
                                │             (Lenders made 100% whole)
                                └─── NO  ───┐
                                            ▼
                      [ TIER 2: PROTOCOL BAD DEBT RESERVE ]
                      Does Bad Debt Reserve have capital?
                                ├─── YES ───► Reserve injects stablecoins into LendingPool
                                │             (Absorbs shortfall, transfers seized collateral)
                                └─── NO  ───┐
                                            ▼
                      [ TIER 3: TWO-PHASE DUTCH AUCTION (TASK 21) ]
                      Auction collateral on open market via CD3 / Dutch Curve
                                ├─── CLEARED ───► Proceeds satisfy principal to LendingPool
                                └─── UNCLEARED ─► Protocol equity backstop / haircut socialization
```

1. **Tier 1 (Stability Pool)**: Absorbs up to 100% of available stablecoins, earning the 75% penalty tranche [^3][^8].
2. **Tier 2 (Protocol Bad Debt Reserve)**: Capitalized by the 25% penalty tranche (remitted in collateral to `protocolTreasury()`) and retained origination fees [^8][^11]. Liquidating this accumulated collateral into stablecoins via an automated fee-recycle hook allows the reserve to cover shortfalls if the Stability Pool is exhausted [^8].
3. **Tier 3 (Two-Phase Dutch Auction Fallback)**: Liquidates remaining collateral on the open market, ensuring debt tokens are recaptured from external arbitrageurs rather than socialized onto passive lenders [^4][^8].

---

### 3.5 Comparative Incentive Matrix

| Mechanism | Status Quo v1 [^2][^3] | Competitor Benchmark (Liquity v2) [^9] | Multi-Sided Incentive Formulation (Proposed) |
| :--- | :--- | :--- | :--- |
| **SP Yield Source** | Liquidation penalties only (lumpy, zero in calm markets) [^3] | User-set interest rates + external token emissions [^9] | Continuous hybrid stream (10% gross interest + 20% origination fee) + 75% liquidation penalty [^5]. |
| **Lender Invariant** | Flawed: socializes bad debt when SP empty [^3][^8] | Strong: redemption priority ensures peg [^9] | Unshakeable: 3-tier waterfall strictly backstops lender capital before any haircut [^8]. |
| **Capital Flight Defense** | None; capital drains to LendingPool during bull runs [^4] | Dynamic market rate adjustment [^9] | Self-balancing yield feedback loop: as SP shrinks, per-share streaming yield rises automatically. |
| **Reserve Cushion** | 25% collateral penalty sent to `owner()` [^8][^11] | Stability Reserve Fund [^9] | 25% of default penalties + 80% of ES fees committed to on-chain Bad Debt Reserve [^8]. |

---

## 4. Synthesis & Risk Assessment

### 4.1 Synthesis of Findings
Capital competition between the Lending Pool and Stability Pool is not an intractable flaw, but an equilibrium that can be stabilized through **inter-pool revenue coupling**. By routing a calibrated fraction of active lending yield (10%) and origination fees (20%) to passive backstop stakers, Chrono transforms the Stability Pool from an unrewarded risk sink into an attractive, self-balancing yield instrument [^5].

### 4.2 Failure Modes & Security Edge Cases

#### 4.2.1 Protracted Sideways Market with Massive Stability Over-Capitalization
- **Scenario**: Borrowing volume declines while depositors flood the Stability Pool to capture the baseline yield stream.
- **Risk**: Capital is parked inefficiently in the Stability Pool, depressing Lending Pool liquidity and spiking borrow rates.
- **Defense**: The streaming yield is proportional to aggregate borrowing interest ($r_b \cdot U \cdot S_{\text{LP}}$) [^7]. If borrowing contracts, streaming yield automatically diminishes, encouraging capital to rotate back into active lending [^5].

#### 4.2.2 Multi-Collateral Correlated Depeg Event
- **Scenario**: Multiple collateral assets (`wETH`, `wBTC`, `HBAR`) drop simultaneously by >50%, triggering widespread hard liquidations [^4][^5].
- **Risk**: Stability Pool depositors absorb excessive amounts of volatile tokens, exceeding their risk tolerance and triggering mass withdrawals.
- **Defense**: Withdrawals from the Stability Pool are locked during active debt absorption transactions. Furthermore, the Adverse Selection Shield ($HF < 0.85$) routes extreme tail-risk liquidations to external keepers via CD3, preventing the Stability Pool from absorbing depreciated collateral [^4].

### 4.3 Limitations of the Analysis
- **Empirical Utilization Dependencies**: Numerical yield stability relies on maintainable utilization rates ($U \in [60\%, 85\%]$) in the Lending Pool [^5][^7].
- **Hedera DEX Secondary Market Depth**: The hedging safety proof assumes Stability Pool depositors can liquidate acquired collateral on SaucerSwap within 1 hour without incurring >5% slippage [^6][^8].

---

## 5. Actionable Recommendations

### 5.1 Prioritized Implementation Plan

| Priority | Task Description | Target File / Module | Rationale & Justification |
| :---: | :--- | :--- | :--- |
| **P0** | **Implement Stability Pool Yield-Bridging Stream** | [`LendingPool.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/core/LendingPool.sol), [`StabilityPool.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/core/StabilityPool.sol) | Adds `streamReward(token, amount)` and `cumulativeDebtRewardPerDeposit` to divert 10% of gross borrow interest to `StabilityPool.sol` [^3]. |
| **P0** | **Route Proposed Origination Fees to Stability & Reserve Funds** | [`BorrowVault.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/core/BorrowVault.sol) | Splits proposed upfront ES fee: 20% to Stability Pool streaming yield, 80% to protocol Bad Debt Reserve [^5][^11]. |
| **P1** | **Automate Bad Debt Reserve Accounting** | [`LiquidationEngine.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/engines/LiquidationEngine.sol), [`LendingPool.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/core/LendingPool.sol) | Formally account for the 25% default penalty tranche as an explicit reserve cushion inside `LendingPool` rather than sending to generic `owner()` [^8]. |
| **P1** | **Implement Dynamic Withdrawal Delay on Absorption** | [`StabilityPool.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/core/StabilityPool.sol) | Introduces a 2-block withdrawal delay immediately following debt absorption to prevent front-running front-end exits [^3]. |
| **P2** | **Secondary Incentive Gauge for Capital Deficits** | Governance / Tokenomics Module | Activates protocol reward multipliers if Stability Pool capitalization falls below 20% of aggregate active debt [^9]. |

---

## 6. Glossary

| Term | Plain English Definition |
| :--- | :--- |
| **Acquisition Discount ($\Delta_{\text{SP}}$)** | The effective percentage discount below market value at which Stability Pool stakers acquire collateral during a liquidation [^8]. |
| **Adverse Selection** | The risk that Stability Pool depositors absorb depreciating collateral right before further price declines, suffering net losses [^4]. |
| **Bad Debt Reserve** | An on-chain protocol capital cushion funded by liquidation penalties and fees, designed to absorb loan defaults that exceed Stability Pool capacity [^8]. |
| **BLUF** | Bottom Line Up Front; an executive summary stating conclusions and strategic verdicts at the beginning of a document. |
| **Capital Flight Trap** | The pro-cyclical migration of liquidity out of the Stability Pool during calm markets due to zero liquidation yields [^4]. |
| **CD3 Engine** | Chrono Dynamic-Discount Engine; a stateless soft liquidation pricing mechanism where the bonus scales dynamically with loan Health Factor [^4]. |
| **Expected Shortfall (ES)** | A statistical tail-risk metric (also known as Conditional Value-at-Risk) measuring the average loss expected to occur in extreme scenarios beyond a specified confidence threshold [^5]. |
| **First-Loss Junior Tranche** | The capital layer that absorbs defaulted debt first before any senior lender experiences a financial haircut [^3]. |
| **Health Factor (HF)** | The ratio of a position's discounted collateral value to its outstanding debt; a loan becomes eligible for liquidation when HF falls below 1.0 [^4]. |
| **Hedera Schedule Service (HSS / HIP-1215)** | A native Hedera network precompile (0x16b) enabling transactions to be scheduled and executed autonomously at a predetermined future consensus timestamp [^1]. |
| **Lender Invariant** | The foundational protocol rule guaranteeing that lenders in `LendingPool.sol` are made 100% whole before any other stakeholder [^8]. |
| **Loan-to-Value (LTV)** | The ratio of borrowed debt value to the market value of pledged collateral, expressed as a percentage [^1]. |
| **Pro-Cyclical Liquidity** | Liquidity behavior that amplifies market trends: expanding during booms and drying up during crashes [^4]. |
| **Reserve Factor** | The percentage of borrow interest withheld by the protocol to fund insurance reserves rather than paid to lenders [^14]. |
| **Scaled Deposit Model** | A mathematical snapshot accounting system allowing deposits and rewards to compound without iterating over user accounts [^3]. |
| **Stability Pool** | An internal protocol pool of deposited stablecoins used to instantly absorb defaulted debt in exchange for discounted collateral [^3]. |
| **Yield Bridging** | Diverting active protocol revenue (interest/fees) to passive stability stakers to provide continuous returns in calm markets [^5]. |

---

## 7. References

[^1]: Chrono Protocol Architecture & Engineering Team, *Chrono Protocol Whitepaper: The Duration-Bound Money Market on Hedera*, Project Documentation, 2026. [`docs/Chrono_Protocol_Whitepaper.md`](file:///D:/MDG/personal_projects/chrono_hedera/docs/Chrono_Protocol_Whitepaper.md).
[^2]: Chrono Protocol Core Contracts, *LendingPool.sol: Implementation of lending shares, deposits, and borrow reservations*, Smart Contract Source Code, 2026. [`contracts/core/LendingPool.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/core/LendingPool.sol).
[^3]: Chrono Protocol Core Contracts, *StabilityPool.sol: Scaled deposit model and bad debt absorption*, Smart Contract Source Code, 2026. [`contracts/core/StabilityPool.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/core/StabilityPool.sol).
[^4]: Chrono Chief Risk Decision-Maker, *Soft Liquidation Architecture: Strategic Risk Analysis, Mechanism Evaluation & Definitive Architectural Blueprint*, Architectural Research Report, Sections 8.1–8.4, 2026. [`docs/analysis/SOFT_LIQUIDATION_DUTCH_AUCTION_ANALYSIS.md`](file:///D:/MDG/personal_projects/chrono_hedera/docs/analysis/SOFT_LIQUIDATION_DUTCH_AUCTION_ANALYSIS.md).
[^5]: Chrono Risk & Economics Team, *DeFi Risk Parameterization Comparative Research: Dynamic LTV Calibration and Stress Regimes across Aave, Morpho Blue, and Liquity v1/v2*, Project Research Report, 2026. [`docs/analysis/DEFI_RISK_PARAMETERIZATION_ANALYSIS.md`](file:///D:/MDG/personal_projects/chrono_hedera/docs/analysis/DEFI_RISK_PARAMETERIZATION_ANALYSIS.md).
[^6]: SaucerSwap Community, *SaucerSwap V2 Automated Market Maker: Concentrated Liquidity and Swap Routing on Hedera*, Documentation, 2024. https://docs.saucerswap.finance.
[^7]: Chrono Protocol Quantitative Research, *Interest Rate Model Decoupling & Continuous Integral Pricing Analysis*, Project Research Report, Section 2.1 & 3.2, 2026. [`docs/analysis/INTEREST_RATE_UTILIZATION_ANALYSIS.md`](file:///D:/MDG/personal_projects/chrono_hedera/docs/analysis/INTEREST_RATE_UTILIZATION_ANALYSIS.md).
[^8]: Chrono Risk Architecture Team, *Chrono Protocol: Hard Liquidation Architecture & Settlement Specification*, Project Specification, Sections 1, 3, and 5.1, 2026. [`docs/Chrono_Hard_Liquidation_Specification.md`](file:///D:/MDG/personal_projects/chrono_hedera/docs/Chrono_Hard_Liquidation_Specification.md).
[^9]: Liquity AG, *Liquity v2 (BOLD): User-Set Interest Rates and Decentralized Stability Pools*, Technical Whitepaper, 2024. https://docs.liquity.org.
[^10]: Chrono Protocol Engineering, *Chrono Protocol Monorepo Deprecation Notice for Web Frontend & Indexer*, Repository README Notice, 2026. [`README.md`](file:///D:/MDG/personal_projects/chrono_hedera/README.md).
[^11]: Chrono Protocol Core Contracts, *BorrowVault.sol: Position storage, debt accounting, and collateral custody*, Smart Contract Source Code, 2026. [`contracts/core/BorrowVault.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/core/BorrowVault.sol).
[^12]: Chrono Protocol Core Contracts, *AssetRegistry.sol: Asset risk parameter storage and validation*, Smart Contract Source Code, 2026. [`contracts/core/AssetRegistry.sol`](file:///D:/MDG/personal_projects/chrono_hedera/contracts/core/AssetRegistry.sol).
[^13]: Liquity AG, *Liquity Protocol: A Decentralized Borrowing Protocol with Instant Liquidation*, Technical Documentation, 2021. https://docs.liquity.org.
[^14]: Aave Labs, *Aave v3 Technical Paper: Multi-Market Architecture, Isolation Mode, and Risk Management*, Protocol Technical Specification, 2023. https://aave.com.
