# Chrono Protocol — Primer for Non-Crypto Readers

This document explains every idea you need to understand the Chrono Protocol whitepaper — from scratch. No prior blockchain, crypto, or finance knowledge is assumed. Read this first, then the whitepaper will make sense.

---

## 1. What Problem Does Chrono Solve?

Imagine you want to take out a short-term loan against an asset you own. In the real world, a pawnshop gives you cash in exchange for holding your watch. If you come back and repay, you get your watch back. If you don't, they sell it.

Chrono Protocol does this digitally — but with a twist that doesn't exist in traditional lending:

**The shorter you borrow for, the more you can borrow.**

This is the core idea. Existing crypto lending platforms give everyone the same borrowing limits whether they borrow for 5 minutes or 5 months. Chrono recognizes that a 1-hour loan is far less risky than a 30-day loan (because prices have less time to crash), so it lets short-term borrowers access more capital.

---

## 2. Blockchain Basics (What You Need to Know)

### What is a Blockchain?

A blockchain is a shared digital ledger — a database that no single person controls. Instead of trusting a bank to keep records, thousands of computers worldwide each hold an identical copy of every transaction ever made. If someone tries to cheat, the other computers reject the fake entry.

**Why this matters for Chrono:** The lending, borrowing, and liquidation rules all live on this shared ledger. Nobody can secretly change the rules or freeze your funds — the code enforces everything automatically.

### What is a Smart Contract?

A smart contract is a program that lives on the blockchain. Think of it as a vending machine: you put in the right inputs, and it always produces the same outputs. No human middleman decides whether to honor the deal — the code executes automatically.

**Why this matters for Chrono:** All of Chrono's lending pools, interest calculations, and liquidation logic are smart contracts. When you deposit collateral and borrow, you're interacting with code that enforces the rules identically for everyone.

### What are Tokens?

A token is a digital asset tracked on a blockchain. Just like a bank tracks how many dollars are in your account, a blockchain tracks how many tokens each address holds.

There are two kinds relevant to Chrono:

| Type | Example | Description |
|:---|:---|:---|
| **Stablecoins** | USDC, USDT | Tokens designed to stay at exactly \$1. Used as the "cash" side of a loan. |
| **Volatile assets** | ETH, BTC | Tokens whose price fluctuates with the market. Used as collateral. |

In Chrono's test environment, these are wrapped versions: **wETH** (wrapped ETH) and **wUSDC** (wrapped USDC), which are standard token representations on the Hedera network.

### What is a Wallet?

A wallet is your identity on the blockchain — like a username and password combined. It holds your tokens and signs transactions (authorizes actions). Popular wallet software includes MetaMask and HashPack.

---

## 3. How Lending and Borrowing Work On-Chain

### The Lending Pool

Imagine a big shared jar of money. Lenders (people with idle capital) put tokens into this jar. Borrowers take tokens out of the jar, but only if they lock up something valuable (collateral) first.

**The key actors:**

| Role | What they do | What they earn/risk |
|:---|:---|:---|
| **Lender (Supplier)** | Deposits tokens into the pool | Earns interest from borrowers. Risk: if too many borrowers default, the pool could lose value. |
| **Borrower** | Locks up collateral, borrows tokens from the pool | Pays interest. Risk: if your collateral drops in value, you get liquidated. |

### Where This Model Exists Today

On-chain lending pools are not a new concept — several protocols pioneered this design:

- **Compound** (2018) was one of the first protocols to implement permissionless lending pools with algorithmically-set interest rates. Anyone could deposit or borrow without asking permission.
- **Aave** (2020) expanded on Compound with features like flash loans (ultra-short uncollateralized borrows within a single transaction), multiple collateral types, and variable/stable rate options. It is one of the largest DeFi protocols, with billions in deposits.
- **Morpho** (2022–present) takes a different approach: instead of pooling all lender capital together, it matches individual lenders directly with individual borrowers for better rates, falling back to pool-based lending when no direct match exists. Morpho Blue further innovates by letting anyone create isolated lending markets with custom parameters.

All of these share the same fundamental pattern that Chrono uses: *deposit collateral → borrow against it → pay interest → risk liquidation if your collateral value drops*. Chrono's innovation is layering **duration-based risk** on top of this proven foundation.

