"""CPython side of the B9-R1 PKCE differential (b9-packets.md §2.7.3).

Reads a JSON list of verifier strings on stdin; writes the JSON list of
S256 challenges (base64url, no padding) on stdout — the exact
`pkce.py:68-71` computation, one batched process (hook discipline).
"""

import base64
import hashlib
import json
import sys


def main() -> None:
    """Compute S256 challenges for every verifier on stdin."""
    verifiers = json.load(sys.stdin)
    out = [
        base64.urlsafe_b64encode(hashlib.sha256(v.encode("ascii")).digest())
        .rstrip(b"=")
        .decode("ascii")
        for v in verifiers
    ]
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
