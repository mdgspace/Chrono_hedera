"""P3 model registry; instantiate a class, then configure its ordered pairs."""
from .base import MarketState, PairRisk, PositionView, RiskModel
from .s1_split_role import S1
from .flat import B0_cap
from .spec_v2 import SPEC
from .neg_exponential import NEG

REGISTRY = {cls.name: cls for cls in (S1, B0_cap, SPEC, NEG)}

__all__ = ['REGISTRY', 'MarketState', 'PairRisk', 'PositionView', 'RiskModel']
