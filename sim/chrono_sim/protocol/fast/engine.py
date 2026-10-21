"""Atomic scenario adapter around the independent numba state machine."""
import importlib
import math
import numpy as np
from . import pools, vault, liquidation
from .math import legacy_open, legacy_threshold, WAD
from .state import initial, clone, restore, BONUS, LT
from .snapshot import snapshot
from chrono_sim.protocol.ref.switches import Switches
from chrono_sim.protocol.ref.wad import Revert, MAX

ERRORS = {
    1: ('Panic(uint256)', 0x11), 2: ('Error(string)', None), 3: ('Panic(uint256)', 0x12),
    4: ('InvalidDuration(uint256,uint256,uint256)', None),
    5: ('ERC20InsufficientBalance(address,uint256,uint256)', None), 6: ('ZeroAmount()', None),
    7: ('InsufficientBalance(address,uint256,uint256)', None),
    8: ('InsufficientLiquidity(address,uint256,uint256)', None), 9: ('AssetNotSupported(address)', None),
    10: ('StalePrice(address,uint256,uint256)', None), 11: ('NegativePrice(address,int64)', None),
    12: ('ConfidenceTooWide(address,uint256,uint256)', None), 13: ('PositionNotActive(bytes32)', None),
    14: ('ScheduleCallFailed(bytes32,uint256)', None), 15: ('DurationExceedsScheduleLimit(uint256,uint256)', None),
    16: ('OriginationsDisabled()', None), 17: ('InsufficientLTV(uint256,uint256)', None),
}


