"""The replay may read nothing at or after 2026-01-01 or inside a holdout window (snapshot_v1 split policy)."""
import json

import numpy as np
import pytest

from chrono_sim.market.history import HoldoutViolation, assert_allowed, span_allowed
from scripts import replay_engine

POLICY = json.loads(replay_engine.MANIFEST.read_text())['calibration_split_policy']
DAY = 86_400*10**9
CUT = POLICY['exclude_at_or_after_ns']
OCT9, OCT12 = POLICY['holdout_windows_ns'][0]


def test_guard_refuses_cutoff_and_every_holdout_second():
    assert_allowed(np.array([CUT-1, OCT9-1, OCT12+1]), POLICY)
    for bad in (CUT, CUT+DAY, OCT9, OCT12, (OCT9+OCT12)//2, POLICY['holdout_windows_ns'][1][0]):
        with pytest.raises(HoldoutViolation):
            assert_allowed(np.array([OCT9-DAY, bad]), POLICY)


def test_guard_fails_closed_without_a_policy():
    with pytest.raises(HoldoutViolation):
        assert_allowed(np.array([0]), {})


def test_span_rejects_any_overlap():
    assert span_allowed(OCT12+1, OCT12+DAY, POLICY)
    assert not span_allowed(OCT9-DAY, OCT9, POLICY)
    assert not span_allowed(OCT9-30*DAY, OCT12+DAY, POLICY)
    assert not span_allowed(CUT-DAY, CUT, POLICY)


def test_file_selection_reads_no_holdout_or_2026_file():
    state = json.loads(replay_engine.MANIFEST.read_text())
    for symbol in ('HBARUSDT', 'USDCUSDT', 'BTCUSDT'):
        files = replay_engine.select_files(state, symbol)
        months = [f['month'] for f in files]
        assert months == [f'{y}-{m:02d}' for y in (2024, 2025) for m in range(1, 13) if (y, m) != (2025, 10)]
        for f in files:
            assert span_allowed(f["observed_start_ns"], f["observed_end_ns"]+60*10**9-1, POLICY)  # trades of the last candle


def test_windows_are_daily_covered_and_clear_of_the_holdout():
    minute = 60*10**9
    start = replay_engine.JAN1_2024_NS
    clock = np.arange(start+minute, CUT, minute)  # completion times of every 2024-2025 minute candle
    hole = (clock >= OCT9-8*DAY) & (clock <= OCT12+20*DAY)  # like the excluded October 2025 file
    clock = clock[~hole]
    starts = replay_engine.window_starts(clock, POLICY)
    horizon = int(replay_engine.HORIZON_S)*10**9
    have = set(clock.tolist())
    assert len(starts) > 600 and starts[0] == start+DAY  # 2024-01-01 00:00 has no completed candle yet
    for s in starts:
        assert (s-start) % DAY == 0
        assert span_allowed(s, s+horizon, POLICY)
        assert all(c in have for c in range(s, s+horizon+1, minute))  # every held close is observed
    assert starts[-1]+horizon < CUT
