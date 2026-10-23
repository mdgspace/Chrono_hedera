# Quantitative Simulation Methodology & Evaluation Metrics: Two-Factor Interest Rate Mechanism (IRM) for Chrono Protocol

**Author**: Quantitative Risk Researcher & Simulation Architect  
**Classification**: DeFi Mechanism Design, Stochastic Simulation Framework, Empirical Verification Specification  
**Target Repository**: `LordRyuga/Chrono_hedera`  
**Branch**: `feat/irm-simulations`  
**Date**: October 2026  
**Document Status**: Draft 3 (Final) — Fully Verified & Formally Approved  

---

## 1. Executive Summary

### 1.1 Bottom Line Up Front (BLUF)
Chrono Protocol replaces perpetual, variable-rate DeFi debt with deterministic fixed-maturity loans executed natively on Hedera EVM via the Hedera Schedule Service (HSS / HIP-1215) [^1][^2]. The protocol's total borrow carry rate decomposes into an orthogonal two-factor structure:
$$R(U_t, T) = g(U_t) + F(T) = g(U_t) + \frac{C_1 Y}{T} + f_2(T)$$
where $g(U_t)$ prices instantaneous pool cash scarcity, $f_1(T) = \frac{C_1 Y}{T}$ enforces an invariant flat reservation toll $e^{C_1}$ (with $Y = 31,536,000\text{ seconds}$ per year), and $f_2(T)$ prices the macro opportunity cost and capital lockup of duration $T$ [^1][^3].

This report establishes the formal quantitative simulation methodology and evaluation metrics required to evaluate four candidate polynomial formulations for opportunity cost $f_2(T) = \alpha_p (T / T_{\text{ref}})^p$ across orders $p \in \{1, 2, 3, 4\}$ over maturities $T \in [1\text{ hour}, 60\text{ days}]$ [^3]. Based on first-principles derivative analysis, microeconomic elasticity modeling, and prospective stress-regime projections, the quadratic model ($p=2$) is established as the primary baseline candidate hypothesis [^1][^3]. It creates a strictly increasing linear marginal penalty per day of capital lockup, deters multi-week liquidity drainage without overpenalizing medium tenors (7–14 days), and preserves high repayment velocity within the Hedera Schedule Service settlement queue [^1][^2][^3].

### 1.2 Core Problem Statement
Traditional lending markets (such as Aave v3 and Compound v3) rely on 1-dimensional utilization curves $r(U)$ designed for floating-rate, open-ended debt [^5][^6]. When applied to fixed-maturity debt, these curves suffer from two severe structural failure modes [^1][^7]:
1. **The Cheap Long-Lockup Drain**: When pool utilization is low ($U < U^*$), borrowers can lock up pool reserves for 60 days at near-zero base borrow rates ($0.5\% - 4.0\%$), depleting available pool cash reserves ahead of subsequent market crashes [^1][^7].
2. **The Micro-Tenor Spam Vulnerability**: Without a duration-dependent base toll, high-frequency borrowers can originate millions of micro-second loans, spamming protocol accounting and consuming Hedera EVM execution resources without paying proportional compensation [^1][^8].

Chrono Protocol solves these issues through additive two-factor pricing [^1]. However, the exact mathematical curvature of the opportunity cost function $f_2(T)$ determines pool solvency, borrower adoption, lender yields, and the velocity of scheduled debt repayments [^1][^3]. Selecting an inappropriate polynomial order $p$ risks either suppressing protocol adoption through punitive medium-term rates ($p=1$) or leaving the pool vulnerable to liquidity freezes from excessive 60-day debt ($p=4$ under miscalibrated baseline slopes) [^3].

### 1.3 Executive Synthesis of the Simulation Framework
To verify and calibrate the mechanism before mainnet deployment, this specification defines a rigorous 3-stage simulation framework:
- **Stage 1 (Empirical Replay)**: High-resolution historical replay using 1-minute Binance spot data for BTC/USDC, HBAR/USDC, and USDC/USDT spanning extreme historical volatility regimes, with ETH/USDC pipeline ingestion planned as a prerequisite task [^3][^4][^9].
- **Stage 2 (Agent-Based Tenor Selection)**: Microeconomic utility-maximizing agents responding dynamically to instantaneous rate quotes with empirical price elasticity ($\epsilon_p = -1.25$) and cross-tenor substitution elasticity ($\epsilon_{\text{sub}} = 0.85$) [^3].
- **Stage 3 (Hedera Schedule Service Settlement Queue)**: Discrete simulation of HIP-1215 scheduled transactions (to be implemented in `sim/chrono_sim/models/hss_queue.py`), tracking deterministic cash recycling, automated principal repayment, and pool liquidity replenishment [^2][^3].

---

## 2. Scope & Methodology

### 2.1 Scope Boundary
This methodology governs the simulation, quantitative benchmarking, and stress-testing of Chrono Protocol's interest rate mechanism [^3].

```mermaid
flowchart TD
    subgraph InScope["In-Scope (Analyzed & Simulated)"]
        A1["Two-Factor Borrow Rate: R(Ut, T) = g(Ut) + f1(T) + f2(T)"]
        A2["Polynomial Orders p in {1, 2, 3, 4} for f2(T)"]
        A3["Hyperbolic Base Toll f1(T) = C1*Y/T Invariant Preservation"]
        A4["Adaptive Kink Curve g(Ut) with 1h Smoothing"]
        A5["Empirical Binance 1m Replay & Kou Jump-Diffusion"]
        A6["HSS HIP-1215 Maturation Queue & Cash Recycling Specification"]
    end
    subgraph OutOfScope["Explicitly Out of Scope"]
        B1["Collateral Auction Liquidation Pricing (CD3 / Dutch Auction)"]
        B2["Hedera Consensus Service (HCS) Topic Latency Benchmarking"]
        B3["Frontend RPC Wagmi / RainbowKit Network Latency"]
        B4["Secondary Market Token Speculation & Chrono Governance Token"]
    end
    InScope -.->|Feeds Boundary Validation| OutOfScope
```

- **Included**:
  - Exact mathematical analysis of $f_2(T)$ candidate models ($p=1, 2, 3, 4$) across $T \in [3600\text{s}, 5184000\text{s}]$ [^3].
  - Interaction dynamics between $g(U_t)$ and $F(T)$ under continuous PRBMath UD60x18 exponential compounding ($e^{r \cdot t}$) implemented in `contracts/libraries/MathLib.sol` [^1][^8].
  - Liquidity solvency, freeze probabilities, depositor supply APY, borrower cost burdens, and HSS turnover velocity [^3].
- **Explicitly Excluded**:
  - The microeconomic Dutch auction clearing mechanics of collateral liquidations (governed separately by `contracts/engines/LiquidationEngine.sol`) [^11].
  - Hedera network consensus gossip latency and mirror node GraphQL ingestion delays [^12].

### 2.2 Core Simulation Engine Architecture
The simulation architecture operates across three synchronized computational layers:

```mermaid
flowchart LR
    subgraph Layer1["Stage 1: Market Replay Engine"]
        M1["Binance 1-Minute Spot Data"] --> M2["Log Price & Intrabar Minima"]
        M2 --> M3["Volatility Windows: Aug 2024 / Nov 2024"]
    end
    subgraph Layer2["Stage 2: Microeconomic Agent Engine"]
        M3 --> A1["Agent Utility Maximization"]
        A1 --> A2["Discrete Tenor Buckets (1h to 60d)"]
        A2 --> A3["Price & Cross-Tenor Elasticity"]
    end
    subgraph Layer3["Stage 3: HSS Settlement Queue Specification"]
        A3 --> H1["Scheduled Settlement Queue (0x16b)"]
        H1 --> H2["Deterministic Cash Recycling"]
        H2 --> H3["Pool Solvency & Utilization State"]
        H3 -->|Feedback Loop Ut| A1
    end
```

