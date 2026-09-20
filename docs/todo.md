- [x] ~~**ChronoRouter Refund Bug**~~ **(Redundant)**: Abandoned pull-based oracle architecture. Hedera Schedule Service (HSS / HIP-1215) autonomous scheduled executions cannot supply dynamic off-chain Pyth VAA payloads and require guaranteed on-chain price finality. Since pull-based functions (`openPositionWithPriceUpdate`) have been permanently discarded in favor of push-based keeper updates (`keeper.ts`), `ChronoRouter` no longer handles oracle fee payments or refunds.
- [x] **Pull Oracle + HSS Conflict**: Hard liquidation scheduled via Hedera Schedule Service (HIP-1215) failed because background executions could not pull off-chain Pyth VAA payloads. Resolved by introducing a dedicated Keeper Node (`keeper.ts`) and `keeper` role in `PythOracleAdapter.sol` to actively push prices on-chain, eliminating staleness.
- [x] **E2E Script Oracle Fix**: Updated flow scripts to run alongside `keeper.ts` rather than bypassing staleness.
- [x] **HSS Expiration Jitter**: Hedera Schedule Service EVM `block.timestamp` during automatic schedule executions sometimes lags behind the exact `expirySecond`. Added a +2 second padding to `expiryTimestamp` in `SchedulerEngine.sol` to prevent "Not expired" rejections.
- [x] **Position Count Performance**: Currently the backend calculates position metrics (active, unhealthy, overdue) by iterating over all positions in BorrowVault from id=1 to nextPositionId(). Replaced O(n) loop with off-chain Supabase indexer (`02_positions.sql`, `positionIndexer.js`, and refactored `vaultData.js`).
- [x] **Protocol Repayment Cut**: Implemented 10% fee routing in `BorrowVault.sol` `repay()`, verified unit tests in `BorrowVault.test.ts`, and created automated redeployment script `redeployBorrowVault.ts`.
- [x] **UI Differentiate Pools**: Update the frontend `PoolsView` to explicitly differentiate between Lending Pools and the Stability Pool.
- [x] **Liquidation Events Table**: Does not have any updates, needs to be fixed.
- [x] **Stability Pool Endpoint**: Created dedicated backend REST endpoint `/api/v1/pool/stability` (`stabilityPool.js`, `stabilityPoolData.js`) and wired frontend `poolData.js`.
- [x] **Interest Rate & Utilization Implications (Architectural Audit Completed)**: Full risk synthesis report authored in `INTEREST_RATE_UTILIZATION_ANALYSIS.md`. Proved that both naive Pre-Borrow and Post-Borrow approaches fail in isolation. Uncovered CRITICAL Time-Machine retroactive liquidation exploit in `InterestEngine.sol` and 27.72% compounding truncation in `MathLib.sol`. Designed unified solution combining Piecewise Continuous Integral Borrow Pricing with a Global Cumulative Borrow Index ($I_t$).
- [x] **Compound Interest Precision (Task 11 Completed)**: Refactored `compoundInterest` in `MathLib.sol` to use PRBMath UD60x18 `exp(wrap(x))` where $x = (annualRate \times elapsedSeconds) / SECONDS\_PER\_YEAR$. Preserves 18-decimal precision by multiplying before dividing, clamps safely at $x \ge 133\text{ WAD}$, and eliminates the 27.72% Taylor series truncation error at high rates (e.g. 107.5% APY). Added unit tests in `MathLib.test.ts` and updated `InterestEngine.test.ts`.
- [ ] **Hedera Native Automation & Auditability (P2 - Infrastructure)**:
  - [ ] **HSS Periodic Index Keeper**: Schedule automated recurring calls via Hedera Schedule Service (HIP-1215) to keep on-chain borrow indices fresh during periods of low pool activity.
  - [ ] **HCS Interest Rate Audit Stream**: Emit consensus-timestamped index snapshots to a dedicated Hedera Consensus Service topic for real-time off-chain indexer verification.
- [ ] **Soft Liquidation Dutch Auction Engine (Euler Finance Reference)**: 
  - Deprecate v1 prototype in `LiquidationEngine.softLiquidate()` (static 5% bonus and `stabilityPool.canAbsorb()` priority check).
  - Implement on-chain Open Dutch Auction mechanism for Soft Liquidations ($HF \le 1.0$) drawing design rationale from Euler Finance (continuous price decay $P_{\text{auction}}(\tau)$, configurable start premium $\delta_{\text{start}}$, discount ceiling $\delta_{\text{max}}$, partial fill accounting, and MEV front-running mitigation).
  - Research and evaluate alternative liquidation mechanisms for pre-expiry defaults.
- [x] **Residual Collateral Destination in Hard Liquidation (Architectural Audit Completed)**: Full risk synthesis report authored in `RESIDUAL_COLLATERAL_ANALYSIS.md`. Evaluated total forfeiture vs. borrower refund. Rejected 100% forfeiture (avoids inverted risk penalties, UCC § 9-608 violations, and MEV censorship). Formulated Solvency-Gated Surplus Remittance with a 3-Tier Settlement Waterfall: (1) 100% lender debt satisfaction invariant, (2) calibrated 12% default penalty split 75/25 between Stability Pool and LendingPool Reserve, (3) residual surplus remittance to borrower, and (4) a 15-minute HSS grace window to absorb network jitter.
- [ ] **Stability Pool Scaled Deposit Model Evaluation**: Audit and benchmark the Liquity-style snapshot-based scaled deposit model (`depositScale`, `cumulativeRewardPerDeposit`) in `StabilityPool.sol` to evaluate precision loss, edge cases under near-zero pool balances, and multi-collateral asset scaling.
- [ ] **Stability Pool Under-Capitalization & Bad Debt Fallback**: Evaluate production alternatives for when the Stability Pool has insufficient funds during Hard Liquidation (e.g., automated open-market Dutch auctions, proportional bad debt socialization across lender shares, or an automated insurance fund / reserve auction) rather than seizing collateral to `owner()`.

---

## Notes
- **Protocol fee (10%) applies to voluntary repayment only** — `BorrowVault.repay()`. Liquidation paths (`softLiquidate`/`executeHardLiquidation`) do NOT take a protocol cut; 100% goes to LendingPool to minimize bad debt risk.
- **Fee split location**: `BorrowVault.repay()`. `InterestEngine` unchanged (computes rates only). `LiquidationEngine` unchanged.
- **Future TODO**: Replace `owner()` treasury with configurable multisig `protocolTreasury` address.

---

## User Action Items (Manual / Environment Setup)
- [x] **Redeploy BorrowVault on Hedera Testnet (Phase 4)**: Run:
  ```bash
  npx hardhat run scripts/deploy/redeployBorrowVault.ts --network testnet
  ```
  This script deploys the new BorrowVault, re-initializes it, rewires LendingPool, InterestEngine, LiquidationEngine, SchedulerEngine, and ChronoRouter, associates HTS tokens, and updates `deployments/testnet.json`.
- [x] **Verify / Restart Chrono Backend**: After running migration and redeploying, ensure backend `.env` has valid `SUPABASE_URL` and `SUPABASE_ANON_KEY` and start/restart `chrono-web/backend` (`npm run dev` or `node server.js`).
- [x] **Frontend Repayment Scripts**: Confirmed NO changes needed to frontend transaction scripts (`repay.js`) — `BorrowVault.repay(bytes32,uint256)` preserves the exact same external interface and allowance requirements.