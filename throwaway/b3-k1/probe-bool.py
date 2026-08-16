"""B3-K1 probe 5: float->bool acceptance boundary."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict
from pydantic import ValidationError as PydanticValidationError


class B(BaseModel):
    """Probe model with one bool field."""

    model_config = ConfigDict(extra="forbid")
    v: bool | None = None


def run(v: Any) -> str:
    """Return the error type or ``OK``."""
    try:
        B.model_validate({"v": v})
    except PydanticValidationError as exc:
        return str(exc.errors()[0]["type"])
    return "OK"


for v in [2.0, -0.0, 1.0000001, 0.5, -1.0, 3, -1, 1, 0, 2.5, 1e300]:
    print(f"{v!r:<14} {run(v)}")
