"""P3 holder, fixed-latency keeper and cap roller, with shared explicit draws."""
from dataclasses import dataclass
import math


@dataclass(frozen=True)
class Holder:
    coll: str
    debt: str
    collateral: float = 100.0
    term_s: float = 7200.0
    u: float = .8
    lead_s: float = 60.0
    rho_miss: float = 0.0
    opened_at: float = 0.0
    strategy: str = 'holder'

    def __post_init__(self):
        if not all(math.isfinite(v) for v in (self.collateral, self.term_s, self.u, self.lead_s, self.rho_miss, self.opened_at)):
            raise ValueError("holder inputs must be finite")
        if not 0 < self.u <= 1 or not 0 <= self.rho_miss <= 1 or self.collateral <= 0 or self.term_s <= 0 or not 0 <= self.lead_s < self.term_s or self.opened_at < 0:
            raise ValueError('invalid holder parameters')


@dataclass(frozen=True)
class Keeper:
    latency_s: float = 1.0

    def __post_init__(self):
        if not math.isfinite(self.latency_s) or self.latency_s < 0:
            raise ValueError('keeper latency must be nonnegative')


@dataclass(frozen=True)
class CapRoller(Holder):
    u: float = 1.0
    strategy: str = 'roller'
