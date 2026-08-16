"""B3-K2 R10.9 differential harness — CPython half.

Generates a deterministic, seeded case corpus for the twelve
``bookmark_builders`` entry points, drives the REAL Python functions
(`mixpanel_headless._internal.bookmark_builders` — the same call targets
`conformance/record/registry.py::_builder_entries()` registers for the
oracle), and writes inputs + observed outputs/errors to JSON for the Node
half (`harness.mjs`) to replay against `packages/core/src/bookmarks/builders.ts`.

    uv run --project <PY_ROOT> python gen-cases.py SEED N OUT.json

Objects cross the bridge as `{"$": ClassName, "f": {field: enc}}` field
dicts — the same Python-spelled field vocabulary the Phase-2 contract
codecs use — so both sides reconstruct through their real constructors
(a constructor guard that fires on one side but not the other is itself
recorded and diffed).

Number fidelity caveat (documented in RUN.md): Python floats encode as
`{"__f__": repr(v)}` and Python ints as plain JSON integers, but the
comparator normalizes both to a JS number, so int-vs-float-ness of a
pass-through value is NOT diffed here. That distinction is carried by the
real conformance codecs and is checked by the 134 K2 vector replays at
the (b') binding task.
"""

from __future__ import annotations

import json
import math
import random
import sys
import traceback
from datetime import date
from typing import Any

import mixpanel_headless._internal.bookmark_builders as bb
from mixpanel_headless.exceptions import ParamTypeError, ParamValidationError
from mixpanel_headless.types import (
    CohortBreakdown,
    CohortCriteria,
    CohortDefinition,
    CustomPropertyRef,
    Filter,
    FrequencyBreakdown,
    FrequencyFilter,
    GroupBy,
    InlineCustomProperty,
    ListItemGroupMode,
    PropertyInput,
    TimeComparison,
)

FROZEN_TODAY = "2026-01-15"
"""Frozen clock for the ``build_time_section`` from-only branch (the
record-epoch value the authored vector pins)."""


class _FrozenDate(date):
    """``datetime.date`` subclass whose ``today()`` is the frozen epoch."""

    @classmethod
    def today(cls) -> date:
        """Return the frozen record-epoch date.

        Returns:
            The frozen ``date`` object.
        """
        return date(2026, 1, 15)


bb.date = _FrozenDate  # type: ignore[misc]

# ---------------------------------------------------------------------------
# Fixed inline-cohort table (reconstructed index-for-index on the TS side)
# ---------------------------------------------------------------------------

COHORT_DEFS: list[CohortDefinition] = [
    CohortDefinition.all_of(
        CohortCriteria.did_event("Purchase", at_least=1, within_days=30)
    ),
    CohortDefinition.any_of(
        CohortCriteria.did_event("Login", at_least=2, within_days=7),
        CohortCriteria.property_is_set("plan"),
    ),
]

# ---------------------------------------------------------------------------
# Encoding
# ---------------------------------------------------------------------------

_FIELDS: dict[str, tuple[str, ...]] = {
    "Filter": (
        "_property",
        "_operator",
        "_value",
        "_property_type",
        "_resource_type",
        "_date_unit",
        "_list_item_filters",
        "_list_item_quantifier",
    ),
    "GroupBy": (
        "property",
        "property_type",
        "bucket_size",
        "bucket_min",
        "bucket_max",
        "_list_item_mode",
    ),
    "CohortBreakdown": ("cohort", "name", "include_negated"),
    "FrequencyBreakdown": (
        "event",
        "bucket_size",
        "bucket_min",
        "bucket_max",
        "label",
    ),
    "FrequencyFilter": (
        "event",
        "value",
        "operator",
        "date_range_value",
        "date_range_unit",
        "event_filters",
        "label",
    ),
    "PropertyInput": ("name", "type", "resource_type"),
    "InlineCustomProperty": ("formula", "inputs", "property_type", "resource_type"),
    "CustomPropertyRef": ("id",),
    "ListItemGroupMode": ("sub", "sub_type"),
    "TimeComparison": ("type", "unit", "date"),
}


