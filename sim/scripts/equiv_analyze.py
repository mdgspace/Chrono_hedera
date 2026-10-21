"""P3c pre-registered equivalence analysis (P3C_METHOD.md section 10).

`plan` turns the pilot into sample sizes and the underpowered list (results/P3C_equiv_plan.json);
`analyze` runs the pooled TOST family, the KS/AD/Cochran-Q difference family under Holm, and the
per-cell secondary view on the main-phase files. Directories hold `<cell>/<phase>-*.jsonl`.
"""
import argparse
import json
import math
from pathlib import Path
import warnings

import numpy as np
from scipy.stats import PermutationMethod, anderson_ksamp, chi2, ks_2samp, norm


ALPHA, MIN_EVENTS, MIN_SAMPLE, BOOT = .05, 200, 20, 1000
Z = norm.ppf(.95)+norm.ppf(.995)
CHANNELS = ('soft_sp', 'soft_external', 'hard_sp', 'hard_reserve')
NODES = ('3600', '21600', '86400', '259200', '604800', '1209600', '2592000')
REL, ABS, ES_REL = math.log(1.05), .01, math.log(1.10)
KS_AD_DIGITS = 10  # P3C_METHOD.md section 12 (2026-10-19): KS/AD inputs rounded to relative 1e-9


def holm(pvalues, alpha=.05):
    """Holm step-down adjusted p-values and rejections (familywise error at most alpha)."""
    p = np.asarray(pvalues, dtype=float)
    if p.ndim != 1 or not np.isfinite(p).all() or np.any((p < 0) | (p > 1)) or not 0 < alpha < 1:
        raise ValueError('finite p-values in [0,1] and alpha in (0,1) required')
    order = np.argsort(p)
    m = len(p)
    adjusted = np.empty(m)
    running = 0.
    for rank, i in enumerate(order):
        running = max(running, min(1., (m-rank)*p[i]))
        adjusted[i] = running
    return adjusted.tolist(), (adjusted <= alpha).tolist()


def load(directories, phase):
    data, cost = {}, {}
    for directory in directories:
        for f in sorted(Path(directory).glob(f'**/{phase}-*.jsonl')):
            for line in f.read_text().splitlines():
                row = json.loads(line)
                if set(row) == {'cost'}:  # chunk cost line; path rows carry borrower 'cost' too
                    cost.setdefault(f.parent.name, []).append(row['cost'])
                else:
                    data.setdefault(f.parent.name, []).append(row)
    return data, cost


def columns(rows):
    col = {k: np.array([r[k] for r in rows], float)
           for k in ('debt_time', *CHANNELS, 'loss', 'cost', 'principal')}
    col['soft'], col['hard'] = col['soft_sp']+col['soft_external'], col['hard_sp']+col['hard_reserve']
    col['t1'] = np.array([np.nan if r['first_liquidation'] is None else r['first_liquidation'] for r in rows])
    for n in NODES:
        col['num'+n] = np.array([r['nodes'][n][0] for r in rows], float)
        col['den'+n] = np.array([r['nodes'][n][1] for r in rows], float)
    return col


def es95(x):
    k = max(1, math.ceil(.05*len(x)))
    return float(np.sort(x)[-k:].mean())


def estimate(kind, col, key, rng):
    """(value, variance of the compared scale, events); the scale is log for relative metrics."""
    n = len(col['loss'])
    if kind == 'mean':
        x = col[key]
        events = n if key == 'debt_time' else int((x > 0).sum()) if key == 'loss' else int(x.sum())
        m = x.mean()
        return m, x.var(ddof=1)/(n*m*m) if m > 0 else np.nan, events
    if kind == 'ratio':
        a, b = col['cost'], col['principal']
        r = a.sum()/b.sum()
        return r, np.var(a-r*b, ddof=1)/(n*b.mean()**2*r*r), n
    if kind == 'prob':
        x = (col['loss'] > 0).astype(float)
        return x.mean(), x.var(ddof=1)/n, int(x.sum())
    if kind == 'node':
        a, b = col['num'+key], col['den'+key]
        p = a.sum()/b.sum()
        return p, np.var(a-p*b, ddof=1)/(n*b.mean()**2), int(a.sum())
    if kind == 't1':
        x = col['t1'][~np.isnan(col['t1'])]
        if len(x) < 2:
            return np.nan, np.nan, len(x)
        return x.mean(), x.var(ddof=1)/(len(x)*x.mean()**2), len(x)
    x = col['loss']
    value = es95(x)
    boots = np.array([es95(x[rng.integers(0, n, n)]) for _ in range(BOOT)])
    boots = boots[boots > 0]
    return value, np.log(boots).var(ddof=1) if value > 0 and len(boots) > 1 else np.nan, int((x > 0).sum())


