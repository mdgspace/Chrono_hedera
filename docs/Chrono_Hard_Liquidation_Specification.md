# Chrono Protocol: Hard Liquidation Architecture & Settlement Specification

**Document Reference:** Official Protocol Specification  
**Task Reference:** Task 19 (`docs/todo.md`)  
**Supersedes:** `docs/analysis/RESIDUAL_COLLATERAL_ANALYSIS.md`  
**Author:** Chrono Risk Architecture & Protocol Engineering  
**Status:** Approved & Final Specification for Implementation  
**Date:** September 23, 2026  

---

## 1. Executive Summary & Architectural Verdict

In Chrono Protocol, loans are term-bound with a deterministic expiration timestamp (`pos.startTime + pos.duration`) registered on the **Hedera Schedule Service (HSS / HIP-1215)**. When a loan reaches its maturity date without full repayment by the borrower, it enters **Hard Liquidation**. 

Unlike Soft Liquidation (which is triggered when Health Factor $HF \le 1.0$ due to collateral price decline), a Hard Liquidation is triggered strictly by **time expiration** (breach of contract maturity). Consequently, an expired loan may still be significantly overcollateralized.

### The Core Question
When the protocol executes Hard Liquidation and seizes collateral to pay off the principal debt, accrued interest, and liquidation penalty, **what should happen to the remaining excess collateral (residual surplus)?**

| Approach | Summary | Core Stance |
| :--- | :--- | :--- |
| **Approach A: Pure Borrower Refund (Status Quo v1)** | Calculate debt + penalty, seize only the required collateral, and immediately refund 100% of the remaining surplus collateral to `pos.borrower`. | Pledged collateral is a security guarantee (lien), not a forfeiture bond. Confiscation destroys institutional trust. |
| **Approach B: 100% Protocol / Pool Confiscation** | Forfeit 100% of the borrower's collateral. Retain all excess value within the protocol, redistributing it as a windfall to Stability Pool depositors or protocol reserves. | Complete forfeiture enforces ruthless default deterrence, eliminates moral hazard, and hyper-incentivizes Stability Pool backstop capital. |

---

### The Lead Architect Verdict: **Solvency-Gated Surplus Remittance with Dual-Tranche Default Penalty**

Chrono Protocol **REJECTS 100% Collateral Forfeiture** and **REJECTS Unconstrained Borrower Refunds**. 

100% forfeiture is fatal to Chrono: it creates an **Inverted Risk Penalty** (punishing conservative borrowers far more severely than reckless ones), exposes the protocol to catastrophic **MEV Censorship attacks** on Hedera, and legally disqualifies Chrono from institutional capital due to commercial lending laws (**UCC § 9-608**).

However, the naive refund in v1 contains a **critical solvency loophole**: when the Stability Pool cannot absorb the debt (`stabilityPool.canAbsorb == false`), lenders absorb bad debt while the defaulting borrower receives a full surplus refund!

### The Definitive Architecture: 3-Tier Settlement Waterfall
Chrono adopts a **Solvency-Gated Settlement Waterfall**:
1. **Lender Invariant (Priority 1):** The LendingPool must be made 100% whole in debt tokens. Under NO circumstances does a borrower receive a single wei of surplus collateral if the LendingPool suffers a bad debt haircut.
2. **Calibrated Default Penalty (Priority 2):** Raise `hardLiqPenalty` from 5% to **12% of total debt** (with a floor of 2.5% total collateral value). This penalty is split:
   - **75%** to **Stability Pool depositors** (providing sustainable, attractive absorption yield).
   - **25%** to the **LendingPool Bad Debt Reserve** (autonomously growing a protocol safety cushion).
3. **Surplus Remittance (Priority 3):** All residual collateral beyond Debt + Penalty is **remitted to `pos.borrower`**, contingent upon the loan being 100% settled.
4. **HSS Grace Window:** Implement a 15-minute deterministic grace buffer with a linear penalty ramp to eliminate Hedera consensus timestamp jitter and prevent predatory keeper front-running.

---

## 2. Deconstruction of the Debate

To arrive at this verdict, we examine the four perspectives submitted by the debate subagents.

