# Chrono LTV simulator

This directory holds the minimal code behind three Chrono LTV simulation runs.
Every model parameter in `configs/` is illustrative, uncalibrated and unratified.
Code comments cite design notes (`P3C_METHOD.md` and others) that are not part of this directory.

## The three runs

1. **r3 engine equivalence**: the reference engine and the adaptive engine run the same 24 cells (markets MK1 GBM and MK3 Kou, books of 10 and 100 positions, opening u = 0.8 base and 0.98 stressed, models SPEC, S1 and B0_cap), and a pre-registered TOST and KS/AD analysis tests that they agree.
2. **NEG Monte Carlo**: NEG as coded runs on the same 24 cells with the same r3 seeds, so it is paired path by path with SPEC and S1.
3. **Historical replay**: NEG, SPEC, S1 and B0_cap run on 638 daily-start 30-day windows (2024-01-02 to 2025-12-01) of the Binance HBARUSDT / USDCUSDT 1m cross rate, with USDC = 1 and oracle confidence 0.

Models:

- **NEG** is the deployed decay model, with its time-dependent LTV and the final-hour health-factor revert (`--switches as_coded`).
- **SPEC** is the spec candidate: a capped GBM opening limit from a fixed volatility, with a floating liquidation threshold.
- **S1** is the research candidate: mean-reverting term variance, a snapshotted liquidation threshold and a maturity-value opening test.
- **B0_cap** is a flat-cap control.

## Setup

