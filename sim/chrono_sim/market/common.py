"""Shared diffusion parameters, clock, confidence and provenance."""

import hashlib
import json
import numpy as np
from pydantic import BaseModel, ConfigDict, Field, model_validator

YEAR = 31_536_000.


class MarketParams(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    assets: tuple[str, ...] = ('HBAR',)
    initial_price: float | list[float] = 1.
    sigma: float | list[float] = .8  # annualised log diffusion volatility
    mu: float | list[float] = 0.  # annualised expected price return
    correlation: list[list[float]] | None = None
    conf_c0: float = Field(default=0., ge=0)
    conf_c1: float = Field(default=0., ge=0)
    conf_c2: float = Field(default=0., ge=0)
    conf_residuals: list[float] = Field(default_factory=list)

    @model_validator(mode='after')
    def valid(self):
        if not self.assets or len(set(self.assets)) != len(self.assets):
            raise ValueError('unique assets required')
        for name in ('initial_price', 'sigma', 'mu'):
            a = vector(getattr(self, name), len(self.assets))
            if not np.isfinite(a).all() or (name == 'initial_price' and np.any(a <= 0)):
                raise ValueError(f'invalid {name}')
            if name == 'sigma' and np.any(a < 0):
                raise ValueError('sigma must be nonnegative')
        correlation(self)
        if not np.isfinite(self.conf_residuals).all():
            raise ValueError('confidence residuals must be finite')
        return self


def vector(value, n):
    return np.broadcast_to(np.asarray(value, dtype=np.float64), (n,)).copy()


def correlation(params):
    n = len(params.assets)
    c = np.eye(n) if params.correlation is None else np.asarray(params.correlation, dtype=float)
    if c.shape != (n, n) or not np.isfinite(c).all() or not np.allclose(c, c.T):
        raise ValueError('correlation must be finite and symmetric')
    if not np.allclose(np.diag(c), 1) or np.linalg.eigvalsh(c).min() < -1e-12:
        raise ValueError('correlation must be positive semidefinite with unit diagonal')
    return c


def clock(n_paths, horizon_s, dt_s):
    if type(n_paths) is not int or n_paths < 1:
        raise ValueError('positive integer n_paths required')
    if not np.isfinite([horizon_s, dt_s]).all() or min(horizon_s, dt_s) <= 0:
        raise ValueError('positive finite horizon and step required')
    return np.unique(np.r_[np.arange(0., horizon_s, dt_s), float(horizon_s)])


def seed_info(rng):
    seq = rng.bit_generator._seed_seq
    state = json.dumps(rng.bit_generator.state, sort_keys=True, default=lambda x: x.tolist())
    return {'entropy': seq.entropy, 'spawn_key': list(seq.spawn_key),
            'bit_generator': type(rng.bit_generator).__name__,
            'initial_state_sha256': hashlib.sha256(state.encode()).hexdigest()}


def bridge_low(x, y, variance, rng):
    """Inverse CDF of a Brownian bridge's continuous minimum."""
    u = np.maximum(rng.random(np.broadcast_shapes(x.shape, y.shape)), np.finfo(float).tiny)
    return (x + y - np.sqrt((x - y)**2 - 2 * variance * np.log(u))) / 2


def confidence(p, jumps, t, params, rng):
    r2 = np.diff(p, axis=2, prepend=p[:, :, :1])**2
    total = np.cumsum(r2, axis=2)
    before = np.searchsorted(t, t - 300., side='left') - 1
    prior = np.take(total, np.maximum(before, 0), axis=2)
    prior[:, :, before < 0] = 0
    vol = np.sqrt(np.maximum(total - prior, 0) / np.minimum(np.maximum(t, 1), 300))
    count = np.cumsum(jumps, axis=2)
    before = np.searchsorted(t, t - 60., side='right') - 1
    prior = np.take(count, np.maximum(before, 0), axis=2)
    prior[:, :, before < 0] = 0
    out = params.conf_c0 + params.conf_c1 * vol + params.conf_c2 * (count > prior)
    if params.conf_residuals:
        out += rng.choice(params.conf_residuals, size=p.shape)
    return np.maximum(out, 0.).astype(np.float64)