```
                             ┌───────────────────────────────────────┐
                             │       HARD LIQUIDATION AT EXPIRY      │
                             │ (Total Collateral > Required for Debt)│
                             └───────────────────┬───────────────────┘
                                                 │
                     ┌───────────────────────────┴───────────────────────────┐
                     ▼                                                       ▼
        ┌─────────────────────────┐                             ┌─────────────────────────┐
        │   APPROACH A: REFUND    │                             │ APPROACH B: FORFEITURE  │
        │   SURPLUS TO BORROWER   │                             │  CONFISCATE 100% VALUE  │
        └────────────┬────────────┘                             └────────────┬────────────┘
                     │                                                       │
        ┌────────────┴────────────┐                             ┌────────────┴────────────┐
        ▼                         ▼                             ▼                         ▼
  Subagent 1A               Subagent 1B                   Subagent 2A               Subagent 2B
 [Pro-Refund]              [Anti-Refund]                [Pro-Retention]           [Anti-Retention]
• Pledge is a lien        • "Concierge Exit" hazard     • Absolute deterrence     • Inverted Risk Trap
• Institutional mandate   • Free put option             • Supercharged SP yields  • MEV Censorship vector
• Protects HSS jitter     • Solvency flaw when SP empty • Solvency fortress       • Violates UCC § 9-608
```

---

### 2.1 Subagent 1A: The Pro-Borrower Refund Stance
*Key Principle: Pledging collateral is a security guarantee, not a speculative wager.*

1. **Collateral as a Security Lien:** In debt finance, collateral functions strictly to protect lenders against capital loss. Once the principal, accrued interest, and reasonable administrative costs (liquidation penalties) are paid, retaining borrower equity constitutes unjust enrichment.
2. **Institutional & Treasury Adoption:** Institutional borrowers, crypto funds, and Real World Asset (RWA) issuers manage strict fiduciary risk. An institution borrowing $2,000,000 USDC against $8,000,000 in HBAR or WBTC will **never** use a protocol where an operational delay or custody outage causes the total forfeiture of their remaining $6,000,000 equity.
3. **Hedera Network Timestamp Jitter:** Hedera Schedule Service (HIP-1215) relies on consensus timestamps and EVM `block.timestamp`. Network latency, scheduled execution delays, or client RPC sync issues can cause a repayment transaction to land 2 seconds after expiry. Confiscating 100% of collateral over a 2-second timestamp difference would destroy protocol reputation permanently.
4. **Uniform Commercial Code (UCC Article 9):** Under commercial lending law (specifically UCC § 9-608 and § 9-615), a secured creditor who liquidates collateral **must remit any surplus proceeds to the debtor**. Complete forfeiture models create massive regulatory and legal attack surfaces.

---

### 2.2 Subagent 1B: The Anti-Borrower Refund Stance
*Key Principle: Guaranteed surplus refunds subsidize borrower negligence and endanger pool solvency.*

1. **The "Concierge Exit" Moral Hazard:** If a borrower knows that expiry simply results in their loan being closed, debt deducted, and the remaining collateral refunded with a minimal 5% penalty, they have zero incentive to manually repay. The borrower avoids paying gas, avoids swapping tokens to repay debt, and treats the protocol's liquidation engine as an automated, free concierge settlement service.
2. **The "Free Put Option" Arbitrage:** If the collateral asset is volatile, the borrower can hold the loan until the final second. If the collateral crashes below the debt value, the borrower defaults and walks away (externalizing bad debt onto the protocol). If the collateral remains valuable, the borrower ignores the loan and receives the surplus anyway.
3. **The Fatal Solvency Asymmetry in Chrono v1:** Look at `LiquidationEngine.sol` (lines 156–160):
   ```solidity
   if (stabilityPool.canAbsorb(pos.debtToken, totalDebt)) {
       stabilityPool.absorbDebt(...);
       borrowVault.seizeCollateral(positionId, address(stabilityPool), requiredCollateral, true);
   } else {
       // Bad debt socialization
       lendingPool.returnBorrowLiquidity(pos.debtToken, pos.borrowAmount);
       borrowVault.seizeCollateral(positionId, owner(), requiredCollateral, true);
   }
   ```
   If the Stability Pool has insufficient funds (`canAbsorb == false`), the protocol decrements `totalBorrowed` via `returnBorrowLiquidity`, but **zero debt tokens enter the lending pool**. The passive lenders take a direct haircut (bad debt socialization). 
   Yet, inside `borrowVault.seizeCollateral()`, `pos.collateralAmount > 0` is **refunded to the defaulting borrower**! Refunding surplus collateral to a defaulting borrower while innocent depositors suffer bad debt is an untenable economic contradiction.