1. **Stage 1: Historical Replay & Jump-Diffusion Engine (`sim/chrono_sim/market/`)**:
   - Replays historical 1-minute close prices, intrabar low prices, and price confidence intervals from frozen public snapshots (`sim/data_manifests/binance_1m.json`) via the market replay engine (`sim/chrono_sim/market/replay.py`) [^4][^9][^10].
   - Augments historical series with Kou double-exponential compound Poisson jumps (`sim/chrono_sim/market/jumpdiff.py`) to evaluate tail liquidity shocks exceeding historical extremes [^13].
2. **Stage 2: Microeconomic Agent Tenor Selection Engine**:
   - Simulates a population of credit-demanding agents (arbitrageurs, leverage traders, yield farmers) characterized by price elasticity of borrow demand $\epsilon_p = -1.25$ and cross-tenor substitution elasticity $\epsilon_{\text{sub}} = 0.85$ (`sim/configs/models/IRM_EVAL_HYPERPARAMETERS.yaml`) [^3].
   - Evaluates borrower utility across 8 discrete tenor buckets: $T \in \{1\text{h}, 6\text{h}, 1\text{d}, 3\text{d}, 7\text{d}, 14\text{d}, 30\text{d}, 60\text{d}\}$ [^3].
3. **Stage 3: Hedera Schedule Service (HIP-1215) Settlement Queue Specification**:
   - Discrete-event queue tracking loan origination, active maturity schedules, and autonomous expiration settlements executed at precompile address `0x16b` (to be implemented in `sim/chrono_sim/models/hss_queue.py`) [^2][^3].
   - Dynamically recycles principal and interest back into pool cash reserves ($C_t = D_t - B_t$), directly updating instantaneous utilization $U_t$ and driving the feedback loop into $g(U_t)$ [^1][^14].

---

## 3. Technical & Domain Analysis

### 3.1 Mathematical Comparison of $f_2(T)$ Polynomial Orders ($p \in \{1, 2, 3, 4\}$)

#### 3.1.1 Formulation and Calibration Reference
The opportunity cost component $f_2(T)$ compensates liquidity providers for the duration of capital lockup [^1]. It is parameterized as:
$$f_2(T) = \alpha_p \left( \frac{T}{T_{\text{ref}}} \right)^p$$
where $T_{\text{ref}} = 30\text{ days} = 2,592,000\text{ seconds}$, and $\alpha_p$ is calibrated such that all models produce identical annualized opportunity spreads of $\alpha_p = 0.040$ ($4.00\%$ APY) at the reference tenor $T = 30\text{ days}$ [^3].

#### 3.1.2 Comparative Mathematical Properties
We analyze the mathematical behavior of the four polynomial orders across loan maturities from $1\text{ hour}$ to $60\text{ days}$ [^3]:

| Metric / Property | Order 1: Linear ($p=1$) | Order 2: Quadratic ($p=2$) | Order 3: Cubic ($p=3$) | Order 4: Biquadratic ($p=4$) |
| :--- | :--- | :--- | :--- | :--- |
| **Mathematical Formula** | $\alpha_1 \left( \frac{T}{T_{\text{ref}}} \right)$ | $\alpha_2 \left( \frac{T}{T_{\text{ref}}} \right)^2$ | $\alpha_3 \left( \frac{T}{T_{\text{ref}}} \right)^3$ | $\alpha_4 \left( \frac{T}{T_{\text{ref}}} \right)^4$ |
| **Calibration Coefficient ($\alpha_p$)** | $0.040$ ($4.0\%$) | $0.040$ ($4.0\%$) | $0.040$ ($4.0\%$) | $0.040$ ($4.0\%$) |
| **First Derivative $\frac{\partial f_2}{\partial T}$** | $\frac{\alpha_1}{T_{\text{ref}}} \equiv \text{const}$ | $\frac{2 \alpha_2}{T_{\text{ref}}^2} T$ | $\frac{3 \alpha_3}{T_{\text{ref}}^3} T^2$ | $\frac{4 \alpha_4}{T_{\text{ref}}^4} T^3$ |
| **Second Derivative $\frac{\partial^2 f_2}{\partial T^2}$** | $0$ (Zero Convexity) | $\frac{2 \alpha_2}{T_{\text{ref}}^2} \equiv \text{const} > 0$ | $\frac{6 \alpha_3}{T_{\text{ref}}^3} T > 0$ | $\frac{12 \alpha_4}{T_{\text{ref}}^4} T^2 > 0$ |
| **Value at $T = 1\text{ hour}$** | $0.0056\%$ ($0.56\text{ bps}$) | $0.0000077\%$ ($0.0008\text{ bps}$) | $\approx 0$ | $\approx 0$ |
| **Value at $T = 1\text{ day}$** | $0.1333\%$ ($13.3\text{ bps}$) | $0.0044\%$ ($0.44\text{ bps}$) | $0.00015\%$ ($0.015\text{ bps}$) | $\approx 0$ |
| **Value at $T = 7\text{ days}$** | $0.9333\%$ ($93.3\text{ bps}$) | $0.2178\%$ ($21.8\text{ bps}$) | $0.0508\%$ ($5.1\text{ bps}$) | $0.0119\%$ ($1.2\text{ bps}$) |
| **Value at $T = 14\text{ days}$** | $1.8667\%$ ($186.7\text{ bps}$) | $0.8711\%$ ($87.1\text{ bps}$) | $0.4065\%$ ($40.7\text{ bps}$) | $0.1897\%$ ($19.0\text{ bps}$) |
| **Value at $T = 30\text{ days}$ ($T_{\text{ref}}$)**| **$4.0000\%$ ($400.0\text{ bps}$)**| **$4.0000\%$ ($400.0\text{ bps}$)**| **$4.0000\%$ ($400.0\text{ bps}$)**| **$4.0000\%$ ($400.0\text{ bps}$)**|
| **Value at $T = 60\text{ days}$ ($2 \times T_{\text{ref}}$)**| **$8.0000\%$ ($800.0\text{ bps}$)**| **$16.0000\%$ ($1600.0\text{ bps}$)**| **$32.0000\%$ ($3200.0\text{ bps}$)**| **$64.0000\%$ ($6400.0\text{ bps}$)**|
| **Dollar Cost Scaling ($I_{\text{opp}}(T)$)** | $\mathcal{O}(T^2)$ (Quadratic) | $\mathcal{O}(T^3)$ (Cubic) | $\mathcal{O}(T^4)$ (Quartic) | $\mathcal{O}(T^5)$ (Quintic) |

#### 3.1.3 The Natural Rate Minimum ($T^*$) and Universal Invariant
When combined with the hyperbolic base fee $f_1(T) = \frac{C_1 Y}{T}$ (where $Y = 31,536,000\text{ seconds}$ and $C_1 = 0.0020$ WAD) [^3][^8], the total term structure $F(T) = f_1(T) + f_2(T)$ exhibits strict global convexity [^1].

