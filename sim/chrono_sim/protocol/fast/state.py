"""Raw-token float64 structure-of-arrays; no Python objects enter transitions."""
from typing import NamedTuple
import numpy as np
from chrono_sim.protocol.ref.registry import configs, DEFAULTS
from chrono_sim.protocol.ref.switches import Switches

CONFIG_KEYS = tuple(DEFAULTS)
# Position fields: collateral, vault debt, start, term, active, coll, debt, owner,
# interest principal, interest accrued, last accrual, interest active, schedule,
# snap bonus, close factor, hard penalty, hard floor, SP share, threshold.
C, B, START, TERM, ACTIVE, COLL, DEBT, OWNER, PRINCIPAL, ACCRUED, LAST, IA, SCHEDULE = range(13)
BONUS, CLOSE, PENALTY, FLOOR, SHARE, LT = range(13, 19)


class State(NamedTuple):
    meta: np.ndarray
    cfg: np.ndarray
    prices: np.ndarray
    balances: np.ndarray
    flows: np.ndarray
    lp: np.ndarray
    lp_users: np.ndarray
    sp: np.ndarray
    sp_users: np.ndarray
    cumulative: np.ndarray
    cumulative_low: np.ndarray
    seen: np.ndarray
    seen_low: np.ndarray
    pending: np.ndarray
    absorbed: np.ndarray
    indices: np.ndarray
    positions: np.ndarray
    params: np.ndarray
    switches: np.ndarray
    schedules: np.ndarray


def initial(scenario, capacity=4096, switches=None, params_width=64):
    cfgs = configs(scenario)
    tokens = tuple(cfgs)
    actors = tuple(scenario['actors'])
    accounts = actors+('lp', 'sp', 'vault', 'liquidation')
    n, a = len(tokens), len(accounts)
    cfg = np.zeros((n, 17), dtype=np.float64)
    prices = np.zeros((n, 5), dtype=np.float64)
    balances = np.zeros((n, a), dtype=np.float64)
    for i, token in enumerate(tokens):
        cfg[i, :14] = [cfgs[token][k] for k in CONFIG_KEYS]
        cfg[i, 14:] = cfgs[token]['decimals'], cfgs[token]['isStablecoin'], True
        p = scenario['tokens'][token]
        prices[i] = float(p['price']), float(p.get('conf', 0)), p.get('expo', -8), scenario['baseTime'], 0
        balances[i, :len(actors)] = float(scenario['balance'])
    z = lambda shape: np.zeros(shape, dtype=np.float64)
    flags = switches or Switches()
    state = State(np.array([scenario['baseTime'], 1, scenario.get('oracle') == 'mock',
                           scenario.get('scheduler') == 'real_no_capacity', scenario['baseTime'],
                           np.nan, 0, 1, 0.02, 0.88], dtype=np.float64),
                  cfg, prices, balances, z((n, a, a)), z((n, 2)), z((n, a)), z((n, 3)), z((n, a)),
                  z((n, n)), z((n, n)), z((n, a, n)), z((n, a, n)), z((n, a, n)), z((n, n)), z((n, 2)),
                  z((capacity, 19)), z((capacity, params_width)),
                  np.array([getattr(flags, k) for k in flags.__dataclass_fields__], dtype=np.float64),
                  z((capacity, 2)))
    return state, tokens, accounts


def clone(state):
    return State(*(x.copy() for x in state))


def restore(state, old):
    for target, source in zip(state, old):
        target[...] = source