def enc(value: Any) -> Any:
    """Encode a Python value for the JSON bridge.

    Args:
        value: Any value reachable in a builder input or output.

    Returns:
        A JSON-serializable mirror; class instances become
        ``{"$": name, "f": {...}}``, floats become ``{"__f__": repr}``.

    Raises:
        TypeError: When the value is outside the modelled domain.
    """
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return {"__f__": repr(value)}
    if isinstance(value, (list, tuple)):
        return [enc(item) for item in value]
    if isinstance(value, dict):
        return {str(k): enc(v) for k, v in value.items()}
    if isinstance(value, CohortDefinition):
        for index, candidate in enumerate(COHORT_DEFS):
            if candidate is value:
                return {"$": "CohortDefRef", "i": index}
        raise TypeError("unregistered CohortDefinition")
    name = type(value).__name__
    if name in _FIELDS:
        return {
            "$": name,
            "f": {field: enc(getattr(value, field)) for field in _FIELDS[name]},
        }
    raise TypeError(f"cannot encode {name}")


def outcome(fn: Any, kwargs: dict[str, Any]) -> dict[str, Any]:
    """Run a builder and capture its output or coded error.

    Args:
        fn: The builder callable.
        kwargs: Keyword arguments to apply.

    Returns:
        ``{"output": enc}`` or ``{"error": {"class", "code"}}``.
    """
    try:
        return {"output": enc(fn(**kwargs))}
    except (ParamTypeError, ParamValidationError) as exc:
        return {"error": {"class": type(exc).__name__, "code": exc.code}}
    except Exception as exc:  # noqa: BLE001 — uncoded builtins are contract too
        return {"error": {"class": type(exc).__name__, "code": None}}


# ---------------------------------------------------------------------------
# Domains
# ---------------------------------------------------------------------------

NON_BMP = "\U0001d4b3"
STRINGS = [
    "country",
    "",
    " ",
    "US",
    NON_BMP,
    "a\\b",
    'q"q',
    "﻿1",
    "$time",
    "Purchase",
    "Sign​Up",
]
NUMBERS: list[Any] = [0, 1, 18, -3, 18.0, 1.5, -0.0, 1e16, 1e-5, True, False]
PROPERTY_TYPES = ["string", "number", "boolean", "datetime", "list", "object"]
RESOURCE_TYPES = ["events", "people"]
DATE_UNITS = [None, "hour", "day", "week", "month"]
OPERATORS = [
    "equals",
    "not equals",
    "contains",
    "not contains",
    "is greater than",
    "is less than",
    "between",
    "not between",
    "is at least",
    "is at most",
    "is set",
    "is not set",
    "starts with",
    "ends with",
    "true",
    "false",
    "was on",
    "was before",
    "was after",
    "was between",
    "was not between",
    "was in the",
    "was not in the",
    "was in the next",
    "does not contain",
]
QUERY_UNITS = ["hour", "day", "week", "month", "quarter"]
FREQ_OPERATORS = [
    "is at least",
    "is at most",
    "is equal to",
    "is greater than",
    "is less than",
]


def rand_property(rng: random.Random) -> Any:
    """Draw a Filter/GroupBy property spec.

    Args:
        rng: Seeded RNG.

    Returns:
        A string, ``CustomPropertyRef`` or ``InlineCustomProperty``.
    """
    roll = rng.random()
    if roll < 0.6:
        return rng.choice(STRINGS) or "p"
    if roll < 0.8:
        return CustomPropertyRef(id=rng.randint(1, 99999))
    return InlineCustomProperty(
        formula=rng.choice(["A", "A * B", 'IFS(A > 1, "x", TRUE, "y")']),
        inputs={
            "A": PropertyInput(
                name=rng.choice(STRINGS) or "p",
                type=rng.choice(["string", "number", "boolean", "datetime", "list"]),
                resource_type=rng.choice(["event", "user"]),
            )
        },
        property_type=rng.choice([None, "string", "number", "boolean", "datetime"]),
        resource_type=rng.choice(RESOURCE_TYPES),
    )


