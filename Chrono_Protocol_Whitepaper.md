# Whitepaper: Chrono Protocol

## 1\. Abstract & Core Philosophy

Traditional money market protocols evaluate risk statically, treating indefinite-duration positions with uniform Loan-to-Value (LTV) caps. Chrono Protocol introduces duration-bound borrowing, tying maximum allowable leverage directly to borrow term length.

Shorter borrow duration reduces asset price exposure window, lowering downside volatility variance. Protocol leverages duration limits to offer higher short-term LTV limits while maintaining system solvency. Protocol enforces position expiration through scheduled transaction execution, eliminating keeper dependency and off-chain relay risk.

---

## 2\. Mathematical Risk Framework & Dynamic LTV

### 2.1 Risk-Time Equivalence

In quantitative finance, price dispersion risk scales with duration square root:

$$\\text{Risk} \= \\sigma \\cdot \\sqrt{t}$$

* $\\sigma$: Asset price volatility.  
* $t$: Borrow duration.

Restricting duration $t$ narrows variance window, allowing higher LTV limits for short time horizons without increasing default probability.

### 2.2 Duration-based LTV Limits

Standard protocol baseline parameters:

* **1-Hour Borrow:** Up to $90%$ LTV ($10\\times$ leverage)  
* **12-Hour Borrow:** Up to $87%$ LTV ($7.7\\times$ leverage)  
* **1-Day Borrow:** Up to $84%$ LTV ($6.25\\times$ leverage)  
* **7-Day Borrow:** Up to $75%$ LTV ($4\\times$ leverage)

### 2.3 Dynamic LTV Equation

For arbitrary duration $t$ (in hours), maximum allowable LTV follows exponential decay model:

$$\\text{LTV}(t) \= \\text{LTV}*{\\text{base}} \+ (\\text{LTV}*{\\text{max}} \- \\text{LTV}\_{\\text{base}}) \\cdot e^{-k \\cdot t}$$

* $\\text{LTV}\_{\\text{base}}$: Baseline minimum LTV for maximum allowable borrow duration (default $70%$).  
* $\\text{LTV}\_{\\text{max}}$: Ceiling LTV for minimum borrow duration (default $95%$).  
* $k$: Volatility decay parameter.

### 2.4 Volatility Decay Calibration

Parameter $k$ adjusts dynamically based on historical asset volatility:

$$k \= \\alpha \\cdot \\sigma\_{30\\text{d}} \+ \\beta$$

* $\\sigma\_{30\\text{d}}$: 30-day trailing asset volatility from oracle feed.  
* $\\alpha, \\beta$: System risk calibration parameters set by governance.

Higher volatility increases $k$, forcing steeper LTV decay over duration $t$.

---

## 3\. Position Health & Risk Evaluation

### 3.1 Health Factor Formula

Position solvency status evaluated continuously via Health Factor ($HF$):

$$HF \= \\frac{\\text{Collateral Value} \\cdot LT(t)}{\\text{Debt Value}}$$

* $LT(t)$: Duration-adjusted Liquidation Threshold at active time $t$.  
* $\\text{Collateral Value} \= \\sum (\\text{Asset Quantity}\_i \\cdot \\text{Price}\_i)$.  
* $\\text{Debt Value} \= \\text{Principal} \+ \\text{Accrued Interest}$.

### 3.2 Position Health States

* $HF \> 1.5$: Safe state.  
* $1.0 \< HF \\le 1.5$: Warning state.  
* $HF \\le 1.0$: Default state (Eligible for Soft Liquidation).  
* $t \\ge T\_{\\text{expiry}}$: Expiry state (Eligible for Hard Liquidation via Scheduled Transaction).

---

## 4\. Dual-Liquidation Architecture

Protocol enforces risk mitigation through two distinct liquidation paths: Soft Liquidation (market price default) and Hard Liquidation (expiration default).

\[Borrow Position Created\]

          |

          \+--\> \[Price Drop (HF \<= 1.0)\] \--\> \[Soft Liquidation / Stability Pool\]

          |

          \+--\> \[Time Reaches T\_expiry\]  \--\> \[Hard Liquidation via Scheduled Tx\]

### 4.1 Soft Liquidation (Pre-Expiry Solvency Default)

Triggered when collateral spot price drops, causing $HF \\le 1.0$ prior to duration expiration $T\_{\\text{expiry}}$.

* **Execution:** External liquidator repays up to $50%$ outstanding debt (close factor).  
* **Incentive:** Liquidator receives equivalent collateral value plus liquidation bonus ($5% \- 10%$).  
* **Stability Pools:** Protocol collateral rebalancing pools automatically absorb debt during sharp market drops, guaranteeing instant solvency settlement.

### 4.2 Hard Liquidation (Post-Expiry Settlement Default)

Triggered when borrow duration expires ($t \\ge T\_{\\text{expiry}}$) and borrower fails to repay debt.

* **Mechanism:** Executed via Scheduled Transaction set at position creation.  
* **Settlement Logic:** Position collateral fully liquidated to satisfy outstanding debt, accrued interest, and flat liquidation protocol penalty.  
* **Collateral Remainder:** Any residual collateral value post-debt settlement returned to borrower vault.