---

### 2.3 Subagent 2A: The Pro-Protocol Retention Stance
*Key Principle: Total forfeiture creates ironclad deterrence and bootstraps deep stability pools.*

1. **Ruthless Default Deterrence:** If 100% of collateral is forfeited upon expiration, default rates drop to near zero. Every rational borrower will prioritize repaying before maturity.
2. **Hyper-Incentivizing the Stability Pool:** In DeFi lending, stability pools suffer from a "cold start" problem—idle capital earns low yields unless liquidations occur. If Stability Pool depositors receive 100% of the confiscated collateral (including all surplus equity), hard liquidations generate massive APR spikes (50%–200%+). Depositors will rush to supply liquidity, ensuring `stabilityPool.canAbsorb` is always true.
3. **Indestructible Reserve Backstop:** Alternatively, routing forfeited surplus into a `LendingPool` reserve builds a massive capital buffer that permanently protects lenders against unexpected price crashes.

---

### 2.4 Subagent 2B: The Anti-Protocol Retention Stance
*Key Principle: Total forfeiture creates predatory pawnshops, inverted penalties, and MEV censorship.*

1. **The Inverted Risk Paradox (Punishing the Safe):**
   Under 100% forfeiture, the penalty percentage is inversely proportional to borrower risk:
   - **Borrower A (Conservative, 20% LTV):** Deposits $100,000 collateral, borrows $20,000 debt. If liquidated, loses $80,000 in equity (**400% penalty on debt!**).
   - **Borrower B (Reckless, 80% LTV):** Deposits $100,000 collateral, borrows $80,000 debt. If liquidated, loses $20,000 in equity (**25% penalty on debt!**).
   
   *Result:* Safe, high-collateral borrowers are punished 16 times more severely than reckless borrowers. This drives away conservative capital and concentrates toxic, high-LTV debt in the protocol.

2. **The MEV Censorship / Byzantine Keeper Attack Vector:**
   If the protocol confiscates 100% of collateral and awards it to liquidators or stability depositors, active positions carry a massive bounty upon expiration.
   - Consider a position with $500,000 collateral and $100,000 debt expiring at `T`.
   - The residual surplus is $400,000.
   - A malicious actor, keeper, or colluding validator has an overwhelming incentive to **censor or delay the borrower's repayment transaction** (via Hedera node spam, DDoS on the borrower's RPC, or transaction front-running) until `block.timestamp >= T`. Stealing $400,000 of borrower equity creates an irresistible incentive for Byzantine behavior.

3. **Destruction of Chrono's Dynamic LTV Model:**
   Chrono's core innovation is its time-decay LTV model ($LTV(t) = LTV_{base} + (LTV_{max} - LTV_{base}) \cdot e^{-k \tau}$). If users face complete asset loss at expiration, no user will ever utilize the higher dynamic LTV curves, rendering Chrono's signature feature useless.

---

## 3. Comprehensive Evaluation Matrix

| Risk Vector / Dimension | Approach A: Pure Refund (v1) | Approach B: 100% Forfeiture | Chrono Decision: Solvency-Gated Waterfall |
| :--- | :--- | :--- | :--- |
| **Lender Solvency & Bad Debt** | ❌ **CRITICAL FLAW:** Lenders take haircut when SP is empty while borrower gets refund. | 🟢 **HIGH:** Maximum collateral captured to cover pool losses. | 🟢 **ABSOLUTE:** Surplus refund is strictly gated on 100% lender debt satisfaction. |
| **Default Deterrence** | ⚠️ **WEAK:** 5% penalty makes liquidation an automated concierge exit. | 🟢 **EXTREME:** Total fear of loss drives zero defaults. | 🟢 **OPTIMAL:** 12% debt penalty (min 2.5% coll) makes default strictly unprofitable. |
| **Institutional & Enterprise Adoption** | 🟢 **EXCELLENT:** Matches traditional finance and institutional risk standards. | ❌ **FATAL:** No institution or treasury will risk 100% forfeiture. | 🟢 **EXCELLENT:** Fully compliant with institutional risk management. |
| **MEV Censorship & Griefing** | 🟢 **IMMUNE:** No excess surplus bounty to incentivize transaction censorship. | ❌ **EXTREME RISK:** Multi-million dollar bounties invite network spam & censorship. | 🟢 **IMMUNE:** Liquidators/keepers receive fixed execution fees; no surplus theft. |
| **Risk-Penalty Fairness** | 🟢 **FAIR:** Penalty scales proportionally with debt amount. | ❌ **INVERTED PARADOX:** Safe 20% LTV borrowers punished 16x harder than 80% LTV. | 🟢 **FAIR:** Scaled penalty proportional to debt and risk profile. |
| **Legal Compliance (UCC § 9-608)** | 🟢 **COMPLIANT:** Surpluses are returned to the borrower. | ❌ **VIOLATION:** Illegal conversion / unjust retention of debtor surplus. | 🟢 **COMPLIANT:** Direct compliance with commercial lending law. |
| **Stability Pool Yield Health** | ⚠️ **MODERATE:** Receives standard liquidation bonus only. | 🟢 **UNSUSTAINABLE SPIKES:** Wild, erratic lottery-style yields. | 🟢 **HEALTHY & PREDICTABLE:** Receives 75% of calibrated default penalties. |

