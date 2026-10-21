"""Conservative live-book windows; oracle history stays unchanged."""
import math
import numpy as np
from numba import njit
from .native_actions import barrier_at


def bounds(batch, path, sigma):
    n = len(batch.assets)
    high = getattr(batch, 'bar_high', None)
    if high is None:
        high = np.full_like(batch.log_price[path], np.inf)
        for d in range(n):
            if sigma[d] == 0 and not np.any(batch.jump_mask[path, d]) and np.all(batch.log_price[path, d] == batch.log_price[path, d, 0]):
                high[d] = batch.log_price[path, d]
    else:
        high = high[path]
    # Each ratio is bounded by exp(collateral low - debt high).
    lows = batch.bar_low[path, :, None, :]-high[None, :, :]
    return batch.t, np.ascontiguousarray(lows), np.ascontiguousarray(batch.bar_low[path]), np.ascontiguousarray(high)


@njit
def next_oracle(clock, index, now, next_action, windows, tops, stored):
    coarse, lows, coll_low, debt_high = windows
    k = np.searchsorted(coarse, now, side='right')
    if k >= len(coarse) or next_action < coarse[k]:
        return index+1
    for c in range(len(tops)):
        for d in range(len(tops)):
            if tops[c, d] <= 0:
                continue
            # A previously stored quote can lie outside the new bar's bounds.
            pc, pd = math.log(stored[c, 0]/1e8), math.log(stored[d, 0]/1e8)
            low = min(lows[c, d, k], coll_low[c, k]-pd, pc-debt_high[d, k], pc-pd)
            if low <= math.log(barrier_at(tops[c, d], coarse[k])):
                return index+1
    return max(index+1, np.searchsorted(clock, coarse[k], side='left'))
