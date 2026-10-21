"""P3c event oracle tapes with P3b push semantics: per-asset heartbeat since the asset's last push."""
import numpy as np
from chrono_sim.oracle.event import window_tape, pub

H = 60.


def tape(obs, start=60., changes=(0.,), up=(True,), deviation=.005, enter=None):
    obs = np.log(np.asarray(obs, float))
    n, k = obs.shape
    size = 4*k+16
    t, v, scan = np.zeros(size), np.zeros((3, n, size)), np.zeros(size, np.bool_)
    enter = np.array([[1.]*n, [.001]*n, [0.]*n]) if enter is None else enter
    m = window_tape(start, start+H, .4, deviation, H, obs, np.full_like(obs, .001), k,
                    np.asarray(changes, float), np.asarray(up), enter, t, v, scan)
    return t[:m], v[:, :, :m], scan[:m]


def pushes(t, v, a):
    return [float(t[i]) for i in range(len(t)) if i == 0 and v[2, a, 0] == t[0] or i and v[2, a, i] != v[2, a, i-1]]


def test_deviation_push_moves_that_assets_next_heartbeat():
    first = np.ones((2, 60))
    first[0, 20:] = 1.006
    t, v, _ = tape(first)
    assert pushes(t, v, 0) == [60., pub(80., .4)] and pushes(t, v, 1) == [60.]
    t2, v2, _ = tape(np.vstack([np.full(60, 1.006), np.ones(60)]), start=120., enter=v[:, :, -1].copy())
    # Asset 1 is due 60 s after its push at 60; asset 0 only 60 s after its deviation push at 80.
    assert pushes(t2, v2, 1) == [120.] and pushes(t2, v2, 0) == [pub(140., .4)]


def test_outage_defers_the_due_heartbeat_to_the_recovery_tick():
    enter = np.array([[1.], [.001], [12.]])
    t, v, scan = tape(np.full((1, 60), 1.001), changes=(0., 50., 75.3), up=(True, False, True), enter=enter)
    recovery = np.ceil(75.3/.4)*.4
    assert pushes(t, v, 0) == [recovery] and not scan[list(t).index(recovery)]
    # The next heartbeat is due 60 s after the recovery push, not on the 60 s grid.
    assert all(v[2, 0, i] in (12., recovery) for i in range(len(t)))


def test_scan_ticks_are_integer_seconds_and_publication_ticks():
    t, _, scan = tape(np.ones((1, 60)))
    ticks = set(np.round(t[scan], 9))
    expected = set(np.round([float(s) for s in range(60, 120)]+[pub(float(s), .4) for s in range(60, 120)], 9))
    assert ticks == expected and np.all(np.diff(t) > 0)
