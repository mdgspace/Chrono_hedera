"""Verified, synchronised snapshot-v1 observations without gap filling."""

import hashlib
import json
from pathlib import Path
import numpy as np
import polars as pl


def sha256_file(path):
    """Hash file bytes without loading a data snapshot into memory."""
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


class DataUnavailable(ValueError):
    """The requested historical clock or assets are not present in the snapshot."""


def load_snapshot(root, manifest, assets, interval='1m', venue='proxy', start_ns=None,
                  end_ns=None, calibration=False):
    root, manifest = Path(root).expanduser().resolve(), Path(manifest).expanduser()
    state = json.loads(manifest.read_text())
    if state.get('snapshot') != 'snapshot_v1' or state.get('status') != 'complete':
        raise DataUnavailable('a frozen complete snapshot_v1 is required')
    step = {'1m': 60_000_000_000, '1s': 1_000_000_000}[interval]
    joined, lineage = None, []
    for asset in assets:
        frame, hashes = _asset(root, state, asset, venue, interval, step, start_ns, end_ns)
        lineage.extend(hashes)
        joined = frame if joined is None else joined.join(frame, on='time', how='inner')
    if calibration:
        joined = _calibration(joined, state.get('calibration_split_policy', {}))
    joined = joined.sort('time').drop_nulls()
    if joined.height < 3:
        raise DataUnavailable('fewer than three common valid historical observations')
    if joined['time'].n_unique() != joined.height:
        raise ValueError('overlapping source observations require reconciliation')
    arrays = [joined.select([f'{kind}_{a}' for a in assets]).to_numpy().T for kind in ('p', 'l', 'c')]
    return joined['time'].to_numpy(), *arrays, {
        'snapshot': 'snapshot_v1', 'manifest_sha256': sha256_file(manifest),
        'files': lineage, 'venue': venue, 'interval': interval,
        'calibration_split_applied': calibration, 'clock': 'completed candle',
    }


def _asset(root, state, asset, venue, interval, step, start, end):
    symbol = asset+'USD' if venue == 'proxy' else asset
    items = [x for x in state['files'] if x.get('symbol') == symbol and
             x.get('venue') == venue and x.get('interval') == interval and
             (start is None or x.get('returned_end_ns', -1) >= start-step) and
             (end is None or x.get('returned_start_ns', 2**63-1) <= end)]
    if not items:
        raise DataUnavailable(f'no observed {venue} {symbol} {interval} data')
    frames, hashes = [], []
    for item in items:
        path = (root/item['path']).resolve()
        if not path.is_relative_to(root) or sha256_file(path) != item['sha256']:
            raise ValueError('historical source failed snapshot hash verification')
        f = pl.read_parquet(path)
        if 'data_kind' in f.columns and f['data_kind'].str.contains('held').any():
            raise DataUnavailable('modelled held publications are not observed replay data')
        price = 'price' if 'price' in f.columns else 'close'
        f = f.filter(pl.col(price).is_finite() & (pl.col(price) > 0))
        if 'gap_flag' in f.columns:
            f = f.filter(pl.col('gap_flag').is_in(['ok', 'no_trades']))
        conf = pl.col('confidence')/pl.col(price) if 'confidence' in f.columns else pl.lit(0.)
        f = f.select((pl.col('timestamp_ns')+step).alias('time'), pl.col(price).alias(f'p_{asset}'),
                     pl.col('low').alias(f'l_{asset}'), conf.alias(f'c_{asset}'))
        if start is not None:
            f = f.filter(pl.col('time') >= start)
        if end is not None:
            f = f.filter(pl.col('time') <= end)
        frames.append(f)
        hashes.append({'path': item['path'], 'sha256': item['sha256']})
    return pl.concat(frames), hashes


def _calibration(frame, policy):
    if 'exclude_at_or_after_ns' in policy:
        frame = frame.filter(pl.col('time') < policy['exclude_at_or_after_ns'])
    for left, right in policy.get('holdout_windows_ns', []):
        frame = frame.filter(~pl.col('time').is_between(left, right, closed='both'))
    return frame


def longest_run(times, *arrays, step_ns):
    cuts = np.r_[0, np.flatnonzero(np.diff(times) != step_ns)+1, len(times)]
    i = np.argmax(np.diff(cuts))
    sl = slice(cuts[i], cuts[i+1])
    if cuts[i+1]-cuts[i] < 3:
        raise DataUnavailable('no contiguous common historical run')
    return (times[sl], *(a[:, sl] for a in arrays))


class HoldoutViolation(ValueError):
    """A timestamp at or after the calibration cutoff, or inside a sealed holdout window."""


def _policy(policy):
    try:
        return int(policy['exclude_at_or_after_ns']), [(int(a), int(b)) for a, b in policy['holdout_windows_ns']]
    except (KeyError, TypeError, ValueError) as exc:
        raise HoldoutViolation('a calibration split policy with cutoff and holdout windows is required') from exc


def assert_allowed(times_ns, policy):
    """Refuse any timestamp at/after the cutoff or inside a closed holdout window (fail closed)."""
    cut, windows = _policy(policy)
    t = np.asarray(times_ns, dtype=np.int64)
    if t.size and t.max() >= cut:
        raise HoldoutViolation('timestamp at or after the calibration cutoff')
    for left, right in windows:
        if np.any((t >= left) & (t <= right)):
            raise HoldoutViolation('timestamp inside a holdout window')


def span_allowed(start_ns, end_ns, policy):
    """True iff the closed span [start, end] ends before the cutoff and touches no holdout window."""
    cut, windows = _policy(policy)
    return end_ns < cut and all(end_ns < left or start_ns > right for left, right in windows)
