"""Priority-queue P3 execution with conservative heap skips and I1-I4 integration."""
from dataclasses import dataclass, replace
from copy import deepcopy
from chrono_sim.protocol.fast.state import clone
import heapq
import math
import numpy as np
from chrono_sim.market.pathbatch import PathBatch
from chrono_sim.oracle.pyth_model import OracleModel, OracleConfig
from chrono_sim.models.base import MarketState
from chrono_sim.protocol.ref.switches import Switches
from chrono_sim.protocol.fast.engine import Engine
from chrono_sim.protocol.fast.state import *
from chrono_sim.protocol.fast.math import WAD, YEAR, ltv
from chrono_sim.protocol.fast.pools import apy
from chrono_sim.protocol.fast.vault import price
from chrono_sim.protocol.fast.liquidation import health
from .agents import Holder, Keeper, CapRoller
from .heap import LiquidationHeap, next_crossing
from .refine import refined_path
from .records import RecordBook, PathRecords


@dataclass(frozen=True)
class LoopConfig:
    oracle: OracleConfig = None
    hss_capacity: int = 100
    hss_delay_s: float = 0.0
    sigma_per_s: tuple[float, ...] = ()
    sp_deposit: float = 0.0
    lp_deposit: float = 1e9
    batch_size: int = 1000
    impact: float = 0.0
    basis: float = 0.0
    reserve_reimburses: bool = True
    token_decimals: dict[str, int] | None = None
    stable_tokens: tuple[str, ...] = ('USDC', 'USDT')
    native: bool = False
    adaptive: bool = False

    def __post_init__(self):
        if not all(math.isfinite(v) for v in (self.hss_capacity, self.hss_delay_s, self.sp_deposit, self.lp_deposit, self.impact, self.basis, *self.sigma_per_s)):
            raise ValueError('loop inputs must be finite')
        if any(type(v) is not int or not 0 <= v <= 255 for v in (self.token_decimals or {}).values()):
            raise ValueError('token decimals must be integers in [0,255]')
        if self.hss_capacity < 0 or self.hss_delay_s < 0 or self.batch_size < 1 or min(self.sp_deposit, self.lp_deposit) < 0:
            raise ValueError('invalid loop capacity, latency or deposit')


