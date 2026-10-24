# Ordered pair risk, dynamic interest, and soft liquidation

## Market configuration

`AssetConfig` holds only token metadata and activity. `PairConfig` holds LTV, LT, liquidation, auction, and loan-duration settings, keyed by `(collateralToken, debtToken)`. A reverse pair requires its own registration and can use different settings. New loans require both assets and their ordered pair to be active. Existing positions remain assessable and liquidatable after a pair is deactivated.

For a pair whose allowed origination terms are `Tmin` and `Tmax`, define

`q(T) = [exp(-k (T - Tmin)) - exp(-k (Tmax - Tmin))] / [1 - exp(-k (Tmax - Tmin))]`.

Then `LTV(T) = 75% + (90% - 75%) q(T)` and `LT(T) = 80% + (92% - 80%) qLT(T)` with their respective pair parameters. The defaults hit **90% LTV and 92% LT at the shortest allowed term**, and **75% LTV and 80% LT at the longest allowed term**, exactly. A pair may override the endpoints. LT uses the **original loan duration** for health checks. To keep LT above LTV over the whole term range, registry validation requires LT's decay coefficient to be no larger than LTV's.

## Interest rate

The borrow rate for a position is `f1(T) + f2(T) + g(Ut)` in annualized WAD units:

- `f1(T) = A C / (T + C)`, a hyperbola. The owner can tune `C` and `A`. Initial values are one day and 8%.
- `f2(T) = B (T / 30 days)^n`. `n` is the owner-set `F2Shape` enum: linear (`1`), quadratic (`2`), or cubic (`3`). The initial `B` is 3% and the initial shape is linear.
- `g(U)` passes through a target rate of 4% at 85% utilization. Below 85%, it scales as `Rtarget U / 0.85`; above 85%, it scales as `Rtarget [1 + 4 (U - 0.85) / 0.15]`. At exactly 85%, the initial utilization rate is 4%.

The target rate adapts exponentially to utilization. Its normalized error is `(U - 0.85) / 0.15` above target and `(U - 0.85) / 0.85` below target. At either extreme, the target rate changes by an e-fold over **50 days**, bounded between 1 basis point and 100% annualized. The pool checkpoints utilization before each deposit, withdrawal, borrow, or principal return. The engine analytically integrates the exponential target rate between checkpoints, including a split if it reaches either bound. Token transfers directly to the pool outside these methods cannot create an intermediate checkpoint.

At origination, the contract stores `f1(T) + f2(T)` on the position. Later owner parameter changes affect only new positions. Accrual compounds the stored duration rate plus the integrated utilization rate **only for elapsed time while debt remains open**. Full repayment clears the position and ends accrual; partial repayment keeps the same duration rate on the remaining debt.

`quoteBorrowAPY(collateral, debt, duration)` is the current annualized quote for a new position. `getBorrowAPY(debt)` is a pool-level indicative rate using the principal-weighted duration rates of outstanding positions plus the current adaptive rate; the reserve index and supply quote use this pool-level value. The duration parameters are initial simulation inputs, not calibrated recommendations.

`previewTotalDebt(positionId)` projects the same accrued debt without changing storage. The legacy web backend uses this amount for health reporting, and the borrow form loads its term limit and curves from the selected ordered pair.

## Soft liquidation modes

The owner selects `SoftLiquidationMode` with `setSoftLiquidationMode(mode)`: `CD3 = 0` preserves the original dynamic-bonus D* sizing and Stability Pool/keeper routing, and `DutchAuction = 1` is the default. The two implementations have separate execution functions and share interest-first repayment accounting. Hard liquidation keeps its existing settlement and auction paths.

In Dutch mode, `softLiquidate(positionId, repayAmount)` starts a public auction; the second argument is used only in CD3 mode. The position must be active, unhealthy (HF below 1), and before maturity. Starting an auction transfers no tokens, leaves the loan active, keeps its collateral in the vault, and preserves its maturity schedule. Interest continues to accrue. The borrower can repay or top up during bidding.

The initial auction price is 105% of the oracle collateral/debt price and decreases linearly toward 90% over 15 minutes. These are configurable initial settings, not calibrated parameters: the owner can call `setSoftAuctionConfig(durationSeconds, startMultiplierWad, floorMultiplierWad)`. Duration must be 1 minute to 1 hour, the starting multiplier 100% to 200%, and the floor 80% to 100%, strictly below the start. Each auction snapshots its curve and ends at the earlier of its configured end or the loan's maturity. Changing the protocol mode or price configuration does not rewrite an existing auction.

`quoteSoftAuction(positionId)` returns the collateral lot, debt repayment, and current price. `bidSoftAuction(positionId, maxDebtToRepay, minCollateralToReceive)` buys that complete, dynamically sized lot with bidder slippage limits. At execution the contract accrues debt and reads current oracle prices and pair LT. With collateral C, debt D, oracle price q, auction price p, LT L, and target H = 1.05, it solves

`x = (H D - C q L) / (H p - q L)`.

It sells only x collateral (rounded to token units), applies the proceeds to interest and then principal, and verifies that the remaining position reaches at least HF 1.05. A bid cannot sell more collateral than is needed to repay all debt. The borrower keeps the unsold collateral; a fully repaid position refunds its remainder. Dutch settlement uses public bidders rather than the Stability Pool.

If the position has recovered to HF >= 1, bidding stops and anyone can cancel the auction. Anyone can also clear auctions after expiry, full repayment, or maturity. An auction whose price or available collateral cannot restore the target rejects the fill; it does not sell collateral while leaving the position below target or write off debt. An unfilled expiry leaves the loan and its collateral intact, allowing another soft auction or normal maturity settlement. Hard liquidation clears any outstanding soft-auction record and does not wait for a bidder.
