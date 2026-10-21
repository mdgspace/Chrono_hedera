"""Per-window description of the held cross rate: realised annual vol of minute log returns, min/start, end/start.

Usage: python scripts/window_stats.py SERIES.npz OUT.json
"""
import json
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import replay_engine as r  # noqa: E402

t, close, _ = r.series(sys.argv[1])
policy = json.loads(r.MANIFEST.read_text())['calibration_split_policy']
out = {}
for s in r.window_starts(t, policy):
    i = int(np.searchsorted(t, s)); m = int(r.HORIZON_S)//60+1
    x = close[i:i+m]
    out[str(int((s-r.JAN1_2024_NS)//r.DAY))] = dict(vol=float(np.std(np.diff(np.log(x)))*np.sqrt(525600)),
        low_over_start=float(x.min()/x[0]), end_over_start=float(x[-1]/x[0]))
Path(sys.argv[2]).write_text(json.dumps(out)+'\n')
print(len(out))
