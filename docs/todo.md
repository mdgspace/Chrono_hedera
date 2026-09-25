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
- [x] **Soft Liquidation Dutch Auction Engine (Architectural Audit Completed)**: Full risk synthesis report authored in `docs/analysis/SOFT_LIQUIDATION_DUTCH_AUCTION_ANALYSIS.md`. Evaluated three paradigms: (1) Euler v2 Continuous Time-Decay Auction, (2) Morpho Blue Stateless Dynamic Risk Model, and (3) Two-Tier Priority Window Hybrid. Proved that pure time-decay auctions fail during fast crashes and freeze-window hybrids trap bad debt. Synthesized and approved the **Chrono Dynamic-Discount Engine (CD3)**: an instantaneous stateless dynamic risk model with closed-form health-restoring partial sizing ($D^*$), synchronous zero-delay Stability Pool capacity gating, and an adverse selection volatility shield ($HF < 0.85$).
  - [ ] Implement CD3 in `LiquidationEngine.softLiquidate()` and `MathLib.sol` (`computeDynamicBonus`, `computeDStar`).
  - [ ] Update `IAssetRegistry.sol` AssetConfig with dynamic bonus parameters (`bonusMin`, `bonusMax`, `alphaRisk`, `hfFloor`, `hfCrash`).
  - [ ] Update unit and integration tests in `LiquidationEngine.test.ts`.
- [x] **Residual Collateral Destination in Hard Liquidation (Specification, Architecture & Implementation Completed)**: 
  - Comprehensive risk analysis authored in `RESIDUAL_COLLATERAL_ANALYSIS.md` and specification finalized in `docs/Chrono_Hard_Liquidation_Specification.md`.
  - Implemented 3-Tier Settlement Waterfall with Dual-Tranche Penalty:
    1. **Lender Invariant**: 100% debt repaid to `LendingPool` via `returnBorrowLiquidity` and token transfer upon debt absorption.
    2. **Dual-Tranche Penalty Split**: 75% of default penalty to `StabilityPool` depositors, 25% to protocol treasury/reserve.
    3. **Solvency-Gated Surplus Remittance**: Surplus collateral refunded to borrower if and only if `stabilityPool.canAbsorb == true`. When `canAbsorb == false`, surplus remains strictly locked in `BorrowVault` (zero refund to borrower) and required collateral seized to protocol recovery reserve (`owner()`).
    4. **Low-LTV Collateral Floor**: Penalty calibrated to $\max(V_{debt} \times 12\%, V_{coll} \times 2.5\%)$, preventing zero-cost abandonment on low-LTV positions.
    5. **15-Minute HSS Grace Window & Late Grace Fee**: 900-second grace window prevents Hedera consensus jitter rejections (`require(t >= expiry + 900)`); 1.5% late fee charged to protocol treasury if repaid during grace.
  - Aligned ABIs across backend (`chrono-web/backend/config/contracts.js`), frontend (`chrono-web/src/utils/abis.js`), deployment script (`scripts/deploy/deploy.ts`), and all test fixtures.
  - Local unit test suite passing (62/62) and end-to-end integration test suite implemented in `test/integration/HardLiquidationWaterfall.test.ts` (4/4 passing, 66/66 total repository tests passing).
  - Formal audit and verification report authored at `docs/test_reports/hard_liquidation_test_report.md`.
- [ ] **Stability Pool Scaled Deposit Model Evaluation**: Audit and benchmark the Liquity-style snapshot-based scaled deposit model (`depositScale`, `cumulativeRewardPerDeposit`) in `StabilityPool.sol` to evaluate precision loss, edge cases under near-zero pool balances, and multi-collateral asset scaling.
- [ ] **Stability Pool Under-Capitalization & Bad Debt Fallback**: Evaluate production alternatives for when the Stability Pool has insufficient funds during Hard Liquidation (e.g., automated open-market Dutch auctions, proportional bad debt socialization across lender shares, or an automated insurance fund / reserve auction) rather than seizing collateral to `owner()`.

---

## Notes
- **Protocol fee (10%) applies to voluntary repayment only** — `BorrowVault.repay()`. Liquidation paths (`softLiquidate`/`executeHardLiquidation`) do NOT take a protocol cut; 100% goes to LendingPool to minimize bad debt risk.
- **Hard Liquidation penalty (12% debt / 2.5% coll floor)** is split 75% to Stability Pool and 25% to Protocol Treasury/Reserve.
- **Fee split location**: `BorrowVault.repay()`. `InterestEngine` unchanged (computes rates only). `LiquidationEngine` unchanged.
- **Future TODO**: Replace `owner()` treasury with configurable multisig `protocolTreasury` address.

---

## User Action Items (Manual / Environment Setup)
- [x] **Redeploy Protocol on Hedera Testnet**: Run the deployment script to deploy updated contracts (`AssetRegistry`, `BorrowVault`, `SchedulerEngine`, `LiquidationEngine`), re-wire cross-contract authorizations, auto-associate HTS tokens, register assets with calibrated hard liquidation waterfall parameters (12% penalty, 2.5% floor, 75% SP share, 25% reserve share), and persist updated addresses:
  ```bash
  npx hardhat run scripts/deploy/deploy.ts --network testnet
  ```
- [ ] **Update Backend Relayer / Indexer Config**:
  - Verify `deployments/testnet.json` addresses match `chrono-web/backend/config/index.js` (or `.env`).
  - Restart backend relayer/indexer (`npm run dev` in `chrono-web/backend`) to load updated contract addresses and the new `AssetConfig` tuple ABI.
- [ ] **Update Frontend Config**:
  - Update `chrono-web/src/config/contracts.js` (or `.env`) with any new testnet contract addresses from `deployments/testnet.json`.
  - Verify frontend compiles and runs without ABI decoding errors (`npm run dev` in `chrono-web`).
- [ ] **Seed Testnet Stability Pool Liquidity**:
  - Deposit testnet debt tokens (e.g. wUSDC) into `StabilityPool` so `canAbsorb` returns `true` for scheduled expirations, ensuring the solvent liquidation waterfall can absorb loans and remit surplus collateral to test borrowers.
- [ ] **Run Pyth Keeper Node**:
  - Ensure keeper service (`npx hardhat run scripts/keeper.ts --network testnet`) is active so real-time Pyth price updates are pushed on-chain before scheduled expiries execute.
- [x] **Redeploy BorrowVault on Hedera Testnet (Phase 4)**: Superseded by full testnet deployment above.
- [x] **Verify / Restart Chrono Backend**: After running migration and redeploying, ensure backend `.env` has valid `SUPABASE_URL` and `SUPABASE_ANON_KEY` and start/restart `chrono-web/backend` (`npm run dev` or `node server.js`).
- [x] **Frontend Repayment Scripts**: Confirmed NO changes needed to frontend transaction scripts (`repay.js`) — `BorrowVault.repay(bytes32,uint256)` preserves the exact same external interface and allowance requirements.