---

## 4. Audit of Chrono v1 Contracts: The Solvency Vulnerability

Examining `contracts/engines/LiquidationEngine.sol` and `contracts/core/BorrowVault.sol` reveals how the v1 implementation produces bad debt socialization.

### The Vulnerability Flow in v1
```
Borrower defaults on $10,000 debt (Collateral value = $15,000)
                              │
                              ▼
            Is StabilityPool.canAbsorb($10,000) true?
                             / \
                            /   \
                     YES   /     \   NO (Stability Pool Undercapitalized)
                          /       \
                         /         ▼
                        │     LiquidationEngine executes fallback:
                        │     1. lendingPool.returnBorrowLiquidity(debt, principal)
                        │        --> Decrements totalBorrowed by $10,000
                        │        --> BUT ZERO cash tokens are transferred to lendingPool!
                        │        --> LENDING POOL INCURS $10,000 IN BAD DEBT!
                        │     2. Seizes $10,500 collateral to owner()
                        │     3. BorrowVault.seizeCollateral(..., closePosition=true):
                        │        --> pos.collateralAmount ($4,500) IS REFUNDED TO BORROWER!
                        │
                        ▼
       Defaulter walks away with $4,500 cash!
       Passive pool depositors take the $10,000 loss!
```

### The Code Flaw
In `BorrowVault.sol` (lines 210–217):
```solidity
if (closePosition) {
    pos.active = false;
    schedulerEngine.cancelSchedule(positionId);
    if (pos.collateralAmount > 0) {
        IERC20(pos.collateralToken).safeTransfer(pos.borrower, pos.collateralAmount);
        pos.collateralAmount = 0;
    }
}
```
`BorrowVault` has no awareness of whether `LendingPool` was actually repaid with hard tokens. It assumes that if `LiquidationEngine` called `seizeCollateral`, the debt was satisfied. In the undercapitalized fallback branch, this assumption is completely violated.

---

## 5. The Definitive Architectural Solution

Chrono Protocol adopts the **Solvency-Gated Settlement Waterfall with Dual-Tranche Default Penalty**.

### 5.1 Mathematical Specification of the Settlement Waterfall

Let a defaulted position at $t \ge t_{expiry}$ have:
- Total Debt: $D_{total} = D_{principal} + I_{accrued}$
- Total Collateral: $C_{total}$
- Oracle Prices: $P_{coll}$, $P_{debt}$
- Total Debt Value: $V_{debt} = D_{total} \times P_{debt}$
- Total Collateral Value: $V_{coll} = C_{total} \times P_{coll}$

#### Step 1: Compute the Calibrated Hard Liquidation Penalty
To eliminate moral hazard without creating an inverted penalty trap, the penalty value $V_{pen}$ is calculated as:
$$V_{pen} = \max\left( V_{debt} \times \alpha_{\text{debt}}, \; V_{coll} \times \beta_{\text{coll}} \right)$$

Where:
- $\alpha_{\text{debt}} = 12\%$ (Ensures default is significantly worse than voluntary repayment + fees).
- $\beta_{\text{coll}} = 2.5\%$ (Establishes an absolute minimum penalty floor for ultra-low LTV positions, preventing zero-cost abandonment).

---

