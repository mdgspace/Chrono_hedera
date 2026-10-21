"""NEG as coded: the final-hour health-factor revert blocks soft liquidation when T_rem < 1 h."""
from types import SimpleNamespace

import numpy as np

from chrono_sim.engine import Holder
from scripts import equiv_engine


def opened_engine(switches_name):
    cell = dict(market='MK1', model='NEG', book=10, ltv='base', switches=switches_name)
    loop = equiv_engine.make_loop(cell, 'reference')
    batch = SimpleNamespace(assets=('HBAR', 'USDC'), log_price=np.log([[[2.], [1.]]]), t=np.array([0., 7200.]))
    e = loop.make_engine(batch, [Holder('HBAR', 'USDC', term_s=7200.)])
    # 100 HBAR at $2 against 150 USDC (8 decimals), a 2 h loan.
    assert e.execute(dict(action='open', at=0, collToken='HBAR', debtToken='USDC', collateral=100*10**8,
                          borrow=150*10**8, duration=7200, actor='alice')) is None
    return e


def crash_then_liquidate(e, at):
    # HBAR at $1: collateral $100 against $150 debt, underwater for any LT <= 1.
    assert e.execute(dict(action='setPrice', at=at, prices={'HBAR': '100000000', 'USDC': '100000000'})) is None
    return e.execute(dict(action='softLiquidate', at=at, id=1, actor='keeper', amount=10**26))


def test_as_coded_switches_differ_from_m0_only_in_final_hour_fix():
    from dataclasses import asdict
    m0, coded = asdict(equiv_engine.switches('m0')), asdict(equiv_engine.switches('as_coded'))
    assert {k for k in m0 if m0[k] != coded[k]} == {'fix_final_hour'}
    assert coded['fix_final_hour'] is False and coded['pair_config'] is True


def test_neg_soft_liquidation_reverts_in_final_hour_as_coded():
    error = crash_then_liquidate(opened_engine('as_coded'), 7200-3599)  # T_rem = 3,599 s
    assert error is not None and error.signature == 'InvalidDuration(uint256,uint256,uint256)'


def test_neg_soft_liquidation_succeeds_before_final_hour_as_coded():
    assert crash_then_liquidate(opened_engine('as_coded'), 7200-3601) is None  # T_rem = 3,601 s
