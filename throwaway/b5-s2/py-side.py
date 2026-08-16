"""B5-S2 R10.9 differential harness — the Python (arbiter) side.

Generates a seeded, annotation-constrained case corpus of RECIPES (plain
JSON both sides interpret into the same typed objects), runs it through
the Python ``Workspace`` builder members, and writes ``cases.json`` +
``py-out.json``.

Run from the PYTHON repo so ``uv`` resolves the project::

    cd /Users/jaredmcfarland/Developer/mixpanel-headless && \
      uv run python \
      /Users/jaredmcfarland/Developer/mixpanel-headless-ts/throwaway/b5-s2/py-side.py

Families (the five oracle-callable builders the packet §3 R10.9 spec
names):

- ``build_params``
- ``build_funnel_params``
- ``build_flow_params``
- ``build_retention_params``
- ``build_user_params``

Throwaway (packet §7.5 removes ``throwaway/b5-s2/`` at the batch gate).
"""

from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

from pydantic import SecretStr

from mixpanel_headless import Workspace
from mixpanel_headless._internal.auth.account import ServiceAccount
from mixpanel_headless._internal.auth.session import Project, Session
from mixpanel_headless.types import (
    CohortBreakdown,
    CohortMetric,
    Exclusion,
    Filter,
    FlowStep,
    Formula,
    FrequencyBreakdown,
    FrequencyFilter,
    FunnelStep,
    GroupBy,
    HoldingConstant,
    Metric,
    RetentionEvent,
)

HERE = Path(__file__).resolve().parent
SEED = 20260816
PER_FAMILY = 520

_SESSION = Session(
    account=ServiceAccount(
        name="test_account",
        region="us",
        username="test_user",
        secret=SecretStr("test_secret"),
        default_project="12345",
    ),
    project=Project(id="12345"),
)

# The mandated R10.9 edge set (rulebook R10.9) — every member appears
# verbatim in at least one drawn position below.
EDGE_SCALARS: list[Any] = [18.0, 1.5, True, None, [], "", "\U0001d4b3"]

EVENT_NAMES = ["Login", "Purchase", "\U0001d4b3", "Sign Up", "a"]
PROP_NAMES = ["country", "amount", "\U0001d4b3", "$browser", "a"]
FILTER_VALUES: list[Any] = [18.0, 1.5, True, None, [], "", "\U0001d4b3", "US", 0, -1]


def _rng() -> random.Random:
    """Return the seeded generator.

    Returns:
        A fresh ``random.Random`` pinned to :data:`SEED`.
    """
    return random.Random(SEED)


def _filter_spec(rng: random.Random) -> dict[str, Any]:
    """Draw one filter recipe.

    Args:
        rng: The generator.

    Returns:
        A JSON recipe both sides build the same ``Filter`` from.
    """
    op = rng.choice(
        [
            "equals",
            "greater_than",
            "less_than",
            "contains",
            "is_set",
            "is_not_set",
            "in_cohort",
            "not_in_cohort",
            "between",
        ]
    )
    spec: dict[str, Any] = {"op": op, "prop": rng.choice(PROP_NAMES)}
    if op == "equals":
        # The mandated R10.9 edge set rides the `equals` value slot.
        spec["value"] = rng.choice(FILTER_VALUES)
    elif op == "contains":
        spec["value"] = rng.choice(["US", "", "\U0001d4b3", "nike"])
    elif op in ("greater_than", "less_than"):
        spec["value"] = rng.choice([18.0, 1.5, 0, -1, 100])
    elif op == "between":
        spec["value"] = [rng.choice([0, 1.5]), rng.choice([18.0, 100])]
    elif op in ("in_cohort", "not_in_cohort"):
        spec["cohort_id"] = rng.choice([1, 42, 123])
        spec["name"] = rng.choice([None, "PU", ""])
    return spec


def _build_filter(spec: dict[str, Any]) -> Filter:
    """Build the ``Filter`` a recipe describes.

    Args:
        spec: A recipe from :func:`_filter_spec`.

    Returns:
        The filter.

    Raises:
        ValueError: When the recipe names an unknown op (never happens —
            the generator and this function share one op list).
    """
    op = spec["op"]
    prop = spec["prop"]
    if op == "equals":
        return Filter.equals(prop, spec["value"])
    if op == "greater_than":
        return Filter.greater_than(prop, spec["value"])
    if op == "less_than":
        return Filter.less_than(prop, spec["value"])
    if op == "contains":
        return Filter.contains(prop, spec["value"])
    if op == "is_set":
        return Filter.is_set(prop)
    if op == "is_not_set":
        return Filter.is_not_set(prop)
    if op == "between":
        return Filter.between(prop, spec["value"][0], spec["value"][1])
    if op == "in_cohort":
        return Filter.in_cohort(spec["cohort_id"], spec["name"])
    if op == "not_in_cohort":
        return Filter.not_in_cohort(spec["cohort_id"], spec["name"])
    raise ValueError(f"unknown filter op {op!r}")


