# Frontend Integration Scripts

This folder contains example scripts demonstrating how a frontend application (React, Next.js, Vue, etc.) should interact with the Chrono Protocol smart contracts on Hedera EVM.

These scripts use `ethers.js` v6 syntax, which is standard for EVM interaction.

## Files

1. **`1-borrow.ts` (Borrow Flow)**
   - **How it works:** Users deposit a collateral token (e.g., wETH) and borrow a debt token (e.g., wUSDC) against it. The transaction is routed through the `ChronoRouter` contract.
   - **Flow:** `token.approve(ChronoRouter, collateralAmount)` -> `ChronoRouter.openPosition(...)`

2. **`2-lend.ts` & `3-deposit-lp.ts` (Lend / Deposit in LP)**
   - **How it works:** In the Chrono Protocol, "Lending" and "Depositing into the Liquidity Pool" are the exact same operation. You supply liquidity (e.g., wUSDC) into the `LendingPool` contract, which is then lent out to borrowers.
   - **Flow:** `token.approve(LendingPool, amount)` -> `LendingPool.deposit(token, amount)`

3. **`4-withdraw-lp.ts` (Withdraw from LP)**
   - **How it works:** Users can withdraw their previously deposited liquidity (plus any accrued interest) by burning their LP shares.
   - **Flow:** `LendingPool.withdraw(token, sharesAmount)`

4. **`5-deposit-sp.ts` (Deposit in Stability Pool)**
   - **How it works:** Users deposit wUSDC into the `StabilityPool` to act as a backstop for liquidations. When a borrower is liquidated, the Stability Pool absorbs the debt and rewards the depositors with the seized collateral (wETH).
   - **Flow:** `token.approve(StabilityPool, amount)` -> `StabilityPool.provideToSP(token, amount)`

5. **`6-withdraw-sp.ts` (Withdraw from Stability Pool)**
   - **How it works:** Users withdraw their underlying wUSDC from the Stability Pool. Note that if liquidations have occurred, their wUSDC balance might be lower, but they will have gained seized collateral (wETH).
   - **Flow:** `StabilityPool.withdrawFromSP(token, amount)`

6. **`7-create-pool.ts` (Create Token Pair / Liquidity Pool)**
   - **Status: NOT SUPPORTED**
   - **Why:** Chrono is an oracle-based lending and borrowing protocol, not an Automated Market Maker (AMM) like Uniswap. There are no traditional "Token Pairs" (like wETH/wUSDC pairs) that users can create. Liquidity is provided to single-sided pools (e.g., the wUSDC Lending Pool), and exchange rates are determined by the Pyth Oracle, not by the ratio of tokens in a pair.

7. **`8-setup.ts` (Complete Setup Script)**
   - **How it works:** A template for initializing the user's Web3 Provider (like MetaMask or Hashpack EVM), connecting their wallet, and loading the protocol's contract addresses into a global configuration object.
