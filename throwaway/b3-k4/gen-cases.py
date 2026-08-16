#!/usr/bin/env python
"""B3-K4 R10.9 differential harness — CPython case generator.

Drives the REAL `mixpanel_headless._internal.query.user_builders` functions
(`filter_to_selector`, `filters_to_selector`, `extract_cohort_filter`, plus
`_format_value` directly) over the verbatim R10.9 mandatory edge block and a
seeded, escaping-biased draw, then writes `cases.json` for the Node driver
(`harness.mjs`) to replay against `packages/core/src/query/user-builders.ts`.

Budget (packet K4, P3-6 "doubled fuzz"): the two selector entry points draw
>= 1,000 examples each; `extract_cohort_filter` draws >= 500.

Usage:
    uv run --project <py-repo> python gen-cases.py SEED N OUT.json

Encoding (twin of `harness.mjs::decode`):
    float            -> {"__f__": repr(value)}   (PyFloat carrier on the TS side)
    Filter           -> {"$": "Filter", "f": {field: enc(value)}}
    tuple            -> list (the binding's 2-element JSON array)
    dict/list/scalar -> as-is (recursively encoded)
"""

from __future__ import annotations

import json
import random
import sys
from typing import Any

from mixpanel_headless._internal.query.user_builders import (
    _format_value,
    extract_cohort_filter,
    filter_to_selector,
    filters_to_selector,
)
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
        A JSON-serializable encoding preserving float-ness and Filters.

    Raises:
        TypeError: The value has no encoding (never reached by this
            generator's domains).
    """
    if isinstance(value, bool) or value is None or isinstance(value, (int, str)):
        return value
    if isinstance(value, float):
        return {"__f__": repr(value)}
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
# Draw alphabets — adversarial escaping bias (packet K4 mandate)
# ---------------------------------------------------------------------------

# Every operator `filter_to_selector` dispatches on, plus unsupported
# spellings that must land on ES13.
SELECTOR_OPS = [
    "equals",
    "does not equal",
    "contains",
    "does not contain",
    "is greater than",
    "is less than",
    "is between",
    "is set",
    "is not set",
    "true",
    "false",
]
UNKNOWN_OPS = [
    "",
    "was frobnicated",
    "is within",
    "EQUALS",
    "equals ",
    " equals",
    "in_cohort",
    # NOTE: "list_contains" is deliberately absent — `Filter.__post_init__`
    # (types.py:7209, LC1/LC2) rejects it without `_list_item_filters`, so the
    # draw would fail at CONSTRUCTION time on both sides, never reaching the
    # selector translation under test. Its `filter_to_selector` behavior is
    # plain ES13 fallthrough, covered by the other unknown spellings.
    "𝒳",
]
ALL_OPS = SELECTOR_OPS + UNKNOWN_OPS

# Escaping-biased fragments: lone/trailing/doubled backslashes, quotes and
# escaped quotes, backslash-quote compounds, single quotes, newlines/tabs/CR,
# non-BMP, emoji + variation selector, combining marks, U+FEFF / U+200B, the
# literal accessor text (selector-injection shape) and operator-injection
# fragments.
FRAGMENTS = [
    "",
    "a",
    "plan",
    "$city",
    "with space",
    "\\",
    "\\\\",
    "a\\",
    '"',
    '\\"',
    '\\\\"',
    '""',
    "'",
    "' or '",
    "' and '",
    " or ",
    " and ",
    'properties["',
    'properties["x"] == "y"',
    "user[\"e\"]",
    "\n",
    "\t",
    "\r",
    "\0",
    "𝒳",
    "🎉",
    "🎉️",
    "é",
    "﻿",
    "​",
    "日本語",
    "defined(",
    ")",
]


def draw_text(rng: random.Random) -> str:
    """Draw an escaping-biased string.

    Args:
        rng: Seeded RNG.

    Returns:
        A string assembled from the adversarial fragment alphabet.
    """
    return "".join(rng.choice(FRAGMENTS) for _ in range(rng.randint(0, 4)))


# Numeric bias: integral floats (PyFloat carriers cross the boundary),
# -0.0, exponent switch points, bools, plain ints.
NUMBERS = [0, 1, -10, 100, 18.0, 1.5, -0.0, 0.0, 9.99, 1e16, 1e-5, 1e-4, -1e16, True, False]

# Non-scalar values (dropped by the equals/not-equals element filters).
NON_SCALARS: list[Any] = [None, [], [1], {}, {"a": 1}, [{"b": 2}]]

# `_property` values, including the non-string shapes that hit ES1.
NON_STRING_PROPERTIES: list[Any] = [123, None, True, 18.0, ["tup"], {"k": "v"}, []]


def draw_property(rng: random.Random) -> Any:
    """Draw a `Filter._property` value.

    Args:
        rng: Seeded RNG.

    Returns:
        A string property name (85%) or a non-string ES1 shape (15%).
    """
    if rng.random() < 0.15:
        return rng.choice(NON_STRING_PROPERTIES)
    return draw_text(rng)


def draw_scalar(rng: random.Random) -> Any:
    """Draw a scalar-ish value for a selector operand.

    Args:
        rng: Seeded RNG.

    Returns:
        A string, number, bool or non-scalar shape.
    """
    roll = rng.random()
    if roll < 0.45:
        return draw_text(rng)
    if roll < 0.85:
        return rng.choice(NUMBERS)
    return rng.choice(NON_SCALARS)


def draw_value(rng: random.Random, operator: str) -> Any:
    """Draw a `Filter._value` biased to the operator's expected shape.

    Args:
        rng: Seeded RNG.
        operator: The drawn `_operator`.

    Returns:
        A value biased so each operator family reaches its intended branch
        while still drawing adversarial shapes (wrong types, empty lists,
        all-non-scalar lists).
    """
    roll = rng.random()
    if operator in ("equals", "does not equal"):
        if roll < 0.75:
            return [draw_scalar(rng) for _ in range(rng.randint(0, 3))]
        return rng.choice([draw_text(rng), rng.choice(NUMBERS), None, {"a": 1}])
    if operator in ("contains", "does not contain"):
        if roll < 0.75:
            return draw_text(rng)
        return rng.choice([rng.choice(NUMBERS), None, [draw_text(rng)], {}])
    if operator in ("is greater than", "is less than"):
        if roll < 0.75:
            return rng.choice(NUMBERS)
        return rng.choice([draw_text(rng), None, [1], {"a": 1}])
    if operator == "is between":
        if roll < 0.7:
            return [rng.choice(NUMBERS), rng.choice(NUMBERS)]
        return rng.choice(
            [
                [draw_text(rng), rng.choice(NUMBERS)],
                [rng.choice(NUMBERS), draw_text(rng)],
                [None, 10],
                [0, None],
                [],
                [1],
                [1, 2, 3],
                "nope",
                7,
                None,
            ]
        )
    return rng.choice([None, draw_text(rng), rng.choice(NUMBERS), []])


def make_filter(rng: random.Random) -> Filter:
    """Draw one Filter for the selector families.

    Args:
        rng: Seeded RNG.

    Returns:
        A Filter built straight from its fields (no factory validation).
    """
    operator = rng.choice(ALL_OPS)
    return _filter(
        _property=draw_property(rng),
        _operator=operator,
        _value=draw_value(rng, operator),
    )


COHORT_VALUES: list[Any] = [
    [{"cohort": {"id": 123, "name": "Power Users", "negated": False}}],
    [{"cohort": {"id": 456, "name": "", "negated": True}}],
    [{}],
    [{"a": 1}, {"b": 2}],
    [{"cohort": {"raw_cohort": {"selector": {"operator": "and", "children": []}}}}],
]


def make_cohort_filter(rng: random.Random) -> Filter:
    """Draw a cohort-shaped Filter (list-of-dict `_value`).

    Args:
        rng: Seeded RNG.

    Returns:
        A Filter whose `_value` satisfies `_is_cohort_filter`.
    """
    return _filter(
        _property="$cohorts",
        _operator=rng.choice(["contains", "does not contain"]),
        _value=rng.choice(COHORT_VALUES),
        _property_type="list",
    )


def draw_filter_list(rng: random.Random) -> list[Filter]:
    """Draw a Filter list for `filters_to_selector`.

    Args:
        rng: Seeded RNG.

    Returns:
        Zero to four drawn Filters (the empty list is drawn ~8% of the
        time so the `""` branch stays hot).
    """
    if rng.random() < 0.08:
        return []
    return [make_filter(rng) for _ in range(rng.randint(1, 4))]


def draw_extract_list(rng: random.Random) -> list[Filter]:
    """Draw a Filter list for `extract_cohort_filter`.

    Args:
        rng: Seeded RNG.

    Returns:
        A list mixing property filters with zero, one or two cohort
        filters in arbitrary positions (order preservation is contract).
    """
    if rng.random() < 0.08:
        return []
    items: list[Filter] = [make_filter(rng) for _ in range(rng.randint(0, 3))]
    for _ in range(rng.choice([0, 1, 1, 2, 3])):
        items.insert(rng.randint(0, len(items)), make_cohort_filter(rng))
    return items


# ---------------------------------------------------------------------------
# Mandatory R10.9 edge block (verbatim items + every ES code, both entries)
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


# (code, filter) pairs — one probe per ES code, replayed through BOTH
# selector entry points (packet K4 mandatory edge set).
ES_PROBES: list[tuple[str, Filter]] = [
    ("ES1", _filter(_property=123, _operator="is set", _value=None)),
    ("ES1-list", _filter(_property=["tup"], _operator="is set", _value=None)),
    ("ES2", _filter(_operator="equals", _value="notalist")),
    ("ES3", _filter(_operator="equals", _value=[None])),
    ("ES4", _filter(_operator="does not equal", _value="notalist")),
    ("ES5", _filter(_operator="does not equal", _value=[{"nested": True}])),
    ("ES6", _filter(_operator="contains", _value=5)),
    ("ES7", _filter(_operator="does not contain", _value=0.5)),
    ("ES8", _filter(_operator="is greater than", _value="x")),
    ("ES9", _filter(_operator="is less than", _value=None)),
    ("ES10", _filter(_operator="is between", _value=[1])),
    ("ES11", _filter(_operator="is between", _value=["low", 10])),
    ("ES12", _filter(_operator="is between", _value=[0, "high"])),
    ("ES13", _filter(_operator="was frobnicated", _value=None)),
]

# The verbatim R10.9 mandatory edge values.
EDGE_VALUES: list[tuple[str, Any]] = [
    ("int-float", 18.0),
    ("frac-float", 1.5),
    ("true", True),
    ("none", None),
    ("empty-list", []),
    ("empty-str", ""),
    ("non-bmp", "𝒳"),
]

# Adversarial escaping strings replayed through every string-bearing slot.
ESCAPE_STRINGS = [
    "\\",
    "a\\",
    "\\\\",
    '"',
    '\\"',
    '\\\\"',
    '"" \\\\ ""',
    "'",
    "' or '",
    "' and '",
    'properties["x"]',
    'properties["x"] == "y" or ',
    "\n\t\r",
    "\0",
    "𝒳",
    "🎉️",
    "é",
    "﻿​",
    "日本語",
]


def edge_cases() -> list[tuple[str, str, dict[str, Any]]]:
    """Build the mandatory edge block.

    Returns:
        `(tag, api, input)` triples covering the verbatim R10.9 edge set,
        every ES code through both entry points, the empty-list branch,
        the generator-order lock and the adversarial escaping strings.
    """
    out: list[tuple[str, str, dict[str, Any]]] = []

    # Verbatim edge values in every operand slot that can carry them.
    for label, value in EDGE_VALUES:
        out.append(
            (f"edge/equals-scalar/{label}", "filter_to_selector", {"f": _filter(_value=[value])})
        )
        out.append(
            (
                f"edge/equals-bare/{label}",
                "filter_to_selector",
                {"f": _filter(_value=value)},
            )
        )
        out.append(
            (
                f"edge/not-equals/{label}",
                "filter_to_selector",
                {"f": _filter(_operator="does not equal", _value=[value])},
            )
        )
        out.append(
            (
                f"edge/contains/{label}",
                "filter_to_selector",
                {"f": _filter(_operator="contains", _value=value)},
            )
        )
        out.append(
            (
                f"edge/gt/{label}",
                "filter_to_selector",
                {"f": _filter(_operator="is greater than", _value=value)},
            )
        )
        out.append(
            (
                f"edge/lt/{label}",
                "filter_to_selector",
                {"f": _filter(_operator="is less than", _value=value)},
            )
        )
        out.append(
            (
                f"edge/between-lo/{label}",
                "filter_to_selector",
                {"f": _filter(_operator="is between", _value=[value, 10])},
            )
        )
        out.append(
            (
                f"edge/between-hi/{label}",
                "filter_to_selector",
                {"f": _filter(_operator="is between", _value=[0, value])},
            )
        )
        out.append(
            (
                f"edge/between-bare/{label}",
                "filter_to_selector",
                {"f": _filter(_operator="is between", _value=value)},
            )
        )
        out.append(
            (
                f"edge/property/{label}",
                "filter_to_selector",
                {"f": _filter(_property=value, _operator="is set")},
            )
        )
        out.append((f"edge/format-value/{label}", "format_value", {"value": value}))

    # Adversarial escaping through the property name, the equals element,
    # the contains operand and `_format_value` directly.
    for index, text in enumerate(ESCAPE_STRINGS):
        out.append(
            (
                f"edge/escape-prop/{index}",
                "filter_to_selector",
                {"f": _filter(_property=text, _operator="is set")},
            )
        )
        out.append(
            (
                f"edge/escape-equals/{index}",
                "filter_to_selector",
                {"f": _filter(_property=text, _value=[text, text])},
            )
        )
        out.append(
            (
                f"edge/escape-contains/{index}",
                "filter_to_selector",
                {"f": _filter(_operator="contains", _value=text)},
            )
        )
        out.append(
            (
                f"edge/escape-not-contains/{index}",
                "filter_to_selector",
                {"f": _filter(_operator="does not contain", _value=text)},
            )
        )
        out.append((f"edge/escape-format/{index}", "format_value", {"value": text}))
        out.append(
            (
                f"edge/escape-seam/{index}",
                "filters_to_selector",
                {"filters": [_filter(_property=text, _value=[text]), _filter(_value=[text])]},
            )
        )

    # Every ES code through BOTH entry points.
    for code, filter_obj in ES_PROBES:
        out.append((f"edge/{code}/direct", "filter_to_selector", {"f": filter_obj}))
        out.append((f"edge/{code}/seam", "filters_to_selector", {"filters": [filter_obj]}))

    # Empty-list branches.
    out.append(("edge/filters/empty", "filters_to_selector", {"filters": []}))
    out.append(("edge/extract/empty", "extract_cohort_filter", {"filters": []}))

    # Generator-order lock: the SECOND element errors, so the first must
    # already be translated and the FIRST error to surface is ES13.
    out.append(
        (
            "edge/order/second-errors",
            "filters_to_selector",
            {
                "filters": [
                    _filter(_operator="is set", _value=None),
                    _filter(_operator="was frobnicated", _value=None),
                ]
            },
        )
    )
    # Both elements error — the FIRST one wins.
    out.append(
        (
            "edge/order/both-error",
            "filters_to_selector",
            {
                "filters": [
                    _filter(_property=123, _operator="is set", _value=None),
                    _filter(_operator="was frobnicated", _value=None),
                ]
            },
        )
    )

    # extract_cohort_filter placement grid.
    prop_filter = _filter(_operator="is set", _value=None)
    for count in (1, 2, 3):
        out.append(
            (
                f"edge/extract/cohorts-{count}",
                "extract_cohort_filter",
                {
                    "filters": [prop_filter]
                    + [
                        _filter(
                            _property="$cohorts",
                            _operator="contains",
                            _value=[{"cohort": {"id": index}}],
                            _property_type="list",
                        )
                        for index in range(count)
                    ]
                    + [prop_filter],
                },
            )
        )
    for label, value in (
        ("empty-list", []),
        ("list-of-str", ["a"]),
        ("list-of-dict-then-str", [{"a": 1}, "b"]),
        ("str-then-dict", ["a", {"b": 1}]),
        ("none", None),
    ):
        out.append(
            (
                f"edge/extract/shape/{label}",
                "extract_cohort_filter",
                {"filters": [_filter(_property="$cohorts", _value=value)]},
            )
        )
    return out


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

FAMILIES = (
    "filter_to_selector",
    "filters_to_selector",
    "extract_cohort_filter",
    "format_value",
)


def call(api: str, payload: dict[str, Any]) -> Any:
    """Invoke the real Python function for one case.

    Args:
        api: Family name.
        payload: Keyword inputs.

    Returns:
        The function's return value.

    Raises:
        ValueError: Unknown family name.
    """
    if api == "filter_to_selector":
        return filter_to_selector(payload["f"])
    if api == "filters_to_selector":
        return filters_to_selector(payload["filters"])
    if api == "extract_cohort_filter":
        return extract_cohort_filter(payload["filters"])
    if api == "format_value":
        return _format_value(payload["value"])
    raise ValueError(f"unknown api {api}")


def main() -> None:
    """Generate the case corpus and write it to disk."""
    seed = int(sys.argv[1])
    per_family = int(sys.argv[2])
    out_path = sys.argv[3]

    rng = random.Random(seed)
    raw: list[tuple[str, str, dict[str, Any]]] = list(edge_cases())

    # Doubled budget for the two selector entry points (P3-6 K4 mandate).
    for index in range(per_family):
        raw.append(
            (f"draw/filter/{index}", "filter_to_selector", {"f": make_filter(rng)})
        )
        raw.append(
            (
                f"draw/filters/{index}",
                "filters_to_selector",
                {"filters": draw_filter_list(rng)},
            )
        )
    for index in range(per_family // 2):
        raw.append(
            (
                f"draw/extract/{index}",
                "extract_cohort_filter",
                {"filters": draw_extract_list(rng)},
            )
        )
        raw.append((f"draw/format/{index}", "format_value", {"value": draw_scalar(rng)}))

    cases: list[dict[str, Any]] = []
    for tag, api, payload in raw:
        case: dict[str, Any] = {
            "tag": tag,
            "api": api,
            "input": {key: enc(value) for key, value in payload.items()},
        }
        try:
            case["output"] = enc(call(api, payload))
        except Exception as exc:  # noqa: BLE001 — differential harness
            case["error"] = {
                "class": type(exc).__name__,
                "code": getattr(exc, "code", None),
            }
        cases.append(case)

    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(
            {
                "seed": seed,
                "per_family": per_family,
                "families": list(FAMILIES),
                "cases": cases,
            },
            handle,
            ensure_ascii=False,
        )
    print(f"wrote {len(cases)} cases (seed {seed}, {per_family}/family) -> {out_path}")


if __name__ == "__main__":
    main()
