"""B8-MAPFIX R10.9 harness, part 2 — CPython arbiter side.

Reads the TS generator's JSONL cases from stdin and recomputes each
answer with the REAL library functions:

- kind ``naming``: ``json.loads`` (insertion-ordered dict) →
  ``MeResponse.model_validate`` → ``default_account_name``.
- kind ``workspace``: same parse, then the ``resolve_workspace`` view
  comprehension + ``select_workspace_id`` exactly as
  ``me.py:905-915`` performs over the warm cache (the MeService/
  MeCache plumbing around it is I/O scaffolding with no effect on the
  pick; disclosed in the RUN record).

Prints each divergence and a summary line; exits non-zero on any
divergence.
"""

from __future__ import annotations

import json
import sys

from mixpanel_headless._internal.auth.naming import default_account_name
from mixpanel_headless._internal.me import (
    MeResponse,
    WorkspaceView,
    select_workspace_id,
)


def main() -> int:
    """Run the differential over stdin JSONL.

    Returns:
        Process exit code: 0 when every case agrees, 1 otherwise.
    """
    counts = {"naming": 0, "workspace": 0}
    divergences = 0
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        case = json.loads(line)
        me = MeResponse.model_validate(json.loads(case["body"]))
        if case["kind"] == "naming":
            py = default_account_name(me, set(case["existing"]))
        else:
            pid = int(case["project_id"])
            views = [
                WorkspaceView.from_me_workspace(ws)
                for ws in me.workspaces.values()
                if ws.project_id == pid
            ]
            py = select_workspace_id(views)
        counts[case["kind"]] += 1
        if py != case["ts"]:
            divergences += 1
            print(
                f"DIVERGENCE kind={case['kind']} py={py!r} "
                f"ts={case['ts']!r} body={case['body']}"
            )
    print(
        f"py-diff: naming {counts['naming']} workspace "
        f"{counts['workspace']} divergences {divergences}"
    )
    return 1 if divergences else 0


if __name__ == "__main__":
    raise SystemExit(main())
