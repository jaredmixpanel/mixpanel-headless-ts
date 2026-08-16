"""B5-S3 R10.9 differential harness — the Python (arbiter) side.

Generates a seeded case corpus of RECIPES (plain JSON both sides
interpret identically), runs it through the Python replay pure layer,
and writes ``cases.json`` + ``py-out.json``.

Run from the PYTHON repo so ``uv`` resolves the project::

    cd /Users/jaredmcfarland/Developer/mixpanel-headless && \
      uv run python \
      /Users/jaredmcfarland/Developer/mixpanel-headless-ts/throwaway/b5-s3/py-side.py

Families (the four oracle-callable builders the packet §5 R10.9 spec
names, ≥500 examples each):

- ``replay_labels.url_normalizer``    — URLs biased to query / fragment /
  uuid / id-segment shapes
- ``replay_labels.default_label_fn``
- ``replay_labels.selector_label_fn``
- ``rrweb_analyzer.analyze``          — event streams from a small grammar
  over the four IntEnums, non-BMP text nodes included

Throwaway (packet §7.5 removes ``throwaway/b5-s3/`` at the batch gate).
"""

from __future__ import annotations

import json
import random
from dataclasses import asdict
from pathlib import Path
from typing import Any

from mixpanel_headless._internal.replays.rrweb_analyzer import RrwebAnalyzer
from mixpanel_headless.replay_labels import (
    default_label_fn,
    selector_label_fn,
    url_normalizer,
)
from mixpanel_headless.types import UserAction

HERE = Path(__file__).resolve().parent
SEED = 20260816
PER_FAMILY = 520

# The mandated R10.9 edge set (rulebook R10.9) — every member appears
# verbatim in at least one drawn position below.
EDGE_SCALARS: list[Any] = [18.0, 1.5, True, None, [], "", "\U0001d4b3"]

# URL shapes the normalizer must collapse (packet §5: "URL arbitrary
# biased to query/fragment/uuid/id-segment shapes").
_SCHEMES = ["", "https://", "http://", "ftp://", "://", "https:///"]
_HOSTS = ["app.example.com", "x.test", "", "\U0001d4b3.test", "h:8080"]
_SEGMENTS = [
    "",
    "users",
    "12345",
    "0",
    "007",
    "abc12345",
    "DEADBEEF",
    "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "\U0001d4b3",
    "profile",
    "12345678",
    "deadbeef",
    "1-2-3-4-5",
    "-------",
    "v2",
    "2026",
    "a",
]
_QUERIES = ["", "?", "?ref=x", "?a=1&b=2", "?q=\U0001d4b3", "?#frag"]
_FRAGMENTS = ["", "#", "#id=1", "#\U0001d4b3"]

_ACTION_LITERALS = [
    "click",
    "input",
    "scroll",
    "navigate",
    "select",
    "console_error",
    "viewport_resize",
    "touch_start",
    "media_interaction",
]
_TARGET_DESCS = [
    "button",
    'button "Sign in"',
    "\U0001d4b3",
    "a #go type=submit",
    "element",
    "(viewport)",
]
_METADATA_KEYS = ["data-testid", "data-cy", "interaction", "\U0001d4b3", "url"]


def _rng() -> random.Random:
    """Return the seeded generator.

    Returns:
        A ``random.Random`` seeded with :data:`SEED`.
    """
    return random.Random(SEED)


def _draw_url(rng: random.Random) -> str:
    """Draw a URL biased to the shapes the normalizer must collapse.

    Args:
        rng: The seeded generator.

    Returns:
        The URL string (may be empty, scheme-only, or host-only).
    """
    roll = rng.random()
    if roll < 0.05:
        return ""
    scheme = rng.choice(_SCHEMES)
    host = rng.choice(_HOSTS) if scheme else ""
    n_segments = rng.randint(0, 5)
    path = "/".join(rng.choice(_SEGMENTS) for _ in range(n_segments))
    lead = "/" if (n_segments or not scheme) else ""
    return f"{scheme}{host}{lead}{path}{rng.choice(_QUERIES)}{rng.choice(_FRAGMENTS)}"


def _draw_metadata(rng: random.Random) -> dict[str, Any]:
    """Draw a ``UserAction.metadata`` mapping.

    Draws from the edge scalars so falsy values (``None``, ``""``, ``[]``)
    exercise the ``if candidate:`` fall-through in ``selector_label_fn``.

    Args:
        rng: The seeded generator.

    Returns:
        The metadata dict (possibly empty).
    """
    out: dict[str, Any] = {}
    for _ in range(rng.randint(0, 3)):
        key = rng.choice(_METADATA_KEYS)
        value = rng.choice([*EDGE_SCALARS, "signin-button", "checkout", 0, 1])
        out[key] = value
    return out


