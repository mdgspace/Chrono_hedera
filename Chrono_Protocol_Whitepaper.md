# Whitepaper: Chrono Protocol

## 1\. Abstract & Core Philosophy

Traditional money market protocols evaluate risk statically, treating indefinite-duration positions with uniform Loan-to-Value (LTV) caps. Chrono Protocol introduces duration-bound borrowing, tying maximum allowable leverage directly to borrow term length.

Shorter borrow duration reduces asset price exposure window, lowering downside volatility variance. Protocol leverages duration limits to offer higher short-term LTV limits while maintaining system solvency. Protocol enforces position expiration through native autonomous scheduled transactions, eliminating manual liquidation triggers, MEV searcher front-running, and off-chain relay risks.

---

## 2\. Mathematical Risk Framework & Dynamic LTV

### 2.1 Risk-Time Equivalence

In quantitative finance, price dispersion risk scales with duration square root:

$$\text{Risk} = \sigma \cdot \sqrt{t}$$

* $\sigma$: Asset price volatility.  
* $t$: Borrow duration.

Restricting duration $t$ narrows variance window, allowing higher LTV limits for short time horizons without increasing default probability.

### 2.2 Duration-based LTV Limits

Standard protocol baseline parameters:

* **1-Hour Borrow:** Up to $90\%$ LTV ($10\times$ leverage)  
* **12-Hour Borrow:** Up to $87\%$ LTV ($7.7\times$ leverage)  
* **1-Day Borrow:** Up to $84\%$ LTV ($6.25\times$ leverage)  
* **7-Day Borrow:** Up to $75\%$ LTV ($4\times$ leverage)

### 2.3 Dynamic LTV Equation

For arbitrary remaining duration $t$ (in seconds), constrained to the operational duration domain $t \in [T_{\text{min}}, T_{\text{max}}]$, maximum allowable LTV follows an exponential decay model:

$$\text{LTV}(t) = \text{LTV}_{\text{base}} + (\text{LTV}_{\text{max}} - \text{LTV}_{\text{base}}) \cdot e^{-k \cdot t}$$

* $\text{LTV}_{\text{base}}$: Baseline minimum LTV for maximum allowable borrow duration (default $75\%$).  
* $\text{LTV}_{\text{max}}$: Ceiling LTV for minimum borrow duration (default $90\%$).  
* $k$: Volatility decay parameter, scaled for seconds (default $7.614 \times 10^{-6}\text{ s}^{-1}$).  
* $T_{\text{min}}, T_{\text{max}}$: Operational borrow duration bounds (default $1\text{ hour}$ / $3,600\text{ s}$ and $30\text{ days}$ / $2,592,000\text{ s}$).

### 2.4 Volatility Decay Calibration

Parameter $k$ adjusts based on historical asset price volatility:

$$k = \alpha \cdot \sigma_{30\text{d}} + \beta$$

* $\sigma_{30\text{d}}$: 30-day trailing asset volatility indexed from historical price data.  
* $\alpha, \beta$: System risk calibration parameters set by protocol governance.

In practice, high-frequency trailing volatility is indexed and evaluated off-chain by the Chrono Relayer/Indexer (`/api/v1/markets/volatility`), which periodically updates or guides governance calibrations of the on-chain `kDecay` parameter in the asset registry. Higher market volatility increases $k$, forcing steeper LTV decay over duration $t$.

---

## 3\. Position Health & Risk Evaluation

### 3.1 Health Factor Formula

Position solvency status evaluated continuously via Health Factor ($HF$):

$$HF = \frac{\text{Collateral Value} \cdot LT(t)}{\text{Debt Value}}$$

* $\text{Collateral Value} = \sum (\text{Asset Quantity}_i \cdot \text{Price}_i)$.  
* $\text{Debt Value} = \text{Principal} + \text{Accrued Interest}$.

The Liquidation Threshold $LT(t)$ incorporates the max LTV plus a time-elapsed buffer to prevent instantaneous liquidations immediately after a borrow:

$$LT(t) = \min(\text{LTV}(t_{\text{remaining}}) + \text{Buffer}(t_{\text{elapsed}}), 1.0)$$

Where the buffer grows based on elapsed time:

$$\text{Buffer}(t_{\text{elapsed}}) = \text{Buffer}_{\text{min}} + (\text{Buffer}_{\text{max}} - \text{Buffer}_{\text{min}}) \cdot (1 - e^{-k_{\text{buf}} \cdot t_{\text{elapsed}}})$$

* $t_{\text{remaining}}$: Remaining borrow duration in seconds.
* $t_{\text{elapsed}}$: Elapsed borrow duration in seconds.
* $\text{Buffer}_{\text{min}}, \text{Buffer}_{\text{max}}$: Minimum and maximum liquidation buffer limits.
* $k_{\text{buf}}$: Buffer decay parameter.

### 3.2 Position Health States

* $HF > 1.5$: Safe state.  
* $1.0 < HF \le 1.5$: Warning state.  
* $HF \le 1.0$: Default state (Eligible for Soft Liquidation).  
* $t \ge T_{\text{expiry}}$: Expiry state (Eligible for Hard Liquidation via Scheduled Transaction).

---

## 4\. Dual-Liquidation Architecture

Protocol enforces risk mitigation through two distinct liquidation paths: Soft Liquidation (market price default) and Hard Liquidation (expiration default).

```text
[Borrow Position Created]
          |
          +--> [Price Drop (HF <= 1.0)] --> [Soft Liquidation / External Market Liquidators]
          |
          +--> [Time Reaches T_expiry]  --> [Hard Liquidation via Scheduled Tx / Stability Pool]
```

### 4.1 Soft Liquidation (Pre-Expiry Solvency Default)

Triggered when collateral spot price drops, causing $HF \le 1.0$ prior to duration expiration $T_{\text{expiry}}$.

#### Theoretical Architecture: Open Dutch Auction (Euler Finance Model)
In traditional money market designs, fixed liquidation discounts (e.g., static $5\%-10\%$ bonuses) create toxic MEV priority gas auctions, front-running, and unnecessarily penalize borrowers by stripping excessive equity even during minor price dips. Drawing design rationale from **Euler Finance**, Chrono Protocol adopts an **Open Dutch Auction Mechanism** for pre-expiry Soft Liquidations to guarantee fair market price discovery and maximal borrower equity preservation.

When a position crosses into default ($HF \le 1.0$), an auction begins where the effective collateral purchase price decays smoothly over elapsed auction time $\tau$:

$$P_{\text{auction}}(\tau) = P_{\text{oracle}} \cdot \left( (1 + \delta_{\text{start}}) - (\delta_{\text{start}} + \delta_{\text{max}}) \cdot \min\left(1, \frac{\tau}{\tau_{\text{auction}}}\right) \right)$$

* $P_{\text{oracle}}$: Current spot price of the collateral asset reported by the oracle feed.
* $\tau = \text{block.timestamp} - T_{\text{auction\_start}}$: Elapsed duration since the Dutch auction commenced.
* $\delta_{\text{start}}$: Initial auction premium above oracle price (e.g., $+2\%$), mitigating instant predatory front-running at the exact moment of default.
* $\delta_{\text{max}}$: Maximum allowable liquidation discount ceiling (e.g., $10\%$).
* $\tau_{\text{auction}}$: Total auction price decay window (e.g., $300\text{ seconds}$).

#### Clearing Rules:
1. **Execution & Settlement:** Any external market participant (liquidator) can execute against the auction at any point during its decay window by repaying debt up to the close factor limit ($50\%$ of outstanding debt). Collateral is seized based on the prevailing auction price:
   $$\text{Collateral Seized} = \frac{\text{Debt Repaid} \cdot P_{\text{debt}}}{P_{\text{auction}}(\tau)}$$
2. **Dynamic Price Discovery:** Liquidators are economically incentivized to wait until the auction price decays sufficiently to offset their gas, capital, and hedging risks. The competitive market determines the true clearing discount, avoiding arbitrary over-penalization of borrowers.
3. **Partial Fills & Solvency Restoral:** Once debt is repaid, the position's Health Factor is recomputed. If the position returns to a solvent state ($HF > 1.0$), the auction concludes.