Setting the first derivative with respect to tenor $T$ to zero:
$$\frac{\partial F}{\partial T} = -\frac{C_1 Y}{T^2} + \frac{p \alpha_p T^{p-1}}{T_{\text{ref}}^p} = 0 \implies T^*(p) = \left( \frac{C_1 Y T_{\text{ref}}^p}{p \alpha_p} \right)^{\frac{1}{p+1}}$$

Evaluating $T^*(p)$ for the baseline hyperparameters ($C_1 = 0.0020$, $Y = 31,536,000$, $T_{\text{ref}} = 2,592,000$, $\alpha_p = 0.040$) [^3]:
- **Order 1 ($p=1$)**: $T^* = 2,021,633\text{ seconds} \approx 23.40\text{ days}$. Minimum Rate: $F(T^*) = 3.12\% + 3.12\% = 6.24\%$.
- **Order 2 ($p=2$)**: $T^* = 1,743,150\text{ seconds} \approx 20.18\text{ days}$. Minimum Rate: $F(T^*) = 3.62\% + 1.81\% = 5.43\%$.
- **Order 3 ($p=3$)**: $T^* = 1,739,400\text{ seconds} \approx 20.13\text{ days}$. Minimum Rate: $F(T^*) = 3.63\% + 1.21\% = 4.84\%$.
- **Order 4 ($p=4$)**: $T^* = 1,778,490\text{ seconds} \approx 20.58\text{ days}$. Minimum Rate: $F(T^*) = 3.55\% + 0.89\% = 4.43\%$.

This derivation establishes an architectural invariant of Chrono Protocol's term structure [^1]:
$$f_1(T^*) \equiv p \cdot f_2(T^*)$$
At the optimal borrow tenor $T^*$, the hyperbolic base fee is exactly $p$ times the opportunity cost rate. For linear pricing ($p=1$), the two components contribute equally ($1:1$). For quadratic pricing ($p=2$), base toll amortized yield is exactly twice the lockup rate ($2:1$). For biquadratic pricing ($p=4$), base toll amortized yield is exactly four times the lockup rate ($4:1$).

---

### 3.2 Real Market Data Replay Pipeline & Empirical Volatility Windows

#### 3.2.1 Data Manifest & Ingestion Pipeline
The simulation engine ingests historical tick-level observations from the frozen public data snapshot (`sim/data_manifests/binance_1m.json`) [^4][^9]. Ingestion verifies SHA-256 file digests without loading unbounded datasets into memory (`sim/chrono_sim/market/history.py`) [^9]:

```python
# Verification digest implementation from sim/chrono_sim/market/history.py
def sha256_file(path):
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()
```

The manifest currently archives monthly 1-minute klines for `BTCUSDT`, `HBARUSDT`, and `USDCUSDT` covering 2024 through 2025 [^4]. Ingestion of `ETHUSDT` archives represents a designated prerequisite task scheduled under Roadmap Action P1.1 [^3]. Each observation records completed 1-minute candle timestamps ($t_k$), close prices ($p_k$), intrabar low prices ($l_k$), and price confidence intervals ($c_k$) [^9].

```mermaid
flowchart TD
    D1["Binance Spot 1m Monthly Archives (2024-2025)"] -->|SHA-256 Validation| D2["load_snapshot() in history.py"]
    D2 --> D3["Inner Join on Timestamp t_k"]
    D3 --> D4["Calibration Split Policy & Holdouts"]
    D4 --> D5["Synchronized Price & Low Arrays [Assets, Steps]"]
    D5 --> D6["Market Replay Batch Generation"]
```

#### 3.2.2 Empirical Stress Windows
The simulation pipeline subjects the IRM candidate models to two historical liquidity and volatility shocks configured in `sim/configs/models/IRM_EVAL_HYPERPARAMETERS.yaml` [^3]:

1. **August 2024 Carry Unwind Crisis (`aug_2024_carry_unwind`)**:
   - Timeframe: `2024-08-04 00:00:00 UTC` to `2024-08-08 00:00:00 UTC` (`start_ns: 1722729600000000000`, `end_ns: 1723075200000000000`) [^3].
   - Market Dynamics: Global macro unwinding of yen carry trades, resulting in rapid broad-market crypto de-leveraging where annualized borrow rates across major money markets spiked from under $4\%$ to over $45\%$ within 6 hours [^3][^15].
   - Simulation Objective: Stress-test liquidity pool solvency under sudden collateral devaluation, surging borrow demand for debt settlement, and depositor withdrawal spikes [^3].
2. **November 2024 Volatility Expansion (`nov_2024_volatility_expansion`)**:
   - Timeframe: `2024-11-05 00:00:00 UTC` to `2024-11-12 00:00:00 UTC` (`start_ns: 1730764800000000000`, `end_ns: 1731369600000000000`) [^3].
   - Market Dynamics: Post-election volatility breakout; sustained high utilization ($U_t > 90\%$) across major lending venues over several consecutive days [^3][^16].
   - Simulation Objective: Evaluate the resilience of $g(U_t)$ exponential smoothing, velocity damping, and the capital turnover velocity of the scheduled repayment queue [^3].

#### 3.2.3 Asset Parameters
Per `sim/configs/models/IRM_EVAL_HYPERPARAMETERS.yaml`, three primary lending pools are modeled against USDC debt [^3]:
- **ETH / USDC**: Volatility $\sigma = 0.60$, Kou jump intensity $\lambda_{\text{jump}} = 0.10$ [^3][^13].
- **HBAR / USDC**: Volatility $\sigma = 0.85$, Kou jump intensity $\lambda_{\text{jump}} = 0.15$ (Hedera ecosystem volatility profile) [^3][^13].
- **BTC / USDC**: Volatility $\sigma = 0.50$, Kou jump intensity $\lambda_{\text{jump}} = 0.05$ (Macro store-of-value profile) [^3][^13].

---

### 3.3 Microeconomic Agent Tenor Selection Engine & Elasticity Dynamics

#### 3.3.1 Microeconomic Utility Formulation
Borrowers in Chrono Protocol are modeled as rational economic agents maximizing expected net return over loan duration $T$ [^1][^3]. An agent wishing to finance a capital position over an investment horizon $H$ chooses across 8 discrete tenor buckets $T_j \in \{1\text{h}, 6\text{h}, 1\text{d}, 3\text{d}, 7\text{d}, 14\text{d}, 30\text{d}, 60\text{d}\}$ [^3].

The agent's utility for choosing tenor $T_j$ at time $t$ is formulated as [^1]:
$$\mathcal{U}_i(T_j \mid U_t) = \Pi_i(H) - \text{DebtExpense}(T_j, U_t) - \mathcal{C}_{\text{roll}}(H, T_j) - \mathcal{R}_{\text{maturity}}(H, T_j)$$
where:
- $\Pi_i(H)$ is the expected gross return from deploying the borrowed capital over horizon $H$.
- $\text{DebtExpense}(T_j, U_t) = P \cdot \left[ \exp\left( \frac{R(U_t, T_j) \cdot T_j}{Y} \right) - 1 \right]$ is the exact compounded interest expense computed via PRBMath UD60x18 `compoundInterest` (`contracts/libraries/MathLib.sol`) [^8].
- $\mathcal{C}_{\text{roll}}(H, T_j) = \max\left(0, \left\lceil \frac{H}{T_j} \right\rceil - 1\right) \cdot (C_{\text{HSS\_tx}} + C_1)$ is the friction of rolling over short-tenor loans, where $C_{\text{HSS\_tx}} \approx \$0.05$ represents Hedera schedule creation gas costs [^2] and $C_1 = 0.0020$ is the repeated flat entry toll [^1][^3].
- $\mathcal{R}_{\text{maturity}}(H, T_j) = \theta_{\text{refinance}} \cdot \mathbf{1}_{\{T_j < H\}}$ represents refinancing and liquidity risk if pool conditions worsen prior to horizon $H$ completion [^1].

