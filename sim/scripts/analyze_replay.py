"""Pre-2026 Binance cross-rate replay: NEG (as coded), SPEC, S1, B0_cap on paired walk-forward windows.

Usage: python scripts/analyze_replay.py --raw DIR --series-info SERIES.json [--windows window_stats.json] [--mc neg_vs_spec_s1.json]
[--out DIR]. Writes replay_pre2026_<variant>.json and .md to --out (default: the parent of --raw).
Only windows present for every model in a cell are used (paired). Daily windows overlap by 29 of 30 days, so intervals
are a circular block bootstrap over the window sequence (block = 30 days of starts, wrapping inside each gap-free
segment, so blocks never cross the Sep-Oct 2025 gap; B = 2,000, one fixed seed), and every percentile carries n_eff,
the calendar days covered by the windows' 30-day spans divided by 30.
VaR is the higher-order-statistic quantile; ES the mean of the worst ceil((1 - q) n) windows (as in the Monte Carlo).
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import analyze_neg as mc  # noqa: E402
NODES, LABEL, quantile, tail_mean, fmt = mc.NODES, mc.LABEL, mc.quantile, mc.tail_mean, mc.fmt
MODELS = ('NEG', 'SPEC', 'S1', 'B0_cap')
LTVS = ('base', 'stressed')
B, BLOCK_DAYS = 2000, 30
DAY = 86_400*10**9


def load(raw, variant, model, ltv):
    rows = {}
    for f in (raw/f'{variant}-{model}-100-{ltv}').glob('w-*.jsonl'):
        row, cost = [json.loads(x) for x in f.read_text().splitlines() if x]
        rows[row['path']] = dict(row, cpu_s=cost['cost']['cpu_s'])
    return rows


def segments(days):
    """Index ranges of runs of consecutive window days (spacing = smallest step)."""
    step = int(np.min(np.diff(days))) if len(days) > 1 else 1
    cuts = np.flatnonzero(np.diff(days) > step)+1
    return [(int(a), int(b)) for a, b in zip(np.r_[0, cuts], np.r_[cuts, len(days)])], step


def n_eff(days):
    """Calendar length covered by the union of the windows' 30-day spans, in 30-day blocks."""
    ends = np.asarray(days)+BLOCK_DAYS
    covered, reach = 0, -np.inf
    for start, end in zip(days, ends):
        covered += end-max(start, reach) if end > reach else 0
        reach = max(reach, end)
    return covered/BLOCK_DAYS


