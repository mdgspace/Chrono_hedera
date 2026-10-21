"""I1 market data, with exact jump instants shared by all paths."""

from dataclasses import dataclass
import numpy as np


@dataclass(frozen=True)
class PathBatch:
    t: np.ndarray
    assets: tuple[str, ...]
    log_price: np.ndarray
    bar_low: np.ndarray
    conf_frac: np.ndarray
    jump_mask: np.ndarray
    regime: np.ndarray
    seed_info: dict
    pre_jump_log_price: np.ndarray | None = None
    diffusion_low: np.ndarray | None = None
    bar_high: np.ndarray | None = None

    def __post_init__(self):
        t, p = self.t, self.log_price
        if t.dtype != np.float64 or t.ndim != 1 or not len(t) or t[0] != 0:
            raise ValueError('t must be float64, nonempty and start at zero')
        if not np.isfinite(t).all() or np.any(np.diff(t) <= 0):
            raise ValueError('t must be finite and strictly increasing')
        if not self.assets or len(set(self.assets)) != len(self.assets):
            raise ValueError('assets must be nonempty and unique')
        if p.ndim != 3 or p.shape[0] < 1 or p.shape[1:] != (len(self.assets), len(t)):
            raise ValueError('price shape must be [paths, assets, steps]')
        for a in (p, self.bar_low, self.conf_frac):
            if a.dtype != np.float64 or a.shape != p.shape or not np.isfinite(a).all():
                raise ValueError('market arrays must be finite float64 with matching shapes')
        if np.any(self.conf_frac < 0) or np.any(self.bar_low > p + 1e-12):
            raise ValueError('confidence must be nonnegative and lows cannot exceed closes')
        if self.jump_mask.dtype != bool or self.jump_mask.shape != p.shape:
            raise ValueError('jump_mask must be bool with the price shape')
        if self.regime.dtype != np.int8 or self.regime.shape != (p.shape[0], len(t)):
            raise ValueError('regime must be int8 [paths, steps]')
        for q in (self.pre_jump_log_price, self.diffusion_low):
            if q is None:
                continue
            if q.shape != p.shape or q.dtype != np.float64 or not np.isfinite(q).all():
                raise ValueError('pre-jump prices must match price shape and dtype')
        if self.bar_high is not None:
            q = self.bar_high
            if q.shape != p.shape or q.dtype != np.float64 or not np.isfinite(q).all():
                raise ValueError('bar highs must match price shape and dtype')
            if np.any(q < p) or np.any(q[:, :, 1:] < p[:, :, :-1]):
                raise ValueError('bar highs must bound both endpoints')

    def price(self, path: int, asset: str, k: int) -> float:
        return float(np.exp(self.log_price[path, self.assets.index(asset), k]))

    def pair_log_price(self, coll: str, debt: str) -> np.ndarray:
        return self.log_price[:, self.assets.index(coll)] - self.log_price[:, self.assets.index(debt)]