def rand_value(rng: random.Random) -> Any:
    """Draw a Filter ``_value``.

    Args:
        rng: Seeded RNG.

    Returns:
        A scalar, list, ``None``, or a cohort-shaped list-of-dicts.
    """
    roll = rng.random()
    if roll < 0.25:
        return rng.choice(STRINGS)
    if roll < 0.5:
        return rng.choice(NUMBERS)
    if roll < 0.6:
        return None
    if roll < 0.7:
        return []
    if roll < 0.85:
        return [rng.choice(STRINGS) for _ in range(rng.randint(1, 3))]
    return [rng.choice(NUMBERS) for _ in range(rng.randint(1, 2))]


def rand_filter(rng: random.Random, *, depth: int = 0) -> Filter:
    """Draw a Filter by direct field construction (guards may fire).

    Args:
        rng: Seeded RNG.
        depth: Recursion depth guard for ``list_contains``.

    Returns:
        A constructed Filter.
    """
    if depth == 0 and rng.random() < 0.1:
        inner = tuple(
            rand_filter(rng, depth=1) for _ in range(rng.randint(1, 3))
        )
        return Filter(
            _property=rng.choice(STRINGS) or "cart",
            _operator="list_contains",
            _value=None,
            _property_type="object",
            _resource_type=rng.choice(RESOURCE_TYPES),
            _list_item_filters=inner,
            _list_item_quantifier=rng.choice(["any", "all"]),
        )
    return Filter(
        _property=rand_property(rng),
        _operator=rng.choice(OPERATORS),
        _value=rand_value(rng),
        _property_type=rng.choice(PROPERTY_TYPES),
        _resource_type=rng.choice(RESOURCE_TYPES),
        _date_unit=rng.choice(DATE_UNITS),
    )


def rand_cohort_filter(rng: random.Random) -> Filter:
    """Draw a ``$cohorts`` Filter, well-formed or malformed.

    Args:
        rng: Seeded RNG.

    Returns:
        A Filter whose ``_property`` is ``"$cohorts"`` (usually).
    """
    roll = rng.random()
    if roll < 0.15:
        return rand_filter(rng)  # BB4 material
    shapes: list[Any] = [
        [{"cohort": {"negated": False, "name": rng.choice(STRINGS), "id": 123}}],
        [{"cohort": {"negated": True, "name": "Bots", "id": 7}}],
        [{"cohort": {"name": "X", "raw_cohort": {"selector": {}}}}],
        [{"cohort": {}}],
        [{"cohort": None}],
        [{"nope": {}}],
        [{}],
        [42],
        ["cohort"],
        [],
        "oops",
        None,
        17,
        [{"cohort": {"id": 1, "raw_cohort": {"a": 1}, "name": None}}],
    ]
    return Filter(
        _property="$cohorts",
        _operator=rng.choice(["contains", "does not contain"]),
        _value=rng.choice(shapes),
        _property_type="list",
        _resource_type="events",
    )


