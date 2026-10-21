"""I3 causal publications and keeper pushes, initialised with a stored t=0 quote."""

import heapq
import numpy as np
from pydantic import BaseModel, ConfigDict, Field
from chrono_sim.market.pathbatch import PathBatch


class OracleConfig(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    heartbeat_s: float = Field(default=60., gt=0)
    deviation: float = Field(default=.005, ge=0)
    cadence_s: float = Field(default=.4, gt=0)
    staleness_s: float = Field(default=120., ge=0)
    keeper_uptime: float = Field(default=1., ge=0, le=1)
    outage_mean_s: float = Field(default=60., gt=0)


def _availability(horizon, cfg, rng):
    """Stationary alternating exponential availability; one keeper per path."""
    if cfg.keeper_uptime in (0., 1.):
        return np.array([0.]), np.array([cfg.keeper_uptime == 1])
    up = rng.random() < cfg.keeper_uptime
    times, states, now = [0.], [up], 0.
    while now < horizon:
        mean = cfg.outage_mean_s * cfg.keeper_uptime/(1-cfg.keeper_uptime) if up else cfg.outage_mean_s
        now += rng.exponential(mean)
        up = not up
        times.append(now)
        states.append(up)
    return np.asarray(times), np.asarray(states)


class OracleModel:
    def __init__(self, batch: PathBatch, cfg: OracleConfig, rng):
        self.batch = batch
        self.cfg = cfg if isinstance(cfg, OracleConfig) else OracleConfig.model_validate(cfg)
        self._history = [self._path(path, rng) for path in range(batch.log_price.shape[0])]

    def _path(self, path, rng):
        b, cfg = self.batch, self.cfg
        changes, up = _availability(b.t[-1], cfg, rng)
        # Each source quote becomes available at the first cadence at or after observation.
        pub = np.ceil(b.t/cfg.cadence_s - 1e-12)*cfg.cadence_s
        queue = list(np.unique(np.r_[0., pub, np.ceil(changes/cfg.cadence_s)*cfg.cadence_s]))
        heapq.heapify(queue)
        ticks = []
        prices, confs, published = [], [], []
        stored = np.exp(b.log_price[path, :, 0])
        conf = stored*b.conf_frac[path, :, 0]
        stamp = np.zeros(len(b.assets))
        last_push = np.zeros(len(b.assets))
        while queue:
            now = heapq.heappop(queue)
            if now > b.t[-1]:
                break
            if ticks and now <= ticks[-1]:
                continue
            ticks.append(now)
            source = max(0, np.searchsorted(pub, now+1e-12, side='right')-1)
            latest = np.exp(b.log_price[path, :, source])
            available = up[np.searchsorted(changes, now, side='right')-1]
            due = (now-last_push >= cfg.heartbeat_s-1e-12) | (np.abs(latest/stored-1) >= cfg.deviation)
            push = due & available
            stored = np.where(push, latest, stored)
            conf = np.where(push, latest*b.conf_frac[path, :, source], conf)
            stamp = np.where(push, now, stamp)
            last_push = np.where(push, now, last_push)
            if np.any(push) or now == 0:
                due_time = np.ceil((now+cfg.heartbeat_s)/cfg.cadence_s-1e-12)*cfg.cadence_s
                heapq.heappush(queue, due_time)
            prices.append(stored.copy()); confs.append(conf.copy()); published.append(stamp.copy())
        return np.asarray(ticks), np.asarray(prices).T, np.asarray(confs).T, np.asarray(published).T

    def stored(self, path: int, asset: str, now_s: float) -> tuple[float, float, float]:
        """On-chain (price, absolute confidence, publication time); caller checks age."""
        if not np.isfinite(now_s) or now_s < 0 or now_s > self.batch.t[-1]:
            raise ValueError('oracle query outside the generated horizon')
        ticks, prices, confs, stamps = self._history[path]
        k = np.searchsorted(ticks, now_s+1e-12, side='right')-1
        a = self.batch.assets.index(asset)
        return float(prices[a, k]), float(confs[a, k]), float(stamps[a, k])

    def arrays(self):
        """Stored price, absolute confidence and publish time on the batch grid."""
        result = [np.empty_like(self.batch.log_price) for _ in range(3)]
        for path, (ticks, *series) in enumerate(self._history):
            index = np.searchsorted(ticks, self.batch.t+1e-12, side='right')-1
            for out, values in zip(result, series):
                out[path] = values[:, index]
        return tuple(result)