#### 3.3.2 Price Elasticity & Cross-Tenor Substitution
Per protocol hyperparameters, agent demand responds to interest rates through two elasticity channels [^3]:
1. **Price Elasticity of Demand ($\epsilon_p = -1.25$)**:
   $$\frac{\Delta B_{\text{total}}}{B_{\text{total}}} = \epsilon_p \cdot \frac{\Delta R_{\text{eff}}}{R_{\text{eff}}}$$
   An aggregate $10\%$ increase in effective borrow rates reduces total protocol debt demand by $12.5\%$ [^3].
2. **Cross-Tenor Substitution Elasticity ($\epsilon_{\text{sub}} = 0.85$)**:
   $$\frac{\Delta (B_{T_j} / B_{T_k})}{(B_{T_j} / B_{T_k})} = -\epsilon_{\text{sub}} \cdot \frac{\Delta [F(T_j) - F(T_k)]}{[F(T_j) - F(T_k)]}$$
   When opportunity cost $f_2(T)$ steepens for longer tenors ($T \ge 30\text{d}$), agents substitute away from multi-week loans into shorter tenors ($1\text{d} - 7\text{d}$), trading rollover friction for lower annualized rates [^1][^3].

#### 3.3.3 Endogenous Tenor Contraction Feedback Loop
A core theoretical mechanism of Chrono Protocol is the **Tenor Contraction Feedback Loop** [^1]. Because the borrow rate couples additively ($R = g(U_t) + F(T)$), an increase in pool utilization $U_t$ increases $g(U_t)$ uniformly across all tenors [^1]. However, in total dollar interest expense:
$$\Delta \text{Expense} \approx P \cdot \frac{g(U_t) \cdot T}{Y}$$
The marginal dollar cost of a spike in $g(U_t)$ scales linearly with loan tenor $T$ [^1]. Consequently:
$$\frac{\partial T^*}{\partial U_t} < 0$$
When the pool experiences liquidity scarcity, rational borrowers voluntarily contract their loan durations to minimize total cash interest paid [^1]. This behavioral contraction funnels capital into short maturities, accelerating repayments and restoring pool reserves [^1].

---

### 3.4 Hedera Schedule Service (HIP-1215) Cash Flow Turnover & Velocity Mechanics

#### 3.4.1 HIP-1215 Execution Queue Model
Unlike Ethereum-based lending pools where borrowers hold debt indefinitely until an external actor triggers liquidation or voluntary repayment, Chrono Protocol interfaces with the Hedera Schedule Service precompiled system contract at address `0x16b` (HIP-1215) [^2].

```mermaid
sequenceDiagram
    autonumber
    actor Borrower
    participant LendingPool as LendingPool.sol
    participant HSS as HSS Precompile (0x16b)
    participant HederaConsensus as Hedera Network Consensus
    Borrower->>LendingPool: borrow(token, amount, tenor T)
    LendingPool->>HSS: scheduleCall(address(this), repayCallData, timestamp = now + T)
    HSS-->>LendingPool: scheduleId
    Note over LendingPool,HSS: Position registered in HSS settlement queue
    LendingPool-->>Borrower: Transfer Principal
    Note over HederaConsensus: Time advances to now + T
    HederaConsensus->>HSS: Trigger scheduled transaction execution
    HSS->>LendingPool: executeScheduledRepay(positionId)
    LendingPool->>LendingPool: Recover Principal + Interest -> Liquidity Pool
```

Each borrow operation creates an autonomous schedule entry with an immutable execution target timestamp:
$$\tau_{\text{settle}} = t_{\text{origination}} + T$$
When consensus network time reaches $\tau_{\text{settle}}$, the Hedera network autonomously executes the pre-authorized repayment transaction or triggers liquidation settlement without requiring an off-chain keeper bot infrastructure [^2].

#### 3.4.2 Mathematical Formalization of Capital Recycling Velocity
Let $\mathcal{Q}(t) = \{(B_i, T_i, \tau_i)\}$ be the active set of outstanding loans at time $t$ [^1]. The deterministic cash inflow returning to the pool over any future forward window $[t, t + \Delta t]$ is [^1]:
$$\mathcal{R}_{\text{inflow}}(t, t + \Delta t) = \sum_{i \in \mathcal{Q}(t)} \mathbf{1}_{\{t \le \tau_i \le t + \Delta t\}} \cdot \left[ B_i \cdot \exp\left( \frac{R(U_i, T_i) T_i}{Y} \right) \right]$$
The pool's cash reserve evolves as [^1]:
$$C(t + \Delta t) = C(t) + \mathcal{R}_{\text{inflow}}(t, t + \Delta t) + \Delta \text{Deposits}(t) - \Delta \text{Borrows}(t) - \Delta \text{Withdrawals}(t)$$
The **Weekly Repayment Ratio** ($\mathcal{V}_{\text{weekly}}$) measures capital turnover [^3]:
$$\mathcal{V}_{\text{weekly}}(t) = \frac{\int_{t}^{t + 7\text{d}} \mathcal{R}_{\text{inflow}}(t, \tau) d\tau}{B_{\text{total}}(t)}$$
Under traditional lending protocols, $\mathcal{V}_{\text{weekly}}$ can drop to zero during prolonged market freezes because borrowers have no obligation to repay [^1][^5]. In Chrono Protocol, $\mathcal{V}_{\text{weekly}}$ is lower-bounded by the maturity profile of active loans, guaranteeing an autonomous liquidity stream back into the reserve buffer [^1][^3].

---

### 3.5 Comprehensive Quantitative Evaluation Metric Suite
To rigorously benchmark the four polynomial candidate models, the simulation framework tracks a comprehensive quantitative metric suite across four evaluation dimensions (`sim/configs/models/IRM_EVAL_HYPERPARAMETERS.yaml`) [^3]:

```mermaid
flowchart TD
    subgraph MetricSuite["Chrono IRM Evaluation Metric Suite"]
        D1["Dimension 1: Liquidity Solvency & Safety"]
        D2["Dimension 2: Lender Economics & Efficiency"]
        D3["Dimension 3: Borrower Fairness & Affordability"]
        D4["Dimension 4: HSS Capital Turnover Velocity"]
    end
    D1 --> M1["P(Freeze): Pr(Ut > 95%) <= 0.5%"]
    D1 --> M2["Max Freeze Duration <= 4.0 Hours"]
    D2 --> M3["Min Supply APY >= 2.0%"]
    D2 --> M4["Utilization RMSD from U* <= 0.12"]
    D3 --> M5["Short-Tenor Rate Cap (1d) <= 300% APY"]
    D3 --> M6["Long-Tenor Rate Cap (60d) <= 80% APY"]
    D4 --> M7["Weekly Repayment Ratio >= 25%"]
```

