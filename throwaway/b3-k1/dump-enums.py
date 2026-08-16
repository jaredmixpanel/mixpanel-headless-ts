"""Dump every frozenset/dict/scalar constant of bookmark_enums.py as JSON."""
import json
from mixpanel_headless._internal import bookmark_enums as be

out = {}
for name in dir(be):
    if name.startswith("__"):
        continue
    v = getattr(be, name)
    if isinstance(v, frozenset):
        out[name] = sorted(v)
    elif isinstance(v, dict):
        out[name] = {k: v[k] for k in sorted(v)}
    elif isinstance(v, int) and not isinstance(v, bool):
        out[name] = v
print(json.dumps(out, sort_keys=True, indent=1, ensure_ascii=False))