def metrics():
    rows = [('debt_time', 'mean', 'debt_time', REL), ('loss_mean', 'mean', 'loss', REL),
            ('any_loss', 'prob', None, ABS), ('borrower_cost_per_dollar', 'ratio', None, REL),
            ('time_to_first_liquidation', 't1', None, REL), ('loss_es95', 'es', None, ES_REL)]
    rows += [(f'liquidations_{k}', 'mean', k, REL) for k in (*CHANNELS, 'soft', 'hard')]
    rows += [(f'liquidated_before_expiry_{n}', 'node', n, ABS) for n in NODES]
    return rows


def relative(kind):
    return kind in ('mean', 'ratio', 't1', 'es')


def cell_effects(ref, ada, kind, key, rng):
    """Per-cell (theta, se, events_ref, events_ada) for eligible cells."""
    out = {}
    for cell in sorted(set(ref) & set(ada)):
        (vr, sr, er), (va, sa, ea) = (estimate(kind, columns(d[cell]), key, rng) for d in (ref, ada))
        if relative(kind):
            if not (vr > 0 and va > 0):
                continue
            theta = math.log(va/vr)
        else:
            theta = va-vr
        se = math.sqrt(sr+sa)
        if np.isfinite(se) and se > 0:
            out[cell] = dict(theta=theta, se=se, events_ref=er, events_ada=ea, ref=vr, ada=va)
    return out


def tost(theta, se, delta):
    lower, upper = norm.sf((theta+delta)/se), norm.sf((delta-theta)/se)
    return float(max(lower, upper))


def pooled(effects, delta, counts_events):
    if not effects:
        return dict(status='untested', reason='no eligible cells')
    t = np.array([e['theta'] for e in effects.values()])
    w = 1/np.array([e['se'] for e in effects.values()])**2
    theta, se = float((w*t).sum()/w.sum()), float(1/math.sqrt(w.sum()))
    q = float((w*(t-theta)**2).sum())
    events = [sum(e['events_ref'] for e in effects.values()), sum(e['events_ada'] for e in effects.values())]
    row = dict(cells=len(effects), theta=theta, se=se, margin=delta, events=events,
               ci90=[theta-norm.ppf(.95)*se, theta+norm.ppf(.95)*se], tost_p=tost(theta, se, delta),
               cochran_q=q, cochran_p=float(chi2.sf(q, len(effects)-1)) if len(effects) > 1 else None)
    if counts_events and min(events) < MIN_EVENTS:
        row['status'] = 'untested'
        row['reason'] = f'fewer than {MIN_EVENTS} events in an engine'
    else:
        row['status'] = 'equivalent' if row['tost_p'] < ALPHA else 'not_shown'
    return row


def primary(ref, ada, seed=2026):
    rng, family, secondary = np.random.default_rng(seed), {}, {}
    for name, kind, key, delta in metrics():
        effects = cell_effects(ref, ada, kind, key, rng)
        family[name] = pooled(effects, delta, name not in ('debt_time', 'borrower_cost_per_dollar'))
        secondary[name] = {c: dict(e, tost_p=tost(e['theta'], e['se'], delta),
                                   ci90=[e['theta']-1.645*e['se'], e['theta']+1.645*e['se']])
                           for c, e in effects.items()}
    return family, secondary


def round_relative(x, digits=KS_AD_DIGITS):
    """Correctly rounded to `digits` significant digits (error at most 0.5 10^(1-digits) relative); 0 keeps all."""
    x = np.asarray(x, float)
    return x if digits == 0 else np.array([float(f'{v:.{digits-1}e}') for v in x])


def samples(rows, which, digits=KS_AD_DIGITS):
    col = columns(rows)
    if which == 'debt_time':
        return round_relative(col['debt_time'], digits)
    if which == 't1':
        return round_relative(col['t1'][~np.isnan(col['t1'])], digits)
    return round_relative(col['loss'][col['loss'] > 0], digits)


def anderson(x, y, rng):
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        return float(anderson_ksamp([x, y], method=PermutationMethod(n_resamples=9999, random_state=rng)).pvalue)