### Collateral & Overcollateralization — Why You Must Deposit More Than You Borrow

In traditional finance, banks frequently issue **uncollateralized** or **undercollateralized** loans (such as credit cards or personal loans). They can do this because they know your real-world identity, check your credit score, and have legal recourse (courts and debt collectors) if you refuse to pay.

In decentralized finance (DeFi), none of those safeguards exist:
- **No identities:** Users interact through pseudonymous wallet addresses.
- **No credit scores:** Smart contracts have no way of knowing your creditworthiness.
- **No legal enforcement:** A piece of computer code cannot sue you in court or repossess your car.

If a DeFi protocol allowed someone to deposit \$500 worth of assets and borrow \$1,000 in cash, any rational user would simply take the \$1,000 and abandon the wallet forever.

To solve this without needing human trust or courts, DeFi protocols enforce **overcollateralization**:

> **Overcollateralization** means a borrower must lock up assets worth **strictly more** than the value of the debt they draw out.

**Example:** You want to borrow \$750 worth of USDC. You must lock up \$1,000 worth of ETH as collateral.
- You deposited \$1,000 to borrow \$750 (your position is **overcollateralized** by \$250).
- That \$250 acts as a safety cushion for lenders.
- If the market price of ETH falls, that cushion begins to shrink.
- If it shrinks too close to the debt value, the protocol automatically seizes (liquidates) the ETH to repay the lenders before the loan goes underwater.

### Loan-to-Value Ratio (LTV)

LTV is the simplest way to measure how leveraged your loan is:

$$\text{LTV} = \frac{\text{Amount Borrowed}}{\text{Collateral Value}}$$

- **LTV = 50%** means you borrowed half of what your collateral is worth. Very safe — large buffer.
- **LTV = 90%** means you borrowed almost everything your collateral is worth. Very risky — tiny buffer.

**Why LTV matters in Chrono:** Traditional protocols give everyone the same maximum LTV (e.g., "you can never borrow more than 75% of your collateral"). Chrono makes the maximum LTV **dynamic** — it depends on how long you borrow for:

| Borrow Duration | Maximum LTV | Leverage | Intuition |
|:---|:---|:---|:---|
| 1 hour | 90% | 10× | Prices rarely crash 10%+ in an hour, so this is safe |
| 12 hours | 87% | 7.7× | More time = more risk = lower limit |
| 1 day | 84% | 6.25× | A full day of price exposure |
| 7 days | 75% | 4× | A week is significant; conservative limit |

---

## 4. Volatility — Why Time Creates Risk

### What is Volatility?

Volatility measures how wildly an asset's price moves. A token that swings ±5% daily is more volatile than one that moves ±0.1%.

**Why it matters:** The more volatile an asset is, the more its price can move during your loan. Chrono uses a number called $\sigma_{30d}$ — the asset's average daily price swing over the past 30 days — to calibrate how aggressive its lending limits are.

### The Square Root Rule

In finance, there is a well-established relationship: the risk of price movement scales with the **square root** of time:

$$\text{Risk} = \sigma \cdot \sqrt{t}$$

This means:
- Over **1 hour**, the expected price swing is relatively small.
- Over **1 day** (24× more time), the risk isn't 24× bigger — it's only $\sqrt{24} \approx 4.9\times$ bigger.
- Over **7 days**, risk is $\sqrt{168} \approx 13\times$ larger than a 1-hour window.

**Why this matters for Chrono:** Because risk grows with the square root of time (not linearly), short-term loans are *disproportionately safer* than long-term ones. Chrono exploits this mathematical fact by rewarding shorter borrowing durations with higher LTV limits.

### How Chrono Uses Volatility

Chrono has a parameter called $k$ (the "decay rate") that controls how quickly the maximum LTV drops as borrow duration increases. This $k$ is calibrated based on recent market volatility:

- **Calm markets** (low $\sigma_{30d}$) → small $k$ → LTV drops slowly → borrowers get generous limits even for longer durations.
- **Turbulent markets** (high $\sigma_{30d}$) → large $k$ → LTV drops steeply → the protocol becomes more conservative.

---

## 5. Health Factor — How the Protocol Tracks Loan Safety

### What is the Health Factor?

