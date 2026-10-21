"""Binance cross-rate replay (default HBARUSDT/USDCUSDT), USDC = 1, not USD-anchored, through the P3b reference engine.

prepare: select the pre-2026 monthly Binance 1m archives that touch no holdout window (manifest metadata only), verify
  their SHA-256 against data_manifests/binance_1m.json, build the minute cross rate --base / --quote on the
  completed-candle clock and write one npz.
run: one path per walk-forward window (a book opens at 00:00 UTC on each start day, 30 d + 1,000 s horizon), the
  holders, nodes and u of equiv_engine.py, records in its summarise() format, one file per (cell, window).
Each minute's close (variant hold) or its adverse low HBAR low / USDC high (variant low) is held for its 60 s through
chrono_sim/market/replay.py; confidence is 0 (single venue). Seeds exclude the model, so models share windows and draws.
"""
import argparse
import csv
import io
import json
import os
from pathlib import Path
import platform
import sys
import time
import zipfile

if __name__ in ('__main__', '__mp_main__'):
    os.environ['NUMBA_NUM_THREADS'] = '1'
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts import equiv_engine as ee  # noqa: E402
from chrono_sim.data.normalize import candles, ns  # noqa: E402
from chrono_sim.market.history import assert_allowed, sha256_file, span_allowed  # noqa: E402
from chrono_sim.market.pathbatch import PathBatch  # noqa: E402

MANIFEST = ROOT/'data_manifests/binance_1m.json'
JAN1_2024_NS = 1_704_067_200*10**9
MINUTE, DAY = 60*10**9, 86_400*10**9
HORIZON_S = ee.HORIZON  # 30 d + 1,000 s
MODELS = {'NEG': 'as_coded', 'SPEC': 'm0', 'S1': 'm0', 'B0_cap': 'm0'}


def select_files(state, symbol):
    """Monthly 2024-2025 Binance 1m archives whose trade span [first open, last open + 60 s) is allowed."""
    policy = state['calibration_split_policy']
    files = [f for f in state['files'] if f['symbol'] == symbol and f['month'][:4] in ('2024', '2025')
             and span_allowed(f['observed_start_ns'], f['observed_end_ns']+MINUTE-1, policy)]
    return sorted(files, key=lambda f: f['observed_start_ns'])


def read_month(path, f):
    """One verified Binance monthly 1m archive on the snapshot_v1 candle contract (chrono_sim/data/normalize.py)."""
    if sha256_file(path) != f['sha256']:
        raise ValueError(f'{path} failed manifest SHA-256 verification')
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != 1 or archive.testzip() is not None:
            raise ValueError('invalid Binance ZIP or CRC')
        with archive.open(names[0]) as stream:
            rows = list(csv.reader(io.TextIOWrapper(stream)))
    unit = 'us' if int(f['month'][:4]) >= 2025 else 'ms'  # Binance spot archives use microseconds from 2025
    if any(not r[0].isdigit() or len(r[0]) != (16 if unit == 'us' else 13) for r in rows):
        raise ValueError('mixed or unexpected archive timestamp units')
    y, m = map(int, f['month'].split('-'))
    return candles(rows, 'binance', f['symbol'], unit, MINUTE, ns(f"{f['month']}-01T00:00:00Z"),
                   ns(f'{y+m//12}-{m % 12+1:02d}-01T00:00:00Z'))


