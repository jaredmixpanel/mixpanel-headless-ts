"""B5-S1 R10.9 differential harness — the Python (arbiter) side.

Generates the case corpus deterministically (seeded ``random.Random``),
computes the Python outputs, and writes ``cases.json`` + ``py-out.json``.
Run from the PYTHON repo so ``uv`` resolves the project:

    cd /Users/jaredmcfarland/Developer/mixpanel-headless && \
      uv run python <this file>

Throwaway (packet §7.5 removes ``throwaway/b5-s1/`` at the batch gate).
"""

from __future__ import annotations

import json
import random
import warnings
from pathlib import Path
from typing import Any

from mixpanel_headless._internal.services.discovery import (
    _DATE_PATTERN,
    _infer_scalar_type,
    _infer_subproperties,
    _is_valid_iso,
    _iter_dict_rows,
    _parse_bookmark_info,
    _parse_lexicon_definition,
    _parse_lexicon_metadata,
    _parse_lexicon_property,
    _parse_lexicon_schema,
    DiscoveryService,
)
from mixpanel_headless.types import SchemaGraphResult  # noqa: E402

HERE = Path(__file__).resolve().parent
SEED = 20260816
PER_FAMILY = 500

# The mandated R10.9 edge set (rulebook R10.9).
EDGE_SCALARS: list[Any] = [18.0, 1.5, True, None, [], "", "\U0001d4b3"]
EDGE_STRINGS = ["18.0", "1.5", "True", "", "\U0001d4b3", "2025-04-23", "x"]


def _rng() -> random.Random:
    """Return the seeded generator.

    Returns:
        A fresh ``random.Random`` pinned to :data:`SEED`.
    """
    return random.Random(SEED)


def _scalar(rng: random.Random) -> Any:
    """Draw one JSON scalar (edge set biased).

    Args:
        rng: The generator.

    Returns:
        A JSON-encodable scalar.
    """
    return rng.choice(
        [
            18.0,
            1.5,
            -0.0,
            0,
            1,
            True,
            False,
            None,
            "",
            "\U0001d4b3",
            "nike",
            "2025-04-23",
            "2025-04-23T10:30:00Z",
            "2025-13-99",
            "2025-04-23T24:00:00",
            "2024-02-29",
            "2023-02-29",
            "2025-04-23T10:30:00+0530",
            "2025-04-23T10:30:00+24:00",
            "0000-01-01",
            rng.randint(-(10**9), 10**9),
            rng.random(),
        ]
    )


def _value(rng: random.Random, depth: int = 0) -> Any:
    """Draw one JSON value (scalars, and nested containers at depth 0).

    Args:
        rng: The generator.
        depth: Current nesting depth.

    Returns:
        A JSON-encodable value.
    """
    if depth == 0 and rng.random() < 0.2:
        if rng.random() < 0.5:
            return [_value(rng, depth + 1) for _ in range(rng.randint(0, 2))]
        return {
            rng.choice(["a", "b", "\U0001d4b3"]): _value(rng, depth + 1)
            for _ in range(rng.randint(0, 2))
        }
    return _scalar(rng)


def _subkey(rng: random.Random) -> str:
    """Draw one subproperty key.

    Args:
        rng: The generator.

    Returns:
        The key.
    """
    return rng.choice(["Brand", "Price", "X", "", "\U0001d4b3", "1", "0", "a b"])


def gen_raw_values(rng: random.Random) -> list[str]:
    """Draw a `list_property_values` sample (the `_infer_subproperties` input).

    Args:
        rng: The generator.

    Returns:
        Raw JSON-ish strings.
    """
    out: list[str] = []
    for _ in range(rng.randint(0, 6)):
        roll = rng.random()
        if roll < 0.1:
            out.append(rng.choice(["not json", "", "null", "18.0", "NaN", "[1,2]"]))
        elif roll < 0.25:
            out.append(
                json.dumps(
                    [
                        {_subkey(rng): _value(rng) for _ in range(rng.randint(0, 3))}
                        for _ in range(rng.randint(0, 2))
                    ]
                )
            )
        else:
            out.append(
                json.dumps({_subkey(rng): _value(rng) for _ in range(rng.randint(0, 3))})
            )
    return out