def rand_group_element(rng: random.Random) -> Any:
    """Draw one ``build_group_section`` element (valid or BB1 foreign).

    Args:
        rng: Seeded RNG.

    Returns:
        A str / GroupBy / CohortBreakdown / FrequencyBreakdown, or a
        foreign value that must trip BB1.
    """
    roll = rng.random()
    if roll < 0.25:
        return rng.choice(STRINGS) or "country"
    if roll < 0.55:
        prop: Any
        mode = None
        sub_roll = rng.random()
        if sub_roll < 0.2:
            prop = rng.choice(STRINGS) or "cart"
            mode = ListItemGroupMode(
                sub=rng.choice(["Brand", "Price", NON_BMP]),
                sub_type=rng.choice(["string", "number", "boolean", "datetime"]),
            )
            return GroupBy(property=prop, _list_item_mode=mode)
        prop = rand_property(rng)
        bucket_size = rng.choice([None, 1, 10, 2.5])
        bucket_min = rng.choice([None, 0, -5])
        bucket_max = rng.choice([None, 100, 1000.5])
        return GroupBy(
            property=prop,
            property_type=rng.choice(["string", "number", "boolean", "datetime"]),
            bucket_size=bucket_size,
            bucket_min=bucket_min,
            bucket_max=bucket_max,
        )
    if roll < 0.7:
        # bool <: int (B3 arbiter fix F1, b3-review-resolution.md
        # 2026-08-15): True takes the SAVED branch (id: true, groups: [])
        # exactly like an int id; the pre-fix TS crashed TypeError.
        cohort: Any = rng.choice([1, 123, True, COHORT_DEFS[0], COHORT_DEFS[1]])
        return CohortBreakdown(
            cohort=cohort,
            name=rng.choice([None, "PU", NON_BMP, "Power Users"]),
            include_negated=rng.choice([True, False]),
        )
    if roll < 0.85:
        return FrequencyBreakdown(
            event=rng.choice(["Purchase", NON_BMP, "Login"]),
            bucket_size=rng.choice([1, 5]),
            bucket_min=rng.choice([0, 1]),
            bucket_max=rng.choice([10, 50]),
            label=rng.choice([None, "", "Buy Count", NON_BMP]),
        )
    return rng.choice([42, None, 1.5, True, [], {}, " x", (1, 2)])


def rand_frequency_filter(rng: random.Random) -> FrequencyFilter:
    """Draw a FrequencyFilter.

    Args:
        rng: Seeded RNG.

    Returns:
        A constructed FrequencyFilter.
    """
    paired = rng.random() < 0.5
    return FrequencyFilter(
        event=rng.choice(["Login", "Purchase", NON_BMP]),
        value=rng.choice([0, 1, 5, 18.0, 1.5, True]),
        operator=rng.choice(FREQ_OPERATORS),
        date_range_value=rng.choice([7, 30]) if paired else None,
        date_range_unit=rng.choice(["day", "week", "month"]) if paired else None,
        event_filters=(
            None
            if rng.random() < 0.4
            else [rand_filter(rng) for _ in range(rng.randint(0, 2))]
        ),
        label=rng.choice([None, "", "Active Users", NON_BMP]),
    )


# ---------------------------------------------------------------------------
# Verbatim R10.9 mandatory edge set
# ---------------------------------------------------------------------------

MANDATORY_EDGES: list[Any] = [18.0, 1.5, True, None, [], "", NON_BMP]
"""R10.9 verbatim: integral float, fractional float, True, None, empty
list, empty string, non-BMP string."""