def _group_spec(rng: random.Random) -> dict[str, Any]:
    """Draw one group-by recipe.

    Args:
        rng: The generator.

    Returns:
        A JSON recipe.
    """
    kind = rng.choice(["str", "groupby", "bucketed", "cohort", "frequency"])
    if kind == "str":
        return {"kind": "str", "v": rng.choice(PROP_NAMES)}
    if kind == "groupby":
        return {
            "kind": "groupby",
            "property": rng.choice(PROP_NAMES),
            "property_type": rng.choice(["string", "number", "boolean"]),
        }
    if kind == "bucketed":
        return {
            "kind": "bucketed",
            "property": rng.choice(PROP_NAMES),
            "bucket_size": rng.choice([1, 50, 1.5]),
            "bucket_min": rng.choice([0, -1]),
            "bucket_max": rng.choice([100, 18.0]),
        }
    if kind == "cohort":
        return {
            "kind": "cohort",
            "cohort": rng.choice([1, 42]),
            "name": rng.choice(["PU", "\U0001d4b3"]),
            "include_negated": rng.choice([True, False]),
        }
    return {
        "kind": "frequency",
        "event": rng.choice(EVENT_NAMES),
        "label": rng.choice([None, "Freq"]),
    }


def _build_group(spec: dict[str, Any]) -> Any:
    """Build the group-by object a recipe describes.

    Args:
        spec: A recipe from :func:`_group_spec`.

    Returns:
        The group-by value.
    """
    kind = spec["kind"]
    if kind == "str":
        return spec["v"]
    if kind == "groupby":
        return GroupBy(spec["property"], property_type=spec["property_type"])
    if kind == "bucketed":
        return GroupBy(
            spec["property"],
            property_type="number",
            bucket_size=spec["bucket_size"],
            bucket_min=spec["bucket_min"],
            bucket_max=spec["bucket_max"],
        )
    if kind == "cohort":
        return CohortBreakdown(
            spec["cohort"], spec["name"], include_negated=spec["include_negated"]
        )
    return FrequencyBreakdown(spec["event"], label=spec["label"])


def _event_spec(rng: random.Random) -> dict[str, Any]:
    """Draw one insights event recipe.

    Args:
        rng: The generator.

    Returns:
        A JSON recipe.
    """
    kind = rng.choice(["str", "metric", "metric_filtered", "cohort_metric"])
    if kind == "str":
        return {"kind": "str", "v": rng.choice(EVENT_NAMES)}
    if kind == "cohort_metric":
        return {
            "kind": "cohort_metric",
            "cohort": rng.choice([1, 42]),
            "name": rng.choice(["PU", "", None]),
        }
    math = rng.choice(["total", "unique", "dau", "average", "sessions"])
    spec: dict[str, Any] = {"kind": "metric", "event": rng.choice(EVENT_NAMES)}
    spec["math"] = math
    if math == "average":
        spec["property"] = rng.choice(PROP_NAMES)
    if kind == "metric_filtered":
        spec["filters"] = [_filter_spec(rng)]
        spec["filters_combinator"] = rng.choice(["all", "any"])
    if rng.random() < 0.2:
        spec["segment_method"] = rng.choice(["all", "first"])
    return spec


def _build_event(spec: dict[str, Any]) -> Any:
    """Build the insights event object a recipe describes.

    Args:
        spec: A recipe from :func:`_event_spec`.

    Returns:
        The event value.
    """
    kind = spec["kind"]
    if kind == "str":
        return spec["v"]
    if kind == "cohort_metric":
        return CohortMetric(spec["cohort"], spec["name"])
    kwargs: dict[str, Any] = {"math": spec["math"]}
    if "property" in spec:
        kwargs["property"] = spec["property"]
    if "filters" in spec:
        kwargs["filters"] = [_build_filter(f) for f in spec["filters"]]
        kwargs["filters_combinator"] = spec["filters_combinator"]
    if "segment_method" in spec:
        kwargs["segment_method"] = spec["segment_method"]
    return Metric(spec["event"], **kwargs)


def _time_kwargs(rng: random.Random) -> dict[str, Any]:
    """Draw the shared time kwargs.

    Args:
        rng: The generator.

    Returns:
        A dict with ``from_date`` / ``to_date`` / ``last`` / ``unit``.
    """
    mode = rng.choice(["relative", "absolute", "from_only"])
    out: dict[str, Any] = {"unit": rng.choice(["hour", "day", "week", "month"])}
    if mode == "relative":
        out["from_date"] = None
        out["to_date"] = None
        out["last"] = rng.choice([1, 7, 30, 365])
    elif mode == "absolute":
        out["from_date"] = "2025-01-01"
        out["to_date"] = "2025-03-31"
        out["last"] = 30
    else:
        out["from_date"] = "2025-02-01"
        out["to_date"] = None
        out["last"] = 30
    return out


