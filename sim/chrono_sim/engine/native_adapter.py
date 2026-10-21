"""Python batch setup and I5 collection around the native event loop."""
import os
import numpy as np
import time
from numba.typed import List
from chrono_sim.oracle.pyth_model import OracleModel, OracleConfig
from chrono_sim.protocol.fast.state import clone
from chrono_sim.protocol.fast.math import WAD
from .agents import CapRoller
from .records import RecordBook, PathRecords
from .native_loop import run_batch, TAPE_TYPE
from .native_windows import bounds
from .native_oracle import NativeOracle
from .conservation import scan

# Debug: also run the full numpy conservation check every N checked actions (0 = path end only).
FULL_CHECK_EVERY = int(os.environ.get('CHRONO_I5_FULL_CHECK_EVERY', '0'))


def timing(loop, name, start):
    if not hasattr(loop, 'phase_cpu_s'):
        loop.phase_cpu_s = {}
    loop.phase_cpu_s[name] = loop.phase_cpu_s.get(name, 0.)+time.process_time()-start


def inputs(loop, e, holders, rng, horizon):
    n = len(holders)
    data, params, terms = np.zeros((n, 12)), np.zeros((n, 64)), np.zeros((n, 8))
    draws = []
    for i, h in enumerate(holders):
        c, d = e.tokens.index(h.coll), e.tokens.index(h.debt)
        cfg, dc = e.state.cfg[c], e.state.cfg[d]
        pair = loop.pairs.get((h.coll, h.debt))
        lam = pair.lam if loop.switches.pair_config and loop.model.time_free else .75
        mult, maxconf = (pair.extra.get('conf_multiplier', 1.), pair.extra.get('max_open_conf_ratio', .02)) if pair else (1., .02)
        data[i] = c, d, h.collateral, h.term_s, h.u, h.lead_s, h.rho_miss, h.opened_at, isinstance(h, CapRoller), lam, mult, maxconf
        hrng = np.random.default_rng(int(rng.integers(0, 2**63-1)))
        count = 1+int(max(0., horizon-h.opened_at)/(h.term_s-h.lead_s)) if isinstance(h, CapRoller) else 1
        draws.append(hrng.random(count))
        if loop.switches.pair_config:
            loop.model.validate(pair)
            p = e.risk_model.kernel_params(pair)
            params[i, :len(p)] = p
            terms[i] = pair.bonus*WAD, pair.close_factor*WAD, pair.hard_penalty*WAD, pair.hard_floor*WAD, pair.sp_share*WAD, pair.lam*WAD, pair.min_T_s, pair.max_T_s
        else:
            params[i, :6] = cfg[0]/WAD, cfg[1]/WAD, cfg[2]/WAD, cfg[5]/WAD, cfg[6]/WAD, cfg[7]/WAD
            terms[i] = cfg[3], dc[4], dc[8], dc[9], dc[10], .88*WAD, cfg[12], cfg[13]
    uniforms = np.zeros((n, max(map(len, draws))))
    for i, values in enumerate(draws):
        uniforms[i, :len(values)] = values
    settings = np.array([horizon, e.base, loop.keeper.latency_s, loop.cfg.hss_delay_s, e.hss_capacity, loop.max_conf])
    return data, uniforms, params, terms, settings


def full_check(e, worst, k):
    """The old full check on the replayed state; it can never exceed the incremental maximum."""
    error = e.check_conservation()
    if error > worst:
        raise AssertionError(f'incremental conservation scan missed error {error} by logged action {k}')


