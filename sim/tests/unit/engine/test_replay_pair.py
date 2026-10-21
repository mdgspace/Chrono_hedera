"""--base/--quote build a BTCUSDT/USDCUSDT cross from verified archives, and --pair BTC_USDC runs it with BTC collateral."""
import hashlib
import json
import zipfile

import numpy as np
import pytest

from scripts import equiv_engine as ee
from scripts import replay_engine as re_

MINUTE_MS = 60_000


def archive(directory, symbol, prices):
    t = re_.JAN1_2024_NS//10**6+MINUTE_MS*np.arange(len(prices))
    rows = ''.join(f'{a},{p},{p*1.001},{p*.999},{p},1,{a+MINUTE_MS-1},0,0,0,0,0\n' for a, p in zip(t, prices))
    path = directory/f'{symbol}-1m-2024-01.zip'
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr(path.with_suffix('.csv').name, rows)
    return dict(symbol=symbol, month='2024-01', url=f'https://example.invalid/{path.name}',
                sha256=hashlib.sha256(path.read_bytes()).hexdigest(), observed_start_ns=re_.JAN1_2024_NS,
                observed_end_ns=re_.JAN1_2024_NS+(len(prices)-1)*MINUTE_MS*10**6)


@pytest.fixture(scope='module')
def btc_series(tmp_path_factory):
    d = tmp_path_factory.mktemp('btc')
    n = 31*1440
    btc = np.round(42000*np.exp(np.cumsum(np.random.default_rng(5).normal(0, 1e-3, n))), 2)
    btc[1440+30:] = np.round(btc[1440+30:]*.6, 2)  # a crash 30 min into the second day
    usdc = np.round(1+1e-4*np.sin(np.arange(n)), 4)
    state = dict(calibration_split_policy=json.loads(re_.MANIFEST.read_text())['calibration_split_policy'],
                 files=[archive(d, 'BTCUSDT', btc), archive(d, 'USDCUSDT', usdc)])
    manifest = d/'manifest.json'
    manifest.write_text(json.dumps(state))
    saved, re_.MANIFEST = re_.MANIFEST, manifest
    try:
        re_.prepare(d, d/'cross.npz', base='BTCUSDT', quote='USDCUSDT')
    finally:
        re_.MANIFEST = saved
    return d, btc/usdc


def test_prepare_builds_the_btc_cross_on_the_completed_candle_clock(btc_series):
    d, cross = btc_series
    z = np.load(d/'cross.npz')
    assert z['time_ns'][0] == re_.JAN1_2024_NS+60*10**9
    assert np.array_equal(z['close'], cross)
    assert json.loads((d/'cross.json').read_text())['label'].startswith('Binance cross-rate replay (BTCUSDT/USDCUSDT)')


def test_prepare_refuses_a_tampered_archive(btc_series, tmp_path):
    d, _ = btc_series
    f = dict(json.loads((d/'manifest.json').read_text())['files'][0], sha256='0'*64)
    with pytest.raises(ValueError, match='SHA-256'):
        re_.read_month(d/'BTCUSDT-1m-2024-01.zip', f)


def test_btc_pair_runs_with_btc_collateral_and_config(btc_series):
    d, _ = btc_series
    c = dict(market='replay', variant='hold', model='SPEC', book=10, ltv='stressed', switches='m0', pair='BTC_USDC')
    loop = ee.make_loop(c, 'reference', sigma=0.)
    assert list(loop.pairs) == [('BTC', 'USDC')] and loop.pairs['BTC', 'USDC'].extra['sigma'] == .5
    start = re_.JAN1_2024_NS+1440*60*10**9
    batch = re_.window_batch(str(d/'cross.npz'), start, 'hold', 4*3600., asset='BTC')
    records = loop.run(batch, ee.holders(10, .98, 'BTC', .001), np.random.default_rng(1))
    row = ee.summarise(records, 0)[0]
    assert batch.assets == ('BTC', 'USDC') and row['opened'] == 10
    assert 300 < row['principal'] < 420  # 10 positions of 0.001 BTC (~$42) at u = 0.98 of the open limit
    assert row['soft_sp']+row['soft_external'] > 0  # the 40% crash liquidates