def window_starts(clock, policy, spacing_days=1):
    """Daily 00:00 UTC starts s whose span [s, s + horizon] is allowed and whose every held close is observed."""
    horizon = int(HORIZON_S)*10**9
    clock = np.asarray(clock, dtype=np.int64)
    out = []
    for s in range(JAN1_2024_NS, int(clock[-1])-horizon+1, spacing_days*DAY):
        last = (s+horizon)//MINUTE*MINUTE
        lo, hi = np.searchsorted(clock, [s, last])
        if (span_allowed(s, s+horizon, policy) and lo < len(clock) and hi < len(clock) and clock[lo] == s
                and clock[hi] == last and hi-lo == (last-s)//MINUTE):
            out.append(s)
    return np.array(out, dtype=np.int64)


def prepare(data_root, out, base='HBARUSDT', quote='USDCUSDT', first=None, last=None):
    """first/last (YYYY-MM) restrict the months, for smoke runs on a few archives."""
    import polars as pl
    state = json.loads(MANIFEST.read_text())
    policy = state['calibration_split_policy']
    frames, lineage, no_trade = [], [], {}
    for symbol in (base, quote):
        parts = []
        for f in select_files(state, symbol):
            if (first and f['month'] < first) or (last and f['month'] > last):
                continue
            path = Path(data_root)/Path(f['url']).name
            lineage.append(dict(url=f['url'], sha256=f['sha256']))
            parts.append(read_month(path, f).select('timestamp_ns', 'close', 'low', 'high', 'gap_flag'))
        if not parts:
            raise ValueError(f'no {symbol} archives selected')
        x = pl.concat(parts).with_columns((pl.col('timestamp_ns')+MINUTE).alias('time'))
        # The last 2025 candle completes at the cutoff itself; the guard then refuses anything left over.
        x = x.filter(pl.col('time') < policy['exclude_at_or_after_ns']).sort('time')
        assert_allowed(x['timestamp_ns'].to_numpy(), policy)
        assert_allowed(x['time'].to_numpy(), policy)
        flags = x['gap_flag'].value_counts().to_dicts()
        if set(x['gap_flag'].unique()) - {'ok', 'no_trades'}:
            raise ValueError(f'unexpected gap flags in {symbol}: {flags}')
        no_trade[symbol] = int((x['gap_flag'] == 'no_trades').sum())
        valid = pl.col('gap_flag') == 'ok'
        x = x.select('time', *[pl.when(valid).then(pl.col(c)).otherwise(None).forward_fill().alias(f'{c}_{symbol}')
                               for c in ('close', 'low', 'high')]).drop_nulls()
        frames.append(x)
    joined = frames[0].join(frames[1], on='time', how='inner').sort('time')
    t = joined['time'].to_numpy()
    assert_allowed(t, policy)
    close = (joined[f'close_{base}']/joined[f'close_{quote}']).to_numpy()
    low = (joined[f'low_{base}']/joined[f'high_{quote}']).to_numpy()
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    np.savez(out, time_ns=t, close=close, low=low)
    info = dict(label=f'Binance cross-rate replay ({base}/{quote}), USDC = 1, not USD-anchored', files=lineage,
                no_trade_minutes_carried_forward=no_trade, minutes=len(t), first_ns=int(t[0]), last_ns=int(t[-1]),
                windows=len(window_starts(t, policy)), manifest_sha256=sha256_file(MANIFEST))
    Path(out).with_suffix('.json').write_text(json.dumps(info, indent=2)+'\n')
    print(json.dumps({k: v for k, v in info.items() if k != 'files'}), flush=True)


SERIES = {}


def series(path):
    if path not in SERIES:
        z = np.load(path)
        assert_allowed(z['time_ns'], json.loads(MANIFEST.read_text())['calibration_split_policy'])
        SERIES[path] = z['time_ns'], z['close'], z['low']
    return SERIES[path]


def window_batch(path, start_ns, variant, horizon_s, compact=True, asset='HBAR'):
    from chrono_sim.market import replay
    t, close, low = series(path)
    i = int(np.searchsorted(t, start_ns))
    n = int(horizon_s)
    if t[i] != start_ns:
        raise ValueError('window start is not an observed completed-candle time')
    m = n//60+1
    if i+m > len(t) or t[i+m-1]-t[i] != (m-1)*MINUTE:
        raise ValueError('window is not covered by contiguous observed minutes')
    held = np.repeat((close if variant == 'hold' else low)[i:i+m], 60)[:n+1]
    prices = np.vstack([held, np.ones(n+1)])
    params = replay.ReplayParams(assets=(asset, 'USDC'), initial_price=[float(held[0]), 1.], sigma=[.6, 0.],
                                 times_s=np.arange(n+1, dtype=float), prices=prices, confidence=np.zeros_like(prices))
    full = replay.generate(params, 1, float(n), 1., np.random.default_rng(0))
    return full if not compact else compact_batch(full)


def compact_batch(b):
    """Keep seconds 60m and 60m + 59 of each held minute and the horizon. The loop runs with refinement sigma 0
    (LoopConfig.sigma_per_s, which only shapes bridges, not models), so a refined 59 s bar is the linear, here
    constant, interpolation of equal endpoints: exactly the held 1 s series. Unrefined quiet bars cost one step."""
    keep = np.flatnonzero((b.t % 60 == 0) | (b.t % 60 == 59) | (b.t == b.t[-1]))
    cut = lambda a: np.ascontiguousarray(a[..., keep])
    return PathBatch(b.t[keep], b.assets, cut(b.log_price), cut(b.bar_low), cut(b.conf_frac), cut(b.jump_mask),
                     cut(b.regime), dict(b.seed_info, grid='held-minute compact'))


def cell_id(c):
    return f"{c['variant']}-{c['model']}-{c['book']}-{c['ltv']}"


def task(args):
    c, k, start_ns, series_path, out, horizon_s = args
    target = Path(out)/cell_id(c)/f'w-{k:05d}.jsonl'
    if target.exists():
        return str(target)
    key = ee.seed('replay', c['variant'], c['book'], c['ltv'], k)  # no model: paired across models
    loop = ee.make_loop(c, 'reference', sigma=0.)  # refinement bridges only; models keep their r3 configs
    cpu, wall = time.process_time(), time.perf_counter()
    coll = c['pair'].split('_')[0]
    batch = window_batch(series_path, start_ns, c['variant'], horizon_s, asset=coll)
    records = loop.run(batch, ee.holders(c['book'], ee.LTVS[c['ltv']], coll, c['collateral']), np.random.default_rng(key+1))
    row = ee.summarise(records, k)[0]
    row.update(start_ns=int(start_ns), reverts=getattr(loop, 'path_reverts', [0])[-1])
    cost = dict(window=k, paths=1, cpu_s=time.process_time()-cpu, wall_s=time.perf_counter()-wall,
                stats=loop.stats, host=platform.node())
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix('.tmp')
    temp.write_text(json.dumps(row, default=lambda o: o.item())+'\n'+json.dumps(dict(cost=cost), default=lambda o: o.item())+'\n')
    temp.replace(target)
    return str(target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('prepare')
    p.add_argument('--data-root', type=Path, required=True, help='directory holding the Binance monthly 1m .zip archives')
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--base', default='HBARUSDT', help='for example BTCUSDT')
    p.add_argument('--quote', default='USDCUSDT')
    p.add_argument('--first', default=None, help='first month YYYY-MM (smoke runs)')
    p.add_argument('--last', default=None, help='last month YYYY-MM (smoke runs)')
    r = sub.add_parser('run')
    r.add_argument('--series', type=Path, required=True)
    r.add_argument('--variant', choices=('hold', 'low'), default='hold')
    r.add_argument('--models', nargs='+', default=list(MODELS))
    r.add_argument('--books', nargs='+', type=int, default=[100])
    r.add_argument('--ltvs', nargs='+', default=list(ee.LTVS))
    r.add_argument('--spacing-days', type=int, default=1)
    r.add_argument('--max-windows', type=int, default=None, help='first windows only (pilot)')
    r.add_argument('--part', default='0/1', help='J/K: windows with index position mod K == J')
    r.add_argument('--workers', type=int, default=8)
    r.add_argument('--out', type=Path, required=True)
    r.add_argument('--horizon', type=float, default=HORIZON_S, help='smoke tests only')
    r.add_argument('--pair', default='HBAR_USDC', help='configs/pairs/<pair>.yaml; its first token names the collateral')
    r.add_argument('--collateral', type=float, default=100., help='collateral per position, in units of the base asset')
    args = parser.parse_args()
    if args.command == 'prepare':
        return prepare(args.data_root, args.out, args.base, args.quote, args.first, args.last)
    t, _, _ = series(str(args.series))
    starts = window_starts(t, json.loads(MANIFEST.read_text())['calibration_split_policy'])
    index = [(int((s-JAN1_2024_NS)//DAY), int(s)) for s in starts if ((s-JAN1_2024_NS)//DAY) % args.spacing_days == 0]
    # Even days first: if the CPU cap stops the run, the finished set is the 48 h spacing grid (the brief's fallback).
    index = sorted(index, key=lambda x: (x[0] % 2, x[0]))[:args.max_windows]
    j, k = map(int, args.part.split('/'))
    chosen = [dict(market='replay', variant=args.variant, model=m, book=b, ltv=l, switches=MODELS[m], pair=args.pair,
                   collateral=args.collateral)
              for b in args.books for l in args.ltvs for m in args.models]
    # Window-major: every cell advances together, so a budget stop leaves equal paired window sets.
    jobs = [(c, w, s, str(args.series), str(args.out), args.horizon) for n, (w, s) in enumerate(index) if n % k == j
            for c in chosen]
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out/f"plan-{args.variant}-part{j}of{k}.json").write_text(json.dumps(dict(
        vars(args), cells=[cell_id(c) for c in chosen], windows=len(index), jobs=len(jobs)), default=str, indent=2)+'\n')
    warm = dict(chosen[0], market='MK1', pair='HBAR_USDC')  # compile on a one-hour GBM slice, never on replay data
    if args.workers == 1:
        ee.warm(warm, 'reference')
        done = [task(x) for x in jobs]
    else:
        from multiprocessing import get_context
        with get_context('spawn').Pool(args.workers, initializer=ee.warm, initargs=(warm, 'reference')) as pool:
            done = list(pool.imap_unordered(task, jobs))
    print(json.dumps(dict(status='complete', files=len(done))), flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