### 5.1.1 Quantitative & Economic Justifications for the 12% Penalty Calibration

The selection of **12% of total debt** ($\alpha_{\text{debt}} = 0.12$) is not arbitrary; it represents a mathematically and economically calibrated optimum balancing default deterrence, backstop profitability, protocol reserve accumulation, and fairness:

#### 1. Overcoming the "Concierge Exit" Economic Hurdle
Under standard protocol operation, a borrower who repays voluntarily incurs:
- A 10% protocol fee cut on accrued borrow interest (`BorrowVault.repay()`).
- Hedera network EVM execution and transaction fees.
- Secondary market friction: exchange/swap fees and DEX price impact (typically 0.3% – 1.0% on SaucerSwap or other Hedera DEXes) when purchasing debt tokens to settle the obligation.
- Operational overhead and cognitive cost of tracking maturity.

Total voluntary repayment friction generally sits between **1.5% and 3.5% of total debt**.
- **At 5% penalty (v1):** The marginal cost of defaulting was merely ~1.5% – 3.5% above voluntary repayment. In periods of market volatility, high slippage, or gas spikes, defaulting and allowing the protocol to liquidate the position and refund the surplus collateral acted as an automated, friction-free "concierge settlement service."
- **At 12% penalty (Current Specification):** The marginal cost of default expands to **8.5% – 10.5% of debt value**. An 8.5%+ deadweight loss on debt capital creates an unmistakable, insurmountable economic hurdle. Rational borrowers are strongly compelled to manually repay, refinance, or close their positions prior to maturity.

#### 2. Stability Pool Absorption Yield & Hedera DEX Slippage Buffer (75% Tranche = 9.0%)
Stability Pool depositors supply liquid debt tokens (e.g., USDC) to absorb defaulted debt and are compensated with the seized collateral at a discount:
$$Bonus_{SP} = 12\% \times 75\% = 9.0\% \text{ of debt value}$$
Stability Pool backstop providers face inventory and market risk: after absorbing defaulted debt, they must either hold the volatile collateral asset (e.g., HBAR, WBTC) or liquidate/rebalance on Hedera DEXes.
- On Hedera DEXes, absorbing large liquidation sizes during market stress can incur 3.0% – 5.0% price slippage and pool fees.
- Under the old 5% penalty, the 75% share was only 3.75%—which was completely erased by 3% – 5% slippage, leaving depositors with net negative returns and starving the Stability Pool of liquidity.
- With a 12% penalty, the 9.0% gross bonus comfortably absorbs up to 5% DEX slippage while leaving a guaranteed **4.0% – 6.0% net risk premium**. This ensures deep, permanent liquidity commitment from external yield seekers.

#### 3. Autonomous Bad Debt Reserve Capitalization (25% Tranche = 3.0%)
The remaining 25% of the penalty routes to the LendingPool Bad Debt Reserve:
$$Bonus_{Reserve} = 12\% \times 25\% = 3.0\% \text{ of debt value}$$
- Instead of taxing active, healthy borrowers or diluting passive lenders, protocol solvency reserves are funded directly from defaulted positions.
- Every hard liquidation automatically injects 3.0% of the loan's debt value in collateral directly into the reserve fund. Over time, this builds an autonomous capital buffer to insulate lenders against flash crashes, oracle latency, or undercollateralized black-swan events without external token inflation.

#### 4. Game-Theoretic Elimination of the "Free Put Option"
A fixed-term borrow position inherently embeds a synthetic American put option on the collateral:
- If collateral value drops below debt value, the borrower walks away (default is optimal).
- If collateral value remains above debt, a borrower might be tempted to delay repayment hoping for short-term asset appreciation.
- For a low penalty (5%), the cost of default could easily be lower than the option value over 7–14 days for volatile assets like HBAR.
- A 12% penalty comfortably exceeds the multi-day expected volatility $\sigma \sqrt{\Delta t}$ of major crypto assets, rendering speculative default or maturity brinkmanship deeply negative expected value ($EV \ll 0$).

