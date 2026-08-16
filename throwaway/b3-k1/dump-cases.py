"""B3-K1 R10.9 harness, Python half.

Re-runs every probe case (probe-schema.py + probe-detail.py) and emits a
JSON-transportable oracle file: one row per case with the input encoded
for `JSON.parse` and the observed pydantic error stream as
`[type, loc]` pairs. The TS half (`replay-cases.ts`) replays it against
`bookmarks/schema{,-sorting}.ts` and diffs.

Non-JSON Python scalars are wrapped: `{"__py__": "nan"|"inf"|"-inf"}`.
Tuples serialise as arrays (pydantic treats both as sequences here).
"""

from __future__ import annotations

import json
import math
import pathlib
import sys
from typing import Any

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))


def load(stem: str) -> Any:
    """Import a hyphenated sibling probe script as a module."""
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        stem.replace("-", "_"), HERE / f"{stem}.py"
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


probe_schema = load("probe-schema")
probe_detail = load("probe-detail")


def encode(value: Any) -> Any:
    """JSON-transportable encoding of a probe input.

    Python floats become PyFloat CARRIERS (``{"__pyfloat__": repr}``),
    exactly as the Phase-2 contract codec transports them — a bare JSON
    number stands for a Python ``int``, and the int/float distinction
    changes outcomes on ``int``/``bool`` fields past the i64 window.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        return {"__pyfloat__": repr(value)}
    if isinstance(value, dict):
        return {k: encode(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [encode(v) for v in value]
    return value


def main() -> None:
    """Emit the oracle file."""
    rows = []
    for name, model, raw in [*probe_schema.CASES, *probe_detail.CASES]:
        rows.append(
            {
                "case": name,
                "model": model.__name__,
                "input": encode(raw),
                "errors": [
                    [e["type"], list(e["loc"])]
                    for e in probe_schema.errs(model, raw)
                ],
            }
        )
    out = pathlib.Path(__file__).parent / "oracle-cases.json"
    out.write_text(json.dumps(rows, ensure_ascii=False))
    print(f"wrote {len(rows)} cases to {out}")


if __name__ == "__main__":
    main()