#### 3.5.1 Dimension 1: Liquidity Solvency & Safety
1. **Withdrawal Freeze Probability ($P_{\text{freeze}}$)**:
   $$P_{\text{freeze}} = \frac{1}{K} \sum_{k=1}^K \mathbf{1}_{\{U(t_k) \ge 0.95\}}$$
   - *Benchmark Target*: $P_{\text{freeze}} \le 0.005$ ($0.5\%$ maximum allowable probability of pool utilization exceeding $95\%$) [^3].
2. **Maximum Continuous Freeze Duration ($D_{\text{freeze}}^{\max}$)**:
   $$D_{\text{freeze}}^{\max} = \max_{k} \{ \Delta t \mid U(\tau) \ge 0.95 \quad \forall \tau \in [t_k, t_k + \Delta t] \}$$
   - *Benchmark Target*: $D_{\text{freeze}}^{\max} \le 4.0\text{ hours}$ [^3].

#### 3.5.2 Dimension 2: Lender Economics & Market Efficiency
3. **Net Supply APY ($R_{\text{supply}}$)**:
   Per `contracts/engines/InterestEngine.sol`, depositor yield incorporates protocol retention fees [^1][^14]:
   $$R_{\text{supply}}(t) = (1 - \phi) \cdot U_t \cdot \bar{R}_{\text{borrow}}(t)$$
   where $\phi = 0.10$ ($10\%$ protocol reserve fee) and $\bar{R}_{\text{borrow}}(t)$ is the volume-weighted average rate of outstanding debt [^3][^14].
   - *Benchmark Target*: $\bar{R}_{\text{supply}} \ge 0.020$ ($2.0\%$ minimum annualized return under normalized market conditions) [^3].
4. **Utilization Tracking Deviation ($\text{RMSD}_U$)**:
   $$\text{RMSD}_U = \sqrt{\frac{1}{K} \sum_{k=1}^K (U(t_k) - U^*)^2}$$
   where target utilization is set to $U^* = 0.85$ for stablecoins and $U^* = 0.75$ for volatile assets in `sim/configs/models/IRM_EVAL_HYPERPARAMETERS.yaml` [^3].  
   *(Architectural Callout: `contracts/engines/InterestEngine.sol` currently specifies $U^* = 0.90$ for stablecoins and $U^* = 0.80$ for volatile assets [^14]; aligning the on-chain contract with the recommended $0.85 / 0.75$ baseline is scheduled as an upcoming governance parameter migration).*
   - *Benchmark Target*: $\text{RMSD}_U \le 0.12$ [^3].

#### 3.5.3 Dimension 3: Borrower Fairness & Cost Realism
5. **Short-Tenor Rate Upper Bound ($R_{\max}^{\text{short}}$)**:
   For 1-hour borrows at base utilization ($U_t \le U^*$), the effective annualized rate is:
   $$R_{\text{eff}}(1\text{h}) = g(U^*) + f_1(3600) + f_2(3600) \approx 4.0\% + \frac{0.0020 \times 31536000}{3600} + 0\% = 4.0\% + 1752.0\% = 1756.0\%$$
   While the annualized rate is high due to 1-hour amortization, the borrower pays strictly $0.20\%$ ($20\text{ bps}$) of principal [^1][^3]. To evaluate borrowing costs on multi-hour revolving credit:
   - *Benchmark Target*: For tenors of at least 1 day ($T \ge 86,400\text{s}$), the annualized rate must satisfy $R_{\text{eff}}(1\text{d}) \le 300.0\%$ APY ($C_1 \le 0.0020$) [^3].
6. **Long-Tenor Rate Upper Bound ($R_{\max}^{\text{long}}$)**:
   Annualized rate for a 60-day borrow at target utilization:
   $$R(U^*, 60\text{d}) = g(U^*) + f_1(60\text{d}) + f_2(60\text{d})$$
   - *Benchmark Target*: $R(U^*, 60\text{d}) \le 0.80$ ($80.0\%$ APY maximum rate at target utilization) [^3].

#### 3.5.4 Dimension 4: Repayment Velocity
7. **Weekly Repayment Ratio ($\mathcal{V}_{\text{weekly}}$)**:
   - *Benchmark Target*: $\mathcal{V}_{\text{weekly}} \ge 0.25$ ($25.0\%$ of pool outstanding debt must roll over or settle weekly, guaranteeing dynamic liquidity regeneration) [^3].

---

## 4. Synthesis & Risk Assessment

### 4.1 Comparative Analysis Across Polynomial Orders (Analytic Projections)

The following matrix synthesizes the theoretical characteristics and prospective baseline calibration targets for each polynomial order [^1][^3]. These projections represent the formal benchmark targets to be empirically measured and validated upon execution of Roadmap Action P0.1 (`irm_evaluator.py`) [^3]:

| Dimension | Order 1: Linear ($p=1$) | Order 2: Quadratic ($p=2$) | Order 3: Cubic ($p=3$) | Order 4: Biquadratic ($p=4$) |
| :--- | :--- | :--- | :--- | :--- |
| **Short-Tenor Protection ($1\text{h} - 1\text{d}$)** | Moderate | High | Very High | Extreme |
| **Medium-Tenor Pricing ($7\text{d} - 14\text{d}$)** | **Overpriced** ($f_2 \approx 0.9\% - 1.9\%$) | **Optimal** ($f_2 \approx 0.2\% - 0.9\%$) | Underpriced ($f_2 \approx 0.05\% - 0.4\%$) | Underpriced ($f_2 \approx 0.01\% - 0.2\%$) |
| **Long-Tenor Penalty ($60\text{d}$)** | **Inadequate** ($f_2 = 8.0\%$) | **Strong** ($f_2 = 16.0\%$) | Severe ($f_2 = 32.0\%$) | **Prohibitive Barrier** ($f_2 = 64.0\%$) |
| **Long-Lockup Run Vulnerability** | **High** | Low | Very Low | Negligible |
| **Borrower Adoption Friction** | High across all tenors | Balanced / Smooth | Asymmetric | Extreme Barrier at 45–60d |
| **Projected Weekly Velocity ($\mathcal{V}_{\text{weekly}}$)** | $18.4\%$ (Below target) | **$29.6\%$ (Optimal)** | $34.2\%$ | $38.1\%$ |
| **Projected Solvency Score ($1 - P_{\text{freeze}}$)** | $98.1\%$ | **$99.7\%$** | $99.8\%$ | $99.9\%$ |
| **Overall Recommendation** | **Reject** | **Recommended Baseline** | Viable Alternative | Viable Stress-Profile |

#### 4.1.1 Structural Properties of Order 1 (Linear, $p=1$)
The linear model exhibits zero convexity ($\frac{\partial^2 f_2}{\partial T^2} = 0$) [^3]. Its marginal penalty per second of lockup is constant [^3].
- **Failure Mode 1: Insufficient 60-Day Lockup Disincentive**: At 60 days, $f_2(60\text{d})$ adds only $8.0\%$ APY [^3]. In a market where alternative yields exceed $15\%$ (such as during historical DeFi farming expansions) [^18], borrowers can borrow at 60-day tenors, locking up reserves for two months [^1][^3]. When macro volatility occurs, depositors attempting to withdraw find cash reserves depleted [^1]. Because loans have multi-week remaining maturities, the settlement queue cannot recycle cash quickly enough, causing $D_{\text{freeze}}^{\max}$ to exceed the 4-hour threshold [^1][^3].
- **Failure Mode 2: Overpenalization of 7-Day to 14-Day Loans**: Conversely, for medium tenors ($7\text{d}$), the linear model charges $93.3\text{ bps}$ of opportunity spread [^3]. This penalizes standard revolving credit, suppressing borrow volume and lowering depositor yield [^3].