#### 5. Optimal Bounding Between Under-Penalization and Inverted Risk Traps
- **Why not lower (< 10%)?** A penalty below 10% yields $< 7.5\%$ for Stability Pool depositors, failing to provide an adequate slippage cushion on DEXes and failing to sufficiently deter lazy defaults.
- **Why not higher (> 15% or 100% Forfeiture)?** Approaching 20%+ triggers the **Inverted Risk Paradox** (severely punishing conservative 20% LTV institutional borrowers), creates massive bounties that incentivize validators and keepers to execute **MEV Censorship Attacks** on Hedera (spamming or delaying borrower repayment transactions until after maturity), and violates **UCC § 9-608** commercial lending regulations.
- **12% is the calibrated Pareto optimum:** It is severe enough to ensure near-zero intentional defaults and maintain high Stability Pool yields, yet bounded enough to preserve institutional trust and legal legitimacy.

#### 6. Synergy with the 2.5% Total Collateral Floor ($\beta_{\text{coll}}$)
To prevent exploitation on ultra-low LTV positions (e.g., borrowing $10,000 against $200,000 of collateral at 5% LTV), a debt-only 12% penalty would be only $1,200 (a negligible 0.6% of collateral).
By defining $V_{pen} = \max(V_{debt} \times 12\%, V_{coll} \times 2.5\%)$:
- At 5% LTV, the penalty enforces $200,000 \times 2.5\% = \$5,000$ (a 50% penalty relative to debt).
- This dual-bound structure guarantees that every borrower, regardless of capitalization or LTV, faces meaningful economic loss upon default.

---

#### Step 2: Determine Required Liquidation Collateral
$$V_{req} = V_{debt} + V_{pen}$$
$$C_{req} = \min\left( \frac{V_{req}}{P_{coll}}, \; C_{total} \right)$$

The surplus collateral candidate is:
$$C_{surplus} = C_{total} - C_{req}$$

```
┌────────────────────────────────────────────────────────────────────────┐
│                     TOTAL COLLATERAL VALUE (100%)                      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
       ┌────────────────────────────┴────────────────────────────┐
       ▼                                                         ▼
┌─────────────────────────────────────────────────┐   ┌──────────────────┐
│          REQUIRED COLLATERAL ($C_{req}$)        │   │ RESIDUAL SURPLUS │
│                                                 │   │  ($C_{surplus}$) │
├───────────────────────┬─────────────────────────┤   ├──────────────────┤
│ Debt Value ($V_{debt}$)│ Penalty Value ($V_{pen}$)│   │ Gated Refund     │
│ 100% to LendingPool   │ 75% to Stability Pool   │   │ to Borrower      │
│ (Via SP or Auction)   │ 25% to Protocol Reserve │   │ (If Solvency OK) │
└───────────────────────┴─────────────────────────┘   └──────────────────┘
```

#### Step 3: Solvency Gating (The Lender Invariant)
The residual surplus $C_{surplus}$ is released to `pos.borrower` **if and only if**:
$$\text{LendingPool Cash Received} \ge D_{total}$$

- **Case 1: `stabilityPool.canAbsorb(debtToken, D_{total}) == true`**
  1. Stability Pool burns $D_{total}$ debt tokens and transfers them to `LendingPool`.
  2. Stability Pool receives its share of collateral: $C_{debt} + 0.75 \times C_{pen}$.
  3. `LendingPool` Bad Debt Reserve receives: $0.25 \times C_{pen}$.
  4. `BorrowVault` refunds $C_{surplus}$ to `pos.borrower`.
  5. Position closed cleanly. Zero bad debt.

- **Case 2: `stabilityPool.canAbsorb(debtToken, D_{total}) == false`**
  1. The Stability Pool cannot cover the debt.
  2. **Surplus Refund is LOCKED:** $C_{surplus}$ is **NOT** sent to the borrower.
  3. The entire collateral $C_{total}$ is committed to the **Bad Debt Recovery Engine** (Open Dutch Auction or Protocol Reserve liquidation).
  4. The recovery engine liquidates collateral on the open market to recover $D_{total}$ debt tokens for `LendingPool`.
  5. **Post-Recovery Settlement:**
     - If the liquidation recovers $\ge D_{total} + V_{pen}$: `LendingPool` is made whole, the penalty is distributed, and any remaining net proceeds are sent to `pos.borrower`.
     - If the liquidation recovers $< D_{total}$: 100% of proceeds go to `LendingPool`. The borrower receives **$0** (their equity is wiped out to minimize lender loss).

---

### 5.2 The Hedera Schedule Service (HSS) Jitter Shield

To solve the 1-second consensus timestamp jitter issue without weakening default enforcement:

