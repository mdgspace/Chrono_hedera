"""Python setup and I5 collection around the adaptive native loop."""
import time
import numpy as np
from numba.typed import List
from chrono_sim.market.coarse import AdaptiveMarket, exposure_grid
from chrono_sim.market.pathbatch import PathBatch
from chrono_sim.oracle.pyth_model import OracleConfig, _availability
from chrono_sim.protocol.fast.state import clone
from .native_adapter import inputs, collect, timing
from .native_loop import TAPE_TYPE
from .adaptive_loop import run_batch
from .adaptive_view import make_view, N_COUNTERS

# Band oracle counters: runs decided by the strip series, continuous exits sampled, forward steps;
# doomed_retries: soft liquidations proved to revert and not executed; fast_forwarded: those of them
# run by the chain fast-forward without the event loop.
COUNTERS = ('segments_refined', 'pieces_refined', 'tapes_built', 'oracle_reads', 'windows_visited',
            'band_runs', 'band_exits', 'band_steps', 'scans', 'doomed_retries', 'fast_forwarded')


def validate(loop, market, holders):
    if not isinstance(market, AdaptiveMarket):
        raise ValueError('the adaptive engine consumes an AdaptiveMarket')
    for h in holders:
        if h.coll not in market.assets or h.debt not in market.assets or not 0 <= h.opened_at <= market.horizon_s:
            raise ValueError('holder assets and opening times must lie in the market')
    cfg = loop.cfg.oracle or OracleConfig()
    H, c = cfg.heartbeat_s, cfg.cadence_s
    if H != int(H) or c > 1 or abs(round(H/c)*c-H) > 1e-9:
        raise ValueError('adaptive oracle needs an integral heartbeat that is a multiple of cadence <= 1 s')
    if market.coarse_dt_s % H:
        raise ValueError('coarse step must be a multiple of the heartbeat')
    return cfg


def roles(market, holders):
    collateral = {h.coll for h in holders}
    return np.array([1. if a in collateral else -1. for a in market.assets])


def stub(market):
    """Two-knot batch carrying only what make_engine reads: assets, opening prices, horizon."""
    x = market.arrays()[0]
    p = np.repeat(x[None, :, None], 2, axis=2)
    return PathBatch(np.array([0., market.horizon_s]), market.assets, p, p.copy(), np.zeros_like(p),
                     np.zeros_like(p, bool), np.zeros((1, 2), np.int8), {})


def setup(loop, market, holders, path, stream, oracle_rng, cfg, role, stable):
    start = time.process_time()
    coarse = market.path(int(stream[0]), role)
    timing(loop, 'generation', start)
    start = time.process_time()
    orng = np.random.default_rng(int(stream[2])) if oracle_rng is None else oracle_rng
    changes, up = _availability(market.horizon_s, cfg, orng)
    sig = market.arrays()[1]
    settings = np.array([cfg.heartbeat_s, market.coarse_dt_s, cfg.cadence_s, cfg.deviation, market.horizon_s,
                         float(getattr(loop, 'exhaustive_scan', False)), market.params.conf_c0,
                         market.params.conf_c2, float(getattr(loop, 'exhaustive_oracle', False))])
    view = make_view(coarse, role, sig, stable, settings, int(stream[0]), changes, up)
    e = loop.make_engine(stub(market), holders)
    initial = clone(e.state)
    data = inputs(loop, e, holders, np.random.default_rng(int(stream[1])), float(market.horizon_s))
    grid = exposure_grid(coarse, sig, stable)
    timing(loop, 'setup', start)
    return (e.state, *data, view), (path, e, initial, grid, view)


def run(loop, market, holders, streams, oracle_rng):
    cfg = validate(loop, market, holders)
    role, stable = roles(market, holders), market.stable()
    results, counters = [], np.zeros(N_COUNTERS, np.int64)
    for first in range(0, len(streams), loop.cfg.batch_size):
        jobs, tapes, prepared = List(), List(), []
        for path in range(first, min(first+loop.cfg.batch_size, len(streams))):
            job, item = setup(loop, market, holders, path, streams[path], oracle_rng, cfg, role, stable)
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
        loop.stats['paths'] += len(jobs)
        start = time.process_time()
        for (path, e, initial, grid, view), tape in zip(prepared, tapes):
            results.append(collect(path, e, initial, grid, float(market.horizon_s), holders, tape, loop.cfg))
            counters += view.counters
        timing(loop, 'records', start)
    loop.adaptive_counters = dict(zip(COUNTERS, map(int, counters)))
    from .records import PathRecords
    return PathRecords.concat(results)