def _draw_action_recipe(rng: random.Random) -> dict[str, Any]:
    """Draw a ``UserAction`` recipe (constructor guards stay satisfied).

    ``timestamp`` stays positive and ``target_desc`` non-empty for the
    click/input literals, so the draw lands inside the ANNOTATION domain
    (Discrepancy #8): the label functions are the surface under test,
    not the UA1/UA2 constructor guards (those are Phase-2 vectors).

    Args:
        rng: The seeded generator.

    Returns:
        The recipe dict.
    """
    return {
        "timestamp": rng.choice([1, 1716810000000, 2**31, 999]),
        "action": rng.choice(_ACTION_LITERALS),
        "target_node_id": rng.choice([None, 0, 1, 42]),
        "target_desc": rng.choice(_TARGET_DESCS),
        "url": rng.choice([None, "", _draw_url(rng)]),
        "metadata": _draw_metadata(rng),
    }


def _build_action(recipe: dict[str, Any]) -> UserAction:
    """Materialize a ``UserAction`` from a recipe.

    Args:
        recipe: The recipe dict.

    Returns:
        The constructed action.
    """
    return UserAction(
        timestamp=recipe["timestamp"],
        action=recipe["action"],
        target_node_id=recipe["target_node_id"],
        target_desc=recipe["target_desc"],
        url=recipe["url"],
        metadata=dict(recipe["metadata"]),
    )


# ---------------------------------------------------------------------------
# rrweb event-stream grammar (the four IntEnums)
# ---------------------------------------------------------------------------

_TEXTS = ["Sign in", "", "  ", "None", "\U0001d4b3 label", "hello world", "0"]
_TAGS = ["button", "a", "input", "div", "span", "p", "", "IMG"]
_ATTR_KEYS = [
    "aria-label",
    "title",
    "alt",
    "placeholder",
    "href",
    "id",
    "type",
    "data-testid",
    "data-cy",
    "class",
]
_ATTR_VALUES = [
    "",
    "  ",
    "none",
    "None",
    "Save changes",
    "https://example.com/docs/intro",
    "https://example.com/",
    "https://example.com",
    "go",
    "email",
    "\U0001d4b3",
    "signin-button",
]
# Float and string timestamps exercise the CPython `int()` LADDER
# (packet §9 Caution #3: truncate toward zero, parse with the CPython
# grammar — never `Number()`).
_TIMESTAMPS: list[Any] = [0, 18.0, 18.9, -1.9, 1000, 2000, 2500, "3000", 1716810000000]


def _draw_node(rng: random.Random, node_id: int, depth: int) -> dict[str, Any]:
    """Draw one rrweb DOM node (element or text), possibly with children.

    Args:
        rng: The seeded generator.
        node_id: The rrweb node id to stamp.
        depth: Remaining recursion depth.

    Returns:
        The node dict.
    """
    if rng.random() < 0.25:
        return {
            "id": node_id,
            "type": 3,
            "textContent": rng.choice(_TEXTS),
        }
    attributes = {
        rng.choice(_ATTR_KEYS): rng.choice(_ATTR_VALUES)
        for _ in range(rng.randint(0, 4))
    }
    children: list[dict[str, Any]] = []
    if depth > 0:
        for k in range(rng.randint(0, 2)):
            children.append(_draw_node(rng, node_id * 10 + k + 1, depth - 1))
    return {
        "id": node_id,
        "type": 2,
        "tagName": rng.choice(_TAGS),
        "attributes": attributes,
        "childNodes": children,
    }


def _draw_event(rng: random.Random, node_ids: list[int]) -> dict[str, Any]:
    """Draw one rrweb event from the four-IntEnum grammar.

    Args:
        rng: The seeded generator.
        node_ids: Node ids already present in the stream (targets are
            drawn from these plus deliberate misses).

    Returns:
        The event dict.
    """
    ts = rng.choice(_TIMESTAMPS)
    kind = rng.choice(["meta", "full", "mutation", "mouse", "scroll", "input",
                       "selection", "plugin", "unknown"])
    target = rng.choice([*node_ids, 9999, None, 0])
    if kind == "meta":
        return {"type": 4, "data": {"href": rng.choice(["", "/x", _draw_url(rng)])},
                "timestamp": ts}
    if kind == "full":
        root = _draw_node(rng, 1, 3)
        node_ids.extend([1, 10, 11, 100, 101])
        return {"type": 2, "data": {"node": root}, "timestamp": ts}
    if kind == "mutation":
        node = _draw_node(rng, rng.randint(50, 80), 1)
        node_ids.append(int(node["id"]))
        return {
            "type": 3,
            "data": {
                "source": 0,
                "adds": [{"parentId": target, "node": node}],
                "removes": [{"id": rng.choice([*node_ids, 0, None])}],
                "texts": [{"id": target, "value": rng.choice(_TEXTS)}],
                "attributes": [
                    {"id": target,
                     "attributes": {rng.choice(_ATTR_KEYS): rng.choice(_ATTR_VALUES)}}
                ],
            },
            "timestamp": ts,
        }
    if kind == "mouse":
        return {"type": 3,
                "data": {"source": 2, "type": rng.choice([2, 3, 4, 5, 7, 99, None]),
                         "id": target},
                "timestamp": ts}
    if kind == "scroll":
        return {"type": 3, "data": {"source": 3, "id": target}, "timestamp": ts}
    if kind == "input":
        data: dict[str, Any] = {"source": 5, "id": target,
                                "text": rng.choice(["", "a", "\U0001d4b3", "abc"])}
        if rng.random() < 0.4:
            data["isChecked"] = rng.choice([True, False])
        return {"type": 3, "data": data, "timestamp": ts}
    if kind == "selection":
        ranges = [
            {"start": target, "end": target,
             "startOffset": rng.randint(0, 4), "endOffset": rng.randint(0, 12)}
            for _ in range(rng.randint(0, 2))
        ]
        return {"type": 3, "data": {"source": 14, "ranges": ranges}, "timestamp": ts}
    if kind == "plugin":
        return {
            "type": 6,
            "data": {
                "plugin": rng.choice(["rrweb/console@1", "rrweb/canvas@1", ""]),
                "payload": {
                    "level": rng.choice(["error", "warn", "log"]),
                    "payload": rng.choice(
                        [[], ['"boom"'], ['"a"', '"\U0001d4b3"'], ['""'], [18.0, None]]
                    ),
                },
            },
            "timestamp": ts,
        }
    return {"type": rng.choice([0, 1, 5, 7]), "data": {}, "timestamp": ts}