def _cases_build_params(rng: random.Random) -> list[dict[str, Any]]:
    """Draw the ``build_params`` corpus.

    Args:
        rng: The generator.

    Returns:
        The recipes.
    """
    out: list[dict[str, Any]] = []
    # Edge-set anchors, verbatim, first.
    out.append({"events": [{"kind": "str", "v": ""}], "kwargs": {}})
    out.append({"events": [{"kind": "str", "v": "\U0001d4b3"}], "kwargs": {}})
    out.append(
        {
            "events": [{"kind": "str", "v": "Login"}],
            "kwargs": {"where": [{"op": "greater_than", "prop": "a", "value": 18.0}]},
        }
    )
    out.append(
        {
            "events": [{"kind": "str", "v": "Login"}],
            "kwargs": {"where": [{"op": "greater_than", "prop": "a", "value": 1.5}]},
        }
    )
    out.append(
        {
            "events": [{"kind": "str", "v": "Login"}],
            "kwargs": {"where": [{"op": "equals", "prop": "a", "value": ""}]},
        }
    )
    out.append({"events": [], "kwargs": {}})
    out.append({"events": [{"kind": "str", "v": "Login"}], "kwargs": {"last": 0}})
    while len(out) < PER_FAMILY:
        n = rng.randint(0, 3)
        events = [_event_spec(rng) for _ in range(max(1, n))]
        kwargs: dict[str, Any] = dict(_time_kwargs(rng))
        kwargs["math"] = rng.choice(["total", "unique", "dau"])
        kwargs["mode"] = rng.choice(["timeseries", "total", "table"])
        if rng.random() < 0.4:
            kwargs["group_by"] = [
                _group_spec(rng) for _ in range(rng.randint(1, 2))
            ]
        if rng.random() < 0.4:
            kwargs["where"] = [_filter_spec(rng) for _ in range(rng.randint(1, 2))]
        if rng.random() < 0.2:
            kwargs["rolling"] = rng.choice([1, 7])
        elif rng.random() < 0.2:
            kwargs["cumulative"] = True
        if rng.random() < 0.2:
            kwargs["data_group_id"] = rng.choice([1, 5])
        if rng.random() < 0.15 and len(events) >= 2:
            kwargs["formula"] = "A + B"
            kwargs["formula_label"] = rng.choice([None, "Combined", ""])
        out.append({"events": events, "kwargs": kwargs})
    return out


def _cases_build_funnel_params(rng: random.Random) -> list[dict[str, Any]]:
    """Draw the ``build_funnel_params`` corpus.

    Args:
        rng: The generator.

    Returns:
        The recipes.
    """
    out: list[dict[str, Any]] = []
    out.append({"steps": [{"kind": "str", "v": "A"}], "kwargs": {}})
    out.append({"steps": [], "kwargs": {}})
    out.append(
        {
            "steps": [{"kind": "str", "v": "A"}, {"kind": "str", "v": ""}],
            "kwargs": {},
        }
    )
    out.append(
        {
            "steps": [
                {"kind": "str", "v": "A"},
                {"kind": "str", "v": "\U0001d4b3"},
            ],
            "kwargs": {"conversion_window": 0},
        }
    )
    while len(out) < PER_FAMILY:
        steps: list[dict[str, Any]] = []
        for _ in range(rng.randint(2, 4)):
            if rng.random() < 0.5:
                steps.append({"kind": "str", "v": rng.choice(EVENT_NAMES)})
            else:
                step: dict[str, Any] = {
                    "kind": "step",
                    "event": rng.choice(EVENT_NAMES),
                }
                if rng.random() < 0.4:
                    step["filters"] = [_filter_spec(rng)]
                    step["filters_combinator"] = rng.choice(["all", "any"])
                if rng.random() < 0.3:
                    step["label"] = rng.choice(["Buy", "", "\U0001d4b3"])
                if rng.random() < 0.2:
                    step["order"] = rng.choice(["loose", "any"])
                steps.append(step)
        kwargs: dict[str, Any] = dict(_time_kwargs(rng))
        kwargs["conversion_window"] = rng.choice([1, 7, 14])
        kwargs["conversion_window_unit"] = rng.choice(
            ["second", "minute", "hour", "day", "week", "month", "session"]
        )
        kwargs["order"] = rng.choice(["loose", "any"])
        kwargs["math"] = rng.choice(
            ["conversion_rate_unique", "unique", "average", "median"]
        )
        if kwargs["math"] in ("average", "median"):
            kwargs["math_property"] = rng.choice(PROP_NAMES)
        kwargs["mode"] = rng.choice(["steps", "trends", "table"])
        if rng.random() < 0.3:
            kwargs["exclusions"] = [
                {"kind": "str", "v": rng.choice(EVENT_NAMES)}
                if rng.random() < 0.5
                else {
                    "kind": "exclusion",
                    "event": rng.choice(EVENT_NAMES),
                    "from_step": rng.choice([0, 1]),
                    "to_step": rng.choice([None, 1, 2]),
                }
            ]
        if rng.random() < 0.3:
            kwargs["holding_constant"] = [
                {"kind": "str", "v": rng.choice(PROP_NAMES)}
                if rng.random() < 0.5
                else {
                    "kind": "hc",
                    "property": rng.choice(PROP_NAMES),
                    "resource_type": rng.choice(["events", "people"]),
                }
            ]
        if rng.random() < 0.3:
            kwargs["group_by"] = [_group_spec(rng)]
        if rng.random() < 0.3:
            kwargs["where"] = [_filter_spec(rng)]
        if rng.random() < 0.2:
            kwargs["reentry_mode"] = rng.choice(
                ["aggressive", "default", "basic", "optimized"]
            )
        if rng.random() < 0.2:
            kwargs["data_group_id"] = rng.choice([1, 5])
        out.append({"steps": steps, "kwargs": kwargs})
    return out