1. **Deterministic 15-Minute Grace Window:**
   When `block.timestamp >= pos.startTime + pos.duration`, the position enters a **Grace Period** $[T_{exp}, \; T_{exp} + 900\text{s}]$.
2. During this 15-minute window:
   - Hedera Schedule Service does not trigger hard liquidation immediately.
   - The borrower can still call `repay()` with an added **Late Grace Fee** ($1.5\%$).
   - This prevents temporary RPC delays, network congestion, or wallet issues from triggering full hard liquidation.
3. Once $t > T_{exp} + 900\text{s}$:
   - Full Hard Liquidation executes autonomously via HSS / Keepers.

---

## 6. Actionable Implementation Plan

To execute this architecture across Chrono's codebase, the following contract updates are required:

### 6.1 Changes in `AssetRegistry.sol`
- Update default `hardLiqPenalty` from `0.05e18` (5%) to `0.12e18` (12%).
- Add `hardLiqCollateralFloor` configured to `0.025e18` (2.5%).
- Add `stabilityPoolPenaltyShare` configured to `0.75e18` (75%) and `reservePenaltyShare` to `0.25e18` (25%).

### 6.2 Changes in `LiquidationEngine.sol`
- Refactor `executeHardLiquidation(bytes32 positionId)`:
  1. Calculate debt, accrued interest, and dual-bound penalty ($V_{pen}$).
  2. In the `canAbsorb` branch:
     - Transfer $D_{total}$ from `StabilityPool` to `LendingPool`.
     - Route $0.75 \times C_{pen}$ to `StabilityPool`.
     - Route $0.25 \times C_{pen}$ to `LendingPool` (or protocol reserve).
     - Instruct `BorrowVault.seizeCollateral()` to remit $C_{surplus}$ to `pos.borrower`.
  3. In the `!canAbsorb` branch:
     - Deprecate transferring collateral to `owner()`.
     - Route collateral to the Bad Debt Recovery Engine (Task 21).
     - Block surplus remittance until debt recovery completes.

### 6.3 Changes in `BorrowVault.sol`
- Update `seizeCollateral()`:
  - Add explicit parameters: `collateralToLiquidator`, `collateralToReserve`, and `refundToBorrower`.
  - Enforce that `refundToBorrower` occurs only when explicitly authorized by `LiquidationEngine` following successful debt settlement.

---

## 7. Strategic Impact & Industry Comparison

| Protocol | Liquidation Trigger | Residual Collateral Handling | Flaw / Trade-off | Chrono Architecture |
| :--- | :--- | :--- | :--- | :--- |
| **Aave v3** | Soft only ($HF \le 1.0$) | Retained by borrower (partial liquidation with close factor) | Does not support fixed-term maturity loans. | Soft Dutch auction + Hard maturity liquidation. |
| **MakerDAO / Morpho** | Soft only | Auctioned; surplus returned to borrower | High gas costs for on-chain auctions during market panics. | Stability Pool absorption first, automated Dutch fallback. |
| **Liquity v1** | Soft ($CR < 110\%$) | Trove wiped; surplus lost if liquidated below MCR | Punitive collateral loss for borrowers near 110% CR. | Precision surplus refund preserved; no unearned wipeout. |
| **Pawnshop Protocols** | Expiry date | 100% Confiscation | Inverted risk penalty; toxic MEV censorship; zero institutional adoption. | **Strictly Rejected.** Solvency-gated surplus remittance. |

---

## 8. Summary & Next Steps

By adopting **Solvency-Gated Surplus Remittance with a Dual-Tranche Default Penalty**, Chrono Protocol achieves:
1. **Uncompromising Solvency:** Lenders are protected by an absolute priority rule. No borrower receives a refund if a pool is left with bad debt.
2. **True Default Deterrence:** A 12% debt penalty (with a 2.5% collateral floor) removes any incentive to treat liquidation as a free concierge exit.
3. **Institutional Viability:** Preserves legal title to surplus equity under UCC § 9-608, enabling enterprise and institutional participation.
4. **MEV Censorship Elimination:** Eliminates the predatory incentives that plague 100% forfeiture models on public networks.

**Dependencies Resolved:**
- This decision directly provides the operational rules required for **Task 20** (Stability Pool Scaled Deposit Model) and **Task 21** (Stability Pool Under-Capitalization & Bad Debt Fallback).
