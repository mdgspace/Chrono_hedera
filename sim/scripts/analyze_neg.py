"""NEG (as coded) vs SPEC and S1 on the first N paired r3 paths of each cell (reference engine, CRN).

Usage: python scripts/analyze_neg.py N --neg DIR --ref DIR [--n10 N10] [--out DIR] (N10: path count of the 10-position cells,
default N). Writes neg_vs_spec_s1.json and neg_vs_spec_s1.md to --out (default: the parent of --neg).
VaR is the higher-order-statistic quantile; ES the mean of the worst ceil((1 - q) n) paths.
Intervals: 95% percentile bootstrap over paths (B = 2,000, one fixed seed) for means and percentiles,
path-cluster bootstrap for per-term probabilities (positions on one path share a market), Wilson for P(loss > 0).
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np

NODES = ('3600', '21600', '86400', '259200', '604800', '1209600', '2592000')
LABEL = dict(zip(NODES, ('1h', '6h', '1d', '3d', '7d', '14d', '30d')))
CELLS = [f'{m}-{{}}-{b}-{l}' for m in ('MK1', 'MK3') for b in (10, 100) for l in ('base', 'stressed')]
MODELS = ('NEG', 'SPEC', 'S1')
B = 2000


def load(directory, n):
    """Rows of paths 0..n-1 and the chunk cost lines that hold them; fails if any path is missing."""
    rows, costs = {}, []
    for f in sorted(directory.glob('main-*.jsonl')):
        lines = [json.loads(x) for x in f.read_text().splitlines() if x]
        if lines[0]['path'] >= n:
            continue
        costs.append(lines[-1]['cost'])
        rows.update((r['path'], r) for r in lines[:-1] if r['path'] < n)
    if sorted(rows) != list(range(n)):
        raise ValueError(f'{directory}: {len(rows)} of {n} paths present')
    return [rows[k] for k in range(n)], costs


def quantile(x, q):
    return np.quantile(x, q, axis=-1, method='higher')


def boot(x, stat, rng):
    """stat maps a (k, n) array to k values; returns [estimate, 2.5%, 97.5%]."""
    draws = stat(x[rng.integers(0, len(x), (B, len(x)))])
    lo, hi = np.quantile(draws, [.025, .975])
    return [float(stat(x[None, :])[0]), float(lo), float(hi)]


def wilson(k, n):
    if n == 0:
        return [math.nan] * 3
    p, z = k / n, 1.959964
    c = (p + z * z / (2 * n)) / (1 + z * z / n)
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return [p, max(0., c - h), min(1., c + h)]


def ratio_stat(a):
    return a[..., 0].sum(-1) / np.maximum(1, a[..., 1].sum(-1))


def cell_stats(rows, costs, rng):
    n = len(rows)
    out = {}
    for t in NODES:  # (a) per-term P(liquidated before expiry), clustered by path
        a = np.array([r['nodes'][t] for r in rows], float)
        idx = rng.integers(0, n, (B, n))
        lo, hi = np.quantile(ratio_stat(a[idx]), [.025, .975])
        out[f'p_liq_{LABEL[t]}'] = [float(ratio_stat(a)), float(lo), float(hi)]
    early = np.array([sum(r['nodes'][t][0] for t in NODES) for r in rows], float)
    share = early / np.array([r['opened'] for r in rows], float)  # (b) book LaR as a share of positions
    out['lar_mean'] = boot(share, lambda x: x.mean(-1), rng)
    out['lar_p95'] = boot(share, lambda x: quantile(x, .95), rng)
    out['lar_p99'] = boot(share, lambda x: quantile(x, .99), rng)
    loss = 100 * np.array([r['loss'] / r['principal'] for r in rows])  # (c) lender loss, % of principal
    out['loss_mean'] = boot(loss, lambda x: x.mean(-1), rng)
    for q in (95, 99):
        out[f'var{q}'] = boot(loss, lambda x: quantile(x, q / 100), rng)
        out[f'es{q}'] = boot(loss, lambda x: tail_mean(x, q / 100), rng)
    out['p_loss'] = wilson(int((loss > 0).sum()), n)
    hard = np.array([r['hard_sp'] + r['hard_reserve'] for r in rows], float)  # (d) expiry hard liquidations
    reserve = sum(r['hard_reserve'] for r in rows)
    out['hard_per_path'] = boot(hard, lambda x: x.mean(-1), rng)
    out['hard_reserve_share'] = reserve / hard.sum() if hard.sum() else math.nan
    out['soft_per_path'] = float(np.mean([r['soft_sp'] + r['soft_external'] for r in rows]))
    out['soft_external_share'] = (sum(r['soft_external'] for r in rows)
                                  / max(1, sum(r['soft_sp'] + r['soft_external'] for r in rows)))
    # (e) reverted protocol calls: per path where recorded (NEG), chunk totals otherwise (all models)
    out['reverts_per_path_chunks'] = sum(c['stats']['reverts'] for c in costs) / sum(c['paths'] for c in costs)
    if all('reverts' in r for r in rows):
        rv = np.array([r['reverts'] for r in rows], float)
        out['reverts_per_path'] = boot(rv, lambda x: x.mean(-1), rng)
        out['reverts_p95'] = float(quantile(rv, .95))
        out['p_reverts'] = wilson(int((rv > 0).sum()), n)
    if all('loss_by_term' in r for r in rows):
        total = sum(r['loss'] for r in rows)
        out['loss_share_by_term'] = {LABEL[t]: (sum(r['loss_by_term'][t] for r in rows) / total if total else 0.)
                                     for t in NODES}
    out['cpu_s_per_path'] = sum(c['cpu_s'] for c in costs) / sum(c['paths'] for c in costs)
    return out


def tail_mean(x, q):
    """Expected shortfall: mean of the worst ceil((1 - q) n) values of each row."""
    k = math.ceil(round((1 - q) * x.shape[-1], 9))
    return -np.sort(-x, axis=-1)[..., :k].mean(-1)


def fmt(v, pct=False, d=2):
    s = (lambda x: f'{round(100 * x, d) + 0.:.{d}f}') if pct else (lambda x: f'{round(x, d) + 0.:.{d}f}')  # no -0.00
    return f'{s(v[0])} [{s(v[1])}, {s(v[2])}]' if isinstance(v, list) else s(v)


def markdown(result, n, n10):
    lines = [f'# NEG (as coded) vs SPEC and S1, first {n} paired r3 paths per 100-position cell, {n10} per 10-position cell', '',
             'Reference engine, r3 seeds (`main`, `-r3`), identical market and agent draws across models.',
             'Brackets are 95% intervals (bootstrap over paths; Wilson for P(loss > 0)).', '']
    lines += ['## (a) P(liquidated before expiry) by term, %', '',
              '| Cell | Model | ' + ' | '.join(LABEL[t] for t in NODES) + ' |', '|---|---|' + '---|' * len(NODES)]
    for cell in result['cells']:
        for m in MODELS:
            s = result['cells'][cell][m]
            lines.append(f'| {cell} | {m} | ' + ' | '.join(fmt(s[f"p_liq_{LABEL[t]}"], True, 1) for t in NODES) + ' |')
    sections = [('(b) Book LaR: share of positions liquidated before expiry, %',
                 [('Mean', 'lar_mean', True), ('P95', 'lar_p95', True), ('P99', 'lar_p99', True)]),
                ('(c) Lender loss, % of principal',
                 [('Mean', 'loss_mean', False), ('VaR95', 'var95', False), ('VaR99', 'var99', False),
                  ('ES95', 'es95', False), ('ES99', 'es99', False), ('P(loss>0) %', 'p_loss', True)]),
                ('(d) Liquidation counts per path',
                 [('Hard (expiry) per path', 'hard_per_path', False), ('hard_reserve share %', 'hard_reserve_share', True),
                  ('Soft per path', 'soft_per_path', False), ('Soft external share %', 'soft_external_share', True)]),
                ('(e) Reverted protocol calls per path',
                 [('Chunk mean (all models)', 'reverts_per_path_chunks', False), ('Per-path mean (NEG)', 'reverts_per_path', False),
                  ('Per-path P95 (NEG)', 'reverts_p95', False), ('P(any revert) % (NEG)', 'p_reverts', True)])]
    for title, cols in sections:
        lines += ['', f'## {title}', '', '| Cell | Model | ' + ' | '.join(c[0] for c in cols) + ' |',
                  '|---|---|' + '---|' * len(cols)]
        for cell in result['cells']:
            for m in MODELS:
                s = result['cells'][cell][m]
                lines.append(f'| {cell} | {m} | ' + ' | '.join(fmt(s[k], p) if k in s else '-' for _, k, p in cols) + ' |')
    lines += ['', '## NEG lender-loss share by loan term, %', '',
              '| Cell | ' + ' | '.join(LABEL[t] for t in NODES) + ' |', '|---|' + '---|' * len(NODES)]
    for cell in result['cells']:
        s = result['cells'][cell]['NEG'].get('loss_share_by_term')
        if s:
            lines.append(f'| {cell} | ' + ' | '.join(f'{100 * s[LABEL[t]]:.1f}' for t in NODES) + ' |')
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('n', type=int)
    parser.add_argument('--n10', type=int, default=None)
    parser.add_argument('--neg', type=Path, required=True, help='NEG run directory (<cell>/main-*.jsonl)')
    parser.add_argument('--ref', type=Path, required=True, help='SPEC and S1 r3 reference-engine directory')
    parser.add_argument('--out', type=Path, default=None)
    args = parser.parse_args()
    out = args.out or args.neg.parent
    n10 = args.n10 or args.n
    result = dict(n=args.n, n10=n10, bootstrap=B, neg_dir=str(args.neg), ref_dir=str(args.ref), cells={})
    for template in CELLS:
        cell = template.format('X')
        n = n10 if '-10-' in cell else args.n
        result['cells'][cell] = {'n': n}
        for m in MODELS:
            directory = (args.neg if m == 'NEG' else args.ref) / template.format(m)
            rows, costs = load(directory, n)
            result['cells'][cell][m] = cell_stats(rows, costs, np.random.default_rng(20261021))
    out.mkdir(parents=True, exist_ok=True)
    (out / 'neg_vs_spec_s1.json').write_text(json.dumps(result, indent=1) + '\n')
    (out / 'neg_vs_spec_s1.md').write_text(markdown(result, args.n, n10))
    print((out / 'neg_vs_spec_s1.md').read_text())


if __name__ == '__main__':
    main()
