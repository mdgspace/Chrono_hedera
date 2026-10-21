"""Resolve explicit illustrative YAML pair/model inputs without changing I4."""
from pathlib import Path

from pydantic import BaseModel, ConfigDict
import yaml

from .base import PairRisk

ROOT = Path(__file__).resolve().parents[2] / 'configs'


class PairConfig(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False)
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


def load_pair(model, pair_name, root=ROOT):
    """Merge pair fields, model fields, then model extra, with no implicit zeros."""
    from . import REGISTRY
    if model not in REGISTRY or pair_name not in {'HBAR_USDC', 'ETH_USDC', 'BTC_USDC'}:
        raise ValueError('Unknown model or pair')
    pair = yaml.safe_load((root / 'pairs' / f'{pair_name}.yaml').read_text())['pair']
    cfg = yaml.safe_load((root / 'models' / f'{model}.yaml').read_text())
    pair.update(cfg.get('pair_overrides', {}))
    pair['extra'].update(cfg.get('extra', {}))
    pair = PairRisk(**PairConfig.model_validate(pair).model_dump())
    if cfg.get('resolve_cap') == 'oracle_only':
        from dataclasses import replace
        from .validation import solvency_bounds
        pair = replace(pair, cap=solvency_bounds(pair)[2])
    REGISTRY[model]().validate(pair)
    return pair
