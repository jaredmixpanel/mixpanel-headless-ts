"""THROWAWAY probe #3 — pydantic-core lax str->int grammar (viewNLimit)."""

from __future__ import annotations

import json

import pydantic

from mixpanel_headless._internal.bookmark_schema import InsightsBookmarkSortConfig

SAMPLES = [
    "5",
    "05",
    "00",
    "+5",
    "-5",
    "- 5",
    "+-5",
    "1_0",
    "1__0",
    "_1",
    "1_",
    "1_0.0",
    "5.",
    ".5",
    "5.0",
    "5.00",
    "-5.0",
    "1e3",
    "1E3",
    "1e-3",
    "1.5e1",
    "0x5",
    "0b1",
    "0o7",
    "inf",
    "nan",
    "Infinity",
    "5 5",
    "\t5\n",
    "\r\n5",
    "\x0b5",
    "\x0c5",
    "\x855",  # NEL, Unicode White_Space
    " 5",  # LINE SEPARATOR
    "　5",  # IDEOGRAPHIC SPACE
    "５",  # fullwidth digit
    "5​",
    "9007199254740993",
    "-9007199254740993",
    "1" * 30,
    "1.0000000000000001",
    "  +1_0.0  ",
]

for s in SAMPLES:
    payload = {
        "bar": {"sortBy": "value", "sortOrder": "asc", "colSortAttrs": [], "viewNLimit": s}
    }
    try:
        InsightsBookmarkSortConfig.model_validate(payload)
        out = {"input": s, "ok": True}
    except pydantic.ValidationError as exc:
        out = {"input": s, "ok": False, "type": exc.errors()[0]["type"]}
    print(json.dumps(out))