def _cases_build_flow_params(rng: random.Random) -> list[dict[str, Any]]:
    """Draw the ``build_flow_params`` corpus.

    Args:
        rng: The generator.

    Returns:
        The recipes.
    """
    out: list[dict[str, Any]] = []
    out.append({"event": {"kind": "str", "v": ""}, "kwargs": {}})
    out.append({"event": {"kind": "str", "v": "\U0001d4b3"}, "kwargs": {}})
    out.append(
        {
            "event": {"kind": "step", "event": "Login"},
            "kwargs": {"forward": 0, "reverse": 0},
        }
    )
    out.append(
        {"event": {"kind": "str", "v": "Login"}, "kwargs": {"hidden_events": []}}
    )
    while len(out) < PER_FAMILY:
        shape = rng.choice(["str", "step", "list"])
        if shape == "str":
            event: Any = {"kind": "str", "v": rng.choice(EVENT_NAMES)}
        elif shape == "step":
            event = {"kind": "step", "event": rng.choice(EVENT_NAMES)}
            if rng.random() < 0.5:
                event["forward"] = rng.choice([0, 1, 3, 5])
            if rng.random() < 0.5:
                event["reverse"] = rng.choice([0, 1, 2])
            if rng.random() < 0.3:
                event["filters"] = [_filter_spec(rng)]
                event["filters_combinator"] = rng.choice(["all", "any"])
            if rng.random() < 0.2:
                event["label"] = rng.choice(["Buy", "", "\U0001d4b3"])
            if rng.random() < 0.15:
                event["session_event"] = rng.choice(["start", "end"])
        else:
            event = {
                "kind": "list",
                "items": [
                    {"kind": "str", "v": rng.choice(EVENT_NAMES)}
                    if rng.random() < 0.5
                    else {
                        "kind": "step",
                        "event": rng.choice(EVENT_NAMES),
                        "forward": rng.choice([0, 1, 3]),
                    }
                    for _ in range(rng.randint(1, 3))
                ],
            }
        kwargs: dict[str, Any] = {}
        tk = _time_kwargs(rng)
        kwargs["from_date"] = tk["from_date"]
        kwargs["to_date"] = tk["to_date"]
        kwargs["last"] = tk["last"]
        kwargs["forward"] = rng.choice([0, 1, 3, 5])
        kwargs["reverse"] = rng.choice([0, 1, 2])
        kwargs["conversion_window"] = rng.choice([1, 7, 30])
        kwargs["conversion_window_unit"] = rng.choice(
            ["day", "week", "month", "session"]
        )
        kwargs["count_type"] = rng.choice(["unique", "total", "session"])
        kwargs["cardinality"] = rng.choice([1, 3, 10])
        kwargs["collapse_repeated"] = rng.choice([True, False])
        kwargs["mode"] = rng.choice(["sankey", "paths", "tree"])
        if rng.random() < 0.3:
            kwargs["hidden_events"] = [rng.choice(EVENT_NAMES)]
        if rng.random() < 0.3:
            kwargs["where"] = [_filter_spec(rng)]
        if rng.random() < 0.25:
            kwargs["segments"] = [_group_spec(rng)]
        if rng.random() < 0.25:
            kwargs["exclusions"] = [rng.choice(EVENT_NAMES)]
        if rng.random() < 0.2:
            kwargs["data_group_id"] = rng.choice([1, 5])
        out.append({"event": event, "kwargs": kwargs})
    return out


def _cases_build_retention_params(rng: random.Random) -> list[dict[str, Any]]:
    """Draw the ``build_retention_params`` corpus.

    Args:
        rng: The generator.

    Returns:
        The recipes.
    """
    out: list[dict[str, Any]] = []
    out.append(
        {
            "born": {"kind": "str", "v": ""},
            "ret": {"kind": "str", "v": "Login"},
            "kwargs": {},
        }
    )
    out.append(
        {
            "born": {"kind": "str", "v": "\U0001d4b3"},
            "ret": {"kind": "str", "v": "Login"},
            "kwargs": {},
        }
    )
    out.append(
        {
            "born": {"kind": "str", "v": "Signup"},
            "ret": {"kind": "str", "v": "Login"},
            "kwargs": {"bucket_sizes": []},
        }
    )
    while len(out) < PER_FAMILY:

        def _evt() -> dict[str, Any]:
            """Draw one retention-event recipe.

            Returns:
                A JSON recipe.
            """
            if rng.random() < 0.6:
                return {"kind": "str", "v": rng.choice(EVENT_NAMES)}
            spec: dict[str, Any] = {
                "kind": "event",
                "event": rng.choice(EVENT_NAMES),
            }
            if rng.random() < 0.5:
                spec["filters"] = [_filter_spec(rng)]
                spec["filters_combinator"] = rng.choice(["all", "any"])
            return spec

        kwargs: dict[str, Any] = dict(_time_kwargs(rng))
        kwargs["retention_unit"] = rng.choice(["day", "week", "month"])
        kwargs["alignment"] = rng.choice(["birth", "calendar"])
        kwargs["math"] = rng.choice(["retention_rate", "total", "average"])
        kwargs["mode"] = rng.choice(["curve", "trends", "table"])
        if rng.random() < 0.3:
            kwargs["bucket_sizes"] = [1, 3, 7]
        if rng.random() < 0.3:
            kwargs["group_by"] = [_group_spec(rng)]
        if rng.random() < 0.3:
            kwargs["where"] = [_filter_spec(rng)]
        if rng.random() < 0.2:
            kwargs["unbounded_mode"] = rng.choice(
                ["carry_forward", "carry_back", "none", "consecutive_forward"]
            )
        if rng.random() < 0.2:
            kwargs["retention_cumulative"] = True
        if rng.random() < 0.2:
            kwargs["data_group_id"] = rng.choice([1, 5])
        out.append({"born": _evt(), "ret": _evt(), "kwargs": kwargs})
    return out