The Health Factor ($HF$) is a single number that tells you how safe your loan position is right now:

$$HF = \frac{\text{Collateral Value} \times LT}{\text{Debt Value}}$$

Where:
- **Collateral Value** = how much your locked-up assets are worth at current market prices.
- **Debt Value** = how much you owe (your original borrow + any interest that has accumulated).
- **LT** = "Liquidation Threshold" — a percentage that adjusts based on your remaining borrow time and elapsed time (details below).

### Reading the Health Factor

| Health Factor | What it means | What happens |
|:---|:---|:---|
| **HF > 1.5** | **Safe.** Your collateral is worth significantly more than your debt. | Nothing — your position is healthy. |
| **1.0 < HF ≤ 1.5** | **Warning.** Your safety buffer is shrinking. | The protocol may show you alerts. Consider adding more collateral or repaying some debt. |
| **HF ≤ 1.0** | **Underwater.** Your debt now exceeds the safe threshold. | Your position is eligible for **Soft Liquidation** — someone can partially close your loan. |
| **Time expired** | Your borrow duration has run out. | **Hard Liquidation** — the blockchain automatically closes your position. |

### The Liquidation Threshold (LT) and Buffer

The Liquidation Threshold is slightly more generous than the maximum LTV to prevent borrowers from being instantly liquidated the moment they open a position. It works by adding a small safety "buffer" that grows over time:

- At the moment you borrow, the buffer is small — giving you a thin grace period.
- As time passes, the buffer grows — giving your position more breathing room before liquidation kicks in.

This buffer prevents a nasty edge case: without it, a borrower who maxes out their LTV could be instantly liquidated by a tiny price fluctuation, which would be unfair.

---

## 6. Liquidation — What Happens When Things Go Wrong

Liquidation is the process of forcibly closing an unsafe loan to protect the lenders who provided the capital. Chrono has **two** types:

### Soft Liquidation (Price Drop — Before Expiry)

**When:** The price of your collateral drops enough that $HF \le 1.0$, but your borrow duration hasn't expired yet.

**How it works (Dutch Auction):** Instead of giving a fixed bonus to the first person who spots the bad position (which creates unfair races), Chrono uses a **Dutch Auction**:

1. When $HF$ drops to 1.0, an auction begins automatically.
2. The auction starts by pricing the collateral *slightly above* its real market value (e.g., +2%).
3. Over a few minutes, the auction price gradually drops (decays) below market value.
4. At some point, the discount becomes attractive enough that an external participant (a "liquidator") steps in, repays some of the borrower's debt, and takes the discounted collateral as profit.
5. The borrower loses some collateral but keeps the rest and doesn't owe the repaid portion anymore.

**Why a Dutch Auction?** Because fixed liquidation bonuses (the traditional approach) create problems:
- They incentivize "gas wars" where bots compete to be the first to liquidate, wasting network resources.
- They take a fixed percentage from the borrower even when the market would clear at a smaller discount.

Chrono's Dutch Auction approach (inspired by **Euler Finance**) lets the market naturally find the fair clearing price. This protects borrowers from excessive penalties while still ensuring lenders' capital is recovered efficiently.

#### What Exactly Is a Dutch Auction?

A Dutch Auction is the *opposite* of a normal auction. In a normal ("English") auction, the price starts low and bidders push it higher. In a Dutch Auction, the price starts high and drops over time until somebody says "I'll take it."

Picture a flower market: the auctioneer starts at \$100 per crate of tulips. Every few seconds, the price ticks down — \$95, \$90, \$85... The moment any buyer thinks the price is good enough, they grab the crate. If nobody buys, the price keeps falling until someone does.

Applied to lending liquidations:

```text
Auction Price
 (% of oracle)
     │
102% │●                         ← Auction starts above market price
     │  ●                          (deters instant front-running)
100% │----●--------- oracle price
     │      ●
 96% │        ●
     │          ●
 92% │            ●              ← Most liquidators buy around here
     │              ●               (worth the capital + gas cost)
 90% │                ●
     │                  ●
     └──────────────────────── Time (seconds)
     0s    60s   120s  180s  240s  300s
```