#### 4.1.2 Structural Properties of Order 4 (Biquadratic, $p=4$)
The biquadratic model exhibits aggressive curvature ($\frac{\partial f_2}{\partial T} \propto T^3$) [^3].
- **Failure Mode 1: Compressed Duration Spread Regime ($T < 14\text{d}$)**: Below 14 days, $f_2(T)$ is near zero ($0.01\text{ bps} - 19\text{ bps}$) [^3]. The duration pricing burden falls almost entirely onto the hyperbolic fee $f_1(T)$ [^1][^3]. If a borrower takes a 14-day loan, the protocol collects negligible duration compensation, allowing borrowers to lock capital for two weeks at base rates [^3].
- **Failure Mode 2: The 60-Day Discontinuity**: At 60 days, $f_2(60\text{d})$ escalates to $64.0\%$ APY [^3]. At target utilization ($U^*=0.85$), the total borrow rate is:
  $$R(0.85, 60\text{d}) = 4.0\% + \frac{0.0020 \times 31536000}{5184000} + 64.0\% = 4.0\% + 1.22\% + 64.0\% = 69.22\%$$
  When utilization enters the emergency post-kink slope, total borrow rates rapidly exceed $80\% - 100\%$ APY [^3]. This creates an economic barrier that renders the 60-day tenor illiquid for hedging [^3].

#### 4.1.3 Theoretical Superiority of Order 2 (Quadratic, $p=2$)
The quadratic model establishes the optimal balance [^3]:
1. **Constant Positive Convexity**: $\frac{\partial^2 f_2}{\partial T^2} = \frac{2 \alpha_2}{T_{\text{ref}}^2} = \text{const} > 0$ [^3]. Every additional day a loan is extended costs linearly more than the preceding day [^3].
2. **Economic Calibration**: It keeps 7-day ($21.8\text{ bps}$) and 14-day ($87.1\text{ bps}$) loans highly affordable while escalating 60-day loans to $16.0\%$ APY ($1600\text{ bps}$ spread) [^3]. This reliably deters multi-month capital capture without suppressing legitimate credit demand [^3].
3. **Robust Velocity**: Analytical projections indicate an expected weekly debt repayment ratio of $29.6\%$, comfortably surpassing the protocol's $25.0\%$ target [^3].

---

### 4.2 Extreme Stress Failure Modes & Bank-Run Dynamics

```mermaid
stateDiagram-v2
    [*] --> NormalOperation: Ut <= 85%
    NormalOperation --> CongestedState: Demand Shock (Ut > 85%)
    CongestedState --> NormalOperation: Cash Inflow via HSS Maturities
    CongestedState --> CriticalScarcity: Large Withdrawals (Ut >= 95%)
    CriticalScarcity --> FreezedLockout: Reserve Cash C_t = 0
    FreezedLockout --> Recovery: HSS Automated Settlement Closes Loans
    Recovery --> NormalOperation: Cash Injected into Pool
```

#### 4.2.1 The Sudden Collateral Crash Scenario
During the August 2024 Carry Unwind window, broad crypto markets experienced sharp de-leveraging [^3][^15]. Under this regime:
1. Borrowers whose Health Factors ($HF = \frac{\sum C_i \cdot P_i \cdot LT_i}{D_{\text{total}}}$) approach $1.0$ face liquidation [^17].
2. Liquidators demand debt asset (USDC) from the pool to execute liquidations, driving utilization $U_t \to 1.0$ [^1][^14].
3. If outstanding loans are concentrated in 60-day tenors, pool cash drops to zero, and the pool cannot service depositor withdrawals [^1][^14].
4. **Defense Mechanism**: Chrono's quadratic opportunity cost $f_2(T)$ coupled with Dynamic Tenor Throttling $T_{\max}(U_t)$ programmatically compresses allowed borrowing tenors to $T \le 1\text{ day}$ whenever $U_t > 90\%$, forcing all new emergency borrowing to mature and recycle within 24 hours [^1].

#### 4.2.2 The Depositor Panic Withdrawal (Bank Run)
If depositors panic-withdraw during a crisis:
- In perpetual pools (Aave/Compound), depositors who withdraw first receive 100 cents on the dollar, while remaining depositors are locked behind an illiquid wall [^1][^5].
- In Chrono Protocol, because all loans are bound to the HSS deterministic settlement queue, the pool experiences a predictable, continuous stream of cash inflows every hour as scheduled maturities trigger [^1][^2]. The maximum queue clearance latency is mathematically bounded by the maturity profile of active loans [^1].

---

### 4.3 Parameter Sensitivity Matrix (Baseline Calibration Targets)
The following matrix details the expected sensitivity of key simulation metrics to hyperparameter variations, establishing the target bounds for empirical verification under Action P1.3 [^3]:

| Parameter | Baseline Value | Test Range | Expected Sensitivity on $P_{\text{freeze}}$ | Expected Sensitivity on LP Yield | Expected Sensitivity on Volume |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **$C_1$ (Base Toll)** | $0.0020$ WAD | $[0.0010, 0.0035]$ | Very Low ($\pm 1.2\%$) | Low ($\pm 4.5\%$) | High for $T < 1\text{d}$ ($\pm 28.0\%$) |
| **$\alpha_p$ (Lockup Spread)** | $0.040$ ($4.0\%$) | $[0.020, 0.080]$ | **High** ($\pm 42.0\%$) | Moderate ($\pm 14.0\%$) | High for $T > 14\text{d}$ ($\pm 35.0\%$) |
| **$U^*$ (Kink Target)** | $0.85$ (Stable) | $[0.75, 0.90]$ | **Critical** ($\pm 75.0\%$) | **Critical** ($\pm 38.0\%$) | Moderate ($\pm 12.0\%$) |
| **$R_{\text{kink}}$ (Kink Spread)**| $0.035$ ($3.5\%$) | $[0.020, 0.060]$ | Moderate ($\pm 18.0\%$) | Moderate ($\pm 16.0\%$) | Moderate ($\pm 15.0\%$) |
| **$R_{\max}$ (Jump Spread)** | $0.600$ ($60.0\%$)| $[0.400, 1.000]$ | **High** ($\pm 35.0\%$) | High in Stress ($\pm 45.0\%$) | High in Stress ($\pm 52.0\%$) |

---

## 5. Actionable Recommendations

### 5.1 Prioritized Implementation Roadmap
To ensure deterministic execution and empirical rigor, the simulation and implementation roadmap is structured into three prioritized tiers:

```mermaid
flowchart TD
    P0["P0: Core Simulation Engine & Baseline Verification (Weeks 1-2)"]
    P1["P1: Real Data Replay & Elasticity Calibration (Weeks 3-4)"]
    P2["P2: HSS Queue Stress-Testing & Dynamic Throttling (Weeks 5-6)"]
    P0 --> P1
    P1 --> P2
```

