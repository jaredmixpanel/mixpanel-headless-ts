"""B3-K1 R10.9 differential fuzz, Python half.

Generates near-valid / adversarially-mutated inputs for the five models
the (b′) adapter will name, records CPython pydantic's error stream, and
writes a JSON oracle for `replay-cases.ts` to diff.

Deterministic: seeded `random.Random(SEED)`.

Run: uv run python throwaway/b3-k1/fuzz-cases.py [SEED] [N]
"""

from __future__ import annotations

import json
import math
import pathlib
import random
import sys
from typing import Any

from pydantic import BaseModel
from pydantic import ValidationError as PydanticValidationError

from mixpanel_headless._internal import bookmark_schema as bs

MODELS: dict[str, type[BaseModel]] = {
    "InsightsBookmarkSortConfig": bs.InsightsBookmarkSortConfig,
    "InsightsBookmarkParams": bs.InsightsBookmarkParams,
    "FlowsBookmarkParams": bs.FlowsBookmarkParams,
    "Sections": bs.Sections,
    "DisplayOptions": bs.DisplayOptions,
}

# R10.9 mandatory edge set, plus the adversarial scalars the packet
# names for the numeric/bool/str coercion paths.
EDGE_SCALARS: list[Any] = [
    18.0,
    1.5,
    True,
    False,
    None,
    [],
    {},
    "",
    "\U0001d4b3",
    0,
    1,
    2,
    -1,
    "5",
    " 5 ",
    "﻿5",
    "\xa05",
    "٥",
    "1_0",
    "1__0",
    "0x5",
    "1e3",
    "inf",
    "nan",
    "true",
    "TRUE",
    " true ",
    "yes",
    "off",
    float("inf"),
    float("nan"),
    -0.0,
    1e300,
    "bar",
    "column",
    "label",
    "asc",
    "metric",
    "formula",
    "event",
    "total",
]

LEGACY_KEYS = [
    "alignment",
    "icon",
    "id",
    "isNewQBEnabled",
    "title",
    "date_range",
    "steps",
]
UNKNOWN_KEYS = ["zzz", "aaa", "b", "\U0001d4b3", "conv_first_step", "_idx"]


def valid_insights() -> dict[str, Any]:
    """Minimal valid InsightsBookmarkParams dict."""
    return {
        "displayOptions": {"chartType": "bar"},
        "sections": {
            "show": [
                {
                    "type": "metric",
                    "behavior": {"type": "event", "name": "Login"},
                    "measurement": {"math": "total"},
                }
            ],
            "time": [],
        },
    }


def valid_flows() -> dict[str, Any]:
    """Minimal valid FlowsBookmarkParams dict."""
    return {
        "steps": [{"event": "Login", "forward": 1}],
        "date_range": {"from_date": "2025-01-01"},
    }


def valid_sections() -> dict[str, Any]:
    """Minimal valid Sections dict."""
    return valid_insights()["sections"]


def valid_display() -> dict[str, Any]:
    """Minimal valid DisplayOptions dict."""
    return {"chartType": "bar", "plotStyle": "standard"}


def valid_sorting() -> dict[str, Any]:
    """Minimal valid InsightsBookmarkSortConfig dict."""
    return {"bar": {"sortBy": "column", "colSortAttrs": []}}


SEEDS = {
    "InsightsBookmarkSortConfig": valid_sorting,
    "InsightsBookmarkParams": valid_insights,
    "FlowsBookmarkParams": valid_flows,
    "Sections": valid_sections,
    "DisplayOptions": valid_display,
}