This design means:
- **No race to be first.** Since the price starts *above* market value, there is no profit in being first. Bots have to wait.
- **Fair price discovery.** The market itself determines the discount, instead of a hardcoded 5% or 10%.
- **Borrower protection.** The borrower only loses as much collateral as the market demands — not an arbitrary fixed penalty.

**Where Dutch Auctions are used today:**
- **Euler Finance** (the primary inspiration for Chrono) uses a reactive Dutch Auction for their liquidation system.
- **MakerDAO** (the protocol behind the DAI stablecoin) uses Dutch Auctions to sell seized collateral when vaults are liquidated.
- **Aave** and **Compound** still use the older fixed-bonus approach, where the first liquidator to submit a transaction gets a flat bonus (e.g., 5–10% of the seized collateral). This is simpler but creates MEV problems.

### Hard Liquidation (Time Expired)

**When:** Your borrow duration runs out (e.g., you borrowed for 1 day, and 24 hours have passed) and you haven't fully repaid.

**How it works:** This is Chrono's most distinctive feature. At the moment you opened your loan, the blockchain itself scheduled an automatic action at your expiry time. When that scheduled moment arrives:

1. The blockchain autonomously triggers the liquidation — no human, bot, or third party is needed.
2. Your collateral is seized to cover: your remaining debt + accumulated interest + a flat 5% penalty.
3. If your collateral was worth more than what's owed, the leftover amount is returned to you.
4. The debt is absorbed by the **Stability Pool** (explained next).

**Why is this special?** On most blockchains, there is no "alarm clock." If a borrower's position goes bad, someone (called a "keeper" or "liquidator bot") must manually submit a transaction to trigger the liquidation. If they're asleep, or the network is congested, the liquidation might not happen — potentially causing losses. Chrono eliminates this by using the Hedera blockchain's native ability to schedule future actions (called the **Hedera Schedule Service**).

---

## 7. The Stability Pool — Insurance for Lenders

### What is the Stability Pool?

The Stability Pool is a shared reserve of tokens (e.g., USDC) deposited by users who want to earn extra yield. Its purpose: when a Hard Liquidation happens, the Stability Pool steps in to immediately absorb the debt.

**How it works, step by step:**

1. **Depositors** put stablecoins (like USDC) into the Stability Pool.
2. When a borrower defaults at expiry, the pool's USDC is used to pay off the borrower's debt.
3. In exchange, the pool receives the borrower's seized collateral (like ETH) at a discount (the collateral is worth more than the debt that was absorbed).
4. This discounted collateral is distributed as **rewards** to the Stability Pool depositors.

**Why would someone deposit into the Stability Pool?** Because when liquidations happen, the seized collateral is typically worth more than the debt absorbed (thanks to the 5% penalty and over-collateralization). So depositors essentially buy ETH at a discount, funded by their USDC.

### Reward Accounting

When many people deposit into the Stability Pool, the system needs a fair way to divide up the seized collateral rewards. Chrono uses a "scaled snapshot" system (inspired by the **Liquity** protocol) that tracks rewards using running totals rather than looping through every depositor one by one. This keeps the system efficient regardless of how many people participate.

---

## 8. Interest Rates — The Cost of Borrowing

### How Interest is Determined

The interest rate a borrower pays is not fixed — it adjusts automatically based on how much of the pool's capital is currently being borrowed. This ratio is called **Utilization**:

$$U = \frac{\text{Total Borrowed}}{\text{Total Supplied}}$$

- If $U$ is low (e.g., 20%) — lots of idle capital, few borrowers → low interest rates to attract borrowers.
- If $U$ is high (e.g., 95%) — almost all capital is lent out, little remaining for new withdrawals → very high interest rates to discourage new borrows and incentivize repayments.

### The "Kink" Model

Chrono uses a two-phase interest rate curve with a "kink" — a sharp change in slope at an optimal utilization target:

```text
Interest
Rate (%)
  │                                       ╱ ← Phase 2: Steep slope
  │                                     ╱     (penalizes over-utilization)
  │                                   ╱
  │                     ╱────────── ╱  ← Kink point (optimal utilization)
  │                   ╱
  │               ╱     ← Phase 1: Gentle slope
  │           ╱         (normal rates)
  │       ╱
  │   ╱
  │╱
  └────────────────────────────────────── Utilization (%)
  0%                  80-90%          100%
```

