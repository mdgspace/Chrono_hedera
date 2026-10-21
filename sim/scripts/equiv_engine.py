"""P3c pre-registered equivalence runs: P3b reference engine or adaptive engine, per cell.

Writes one JSON line per path (path-level quantities of P3C_METHOD.md section 10) and a
cost line per chunk under CHRONO_RESULTS_DIR (or --out). Workers are single-threaded processes.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import sys
import time

if __name__ in ('__main__', '__mp_main__'):
    # Single-threaded worker processes; never set when imported (numba rereads it at every compile).
    os.environ['NUMBA_NUM_THREADS'] = '1'
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
YEAR = 31536000.
HORIZON = 30*86400.+1000.
NODES = (3600., 21600., 86400., 259200., 604800., 1209600., 2592000.)
MARKETS = {'MK1': dict(assets=('HBAR', 'USDC'), initial_price=[2., 1.], sigma=[.6, 0.]),
           'MK3': dict(assets=('HBAR', 'USDC'), initial_price=[2., 1.], sigma=[.6, 0.],
                       jump_rate=[20., 0.], down_probability=.6, eta_down=12., eta_up=15.)}
MODELS, BOOKS, LTVS = ('S1', 'B0_cap', 'SPEC'), (10, 100), {'base': .8, 'stressed': .98}


def cells(models=MODELS, switch='m0'):
    return [dict(market=m, model=k, book=b, ltv=l, switches=switch) for m in MARKETS for k in models
            for b in BOOKS for l in LTVS]


def switches(name):
    """m0: all six M0 fixes; as_coded: m0 with fix_final_hour off, so health reverts when T_rem < min duration."""
    from dataclasses import replace
    from chrono_sim.protocol.ref.switches import Switches
    return {'m0': Switches.m0(), 'as_coded': replace(Switches.m0(), fix_final_hour=False)}[name]


def cell_id(c):
    return f"{c['market']}-{c['model']}-{c['book']}-{c['ltv']}"


def seed(*parts):
    # Model identity is deliberately excluded so models share market draws (design 13.2).
    return int.from_bytes(hashlib.sha256('|'.join(map(str, ('P3c-equiv',)+parts)).encode()).digest()[:8], 'little') >> 1


def holders(book, u, coll='HBAR', collateral=100.):
    from chrono_sim.engine import Holder
    return [Holder(coll, 'USDC', collateral=collateral, term_s=NODES[i % len(NODES)], u=u, rho_miss=.1) for i in range(book)]


def make_loop(c, engine, sigma=.6):
    """c['pair'] (default HBAR_USDC) names configs/pairs/<pair>.yaml and the (collateral, debt) assets."""
    from chrono_sim.engine import EventLoop, LoopConfig, Keeper
    from chrono_sim.models import REGISTRY
    from chrono_sim.models.config import load_pair
    pair = c.get('pair', 'HBAR_USDC')
    cfg = LoopConfig(hss_capacity=2000, sigma_per_s=(sigma/np.sqrt(YEAR), 0.), sp_deposit=50.*c['book'],
                     batch_size=1, native=engine == 'reference', adaptive=engine == 'adaptive')
    return EventLoop(REGISTRY[c['model']](), {tuple(pair.split('_')): load_pair(c['model'], pair)},
                     switches(c.get('switches', 'm0')), cfg, Keeper(1.))


def market(c, engine, n, key):
    from chrono_sim.market import gbm, jumpdiff
    if engine == 'adaptive':
        from chrono_sim.market.coarse import AdaptiveMarket
        params = (jumpdiff.KouParams if c['market'] == 'MK3' else gbm.GBMParams).model_validate(MARKETS[c['market']])
        return AdaptiveMarket(params, n, HORIZON)
    module = jumpdiff if c['market'] == 'MK3' else gbm
    return module.generate(MARKETS[c['market']], n, HORIZON, 60., np.random.default_rng(key))


def summarise(records, first_id):
    import polars as pl
    rows = []
    for path, frame in records.positions.group_by('path_id', maintain_order=True):
        p = records.paths.filter(pl.col('path_id') == path[0])
        liq = frame['first_liquidation_at'] >= 0
        early = liq & (frame['first_liquidation_at'] < frame['opened_at']+frame['term_s'])
        nodes = {str(int(n)): [int((early & (frame['term_s'] == n)).sum()), int((frame['term_s'] == n).sum())]
                 for n in NODES}
        times = frame.filter(liq)['first_liquidation_at']
        loss = {str(int(n)): float(frame.filter(frame['term_s'] == n)['lender_loss'].sum()) for n in NODES}
        rows.append(dict(path=first_id+int(path[0]), debt_time=p['debt_time_integral'].item(),
                         soft_sp=int(frame['soft_sp'].sum()), soft_external=int(frame['soft_external'].sum()),
                         hard_sp=int(frame['hard_sp'].sum()), hard_reserve=int(frame['hard_reserve'].sum()),
                         loss=float(frame['lender_loss'].sum()), cost=float(frame['borrower_cost'].sum()),
                         principal=float(frame['principal_usd'].sum()), opened=len(frame),
                         first_liquidation=float(times.min()) if len(times) else None, nodes=nodes, loss_by_term=loss,
                         conservation=p['conservation_error'].item()))
    return rows


def task(args):
    c, engine, phase, chunk, size, out, horizon, rerun = args
    global HORIZON
    HORIZON = horizon
    target = Path(out)/cell_id(c)/f'{phase}-{chunk:05d}.jsonl'
    if target.exists():
        return str(target)
    # A rerun after a fix draws fresh seeds (P3C_METHOD.md section 10); the first run has no tag.
    key = seed(engine, phase+rerun, c['market'], c['book'], c['ltv'], chunk)
    loop = make_loop(c, engine)
    cpu, wall = time.process_time(), time.perf_counter()
    batch = market(c, engine, size, key)
    generated = time.process_time()-cpu
    records = loop.run(batch, holders(c['book'], LTVS[c['ltv']]), np.random.default_rng(key+1))
    rows = summarise(records, chunk*size)
    for row, reverts in zip(rows, getattr(loop, 'path_reverts', [])):
        row['reverts'] = reverts  # reverted protocol calls of every kind on this path (reference engine only)
    cost = dict(chunk=chunk, paths=size, cpu_s=time.process_time()-cpu, wall_s=time.perf_counter()-wall,
                market_cpu_s=generated, phase_cpu_s=getattr(loop, 'phase_cpu_s', {}), stats=loop.stats,
                host=platform.node())
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix('.tmp')
    plain = lambda o: o.item()  # numpy scalars in engine stats under JIT
    temp.write_text(''.join(json.dumps(r, default=plain)+'\n' for r in rows)+json.dumps(dict(cost=cost), default=plain)+'\n')
    temp.replace(target)
    return str(target)


def warm(c, engine):
    """Compile the engine on a one-hour slice before timing (per worker process)."""
    global HORIZON
    saved, HORIZON = HORIZON, 3600.
    try:
        make_loop(c, engine).run(market(c, engine, 1, 7), holders(2, .98), np.random.default_rng(7))
    finally:
        HORIZON = saved


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine', choices=('reference', 'adaptive'), required=True)
    parser.add_argument('--phase', choices=('pilot', 'main'), required=True)
    parser.add_argument('--paths', type=int, required=True)
    parser.add_argument('--chunk', type=int, default=2)
    parser.add_argument('--workers', type=int, default=8)
    parser.add_argument('--cells', nargs='*', default=None)
    parser.add_argument('--out', type=Path, default=None)
    parser.add_argument('--horizon', type=float, default=HORIZON, help='smoke tests only')
    parser.add_argument('--rerun', default='', help='seed tag for a rerun after a fix, for example -r2')
    parser.add_argument('--reverse', action='store_true', help='last chunk first (a helper job meeting a forward run)')
    parser.add_argument('--models', nargs='+', default=list(MODELS), help='risk models, for example NEG')
    parser.add_argument('--switches', choices=('m0', 'as_coded'), default='m0')
    parser.add_argument('--part', default=None, help='J/K: chunk-major order, only chunks k with k %% K == J '
                        '(K jobs then grow every cell together, so a budget stop leaves equal path counts)')
    args = parser.parse_args()
    if args.paths % args.chunk:
        parser.error('paths must be a multiple of chunk')
    out = args.out or Path(os.environ.get('CHRONO_RESULTS_DIR', ROOT/'results/P3C_equiv_local'))
    chosen = [c for c in cells(args.models, args.switches) if args.cells is None or cell_id(c) in args.cells]
    jobs = [(c, args.engine, args.phase, k, args.chunk, str(out), args.horizon, args.rerun) for c in chosen
            for k in range(args.paths//args.chunk)]
    if args.part:
        j, k = map(int, args.part.split('/'))
        jobs = sorted((x for x in jobs if x[3] % k == j), key=lambda x: x[3])
    if args.reverse:
        jobs.reverse()
    # Helper jobs on a subset of cells keep the full run's plan.json intact.
    name = f"plan-part{args.part.replace('/', 'of')}.json" if args.part else 'plan.json' if args.cells is None else f"plan-{'-'.join(cell_id(c) for c in chosen)}{'-rev' if args.reverse else ''}.json"
    (out/name).parent.mkdir(parents=True, exist_ok=True)
    (out/name).write_text(json.dumps(dict(vars(args), out=str(out), cells=[cell_id(c) for c in chosen],
                                                 jobs=len(jobs)), default=str, indent=2)+'\n')
    if args.workers == 1:
        warm(chosen[0], args.engine)
        done = [task(j) for j in jobs]
    else:
        from multiprocessing import get_context
        with get_context('spawn').Pool(args.workers, initializer=warm, initargs=(chosen[0], args.engine)) as pool:
            done = list(pool.imap_unordered(task, jobs))
    print(json.dumps(dict(status='complete', files=len(done))), flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