def _cases_build_user_params(rng: random.Random) -> list[dict[str, Any]]:
    """Draw the ``build_user_params`` corpus.

    Args:
        rng: The generator.

    Returns:
        The recipes.
    """
    out: list[dict[str, Any]] = []
    out.append({"kwargs": {}})
    out.append({"kwargs": {"sort_by": ""}})
    out.append({"kwargs": {"where": []}})
    out.append({"kwargs": {"as_of": 0}})
    out.append({"kwargs": {"as_of": "2025-01-01"}})
    out.append({"kwargs": {"properties": []}})
    out.append({"kwargs": {"percentile": 1.5, "aggregate": "percentile"}})
    out.append({"kwargs": {"segment_by": [18]}})
    # Anchors mirrored by `wire-edges.ts` §4 so those hand-written
    # expectations are arbiter-verified rather than guessed.
    out.append({"kwargs": {"aggregate": "percentile", "aggregate_property": "x"}})
    out.append({"kwargs": {"mode": "\U0001d4b3"}})
    out.append({"kwargs": {"sort_by": "ltv", "sort_order": ""}})
    out.append({"kwargs": {"sort_by": "ltv", "mode": "profiles", "sort_order": ""}})
    out.append({"kwargs": {"where_scalar": 18.0}})
    out.append({"kwargs": {"where_scalar": True}})
    out.append({"kwargs": {"where_scalar": None}})
    while len(out) < PER_FAMILY:
        kwargs: dict[str, Any] = {}
        mode = rng.choice(["profiles", "aggregate"])
        kwargs["mode"] = mode
        if mode == "aggregate":
            agg = rng.choice(["count", "extremes", "percentile", "numeric_summary"])
            kwargs["aggregate"] = agg
            if agg != "count":
                kwargs["aggregate_property"] = rng.choice(PROP_NAMES)
            if agg == "percentile":
                kwargs["percentile"] = rng.choice([50, 95, 99.9, 1.5])
            if rng.random() < 0.3:
                kwargs["segment_by"] = [rng.choice([1, 42, 18])]
        else:
            if rng.random() < 0.4:
                kwargs["sort_by"] = rng.choice(
                    ["ltv", "$last_seen", 'weird"prop', "back\\slash", "\U0001d4b3"]
                )
                kwargs["sort_order"] = rng.choice(["ascending", "descending"])
            if rng.random() < 0.3:
                kwargs["properties"] = [rng.choice(PROP_NAMES)]
            if rng.random() < 0.2:
                kwargs["search"] = rng.choice(["alice", "", "\U0001d4b3"])
            if rng.random() < 0.2:
                kwargs["distinct_id"] = "user_001"
            elif rng.random() < 0.2:
                kwargs["distinct_ids"] = ["user_001", "\U0001d4b3"]
            if rng.random() < 0.2:
                kwargs["as_of"] = rng.choice([0, -1, 1704067200, "2024-06-15"])
        if rng.random() < 0.3:
            kwargs["where"] = [_filter_spec(rng)]
        elif rng.random() < 0.15:
            kwargs["where_raw"] = 'properties["plan"] == "premium"'
        if rng.random() < 0.25:
            kwargs["cohort"] = rng.choice([1, 42])
            if rng.random() < 0.5:
                kwargs["include_all_users"] = True
        if rng.random() < 0.15:
            kwargs["group_id"] = "companies"
        if rng.random() < 0.15:
            kwargs["workers"] = rng.choice([1, 5, 6, 0])
        if rng.random() < 0.15:
            kwargs["limit"] = rng.choice([1, 0, -5, 100])
        out.append({"kwargs": kwargs})
    return out


_FUNNEL_DATE_OK = {
    "steps": [
        {"event": "A", "count": 100, "step_conv_ratio": 1.0},
        {"event": "B", "count": 50, "step_conv_ratio": 0.5},
        {"event": "C", "count": 25, "step_conv_ratio": 0.5},
    ]
}