**Phase 1** (below optimal utilization): Interest rises gently. Capital is abundant.

**Phase 2** (above optimal utilization): Interest rises sharply. This "panic premium" signals that the pool is dangerously close to running out of available capital for withdrawals.

### What Lenders Earn

Lenders earn a fraction of the interest that borrowers pay. The formula:

$$\text{Supply APY} = \text{Borrow Rate} \times \text{Utilization} \times (1 - \text{Protocol Fee})$$

This means:
- If nobody borrows ($U = 0$), lenders earn nothing — idle capital generates no yield.
- If everything is borrowed ($U = 100\%$) at a high rate, lenders earn a lot.
- The protocol takes a 10% cut of interest as revenue. The remaining 90% flows to lenders.

### Interest Compounding

Interest in Chrono doesn't accumulate in simple "once-a-year" fashion. It compounds — meaning interest accrues on top of previously accrued interest, updated every time anyone interacts with the position. The rate is calculated per-second for maximum precision.

### The Evolving Frontier: Adaptive Interest Rate Models

The kink model described above is the industry standard used by Aave, Compound, and Chrono's current implementation. It works well but has a known limitation: the kink point (optimal utilization) and slopes are **static** — set by governance and only changed through manual votes.

This means the protocol can be slow to react to rapidly changing market conditions. If borrowing demand surges, the interest rate might not climb fast enough to attract new lenders. If demand collapses, rates might stay artificially high.

Newer protocols are experimenting with **adaptive** (self-adjusting) interest rate models:

- **Morpho Blue** uses a model where the interest rate target continuously adjusts itself based on whether utilization is above or below the optimal point. If utilization stays too high for too long, the model autonomously raises the base rate. If it stays too low, the rate drifts down. No governance vote required.
- **Euler v2** takes a similar approach with dynamic rate adjustment, where the curve reshapes itself in real-time based on market feedback signals.

Chrono currently uses the proven static kink model but may explore adaptive alternatives in future versions. The static model provides simplicity and predictability — important properties for a protocol that already introduces novel complexity through duration-based LTV.

---

## 9. Oracles — Where Do Prices Come From?

### What is a Price Oracle?

Smart contracts can't browse the internet to check "What is ETH worth right now?" They only know what's stored on the blockchain itself. A **price oracle** is a service that brings real-world market prices onto the blockchain so that smart contracts can use them.

Chrono uses **Pyth Network** as its oracle — a high-speed price feed that publishes signed price data every few seconds.

### The Staleness Problem

Oracle prices can become outdated. If the last price update was 10 minutes ago and the market has moved significantly, the smart contract would be using stale data — potentially liquidating people unfairly or allowing risky borrows.

Chrono enforces a **staleness threshold** (120 seconds). If the most recent price is older than this, the system rejects the transaction. To keep prices fresh, a background service (the "keeper") regularly pushes new price data to the blockchain.

---

## 10. The Hedera Network — Why This Blockchain?

Chrono is built on **Hedera**, a public blockchain with some unique features that make it particularly well-suited for this protocol:

### Scheduled Transactions (The Alarm Clock)

Most blockchains require someone to submit a transaction for anything to happen. Hedera has a built-in feature where you can say: "Execute this action at timestamp X." This is critical for Chrono's Hard Liquidation — the blockchain itself triggers the liquidation at the exact expiry time, without relying on any human or bot.

### Fast and Predictable

Hedera finalizes transactions in roughly 3 seconds (compared to 12+ seconds on Ethereum), and transaction fees are fixed in USD terms (fractions of a cent). This predictability is important for a lending protocol where timing and cost matter.

### Hedera Token Service (HTS)

Instead of deploying custom token contracts (the standard approach on Ethereum), Hedera provides a built-in token system. The wrapped tokens (wETH, wUSDC) used in Chrono leverage this system for consistent, low-cost token operations.

---

## 11. Putting It All Together — Chrono's Lifecycle

Here is how everything connects in a single borrow lifecycle:

```text
1. LENDER deposits USDC into the Lending Pool
         ↓
2. BORROWER locks ETH as collateral + chooses duration (e.g., 1 day)
         ↓
3. Protocol computes max LTV for that duration (e.g., 84% for 1 day)
         ↓
4. Borrower receives USDC. A scheduled Hard Liquidation is registered
   at T_expiry = now + 1 day.
         ↓
5. During the borrow period:
   - Interest accrues every second.
   - Health Factor is monitored. If ETH price drops too far → Soft Liquidation (Dutch Auction).
         ↓
6a. BORROWER REPAYS before expiry:
    - Returns USDC (principal + interest) to the pool.
    - Protocol takes 10% of interest as revenue; 90% goes to lenders.
    - Collateral (ETH) is returned to borrower.
    - Scheduled liquidation is cancelled.
         OR
6b. TIME EXPIRES without repayment:
    - Scheduled transaction fires automatically.
    - Stability Pool absorbs the debt (USDC).
    - Stability Pool receives seized collateral (ETH) at a discount.
    - Borrower receives any leftover collateral after debt + 5% penalty.
```

---

## 12. Liquidation Design Tradeoffs

Chrono's dual-liquidation architecture involves several design decisions. Each choice has tradeoffs. This section maps out the key ones so you can reason about *why* Chrono is designed the way it is.

### Soft Liquidation vs. Hard Liquidation

| | Soft Liquidation | Hard Liquidation |
|:---|:---|:---|
| **Trigger** | Price drop ($HF \le 1.0$) | Time expiry ($t \ge T_{\text{expiry}}$) |
| **Who executes?** | External market participants (liquidator bots) | The blockchain itself (scheduled transaction) |
| **Needs a keeper/bot?** | Yes — someone must submit the transaction | No — fully autonomous |
| **Borrower impact** | Partial — only enough collateral is seized to restore solvency | Full — entire position is closed |
| **When it matters** | Volatile markets with sudden price drops | Borrowers who forget to repay or intentionally let positions expire |
| **Risk if it fails** | Debt grows, could cascade into insolvency | Impossible to fail (blockchain guarantees execution) |

**Why two types?** Each covers a different failure mode. Soft Liquidation handles the *price risk* scenario (assets lose value). Hard Liquidation handles the *time risk* scenario (borrower never repays). Together, they ensure lender capital is protected regardless of what goes wrong.

### Partial Liquidation ("Liquidate Until Healthy") vs. Full Liquidation

When a position goes underwater, the protocol has a choice: seize *all* the collateral, or seize *just enough* to bring the Health Factor back above 1.0?

| | Partial ("until HF > 1.0") | Full ("seize everything") |
|:---|:---|:---|
| **Borrower fairness** | Better — borrower keeps most of their position | Worse — position is entirely wiped out |
| **Lender safety** | Slightly riskier — the position could drop below HF=1.0 again | Safer — the risk is entirely removed |
| **Gas efficiency** | May require multiple liquidation events | One and done |
| **Liquidator profit** | Smaller per event (less collateral to seize) | Larger per event |
| **Used by** | Aave, Compound, Euler (with close factors like 50%) | Liquity (for undercollateralized vaults) |

**Chrono's choice:** Soft Liquidation uses a **partial** approach with a 50% close factor — liquidators can repay up to half the debt, seizing proportional collateral. This is fairer to borrowers and usually sufficient to restore solvency. Hard Liquidation uses a **full** approach — when time expires, the entire position is settled, because there is no expectation the borrower will return.

### Stability Pool vs. Open Market Auction for Absorbing Debt

Once collateral is seized, who absorbs the bad debt? There are two main approaches:

| | Stability Pool | Open Market Auction |
|:---|:---|:---|
| **Speed** | Instant — pre-funded capital absorbs debt in one transaction | Slower — auction takes time (seconds to minutes) |
| **Capital efficiency** | Lower — capital sits idle in the pool waiting for liquidations | Higher — no capital needs to be locked up in advance |
| **Complexity** | Simpler to implement and reason about | More complex (auction mechanics, edge cases) |
| **Liveness risk** | Pool can run dry if there aren't enough depositors | Auction can fail if no liquidator shows up |
| **Yield for participants** | Depositors earn discounted collateral when liquidations happen | Liquidators earn auction profits on each event |
| **Used by** | Liquity (Stability Pool), Chrono (Hard Liquidation) | MakerDAO, Euler, Chrono (Soft Liquidation) |