def edge_cases() -> list[dict[str, Any]]:
    """Build the mandatory edge set + one probe per owned code/branch.

    Returns:
        List of case dicts (each with `api`, `input`, and the recorded
        Python outcome attached later by :func:`run_cases`).
    """
    cases: list[dict[str, Any]] = []

    def add(api: str, kwargs: dict[str, Any], tag: str) -> None:
        cases.append({"api": api, "tag": tag, "kwargs": kwargs})

    # --- mandatory edges as Filter._value (build_filter_entry) ---------
    for edge in MANDATORY_EDGES:
        add(
            "build_filter_entry",
            {
                "f": Filter(
                    _property="p",
                    _operator="equals",
                    _value=edge,
                    _property_type="string",
                )
            },
            f"edge/filter_entry/value={edge!r}",
        )
    # --- mandatory edges as property names / labels --------------------
    for edge in ("", NON_BMP, " "):
        add(
            "build_filter_entry",
            {"f": Filter(_property=edge, _operator="is set", _value=None)},
            f"edge/filter_entry/prop={edge!r}",
        )
        add("build_group_section", {"group_by": edge}, f"edge/group/str={edge!r}")
    # --- every conditional-key branch ----------------------------------
    add(
        "build_filter_entry",
        {"f": Filter.in_the_last("$time", 7, "day")},
        "branch/filterDateUnit",
    )
    add(
        "build_group_section",
        {"group_by": GroupBy("a", property_type="number", bucket_size=10)},
        "branch/customBucket/size-only",
    )
    add(
        "build_group_section",
        {
            "group_by": GroupBy(
                "a", property_type="number", bucket_size=10, bucket_min=0
            )
        },
        "branch/customBucket/min",
    )
    add(
        "build_group_section",
        {
            "group_by": GroupBy(
                "a", property_type="number", bucket_size=10, bucket_max=9
            )
        },
        "branch/customBucket/max",
    )
    add(
        "build_frequency_filter_entry",
        {
            "ff": FrequencyFilter(
                "L", value=1, date_range_value=3, date_range_unit="day"
            )
        },
        "branch/dateRange",
    )
    add(
        "build_frequency_filter_entry",
        {"ff": FrequencyFilter("L", value=1, event_filters=[])},
        "branch/eventFilters-empty",
    )
    add(
        "build_frequency_filter_entry",
        {"ff": FrequencyFilter("L", value=1, label="x")},
        "branch/label",
    )
    add(
        "build_flow_cohort_filter",
        {"where": Filter.in_cohort(123, "PU")},
        "branch/cohort-id",
    )
    add(
        "build_flow_cohort_filter",
        {"where": Filter.in_cohort(COHORT_DEFS[0], "Inline")},
        "branch/cohort-raw",
    )
    # --- every owned guard code ----------------------------------------
    add("build_group_section", {"group_by": 123}, "code/BB1")
    add("build_flow_property_filter", {"filters": []}, "code/BB2")
    add(
        "build_flow_property_filter",
        {
            "filters": [
                Filter(
                    _property=CustomPropertyRef(id=1),
                    _operator="equals",
                    _value=["x"],
                )
            ]
        },
        "code/BB3",
    )
    add(
        "build_flow_cohort_filter",
        {"where": [Filter.equals("country", "US")]},
        "code/BB4",
    )
    add(
        "build_flow_cohort_filter",
        {"where": [Filter.in_cohort(1, "A"), Filter.in_cohort(2, "B")]},
        "code/BB5",
    )
    for bad in ("oops", []):
        add(
            "build_flow_cohort_filter",
            {
                "where": Filter(
                    _property="$cohorts",
                    _operator="contains",
                    _value=bad,
                    _property_type="list",
                )
            },
            f"code/BB6/{bad!r}",
        )
    for bad2 in ([42], ["cohort"]):
        add(
            "build_flow_cohort_filter",
            {
                "where": Filter(
                    _property="$cohorts",
                    _operator="contains",
                    _value=bad2,
                    _property_type="list",
                )
            },
            f"code/BB7/{bad2!r}",
        )
    for bad3 in ([{}], [{"cohort": "nope"}]):
        add(
            "build_flow_cohort_filter",
            {
                "where": Filter(
                    _property="$cohorts",
                    _operator="contains",
                    _value=bad3,
                    _property_type="list",
                )
            },
            f"code/BB8/{bad3!r}",
        )
    # --- filter-section skip branch ------------------------------------
    add(
        "build_filter_section",
        {"where": [Filter.equals("a", "b"), 42, None, {}, FrequencyFilter("L", 1)]},
        "branch/filter-section-skip",
    )
    add("build_filter_section", {"where": None}, "branch/filter-section-none")
    add("build_filter_section", {"where": []}, "branch/filter-section-empty")
    add("build_flow_cohort_filter", {"where": []}, "branch/flow-cohort-empty")
    # --- date builders --------------------------------------------------
    for from_date, to_date in (
        ("2026-01-01", None),
        ("2026-01-01", "2026-02-01"),
        (None, None),
        (None, "2026-02-01"),
    ):
        add(
            "build_time_section",
            {"from_date": from_date, "to_date": to_date, "last": 30, "unit": "day"},
            f"branch/time/{from_date}-{to_date}",
        )
        add(
            "build_date_range",
            {"from_date": from_date, "to_date": to_date, "last": 30},
            f"branch/range/{from_date}-{to_date}",
        )
    # --- non-oracle-fuzzed helpers (locked here anyway) -----------------
    add(
        "build_time_comparison",
        {"tc": TimeComparison.relative("month")},
        "branch/tc-relative",
    )
    add(
        "build_time_comparison",
        {"tc": TimeComparison.absolute_start("2026-01-01")},
        "branch/tc-absolute",
    )
    add(
        "build_frequency_group_entry",
        {"fb": FrequencyBreakdown("Purchase", label=""), "data_group_id": 5},
        "branch/freq-group-empty-label",
    )
    add(
        "patch_custom_property_filters_for_transform",
        {
            "filter_entries": [
                {"customPropertyId": 1},
                {"value": None, "customProperty": {}},
                {"value": "x"},
                {},
            ]
        },
        "branch/patch",
    )
    add(
        "_build_composed_properties",
        {
            "inputs": {
                "A": PropertyInput("price", type="number"),
                "B": PropertyInput(NON_BMP, resource_type="user"),
            }
        },
        "branch/composed",
    )
    return cases


