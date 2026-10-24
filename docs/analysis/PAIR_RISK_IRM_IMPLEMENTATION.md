# Ordered pair risk and dynamic interest

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