**Chrono's hybrid:** Chrono uses **both** mechanisms for different scenarios:
- **Soft Liquidation → Dutch Auction:** When a position goes underwater due to price drops, an open-market auction discovers the fair price. This is capital-efficient because liquidators bring their own capital on demand.
- **Hard Liquidation → Stability Pool:** When a position expires, the Stability Pool provides instant, guaranteed absorption. This is essential because the blockchain-triggered liquidation must complete atomically — there is no time to run a multi-minute auction.

This hybrid design captures the strengths of both approaches: market-driven efficiency for price-triggered events, and guaranteed instant settlement for time-triggered events.

---

## Quick-Reference Glossary

### Key Terms

| Term | Plain English Meaning |
|:---|:---|
| **Blockchain** | A shared database that no single entity controls. Every transaction is permanently recorded and publicly verifiable. |
| **Smart Contract** | A program living on the blockchain that automatically executes predefined rules. No middleman needed. |
| **Token** | A digital asset tracked on the blockchain. Like a digital coin or stock certificate. |
| **Stablecoin** | A token pegged to \$1 (or another stable value). Examples: USDC, USDT. |
| **Wallet** | Software that holds your tokens and lets you sign (authorize) transactions. |
| **Collateral** | The asset you lock up to guarantee a loan. If you can't repay, the collateral is seized. |
| **Overcollateralization** | Requiring borrowers to lock up assets worth *more* than what they borrow (e.g., \$1,000 ETH for a \$750 USDC loan). Mandatory in DeFi because pseudonymous wallets have no credit scores or legal enforcement. |
| **LTV (Loan-to-Value)** | The ratio of what you borrowed to what your collateral is worth. Higher LTV = more leverage = more risk. |
| **Liquidation** | The process of forcibly closing an unsafe loan position by seizing collateral. Protects lenders. |
| **Soft Liquidation** | Liquidation triggered by a price drop (Health Factor ≤ 1.0), before the borrow duration expires. Uses a Dutch Auction. |
| **Hard Liquidation** | Liquidation triggered by the borrow duration expiring without repayment. Executed automatically by the blockchain. |
| **Health Factor (HF)** | A number measuring how safe your loan is. Above 1.0 = safe. At or below 1.0 = eligible for liquidation. |
| **Liquidation Threshold (LT)** | The adjusted ceiling at which collateral begins to be considered unsafe. Slightly more generous than max LTV to provide a grace buffer. |
| **Volatility** | How much an asset's price fluctuates. High volatility = price swings a lot = riskier collateral. |
| **Utilization (U)** | The percentage of deposited pool capital currently being borrowed. Drives interest rates. |
| **APY** | Annual Percentage Yield — the annualized interest rate, accounting for compounding. |
| **Dutch Auction** | An auction where the price starts high and decreases over time until a buyer accepts. Used for Soft Liquidation price discovery. |
| **Stability Pool** | A shared insurance reserve. Depositors provide stablecoins to absorb defaulted debt and earn discounted collateral in return. |
| **Oracle** | A service that brings real-world data (like asset prices) onto the blockchain for smart contracts to use. |
| **Keeper** | A background service that performs maintenance tasks (like pushing fresh price data to the blockchain). |
| **Scheduled Transaction** | A blockchain-native feature (on Hedera) that automatically executes an action at a future time without external intervention. |
| **Hedera** | The blockchain network where Chrono Protocol is deployed. Provides native scheduled transactions, fast finality, and fixed-cost fees. |
| **Gas** | The fee paid to the blockchain network for processing a transaction. Analogous to postage for mailing a letter. |
| **MEV (Miner/Maximal Extractable Value)** | Profit extracted by bots that reorder, front-run, or sandwich other people's transactions. Dutch Auctions help mitigate this. |
| **Protocol Treasury** | The address that collects the protocol's share of revenue (10% of interest on voluntary repayments). |

### Reference Formulae

