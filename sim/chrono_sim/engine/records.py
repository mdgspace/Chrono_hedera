"""I5 path and position ledgers, in USD and debt-dollar seconds."""
from dataclasses import dataclass
from pathlib import Path
import math
import numpy as np
import polars as pl
from numba import njit
from chrono_sim.protocol.fast.state import *
from chrono_sim.protocol.fast.math import YEAR, WAD, wm
from chrono_sim.protocol.fast.pools import apy, accrual_delta
from chrono_sim.protocol.fast.vault import price

POSITION_SCHEMA = {
    'path_id': pl.Int64, 'position_id': pl.Int64, 'pair': pl.String, 'debt_token': pl.String,
    'model': pl.String, 'lender_loss': pl.Float64, 'sp_pnl': pl.Float64, 'sp_disposal_pnl': pl.Float64,
    'reserve_pnl': pl.Float64, 'borrower_cost': pl.Float64, 'debt_time_integral': pl.Float64,
    'soft_external': pl.Int64, 'soft_sp': pl.Int64, 'hard_sp': pl.Int64, 'hard_reserve': pl.Int64,
    'open_ltv': pl.Float64, 'principal_usd': pl.Float64, 'term_s': pl.Float64,
    'opened_at': pl.Float64, 'first_liquidation_at': pl.Float64, 'outcome': pl.String,
    'strategy': pl.String, 'rollover_payoff': pl.Float64, 'stop_reason': pl.String,
}
PATH_SCHEMA = {'path_id': pl.Int64, 'horizon_s': pl.Float64, 'conservation_error': pl.Float64,
               'reserve_reimbursement': pl.Float64, 'lender_loss': pl.Float64,
               'debt_time_integral': pl.Float64}


@dataclass(frozen=True)
class PathRecords:
    positions: pl.DataFrame
    paths: pl.DataFrame

    def validate(self):
        for frame, schema in ((self.positions, POSITION_SCHEMA), (self.paths, PATH_SCHEMA)):
            if not set(schema).issubset(frame.columns):
                raise ValueError('incomplete I5 record schema')
            if any(frame[name].null_count() for name in schema):
                raise ValueError('null record fields')
            for name, dtype in schema.items():
                if dtype == pl.Float64 and not frame[name].is_finite().all():
                    raise ValueError(f'nonfinite record {name}')
        if self.positions.select(pl.struct('path_id', 'position_id').n_unique()).item() != len(self.positions):
            raise ValueError('duplicate position records')
        if self.paths['path_id'].n_unique() != len(self.paths):
            raise ValueError('duplicate path records')
        if set(self.positions['path_id'])-set(self.paths['path_id']):
            raise ValueError('positions without path rows')
        if (self.paths['conservation_error'] > 1e-9).any():
            raise AssertionError('per-path conservation exceeds 1e-9')
        if (self.positions['lender_loss'] < 0).any() or (self.positions['debt_time_integral'] < 0).any():
            raise ValueError('negative loss or exposure')
        return self

    def write(self, directory):
        self.validate()
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True)
        self.positions.write_parquet(directory/'positions.parquet')
        self.paths.write_parquet(directory/'paths.parquet')

    @classmethod
    def read(cls, directory):
        root = Path(directory)
        return cls(pl.read_parquet(root/'positions.parquet'), pl.read_parquet(root/'paths.parquet')).validate()

    @classmethod
    def concat(cls, records):
        return cls(pl.concat([r.positions for r in records]), pl.concat([r.paths for r in records])).validate()


def mark(s, token, amount):
    # Marking an already settled receipt does not require a second oracle read.
    raw, _, expo, _, _ = s.prices[token]
    mid = raw/WAD if s.meta[2] else raw*10.0**expo
    return float(amount*mid/10.0**s.cfg[token, 14])


@njit(cache=True)
def grid_exposure(t, prices, begin, end, ledger, vault, rate, last, corrected):
    """Integrate debt against held I3 prices on the actual simulation clock."""
    value, now = 0., begin
    k = max(0, np.searchsorted(t, begin, side='right')-1)
    while now < end:
        stop = min(end, t[k+1]) if k+1 < len(t) else end
        dt = stop-now
        growth = math.exp(rate*max(0., now-last))
        amount = ledger*growth*math.expm1(rate*dt)/rate if rate else ledger*dt
        if not corrected:
            amount += (vault-ledger)*dt
        value += prices[k]*amount
        now = stop
        k += 1
    return value