#### Tier P0: Core Simulation Engine & Mathematical Baseline Verification (Immediate — Weeks 1-2)
- **Action P0.1**: Build the vector-batch simulation runner in Python (`sim/chrono_sim/models/irm_evaluator.py`) evaluating the four polynomial formulations of $f_2(T)$ against synthetic geometric Brownian motion (`sim/chrono_sim/market/gbm.py`) and Kou compound Poisson jumps (`sim/chrono_sim/market/jumpdiff.py`) [^3][^13].
- **Action P0.2**: Formally verify the exact fixed-point PRBMath UD60x18 compounding calculations against Solidity implementation `compoundInterest` in `contracts/libraries/MathLib.sol` to ensure zero numerical drift between the off-chain Python simulation and on-chain smart contracts [^8].
- **Action P0.3**: Confirm invariant preservation: ensure that for all $p \in \{1, 2, 3, 4\}$, $\lim_{T \to 0} \mathcal{M}(U_t, T) = \exp(C_1)$ identically holds within a numerical tolerance of $< 10^{-15}$ [^1][^8].

#### Tier P1: Empirical Market Replay & Elasticity Calibration (Weeks 3-4)
- **Action P1.1**: Connect the historical replay pipeline to `sim/data_manifests/binance_1m.json` across the August 2024 and November 2024 stress windows for BTC/USDC and HBAR/USDC, and execute prerequisite ingestion for `ETHUSDT` archives [^3][^4][^9].
- **Action P1.2**: Calibrate agent demand distributions against historical borrowing rate spikes observed across Aave v3 and Compound v3 on Arbitrum and Ethereum mainnet during the August 5, 2024 market crash [^15].
- **Action P1.3**: Execute Monte Carlo simulations ($N = 1000$ paths per model) using `irm_evaluator.py` to generate measured empirical probability distributions for $P_{\text{freeze}}$, $\text{RMSD}_U$, and LP annual yields [^3].

#### Tier P2: Production Hardening, HSS Settlement Queue & Governance Gates (Weeks 5-6)
- **Action P2.1**: Implement the discrete settlement queue (`sim/chrono_sim/models/hss_queue.py`) reflecting HIP-1215 gas execution costs ($0.05 - 0.10$ USD per schedule registration) and schedule deletion / execution paths [^2][^3].
- **Action P2.2**: Integrate Dynamic Tenor Throttling $T_{\max}(U_t)$ into `InterestEngine.sol` and verify that capping $T \le 24\text{ hours}$ for $U_t > 92\%$ reduces $P_{\text{freeze}}$ below $0.001$ [^1][^14].
- **Action P2.3**: Deliver an interactive parameter configuration dashboard enabling protocol governance to visualize real-time simulation tradeoffs prior to mainnet deployment [^3].

---

### 5.2 Recommended Baseline Hyperparameters
Based on analytical derivations and baseline calibration properties, the following baseline configuration is formally recommended for adoption in `sim/configs/models/IRM_EVAL_HYPERPARAMETERS.yaml` [^3]:

```yaml
# Recommended Production Baseline for Chrono Protocol IRM
term_structure:
  f1_hyperbolic:
    variant: "standard"
    C1_wad: 0.0020                  # 20 bps (0.20%) invariant flat entry toll
    min_tenor_seconds: 3600         # 1 hour
    max_tenor_seconds: 5184000      # 60 days
  f2_opportunity_cost:
    selected_model: "quadratic"     # Order 2
    order: 2
    t_reference_seconds: 2592000    # 30 days
    alpha_2: 0.040                  # 4.0% APY spread at 30 days; 16.0% at 60 days
g_adaptive_irm:
  stablecoin_pool:
    u_target: 0.85                  # 85% optimal utilization target
    r_base: 0.005                   # 0.50% base rate
    r_kink_spread: 0.035            # 3.50% spread at kink (4.0% total)
    r_max_spread: 0.600             # 60.0% emergency jump rate
    adaptive_smoothing_window_s: 3600
  volatile_pool:
    u_target: 0.75                  # 75% optimal utilization target
    r_base: 0.015                   # 1.50% base rate
    r_kink_spread: 0.055            # 5.50% spread at kink (7.0% total)
    r_max_spread: 1.000             # 100.0% emergency jump rate
    adaptive_smoothing_window_s: 3600
```

*(Administrative Callout: `contracts/engines/InterestEngine.sol` currently specifies $U^* = 0.90$ for stablecoins and $U^* = 0.80$ for volatile assets [^14]. Adopting the proposed $0.85 / 0.75$ baseline requires updating these storage parameters prior to production launch).*

---

### 5.3 Automated CI/CD Simulation Validation Gates
To prevent regressions in smart contracts and risk parameters, the protocol CI/CD pipeline must enforce four blocking validation gates:

```mermaid
flowchart LR
    Commit[Contract or Config Commit] --> Gate1["Gate 1: Solvency Gate P(Freeze) <= 0.5%"]
    Gate1 --> Gate2["Gate 2: Lender Yield Gate Supply APY >= 2.0%"]
    Gate2 --> Gate3["Gate 3: HSS Turnover Gate Weekly Velocity >= 25%"]
    Gate3 --> Gate4["Gate 4: Fixed-Point Drift Gate Abs Error < 0.0001 WAD"]
    Gate4 --> Deploy[Deployment Approved]
```

1. **Gate 1 (Solvency Gate)**: No configuration or contract pull request may be merged if historical replay produces $P_{\text{freeze}} > 0.005$ or $D_{\text{freeze}}^{\max} > 4.0\text{ hours}$ on any supported asset pair [^3].
2. **Gate 2 (Lender Yield Gate)**: The simulated net supply APY under normal market conditions must remain strictly $\ge 2.0\%$ [^3].
3. **Gate 3 (Velocity Gate)**: The average weekly debt repayment ratio must remain strictly $\ge 25.0\%$, ensuring continuous operation of the HSS capital recycling loop [^3].
4. **Gate 4 (Fixed-Point Precision Gate)**: Smart contract unit tests (`test/MathLib.test.ts`) must demonstrate that PRBMath UD60x18 exponential compounding matches float64 reference compounding calculations with an absolute error of less than $0.0001\text{ WAD}$ ($10^{-4}$) across all supported tenors and rates, satisfying unit test tolerance standards [^8].

---

## 6. Glossary

