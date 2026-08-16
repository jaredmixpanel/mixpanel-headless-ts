#!/usr/bin/env python
"""B3-K3 R10.9 differential harness — CPython case generator.

Drives the REAL `mixpanel_headless._internal.{segfilter,expressions,transforms}`
functions over a seeded draw plus the verbatim R10.9 mandatory edge block and
writes `cases.json` for the Node driver (`harness.mjs`) to replay against the
ported `packages/core/src/query/*` modules.

Usage:
    uv run --project <py-repo> python gen-cases.py SEED N OUT.json

Encoding (twin of `harness.mjs::decode`):
    float            -> {"__f__": repr(value)}   (PyFloat carrier on the TS side)
    datetime         -> {"$dt": value.isoformat()}
    Filter           -> {"$": "Filter", "f": {field: enc(value)}}
    dict/list/scalar -> as-is (recursively encoded)
"""

from __future__ import annotations

import json
import random
import sys
from datetime import datetime
from typing import Any

from mixpanel_headless._internal import transforms
from mixpanel_headless._internal.expressions import normalize_on_expression
from mixpanel_headless._internal.segfilter import build_segfilter_entry
from mixpanel_headless.types import Filter

FILTER_FIELDS = (
    "_property",
    "_operator",
    "_value",
    "_property_type",
    "_resource_type",
    "_date_unit",
    "_list_item_filters",
    "_list_item_quantifier",
)


