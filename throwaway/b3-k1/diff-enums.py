"""Throwaway: member-for-member diff of bookmark_enums.py vs enums.ts."""

import json
import pathlib

here = pathlib.Path(__file__).parent
a = json.loads((here / "enums-py.json").read_text())
b = json.loads((here / "enums-ts.json").read_text())
print("py-only names:", sorted(set(a) - set(b)))
print("ts-only names:", sorted(set(b) - set(a)))
diff = 0
for k in sorted(set(a) & set(b)):
    if a[k] != b[k]:
        diff += 1
        print("DIFF", k)
        if isinstance(a[k], list):
            print(
                "  py-only members:",
                sorted(set(a[k]) - set(b[k])),
                " ts-only members:",
                sorted(set(b[k]) - set(a[k])),
            )
        else:
            print("  py:", a[k], "\n  ts:", b[k])
print("total diffs:", diff)