class RecordBook:
    def __init__(self, path_id, engine, impact=0.0, basis=0.0, reserve_reimburses=True, price_grid=None):
        if not 0 <= impact <= 1 or not 0 <= basis <= 1:
            raise ValueError('impact and basis must lie in [0,1]')
        self.path_id, self.engine = path_id, engine
        self.price_grid = price_grid
        self.disposal = (1-impact)*(1-basis)
        self.reserve_reimburses = reserve_reimburses
        self.rows, self.clocks = {}, {}
        self.open_marks, self.gains, self.interest_cost, self.equity = {}, {}, {}, {}

    def opened(self, i, strategy='holder'):
        e, s = self.engine, self.engine.state
        p = s.positions[i]
        c, d = int(p[COLL]), int(p[DEBT])
        cv, dv = mark(s, c, p[C]), mark(s, d, p[B])
        row = {k: 0 if v == pl.Int64 else 0.0 for k, v in POSITION_SCHEMA.items()}
        row.update(path_id=self.path_id, position_id=i+1, pair=f'{e.tokens[c]}/{e.tokens[d]}',
                   debt_token=e.tokens[d], model=e.risk_model.name if e.risk_model else 'as-coded',
                   open_ltv=dv/cv, principal_usd=dv, term_s=p[TERM], opened_at=p[START]-e.base,
                   first_liquidation_at=-1.0, outcome='active', strategy=strategy, stop_reason='')
        premium, sp_share = e.open_premiums.get(str(i+1), (0., 0.))
        row['borrower_cost'] = mark(s, d, premium)
        row['sp_pnl'] = row['sp_disposal_pnl'] = mark(s, d, sp_share)
        row['reserve_pnl'] = mark(s, d, premium-sp_share)
        self.open_marks[i] = mark(s, c, 1.)
        self.gains[i], self.interest_cost[i], self.equity[i] = 0., 0., cv-dv
        self.rows[i], self.clocks[i] = row, s.meta[0]

    def stopped(self, i, reason):
        """A roller that cannot reopen records why it stopped rolling."""
        self.rows[i]['stop_reason'] = reason

    def integrate(self, i, before, now):
        if i not in self.rows:
            return
        p = before.positions[i]
        elapsed = now-self.clocks[i]
        if p[ACTIVE] and elapsed > 0:
            rate = apy(before, int(p[DEBT]))/WAD/YEAR
            age = max(0, self.clocks[i]-p[LAST])
            debt = (p[PRINCIPAL]+p[ACCRUED])*math.exp(rate*age)
            integral = debt*math.expm1(rate*elapsed)/rate if rate else debt*elapsed
            if not self.engine.switches.fix_debt_accounting:
                integral += (p[B]-p[PRINCIPAL]-p[ACCRUED])*elapsed
            marked = mark(before, int(p[DEBT]), integral)
            if self.price_grid is not None:
                t, values = self.price_grid
                token = int(p[DEBT])
                marked = grid_exposure(t, values[token], self.clocks[i]-self.engine.base, now-self.engine.base,
                                       p[PRINCIPAL]+p[ACCRUED], p[B], rate, p[LAST]-self.engine.base,
                                       self.engine.switches.fix_debt_accounting)/10.**before.cfg[token, 14]
            self.rows[i]['debt_time_integral'] += marked
        self.clocks[i] = now

    def observe(self, before, action, i):
        if i not in self.rows or not before.positions[i, ACTIVE]:
            return
        s, row = self.engine.state, self.rows[i]
        before.meta[0] = s.meta[0]
        self.integrate(i, before, s.meta[0])
        p, q = before.positions[i], s.positions[i]
        c, d = int(p[COLL]), int(p[DEBT])
        cash = float(s.flows[d, :, -4].sum()-s.flows[d, -4, :].sum())
        written = before.lp[d, 0]-s.lp[d, 0]
        row['lender_loss'] += mark(s, d, max(0, written-cash))
        fees = float(s.flows[d, :, 0].sum()-s.flows[d, 0, :].sum())
        reserve_coll = float(s.flows[c, -2, 0])
        delta = accrual_delta(before, i)
        total = p[PRINCIPAL]+p[ACCRUED]+delta if self.engine.switches.fix_debt_accounting else p[B]+delta
        grace = wm(total, .015*WAD) if action == 'repay' and p[START]+p[TERM] < s.meta[0] <= p[START]+p[TERM]+900 else 0.
        row['reserve_pnl'] += mark(s, d, fees)+mark(s, c, reserve_coll)*self.disposal
        if action in ('softLiquidate', 'hardLiquidate', 'scheduled'):
            self.liquidation(before, action, i, cash)
        elif action == 'repay' and p[START]+p[TERM] < s.meta[0] <= p[START]+p[TERM]+900:
            row['borrower_cost'] += mark(s, d, grace)
        removed = p[C] if action in ('hardLiquidate', 'scheduled') and not q[ACTIVE] else p[C]-q[C]
        self.gains[i] += removed*(mark(s, c, 1.)-self.open_marks[i])
        self.interest_cost[i] += mark(s, d, max(0, cash-written+fees-grace))
        if not q[ACTIVE]:
            row['outcome'] = 'repaid' if action == 'repay' else 'liquidated'

    def liquidation(self, before, action, i, cash):
        s, row = self.engine.state, self.rows[i]
        p, q = before.positions[i], s.positions[i]
        c, d = int(p[COLL]), int(p[DEBT])
        paid = float(s.flows[d, -3, -1])
        received = float(s.flows[c, -2, -3])
        row['sp_pnl'] += mark(s, c, received)-mark(s, d, paid)
        row['sp_disposal_pnl'] += mark(s, c, received)*self.disposal-mark(s, d, paid)
        channel = ('soft_sp' if paid else 'soft_external') if action == 'softLiquidate' else ('hard_sp' if paid else 'hard_reserve')
        row[channel] += 1
        if row['first_liquidation_at'] < 0:
            row['first_liquidation_at'] = s.meta[0]-self.engine.base
        seized = p[C]-q[C]
        refunded = float(s.flows[c, -2, int(p[OWNER])])
        settled = cash
        if action != 'softLiquidate' and cash == 0:
            delta = accrual_delta(before, i)
            settled = p[PRINCIPAL]+p[ACCRUED]+delta if self.engine.switches.fix_debt_accounting else p[B]+delta
        row['borrower_cost'] += max(0, mark(s, c, seized-refunded)-mark(s, d, settled))
        if action != 'softLiquidate' and cash == 0:
            delta = accrual_delta(before, i)
            row['lender_loss'] += mark(s, d, p[ACCRUED]+delta)
            row['borrower_cost'] += mark(s, c, q[C])

    def finish(self, horizon_s):
        e, s = self.engine, self.engine.state
        for i, row in self.rows.items():
            self.integrate(i, s, e.base+horizon_s)
            p = s.positions[i]
            if p[ACTIVE] and p[C] == 0:
                rate = apy(s, int(p[DEBT]))/WAD/YEAR
                debt = (p[PRINCIPAL]+p[ACCRUED])*math.exp(rate*max(0, e.base+horizon_s-p[LAST]))
                row['lender_loss'] += mark(s, int(p[DEBT]), debt)
            gain = self.gains[i]+p[C]*(mark(s, int(p[COLL]), 1.)-self.open_marks[i]) if p[ACTIVE] else self.gains[i]
            row['rollover_payoff'] = (gain-self.interest_cost[i]-row['borrower_cost'])/max(1e-12, self.equity[i])
        loss = sum(r['lender_loss'] for r in self.rows.values())
        reserve = sum(max(0, mark(s, t, s.balances[t, 0]-e.initial_owner[t])) for t in range(len(e.tokens)))
        reimbursement = min(loss, reserve) if self.reserve_reimburses else 0.0
        # Gross loss stays available by position; path loss is net of explicit policy.
        path = dict(path_id=self.path_id, horizon_s=horizon_s, conservation_error=max(e.check_conservation(), e.max_conservation_error),
                    reserve_reimbursement=reimbursement, lender_loss=loss-reimbursement,
                    debt_time_integral=sum(r['debt_time_integral'] for r in self.rows.values()))
        return PathRecords(pl.DataFrame(list(self.rows.values()), schema=POSITION_SCHEMA),
                           pl.DataFrame([path], schema=PATH_SCHEMA)).validate()