def gen_metadata(rng: random.Random) -> Any:
    """Draw a `_parse_lexicon_metadata` input.

    Args:
        rng: The generator.

    Returns:
        ``None`` or a dict.
    """
    roll = rng.random()
    if roll < 0.15:
        return None
    if roll < 0.3:
        return {}
    if roll < 0.45:
        return {"other": _value(rng)}
    mp: dict[str, Any] = {}
    for key in ("$source", "displayName", "tags", "hidden", "dropped", "contacts", "teamContacts"):
        if rng.random() < 0.6:
            mp[key] = _value(rng)
    if rng.random() < 0.1:
        mp = {}
    return {"com.mixpanel": mp}


def gen_property(rng: random.Random) -> dict[str, Any]:
    """Draw a `_parse_lexicon_property` input.

    Args:
        rng: The generator.

    Returns:
        The property dict.
    """
    data: dict[str, Any] = {}
    if rng.random() < 0.7:
        data["type"] = rng.choice(["string", "number", "", None, 18.0, "\U0001d4b3"])
    if rng.random() < 0.7:
        data["description"] = rng.choice(["d", "", None, "\U0001d4b3"])
    if rng.random() < 0.5:
        data["metadata"] = gen_metadata(rng)
    return data


def gen_schema(rng: random.Random) -> dict[str, Any]:
    """Draw a `_parse_lexicon_schema` input.

    Args:
        rng: The generator.

    Returns:
        The schema dict.
    """
    schema_json: dict[str, Any] = {
        "properties": {
            _subkey(rng): gen_property(rng) for _ in range(rng.randint(0, 3))
        }
    }
    if rng.random() < 0.5:
        schema_json["description"] = rng.choice(["d", "", None])
    if rng.random() < 0.4:
        schema_json["metadata"] = gen_metadata(rng)
    return {
        "entityType": rng.choice(["event", "profile", "", "\U0001d4b3"]),
        "name": rng.choice(["Purchase", "", "\U0001d4b3", "a b"]),
        "schemaJson": schema_json,
    }


def gen_bookmark(rng: random.Random) -> dict[str, Any]:
    """Draw a `_parse_bookmark_info` input.

    Args:
        rng: The generator.

    Returns:
        The bookmark dict.
    """
    data: dict[str, Any] = {
        "id": rng.choice([1, 18.0, -3, 0]),
        "name": rng.choice(["R", "", "\U0001d4b3"]),
        "type": rng.choice(["insights", "funnels", "retention", "flows"]),
        "project_id": rng.randint(0, 10**6),
        "created": "2024-01-01T00:00:00",
        "modified": "2024-06-15T10:30:00",
    }
    for key in ("workspace_id", "dashboard_id", "description", "creator_id", "creator_name"):
        if rng.random() < 0.5:
            data[key] = _scalar(rng)
    return data


def gen_similar(rng: random.Random) -> dict[str, Any]:
    """Draw a `_find_similar_events` case.

    Args:
        rng: The generator.

    Returns:
        ``{"query": ..., "events": [...]}``.
    """
    pool = [
        "Sign Up",
        "sign_up_complete",
        "User Created",
        "user-deleted",
        "Login",
        "\U0001d4b3 event",
        "",
        " ",
        "a_b-c d",
        "split",
        "﻿bom",
        "Purchase",
        "purchase",
    ]
    return {
        "query": rng.choice(
            ["sign up", "user", "", " ", "\U0001d4b3", "purchase", "_", "a-b", ""]
        ),
        "events": rng.sample(pool, rng.randint(0, len(pool))),
    }