def difference(ref, ada, family, seed=2027, digits=KS_AD_DIGITS):
    rng, tests = np.random.default_rng(seed), []
    for cell in sorted(set(ref) & set(ada)):
        for which in ('debt_time', 't1', 'positive_loss'):
            x, y = samples(ref[cell], which, digits), samples(ada[cell], which, digits)
            if min(len(x), len(y)) < MIN_SAMPLE:
                continue
            tests.append(dict(test='KS', cell=cell, quantity=which, p=float(ks_2samp(x, y).pvalue)))
            tests.append(dict(test='AD', cell=cell, quantity=which, p=anderson(x, y, rng)))
    for name, row in family.items():
        if row['status'] != 'untested' and row.get('cochran_p') is not None:
            tests.append(dict(test='CochranQ', cell='all', quantity=name, p=row['cochran_p']))
    adjusted, reject = holm([t['p'] for t in tests]) if tests else ([], [])
    for t, a, r in zip(tests, adjusted, reject):
        t.update(holm_p=a, significant=r)
    return tests


def required(kind, values, cells):
    """Paths per engine per cell for 99% power of the pooled TOST at a true difference of zero."""
    if not values:
        return None
    if kind in ('prob', 'node'):
        return math.ceil(2*Z**2*float(np.median(values))/(ABS**2*cells))
    delta = ES_REL if kind == 'es' else REL
    return math.ceil(2*Z**2*float(np.median(values))/(delta**2*cells))


def pilot_spread(rows, kind, key, rng):
    """Per-path variance on the compared scale (CV^2 or p(1-p)), from one engine-cell pilot."""
    value, variance, _ = estimate(kind, columns(rows), key, rng)
    return variance*len(rows) if np.isfinite(variance) and value > 0 else None


def plan(ref, ada, ref_cost, budget_h=120.):
    rng, cells = np.random.default_rng(2028), sorted(set(ref) & set(ada))
    per_path = {c: sum(k['cpu_s'] for k in ref_cost[c])/sum(k['paths'] for k in ref_cost[c]) for c in cells}
    n_budget = int(budget_h*3600/sum(per_path.values()))
    needs = {}
    for name, kind, key, _ in metrics():
        spread = [s for d in (ref, ada) for c in cells if (s := pilot_spread(d[c], kind, key, rng)) is not None]
        needs[name] = required(kind, spread, len(cells))
    want = max(v for v in needs.values() if v is not None)
    n = int(8*math.ceil(min(want, n_budget)/8))
    return dict(cells=cells, reference_cpu_s_per_path=per_path, budget_cpu_h=budget_h, n_budget=n_budget,
                n_required=needs, n=n, underpowered=sorted(k for k, v in needs.items() if v is None or v > n),
                stop=n_budget < 100,
                note='CV^2 or p(1-p) is the median across engine-cells of the pilot; '
                     'metrics without a pilot estimate are listed as underpowered')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('plan', 'analyze'))
    parser.add_argument('--reference', nargs='+', required=True)
    parser.add_argument('--adaptive', nargs='+', required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--ks-ad-digits', type=int, default=KS_AD_DIGITS,
                        help='significant digits of KS/AD inputs; 0 reproduces the pre-amendment analysis')
    args = parser.parse_args()
    phase = 'pilot' if args.mode == 'plan' else 'main'
    (ref, ref_cost), (ada, _) = load(args.reference, phase), load(args.adaptive, phase)
    if not set(ref) & set(ada):
        parser.error('no common cells between the engines')
    if args.mode == 'plan':
        result = plan(ref, ada, ref_cost)
    else:
        family, secondary = primary(ref, ada)
        tests = difference(ref, ada, family, digits=args.ks_ad_digits)
        tested = [r for r in family.values() if r['status'] != 'untested']
        result = dict(paths={c: [len(ref[c]), len(ada.get(c, []))] for c in ref}, primary=family,
                      joint_equivalence=bool(tested) and all(r['status'] == 'equivalent' for r in tested),
                      primary_holm=dict(zip([k for k, r in family.items() if r['status'] != 'untested'],
                                            holm([r['tost_p'] for r in tested])[0] if tested else [])),
                      difference=tests, difference_fail=any(t['significant'] for t in tests), ks_ad_digits=args.ks_ad_digits,
                      secondary=secondary)
    args.out.write_text(json.dumps(result, indent=2, default=float)+'\n')
    print(json.dumps({k: v for k, v in result.items() if k in ('n', 'n_budget', 'underpowered', 'stop',
                                                               'joint_equivalence', 'difference_fail')}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