class EventLoop:
    def __init__(self, model=None, pair_risks=None, switches=None, cfg=None, keeper=None):
        self.model, self.pairs = model, pair_risks or {}
        self.switches = switches or Switches()
        self.cfg, self.keeper = cfg or LoopConfig(), keeper or Keeper()
        self.stats = dict(paths=0, base_steps=0, refined_bars=0, skipped_bars=0, events=0, reverts=0)

    def run(self, batch, holders, rng, oracle_rng=None):
        if not holders:
            raise ValueError('at least one holder is required')
        if self.switches.pair_config and self.model is None:
            raise ValueError('pair_config requires a model')
        if self.cfg.adaptive:
            from .adaptive_adapter import run as adaptive
            multiplier = max((p.extra.get('conf_multiplier', 1.) for p in self.pairs.values()), default=1.)
            self.max_conf = batch.max_conf_frac()*multiplier
            return adaptive(self, batch, holders, rng.integers(0, 2**63-1, size=(batch.n_paths, 3)), oracle_rng)
        for h in holders:
            if h.coll not in batch.assets or h.debt not in batch.assets or h.opened_at not in batch.t:
                raise ValueError('holder assets and exact opening times must appear in PathBatch')
        multiplier = max((p.extra.get('conf_multiplier', 1.) for p in self.pairs.values()), default=1.)
        self.max_conf = float(np.max(batch.conf_frac))*multiplier
        streams = rng.integers(0, 2**63-1, size=(batch.log_price.shape[0], 3))
        if self.cfg.native:
            from .native_adapter import run
            return run(self, batch, holders, streams, oracle_rng)
        results = []
        for first in range(0, len(streams), self.cfg.batch_size):
            for path in range(first, min(first+self.cfg.batch_size, len(streams))):
                refine_rng, agent_rng = [np.random.default_rng(int(x)) for x in streams[path, :2]]
                orng = np.random.default_rng(int(streams[path, 2])) if oracle_rng is None else oracle_rng
                fine = self.prepare(batch, path, holders, refine_rng)
                oracle = OracleModel(fine, self.cfg.oracle or OracleConfig(), orng)
                results.append(self.run_path(path, fine, oracle, holders, agent_rng))
        return PathRecords.concat(results)

    def prepare(self, batch, path, holders, rng):
        sigma = self.cfg.sigma_per_s or tuple(.8/math.sqrt(YEAR) for _ in batch.assets)
        if len(sigma) != len(batch.assets) or min(sigma) < 0:
            raise ValueError('one nonnegative sigma_per_s per asset required')
        heap = LiquidationHeap()
        for i, h in enumerate(holders):
            c, d = batch.assets.index(h.coll), batch.assets.index(h.debt)
            k = int(np.searchsorted(batch.t, h.opened_at))
            ratio = math.exp(batch.log_price[path, c, k]-batch.log_price[path, d, k])
            pair = self.pairs.get((h.coll, h.debt))
            lam = pair.lam if self.switches.pair_config and self.model.time_free else .75
            # The opening cap is a conservative bound; repayment only reduces risk.
            limit = pair.cap if pair is not None and self.switches.pair_config else .9
            heap.update((c, d), i, h.u*limit*ratio/lam)
        bars = set()
        for (c, d) in heap.heaps:
            top, _ = heap.top((c, d))
            if sigma[d] != 0 or np.any(batch.jump_mask[path, d]):
                # I1 has debt lows, not highs: no safe pair-low bound for a moving debt leg.
                first = 1
            else:
                lows = batch.bar_low[path, c]-batch.log_price[path, d]
                conf = self.max_conf if self.switches.conf_prices else 0.0
                adjusted = math.log(top)+math.log1p(conf)-math.log(max(1e-12, 1-conf))
                first = next_crossing(batch.t, lows, 1, len(batch.t), adjusted, 1.075/YEAR, 0.)
            # ponytail: after the first crossing refine the remaining book; dynamic per-action windows can narrow this if profiling warrants it.
            bars.update(range(first, len(batch.t)))
        for h in holders:
            cycle = h.term_s-h.lead_s
            starts = np.arange(h.opened_at, batch.t[-1], cycle) if isinstance(h, CapRoller) else [h.opened_at]
            for start in starts:
                events = [start+h.term_s-h.lead_s, start+h.term_s+900+self.keeper.latency_s]
                events += [start+h.term_s+902+j+self.cfg.hss_delay_s for j in range(6)]
                for at in events:
                    k = int(np.searchsorted(batch.t, at))
                    if 0 < k < len(batch.t) and batch.t[k] != at:
                        bars.add(k)
        self.stats['base_steps'] += len(batch.t)-1
        self.stats['refined_bars'] += sum(batch.t[k]-batch.t[k-1] > 1 for k in bars)
        self.stats['skipped_bars'] += len(batch.t)-1-len(bars)
        return refined_path(batch, path, bars, sigma, rng)

    def make_engine(self, batch, holders):
        tokens = {asset: dict(decimals=(self.cfg.token_decimals or {}).get(asset, 8), stable=asset in self.cfg.stable_tokens, price=str(round(math.exp(batch.log_price[0, a, 0])*1e8)), expo=-8)
                  for a, asset in enumerate(batch.assets)}
        scenario = dict(baseTime=2_000_000_000, actors=['owner', 'alice', 'bob', 'keeper'],
                        balance=str(10**26), tokens=tokens, oracle='pyth', steps=[])
        # Naive holders open once; only rollers need repeated position IDs.
        capacity = max(16, sum(2+int(max(0., batch.t[-1]-h.opened_at)/(h.term_s-h.lead_s))
                               if isinstance(h, CapRoller) else 1 for h in holders))
        e = Engine(scenario, self.switches, deepcopy(self.model), deepcopy(self.pairs),
                   capacity=capacity, hss_capacity=self.cfg.hss_capacity)
        e.state.balances[:, 0] = 0.
        e.initial_tokens = e.state.balances.sum(axis=1).copy()
        e.initial_owner = e.state.balances[:, 0].copy()
        for index, t in enumerate(e.tokens):
            unit = 10.**e.state.cfg[index, 14]
            e.dispatch(dict(action='lpDeposit', token=t, actor='bob', amount=round(self.cfg.lp_deposit*unit)))
            if self.cfg.sp_deposit:
                e.dispatch(dict(action='spDeposit', token=t, actor='bob', amount=round(self.cfg.sp_deposit*unit)))
        return e

    def run_path(self, path, batch, oracle, holders, rng):
        e = self.make_engine(batch, holders)
        self.active_heap = LiquidationHeap()
        self.agent_rngs = {}
        e.horizon_s = float(batch.t[-1])
        book = RecordBook(path, e, self.cfg.impact, self.cfg.basis, self.cfg.reserve_reimburses,
                          (batch.t, oracle.arrays()[0][0]))
        queue, serial, pending = [], 0, set()
        def push(at, priority, kind, data):
            nonlocal serial
            if at <= batch.t[-1]+1e-9:
                heapq.heappush(queue, (float(at), priority, serial, kind, data))
                serial += 1
        for h in holders:
            hrng = np.random.default_rng(int(rng.integers(0, 2**63-1)))
            push(h.opened_at, 1, 'open', (h, hrng))
        cadence = oracle.cfg.cadence_s
        publications = np.ceil(batch.t/cadence-1e-12)*cadence
        for now in np.unique(np.r_[batch.t, publications]):
            push(now, 0, 'oracle', None)
        while queue:
            now, _, _, kind, data = heapq.heappop(queue)
            e.state.meta[0] = e.base+now
            self.update_oracle(e, oracle, now)
            if kind == 'oracle':
                self.scan(e, now, push, pending)
            elif kind == 'open':
                self.open_holder(e, data[0], now, book, push, data[1])
            elif kind == 'roll':
                self.roll(e, data, now, book, push, rng)
            else:
                i, h = data
                action = 'softLiquidate' if kind == 'soft' else 'repay' if kind == 'repay' else 'scheduled'
                coll = int(e.state.positions[i, COLL])
                returned = e.state.positions[i, C]/10.**e.state.cfg[coll, 14]
                error = self.action(e, book, action, i, now)
                if kind == 'keeper_hard' and error and e.state.positions[i, ACTIVE]:
                    push(now+max(1., self.keeper.latency_s), 3, kind, data)
                pending.discard(i)
                if kind == 'repay' and isinstance(h, CapRoller) and not e.state.positions[i, ACTIVE]:
                    if returned > 0:
                        push(now, 1, 'roll', (replace(h, collateral=returned, opened_at=now), i))
                    else:
                        book.stopped(i, 'collateral_exhausted')
                if kind == 'soft' and e.state.positions[i, ACTIVE] and self.keeper.latency_s > 0:
                    self.scan(e, now, push, pending)
            self.stats['events'] += 1
        self.stats['paths'] += 1
        return book.finish(float(batch.t[-1]))

    def update_oracle(self, e, oracle, now):
        for t, token in enumerate(e.tokens):
            p, conf, published = oracle.stored(0, token, now)
            e.state.prices[t] = p*1e8, conf*1e8, -8, e.base+published, 0

    def open_holder(self, e, h, now, book, push, rng):
        miss_draw = rng.random()
        c, d = e.tokens.index(h.coll), e.tokens.index(h.debt)
        s = e.state
        try:
            pc, pd = price(s, c), price(s, d)
        except ValueError as exc:
            if exc.args[0] == 10:
                self.stats['reverts'] += 1
                return
            raise
        limit = ltv(s.cfg[c], h.term_s)/WAD
        if self.switches.pair_config:
            pair = e.pair_risks[(h.coll, h.debt)]
            mkt = MarketState(e.now, {h.coll: pc/WAD, h.debt: pd/WAD},
                              {h.coll: s.prices[c, 1]/1e8, h.debt: s.prices[d, 1]/1e8}, borrow_apy=apy(s, d)/WAD)
            limit = e.open_nb(e.risk_model.kernel_params(pair), h.term_s, np.nan, mkt.borrow_apy)
        # Confidence affects allowable borrowing, while seizure always uses mid.
        if self.switches.conf_prices:
            mult = e.pair_risks[(h.coll, h.debt)].extra.get('conf_multiplier', 1.) if self.switches.pair_config else 1.
            pc = max(0, pc-mult*s.prices[c, 1]*1e10)
            pd += mult*s.prices[d, 1]*1e10
        collateral = round(h.collateral*10.**s.cfg[c, 14])
        debt_unit = 10.**(s.cfg[d, 14]-s.cfg[c, 14]) if self.switches.fix_decimals else 1.
        borrow = int(collateral*pc/pd*h.u*limit*debt_unit)
        step = dict(action='open', at=now, collToken=h.coll, debtToken=h.debt,
                    collateral=collateral, borrow=borrow, duration=round(h.term_s))
        i = int(s.meta[1])-1
        error = e.execute(step)
        if error:
            self.stats['reverts'] += 1
            return
        self.agent_rngs[i] = rng
        book.opened(i, h.strategy)
        self.refresh_heap(e, i)
        push(s.positions[i, SCHEDULE]-e.base+self.cfg.hss_delay_s, 3, 'hard', (i, h))
        push(now+h.term_s+900+self.keeper.latency_s, 2, 'keeper_hard', (i, h))
        if miss_draw >= h.rho_miss:
            push(now+h.term_s-h.lead_s, 2, 'repay', (i, h))

    def action(self, e, book, action, i, now):
        before = clone(e.state)
        error = e.execute(dict(action=action, at=now, id=i+1, actor='keeper' if action == 'softLiquidate' else 'alice', amount=10**26))
        if error:
            self.stats['reverts'] += 1
        else:
            book.observe(before, action, i)
            self.refresh_heap(e, i)
        return error

    def scan(self, e, now, push, pending):
        s = e.state
        eligible = set()
        for pair in self.active_heap.heaps:
            top = self.active_heap.top(pair)
            if top is None:
                continue
            c, d = pair
            try:
                ratio = price(s, c)/price(s, d)
            except (ValueError, ZeroDivisionError):
                continue
            if ratio <= top[0]:
                eligible.add(pair)
        if not eligible:
            return
        for i in range(int(s.meta[1])-1):
            p = s.positions[i]
            if not p[ACTIVE] or i in pending:
                continue
            c, d = int(p[COLL]), int(p[DEBT])
            if (c, d) not in eligible:
                continue
            rate = apy(s, d)/WAD/YEAR
            accrued = (p[PRINCIPAL]+p[ACCRUED])*math.expm1(rate*max(0, e.now-p[LAST]))
            total = p[PRINCIPAL]+p[ACCRUED]+accrued if self.switches.fix_debt_accounting else p[B]+accrued
            try:
                hf = health(s, i, total, price(s, c), price(s, d), e.threshold_nb)
            except ValueError:
                continue
            if hf <= WAD:
                pending.add(i)
                push(now+self.keeper.latency_s, 2, 'soft', (i, None))

    def refresh_heap(self, e, i):
        s, p = e.state, e.state.positions[i]
        pair = int(p[COLL]), int(p[DEBT])
        if not p[ACTIVE]:
            self.active_heap.discard(pair, i)
            return
        cfg = e.pair_risks.get((e.tokens[pair[0]], e.tokens[pair[1]]))
        lam = cfg.lam if cfg and e.risk_model.time_free else .75
        units = 10.0**(s.cfg[pair[0], 14]-s.cfg[pair[1], 14]) if s.switches[2] else 1.
        debt = max(p[B], p[PRINCIPAL]+p[ACCRUED])
        growth = math.exp(1.075/YEAR*max(0, e.base+e.horizon_s-p[LAST]))
        conf = self.max_conf if s.switches[5] else 0.
        barrier = debt*units*growth/max(1e-20, p[C]*lam)*(1+conf)/max(1e-12, 1-conf)
        self.active_heap.update(pair, i, barrier)

    def roll(self, e, data, now, book, push, rng):
        h, old = data
        self.open_holder(e, h, now, book, push, self.agent_rngs[old])