def gen_graph(rng: random.Random) -> dict[str, Any]:
    """Draw a `SchemaGraphResult` construction case.

    Args:
        rng: The generator.

    Returns:
        The constructor kwargs (JSON-encodable).
    """
    names = ["Purchase", "Login", "amount", "", "\U0001d4b3", "1"]

    def entry() -> Any:
        roll = rng.random()
        if roll < 0.15:
            return "NotADict"
        if roll < 0.3:
            return {"no": "name"}
        return {"name": rng.choice(names)}

    events = [
        ({"name": rng.choice(names)} if rng.random() < 0.8 else {"count": 5})
        for _ in range(rng.randint(0, 3))
    ]
    properties = []
    for _ in range(rng.randint(0, 3)):
        prop: dict[str, Any] = {}
        if rng.random() < 0.85:
            prop["name"] = rng.choice(names)
        if rng.random() < 0.6:
            prop["densityLocal"] = rng.choice([0.9, 18.0, 0, None, "x"])
        if rng.random() < 0.85:
            prop["events"] = [entry() for _ in range(rng.randint(0, 3))]
        properties.append(prop)
    return {
        "events": events,
        "properties": properties,
        "user_properties": [{"name": "plan"}] if rng.random() < 0.5 else [],
        "include_density": rng.random() < 0.5,
    }


def run_infer_subproperties(case: list[str]) -> Any:
    """Compute `_infer_subproperties` + its warnings.

    Args:
        case: Raw property values.

    Returns:
        ``{"subs": [...], "warnings": [...]}`` or an error record.
    """
    try:
        with warnings.catch_warnings(record=True) as captured:
            warnings.simplefilter("always")
            subs = _infer_subproperties(case)
        return {
            "subs": [
                {
                    "name": s.name,
                    "type": s.type,
                    "sample_values": list(s.sample_values),
                }
                for s in subs
            ],
            "warnings": sorted(str(w.message) for w in captured),
        }
    except Exception as exc:  # noqa: BLE001 - differential records the class
        return {"error": type(exc).__name__}


