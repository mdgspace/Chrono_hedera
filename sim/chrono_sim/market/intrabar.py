"""Minimum-conditioned bridges from the two Bessel(3)-bridge decomposition.

The regular-grid API rounds the minimum's time to the nearest interior node.
Use refine_bar_with_clock to retain its exact time as an additional event.
Both APIs preserve the supplied minimum and endpoints exactly.
"""

import numpy as np
from numba import njit
from numba.extending import register_jitable


@register_jitable
def _validate(p0, p1, low, sigma, duration, step):
    if not np.isfinite(p0 + p1 + low + sigma + duration + step):
        raise ValueError('finite bridge parameters required')
    if duration <= 0 or step <= 0 or sigma < 0 or low > min(p0, p1):
        raise ValueError('invalid duration, step, volatility or minimum')
    if sigma == 0 and low != min(p0, p1):
        raise ValueError('zero volatility cannot produce an interior minimum')
    if duration <= step and low < min(p0, p1):
        raise ValueError('an interior minimum requires an interior grid node')


@register_jitable
def _wald(mean, shape, z, u):
    v = mean * z*z / shape
    x = mean / (1 + v/2 + np.sqrt(v*(1+v/4)))
    return x if u <= mean/(mean+x) else mean*mean/x


@register_jitable
def _minimum_time(a, b, sigma, duration, z, u, mixture):
    if a == 0:
        return 0.
    if b == 0:
        return duration
    scale = sigma*sigma*duration
    if mixture < b/(a+b):
        ratio = _wald(a/b, a*a/scale, z, u)
    else:
        ratio = 1/_wald(b/a, b*b/scale, z, u)
    return duration * ratio/(1+ratio)


@register_jitable
def _bessel(t, endpoint, duration, sigma, normals):
    """Norm of a 3D Gaussian bridge from zero to (endpoint, 0, 0)."""
    if len(t) == 1:
        return np.zeros(1)
    w = np.zeros((len(t), 3))
    for k in range(1, len(t)):
        for j in range(3):
            w[k, j] = w[k-1, j] + normals[k-1, j]*np.sqrt(t[k]-t[k-1])
    out = np.empty(len(t))
    for k in range(len(t)):
        f = t[k]/duration
        x = sigma*(w[k, 0]-f*w[-1, 0]) + f*endpoint
        y = sigma*(w[k, 1]-f*w[-1, 1])
        z = sigma*(w[k, 2]-f*w[-1, 2])
        out[k] = np.sqrt(x*x + y*y + z*z)
    return out


@register_jitable
def _segments(t, tau, p0, p1, low, sigma, normals):
    k = np.searchsorted(t, tau)
    left = (tau-t[:k+1])[::-1].copy()
    right = (t[k:]-tau).copy()
    values = np.empty(len(t))
    if k > 0:
        values[:k+1] = low + _bessel(left, p0-low, tau, sigma, normals[:k])[::-1]
    if k < len(t)-1:
        values[k:] = low + _bessel(right, p1-low, t[-1]-tau, sigma, normals[k:])
    values[0], values[-1], values[k] = p0, p1, low
    return values


def refine_bar(log_p0, log_p1, log_low, sigma_per_s, dt_s, step_s, rng):
    """Regular-grid I2 API; exact value conditioning, quantised minimum time."""
    _validate(log_p0, log_p1, log_low, sigma_per_s, dt_s, step_s)
    t = np.r_[np.arange(0., dt_s, step_s), float(dt_s)]
    if sigma_per_s == 0:
        return log_p0 + (log_p1-log_p0)*t/dt_s
    tau = _minimum_time(log_p0-log_low, log_p1-log_low, sigma_per_s, dt_s,
                        rng.standard_normal(), rng.random(), rng.random())
    # ponytail: regular grid rounds the minimum time; use the clock helper for exact timing.
    if 0 < tau < dt_s:
        tau = t[np.clip(np.argmin(np.abs(t-tau)), 1, len(t)-2)]
    return _segments(t, tau, log_p0, log_p1, log_low, sigma_per_s,
                     rng.standard_normal((len(t)-1, 3)))


@njit(cache=True)
def refine_bar_nb(log_p0, log_p1, log_low, sigma_per_s, dt_s, step_s, seed):
    """Numba I2 variant using its own deterministic seeded stream."""
    _validate(log_p0, log_p1, log_low, sigma_per_s, dt_s, step_s)
    np.random.seed(seed)
    t = np.append(np.arange(0., dt_s, step_s), dt_s)
    if sigma_per_s == 0:
        return log_p0 + (log_p1-log_p0)*t/dt_s
    tau = _minimum_time(log_p0-log_low, log_p1-log_low, sigma_per_s, dt_s,
                        np.random.standard_normal(), np.random.random(), np.random.random())
    if 0 < tau < dt_s:
        tau = t[min(max(np.argmin(np.abs(t-tau)), 1), len(t)-2)]
    return _segments(t, tau, log_p0, log_p1, log_low, sigma_per_s,
                     np.random.standard_normal((len(t)-1, 3)))


def refine_bar_with_clock(log_p0, log_p1, log_low, sigma_per_s, dt_s, step_s, rng):
    """Exact conditional construction, adding the minimum's actual event time."""
    _validate(log_p0, log_p1, log_low, sigma_per_s, dt_s, step_s)
    t = np.r_[np.arange(0., dt_s, step_s), float(dt_s)]
    if sigma_per_s == 0:
        return t, log_p0 + (log_p1-log_p0)*t/dt_s
    tau = _minimum_time(log_p0-log_low, log_p1-log_low, sigma_per_s, dt_s,
                        rng.standard_normal(), rng.random(), rng.random())
    t = np.unique(np.r_[t, tau])
    return t, _segments(t, tau, log_p0, log_p1, log_low, sigma_per_s,
                        rng.standard_normal((len(t)-1, 3)))
