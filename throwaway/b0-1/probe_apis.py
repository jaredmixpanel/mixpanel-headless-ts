"""B0-1 mechanical oracle probe (P3-2 step e item 3 pattern, run early).

Issues one ``oracle.call`` per newly registered ``compat.*`` api against
BOTH bridges and requires a non-"unknown api" response from each.
Protocol-1.1 ``oracle.info`` has no api list, so registration is proven
by calling.

Usage (from the Python repo root):
    uv run python \\
        /Users/jaredmcfarland/Developer/mixpanel-headless-ts/throwaway/b0-1/probe_apis.py
"""

from __future__ import annotations

import json
import subprocess
import sys

TS_ORACLE = [
    "node",
    "/Users/jaredmcfarland/Developer/mixpanel-headless-ts/scripts/run-oracle.mjs",
]
PY_ORACLE = [sys.executable, "-m", "conformance.oracle_py"]

PROBES: list[tuple[str, dict[str, object]]] = [
    ("compat.python_int", {"value": "42"}),
    ("compat.python_float", {"value": "1.5"}),
    ("compat.python_strip", {"value": " hi "}),
    ("compat.sorted_strings", {"values": ["b", "a"]}),
    ("compat.cp_length", {"value": "abc"}),
    ("compat.cp_slice", {"value": "hello", "start": 1, "end": 3}),
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
            lines.append(f"{api} -> {json.dumps(response['result'])}")
    finally:
        process.stdin.close()
        process.wait(timeout=30)
    return lines


def main() -> int:
    """Probe both bridges and print a side-by-side summary.

    Returns:
        0 when every probe answered with call DATA on both bridges.
    """
    for name, argv in (("oracle-py", PY_ORACLE), ("oracle-ts", TS_ORACLE)):
        print(f"== {name}")
        for line in probe(argv):
            print("  " + line)
    print("probe: all apis registered on both bridges")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
