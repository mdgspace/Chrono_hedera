"""Flat undiscounted capacity control; retains the maturity-value test."""
from .base import BaseModel
from .kernels import open_limit_nb, threshold_nb


class B0_cap(BaseModel):
    name = 'B0_cap'
    code = 3
