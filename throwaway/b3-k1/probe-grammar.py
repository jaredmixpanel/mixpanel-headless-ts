"""B3-K1: pin pydantic-core's lax float / bool / int string grammars."""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, ConfigDict
from pydantic import ValidationError as PydanticValidationError


class F(BaseModel):
    """Probe model with one float field."""

    model_config = ConfigDict(extra="forbid")
    v: float | None = None


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


CANDIDATES: list[Any] = [
    "5",
    "5.",
    ".5",
    "1e3",
    "1E3",
    "1e+3",
    "1e-3",
    "-1.5",
    "+1.5",
    "  1.5  ",
    "1_0",
    "1_0.5",
    "1.0_0",
    "1__0",
    "_1",
    "1_",
    "inf",
    "Inf",
    "INF",
    "infinity",
    "-inf",
    "nan",
    "NaN",
    "0x5",
    "",
    " ",
    " 5",
    "﻿5",
    "٥",
    "5\n",
    "\t5",
    "\x1c5",
    "1,000",
    "true",
    "True",
    "TRUE",
    "false",
    "False",
    "yes",
    "Yes",
    "no",
    "on",
    "off",
    "t",
    "f",
    "y",
    "n",
    "1",
    "0",
    "2",
    "-1",
    "1.0",
    "0.0",
    " true ",
    "﻿true",
    "enable",
    float("inf"),
    float("nan"),
    1,
    0,
    2,
    -1,
    1.0,
    0.0,
    1.5,
    True,
    False,
    None,
    [],
    {},
]

out = []
for c in CANDIDATES:
    out.append(
        {
            "value": repr(c),
            "float": run(F, c),
            "bool": run(B, c),
            "int": run(I, c),
        }
    )
print(json.dumps(out, indent=1, ensure_ascii=False))