#### Roadmap & Implementation Context (v1 Prototype Status)
* Full on-chain implementation of the Dutch auction engine, dynamic parameter tuning, and evaluation of alternative soft liquidation mechanisms are preserved for upcoming protocol engineering phases.
* **v1 Prototype State:** The deployed v1 contract prototype ([LiquidationEngine.sol](file:///d:/MDG/personal_projects/chrono_hedera/contracts/engines/LiquidationEngine.sol#L54-L127)) utilizes a simplified fixed-bonus model ($50\%$ close factor, $5\%$ static bonus) with an internal `stabilityPool.canAbsorb()` priority check as an interim MVP. This prototype is slated for refactoring to implement the Euler-inspired Dutch auction engine.

### 4.2 Hard Liquidation (Post-Expiry Settlement Default)

Triggered when borrow duration expires ($t \ge T_{\text{expiry}}$) and the borrower has failed to voluntarily repay the debt.

* **Mechanism:** Executed autonomously via native scheduled transaction hooks (Hedera Schedule Service) registered at position inception. No external searcher gas war or manual trigger is required.
* **Settlement Logic & Penalty:** Collateral is seized to settle the entire outstanding principal, accrued interest, and a flat **$5\%$ Hard Liquidation Penalty** (`hardLiqPenalty = 0.05e18`):

$$\text{Required Value} = \text{Total Debt Value} \cdot (1 + \text{Penalty})$$

$$\text{Required Collateral} = \frac{\text{Required Value}}{\text{Collateral Price}}$$

* **Penalty Recipient:** The flat $5\%$ penalty is transferred directly to **Stability Pool depositors** (or the emergency protocol backstop) as an economic yield incentive for underwriting terminal duration risk and absorbing defaulted debt.
* **Residual Collateral Destination (Current Implementation & Open Design):** 
  In the current smart contract implementation (`BorrowVault.sol`), any residual collateral remaining after satisfying outstanding debt and the liquidation penalty ($\text{Collateral}_{\text{total}} - \text{Required Collateral}$) is transferred directly to the borrower's wallet (`pos.borrower`).
  > **Architectural Note & Future Evolution:** This design choice is actively under review. While returning residual collateral protects borrowers against punitive complete forfeiture, future protocol upgrades may retain a portion or all of the residual collateral within the system—either routing it to the `LendingPool` to reinforce lender reserves, diverting it to the protocol treasury, or distributing it as an additional punitive penalty to Stability Pool depositors.
* **Stability Pool Absorption & Liquity-Style Accounting:**
  Hard Liquidations are settled through the protocol's `StabilityPool`. The Stability Pool implements a Liquity-style snapshot-based scaled deposit model (`depositScale` and `cumulativeRewardPerDeposit`):
  * Depositors stake debt tokens (e.g., wUSDC) to earn discounted seized collateral (e.g., wETH) plus liquidation penalties.
  * When debt is absorbed, the pool's effective scale factor is updated:
    $$\text{Scale}_{\text{new}} = \text{Scale}_{\text{old}} \cdot \left(1 - \frac{\text{Debt Absorbed}}{\text{Total Pool Deposits}}\right)$$
  * Collateral rewards accrue globally per scaled deposit share:
    $$\Delta R = \frac{\text{Seized Collateral} \cdot 10^{18}}{\text{Total Scaled Deposits}}$$
  * Individual depositors claim their accrued collateral rewards asynchronously using snapshot differences ($R_{\text{current}} - R_{\text{lastSeen}}$), achieving constant $O(1)$ gas complexity without iterating across depositors.
* **Stability Pool Depletion & Bad Debt Fallback (Current Implementation):**
  If the Stability Pool possesses insufficient debt tokens to absorb an expired position (`stabilityPool.canAbsorb() == false`):
  * The current contract logic socializes the borrowed liquidity in `LendingPool` (`returnBorrowLiquidity` writes down borrowed liquidity so pool utilization does not remain artificially locked) and transfers seized collateral to the `owner()` address as an emergency backstop.
  * > **Architectural Note & Future Evolution:** Seizing collateral to an owner backstop is an interim design choice. We are actively evaluating robust decentralized alternatives for under-capitalized pool scenarios, including open-market Dutch collateral auctions, proportional LP debt haircuts, or an automated protocol reserve auction.

---

## 5\. Expiry Automation & Scheduled Transactions

### 5.1 Use of Scheduled Transactions

Scheduled transactions are required at a single deterministic protocol entry point:

* **Position Expiration Settlement:** Upon opening or extending a borrow position, the contract schedules an autonomous execution hook targeting timestamp $T_{\text{expiry}}$.

### 5.2 Rationale & Necessity

Scheduled transaction capability is essential for protocol mechanics due to:

1. **Deterministic Expiry:** Guarantees position termination the moment duration expires, eliminating indefinite borrower leverage.  
2. **Keeperless Liquidation Triggers:** Eliminates reliance on external MEV searchers, third-party liquidator bots, or competitive gas wars to trigger expirations. The host ledger autonomously triggers execution.  
3. **Congestion & Gas Spike Immunity:** Protects protocol solvency from mempool congestion or prohibitive base-fee surges that prevent off-chain bots from executing timely liquidations.  
4. **Predictable Horizon for Lenders:** Enables liquidity providers to rely on guaranteed capital return timeframes, directly stabilizing utilization metrics.

#### Decoupling Execution Triggers from Price Updates
While host-level scheduled execution guarantees autonomous invocation of the liquidation logic without external keeper bounties, background transactions executing on-chain cannot pull external off-chain oracle proofs (e.g., Pyth VAA signatures). To resolve this, Chrono decouples execution triggering from price maintenance:
* **Trigger Layer:** 100% keeperless and autonomous via native scheduled transactions.
* **Pricing Layer:** Maintained via an active price-push keeper daemon (`keeper.ts`), which regularly submits signed price updates on-chain within an accepted staleness threshold ($120\text{ seconds}$). This ensures scheduled executions always evaluate against fresh market prices.

### 5.3 Execution Host Abstraction & Reference Implementation

While the protocol architecture is fundamentally chain-agnostic, the reference implementation is deployed on the **Hedera Network**, capitalizing on its native scheduled execution infrastructure:

* **Hedera Schedule Service (HSS / HIP-1215):** Chrono interfaces directly with the native Schedule System Contract at address `0x16b`. When a position is initiated in `BorrowVault`, `SchedulerEngine` invokes `scheduleCall` to queue `executeHardLiquidation(positionId)` targeted at $T_{\text{expiry}}$.
* **Execution Timestamp Jitter & Padding:** Under Hedera EVM execution, consensus timestamping during automated schedule execution may exhibit slight boundary variance (1–2 seconds relative to block time). To prevent premature "Not expired" call reverts, `SchedulerEngine` injects a $+2\text{s}$ execution padding buffer alongside capacity retry windows (up to $+5\text{s}$).
* **Hedera Token Service (HTS):** Underlying collateral and debt assets leverage Hedera Token Service primitives, providing sub-3-second transaction finality and predictable, low fixed USD transaction fees.

---

## 6\. Interest Rate Engine & Protocol Economics

Protocol utilizes a dynamic two-phase linear kink interest rate model to regulate capital utilization, paired with an automated protocol fee reserve model.

### 6.1 Utilization Calculation

Pool utilization rate $U$:

$$U = \frac{\text{Total Borrowed}}{\text{Total Supplied}}$$

### 6.2 Borrow APY Equations

* **Phase 1 ($U \le U_{\text{optimal}}$):**

$$r(U) = r_{\text{base}} + \left(\frac{U}{U_{\text{optimal}}}\right) \cdot r_{\text{slope1}}$$

* **Phase 2 ($U > U_{\text{optimal}}$):**

$$r(U) = r_{\text{base}} + r_{\text{slope1}} + \left(\frac{U - U_{\text{optimal}}}{1 - U_{\text{optimal}}}\right) \cdot r_{\text{slope2}}$$

### 6.3 Standard Parameter Matrix

| Parameter | Stablecoin Pools | Volatile Asset Pools |
| :---- | :---- | :---- |
| $r_{\text{base}}$ | $0.5\%$ | $1.5\%$ |
| $U_{\text{optimal}}$ | $90\%$ | $80\%$ |
| $r_{\text{slope1}}$ | $4.0\%$ | $6.0\%$ |
| $r_{\text{slope2}}$ | $60.0\%$ | $100.0\%$ |

### 6.4 Supply APY & Lender Yield

Suppliers (lenders) earn yield proportional to pool utilization and the current borrow rate, adjusted for the protocol reserve factor:

$$\text{Supply APY}(U) = r(U) \cdot U \cdot (1 - \text{Fee}_{\text{protocol}})$$

Where $\text{Fee}_{\text{protocol}}$ is the protocol reserve fee ($10\%$). Unborrowed capital earns no interest, ensuring yields are 100% backed by genuine borrower demand.

### 6.5 Protocol Fee & Revenue Routing

Chrono captures protocol revenue through interest rate spreads on voluntary debt repayments:

* **Voluntary Repayments:** When a borrower repays accrued interest, a $10\%$ protocol cut ($\text{Fee}_{\text{protocol}} = 0.10$) is routed directly to the `protocolTreasury`. The remaining $90\%$ of interest is deposited into the `LendingPool` to increase liquidity provider share value.
* **Liquidation Fee Immunity:** To protect system solvency during liquidation events, **$0\%$ protocol fee** is levied on debt settled through Soft or Hard liquidations. $100\%$ of recovered capital is applied directly to make lenders whole and absorb debt, prioritizing systemic stability over protocol revenue.

### 6.6 Compounded Interest Accrual

Debt interest accrues continuously. For gas efficiency, it is implemented using a second-order Taylor expansion of $e^{rt}$:

$$\text{Debt}(t) = \text{Principal} \cdot \left(1 + r_{\text{sec}} \cdot t + \frac{(r_{\text{sec}} \cdot t)^2}{2}\right)$$

* $r_{\text{sec}} = \frac{r(U)}{\text{SecondsPerYear}}$ (Per-second interest rate).
* $t$: Elapsed time since last accrual in seconds.

---

## 7\. Protocol Subsystems & Operating Requirements

### 7.1 Lending & Debt Vault Subsystem

* **Function:** Asset deposits, liquidity token minting, debt issuance, interest compounding.  
* **Requirements:** Multi-token vault storage, isolated accounting per asset tier.

### 7.2 Dynamic LTV & Risk Subsystem

* **Function:** Computes allowable LTV dynamically per borrow request based on duration $t$ and historical volatility calibration.  
* **Requirements:** Real-time formula evaluation, duration boundary validation, on-chain risk parameter registry.

### 7.3 Health Monitor & Liquidation Subsystem

* **Function:** Evaluates position $HF$, processes Soft Liquidations, manages Stability Pools.  
* **Requirements:** Atomic debt repayment, liquidation bonus calculation, debt absorption mechanics.

### 7.4 Scheduled Execution Subsystem

* **Function:** Registers, schedules, and executes Hard Liquidations at $T_{\text{expiry}}$ using native Hedera Schedule Service (HIP-1215).  
* **Requirements:** Host-layer scheduled transaction capability (`0x16b`), timestamp jitter padding (+2s), reentrancy-safe call targets.

### 7.5 Oracle Integration Subsystem

* **Function:** Supplies real-time asset pricing and off-chain trailing volatility metrics.  
* **Requirements:** Low-latency Pyth Oracle spot price integration with staleness enforcement, active push-keeper price updates for autonomous scheduled execution validity, and off-chain relayer/indexer for trailing 30-day volatility analysis.

---

## 8\. Requirements for Execution Environment

Deploying Chrono Protocol requires the host layer to satisfy four core functional primitives:

1. **Native / Autonomous Scheduled Transactions (Hedera Schedule Service):** Host execution environment must support scheduling EVM execution hooks targeted at future timestamp $T_{\text{expiry}}$ without external searcher/liquidator submission (implemented via HIP-1215 Schedule System Contract at `0x16b`).  
2. **High-Precision Consensus Time Tracking:** Consensus timestamp validity guaranteed across the network validator set to prevent expiry spoofing, combined with protocol-level execution jitter padding (+2s).  
3. **Decoupled Oracle & Price Push Feeds:** Low-latency on-chain price feeds (e.g., Pyth Network) supported by push-keeper nodes to ensure fresh on-chain data for autonomous contracts without requiring call-time payload injection.  
4. **Atomic Reentrancy Safety:** State update guarantees ensuring debt repayment, liquidation collateral transfers, and schedule cancellations complete atomically without reentrancy vulnerabilities.