# ---------------------------------------------------------------------------
# Family generation
# ---------------------------------------------------------------------------

FAMILIES = (
    "build_filter_entry",
    "build_filter_section",
    "build_group_section",
    "build_flow_property_filter",
    "build_flow_cohort_filter",
    "build_frequency_filter_entry",
    "build_time_section",
    "build_date_range",
    "build_frequency_group_entry",
    "build_time_comparison",
    "patch_custom_property_filters_for_transform",
    "_build_composed_properties",
)


def draw(api: str, rng: random.Random) -> dict[str, Any] | None:
    """Draw one call's kwargs for a family.

    Args:
        api: Family name.
        rng: Seeded RNG.

    Returns:
        Kwargs dict, or ``None`` when the draw hit a constructor guard
        (recorded as a skip by the caller).
    """
    if api == "build_filter_entry":
        return {"f": rand_filter(rng)}
    if api == "build_filter_section":
        roll = rng.random()
        if roll < 0.1:
            return {"where": None}
        if roll < 0.3:
            return {"where": rand_filter(rng)}
        if roll < 0.4:
            return {"where": rand_frequency_filter(rng)}
        items: list[Any] = []
        for _ in range(rng.randint(0, 4)):
            pick = rng.random()
            if pick < 0.6:
                items.append(rand_filter(rng))
            elif pick < 0.8:
                items.append(rand_frequency_filter(rng))
            else:
                items.append(rng.choice([42, None, "x", {}, []]))
        return {"where": items}
    if api == "build_group_section":
        kwargs: dict[str, Any] = {
            "data_group_id": rng.choice([None, 0, 5, 42]),
        }
        roll = rng.random()
        if roll < 0.1:
            kwargs["group_by"] = None
        elif roll < 0.4:
            kwargs["group_by"] = rand_group_element(rng)
        else:
            kwargs["group_by"] = [
                rand_group_element(rng) for _ in range(rng.randint(0, 4))
            ]
        return kwargs
    if api == "build_flow_property_filter":
        return {"filters": [rand_filter(rng) for _ in range(rng.randint(0, 3))]}
    if api == "build_flow_cohort_filter":
        roll = rng.random()
        if roll < 0.4:
            return {"where": rand_cohort_filter(rng)}
        return {
            "where": [rand_cohort_filter(rng) for _ in range(rng.randint(0, 3))]
        }
    if api == "build_frequency_filter_entry":
        return {"ff": rand_frequency_filter(rng)}
    if api == "build_time_section":
        return {
            "from_date": rng.choice([None, "2026-01-01", "1999-12-31", ""]),
            "to_date": rng.choice([None, "2026-02-01", ""]),
            "last": rng.choice([0, 1, 7, 30, -5, 365]),
            "unit": rng.choice(QUERY_UNITS),
        }
    if api == "build_date_range":
        return {
            "from_date": rng.choice([None, "2026-01-01", ""]),
            "to_date": rng.choice([None, "2026-02-01", ""]),
            "last": rng.choice([0, 1, 7, 30, -5]),
        }
    if api == "build_frequency_group_entry":
        return {
            "fb": FrequencyBreakdown(
                event=rng.choice(["Purchase", NON_BMP]),
                bucket_size=rng.choice([1, 5]),
                bucket_min=rng.choice([0, 2]),
                bucket_max=rng.choice([10, 50]),
                label=rng.choice([None, "", "L", NON_BMP]),
            ),
            "data_group_id": rng.choice([None, 0, 5]),
        }
    if api == "build_time_comparison":
        pick = rng.random()
        if pick < 0.5:
            tc = TimeComparison.relative(
                rng.choice(["day", "week", "month", "quarter", "year"])
            )
        elif pick < 0.75:
            tc = TimeComparison.absolute_start("2026-01-01")
        else:
            tc = TimeComparison.absolute_end("2026-12-31")
        return {"tc": tc}
    if api == "patch_custom_property_filters_for_transform":
        entries: list[dict[str, Any]] = []
        for _ in range(rng.randint(0, 4)):
            entry: dict[str, Any] = {}
            if rng.random() < 0.4:
                entry["value"] = rng.choice([None, "x", 1])
            if rng.random() < 0.5:
                entry["customPropertyId"] = rng.randint(1, 99)
            if rng.random() < 0.3:
                entry["customProperty"] = {"displayFormula": "A"}
            entry["filterOperator"] = rng.choice(["equals", "is set"])
            entries.append(entry)
        return {"filter_entries": entries}
    if api == "_build_composed_properties":
        return {
            "inputs": {
                chr(ord("A") + i): PropertyInput(
                    name=rng.choice(STRINGS) or "p",
                    type=rng.choice(
                        ["string", "number", "boolean", "datetime", "list"]
                    ),
                    resource_type=rng.choice(["event", "user"]),
                )
                for i in range(rng.randint(0, 3))
            }
        }
    raise AssertionError(api)


