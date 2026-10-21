"""Exponent overflow must revert without attempting an enormous Python power."""
import pytest
from chrono_sim.protocol.ref.oracle_adapter import power10
from chrono_sim.protocol.ref.wad import Revert


def test_power10_uint256_boundary_is_bounded():
    assert power10(77) == 10**77
    for exponent in (78, 2**31):
        with pytest.raises(Revert) as error:
            power10(exponent)
        assert error.value.code == 0x11