| Formula | What It Computes |
|:---|:---|
| $\text{LTV} = \frac{\text{Borrowed}}{\text{Collateral Value}}$ | How leveraged a loan position is |
| $\text{LTV}(t) = \text{LTV}_{\text{base}} + (\text{LTV}_{\text{max}} - \text{LTV}_{\text{base}}) \cdot e^{-k \cdot t}$ | Maximum allowed LTV as a function of remaining borrow duration $t$ |
| $\text{Risk} = \sigma \cdot \sqrt{t}$ | How price risk scales with time (square root rule) |
| $HF = \frac{\text{Collateral Value} \times LT}{\text{Debt Value}}$ | Health Factor — loan safety score (above 1.0 = safe) |
| $U = \frac{\text{Total Borrowed}}{\text{Total Supplied}}$ | Pool utilization rate (drives interest rates) |
| $\text{Supply APY} = r(U) \cdot U \cdot (1 - \text{Fee}_{\text{protocol}})$ | What lenders earn (annualized) |
| $P_{\text{auction}}(\tau) = P_{\text{oracle}} \cdot \left((1 + \delta_{\text{start}}) - (\delta_{\text{start}} + \delta_{\text{max}}) \cdot \min\!\left(1, \frac{\tau}{\tau_{\text{auction}}}\right)\right)$ | Dutch Auction collateral price (decays over auction time $\tau$) |
| $\text{Required Collateral} = \frac{\text{Total Debt} \times (1 + \text{Penalty})}{\text{Collateral Price}}$ | How much collateral is seized in a Hard Liquidation |

---

## Further Reading & References

These are the protocols, papers, and resources that informed Chrono Protocol's design. They are excellent starting points if you want to go deeper into any of the primitives discussed in this primer.

### Lending & Borrowing Protocols

| Resource | What You'll Learn |
|:---|:---|
| [Aave Documentation](https://docs.aave.com/) | The most widely used lending protocol. Covers pooled lending, variable/stable rates, flash loans, and fixed-bonus liquidations. |
| [Compound Finance Docs](https://docs.compound.finance/) | The original pioneering DeFi lending pool. Clear explanations of the kink interest rate model and cToken accounting. |
| [Morpho Documentation](https://docs.morpho.org/) | Peer-to-peer lending optimization and Morpho Blue's isolated markets with adaptive interest rate models. |
| [Liquity Documentation](https://docs.liquity.org/) | The protocol that introduced Stability Pools and snapshot-based scaled deposit accounting. Zero-interest borrowing model. |

### Liquidation Mechanisms

| Resource | What You'll Learn |
|:---|:---|
| [Euler Finance – Liquidation](https://docs.euler.finance/) | Dutch Auction-based liquidation design — the primary inspiration for Chrono's Soft Liquidation mechanism. |
| [MakerDAO – Liquidations 2.0](https://docs.makerdao.com/) | MakerDAO's evolution from fixed-bonus English auctions to Dutch Auctions for collateral disposal. |
| [Aave – Liquidation Mechanism](https://docs.aave.com/developers/guides/liquidations) | Fixed-bonus liquidation with close factors — the traditional model that Dutch Auctions aim to improve upon. |

### Interest Rate Models

| Resource | What You'll Learn |
|:---|:---|
| [Compound – Interest Rate Model](https://docs.compound.finance/interest-rates/) | The original kink (two-slope) model that became the DeFi industry standard. |
| [Morpho Blue – Adaptive IRM](https://docs.morpho.org/morpho-blue/contracts/irm/) | A self-adjusting interest rate model that responds to market conditions without governance intervention. |
| [Aave – Rate Strategy](https://docs.aave.com/risk/liquidity-risk/borrow-interest-rate) | Aave's parameterized interest rate strategy with optimal utilization targeting. |

### Oracles & Price Feeds

| Resource | What You'll Learn |
|:---|:---|
| [Pyth Network](https://pyth.network/) | The oracle Chrono uses. High-frequency price feeds with confidence intervals. |
| [Chainlink Documentation](https://docs.chain.link/) | The most widely adopted oracle network. Good for understanding oracle design principles and staleness. |

### Hedera Network

| Resource | What You'll Learn |
|:---|:---|
| [Hedera Documentation](https://docs.hedera.com/) | Official docs for the blockchain Chrono is built on — consensus, token service, and smart contracts. |
| [HIP-1215 – Schedule Service](https://hips.hedera.com/hip/hip-1215) | The Hedera Improvement Proposal that defines the scheduled transaction system Chrono uses for Hard Liquidation. |
