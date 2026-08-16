"""B3-K1 probe 3: literals, aliases, tuples, dicts, error ordering."""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel
from pydantic import ValidationError as PydanticValidationError

from mixpanel_headless._internal import bookmark_schema as bs


def errs(model: type[BaseModel], raw: Any) -> list[dict[str, Any]]:
    """Return pydantic's raw error stream."""
    try:
        model.model_validate(raw)
    except PydanticValidationError as exc:
        return [{"type": e["type"], "loc": list(e["loc"])} for e in exc.errors()]
    return []


CASES: list[tuple[str, type[BaseModel], Any]] = []


def case(name: str, model: type[BaseModel], raw: Any) -> None:
    """Register a probe case."""
    CASES.append((name, model, raw))


SEC = bs.Sections
DO = bs.DisplayOptions
IBP = bs.InsightsBookmarkParams
FBP = bs.FlowsBookmarkParams


def disp(d: Any) -> dict[str, Any]:
    """Sections with a BehaviorShowClause carrying ``display``."""
    return {"show": [{"type": "metric", "display": d}], "time": []}


# int-Literal acceptance (MetricDisplay.precision: Literal[0..8])
for v in [0, 8, 9, -1, 1.0, 1.5, True, False, "1", None, [], 3]:
    case(f"lit-int/{v!r}", SEC, disp({"precision": v}))

# str-Literal with odd inputs (MetricDisplay.axis)
for v in [1, True, None, [], "primary", "PRIMARY"]:
    case(f"lit-str/{v!r}", SEC, disp({"axis": v}))

# alias vs python-name collisions
case("alias/both-_idx-and-idx", SEC, {"show": [{"_idx": "a", "idx": "b"}], "time": []})
case(
    "alias/fsstc-both",
    DO,
    {
        "chartType": "bar",
        "funnelStepsSelectedTableColumns": {
            "conv-first-step": True,
            "conv_first_step": False,
        },
    },
)
case(
    "alias/steps-both-from",
    SEC,
    {
        "show": [
            {
                "type": "metric",
                "behavior": {
                    "exclusions": [{"steps": {"from": 1, "from_step": 2}}]
                },
            }
        ],
        "time": [],
    },
)

# error ordering: declared-field errors follow declaration order
case(
    "order/ibp-name-and-icon",
    IBP,
    {
        "displayOptions": {"chartType": "bar"},
        "sections": {"show": [], "time": []},
        "icon": 1,
        "name": 2,
    },
)
case(
    "order/ibp-icon-then-name-input-order",
    IBP,
    {
        "icon": 1,
        "name": 2,
        "displayOptions": {"chartType": "bar"},
        "sections": {"show": [], "time": []},
    },
)
case(
    "order/do-multiple",
    DO,
    {"chartType": "nope", "zzz": 1, "plotStyle": "x", "aaa": 2, "analysis": "y"},
)
case(
    "order/nested-before-later-field",
    IBP,
    {
        "displayOptions": {"chartType": "nope"},
        "sections": {"show": [], "time": []},
        "name": 5,
    },
)

# Goal.checkpoints tuple handling
def goal(cp: Any) -> dict[str, Any]:
    """Sections with one Goal carrying ``checkpoints``."""
    return {
        "show": [
            {"type": "metric", "goals": [{"id": "g", "label": "L", "checkpoints": cp}]}
        ],
        "time": [],
    }


for cp in [
    [["a", 1.0]],
    [("a", 1.0)],
    [["a", "1.0"]],
    [["a", "x"]],
    [[1, 1.0]],
    [[]],
    [5],
    "x",
    [["a", 1, 2]],
    None,
]:
    case(f"tuple/{cp!r}", SEC, goal(cp))

# Statsig.exposures: dict[str, int | dict[str, int]]
def statsig(s: Any) -> dict[str, Any]:
    """Sections with a BehaviorShowClause carrying ``statsig``."""
    return {"show": [{"type": "metric", "statsig": s}], "time": []}


for ex in [
    {"a": 1},
    {"a": {"b": 2}},
    {"a": "x"},
    {"a": [1]},
    [],
    {"a": {"b": "x"}},
    None,
]:
    case(f"nesteddict/{ex!r}", SEC, statsig({"control_key": "c", "exposures": ex}))

# Statsig.pre_exposure_date_range: list[str]
for v in [["a"], [1], "x", []]:
    case(
        f"liststr/{v!r}",
        SEC,
        statsig({"control_key": "c", "pre_exposure_date_range": v}),
    )

# SRM.expectedRatios: dict[str, float] required
for v in [{"a": 1}, {}, None, [], {"a": None}]:
    case(f"srm/{v!r}", SEC, {"show": [{"type": "metric", "srm": {"expectedRatios": v}}], "time": []})
case("srm/missing", SEC, {"show": [{"type": "metric", "srm": {}}], "time": []})

# FlowsBookmarkParams list[str] / list[int]
for v in [["a"], [1], "x", [None]]:
    case(f"fbp/hidden_events/{v!r}", FBP, {"steps": [], "date_range": {}, "hidden_events": v})
for v in [[1, 0], ["1"], [1.5], [None]]:
    case(f"fbp/alignment/{v!r}", FBP, {"steps": [], "date_range": {}, "alignment": v})

# JsonValue rejection surface
for v in [{"a": 1}, [1, "x", None], "s", 5, 5.5, True, None, float("nan"), float("inf")]:
    case(f"jsonvalue/{v!r}", SEC, {"show": [], "time": [], "filter": [v]})

# Behavior.filters is list[JsonValue] | None (no default_factory)
case("behavior/filters-null", SEC, {"show": [{"type": "metric", "behavior": {"filters": None}}], "time": []})
case("behavior/filters-notlist", SEC, {"show": [{"type": "metric", "behavior": {"filters": 5}}], "time": []})

# SubBehavior.filters default_factory + None tolerance
case(
    "subbehavior/filters-null",
    SEC,
    {"show": [{"type": "metric", "behavior": {"behaviors": [{"filters": None}]}}], "time": []},
)
case(
    "subbehavior/filtersDeterminer-null",
    SEC,
    {
        "show": [{"type": "metric", "behavior": {"behaviors": [{"filtersDeterminer": None}]}}],
        "time": [],
    },
)

# Multi-error multiplicity inside one list
case(
    "multi/show-two-bad",
    SEC,
    {"show": [{"type": "x"}, {"type": "y"}], "time": []},
)
case(
    "multi/show-bad-and-extra",
    SEC,
    {"show": [{"type": "x", "zzz": 1}], "time": []},
)


def main() -> None:
    """Print the probe transcript."""
    out = []
    for name, model, raw in CASES:
        out.append({"case": name, "errors": errs(model, raw)})
    print(json.dumps(out, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