---

## 5\. Expiry Automation & Scheduled Transactions

### 5.1 Use of Scheduled Transactions

Scheduled transactions required at single specific protocol entry point:

* **Position Expiration Settlement:** Upon position opening or extension, contract schedules autonomous execution hook target timestamp $T\_{\\text{expiry}}$.

### 5.2 Rationale & Necessity

Scheduled transaction capability essential for protocol mechanics due to:

1. **Deterministic Expiry:** Guarantees position termination exact moment duration expires.  
2. **Keeperless Solvency:** Eliminates reliance on third-party off-chain keeper bots, MEV searchers, or external incentive bounties.  
3. **Congestion Immunity:** Prevents borrower debt defaults caused by mempool congestion or unexecuted keeper calls.  
4. **Predictable Borrow Horizon:** Allows lenders to count on guaranteed asset return timeframes, improving pool utilization calculations.

### 5.3 Execution Host Abstraction

Protocol architecture remains chain-agnostic. Host layer must provide one of following primitives:

* Native protocol scheduled transaction queue (block-level or timestamp-level deferred execution).  
* On-chain state trigger mechanism executing deferred logic automatically at scheduled block height/time.

---

## 6\. Interest Rate Engine

Protocol utilizes dynamic two-phase linear kink interest rate model to regulate capital utilization.

### 6.1 Utilization Calculation

Pool utilization rate $U$:

$$U \= \\frac{\\text{Total Borrowed}}{\\text{Total Supplied}}$$

### 6.2 Borrow APY Equations

* **Phase 1 ($U \\le U\_{\\text{optimal}}$):**

$$r(U) \= r\_{\\text{base}} \+ \\left(\\frac{U}{U\_{\\text{optimal}}}\\right) \\cdot r\_{\\text{slope1}}$$

* **Phase 2 ($U \> U\_{\\text{optimal}}$):**

$$r(U) \= r\_{\\text{base}} \+ r\_{\\text{slope1}} \+ \\left(\\frac{U \- U\_{\\text{optimal}}}{1 \- U\_{\\text{optimal}}}\\right) \\cdot r\_{\\text{slope2}}$$

### 6.3 Standard Parameter Matrix

| Parameter | Stablecoin Pools | Volatile Asset Pools |
| :---- | :---- | :---- |
| $r\_{\\text{base}}$ | $0.5%$ | $1.5%$ |
| $U\_{\\text{optimal}}$ | $90%$ | $80%$ |
| $r\_{\\text{slope1}}$ | $4.0%$ | $6.0%$ |
| $r\_{\\text{slope2}}$ | $60.0%$ | $100.0%$ |

### 6.4 Compounded Interest Accrual

Debt interest accrues continuously per block:

$$\\text{Debt}(t) \= \\text{Principal} \\cdot \\left(1 \+ \\frac{r(U)}{\\text{BlocksPerYear}}\\right)^{\\text{BlocksElapsed}}$$

---

## 7\. Protocol Subsystems & Operating Requirements

### 7.1 Lending & Debt Vault Subsystem

* **Function:** Asset deposits, liquidity token minting, debt issuance, interest compounding.  
* **Requirements:** Multi-token vault storage, isolated accounting per asset tier.

### 7.2 Dynamic LTV & Risk Subsystem

* **Function:** Computes allowable LTV dynamically per borrow request based on duration $t$ and historical volatility $\\sigma\_{30\\text{d}}$.  
* **Requirements:** Real-time formula evaluation, volatility history tracking.

### 7.3 Health Monitor & Liquidation Subsystem

* **Function:** Evaluates position $HF$, processes Soft Liquidations, manages Stability Pools.  
* **Requirements:** Atomic debt repayment, liquidation bonus calculation, debt absorption mechanics.

### 7.4 Scheduled Execution Subsystem

* **Function:** Registers, schedules, and executes Hard Liquidations at $T\_{\\text{expiry}}$.  
* **Requirements:** Host-layer scheduled transaction capability, deterministic timestamp execution, reentrancy-safe call targets.

### 7.5 Oracle Integration Subsystem

* **Function:** Supplies real-time asset pricing and trailing 30-day volatility metrics.  
* **Requirements:** Multi-source oracle redundancy, staleness thresholds, flash-loan resistant TWAP/VWAP feeds.

---

## 8\. Requirements for Execution Environment

Deploying Chrono Protocol on target blockchain platform requires host layer to satisfy four core functional primitives:

1. **Native / Autonomous Scheduled Transactions:** Host execution environment must support scheduling execution hooks targeted at future timestamp/block height $T\_{\\text{expiry}}$ without external transaction submission.  
2. **High-Precision Time Tracking:** Timestamp validity guaranteed across validator set to prevent expiry spoofing.  
3. **Decoupled Oracle Availability:** Reliable, low-latency price feeds providing spot prices and historical variance metrics.  
4. **Atomic Reentrancy Safety:** State update guarantees ensuring debt repayment and collateral transfer complete atomically without reentrancy vulnerabilities.

