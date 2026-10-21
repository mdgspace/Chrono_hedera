"""Causal native oracle history, retaining only state-changing push times."""
import numpy as np
from numba import njit
from chrono_sim.oracle.pyth_model import OracleModel, OracleConfig, _availability
from .native_heap import push, pop


@njit
def publish(state, last, latest, confidence, now, available, heartbeat, deviation):
    changed = False
    for a in range(state.shape[1]):
        due = now-last[a] >= heartbeat-1e-12 or abs(latest[a]/state[0, a]-1.) >= deviation
        if due and available:
            state[0, a], state[1, a] = latest[a], latest[a]*confidence[a]
            state[2, a], last[a] = now, now
            changed = True
    return changed


@njit
def history(t, mid, confidence, changes, up, heartbeat, deviation, cadence):
    pub, availability = np.ceil(t/cadence-1e-12)*cadence, np.ceil(changes/cadence)*cadence
    capacity = 2*(len(pub)+len(changes))+int(np.ceil(t[-1]/heartbeat))*len(mid)+8
    ticks, series = np.empty(capacity), np.empty((3, len(mid), capacity))
    pending = min(len(pub)+len(changes)+8, int(np.ceil(heartbeat/cadence))+32)
    queue, count = np.empty((pending, 6)), 0
    count = push(queue, count, t[-1], 0., 0, 0, 0, 0, 0)
    state = np.zeros((3, len(mid)))
    state[0], state[1] = mid[:, 0], mid[:, 0]*confidence[:, 0]
    last = np.zeros(len(mid))
    j, k, size, previous = 0, 0, 0, -1.
    while j < len(pub) or k < len(availability) or count:
        now = min(pub[j] if j < len(pub) else np.inf,
                  availability[k] if k < len(availability) else np.inf,
                  queue[0, 0] if count else np.inf)
        if now > t[-1]:
            break
        while j < len(pub) and pub[j] <= now:
            j += 1
        while k < len(availability) and availability[k] <= now:
            k += 1
        while count and queue[0, 0] <= now:
            _, count = pop(queue, count)
        if now <= previous:
            continue
        previous = now
        source = max(0, np.searchsorted(pub, now+1e-12, side='right')-1)
        available = up[np.searchsorted(changes, now, side='right')-1]
        changed = publish(state, last, mid[:, source], confidence[:, source], now, available, heartbeat, deviation)
        if changed or now == 0:
            due = np.ceil((now+heartbeat)/cadence-1e-12)*cadence
            count = push(queue, count, t[-1], due, 0, 0, 0, 0, 0)
            if size >= capacity:
                raise RuntimeError('native oracle history capacity exceeded')
            ticks[size], series[:, :, size] = now, state
            size += 1
    return ticks[:size].copy(), series[0, :, :size].copy(), series[1, :, :size].copy(), series[2, :, :size].copy()


class NativeOracle(OracleModel):
    def __init__(self, batch, cfg, rng):
        self.batch = batch
        self.cfg = cfg if isinstance(cfg, OracleConfig) else OracleConfig.model_validate(cfg)
        self._history = []
        for path in range(batch.log_price.shape[0]):
            changes, up = _availability(batch.t[-1], self.cfg, rng)
            mid = np.exp(batch.log_price[path])
            self._history.append(history(batch.t, mid, batch.conf_frac[path], changes, up,
                                         self.cfg.heartbeat_s, self.cfg.deviation, self.cfg.cadence_s))

    def prices_on_grid(self):
        ticks, prices, _, _ = self._history[0]
        index = np.searchsorted(ticks, self.batch.t+1e-12, side='right')-1
        return prices[:, index]