def block_indices(days, rng):
    """(B, n) circular block resamples: blocks of 30 days of starts wrap inside their gap-free segment, so every window
    has the same inclusion probability and no block straddles the excluded Sep-Oct 2025 gap."""
    segs, step = segments(days)
    n, length = len(days), max(1, BLOCK_DAYS//step)
    seg_of = np.empty((n, 2), int)
    for a, b in segs:
        seg_of[a:b] = a, b
    out = np.empty((B, n), int)
    for i in range(B):
        parts, total = [], 0
        while total < n:
            s = int(rng.integers(0, n))
            a, b = seg_of[s]
            parts.append(a+(s-a+np.arange(length)) % (b-a))
            total += length
        out[i] = np.concatenate(parts)[:n]
    return out


def boot(x, stat, idx):
    lo, hi = np.quantile(stat(x[idx]), [.025, .975])
    return [float(stat(x[None, :])[0]), float(lo), float(hi)]


def cell_stats(rows, idx):
    out = {}
    for t in NODES:
        a = np.array([r['nodes'][t] for r in rows], float)
        out[f'p_liq_{LABEL[t]}'] = boot(a, mc.ratio_stat, idx)
    early = np.array([sum(r['nodes'][t][0] for t in NODES) for r in rows], float)
    share = early/np.array([r['opened'] for r in rows], float)
    out['lar_mean'] = boot(share, lambda x: x.mean(-1), idx)
    out['lar_p95'] = boot(share, lambda x: quantile(x, .95), idx)
    out['lar_p99'] = boot(share, lambda x: quantile(x, .99), idx)
    loss = 100*np.array([r['loss']/r['principal'] for r in rows])
    out['loss_mean'] = boot(loss, lambda x: x.mean(-1), idx)
    for q in (95, 99):
        out[f'var{q}'] = boot(loss, lambda x, q=q: quantile(x, q/100), idx)
        out[f'es{q}'] = boot(loss, lambda x, q=q: tail_mean(x, q/100), idx)
    out['p_loss'] = boot((loss > 0).astype(float), lambda x: x.mean(-1), idx)
    hard = np.array([r['hard_sp']+r['hard_reserve'] for r in rows], float)
    out['hard_per_window'] = boot(hard, lambda x: x.mean(-1), idx)
    out['soft_per_window'] = boot(np.array([r['soft_sp']+r['soft_external'] for r in rows], float), lambda x: x.mean(-1), idx)
    rv = np.array([r['reverts'] for r in rows], float)
    out['reverts_per_window'] = boot(rv, lambda x: x.mean(-1), idx)
    out['reverts_p95'] = boot(rv, lambda x: quantile(x, .95), idx)
    out['p_reverts'] = boot((rv > 0).astype(float), lambda x: x.mean(-1), idx)
    out['cpu_s_per_window'] = float(np.mean([r['cpu_s'] for r in rows]))
    out['max_conservation_error'] = float(max(abs(r['conservation']) for r in rows))
    return out


def date(ns):
    return datetime.fromtimestamp(ns/1e9, timezone.utc).strftime('%Y-%m-%d')


def worst(cell_rows, windows):
    neg = cell_rows['NEG']
    order = sorted(neg, key=lambda k: (-neg[k]['loss']/neg[k]['principal'], k))[:10]
    out = []
    for k in order:
        item = dict(window=k, start=date(neg[k]['start_ns']), **(windows.get(str(k), {})))
        for m in MODELS:
            r = cell_rows[m][k]
            item[m] = dict(loss_pct=100*r['loss']/r['principal'],
                           lar_pct=100*sum(r['nodes'][t][0] for t in NODES)/r['opened'], reverts=r['reverts'])
        out.append(item)
    return out


def mc_reference(path):
    if path is None:
        return {}
    r = json.loads(path.read_text())
    keys = ('lar_mean', 'lar_p99', 'loss_mean', 'var99', 'es99', 'p_loss', 'hard_per_path')
    return {f'{mk}-{ltv}': {m: {k: r['cells'][f'{mk}-X-100-{ltv}'][m][k][0] if isinstance(r['cells'][f'{mk}-X-100-{ltv}'][m][k], list)
                                 else r['cells'][f'{mk}-X-100-{ltv}'][m][k] for k in keys} for m in ('NEG', 'SPEC', 'S1')}
            for mk in ('MK1', 'MK3') for ltv in LTVS}


def markdown(res):
    L = ['# Pre-2026 historical replay: NEG (as coded) vs SPEC, S1, B0_cap', '',
         f"Series: {res['label']}. Starts {res['first_start']} to {res['last_start']} at 00:00 UTC, "
         f"variant `{res['variant']}`, 100-position books.",
         'Brackets: 95% circular block bootstrap intervals (30-day blocks within each gap-free segment). n = paired windows, n_eff = calendar days covered by the windows / 30 (independent 30-day blocks).', '']
    L += ['## (a) P(liquidated before expiry) by term, %', '',
          '| u | Model | n | n_eff | ' + ' | '.join(LABEL[t] for t in NODES) + ' |', '|---|---|---|---|' + '---|'*len(NODES)]
    for ltv in LTVS:
        c = res['cells'][ltv]
        for m in MODELS:
            L.append(f"| {ltv} | {m} | {c['n']} | {c['n_eff']:.1f} | " + ' | '.join(fmt(c[m][f'p_liq_{LABEL[t]}'], True, 1) for t in NODES) + ' |')
    sections = [('(b) Book LaR: share of positions liquidated before expiry, %',
                 [('Mean', 'lar_mean', True), ('P95', 'lar_p95', True), ('P99', 'lar_p99', True)]),
                ('(c) Lender loss, % of principal',
                 [('Mean', 'loss_mean', False), ('VaR95', 'var95', False), ('VaR99', 'var99', False),
                  ('ES95', 'es95', False), ('ES99', 'es99', False), ('P(loss>0) %', 'p_loss', True)]),
                ('(d) Liquidations and reverted calls per window',
                 [('Hard at expiry', 'hard_per_window', False), ('Soft', 'soft_per_window', False),
                  ('Reverts mean', 'reverts_per_window', False), ('Reverts P95', 'reverts_p95', False),
                  ('P(any revert) %', 'p_reverts', True)])]
    for title, cols in sections:
        L += ['', f'## {title}', '', '| u | Model | n_eff | ' + ' | '.join(c[0] for c in cols) + ' |', '|---|---|---|' + '---|'*len(cols)]
        for ltv in LTVS:
            c = res['cells'][ltv]
            for m in MODELS:
                L.append(f"| {ltv} | {m} | {c['n_eff']:.1f} | " + ' | '.join(fmt(c[m][k], p) for _, k, p in cols) + ' |')
    for ltv in LTVS:
        L += ['', f'## Ten worst windows by NEG lender loss, u = {ltv} (loss % of principal / LaR % / reverts)', '',
              '| Start | 30 d vol | Low/start | ' + ' | '.join(MODELS) + ' |', '|---|---|---|' + '---|'*len(MODELS)]
        for w in res['cells'][ltv]['worst']:
            vol = f"{w['vol']:.2f}" if 'vol' in w else '-'
            low = f"{w['low_over_start']:.3f}" if 'low_over_start' in w else '-'
            L.append(f"| {w['start']} | {vol} | {low} | " + ' | '.join(
                f"{w[m]['loss_pct']:.3f} / {w[m]['lar_pct']:.0f} / {w[m]['reverts']:,}" for m in MODELS) + ' |')
    L += ['', '## Simulated markets (NEG Monte Carlo, 100-position cells, point estimates) for comparison', '',
          '| Market-u | Model | LaR mean % | LaR P99 % | Loss mean % | VaR99 % | ES99 % | P(loss>0) % | Hard per path |',
          '|---|---|---|---|---|---|---|---|---|']
    for cell, ms in res['mc_reference'].items():
        for m, s in ms.items():
            L.append(f"| {cell} | {m} | {100*s['lar_mean']:.2f} | {100*s['lar_p99']:.0f} | {s['loss_mean']:.4f} | {s['var99']:.3f} | "
                     f"{s['es99']:.3f} | {100*s['p_loss']:.1f} | {s['hard_per_path']:.2f} |")
    return '\n'.join(L)+'\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw', type=Path, required=True, help='replay run --out directory')
    parser.add_argument('--series-info', type=Path, required=True, help='the .json that prepare wrote next to the .npz')
    parser.add_argument('--variant', default='hold')
    parser.add_argument('--windows', type=Path, default=None, help='window_stats.py output (optional)')
    parser.add_argument('--mc', type=Path, default=None, help='analyze_neg.py neg_vs_spec_s1.json (optional)')
    parser.add_argument('--out', type=Path, default=None)
    args = parser.parse_args()
    out = args.out or args.raw.parent
    info = json.loads(args.series_info.read_text())
    windows = json.loads(args.windows.read_text()) if args.windows else {}
    res = dict(label=info['label'], variant=args.variant, bootstrap=B, block_days=BLOCK_DAYS, cells={},
               mc_reference=mc_reference(args.mc))
    for ltv in LTVS:
        cell_rows = {m: load(args.raw, args.variant, m, ltv) for m in MODELS}
        keys = sorted(set.intersection(*(set(r) for r in cell_rows.values())))
        days = np.array(keys)
        idx = block_indices(days, np.random.default_rng(20261021))
        c = dict(n=len(keys), n_eff=float(n_eff(days)), spacing_days=segments(days)[1],
                 dropped={m: len(cell_rows[m])-len(keys) for m in MODELS})
        for m in MODELS:
            c[m] = cell_stats([cell_rows[m][k] for k in keys], idx)
        c['worst'] = worst({m: {k: cell_rows[m][k] for k in keys} for m in MODELS}, windows)
        res['cells'][ltv] = c
        res['first_start'] = date(cell_rows['NEG'][keys[0]]['start_ns'])
        res['last_start'] = date(cell_rows['NEG'][keys[-1]]['start_ns'])
    out.mkdir(parents=True, exist_ok=True)
    (out/f'replay_pre2026_{args.variant}.json').write_text(json.dumps(res, indent=1)+'\n')
    (out/f'replay_pre2026_{args.variant}.md').write_text(markdown(res))
    print(markdown(res))


if __name__ == '__main__':
    main()