def _cases_transforms() -> list[dict[str, Any]]:
    """Build the transform-math corpus (packet §3 R10.9 spec).

    Every case carries the response as JSON **text** so the TS side can
    route it through `parseLossless` + `toNativeJson` — the production
    wire path — rather than a bare `JSON.parse`.

    Returns:
        The cases, each ``{"fn": name, "body": json_text, "args": [...]}``.
    """
    cases: list[dict[str, Any]] = []

    def add(fn: str, body: Any, *args: Any) -> None:
        """Append one case.

        Args:
            fn: The transform's public TS name.
            body: The raw response (serialized to text).
            *args: The trailing positional arguments.
        """
        cases.append(
            {
                "fn": fn,
                "body": json.dumps(body, ensure_ascii=False),
                "args": list(args),
            }
        )

    # --- normalizeCohortDate: the edge set as a date key ------------------
    for key in [
        "",
        "\U0001d4b3",
        "2025-01-01",
        "2025-01-01T00:00:00+00:00",
        "2025-01-01T00:00:00",
        "2025-01-01 00:00:00",
        "2025-01-01T00:00:00Z",
        "not-a-date",
        "18.0",
        "1.5",
        "True",
        "None",
        "$average",
        "2025-01-01T",
        "T00:00:00",
    ]:
        cases.append({"fn": "normalizeCohortDate", "body": None, "args": [key]})

    # --- extractStepsFromDateData ----------------------------------------
    add("extractStepsFromDateData", {})
    add("extractStepsFromDateData", {"steps": []})
    add("extractStepsFromDateData", _FUNNEL_DATE_OK)
    add("extractStepsFromDateData", {"$overall": [{"event": "A", "count": 18.0}]})
    add(
        "extractStepsFromDateData",
        {"Chrome": [{"event": "A", "count": 1}], "Firefox": []},
    )
    add("extractStepsFromDateData", {"$overall": []})
    add("extractStepsFromDateData", {"$overall": "notalist"})
    add("extractStepsFromDateData", {"steps": "notalist"})
    add("extractStepsFromDateData", {"\U0001d4b3": [{"event": "\U0001d4b3"}]})

    # --- transformFunnel: the zero-denominator + shape matrix ------------
    for body in [
        {"data": {}},
        {"data": {"2025-01-01": {"steps": []}}},
        {"data": {"2025-01-01": {"steps": [{"event": "A", "count": 0}]}}},
        {
            "data": {
                "2025-01-01": {
                    "steps": [
                        {"event": "A", "count": 0},
                        {"event": "B", "count": 0},
                    ]
                }
            }
        },
        {
            "data": {
                "2025-01-01": {
                    "steps": [
                        {"event": "A", "count": 100},
                        {"event": "B", "count": 0},
                        {"event": "C", "count": 0},
                    ]
                }
            }
        },
        {"data": {"2025-01-01": _FUNNEL_DATE_OK}},
        {
            "data": {
                "2025-01-01": _FUNNEL_DATE_OK,
                "2025-01-02": _FUNNEL_DATE_OK,
            }
        },
        {"data": {"2025-01-01": {"$overall": [{"event": "A", "count": 18.0}]}}},
        {"data": {"2025-01-01": {"Chrome": [{"event": "A", "count": 5}]}}},
        {"data": {"2025-01-01": {"steps": [{"event": "", "count": 1.5}]}}},
        {"data": {"2025-01-01": {"steps": [{"count": 3}]}}},
        {"data": {"2025-01-01": {"steps": [{"event": "\U0001d4b3", "count": 18.0}]}}},
        {"meta": {}},
        {"data": None},
        {"error": "boom"},
        {"error": ""},
        {"error": 18.0},
    ]:
        add("transformFunnel", body, 42, "2025-01-01", "2025-01-31")

    # --- transformRetention: cohort math ----------------------------------
    for body in [
        # `raw` IS the flat date-keyed cohort dict (`live_query.py:196`).
        {},
        {"2025-01-01": {"first": 0, "counts": []}},
        {"2025-01-01": {"first": 0, "counts": [0, 0]}},
        {"2025-01-01": {"first": 100, "counts": [100, 50, 25]}},
        {"2025-01-01": {"first": 18.0, "counts": [18.0, 9.0]}},
        {"2025-01-01": {"first": 1.5, "counts": [1.5]}},
        {"2025-01-01": {"counts": [1]}},
        {"2025-01-01": {"first": 10}},
        {"2025-01-01": {}},
        {
            "2025-01-02": {"first": 10, "counts": [10]},
            "2025-01-01": {"first": 20, "counts": [20]},
        },
        {"\U0001d4b3": {"first": 1, "counts": [1]}},
        {"": {"first": 1, "counts": [1]}},
        {"2025-01-01": {"first": -1, "counts": [5]}},
        {"2025-01-01": "notadict"},
    ]:
        add(
            "transformRetention",
            body,
            "Signup",
            "Login",
            "2025-01-01",
            "2025-01-31",
            "day",
        )

    # --- extractFunnelStepsFromSeries -------------------------------------
    for series in [
        {},
        None,
        "notadict",
        [],
        {
            "M": {
                "count": {"1. A": {"all": 1000}, "2. B": {"all": 120}},
                "step_conv_ratio": {"1. A": {"all": 1.0}, "2. B": {"all": 0.12}},
                "overall_conv_ratio": {"1. A": {"all": 1.0}, "2. B": {"all": 0.12}},
                "avg_time": {"2. B": {"all": 18.0}},
                "avg_time_from_start": {"2. B": {"all": 18.0}},
            }
        },
        {"M": {"count": {}}},
        {"M": {"count": {"1.\tA": {"all": 1}}}},
        {"M": {"count": {"1.  A": {"all": 1}}}},
        {"M": {"count": {"A": {"all": 1}}}},
        {"M": {"count": {"1. \U0001d4b3": {"all": 18.0}}}},
        {"M": {"count": {"1. A": {}}}},
        {"M": {"count": {"1. A": "notadict"}}},
        {"M": "notadict"},
        {"M": {"count": "notadict"}},
        {"M1": {"count": {"1. A": {"all": 1}}}, "M2": {"count": {"1. B": {"all": 2}}}},
    ]:
        add("extractFunnelStepsFromSeries", series)

    # --- extractCohortsAndAverage -----------------------------------------
    for data in [
        {},
        {"$average": {"first": 1}},
        {"$average": "notadict"},
        {"2025-01-01T00:00:00+00:00": {"first": 18.0}},
        {"2025-01-01": "notadict"},
        {"": {"first": 1}},
        {"\U0001d4b3": {"first": 1}},
        {"2025-01-01": {"first": 1}, "$average": {"first": 2}},
    ]:
        add("extractCohortsAndAverage", data)

    return cases