def run_cases(cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Attach the observed Python outcome to each case.

    Args:
        cases: Case dicts with `api` / `tag` / `kwargs`.

    Returns:
        Fully populated, JSON-serializable case dicts.
    """
    out: list[dict[str, Any]] = []
    for case in cases:
        fn = getattr(bb, case["api"])
        result = outcome(fn, case["kwargs"])
        try:
            encoded_kwargs = {k: enc(v) for k, v in case["kwargs"].items()}
        except TypeError:
            continue
        out.append(
            {
                "api": case["api"],
                "tag": case["tag"],
                "input": encoded_kwargs,
                "today": FROZEN_TODAY,
                **result,
            }
        )
    return out


def main() -> None:
    """Generate and write the case corpus.

    Raises:
        SystemExit: On bad CLI usage.
    """
    if len(sys.argv) < 4:
        raise SystemExit("usage: gen-cases.py SEED N OUT.json")
    seed = int(sys.argv[1])
    per_family = int(sys.argv[2])
    out_path = sys.argv[3]

    cases: list[dict[str, Any]] = edge_cases()
    skipped = 0
    for api in FAMILIES:
        rng = random.Random(f"{seed}:{api}")
        made = 0
        attempts = 0
        while made < per_family and attempts < per_family * 20:
            attempts += 1
            try:
                kwargs = draw(api, rng)
            except (ParamTypeError, ParamValidationError, ValueError, TypeError):
                skipped += 1
                continue
            if kwargs is None:
                skipped += 1
                continue
            cases.append({"api": api, "tag": f"{api}/{made}", "kwargs": kwargs})
            made += 1
    resolved = run_cases(cases)
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(
            {"seed": seed, "per_family": per_family, "cases": resolved},
            handle,
            ensure_ascii=False,
        )
    print(
        f"generated seed={seed} per_family={per_family} "
        f"cases={len(resolved)} construction_skips={skipped}"
    )


if __name__ == "__main__":
    try:
        main()
    except Exception:  # noqa: BLE001 — throwaway driver
        traceback.print_exc()
        sys.exit(1)
    _ = math  # keep the import honest for float helpers during debugging