def _draw_stream(rng: random.Random) -> list[dict[str, Any]]:
    """Draw a whole rrweb event stream.

    Args:
        rng: The seeded generator.

    Returns:
        The event list (may be empty).
    """
    if rng.random() < 0.03:
        return []
    node_ids: list[int] = [1]
    return [_draw_event(rng, node_ids) for _ in range(rng.randint(1, 12))]


def _freeze_analyzer(events: list[dict[str, Any]]) -> dict[str, Any]:
    """Project an ``AnalyzerResult`` into the comparable frozen shape.

    Args:
        events: The raw rrweb event stream.

    Returns:
        ``{actions, markdown, page_visits, console_errors}``.
    """
    result = RrwebAnalyzer().analyze(events)
    return {
        "actions": [a.to_dict() for a in result.actions],
        "markdown": result.markdown_summary,
        "page_visits": [asdict(p) for p in result.pages],
        "console_errors": [asdict(e) for e in result.errors],
    }


def _run(fn: Any) -> Any:
    """Run ``fn``, capturing a raise as a comparable ``{__error__}`` dict.

    Args:
        fn: The zero-arg thunk.

    Returns:
        The value, or an error record with the class name + registry code.
    """
    try:
        return {"ok": fn()}
    except Exception as exc:  # noqa: BLE001 — the harness compares raises too
        return {
            "__error__": type(exc).__name__,
            "code": getattr(exc, "code", None),
        }


def main() -> None:
    """Generate the corpus and write ``cases.json`` + ``py-out.json``.

    Returns:
        None. Files are written next to this script.
    """
    rng = _rng()
    cases: dict[str, list[Any]] = {
        "url_normalizer": [],
        "default_label_fn": [],
        "selector_label_fn": [],
        "rrweb_analyzer.analyze": [],
    }
    out: dict[str, list[Any]] = {k: [] for k in cases}

    # Every edge scalar that is a valid `str` argument goes in verbatim
    # first, so the mandated set is provably covered.
    for edge in ["", "\U0001d4b3"]:
        cases["url_normalizer"].append(edge)
    while len(cases["url_normalizer"]) < PER_FAMILY:
        cases["url_normalizer"].append(_draw_url(rng))
    for url in cases["url_normalizer"]:
        out["url_normalizer"].append(_run(lambda u=url: url_normalizer(u)))

    while len(cases["default_label_fn"]) < PER_FAMILY:
        cases["default_label_fn"].append(_draw_action_recipe(rng))
    for recipe in cases["default_label_fn"]:
        out["default_label_fn"].append(
            _run(lambda r=recipe: default_label_fn(_build_action(r)))
        )

    while len(cases["selector_label_fn"]) < PER_FAMILY:
        cases["selector_label_fn"].append(
            {
                "attr": rng.choice(_METADATA_KEYS + ["missing", ""]),
                "action": _draw_action_recipe(rng),
            }
        )
    for recipe in cases["selector_label_fn"]:
        out["selector_label_fn"].append(
            _run(
                lambda r=recipe: selector_label_fn(r["attr"])(
                    _build_action(r["action"])
                )
            )
        )

    while len(cases["rrweb_analyzer.analyze"]) < PER_FAMILY:
        cases["rrweb_analyzer.analyze"].append(_draw_stream(rng))
    for events in cases["rrweb_analyzer.analyze"]:
        out["rrweb_analyzer.analyze"].append(_run(lambda e=events: _freeze_analyzer(e)))

    (HERE / "cases.json").write_text(json.dumps(cases, indent=1))
    (HERE / "py-out.json").write_text(json.dumps(out, indent=1))
    for family, values in out.items():
        raised = sum(1 for v in values if "__error__" in v)
        print(f"{family:<26} {len(values):>5} cases  {raised:>4} raised")


if __name__ == "__main__":
    main()
