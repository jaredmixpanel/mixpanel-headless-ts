"""B0-2 mechanical oracle probe (P3-2 step e item 3 pattern, run early).

Issues one ``oracle.call`` for the single newly registered
registry-covered api (``api_client._iter_jsonl_lines``) against BOTH
bridges and requires a non-"unknown api" response from each. The other
B0-2 names (``_handle_response`` / retry trio / ``app_request`` /
``maybe_scoped_path`` / ``_request_headers``) are wire internals with no
oracle call surface — probe-exempt per P3-2(e).3.

Usage (from the Python repo root):
    uv run python \\
        /Users/jaredmcfarland/Developer/mixpanel-headless-ts/throwaway/b0-2/probe_apis.py
"""

from __future__ import annotations

import base64
import json
import subprocess
import sys

TS_ORACLE = [
    "node",
    "/Users/jaredmcfarland/Developer/mixpanel-headless-ts/scripts/run-oracle.mjs",
]
PY_ORACLE = [sys.executable, "-m", "conformance.oracle_py"]

_CHUNK = base64.b64encode(b'{"a": 1}\n{"b": 2}').decode("ascii")

PROBES: list[tuple[str, dict[str, object]]] = [
    (
        "api_client._iter_jsonl_lines",
        {"chunks": [{"$type": "bytes", "data": _CHUNK, "encoding": "base64"}]},
    ),
]


def probe(argv: list[str]) -> list[str]:
    """Call every probe api on one bridge and return the result lines.

    Args:
        argv: The bridge command line.

    Returns:
        One ``api -> payload`` summary line per probe.

    Raises:
        RuntimeError: If a bridge answers with a JSON-RPC error (e.g.
            "unknown api") or dies.
    """
    process = subprocess.Popen(
        argv,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )
    assert process.stdin is not None and process.stdout is not None
    lines: list[str] = []
    try:
        for index, (api, kwargs) in enumerate(PROBES, start=1):
            request = {
                "jsonrpc": "2.0",
                "id": index,
                "method": "oracle.call",
                "params": {"api": api, "input": kwargs},
            }
            process.stdin.write(json.dumps(request, ensure_ascii=True) + "\n")
            process.stdin.flush()
            response = json.loads(process.stdout.readline())
            if "error" in response:
                raise RuntimeError(f"{argv[0]}: {api}: {response['error']}")
            result = response["result"]
            if result.get("ok") is not True:
                raise RuntimeError(f"{argv[0]}: {api}: not ok: {result}")
            lines.append(f"{api} -> {json.dumps(result)}")
    finally:
        process.stdin.close()
        process.wait(timeout=30)
    return lines


def main() -> int:
    """Probe both bridges and print a side-by-side summary.

    Returns:
        0 when every probe answered with call DATA on both bridges.
    """
    outputs: dict[str, list[str]] = {}
    for name, argv in (("oracle-py", PY_ORACLE), ("oracle-ts", TS_ORACLE)):
        print(f"== {name}")
        outputs[name] = probe(argv)
        for line in outputs[name]:
            print("  " + line)
    if outputs["oracle-py"] != outputs["oracle-ts"]:
        raise RuntimeError("probe outputs differ between bridges")
    print("probe: api registered on both bridges, identical outputs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
