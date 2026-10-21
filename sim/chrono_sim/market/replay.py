"""MK7 ordered observed crash replay and explicit origination-cohort hooks."""

from pathlib import Path
import numpy as np
from pydantic import ConfigDict
from .common import MarketParams, clock, seed_info
from .history import load_snapshot, DataUnavailable
from .pathbatch import PathBatch


class ReplayParams(MarketParams):
    model_config = ConfigDict(extra='forbid', arbitrary_types_allowed=True)
    times_s: np.ndarray | None = None
    prices: np.ndarray | None = None  # [assets, observations]
    lows: np.ndarray | None = None
    confidence: np.ndarray | None = None
    data_root: str = str(Path.home()/'chrono-sim/data')
    manifest: str = 'data_manifests/snapshot_v1.json'
    venue: str = 'proxy'
    interval: str = '1s'
    start_ns: int | None = None
    end_ns: int | None = None
    crash_at_s: float = 0.
    prefix: PathBatch | None = None


def cohort_placements(crash_at_s, leads_s):
    """Absolute origination instants for cohorts up to sixty days before crash."""
    leads = np.asarray(leads_s, dtype=float)
    if not np.isfinite(leads).all() or np.any(leads < 0) or np.any(leads > 60*86400):
        raise ValueError('cohort leads must lie in [0, 60 days]')
    return crash_at_s-leads


def _observations(params):
    if params.times_s is None:
        if params.venue != 'proxy':
            raise DataUnavailable('exact USD replay requires observed USD composites; raw quote candles need USD anchoring')
        t, p, low, conf, lineage = load_snapshot(params.data_root, params.manifest, params.assets,
            params.interval, params.venue, params.start_ns, params.end_ns)
        t = (t-t[0])/1e9
    else:
        t, p = np.asarray(params.times_s, dtype=float), np.asarray(params.prices, dtype=float)
        low = p.copy() if params.lows is None else np.asarray(params.lows, dtype=float)
        conf = np.full_like(p, params.conf_c0) if params.confidence is None else np.asarray(params.confidence, dtype=float)
        lineage = {'source': 'provided_observed_replay'}
    if t.ndim != 1 or len(t) < 2 or t[0] != 0 or not np.all(np.diff(t) == 1):
        raise DataUnavailable('exact MK7 requires contiguous observed one-second prices')
    if p.shape != (len(params.assets), len(t)) or low.shape != p.shape or conf.shape != p.shape:
        raise ValueError('replay arrays must have shape [assets, observations]')
    if any(not np.isfinite(x).all() for x in (p, low, conf)) or np.any(low <= 0) or np.any(low > p) or np.any(conf < 0):
        raise ValueError('invalid replay prices, lows or confidence')
    return t, np.log(p), np.log(low), conf, lineage


def generate(params, n_paths, horizon_s, dt_s, rng):
    params = params if isinstance(params, ReplayParams) else ReplayParams.model_validate(params)
    clock(n_paths, horizon_s, dt_s)
    info = seed_info(rng)
    t, p, low, conf, lineage = _observations(params)
    offset = params.crash_at_s
    if offset < 0 or not np.isfinite(offset) or horizon_s-offset > t[-1] or horizon_s <= offset:
        raise ValueError('requested horizon is outside the observed replay')
    select = t+offset <= horizon_s
    t, p, low, conf = t[select]+offset, p[:, select], low[:, select], conf[:, select]
    if t[-1] != horizon_s:
        raise ValueError('replay horizon must land on an observed second')
    broadcast = lambda a: np.broadcast_to(a, (n_paths, *a.shape)).copy()
    p, low, conf = broadcast(p), broadcast(low), broadcast(conf)
    if offset:
        pre = params.prefix
        if pre is None or pre.assets != params.assets or pre.log_price.shape[0] != n_paths or pre.t[-1] != offset:
            raise ValueError('cohort placement requires an aligned MK6 prefix ending at crash_at_s')
        # Preserve absolute crash observations; scale only the bootstrap prefix at the seam.
        shift = p[:, :, :1]-pre.log_price[:, :, -1:]
        p = np.concatenate([pre.log_price[:, :, :-1]+shift, p], axis=2)
        low = np.concatenate([pre.bar_low[:, :, :-1]+shift, low], axis=2)
        low[:, :, len(pre.t)-1] = pre.bar_low[:, :, -1]+shift[:, :, 0]
        conf = np.concatenate([pre.conf_frac[:, :, :-1], conf], axis=2)
        t = np.r_[pre.t[:-1], t]
    low[:, :, 0] = p[:, :, 0]
    info.update(generator='MK7', source=lineage, crash_at_s=offset,
                prefix_seed_info=params.prefix.seed_info if params.prefix else None)
    mask, regime = np.zeros_like(p, dtype=bool), np.zeros((n_paths, len(t)), dtype=np.int8)
    if offset:
        mask[:, :, :len(params.prefix.t)] = params.prefix.jump_mask
        regime[:, :len(params.prefix.t)] = params.prefix.regime
    return PathBatch(t, params.assets, p, low, conf, mask, regime, info)