# Leaf paths worth poking, per model.
LEAF_PATHS: dict[str, list[list[Any]]] = {
    "InsightsBookmarkSortConfig": [
        ["bar", "sortBy"],
        ["bar", "colSortAttrs"],
        ["bar", "valueField"],
        ["bar"],
        ["table"],
        ["line"],
    ],
    "InsightsBookmarkParams": [
        ["name"],
        ["versions"],
        ["displayOptions", "chartType"],
        ["displayOptions", "rollingWindowSize"],
        ["displayOptions", "queryTimeSampling"],
        ["displayOptions", "annotationOptions"],
        ["displayOptions", "statSigControl"],
        ["displayOptions", "funnelStepsSelectedTableColumns"],
        ["sections", "show"],
        ["sections", "show", 0, "type"],
        ["sections", "show", 0, "behavior"],
        ["sections", "show", 0, "behavior", "type"],
        ["sections", "show", 0, "behavior", "id"],
        ["sections", "show", 0, "behavior", "customBucket"],
        ["sections", "show", 0, "behavior", "behaviors"],
        ["sections", "show", 0, "behavior", "exclusions"],
        ["sections", "show", 0, "measurement", "math"],
        ["sections", "show", 0, "measurement", "percentile"],
        ["sections", "show", 0, "measurement", "multiAttribution"],
        ["sections", "show", 0, "measurement", "rolling"],
        ["sections", "show", 0, "goals"],
        ["sections", "show", 0, "statsig"],
        ["sections", "show", 0, "srm"],
        ["sections", "show", 0, "display", "precision"],
        ["sections", "time"],
        ["sorting"],
        ["icon"],
        ["id"],
        ["isNewQBEnabled"],
    ],
    "FlowsBookmarkParams": [
        ["steps"],
        ["steps", 0, "event"],
        ["steps", 0, "forward"],
        ["steps", 0, "bool_op"],
        ["steps", 0, "property_filter_params_list"],
        ["date_range"],
        ["version"],
        ["alignment"],
        ["hidden_events"],
        ["collapse_repeated"],
        ["chartType"],
        ["conversion_window"],
    ],
    "Sections": [
        ["show"],
        ["show", 0, "type"],
        ["show", 0, "behavior", "type"],
        ["show", 0, "measurement", "math"],
        ["time"],
        ["filter"],
        ["globalDataGroupId"],
        ["metricLevelDataGroups"],
    ],
    "DisplayOptions": [
        ["chartType"],
        ["plotStyle"],
        ["rollingWindowSize"],
        ["timeUnit"],
        ["queryTimeSampling"],
        ["annotationOptions"],
        ["annotationOptions", "tagFilterIds"],
        ["statSigControl"],
        ["funnelStepsSelectedTableColumns"],
        ["axisAssignments"],
        ["theme"],
    ],
}

# Deep sub-structures worth grafting in.
GRAFTS: list[Any] = [
    {"type": "metric", "behavior": {"behaviors": [{"behaviors": [{}]}]}},
    {"formula": "A/B", "measurement": {"multiAttribution": {"type": "custom"}}},
    {"type": "metric", "goals": [{"id": "g", "label": "L", "checkpoints": [["a", 1.0]]}]},
    {"type": "metric", "statsig": {"control_key": "c", "exposures": {"a": {"b": 1}}}},
    {"type": "metric", "srm": {"expectedRatios": {"a": 0.5}}},
    {"type": "metric", "behavior": {"exclusions": [{"steps": {"from": 1}}]}},
]


def pick(rng: random.Random) -> Any:
    """Pick one edge scalar, DEEP-COPIED.

    The container literals in `EDGE_SCALARS` are shared objects; handing
    the same `[]` / `{}` out twice lets one mutation graft a structure
    into itself and the encoder then recurses forever.
    """
    value = rng.choice(EDGE_SCALARS)
    if isinstance(value, (dict, list)):
        return json.loads(json.dumps(value))
    return value


def set_path(obj: Any, path: list[Any], value: Any) -> None:
    """Set `value` at `path`, creating intermediate dicts as needed.

    Never writes an INT key into a dict: such an input is not
    JSON-transportable (``json.dumps`` stringifies it), so the two sides
    of the differential would not be seeing the same value. In-contract
    inputs always reach the validators through JSON.
    """
    cur = obj
    for key in path[:-1]:
        if isinstance(cur, dict):
            if isinstance(key, int):
                return
            if key not in cur or not isinstance(cur[key], (dict, list)):
                cur[key] = {}
            cur = cur[key]
        elif isinstance(cur, list):
            if not isinstance(key, int) or key >= len(cur):
                return
            cur = cur[key]
        else:
            return
    last = path[-1]
    if isinstance(cur, dict):
        if isinstance(last, int):
            return
        cur[last] = value
    elif isinstance(cur, list) and isinstance(last, int) and last < len(cur):
        cur[last] = value


