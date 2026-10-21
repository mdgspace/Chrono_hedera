"""MK3 Kou compound Poisson jumps on an exact event clock."""

from typing import Literal
import numpy as np
from pydantic import Field, model_validator
from .common import YEAR, MarketParams, clock, seed_info, vector
from .gbm import diffusion_batch


class KouParams(MarketParams):
    jump_clock: Literal['exact', 'step_end'] = 'exact'
    jump_rate: float | list[float] = 20.  # per year
    down_probability: float = Field(default=.6, ge=0, le=1)
    eta_down: float = Field(default=12., gt=0)
    eta_up: float = Field(default=15., gt=1)  # finite E[exp(J)]

    @model_validator(mode='after')
    def valid_jumps(self):
        rate = vector(self.jump_rate, len(self.assets))
        if not np.isfinite(rate).all() or np.any(rate < 0):
            raise ValueError('jump rate must be finite and nonnegative')
        return self

    def jump_mean_price(self):
        p = self.down_probability
        return (1-p) * self.eta_up / (self.eta_up-1) + p * self.eta_down / (self.eta_down+1) - 1

    def total_variance(self):
        p = self.down_probability
        return np.asarray(self.sigma)**2 + np.asarray(self.jump_rate) * (
            2*p/self.eta_down**2 + 2*(1-p)/self.eta_up**2)


def events(params, n_paths, horizon_s, rng):
    """Ordered uniforms conditional on Poisson counts are exact arrival times."""
    rates = vector(params.jump_rate, len(params.assets))
    counts = rng.poisson(rates[None, :] * horizon_s / YEAR, size=(n_paths, len(rates)))
    path, asset = np.repeat(np.arange(n_paths), counts.sum(axis=1)), []
    for row in counts:
        asset.extend(np.repeat(np.arange(len(rates)), row))
    asset = np.asarray(asset, dtype=int)
    times = rng.uniform(np.nextafter(0., 1.), horizon_s, size=len(path))
    down = rng.random(len(path)) < params.down_probability
    sizes = np.where(down, -rng.exponential(1/params.eta_down, len(path)),
                     rng.exponential(1/params.eta_up, len(path)))
    return times, path, asset, sizes


def generate(params, n_paths, horizon_s, dt_s, rng):
    params = params if isinstance(params, KouParams) else KouParams.model_validate(params)
    info, base = seed_info(rng), clock(n_paths, horizon_s, dt_s)
    times, path, asset, sizes = events(params, n_paths, horizon_s, rng)
    if params.jump_clock == 'step_end':
        times = base[np.searchsorted(base, times)]
    t = np.unique(np.r_[base, times])
    jumps = np.zeros((n_paths, len(params.assets), len(t)))
    np.add.at(jumps, (path, asset, np.searchsorted(t, times)), sizes)
    rates = vector(params.jump_rate, len(params.assets))
    compensated = params.model_copy(update={'mu': (
        vector(params.mu, len(params.assets)) - rates * params.jump_mean_price()).tolist()})
    info['generator'] = 'MK3_Kou_'+params.jump_clock
    info['jump_clock'] = params.jump_clock
    return diffusion_batch(compensated, n_paths, t, rng, info, jumps)