class Engine:
    def __init__(self, scenario, switches=None, risk_model=None, pair_risks=None, capacity=None, hss_capacity=None):
        self.switches = switches or Switches()
        self.risk_model, self.pair_risks = risk_model, pair_risks or {}
        if self.switches.pair_config and risk_model is None:
            raise ValueError('pair_config requires a RiskModel')
        capacity = capacity or max(16, 1+sum(x['action'] == 'open' for x in scenario.get('steps', [])))
        self.state, self.tokens, self.accounts = initial(scenario, capacity, self.switches)
        self.actors = tuple(scenario['actors'])
        self.base = int(scenario['baseTime'])
        self.hss_capacity = -1 if hss_capacity is None else hss_capacity
        self.open_nb, self.threshold_nb = legacy_open, legacy_threshold
        if risk_model is not None:
            module = importlib.import_module(type(risk_model).__module__)
            self.open_nb = getattr(risk_model, "open_limit_nb", getattr(module, "open_limit_nb", None))
            self.threshold_nb = getattr(risk_model, "threshold_nb", getattr(module, "threshold_nb", None))
        self.absorbed_order = [[] for _ in self.tokens]
        self.initial_tokens = self.state.balances.sum(axis=1).copy()
        self.max_conservation_error = 0.0
        self.initial_owner = self.state.balances[:, 0].copy()
        self.model_snapshots = {}
        self.open_premiums = {}

    @property
    def now(self):
        return self.state.meta[0]

    def execute(self, step):
        self.state.meta[0] = self.base+int(step['at'])
        self.state.flows.fill(0.)
        before = clone(self.state)
        try:
            self.dispatch(step)
        except ValueError as exc:
            restore(self.state, before)
            if len(exc.args) != 1 or not isinstance(exc.args[0], int) or exc.args[0] not in ERRORS:
                raise
            signature, code = ERRORS[exc.args[0]]
            return Revert(signature, code)
        for t in range(len(self.tokens)):
            for c in np.flatnonzero(self.state.absorbed[t]):
                if int(c) not in self.absorbed_order[t]:
                    self.absorbed_order[t].append(int(c))
        self.check_conservation()
        return None

    def check_conservation(self):
        error = np.max(np.abs(self.state.balances.sum(axis=1)-self.initial_tokens)/np.maximum(1, self.initial_tokens))
        if self.switches.fix_debt_accounting:
            active = self.state.positions[:, 4] != 0
            for t in range(len(self.tokens)):
                p = self.state.positions
                expected = p[active & (p[:, 6] == t), 8].sum()
                claim_error = abs(self.state.lp[t, 0]-expected)/max(1., abs(expected))
                error = max(error, claim_error)
            p = self.state.positions[active]
            if len(p):
                error = max(error, float(np.max(np.abs(p[:, 1]-p[:, 8])/np.maximum(1., p[:, 8]))))
        self.max_conservation_error = max(self.max_conservation_error, float(error))
        if error > 1e-9 or np.any(self.state.balances < 0):
            raise AssertionError(f'token conservation error {error}')
        return float(error)

    def dispatch(self, step):
        s = self.state
        action = step['action']
        actor = self.accounts.index(step.get('actor', 'alice'))
        token = self.tokens.index(step.get('token', 'debt' if 'debt' in self.tokens else self.tokens[-1]))
        amount, i = uint_float(step.get('amount', 0)), int(step.get('id', 1))-1
        if action == 'setPrice':
            self.set_prices(step)
        elif action in ('deposit', 'lpDeposit', 'lpWithdraw'):
            receiver = self.accounts.index(step.get('receiver', step.get('actor', 'alice')))
            pools.lending(s, token, actor, amount, receiver, action == 'lpWithdraw')
        elif action in ('spDeposit', 'spWithdraw'):
            pools.stability(s, token, actor, amount, action == 'spWithdraw')
        elif action == 'claim':
            pools.claim(s, token, actor)
        elif action == 'open':
            self.open_position(step, actor)
        elif action == 'repay':
            vault.repay(s, i, amount, actor)
        elif action == 'topUp':
            vault.top_up(s, i, amount, actor)
        elif action == 'softLiquidate':
            liquidation.soft(s, i, amount, actor, self.threshold_nb)
        elif action in ('hardLiquidate', 'scheduled'):
            liquidation.hard(s, i)
        elif action == 'deactivate':
            s.cfg[token, 16] = 0
        elif action == 'index':
            pools.index(s, token)
        elif action != 'advanceTo':
            raise ValueError(f'unknown action {action}')

    def set_prices(self, step):
        for token, value in step.get('prices', {step.get('token', 'coll'): step.get('price', '200000000')}).items():
            i = self.tokens.index(token)
            p = self.state.prices[i]
            publish = self.base+int(step.get('publishTime', self.now-self.base))
            if self.state.meta[2] or publish > p[3]:
                self.state.prices[i] = float(value), float(step.get('conf', 0)), int(step.get('expo', -8)), publish, 0

    def open_position(self, step, actor):
        c, d = step.get('collToken', 'coll'), step.get('debtToken', 'debt')
        coll, debt = self.tokens.index(c), self.tokens.index(d)
        cfg, dc = self.state.cfg[coll], self.state.cfg[debt]
        params = np.array([cfg[0]/WAD, cfg[1]/WAD, cfg[2]/WAD, cfg[5]/WAD, cfg[6]/WAD, cfg[7]/WAD])
        terms = np.array([cfg[3], dc[4], dc[8], dc[9], dc[10], 0.88*WAD, cfg[12], cfg[13]])
        duration = uint_float(step['duration'])
        if self.switches.pair_config:
            pair = self.pair_risks[(c, d)]
            self.risk_model.validate(pair)
            params = np.asarray(self.risk_model.kernel_params(pair), dtype=np.float64)
            self.state.meta[7] = pair.extra.get('conf_multiplier', 1.)
            self.state.meta[8] = pair.extra.get('max_open_conf_ratio', .02)
            pc, pd = vault.price(self.state, coll), vault.price(self.state, debt)
            if self.risk_model.name != 'NEG':
                if self.state.meta[6]:
                    raise ValueError(16)
                cc = self.state.prices[coll, 1]*10.**(18+self.state.prices[coll, 2])
                cd = self.state.prices[debt, 1]*10.**(18+self.state.prices[debt, 2])
                if pc <= 0 or pd <= 0:
                    raise ValueError(16)
                if cc/pc > self.state.meta[8] or cd/pd > self.state.meta[8]:
                    raise ValueError(16)
            terms = np.array([pair.bonus*WAD, pair.close_factor*WAD, pair.hard_penalty*WAD,
                              pair.hard_floor*WAD, pair.sp_share*WAD, pair.lam*WAD, pair.min_T_s, pair.max_T_s])
        if len(params) > self.state.params.shape[1]:
            raise ValueError('kernel_params exceeds optional params_width=64 capacity')
        owner = self.accounts.index(step.get('onBehalfOf', step.get('actor', 'alice')))
        identifier = int(self.state.meta[1])
        vault.open_position(self.state, coll, debt, uint_float(step['collateral']), uint_float(step['borrow']),
                            duration, actor, owner, params, terms, self.open_nb, self.hss_capacity)
        if self.switches.pair_config:
            self.record_origination(step, identifier, coll, debt, actor)

    def record_origination(self, step, identifier, coll, debt, actor):
        from chrono_sim.models.base import MarketState
        c, d = self.tokens[coll], self.tokens[debt]
        pair = self.pair_risks[(c, d)]
        s = self.state
        mkt = MarketState(self.now, {c: vault.price(s, coll)/WAD, d: vault.price(s, debt)/WAD},
                          {c: s.prices[coll, 1]*10.**s.prices[coll, 2],
                           d: s.prices[debt, 1]*10.**s.prices[debt, 2]})
        self.model_snapshots[str(identifier)] = self.risk_model.snapshot(pair, float(step['duration']), mkt)
        sp_paid = s.flows[debt, actor, -3]
        reserve_paid = s.flows[debt, actor, 0]
        self.open_premiums[str(identifier)] = sp_paid+reserve_paid, sp_paid

    def configure_pair(self, pair):
        """Explicit governance boundary: floating models refresh, snapshots persist."""
        self.risk_model.configure(pair)
        self.pair_risks[(pair.coll, pair.debt)] = pair
        if getattr(self.risk_model, 'snapshot_lt', True):
            return
        coll, debt = self.tokens.index(pair.coll), self.tokens.index(pair.debt)
        params = self.risk_model.kernel_params(pair)
        for i in range(int(self.state.meta[1])-1):
            p = self.state.positions[i]
            if p[4] and p[5] == coll and p[6] == debt:
                self.state.params[i, :len(params)] = params
                p[BONUS:LT+1] = (pair.bonus*WAD, pair.close_factor*WAD, pair.hard_penalty*WAD,
                                 pair.hard_floor*WAD, pair.sp_share*WAD, pair.lam*WAD)

    def snapshot(self):
        return snapshot(self)


def uint_float(value):
    parsed = int(value)
    if parsed < 0 or parsed > MAX:
        raise ValueError('amount outside uint256')
    return float(parsed)