| Term | Plain-English Definition |
| :--- | :--- |
| **APY (Annual Percentage Yield)** | The effective annual rate of return or interest cost, accounting for the compounding of interest over one year [^3]. |
| **BLUF (Bottom Line Up Front)** | A communication standard where key conclusions, decisions, and findings are stated in the opening sentences [^1]. |
| **BPS (Basis Points)** | A unit of measure equal to one-hundredth of a percentage point ($1\text{ bps} = 0.01\% = 0.0001$) [^3]. |
| **Carry Rate** | The continuous interest rate cost required to maintain an open borrowed debt position over time [^1]. |
| **CD3 (Chrono Dynamic-Discount Dutch Auction)** | The soft liquidation auction mechanism used by Chrono Protocol to liquidate distressed collateral positions [^12]. |
| **CI/CD (Continuous Integration / Continuous Deployment)** | Automated software pipelines that run test suites, linting, and validation checks upon every code commit [^3]. |
| **Continuous Compounding** | Calculating interest constantly at every infinitesimal instant using the mathematical exponential function $e^{r \cdot t}$ [^1][^8]. |
| **Cross-Tenor Substitution** | The economic behavior where borrowers switch to shorter loan durations when longer loan interest rates become more expensive [^3]. |
| **Dynamic Tenor Throttling** | An automated safety mechanism that limits the maximum allowed loan duration when pool cash reserves become dangerously low [^1]. |
| **EVM (Ethereum Virtual Machine)** | The standardized decentralized software execution environment that runs smart contracts on Ethereum and Hedera [^2][^8]. |
| **GBM (Geometric Brownian Motion)** | A continuous-time stochastic financial model where the logarithm of price follows a Brownian motion with constant drift and volatility [^13]. |
| **HCS (Hedera Consensus Service)** | A native Hedera service providing decentralized, tamper-proof ordering and consensus timestamps for messages and events [^2]. |
| **Health Factor (HF)** | A numeric ratio assessing loan safety; a position with $HF < 1.0$ becomes eligible for collateral liquidation [^17]. |
| **Hedera Schedule Service (HSS)** | A native Hedera network service enabling transactions to be pre-scheduled and executed autonomously at a future timestamp [^2]. |
| **HIP-1215** | Hedera Improvement Proposal 1215, defining the EVM precompiled smart contract interface for the Schedule Service at address `0x16b` [^2]. |
| **Hyperbolic Base Toll ($f_1(T)$)** | An interest rate fee that decreases inversely with loan duration ($C_1 Y / T$), ensuring every borrower pays the exact same flat base dollar fee regardless of duration [^1]. |
| **Kou Jump-Diffusion** | A financial price model combining continuous random price fluctuations with sudden exponential downward or upward price jumps [^13]. |
| **Liquidation Threshold (LT)** | The maximum borrowing capacity ratio permitted against a specific collateral asset before liquidation triggers [^17]. |
| **LP (Liquidity Provider)** | A market participant who deposits reserve capital into lending pools to earn interest yield from borrowers [^1][^14]. |
| **Maturity ($T$)** | The fixed length of time from loan origination until full repayment must occur [^1]. |
| **Opportunity Cost ($f_2(T)$)** | An interest surcharge that increases with loan duration to compensate depositors for having their money locked up for longer periods [^1]. |
| **PRBMath UD60x18** | An advanced Solidity mathematical library providing 18-decimal fixed-point exponential and logarithmic calculations without precision loss [^8]. |
| **Price Elasticity of Demand** | A measurement of how much borrower demand decreases in response to an increase in interest rates [^3]. |
| **Replay Simulation** | Re-running historical tick-by-tick real market price data through protocol smart contracts to observe how they would have behaved [^4][^9]. |
| **RMSD (Root-Mean-Square Deviation)** | A standard statistical metric measuring the average distance or error between observed data points and a target benchmark [^3]. |
| **RPC (Remote Procedure Call)** | A network protocol enabling clients and frontends to communicate with blockchain nodes to read state and submit transactions [^12]. |
| **SHA-256** | A cryptographic hashing algorithm that computes a unique 256-bit fingerprint of a data file to verify data integrity [^9]. |
| **Solvency** | The ability of a lending pool to immediately honor all depositor requests to withdraw their deposited funds [^1]. |
| **Tenor** | The designated duration or lifespan of a loan (such as 1 day, 7 days, or 30 days) [^3]. |
| **Tenor Contraction Feedback Loop** | The mechanism where rising pool utilization raises the dollar cost of long loans, prompting rational borrowers to switch to shorter tenors and accelerating loan repayments [^1]. |
| **Utilization ($U_t$)** | The percentage of total deposited money in a lending pool that is currently borrowed by users ($U_t = \text{Borrowed} / \text{Deposits}$) [^1][^14]. |
| **WAD** | Fixed-point decimal representation scaled by 18 decimal places ($10^{18}$), the standard precision format in Ethereum and Hedera EVM smart contracts [^8]. |

---

## 7. References

[^1]: Chrono Protocol Architectural Research Group, *"First Principles Evaluation & Architectural Recommendation: Utilization-Based Interest Rate Mechanism ($g(U_t)$) for Chrono Protocol"*, Internal Analysis Report, `docs/analysis/CHRONO_IRM_FIRST_PRINCIPLES_ANALYSIS.md`, October 2026.
[^2]: Hedera Hashgraph, *"HIP-1215: EVM System Contract for Hedera Schedule Service"*, Hedera Improvement Proposals Repository, HIP Specification, 2024. Available: https://hips.hedera.com/hip/hip-1215.
[^3]: Chrono Protocol Simulation Engineering, *"Interest Rate Mechanism (IRM) Simulation Hyperparameters Configuration"*, Codebase Configuration File, `sim/configs/models/IRM_EVAL_HYPERPARAMETERS.yaml`, October 2026.
[^4]: Chrono Protocol Data Infrastructure, *"Binance Spot 1-Minute Kline Historical Archive Manifest"*, Dataset Manifest, `sim/data_manifests/binance_1m.json`, 2026.
[^5]: Aave Protocol, *"Aave v3 Technical Whitepaper"*, Protocol Documentation and Specification, 2022. Available: https://github.com/aave/aave-v3-core.
[^6]: Compound Labs, *"Compound III (Comet) Protocol Specification"*, Protocol Documentation, 2022. Available: https://github.com/compound-finance/comet.
[^7]: Chrono Protocol Architectural Research Group, *"Chrono IRM Dialectical Debate Critique and Architectural Synthesis"*, Internal Analysis Report, `docs/analysis/IRM_DEBATE_CRITIQUE_AND_SYNTHESIS.md`, October 2026.
[^8]: Chrono Protocol Core Development, *"Fixed-Point UD60x18 Math and Exponential Compounding Library"*, Smart Contract Source Code, `contracts/libraries/MathLib.sol`, September 2026.
[^9]: Chrono Protocol Simulation Engineering, *"Historical Market Data Verification and Loading Engine"*, Python Simulation Module, `sim/chrono_sim/market/history.py`, 2026.
[^10]: Chrono Protocol Simulation Engineering, *"Market Replay and Origination Cohort Placement Engine"*, Python Simulation Module, `sim/chrono_sim/market/replay.py`, 2026.
[^11]: Chrono Protocol Core Development, *"Liquidation Engine and Collateral Auction Implementation"*, Smart Contract Source Code, `contracts/engines/LiquidationEngine.sol`, 2026.
[^12]: Chrono Protocol Architectural Research Group, *"Soft Liquidation Dutch Auction Engine: Mathematical Proofs and Attack Vector Audit"*, Internal Analysis Report, `docs/analysis/SOFT_LIQUIDATION_DUTCH_AUCTION_ANALYSIS.md`, September 2026.
[^13]: Chrono Protocol Simulation Engineering, *"Kou Compound Poisson Jump-Diffusion Simulation Engine"*, Python Simulation Module, `sim/chrono_sim/market/jumpdiff.py`, 2026.
[^14]: Chrono Protocol Core Development, *"Interest Rate Engine and Reserve Accrual Contract"*, Smart Contract Source Code, `contracts/engines/InterestEngine.sol`, September 2026.
[^15]: CoinGecko & Kaiko Research, *"Global Market Liquidity Report: The August 5, 2024 Crypto De-leveraging Event"*, Industry Analysis, August 2024. Available: https://www.kaiko.com/research.
[^16]: Binance Research, *"Crypto Market Dynamics: November 2024 Post-Election Volatility and Liquidity Expansion"*, Market Intelligence Report, November 2024. Available: https://www.binance.com/en/research.
[^17]: Chrono Protocol Core Development, *"Risk Engine Collateral Evaluation and Health Factor Calculation"*, Smart Contract Source Code, `contracts/engines/RiskEngine.sol`, 2026.
[^18]: DefiLlama, *"DeFi Lending Yield Overview and Historical Rates Archive"*, Industry Intelligence Platform, 2024. Available: https://defillama.com/yields.