_TRANSFORM_FNS: dict[str, Any] = {}


def _register_transforms() -> None:
    """Populate the name -> Python transform dispatch table."""
    from mixpanel_headless._internal.services import live_query as lq

    _TRANSFORM_FNS.update(
        {
            "normalizeCohortDate": lq._normalize_cohort_date,
            "extractStepsFromDateData": lq._extract_steps_from_date_data,
            "transformFunnel": lq._transform_funnel,
            "transformRetention": lq._transform_retention,
            "extractFunnelStepsFromSeries": lq._extract_funnel_steps_from_series,
            "extractCohortsAndAverage": lq._extract_cohorts_and_average,
        }
    )


def _plain(value: Any) -> Any:
    """Reduce a transform's return value to plain JSON data.

    Result classes expose ``to_dict()``, which is exactly what the TS
    twins' ``toJSON()`` mirrors (`live-query.ts:12`), so that is the
    projection both sides compare — NOT ``dataclasses.asdict`` (which
    additionally leaks the ``_df_cache`` slot).

    Args:
        value: A result instance, tuple, or plain value.

    Returns:
        The JSON-ready projection.
    """
    to_dict = getattr(value, "to_dict", None)
    if callable(to_dict):
        return to_dict()
    if isinstance(value, tuple):
        return [_plain(v) for v in value]
    return value


def _run_transform(case: dict[str, Any]) -> Any:
    """Run one transform case.

    Args:
        case: A case from :func:`_cases_transforms`.

    Returns:
        The projection, or an ``{error, codes}`` envelope.
    """
    fn = _TRANSFORM_FNS[case["fn"]]
    body = case["body"]
    args = list(case["args"])
    if body is not None:
        args.insert(0, json.loads(body))
    return _guarded(lambda: _plain(fn(*args)))


def _resolve_where(spec: Any) -> Any:
    """Build the ``where`` value a recipe list describes.

    Args:
        spec: ``None``, a raw string, or a list of filter recipes.

    Returns:
        The where value.
    """
    if spec is None:
        return None
    if isinstance(spec, str):
        return spec
    return [_build_filter(f) for f in spec]


def _resolve_group(spec: Any) -> Any:
    """Build the ``group_by`` value a recipe list describes.

    Args:
        spec: ``None`` or a list of group recipes.

    Returns:
        The group-by value.
    """
    if spec is None:
        return None
    return [_build_group(g) for g in spec]


def _guarded(fn: Any) -> Any:
    """Run ``fn``, recording the raised class + codes the way TS does.

    Args:
        fn: The thunk.

    Returns:
        The result, or an ``{error, codes}`` envelope.
    """
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001 — the harness records the class
        codes = []
        code = getattr(exc, "code", None)
        if code is not None:
            codes = [code]
        # The AGGREGATE inner codes are the contract detail worth
        # comparing, so they win over the envelope code.
        errs = getattr(exc, "errors", None)
        if errs:
            codes = [e.code for e in errs]
        return {"error": type(exc).__name__, "codes": codes}


