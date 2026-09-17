### 1. Page Architecture

To ensure a seamless user experience, the application should be divided into the following core views:

* **Landing Page:** Protocol overview, value proposition, and aggregate metrics (Total Value Locked, global utilization).
* **Faucet:** A dedicated testing utility allowing users to mint wrapped testnet assets (e.g., wETH, wUSDC) on the Hedera EVM to their MetaMask wallets.
* **Dashboard / Portfolio:** A personalized view of the user's active positions. This page must display current collateral, outstanding debt, accrued interest, and continuously evaluate the Health Factor ($HF$).


* **Markets (Lend & Borrow):** The primary interface for interacting with the `ChronoRouter` and `LendingPool`. This page should clearly visualize the duration-bound borrowing mechanics, showing how the maximum allowable LTV decays exponentially over time.


* **Stability Pool:** A dedicated interface for users to deposit wUSDC into the `StabilityPool` to act as a liquidation backstop, displaying potential liquidation bonuses and seized collateral (wETH) earnings.



---

### 2. Modular Subsystem Model

Building this out in React with Material UI components will provide a robust, pre-styled foundation without requiring custom CSS definitions. The frontend architecture should be isolated into the following subsystems:

* **Connection & Provider Subsystem:**
* Initializes the Web3 Provider via MetaMask and loads the protocol's contract addresses into a global configuration.


* Handles Hedera EVM network switching and state persistence (connected wallet address, chain ID).


* **Transaction & Logging Subsystem:**
* A generic wrapper utilizing `ethers.js` v6 syntax to manage the two-step `approve()` and execute flows.


* Captures transaction hashes, monitors Hedera mempool states, and logs successful executions (e.g., `LendingPool.withdraw`, `StabilityPool.withdrawFromSP`).


* Displays non-blocking toast notifications for transaction states (Pending, Success, Reverted).


* **Math & Risk Evaluation Subsystem:**
* A client-side utility module that mirrors the on-chain dynamic LTV equation:

$$\text{LTV}(t) = \text{LTV}_{\text{base}} + (\text{LTV}_{\text{max}} - \text{LTV}_{\text{base}}) \cdot e^{-k \cdot t}$$


* Calculates the dynamic utilization rate ($U$) and maps it to the two-phase linear kink interest rate model to project the Borrow APY before the user submits a transaction.




* **State Synchronization Subsystem:**
* Regularly polls block data to refresh volatile state variables, particularly the Health Factor:

$$HF = \frac{\text{Collateral Value} \cdot LT(t)}{\text{Debt Value}}$$


* Triggers state updates if the position approaches Soft Liquidation ($1.0 < HF \le 1.5$) or Hard Liquidation ($t \ge T_{\text{expiry}}$).





---

### 3. API & Data Architecture

A highly functional DeFi frontend requires a hybrid data approach. Immediate, user-specific data should be queried directly from the Hedera EVM via RPC calls, while historical or heavily aggregated data should be indexed by a dedicated backend relayer (e.g., using a FastAPI asynchronous backend connected to a graph or relational database).

#### Direct Smart Contract Queries (Frontend RPC)

| Data Point | Source / Dependency | Purpose |
| --- | --- | --- |
| **Asset Spot Prices** | Pyth Oracle | Determines exact exchange rates and collateral values. |
| **Wallet Balances & Allowances** | ERC-20 Contracts | Validates if a user has sufficient funds and approval for deposits/borrows. |
| **Position Expiry Time** | `ChronoRouter` | Retrieves the exact timestamp ($T_{\text{expiry}}$) for scheduled autonomous execution. |
| **Current Pool Utilization** | `LendingPool` | Fetches the ratio of Total Borrowed to Total Supplied to drive the APY equations. |

#### Relayer / Indexer APIs (Backend)

| API Endpoint | Expected Payload | Purpose |
| --- | --- | --- |
| `/api/v1/faucet/mint` | `{"wallet": "0x...", "asset": "wUSDC"}` | Triggers the backend wallet to dispense wrapped assets on the Hedera testnet to the connected user. |
| `/api/v1/markets/volatility` | `{"asset": "wETH"}` | Supplies the 30-day trailing asset volatility ($\sigma_{30\text{d}}$) required to calibrate the volatility decay parameter ($k$). |
| `/api/v1/liquidations/history` | `{"pool": "wUSDC"}` | Indexes historical Soft and Hard liquidations to display Stability Pool historical yields and APR. |
| `/api/v1/protocol/tvl` | Time-series JSON array | Aggregates historical cross-contract deposits to render a protocol growth chart on the landing page. |

---
