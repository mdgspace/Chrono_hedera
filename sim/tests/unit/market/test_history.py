import json
import numpy as np
import polars as pl
import pytest
from chrono_sim.market.history import DataUnavailable, load_snapshot, longest_run, sha256_file


def test_snapshot_integrity_completed_clock_and_leakage_filter(tmp_path):
    files = []
    for name in ('HBAR', 'ETH'):
        path = tmp_path/f'{name}.parquet'
        pl.DataFrame({'timestamp_ns': np.arange(8)*60_000_000_000,
                      'price': np.arange(8)+10., 'low': np.arange(8)+9.,
                      'confidence': np.ones(8)}).write_parquet(path)
        files.append(dict(path=path.name, symbol=name+'USD', venue='proxy', interval='1m',
                          sha256=sha256_file(path)))
    manifest = tmp_path/'manifest.json'
    manifest.write_text(json.dumps(dict(snapshot='snapshot_v1', status='complete', files=files,
        calibration_split_policy={'exclude_at_or_after_ns': 480_000_000_000,
                                  'holdout_windows_ns': [[120_000_000_000, 180_000_000_000]]})))
    t, p, low, conf, lineage = load_snapshot(tmp_path, manifest, ('HBAR', 'ETH'), calibration=True)
    assert t.tolist() == [60_000_000_000, 240_000_000_000, 300_000_000_000, 360_000_000_000, 420_000_000_000]
    assert lineage['calibration_split_applied']
    assert p.shape == low.shape == conf.shape == (2, 5)
    x, *_ = longest_run(t, p, low, conf, step_ns=60_000_000_000)
    assert len(x) == 4
    (tmp_path/'HBAR.parquet').write_bytes(b'changed')
    with pytest.raises(ValueError, match='hash'):
        load_snapshot(tmp_path, manifest, ('HBAR',))


def test_unobserved_one_second_composite_rejected(tmp_path):
    manifest = tmp_path/'manifest.json'
    manifest.write_text(json.dumps(dict(snapshot='snapshot_v1', status='complete', files=[])))
    with pytest.raises(DataUnavailable, match='no observed'):
        load_snapshot(tmp_path, manifest, ('HBAR',), interval='1s')
