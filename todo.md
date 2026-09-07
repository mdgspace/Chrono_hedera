- [ ] **ChronoRouter Refund Bug**: Add `receive() external payable {}` to `ChronoRouter.sol` so it can accept HBAR refunds from Pyth oracle when `openPositionWithPriceUpdate` overpays Pyth update fee.
- [x] **Pull Oracle + HSS Conflict**: Hard liquidation scheduled via Hedera Schedule Service (HIP-1215) failed because background executions could not pull off-chain Pyth VAA payloads. Resolved by introducing a dedicated Keeper Node (`keeper.ts`) and `keeper` role in `PythOracleAdapter.sol` to actively push prices on-chain, eliminating staleness.
- [x] **E2E Script Oracle Fix**: Updated flow scripts to run alongside `keeper.ts` rather than bypassing staleness.
- [x] **HSS Expiration Jitter**: Hedera Schedule Service EVM `block.timestamp` during automatic schedule executions sometimes lags behind the exact `expirySecond`. Added a +2 second padding to `expiryTimestamp` in `SchedulerEngine.sol` to prevent "Not expired" rejections.
- [x] **Position Count Performance**: Currently the backend calculates position metrics (active, unhealthy, overdue) by iterating over all positions in BorrowVault from id=1 to nextPositionId(). Replaced O(n) loop with off-chain Supabase indexer (`02_positions.sql`, `positionIndexer.js`, and refactored `vaultData.js`).
- [x] **Protocol Repayment Cut**: Implemented 10% fee routing in `BorrowVault.sol` `repay()`, verified unit tests in `BorrowVault.test.ts`, and created automated redeployment script `redeployBorrowVault.ts`.
- [x] **UI Differentiate Pools**: Update the frontend `PoolsView` to explicitly differentiate between Lending Pools and the Stability Pool.
- [x] **Liquidation Events Table**: Does not have any updates, needs to be fixed.
- [x] **Stability Pool Endpoint**: Created dedicated backend REST endpoint `/api/v1/pool/stability` (`stabilityPool.js`, `stabilityPoolData.js`) and wired frontend `poolData.js`.
- [ ] **Interest Rate & Utilization Implications**: Inspect the implications of calculating and applying interest rate before considering post-borrow utilization rate vs pre-borrow utilization rate. The current system calculates interest using the dynamic, post-borrow utilization rate. Research is needed on potential vulnerabilities based on either approach.

---

## Notes
- **Protocol fee (10%) applies to voluntary repayment only** — `BorrowVault.repay()`. Liquidation paths (`softLiquidate`/`executeHardLiquidation`) do NOT take a protocol cut; 100% goes to LendingPool to minimize bad debt risk.
- **Fee split location**: `BorrowVault.repay()`. `InterestEngine` unchanged (computes rates only). `LiquidationEngine` unchanged.
- **Future TODO**: Replace `owner()` treasury with configurable multisig `protocolTreasury` address.

---

## User Action Items (Manual / Environment Setup)
- [ ] **Run Supabase Migration `02_positions.sql`**: Execute [02_positions.sql](file:///d:/MDG/personal_projects/chrono_hedera/chrono-web/backend/db/migrations/02_positions.sql) in your Supabase SQL editor to provision the `positions` table and indexes for the off-chain indexer.
- [ ] **Redeploy BorrowVault on Hedera Testnet (Phase 4)**: Run:
  ```bash
  npx hardhat run scripts/deploy/redeployBorrowVault.ts --network testnet
  ```
  This script deploys the new BorrowVault, re-initializes it, rewires LendingPool, InterestEngine, LiquidationEngine, SchedulerEngine, and ChronoRouter, associates HTS tokens, and updates `deployments/testnet.json`.
- [ ] **Verify / Restart Chrono Backend**: After running migration and redeploying, ensure backend `.env` has valid `SUPABASE_URL` and `SUPABASE_ANON_KEY` and start/restart `chrono-web/backend` (`npm run dev` or `node server.js`).
- [x] **Frontend Repayment Scripts**: Confirmed NO changes needed to frontend transaction scripts (`repay.js`) — `BorrowVault.repay(bytes32,uint256)` preserves the exact same external interface and allowance requirements.