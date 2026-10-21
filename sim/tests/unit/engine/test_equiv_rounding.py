"""Equivalence amendment 2026-10-19 (P3C_METHOD.md section 12): KS and AD see values rounded to relative 1e-9."""
import importlib.util
import math
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).parents[3]
SPEC = importlib.util.spec_from_file_location('equiv_analyze', ROOT/'scripts'/'equiv_analyze.py')
ea = importlib.util.module_from_spec(SPEC)
sys.modules['equiv_analyze'] = ea
SPEC.loader.exec_module(ea)

BASE = 538920795.163


def row(debt_time, loss=0., t1=None):
    nodes = {n: [0, 1] for n in ea.NODES}
    return dict(debt_time=debt_time, soft_sp=0, soft_external=0, hard_sp=0, hard_reserve=0, loss=loss,
                cost=1., principal=100., first_liquidation=t1, nodes=nodes)


def scattered(value, k):
    for _ in range(k % 12):
        value = math.nextafter(value, math.inf)
    return value


def engines():
    """Reference stores each atom as up to 12 last-bit variants; the adaptive engine stores one float."""
    atoms = [BASE, 6.1e8, 7.25e8]
    ref = [row(scattered(atoms[k % 3], k)) for k in range(240)]
    ada = [row(atoms[k % 3]) for k in range(240)]
    return {'cell': ref}, {'cell': ada}


def test_rounding_merges_ulp_variants_and_keeps_distinct_values():
    x = np.array([scattered(BASE, k) for k in range(12)] + [BASE*(1+3e-9), 0.])
    r = ea.round_relative(x)
    assert len(set(r[:12])) == 1 and r[0] == float(f'{BASE:.9e}')
    assert r[12] != r[0] and r[13] == 0.
    assert np.all(np.abs(r[:13]-x[:13]) <= 5e-10*np.abs(x[:13]))


def test_ks_and_ad_ignore_ulp_scatter_after_rounding():
    ref, ada = engines()
    tests = {t['test']: t for t in ea.difference(ref, ada, {})}
    assert tests['KS']['p'] > .5 and tests['AD']['p'] > .5 and not any(t['significant'] for t in tests.values())


def test_registered_unrounded_analysis_is_still_reproducible():
    ref, ada = engines()
    tests = {t['test']: t for t in ea.difference(ref, ada, {}, digits=0)}
    assert tests['KS']['p'] < 1e-6 and tests['KS']['significant']


def test_means_and_tost_use_unrounded_values():
    ref, ada = engines()
    family, _ = ea.primary(ref, ada)
    dt = np.array([r['debt_time'] for r in ref['cell']])
    ra = np.array([r['debt_time'] for r in ada['cell']])
    assert math.isclose(family['debt_time']['theta'], math.log(ra.mean()/dt.mean()), rel_tol=0, abs_tol=1e-15)


def test_holm_step_down():
    adjusted, reject = ea.holm([.001, .04, .03, .5], alpha=.05)
    assert reject == [True, False, False, False]
    assert np.allclose(adjusted, [.004, .09, .09, .5])
    with pytest.raises(ValueError):
        ea.holm([float('nan')])