def del_path(obj: Any, path: list[Any]) -> None:
    """Delete the key at `path` when present."""
    cur = obj
    for key in path[:-1]:
        if isinstance(cur, dict) and key in cur:
            cur = cur[key]
        elif isinstance(cur, list) and isinstance(key, int) and key < len(cur):
            cur = cur[key]
        else:
            return
    last = path[-1]
    if isinstance(cur, dict):
        cur.pop(last, None)


def mutate(rng: random.Random, model_name: str, params: Any) -> Any:
    """Apply one random mutation."""
    paths = LEAF_PATHS[model_name]
    choice = rng.randrange(8)
    if choice == 0:
        del_path(params, rng.choice(paths))
    elif choice == 1:
        set_path(params, rng.choice(paths), pick(rng))
    elif choice == 2:
        key = rng.choice(UNKNOWN_KEYS)
        if isinstance(params, dict):
            params[key] = pick(rng)
    elif choice == 3:
        key = rng.choice(LEGACY_KEYS)
        if isinstance(params, dict):
            params[key] = pick(rng)
    elif choice == 4:
        set_path(params, rng.choice(paths), [pick(rng)])
    elif choice == 5:
        set_path(params, rng.choice(paths), {"k": pick(rng)})
    elif choice == 6:
        graft = json.loads(json.dumps(rng.choice(GRAFTS)))
        if model_name in ("InsightsBookmarkParams", "Sections") and isinstance(
            params, dict
        ):
            base = (
                params.get("sections")
                if model_name == "InsightsBookmarkParams"
                else params
            )
            if isinstance(base, dict):
                base["show"] = [graft]
        else:
            set_path(params, rng.choice(paths), graft)
    else:
        return pick(rng)
    return params


def errs(model: type[BaseModel], raw: Any) -> list[list[Any]]:
    """Return `[type, loc]` pairs for pydantic's error stream."""
    try:
        model.model_validate(raw)
    except PydanticValidationError as exc:
        return [[e["type"], list(e["loc"])] for e in exc.errors()]
    return []


def encode(value: Any) -> Any:
    """JSON-transportable encoding (mirrors dump-cases.py)."""
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        return {"__pyfloat__": repr(value)}
    if isinstance(value, dict):
        return {k: encode(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [encode(v) for v in value]
    return value


def has_int_like_extra(value: Any) -> bool:
    """Detect the documented JS integer-key reordering hazard.

    JS object key iteration puts array-index-like keys first, so a
    Python dict whose UNKNOWN keys mix integer-like and non-integer-like
    spellings cannot round-trip its insertion order through
    `JSON.parse`. Such cases are excluded from the differential (they
    are recorded separately as the known divergence).
    """
    if not isinstance(value, dict):
        return False
    keys = list(value.keys())
    intlike = [k for k in keys if isinstance(k, str) and k.isdigit()]
    return len(intlike) > 0 and len(intlike) != len(keys)


def main() -> None:
    """Generate and write the fuzz oracle."""
    seed = int(sys.argv[1]) if len(sys.argv) > 1 else 20260815
    per_model = int(sys.argv[2]) if len(sys.argv) > 2 else 550
    rng = random.Random(seed)
    rows = []
    skipped = 0
    for model_name, model in MODELS.items():
        generated = 0
        while generated < per_model:
            params: Any = SEEDS[model_name]()
            for _ in range(rng.randrange(1, 4)):
                params = mutate(rng, model_name, params)
            if has_int_like_extra(params):
                skipped += 1
                continue
            generated += 1
            rows.append(
                {
                    "case": f"fuzz/{model_name}/{generated}",
                    "model": model_name,
                    "input": encode(params),
                    "errors": errs(model, params),
                }
            )
    out = pathlib.Path(__file__).parent / "fuzz-cases.json"
    out.write_text(json.dumps(rows, ensure_ascii=False))
    print(
        f"seed={seed} per_model={per_model} rows={len(rows)} "
        f"skipped(int-like-extra)={skipped} -> {out}"
    )


if __name__ == "__main__":
    main()
