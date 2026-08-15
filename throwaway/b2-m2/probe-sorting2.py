"""THROWAWAY probe #2 — pydantic lax-coercion grammar + error ordering."""

from __future__ import annotations

import json
from typing import Any

import pydantic

from mixpanel_headless._internal.bookmark_schema import InsightsBookmarkSortConfig


def base(**kw: Any) -> dict[str, Any]:
    """Build a valid SortByValueConfig bar block with overrides."""
    cfg = {"sortBy": "value", "sortOrder": "asc", "colSortAttrs": []}
    cfg.update(kw)
    return {"bar": cfg}


CASES: list[tuple[str, Any]] = [
    # int lax-parse grammar on viewNLimit
    *[
        (f"viewNLimit={v!r}", base(viewNLimit=v))
        for v in [
            "5",
            " 5",
            " 5 ",
            "﻿5",
            " 5",
            "\x1c5",
            "+5",
            "-5",
            "1_0",
            "0x5",
            "5.0",
            "5.5",
            "٤٢",  # Arabic-Indic 42
            "",
            "  ",
            "9007199254740993",
            True,
            False,
            5.0,
            -0.0,
            float("nan"),
            float("inf"),
            [],
            {},
            None,
        ]
    ],
    # str lax grammar on valueField
    *[
        (f"valueField={v!r}", base(valueField=v))
        for v in [3, 3.5, True, [], {}, b"x", None, ""]
    ],
    # colSortAttrs wrong types
    *[
        (f"colSortAttrs={v!r}", {"bar": {"sortBy": "column", "colSortAttrs": v}})
        for v in ["x", {}, 3, None, (1, 2), set()]
    ],
    # ordering: several field errors + several extras
    (
        "order/two-extras-two-fields",
        {
            "bar": {"zz": 1, "sortBy": "nope", "aa": 2, "colSortAttrs": []},
        },
    ),
    (
        "order/top-level-mixed",
        {
            "pie": {"sortBy": "nope", "colSortAttrs": []},
            "sankey": {},
            "bar": {"sortBy": "nope", "colSortAttrs": []},
            "funnel-steps": {"sortBy": "nope", "colSortAttrs": []},
            "column": {},
            "table": {"sortBy": "nope", "colSortAttrs": []},
        },
    ),
    # sortOrder literal + sortBy literal on same config
    (
        "order/sortBy-and-sortOrder",
        {"bar": {"sortBy": "nope", "sortOrder": "nope", "colSortAttrs": []}},
    ),
    # colSortAttrs element missing sortBy entirely
    ("cols/elem-empty", {"bar": {"sortBy": "column", "colSortAttrs": [{}]}}),
    ("cols/elem-null", {"bar": {"sortBy": "column", "colSortAttrs": [None]}}),
    # deeper: colSortAttrs of a nested value config
    (
        "cols/nested-cols",
        {"bar": {"sortBy": "value", "sortOrder": "asc", "colSortAttrs": [{"sortBy": "label", "sortOrder": "nope", "viewNLimit": "x"}]}},
    ),
    # line flat with extra keys
    ("line/flat-extra", {"line": {"sortBy": "label", "sortOrder": "asc", "zz": 1}}),
    # table old variant with sortColumn present but sortBy=column
    ("table/column-with-sortColumn", {"table": {"sortBy": "column", "sortColumn": "sum", "colSortAttrs": []}}),
    # table with sortBy missing but sortColumn present
    ("table/no-sortBy-with-sortColumn", {"table": {"sortColumn": "sum", "sortOrder": "asc", "colSortAttrs": []}}),
    # table with sortBy missing and no sortColumn
    ("table/no-sortBy", {"table": {"sortOrder": "asc", "colSortAttrs": []}}),
    # aliases: snake_case accepted via populate_by_name
    ("alias/snake", {"insights_metric": {"sortBy": "value", "sortOrder": "asc", "colSortAttrs": []}}),
]


for label, value in CASES:
    try:
        InsightsBookmarkSortConfig.model_validate(value)
        errs: list[dict[str, Any]] = []
    except pydantic.ValidationError as exc:
        errs = [
            {"type": e["type"], "loc": list(e["loc"])} for e in exc.errors()
        ]
    print(json.dumps({"case": label, "errors": errs}, default=str))