def enc(value: Any) -> Any:
    """Encode a Python value for the Node driver.

    Args:
        value: Any value drawn or produced by the generator.

    Returns:
        A JSON-serializable encoding preserving float-ness, datetimes and
        Filter instances.
    """
    if isinstance(value, bool) or value is None or isinstance(value, (int, str)):
        return value
    if isinstance(value, float):
        return {"__f__": repr(value)}
    if isinstance(value, datetime):
        return {"$dt": value.isoformat()}
    if isinstance(value, Filter):
        return {
            "$": "Filter",
            "f": {name: enc(getattr(value, name)) for name in FILTER_FIELDS},
        }
    if isinstance(value, dict):
        return {key: enc(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [enc(item) for item in value]
    raise TypeError(f"unencodable {type(value).__name__}")


# ---------------------------------------------------------------------------
# Draw alphabets
# ---------------------------------------------------------------------------

# Every operator row of the three segfilter maps, plus unknown spellings.
STRING_OPS = [
    "equals",
    "does not equal",
    "contains",
    "does not contain",
    "is set",
    "is not set",
]
NUMBER_OPS = [
    "is greater than",
    "is less than",
    "is equal to",
    "equals",
    "does not equal",
    "is at least",
    "is at most",
    "is between",
    "between",
    "not between",
    "is set",
    "is not set",
]
DATETIME_OPS = [
    "was on",
    "was not on",
    "was before",
    "was since",
    "was in the",
    "was not in the",
    "was between",
    "was not between",
]
UNKNOWN_OPS = ["magical_unicorn", "", "was in the next", "starts with", "true"]
ALL_OPS = STRING_OPS + NUMBER_OPS + DATETIME_OPS + UNKNOWN_OPS + ["true", "false"]

PROPERTY_TYPES = ["string", "number", "boolean", "datetime", "list", "object", "weird"]
RESOURCE_TYPES = ["events", "people", "cohorts", "other", "unmapped"]
DATE_UNITS = [None, "hour", "day", "week", "month", ""]

NAMES = [
    "country",
    "$browser",
    "",
    "𝒳",
    "emoji🎉",
    "with space",
    'quote"name',
    "back\\slash",
    "日本語",
]

DATE_STRINGS = [
    "2026-01-15",
    "2026-1-5",
    "01/15/2026",
    "junk",
    "",
    "2026-01-15-01",
    "9999-12-31",
    "0001-01-01",
    "-2026-01-15",
]

SCALARS = [
    None,
    True,
    False,
    0,
    1,
    -7,
    42,
    18.0,
    1.5,
    -0.0,
    9.99,
    1e16,
    1e-5,
    "",
    "x",
    "𝒳",
    "10",
]


def draw_value(rng: random.Random, prop_type: str, operator: str) -> Any:
    """Draw a `Filter._value` biased to the operator's expected shape.

    Args:
        rng: Seeded RNG.
        prop_type: The drawn `_property_type`.
        operator: The drawn `_operator`.

    Returns:
        A value from the in-annotation domain (str/int/float/list/None),
        biased so each operator family reaches its intended branch while
        still drawing adversarial shapes.
    """
    roll = rng.random()
    if operator in ("is between", "between", "not between"):
        if roll < 0.7:
            return [rng.choice([0, 10, 18.0, 1.5, -3]), rng.choice([100, 9.99, 2])]
        return rng.choice([[], [1], [1, 2, 3], "ab", 5, None, ["a", "b"]])
    if operator in ("was between", "was not between"):
        if roll < 0.7:
            return [rng.choice(DATE_STRINGS), rng.choice(DATE_STRINGS)]
        return rng.choice([[], ["2026-01-15"], [1, 2], "2026-01-15", None, 7])
    if operator in ("was in the", "was not in the"):
        return rng.choice([1, 7, 30, 18.0, 1.5, None, "7", True])
    if prop_type == "datetime":
        return rng.choice(DATE_STRINGS + [None, 7, 18.0, True, ["2026-01-15"]])
    if prop_type == "number":
        return rng.choice(SCALARS + [[1, 2], {"a": 1}])
    if roll < 0.5:
        return rng.choice([[s] for s in ["US", "UK", "𝒳", ""]] + [["US", "UK"]])
    return rng.choice(SCALARS)


EXPR_FRAGMENTS = [
    "Source",
    "",
    "  ",
    '"',
    "\\",
    "\\\\",
    '\\"',
    '"quoted"',
    "properties[",
    'properties["',
    'user["',
    'event["',
    "𝒳",
    "emoji🎉️",
    "́",
    "﻿",
    "​",
    "\n",
    "\t",
    "\r",
    "' or '",
    "a\\",
    "日本語",
    "$os",
]


def draw_expression(rng: random.Random) -> str:
    """Draw an escaping-biased `normalize_on_expression` input.

    Args:
        rng: Seeded RNG.

    Returns:
        A string built from the adversarial fragment alphabet.
    """
    return "".join(rng.choice(EXPR_FRAGMENTS) for _ in range(rng.randint(0, 4)))


PROP_KEYS = ["plan", "distinct_id", "time", "$insert_id", "𝒳key", "", "$os"]
TIME_VALUES = [
    0,
    1,
    -1,
    1704067200,
    18.0,
    1.5,
    -1.5,
    0.5,
    -0.5,
    1.0000005,
    2.5e-6,
    5e-7,
    -1.5e-6,
    True,
    False,
    253402300799,
    -62135596800,
    1e11,
    "x",
    None,
    [1],
    {"a": 1},
]


def draw_event(rng: random.Random) -> dict[str, Any]:
    """Draw a raw export-API event dict.

    Args:
        rng: Seeded RNG.

    Returns:
        An event dict with/without `event`/`properties` and a properties
        payload biased across the reserved-key grid.
    """
    event: dict[str, Any] = {}
    if rng.random() < 0.85:
        event["event"] = rng.choice(["Sign Up", "", "𝒳", "日本語"])
    if rng.random() < 0.9:
        properties: dict[str, Any] = {}
        if rng.random() < 0.8:
            properties["time"] = rng.choice(TIME_VALUES)
        if rng.random() < 0.7:
            properties["distinct_id"] = rng.choice(["user123", "", None, 42, "𝒳"])
        insert_roll = rng.random()
        if insert_roll < 0.4:
            properties["$insert_id"] = rng.choice(["abc123", "", "𝒳"])
        elif insert_roll < 0.6:
            properties["$insert_id"] = None
        for _ in range(rng.randint(0, 3)):
            properties[rng.choice(PROP_KEYS)] = rng.choice(SCALARS)
        event["properties"] = properties
    elif rng.random() < 0.5:
        event["properties"] = rng.choice([None, 5, "ab", [1, 2]])
    return event


def draw_profile(rng: random.Random) -> dict[str, Any]:
    """Draw a raw engage-API profile dict.

    Args:
        rng: Seeded RNG.

    Returns:
        A profile dict across the `$distinct_id`/`$properties`/`$last_seen`
        present-absent grid.
    """
    profile: dict[str, Any] = {}
    if rng.random() < 0.8:
        profile["$distinct_id"] = rng.choice(["user123", "", None, 42, "𝒳"])
    roll = rng.random()
    if roll < 0.8:
        properties: dict[str, Any] = {}
        if rng.random() < 0.7:
            properties["$last_seen"] = rng.choice(
                ["2024-01-15T10:30:00", None, "", 18.0]
            )
        for _ in range(rng.randint(0, 3)):
            properties[rng.choice(PROP_KEYS)] = rng.choice(SCALARS)
        profile["$properties"] = properties
    elif roll < 0.9:
        profile["$properties"] = rng.choice([None, 5, "ab", [1, 2]])
    return profile


# ---------------------------------------------------------------------------
# Mandatory R10.9 edge block (verbatim items + every K3 error branch)
# ---------------------------------------------------------------------------


def _filter(**kwargs: Any) -> Filter:
    """Build a Filter bypassing the factory constructors.

    Args:
        **kwargs: Field overrides for the dataclass.

    Returns:
        The constructed Filter.
    """
    fields: dict[str, Any] = {
        "_property": "p",
        "_operator": "equals",
        "_value": None,
        "_property_type": "string",
        "_resource_type": "events",
        "_date_unit": None,
    }
    fields.update(kwargs)
    return Filter(**fields)  # type: ignore[arg-type]


def edge_cases() -> list[tuple[str, str, dict[str, Any]]]:
    """Build the mandatory edge block.

    Returns:
        `(tag, api, input)` triples covering the verbatim R10.9 edge set,
        every SG code, the `_convert_date_format` arity branch and the
        transform edge items named by the packet.
    """
    out: list[tuple[str, str, dict[str, Any]]] = []

    # Verbatim R10.9 edge values through the string-operand path.
    for label, value in [
        ("int-float", 18.0),
        ("frac-float", 1.5),
        ("true", True),
        ("none", None),
        ("empty-list", []),
        ("empty-str", ""),
        ("non-bmp", "𝒳"),
    ]:
        out.append(
            (
                f"edge/string-equals/{label}",
                "build_segfilter_entry",
                {"f": _filter(_operator="equals", _value=value)},
            )
        )
        out.append(
            (
                f"edge/number-gt/{label}",
                "build_segfilter_entry",
                {
                    "f": _filter(
                        _operator="is greater than",
                        _value=value,
                        _property_type="number",
                    )
                },
            )
        )
        out.append(
            (
                f"edge/number-between/{label}",
                "build_segfilter_entry",
                {
                    "f": _filter(
                        _operator="is between", _value=value, _property_type="number"
                    )
                },
            )
        )
        out.append(
            (
                f"edge/datetime-on/{label}",
                "build_segfilter_entry",
                {
                    "f": _filter(
                        _operator="was on", _value=value, _property_type="datetime"
                    )
                },
            )
        )
        out.append(
            (
                f"edge/datetime-relative/{label}",
                "build_segfilter_entry",
                {
                    "f": _filter(
                        _operator="was in the",
                        _value=value,
                        _property_type="datetime",
                        _date_unit="day",
                    )
                },
            )
        )
        out.append((f"edge/expr/{label}", "normalize_on_expression", {"on": str(value)}))

    # Every SG code.
    out.append(
        (
            "edge/SG1",
            "build_segfilter_entry",
            {"f": _filter(_operator="magical_unicorn", _value="y")},
        )
    )
    out.append(
        (
            "edge/SG2",
            "build_segfilter_entry",
            {"f": _filter(_operator="magical_unicorn", _value=1, _property_type="number")},
        )
    )
    out.append(
        (
            "edge/SG3",
            "build_segfilter_entry",
            {
                "f": _filter(
                    _operator="magical_unicorn",
                    _value="2026-01-01",
                    _property_type="datetime",
                )
            },
        )
    )
    for bad_type in ("list", "object", "weird"):
        out.append(
            (
                f"edge/SG4/{bad_type}",
                "build_segfilter_entry",
                {"f": _filter(_value="y", _property_type=bad_type)},
            )
        )

    # `_convert_date_format` arity branch, both directions.
    for date_str in ("2026-1-5", "01/15/2026", "junk", "", "2026-01-15-01", "a-b-c-d"):
        out.append(
            (
                f"edge/date-arity/{date_str or 'empty'}",
                "build_segfilter_entry",
                {
                    "f": _filter(
                        _operator="was on", _value=date_str, _property_type="datetime"
                    )
                },
            )
        )
        out.append(
            (
                f"edge/date-arity-range/{date_str or 'empty'}",
                "build_segfilter_entry",
                {
                    "f": _filter(
                        _operator="was between",
                        _value=[date_str, "2026-01-15"],
                        _property_type="datetime",
                    )
                },
            )
        )
    # Non-string element in the range branch (AttributeError twin).
    out.append(
        (
            "edge/date-range-nonstr",
            "build_segfilter_entry",
            {
                "f": _filter(
                    _operator="was between", _value=[1, 2], _property_type="datetime"
                )
            },
        )
    )

    # Boolean filters + resource-type fallback rows.
    for operator in ("true", "false", "magical_unicorn"):
        out.append(
            (
                f"edge/boolean/{operator}",
                "build_segfilter_entry",
                {"f": _filter(_operator=operator, _property_type="boolean")},
            )
        )
    for resource in RESOURCE_TYPES:
        out.append(
            (
                f"edge/resource/{resource}",
                "build_segfilter_entry",
                {"f": _filter(_operator="equals", _value=["US"], _resource_type=resource)},
            )
        )
    # Setness on the number path + relative op with date_unit None.
    for operator in ("is set", "is not set"):
        out.append(
            (
                f"edge/number-setness/{operator}",
                "build_segfilter_entry",
                {"f": _filter(_operator=operator, _property_type="number")},
            )
        )
    out.append(
        (
            "edge/relative-no-unit",
            "build_segfilter_entry",
            {
                "f": _filter(
                    _operator="was in the", _value=7, _property_type="datetime"
                )
            },
        )
    )

    # Systematic operator-row sweep: EVERY row of the three maps on its
    # matching property type (packet: "audit filter_strategy() coverage
    # against the three tables and extend where a row is unreachable"),
    # with date_unit set AND unset for the datetime rows.
    for operator in STRING_OPS:
        out.append(
            (
                f"row/string/{operator}",
                "build_segfilter_entry",
                {"f": _filter(_operator=operator, _value=["US", "𝒳"])},
            )
        )
    for operator in NUMBER_OPS:
        value: Any = [10, 100] if operator in ("is between", "between", "not between") else 18.0
        out.append(
            (
                f"row/number/{operator}",
                "build_segfilter_entry",
                {"f": _filter(_operator=operator, _value=value, _property_type="number")},
            )
        )
    for operator in DATETIME_OPS:
        if operator in ("was between", "was not between"):
            dt_value: Any = ["2026-01-01", "2026-01-31"]
        elif operator in ("was in the", "was not in the"):
            dt_value = 7
        else:
            dt_value = "2026-03-05"
        for unit in (None, "day", "hour", "week", "month", ""):
            out.append(
                (
                    f"row/datetime/{operator}/{unit}",
                    "build_segfilter_entry",
                    {
                        "f": _filter(
                            _operator=operator,
                            _value=dt_value,
                            _property_type="datetime",
                            _date_unit=unit,
                        )
                    },
                )
            )

    # Expressions: escaping edges.
    for text in EXPR_FRAGMENTS + ['path\\to\\"file', 'my"property', "a\\\\b"]:
        out.append((f"edge/expr-frag/{text!r}", "normalize_on_expression", {"on": text}))

    # Transforms.
    out.append(("edge/event/empty", "transform_event", {"event": {}}))
    out.append(
        (
            "edge/event/int-float",
            "transform_event",
            {"event": {"event": "E", "properties": {"time": 18.0}}},
        )
    )
    out.append(
        (
            "edge/event/frac-float",
            "transform_event",
            {"event": {"event": "E", "properties": {"time": 1.5}}},
        )
    )
    out.append(
        (
            "edge/event/non-bmp",
            "transform_event",
            {"event": {"event": "𝒳", "properties": {"time": 0, "𝒳k": "𝒳v"}}},
        )
    )
    for time_value in TIME_VALUES:
        out.append(
            (
                f"edge/event/time/{time_value!r}",
                "transform_event",
                {"event": {"event": "E", "properties": {"time": time_value}}},
            )
        )
    out.append(("edge/profile/empty", "transform_profile", {"profile": {}}))
    out.append(
        (
            "edge/profile/missing-distinct",
            "transform_profile",
            {"profile": {"$properties": {"plan": "free"}}},
        )
    )
    out.append(
        (
            "edge/profile/non-dict-props",
            "transform_profile",
            {"profile": {"$properties": None}},
        )
    )
    return out


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

FAMILIES = (
    "build_segfilter_entry",
    "normalize_on_expression",
    "transform_event",
    "transform_profile",
)


def call(api: str, payload: dict[str, Any], uuid_value: str) -> Any:
    """Invoke the real Python function for one case.

    Args:
        api: Family name.
        payload: Keyword inputs.
        uuid_value: Deterministic uuid the stub returns for this case.

    Returns:
        The function's return value.
    """
    if api == "build_segfilter_entry":
        return build_segfilter_entry(payload["f"])
    if api == "normalize_on_expression":
        return normalize_on_expression(payload["on"])
    if api == "transform_event":
        transforms.uuid.uuid4 = lambda: uuid_value  # type: ignore[assignment, return-value]
        return transforms.transform_event(payload["event"])
    if api == "transform_profile":
        return transforms.transform_profile(payload["profile"])
    raise ValueError(f"unknown api {api}")


def main() -> None:
    """Generate the case corpus and write it to disk."""
    seed = int(sys.argv[1])
    per_family = int(sys.argv[2])
    out_path = sys.argv[3]

    rng = random.Random(seed)
    raw: list[tuple[str, str, dict[str, Any]]] = list(edge_cases())

    for index in range(per_family):
        prop_type = rng.choice(PROPERTY_TYPES)
        operator = rng.choice(ALL_OPS)
        raw.append(
            (
                f"draw/segfilter/{index}",
                "build_segfilter_entry",
                {
                    "f": _filter(
                        _property=rng.choice(NAMES),
                        _operator=operator,
                        _value=draw_value(rng, prop_type, operator),
                        _property_type=prop_type,
                        _resource_type=rng.choice(RESOURCE_TYPES),
                        _date_unit=rng.choice(DATE_UNITS),
                    )
                },
            )
        )
        raw.append(
            (
                f"draw/expr/{index}",
                "normalize_on_expression",
                {"on": draw_expression(rng)},
            )
        )
        raw.append((f"draw/event/{index}", "transform_event", {"event": draw_event(rng)}))
        raw.append(
            (f"draw/profile/{index}", "transform_profile", {"profile": draw_profile(rng)})
        )

    cases: list[dict[str, Any]] = []
    original_uuid4 = transforms.uuid.uuid4
    for index, (tag, api, payload) in enumerate(raw):
        uuid_value = f"00000000-0000-4000-8000-{index:012d}"
        encoded_input = {key: enc(value) for key, value in payload.items()}
        case: dict[str, Any] = {
            "tag": tag,
            "api": api,
            "input": encoded_input,
            "uuid": uuid_value,
        }
        try:
            case["output"] = enc(call(api, payload, uuid_value))
        except Exception as exc:  # noqa: BLE001 — differential harness
            case["error"] = {
                "class": type(exc).__name__,
                "code": getattr(exc, "code", None),
            }
        cases.append(case)
    transforms.uuid.uuid4 = original_uuid4  # type: ignore[assignment]

    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(
            {"seed": seed, "per_family": per_family, "families": list(FAMILIES), "cases": cases},
            handle,
            ensure_ascii=False,
        )
    print(f"wrote {len(cases)} cases (seed {seed}, {per_family}/family) -> {out_path}")


if __name__ == "__main__":
    main()