Python 3.12 with [uv](https://docs.astral.sh/uv/), from this directory:

```sh
uv sync --frozen
uv run pytest -q
```

With Nix, `nix develop` gives Python 3.12 and uv, then run the same two commands.
The full unit suite takes about 4 minutes on one core; 15 tests skip unless `NUMBA_DISABLE_JIT=1`.

## Data

The replay reads Binance spot 1m monthly archives from data.binance.vision.
No price data is committed.
`data_manifests/binance_1m.json` lists every 2024-2025 archive for HBARUSDT, USDCUSDT and BTCUSDT with its URL and SHA-256, and `prepare` refuses an archive whose hash differs.

```sh
mkdir -p data/binance && cd data/binance
for s in HBARUSDT USDCUSDT; do
  for m in 2024-{01..12} 2025-{01..12}; do
    curl -sSfO "https://data.binance.vision/data/spot/monthly/klines/$s/1m/$s-1m-$m.zip"
  done
done
cd ../..
```

The URL pattern is `https://data.binance.vision/data/spot/monthly/klines/{SYMBOL}/1m/{SYMBOL}-1m-{YYYY-MM}.zip`.
`2025-10` is downloaded but never read, because it overlaps a holdout window.

## Holdout rule

No data at or after 2026-01-01 00:00 UTC, and none inside the holdout windows 2025-10-09 to 2025-10-12 and 2026-02-04 to 2026-02-07, may be read.
The rule lives in `calibration_split_policy` of the manifest.
`chrono_sim/market/history.py` enforces it: `assert_allowed` raises `HoldoutViolation` for any such timestamp, and `prepare`, every series load and the window selection call it.

## Commands

Each command writes one JSON line per path (or window) plus a cost line, one file per chunk, under `--out`.
Existing files are skipped, so an interrupted run resumes.
`--workers` sets the number of single-threaded worker processes.

### 1. r3 engine equivalence

Smoke (2 paths per cell, 1 day horizon):

```sh
uv run python scripts/equiv_engine.py --engine reference --phase main --rerun=-r3 --paths 2 --chunk 2 --horizon 86400 --workers 4 --out results/smoke/r3/reference
uv run python scripts/equiv_engine.py --engine adaptive --phase main --rerun=-r3 --paths 2 --chunk 2 --horizon 86400 --workers 4 --out results/smoke/r3/adaptive
```

Full size (5,984 paths per cell and engine; the reported run took about 300 CPU-hours for the reference engine and 250 for the adaptive one):

```sh
uv run python scripts/equiv_engine.py --engine reference --phase main --rerun=-r3 --paths 5984 --chunk 8 --workers 8 --out results/r3/reference
uv run python scripts/equiv_engine.py --engine adaptive --phase main --rerun=-r3 --paths 5984 --chunk 8 --workers 8 --out results/r3/adaptive
uv run python scripts/equiv_analyze.py analyze --reference results/r3/reference --adaptive results/r3/adaptive --out results/r3/result.json
```

Seeds depend on the chunk index and size, so keep `--chunk 8` to reproduce the reported paths.
Outputs go to `results/r3/<engine>/<market>-<model>-<book>-<u>/main-NNNNN.jsonl`.

### 2. NEG Monte Carlo

Smoke:

```sh
uv run python scripts/equiv_engine.py --engine reference --phase main --rerun=-r3 --models NEG --switches as_coded --paths 2 --chunk 2 --horizon 86400 --workers 4 --out results/smoke/neg
```

Full size (the reported run has 544 paths per 100-position cell and 216 per 10-position cell, about 25 CPU-hours; the analysis needs the r3 reference run for SPEC and S1):

```sh
uv run python scripts/equiv_engine.py --engine reference --phase main --rerun=-r3 --models NEG --switches as_coded --paths 544 --chunk 8 --workers 8 --out results/neg
uv run python scripts/analyze_neg.py 544 --n10 216 --neg results/neg --ref results/r3/reference --out results/neg_vs_spec_s1
```

`--part J/K` splits one run over K jobs (job J takes chunks k with k mod K = J).
The analysis writes `neg_vs_spec_s1.json` and `.md`.

### 3. Historical replay

Build the series (all allowed 2024-2025 months), then run:

```sh
uv run python scripts/replay_engine.py prepare --data-root data/binance --out data/replay/cross_pre2026.npz
uv run python scripts/replay_engine.py run --series data/replay/cross_pre2026.npz --variant hold --books 100 --workers 8 --out results/replay
uv run python scripts/window_stats.py data/replay/cross_pre2026.npz results/replay_window_stats.json
uv run python scripts/analyze_replay.py --raw results/replay --series-info data/replay/cross_pre2026.json --windows results/replay_window_stats.json --mc results/neg_vs_spec_s1/neg_vs_spec_s1.json --out results/replay_report
```

Full size is 638 windows x 4 models x 2 values of u (about 23 CPU-hours).
Outputs go to `results/replay/hold-<model>-100-<u>/w-NNNNN.jsonl`, where NNNNN is the day index from 2024-01-01; `--mc` is optional.

Smoke (two months of data, 2 windows):

```sh
uv run python scripts/replay_engine.py prepare --data-root data/binance --first 2024-01 --last 2024-02 --out data/smoke/cross.npz
uv run python scripts/replay_engine.py run --series data/smoke/cross.npz --max-windows 2 --workers 8 --out results/smoke/replay
```

## Switching HBAR/USDC to BTC/USDC

The replay switches with arguments only:

- **Base symbol**: `prepare --base BTCUSDT` (default `HBARUSDT`); download `BTCUSDT-1m-YYYY-MM.zip` with the loop above, since the manifest lists BTCUSDT for every 2024-2025 month.
- **Cross with USDC**: `prepare --quote USDCUSDT` (the default), so the series is BTCUSDT / USDCUSDT with USDC = 1.
- **Pair configuration**: `run --pair BTC_USDC` loads `configs/pairs/BTC_USDC.yaml` and names the collateral BTC.
- **Starting price**: nothing to set, because each window starts at the observed cross rate at its 00:00 UTC start.
- **Position size**: `run --collateral` sets the collateral per position in base units (default 100, which is $4 to $40 of HBAR over 2024-2025); `--collateral 0.0003` gives a similar dollar size in BTC.

```sh
uv run python scripts/replay_engine.py prepare --base BTCUSDT --quote USDCUSDT --data-root data/binance --out data/replay/btc_pre2026.npz
uv run python scripts/replay_engine.py run --series data/replay/btc_pre2026.npz --pair BTC_USDC --collateral 0.0003 --books 100 --workers 8 --out results/replay_btc
```

The volatility inputs must be re-estimated for BTC before the results mean anything:

- SPEC takes `extra.sigma` from the pair file (0.8 in `HBAR_USDC.yaml`; the 0.5 in `BTC_USDC.yaml` is a placeholder, not an estimate).
- S1 takes `extra.theta` (variance, sigma squared) and `extra.sigma_floor` (half of sigma by convention), because these runs feed it no live variance.
- NEG and B0_cap take no volatility.
- The `sigma 0.6` in `MARKETS` of `scripts/equiv_engine.py` is the HBAR volatility of the simulated MK1 and MK3 markets, not a model input, and the replay does not use it.

To re-estimate, build the BTC series from pre-2026 data only, run `scripts/window_stats.py` on it, and take the median `vol` (annualised standard deviation of 1m log returns) over the 2024-2025 windows as sigma.
Then set `sigma`, `theta = sigma^2` and `sigma_floor = sigma / 2` in `configs/pairs/BTC_USDC.yaml`.
The other fields of `BTC_USDC.yaml` (`lam`, `cap`, `J_struct`, `perpetual_cap`, `L_eq`) are illustrative too and differ from the HBAR file.

The Monte Carlo runs 1 and 2 are defined on HBAR: switching them needs an edit of `MARKETS` in `scripts/equiv_engine.py` (assets, `initial_price`, `sigma`) and a `pair` key in each cell.
