"""I4 risk-model contract and shared mechanics.

open_limit returns maximum principal LTV, including the maturity-value test
for S1/S2/S3/B0; curve_limit exposes the undiscounted selection-doc L0.
open_premium is a fraction of principal paid upfront in debt-token units.
Risk models keep a pair-keyed live configuration map; configure() applies
updates, snapshot() registers initial configs and freezes mechanical fields.
SPEC/SPEC_star/NEG read their live LT, all other candidates snapshot it.
An engine must persist snapshots and configure the model when restoring it.
Kernel parameter layout is documented in kernels.py; threshold kernels use
the snapshot vector for O1 on and the live vector for O1 off/floating models.
"""
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from . import kernels, validation, wad_math


@dataclass(frozen=True)
class MarketState:
    t_s: float
    price: dict[str, float]
    conf: dict[str, float]
    v0: float | None = None
    breaker: bool = False
    borrow_apy: float = 0.0
    v0_publish_s: float | None = None  # None means caller already checked freshness.


@dataclass(frozen=True)
class PairRisk:
    coll: str
    debt: str
    lam: float
    cap: float
    bonus: float
    close_factor: float
    hard_penalty: float
    hard_floor: float
    sp_share: float
    reserve_share: float
    min_T_s: float
    max_T_s: float
    extra: dict


@dataclass(frozen=True)
class PositionView:
    coll: str
    debt: str
    coll_amount: float
    principal: float
    accrued: float
    start_s: float
    T_s: float
    snap: dict


class RiskModel(Protocol):
    name: str
    time_free: bool
    def validate(self, pair: PairRisk) -> None: ...
    def open_limit(self, pair: PairRisk, T_s: float, mkt: MarketState) -> float: ...
    def open_premium(self, pair: PairRisk, ltv: float, T_s: float, mkt: MarketState) -> float: ...
    def snapshot(self, pair: PairRisk, T_s: float, mkt: MarketState) -> dict: ...
    def threshold(self, pos: PositionView, t_s: float, mkt: MarketState) -> float: ...
    def bonus(self, pos: PositionView, hf: float) -> float: ...
    def close_amount(self, pos: PositionView, hf: float, debt: float) -> float: ...
    def hard_penalty(self, pos: PositionView, coll_value: float, debt_value: float) -> float: ...
    def originations_allowed(self, pair: PairRisk, mkt: MarketState) -> bool: ...
    def kernel_params(self, pair: PairRisk) -> np.ndarray: ...


