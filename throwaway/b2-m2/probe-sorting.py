"""THROWAWAY (b2-packets.md §V1b "Mandatory probe before implementing").

Drives `validate_sorting_block` and the raw pydantic mirror across every
S-code branch plus the fallthrough branches, recording pydantic's error
ORDER, `loc` tuples and `type` strings so the hand-rolled TS twin
(`packages/core/src/bookmarks/schema-sorting.ts`) can reproduce them.

Run: cd /Users/jaredmcfarland/Developer/mixpanel-headless &&
     uv run python ../mixpanel-headless-ts/throwaway/b2-m2/probe-sorting.py
"""

from __future__ import annotations

import json
from typing import Any

import pydantic

from mixpanel_headless._internal.bookmark_schema import (
    InsightsBookmarkSortConfig,
)
from mixpanel_headless._internal.validation import validate_sorting_block

CASES: list[tuple[str, Any]] = [
    # --- structural ---
    ("not-a-dict/str", "nope"),
    ("not-a-dict/list", []),
    ("empty-dict", {}),
    ("unknown-chart-type", {"nope": {}}),
    ("valid-chart-not-a-field", {"sankey": {"sortBy": "value", "sortOrder": "asc"}}),
    ("config-not-a-dict/str", {"bar": "x"}),
    ("config-not-a-dict/list", {"bar": []}),
    ("config-not-a-dict/int", {"bar": 3}),
    ("config-null", {"bar": None}),
    # --- bar: SortConfig (SortByColumnsConfig | SortByValueConfig) ---
    ("bar/value-ok", {"bar": {"sortBy": "value", "sortOrder": "asc", "colSortAttrs": []}}),
    ("bar/value-no-cols", {"bar": {"sortBy": "value", "sortOrder": "asc"}}),
    ("bar/missing-sortBy", {"bar": {"sortOrder": "asc", "colSortAttrs": []}}),
    ("bar/bad-sortBy", {"bar": {"sortBy": "nope", "sortOrder": "asc", "colSortAttrs": []}}),
    ("bar/bad-sortOrder", {"bar": {"sortBy": "value", "sortOrder": "up", "colSortAttrs": []}}),
    ("bar/no-sortOrder", {"bar": {"sortBy": "value", "colSortAttrs": []}}),
    ("bar/column-ok", {"bar": {"sortBy": "column", "colSortAttrs": []}}),
    ("bar/column-missing-cols", {"bar": {"sortBy": "column"}}),
    ("bar/column-cols-not-list", {"bar": {"sortBy": "column", "colSortAttrs": "x"}}),
    ("bar/unknown-key", {"bar": {"sortBy": "column", "colSortAttrs": [], "nope": 1}}),
    (
        "bar/two-errors",
        {"bar": {"sortBy": "column", "nope": 1}},
    ),
    (
        "bar/valueField-int",
        {"bar": {"sortBy": "value", "sortOrder": "asc", "colSortAttrs": [], "valueField": 3}},
    ),
    (
        "bar/viewNLimit-str-numeric",
        {"bar": {"sortBy": "value", "sortOrder": "asc", "colSortAttrs": [], "viewNLimit": "5"}},
    ),
    (
        "bar/viewNLimit-str-junk",
        {"bar": {"sortBy": "value", "sortOrder": "asc", "colSortAttrs": [], "viewNLimit": "x"}},
    ),
    (
        "bar/viewNLimit-float-integral",
        {"bar": {"sortBy": "value", "sortOrder": "asc", "colSortAttrs": [], "viewNLimit": 5.0}},
    ),
    (
        "bar/viewNLimit-float-frac",
        {"bar": {"sortBy": "value", "sortOrder": "asc", "colSortAttrs": [], "viewNLimit": 5.5}},
    ),
    (
        "bar/viewNLimit-bool",
        {"bar": {"sortBy": "value", "sortOrder": "asc", "colSortAttrs": [], "viewNLimit": True}},
    ),
    (
        "bar/valueField-null-explicit",
        {"bar": {"sortBy": "value", "sortOrder": "asc", "colSortAttrs": [], "valueField": None}},
    ),
    (
        "bar/legacy-sortOrder-on-columns",
        {"bar": {"sortBy": "column", "colSortAttrs": [], "sortOrder": "whatever", "viewNLimit": "x"}},
    ),
    # --- colSortAttrs element (FlatSortConfig) ---
    (
        "bar/cols-label-ok",
        {"bar": {"sortBy": "column", "colSortAttrs": [{"sortBy": "label", "sortOrder": "asc"}]}},
    ),
    (
        "bar/cols-label-missing-order",
        {"bar": {"sortBy": "column", "colSortAttrs": [{"sortBy": "label"}]}},
    ),
    (
        "bar/cols-value-extra",
        {
            "bar": {
                "sortBy": "column",
                "colSortAttrs": [{"sortBy": "value", "sortOrder": "asc", "colSortAttrs": []}],
            }
        },
    ),
    (
        "bar/cols-two-bad",
        {
            "bar": {
                "sortBy": "column",
                "colSortAttrs": [{"sortBy": "label"}, {"sortBy": "value", "sortOrder": "x"}],
            }
        },
    ),
    (
        "bar/cols-elem-not-dict",
        {"bar": {"sortBy": "column", "colSortAttrs": ["x"]}},
    ),
    # --- line: FlatOrColumnSortConfig ---
    ("line/flat-label", {"line": {"sortBy": "label", "sortOrder": "asc"}}),
    ("line/flat-value", {"line": {"sortBy": "value", "sortOrder": "desc"}}),
    ("line/flat-value-no-order", {"line": {"sortBy": "value"}}),
    ("line/col-value", {"line": {"sortBy": "value", "colSortAttrs": []}}),
    ("line/column-no-cols", {"line": {"sortBy": "column"}}),
    ("line/label-with-cols", {"line": {"sortBy": "label", "sortOrder": "asc", "colSortAttrs": []}}),
    ("line/bad-sortBy", {"line": {"sortBy": "nope", "sortOrder": "asc"}}),
    # --- table: TableSortConfig ---
    ("table/value", {"table": {"sortBy": "value", "sortOrder": "asc", "colSortAttrs": []}}),
    (
        "table/old",
        {
            "table": {
                "sortBy": "value",
                "sortOrder": "asc",
                "sortColumn": "sum",
                "colSortAttrs": [],
            }
        },
    ),
    (
        "table/old-bad-sortColumn",
        {
            "table": {
                "sortBy": "value",
                "sortOrder": "asc",
                "sortColumn": "nope",
                "colSortAttrs": [],
            }
        },
    ),
    ("table/old-sortColumn-null", {"table": {"sortBy": "value", "sortOrder": "asc", "sortColumn": None, "colSortAttrs": []}}),
    ("table/column", {"table": {"sortBy": "column", "colSortAttrs": []}}),
    # --- multi-field ordering ---
    (
        "multi/pie-then-bar",
        {
            "pie": {"sortBy": "nope", "colSortAttrs": []},
            "bar": {"sortBy": "nope", "colSortAttrs": []},
        },
    ),
    (
        "multi/funnel-steps-then-line",
        {
            "funnel-steps": {"sortBy": "nope", "colSortAttrs": []},
            "line": {"sortBy": "nope"},
        },
    ),
    (
        "multi/unknown-and-known",
        {
            "sankey": {"sortBy": "value"},
            "bar": {"sortBy": "nope", "colSortAttrs": []},
            "nope-chart": {},
        },
    ),
    (
        "multi/aliases",
        {
            "insights-metric": {"sortBy": "value", "sortOrder": "asc", "colSortAttrs": []},
            "retention-curve": {"sortBy": "value", "sortOrder": "asc", "colSortAttrs": []},
            "funnel-steps": {"sortBy": "value", "sortOrder": "asc", "colSortAttrs": []},
        },
    ),
]


def show(label: str, value: Any) -> None:
    """Print the wrapper output and the raw pydantic errors for one case."""
    out = {
        "case": label,
        "input": value,
        "wrapper": [
            {"code": e.code, "path": e.path, "severity": e.severity, "message": e.message}
            for e in validate_sorting_block(value)
        ],
    }
    if isinstance(value, dict):
        try:
            InsightsBookmarkSortConfig.model_validate(value)
            out["pydantic"] = []
        except pydantic.ValidationError as exc:
            out["pydantic"] = [
                {"type": e["type"], "loc": list(e["loc"]), "msg": e["msg"]}
                for e in exc.errors()
            ]
    print(json.dumps(out, default=str))


for label, value in CASES:
    show(label, value)
