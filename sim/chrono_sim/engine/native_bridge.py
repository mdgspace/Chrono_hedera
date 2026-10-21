"""W1's identical PCG64 draws with deterministic Bessel reconstruction compiled."""
import numpy as np
from numba import njit
from chrono_sim.market.intrabar import _validate, _minimum_time, _segments

segments = njit(_segments)


def refine_bar(p0, p1, low, sigma, duration, step, rng):
    _validate(p0, p1, low, sigma, duration, step)
    t = np.r_[np.arange(0., duration, step), float(duration)]
    if sigma == 0:
        return p0+(p1-p0)*t/duration
    tau = _minimum_time(p0-low, p1-low, sigma, duration,
                        rng.standard_normal(), rng.random(), rng.random())
    if 0 < tau < duration:
        tau = t[np.clip(np.argmin(np.abs(t-tau)), 1, len(t)-2)]
    return segments(t, tau, p0, p1, low, sigma, rng.standard_normal((len(t)-1, 3)))