def main() -> None:
    """Generate the corpus, compute the Python outputs, write the files."""
    rng = _rng()
    cases: dict[str, list[Any]] = {
        "build_params": _cases_build_params(rng),
        "build_funnel_params": _cases_build_funnel_params(rng),
        "build_flow_params": _cases_build_flow_params(rng),
        "build_retention_params": _cases_build_retention_params(rng),
        "build_user_params": _cases_build_user_params(rng),
        "transforms": _cases_transforms(),
    }
    _register_transforms()

    ws = Workspace(session=_SESSION, _api_client=MagicMock())
    out: dict[str, list[Any]] = {}

    out["build_params"] = [
        _guarded(
            lambda c=c: ws.build_params(  # type: ignore[misc]
                [_build_event(e) for e in c["events"]],
                **{
                    k: (
                        _resolve_where(v)
                        if k == "where"
                        else _resolve_group(v)
                        if k == "group_by"
                        else v
                    )
                    for k, v in c["kwargs"].items()
                },
            )
        )
        for c in cases["build_params"]
    ]

    def _funnel_steps(items: list[dict[str, Any]]) -> list[Any]:
        """Build the funnel step list a recipe describes.

        Args:
            items: The step recipes.

        Returns:
            The step values.
        """
        built: list[Any] = []
        for s in items:
            if s["kind"] == "str":
                built.append(s["v"])
                continue
            kw: dict[str, Any] = {}
            if "filters" in s:
                kw["filters"] = [_build_filter(f) for f in s["filters"]]
                kw["filters_combinator"] = s["filters_combinator"]
            if "label" in s:
                kw["label"] = s["label"]
            if "order" in s:
                kw["order"] = s["order"]
            built.append(FunnelStep(s["event"], **kw))
        return built

    def _exclusions(items: Any) -> Any:
        """Build the exclusions list a recipe describes.

        Args:
            items: ``None`` or the recipes.

        Returns:
            The exclusions value.
        """
        if items is None:
            return None
        built: list[Any] = []
        for e in items:
            if e["kind"] == "str":
                built.append(e["v"])
            else:
                built.append(
                    Exclusion(e["event"], from_step=e["from_step"], to_step=e["to_step"])
                )
        return built

    def _holding(items: Any) -> Any:
        """Build the holding-constant list a recipe describes.

        Args:
            items: ``None`` or the recipes.

        Returns:
            The holding-constant value.
        """
        if items is None:
            return None
        built: list[Any] = []
        for h in items:
            if h["kind"] == "str":
                built.append(h["v"])
            else:
                built.append(
                    HoldingConstant(h["property"], resource_type=h["resource_type"])
                )
        return built

    out["build_funnel_params"] = [
        _guarded(
            lambda c=c: ws.build_funnel_params(  # type: ignore[misc]
                _funnel_steps(c["steps"]),
                **{
                    k: (
                        _resolve_where(v)
                        if k == "where"
                        else _resolve_group(v)
                        if k == "group_by"
                        else _exclusions(v)
                        if k == "exclusions"
                        else _holding(v)
                        if k == "holding_constant"
                        else v
                    )
                    for k, v in c["kwargs"].items()
                },
            )
        )
        for c in cases["build_funnel_params"]
    ]

    def _flow_step(spec: dict[str, Any]) -> Any:
        """Build the flow-step value a recipe describes.

        Args:
            spec: The recipe.

        Returns:
            The flow-step value.
        """
        if spec["kind"] == "str":
            return spec["v"]
        if spec["kind"] == "list":
            return [_flow_step(i) for i in spec["items"]]
        kw: dict[str, Any] = {}
        for key in ("forward", "reverse", "label", "session_event"):
            if key in spec:
                kw[key] = spec[key]
        if "filters" in spec:
            kw["filters"] = [_build_filter(f) for f in spec["filters"]]
            kw["filters_combinator"] = spec["filters_combinator"]
        return FlowStep(spec["event"], **kw)

    out["build_flow_params"] = [
        _guarded(
            lambda c=c: ws.build_flow_params(  # type: ignore[misc]
                _flow_step(c["event"]),
                **{
                    k: (
                        _resolve_where(v)
                        if k == "where"
                        else _resolve_group(v)
                        if k == "segments"
                        else v
                    )
                    for k, v in c["kwargs"].items()
                },
            )
        )
        for c in cases["build_flow_params"]
    ]

    def _ret_event(spec: dict[str, Any]) -> Any:
        """Build the retention-event value a recipe describes.

        Args:
            spec: The recipe.

        Returns:
            The retention-event value.
        """
        if spec["kind"] == "str":
            return spec["v"]
        kw: dict[str, Any] = {}
        if "filters" in spec:
            kw["filters"] = [_build_filter(f) for f in spec["filters"]]
            kw["filters_combinator"] = spec["filters_combinator"]
        return RetentionEvent(spec["event"], **kw)

    out["build_retention_params"] = [
        _guarded(
            lambda c=c: ws.build_retention_params(  # type: ignore[misc]
                _ret_event(c["born"]),
                _ret_event(c["ret"]),
                **{
                    k: (
                        _resolve_where(v)
                        if k == "where"
                        else _resolve_group(v)
                        if k == "group_by"
                        else v
                    )
                    for k, v in c["kwargs"].items()
                },
            )
        )
        for c in cases["build_retention_params"]
    ]

    def _user_kwargs(kw: dict[str, Any]) -> dict[str, Any]:
        """Build the ``build_user_params`` kwargs a recipe describes.

        Args:
            kw: The recipe kwargs.

        Returns:
            The resolved kwargs.
        """
        resolved: dict[str, Any] = {}
        for k, v in kw.items():
            if k == "where":
                resolved["where"] = _resolve_where(v)
            elif k in ("where_raw", "where_scalar"):
                resolved["where"] = v
            else:
                resolved[k] = v
        return resolved

    out["build_user_params"] = [
        _guarded(
            lambda c=c: ws.build_user_params(**_user_kwargs(c["kwargs"]))  # type: ignore[misc]
        )
        for c in cases["build_user_params"]
    ]

    out["transforms"] = [_run_transform(c) for c in cases["transforms"]]

    (HERE / "cases.json").write_text(
        json.dumps(cases, ensure_ascii=False), encoding="utf8"
    )
    (HERE / "py-out.json").write_text(
        json.dumps(out, ensure_ascii=False, default=str), encoding="utf8"
    )
    for family, values in out.items():
        errors = sum(1 for v in values if isinstance(v, dict) and "error" in v)
        print(f"{family:26} {len(values):5} cases  {errors:5} raised")


if __name__ == "__main__":
    main()
