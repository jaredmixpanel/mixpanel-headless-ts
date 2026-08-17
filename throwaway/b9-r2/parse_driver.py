"""CPython side of the B9-R2 redirect-parse differential fuzz
(b9-packets.md §3.5.3).

Reads a JSON list of {"line": str, "expected_state": str} cases on
stdin; writes a JSON list of outcomes on stdout — one batched process
(hook discipline: never bare python). Outcome per case: {"code": c,
"state": s} on success, {"error_code": code} on OAuthError — the
compare-code-or-result rule.
"""

import json
import sys

from mixpanel_headless._internal.auth.flow import _parse_pasted_redirect
from mixpanel_headless.exceptions import OAuthError


def main() -> None:
    """Run every case through `_parse_pasted_redirect`."""
    cases = json.load(sys.stdin)
    out = []
    for case in cases:
        try:
            result = _parse_pasted_redirect(
                case["line"], expected_state=case["expected_state"]
            )
            out.append({"code": result.code, "state": result.state})
        except OAuthError as exc:
            out.append({"error_code": exc.code})
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