class BaseModel:
    time_free = True
    snapshot_lt = True
    open_limit_nb = staticmethod(kernels.open_limit_nb)
    threshold_nb = staticmethod(kernels.threshold_nb)

    def __init__(self, pairs=()):
        self.pairs = {}
        for pair in pairs:
            self.configure(pair)

    def validate(self, pair):
        try:
            validation.validate(pair, self.name)
        except (KeyError, TypeError, OverflowError) as exc:
            raise ValueError(f'Invalid pair configuration: {exc}') from exc

    def configure(self, pair):
        """Governance update; deepcopy prevents mutation through caller dictionaries."""
        from copy import deepcopy
        self.validate(pair)
        self.pairs[pair.coll, pair.debt] = deepcopy(pair)

    def kernel_params(self, pair):
        self.validate(pair)
        return validation.parameters(pair, self.code)

    def effective_v0(self, pair, mkt):
        age_limit = pair.extra.get('v0_staleness_s')
        if age_limit is not None and mkt.v0_publish_s is not None and not 0 <= mkt.t_s - mkt.v0_publish_s <= age_limit:
            return None
        return mkt.v0

    def market_inputs(self, pair, mkt):
        validation.number(mkt.borrow_apy, 'APY')
        v0 = self.effective_v0(pair, mkt)
        if v0 is not None:
            validation.number(v0, 'Variance')
        return v0

    def open_limit(self, pair, T_s, mkt):
        p = self.kernel_params(pair)
        v0 = self.market_inputs(pair, mkt)
        return kernels.open_limit_float(p, T_s, np.nan if v0 is None else v0, mkt.borrow_apy)

    def curve_limit(self, pair, T_s, mkt):
        self.open_limit(pair, T_s, mkt)  # Validate public boundary, including duration.
        v0 = self.effective_v0(pair, mkt)
        return kernels.curve(self.kernel_params(pair), T_s, np.nan if v0 is None else v0, mkt.borrow_apy)

    def open_limit_wad(self, pair, T_s, mkt):
        """Return integer WAD; mkt fields remain human-unit Python values."""
        self.validate(pair)
        v0 = self.market_inputs(pair, mkt)
        return wad_math.open_wad(pair, self.code, T_s, None if v0 is None else wad_math.to_wad(v0), wad_math.to_wad(mkt.borrow_apy))

    def open_premium(self, pair, ltv, T_s, mkt):
        return 0.0

    def open_premium_wad(self, pair, ltv_wad, T_s, mkt):
        return 0

    def snapshot(self, pair, T_s, mkt):
        self.open_limit(pair, T_s, mkt)
        if (pair.coll, pair.debt) not in self.pairs:
            self.configure(pair)
        return dict(lam=pair.lam, bonus=pair.bonus, close_factor=pair.close_factor,
                    hard_penalty=pair.hard_penalty, hard_floor=pair.hard_floor,
                    sp_share=pair.sp_share, reserve_share=pair.reserve_share,
                    config_version=pair.extra.get('config_version', 'illustrative'),
                    quote_time_s=mkt.t_s, kernel_params=self.kernel_params(pair).tolist())

    def pair_for(self, pos):
        return self.pairs[pos.coll, pos.debt]

    def threshold_params(self, pos):
        if self.snapshot_lt:
            return np.asarray(pos.snap['kernel_params'], dtype=np.float64)
        return self.kernel_params(self.pair_for(pos))

    def threshold(self, pos, t_s, mkt):
        return kernels.threshold_float(self.threshold_params(pos), max(0, pos.start_s + pos.T_s - t_s), t_s - pos.start_s)

    def threshold_wad(self, pos, t_s, mkt):
        if self.snapshot_lt:
            return wad_math.to_wad(pos.snap['lam'])
        return wad_math.threshold_wad(self.pair_for(pos), self.code, max(0, pos.start_s + pos.T_s - t_s), t_s - pos.start_s)

    def mechanic(self, pos, key):
        return pos.snap[key] if self.snapshot_lt else getattr(self.pair_for(pos), key)

    def bonus(self, pos, hf):
        return self.mechanic(pos, 'bonus')

    def close_amount(self, pos, hf, debt):
        validation.number(debt, 'Debt')
        return debt * self.mechanic(pos, 'close_factor')

    def hard_penalty(self, pos, coll_value, debt_value):
        validation.number(coll_value, 'Collateral value')
        validation.number(debt_value, 'Debt value')
        return max(debt_value * self.mechanic(pos, 'hard_penalty'), coll_value * self.mechanic(pos, 'hard_floor'))

    def bonus_wad(self, pos, hf_wad):
        return wad_math.to_wad(self.mechanic(pos, 'bonus'))

    def close_amount_wad(self, pos, hf_wad, debt_wad):
        return wad_math.wad_mul(debt_wad, wad_math.to_wad(self.mechanic(pos, 'close_factor')))

    def hard_penalty_wad(self, pos, coll_value_wad, debt_value_wad):
        debt = wad_math.wad_mul(debt_value_wad, wad_math.to_wad(self.mechanic(pos, 'hard_penalty')))
        floor = wad_math.wad_mul(coll_value_wad, wad_math.to_wad(self.mechanic(pos, 'hard_floor')))
        return max(debt, floor)

    def valuation_prices(self, pair, mkt):
        """Conservative collateral/debt prices; confidence never blocks liquidation."""
        m = 0 if self.name == 'NEG' else pair.extra['conf_multiplier']
        for token in (pair.coll, pair.debt):
            validation.number(mkt.price[token], 'Price', 0, float('inf'), True)
            validation.number(mkt.conf[token], 'Confidence')
        return (max(0, mkt.price[pair.coll] - m * mkt.conf[pair.coll]),
                mkt.price[pair.debt] + m * mkt.conf[pair.debt])

    def originations_allowed(self, pair, mkt):
        self.validate(pair)
        if self.code < 5 and mkt.breaker:
            return False
        try:
            self.valuation_prices(pair, mkt)
        except (KeyError, ValueError):
            return False
        if self.name == 'NEG':
            return True
        limit = pair.extra['max_open_conf_ratio']
        return all(mkt.conf[t] / mkt.price[t] <= limit for t in (pair.coll, pair.debt))