def main() -> None:
    """Generate the corpus, compute the Python outputs, write both files."""
    rng = _rng()
    cases: dict[str, list[Any]] = {
        "infer_subproperties": [],
        "infer_scalar_type": [],
        "is_valid_iso": [],
        "iter_dict_rows": [],
        "parse_lexicon_metadata": [],
        "parse_lexicon_property": [],
        "parse_lexicon_definition": [],
        "parse_lexicon_schema": [],
        "parse_bookmark_info": [],
        "find_similar_events": [],
        "schema_graph": [],
    }

    # Verbatim edge-set cases first (R10.9), then the generated bulk.
    cases["infer_subproperties"].append([json.dumps({"E": v}) for v in EDGE_SCALARS[:4]])
    cases["infer_subproperties"].append([json.dumps({"E": 18.0}), json.dumps({"E": 18})])
    cases["infer_subproperties"].append(EDGE_STRINGS)
    cases["infer_scalar_type"].extend(
        [
            [18.0],
            [1.5],
            [True],
            [""],
            ["\U0001d4b3"],
            [True, 1],
            [18.0, 1],
            ["2025-04-23", "2025-04-24"],
            ["2025-04-23", "x"],
            [],
        ]
    )
    cases["is_valid_iso"].extend(EDGE_STRINGS)
    cases["iter_dict_rows"].append(EDGE_STRINGS)
    cases["find_similar_events"].append({"query": "", "events": ["", "a"]})

    for _ in range(PER_FAMILY):
        cases["infer_subproperties"].append(gen_raw_values(rng))
        cases["infer_scalar_type"].append(
            [_scalar(rng) for _ in range(rng.randint(0, 4))]
        )
        cases["is_valid_iso"].append(
            rng.choice(
                [
                    "2025-04-23",
                    "2025-13-99",
                    "2025-02-30",
                    "2024-02-29",
                    "2023-02-29",
                    "2025-04-23T24:00:00",
                    "2025-04-23T24:00:01",
                    "2025-04-23T10:30",
                    "2025-04-23 10:30:00",
                    "2025-04-23T10:30:00.1234567890",
                    "2025-04-23T10:30:00Z",
                    "2025-04-23T10:30:00+0530",
                    "2025-04-23T10:30:00+00:60",
                    "2025-04-23T10:30:00+24:00",
                    "0000-01-01",
                    "9999-12-31",
                    "2025-00-10",
                    "2025-04-00",
                    "2025-04-23T23:60:00",
                    "2025-04-23T10:30:60",
                    "\U0001d4b3",
                    "18.0",
                ]
            )
        )
        cases["iter_dict_rows"].append(gen_raw_values(rng))
        cases["parse_lexicon_metadata"].append(gen_metadata(rng))
        cases["parse_lexicon_property"].append(gen_property(rng))
        cases["parse_lexicon_definition"].append(gen_schema(rng)["schemaJson"])
        cases["parse_lexicon_schema"].append(gen_schema(rng))
        cases["parse_bookmark_info"].append(gen_bookmark(rng))
        cases["find_similar_events"].append(gen_similar(rng))
        cases["schema_graph"].append(gen_graph(rng))

    out: dict[str, list[Any]] = {}

    out["infer_subproperties"] = [
        run_infer_subproperties(case) for case in cases["infer_subproperties"]
    ]

    def guarded(fn: Any, arg: Any) -> Any:
        """Run `fn(arg)`, recording the exception class on failure.

        Args:
            fn: The callable.
            arg: Its single argument.

        Returns:
            The result, or ``{"error": <class name>}``.
        """
        try:
            return fn(arg)
        except Exception as exc:  # noqa: BLE001
            return {"error": type(exc).__name__}

    out["infer_scalar_type"] = [
        guarded(lambda c: list(_infer_scalar_type(c)), case)
        for case in cases["infer_scalar_type"]
    ]
    out["is_valid_iso"] = [
        bool(_DATE_PATTERN.match(case)) and _is_valid_iso(case)
        for case in cases["is_valid_iso"]
    ]
    out["iter_dict_rows"] = [_iter_dict_rows(case) for case in cases["iter_dict_rows"]]
    out["parse_lexicon_metadata"] = [
        None if (m := _parse_lexicon_metadata(case)) is None else m.to_dict()
        for case in cases["parse_lexicon_metadata"]
    ]
    out["parse_lexicon_property"] = [
        _parse_lexicon_property(case).to_dict()
        for case in cases["parse_lexicon_property"]
    ]
    out["parse_lexicon_definition"] = [
        _parse_lexicon_definition(case).to_dict()
        for case in cases["parse_lexicon_definition"]
    ]
    out["parse_lexicon_schema"] = [
        guarded(lambda c: _parse_lexicon_schema(c).to_dict(), case)
        for case in cases["parse_lexicon_schema"]
    ]
    out["parse_bookmark_info"] = [
        guarded(lambda c: _parse_bookmark_info(c).to_dict(), case)
        for case in cases["parse_bookmark_info"]
    ]

    svc = DiscoveryService(None)  # type: ignore[arg-type]  # pure method under test
    out["find_similar_events"] = [
        svc._find_similar_events(case["query"], case["events"])
        for case in cases["find_similar_events"]
    ]

    graph_out: list[Any] = []
    for case in cases["schema_graph"]:
        result = SchemaGraphResult(computed_at="t", **case)
        graph = result.to_graph()
        graph_out.append(
            {
                "nodes": [{"name": n, "kind": d.get("kind")} for n, d in graph.nodes(data=True)],
                "edges": [
                    {"source": u, "target": v, "density_local": d.get("density_local")}
                    for u, v, d in graph.edges(data=True)
                ],
                "event_to_properties": result.event_to_properties,
                "property_to_events": result.property_to_events,
                "meta": result.meta,
                "orphans": result.orphan_properties(),
            }
        )
    out["schema_graph"] = graph_out

    (HERE / "cases.json").write_text(json.dumps(cases, ensure_ascii=False), "utf-8")
    (HERE / "py-out.json").write_text(json.dumps(out, ensure_ascii=False), "utf-8")
    print(
        "wrote",
        sum(len(v) for v in cases.values()),
        "cases across",
        len(cases),
        "families",
    )


if __name__ == "__main__":
    main()
