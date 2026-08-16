"""Throwaway: pretty-print probe transcript cases matching a substring."""

from __future__ import annotations

import json
import pathlib
import sys

data = json.loads((pathlib.Path(__file__).parent / "probe-transcript.json").read_text())
pat = sys.argv[1] if len(sys.argv) > 1 else ""
for c in data:
    if pat in c["case"]:
        print(f"### {c['case']}  [{c['model']}]  in={c['input'][:110]}")
        if not c["errors"]:
            print("    OK (no errors)")
        for e in c["errors"]:
            print(f"    {e['type']:<28} loc={e['loc']}")
