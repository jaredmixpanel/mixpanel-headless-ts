"""B3-K1 probe 6: the integral-float -> bool / int boundary (i64 range?)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict
from pydantic import ValidationError as PydanticValidationError


class B(BaseModel):
    """Probe model with one bool field."""

    model_config = ConfigDict(extra="forbid")
    v: bool | None = None


class I(BaseModel):  # noqa: E742
    """Probe model with one int field."""

    model_config = ConfigDict(extra="forbid")
    v: int | None = None


def run(model: type[BaseModel], v: Any) -> str:
    """Return the error type or ``OK``."""
    try:
        model.model_validate({"v": v})
    except PydanticValidationError as exc:
        return str(exc.errors()[0]["type"])
    return "OK"


I64_MAX = 2**63 - 1
for v in [
    2.0,
    1e15,
    1e18,
    float(2**53),
    float(2**62),
    float(2**63),
    float(2**63 + 100000),
    float(2**64),
    1e300,
    -1e300,
    float(-(2**63)),
    float(-(2**63) - 100000),
    2**63,
    2**64,
    2**70,
    -(2**70),
]:
    print(f"{v!r:<26} bool={run(B, v):<14} int={run(I, v)}")
print("I64_MAX", I64_MAX)