def collect(path, e, initial, grid, horizon, holders, logs, cfg):
    worst, bad, error, checks = scan(logs, initial.positions, e.initial_tokens, e.switches.fix_debt_accounting)
    if bad >= 0:
        raise AssertionError(f'token conservation error {error} at logged action {bad}')
    final, e.state = e.state, initial
    book = RecordBook(path, e, cfg.impact, cfg.basis, cfg.reserve_reimburses, grid)
    before = clone(initial)
    actions = {2: 'repay', 3: 'softLiquidate', 4: 'scheduled', 5: 'scheduled'}
    s = e.state
    done = 0
    for k, (kind, i, h, p, q, b0, b1, lp0, lp1, flows, prices, now) in enumerate(logs):
        if kind == 7:
            book.stopped(i, 'collateral_exhausted')
            continue
        before.positions[i], before.balances[:], before.lp[:] = p, b0, lp0
        before.prices[:], before.meta[0] = prices, now
        s.positions[i], s.balances[:], s.lp[:] = q, b1, lp1
        s.flows[:], s.prices[:], s.meta[0] = flows, prices, now
        if kind == 1:
            debt = int(q[6])
            sp, reserve = flows[debt, 1, -3], flows[debt, 1, 0]
            e.open_premiums[str(i+1)] = sp+reserve, sp
            book.opened(i, holders[h].strategy)
        else:
            book.observe(before, actions[kind], i)
        done += 1
        if FULL_CHECK_EVERY and done % FULL_CHECK_EVERY == 0:
            full_check(e, worst, k)
    if checks:
        full_check(e, worst, len(logs)-1)
    e.max_conservation_error = max(e.max_conservation_error, worst)
    e.state = final
    return book.finish(horizon)


def setup(loop, batch, holders, path, stream, oracle_rng):
    refine_rng, agent_rng = [np.random.default_rng(int(x)) for x in stream[:2]]
    orng = np.random.default_rng(int(stream[2])) if oracle_rng is None else oracle_rng
    start = time.process_time()
    fine = loop.prepare(batch, path, holders, refine_rng)
    timing(loop, 'prepare', start)
    start = time.process_time()
    oracle = NativeOracle(fine, loop.cfg.oracle or OracleConfig(), orng)
    timing(loop, 'oracle', start)
    start = time.process_time()
    e = loop.make_engine(fine, holders)
    initial = clone(e.state)
    data = inputs(loop, e, holders, agent_rng, float(fine.t[-1]))
    clock = np.unique(np.r_[fine.t, np.ceil(fine.t/oracle.cfg.cadence_s-1e-12)*oracle.cfg.cadence_s])
    sigma = loop.cfg.sigma_per_s or tuple(.8/np.sqrt(31536000.) for _ in batch.assets)
    windows = bounds(batch, path, sigma)
    timing(loop, 'setup', start)
    return (e.state, *data, clock, oracle._history[0], windows), (path, e, initial, fine, oracle)


def run(loop, batch, holders, streams, oracle_rng):
    results = []
    # Bound resident prepared paths as well as state; 1000 remains the short-cell default.
    estimated = len(batch.t)*max(1., float(np.max(np.diff(batch.t), initial=1.)))*len(batch.assets)*80
    size = min(loop.cfg.batch_size, max(1, int(8*1024**3/max(1., estimated))))
    loop.effective_batch_size = size
    for first in range(0, len(streams), size):
        jobs, tapes, prepared = List(), List(), []
        for path in range(first, min(first+size, len(streams))):
            job, item = setup(loop, batch, holders, path, streams[path], oracle_rng)
            jobs.append(job)
            tapes.append(List.empty_list(TAPE_TYPE))
            prepared.append(item)
        stats = np.zeros((len(jobs), 3), np.int64)
        e = prepared[0][1]
        start = time.process_time()
        run_batch(jobs, tapes, stats, e.open_nb, e.threshold_nb)
        timing(loop, 'native_loop', start)
        loop.stats['events'] += int(stats[:, 0].sum())
        loop.stats['reverts'] += int(stats[:, 1].sum())
        loop.path_reverts = [*getattr(loop, 'path_reverts', []), *map(int, stats[:, 1])]  # per path, in path order
        loop.stats['paths'] += len(jobs)
        loop.native_skipped_events = getattr(loop, 'native_skipped_events', 0)+int(stats[:, 2].sum())
        start = time.process_time()
        for (path, e, initial, fine, oracle), tape in zip(prepared, tapes):
            grid = fine.t, oracle.prices_on_grid()
            results.append(collect(path, e, initial, grid, float(fine.t[-1]), holders, tape, loop.cfg))
        timing(loop, 'records', start)
    return PathRecords.concat(results)
