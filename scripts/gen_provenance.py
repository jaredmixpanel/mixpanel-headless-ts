"""Shared provenance guard for the CPython-oracle generators in scripts/.

The four ``generate-*.py`` scripts emit tables whose bytes depend on the
interpreter that ran them (its Unicode database, its ``json.dumps``). Two
things keep that reproducible:

* :func:`require_pinned_interpreter` refuses to run on anything but the
  CPython / Unicode pair in ``compat-python.pin.json`` — the npm scripts
  select that interpreter through ``uv run --python``.
* :func:`generator_sha256` is embedded in every header, so
  ``tests/generated-tables-provenance.test.ts`` can tell a generator that
  was edited without re-emitting its output.
"""

from __future__ import annotations

import hashlib
import json
import sys
import unicodedata
from pathlib import Path

PIN_PATH = Path(__file__).resolve().parent / "compat-python.pin.json"


def require_pinned_interpreter() -> dict[str, str]:
    """Exit unless the running CPython and its Unicode database match the pin.

    Returns:
        The pin (``{"cpython": ..., "unicode": ...}``) for header text.
    """
    pin: dict[str, str] = json.loads(PIN_PATH.read_text(encoding="utf-8"))
    running = ".".join(str(part) for part in sys.version_info[:3])
    unicode_version = unicodedata.unidata_version
    if running != pin["cpython"] or unicode_version != pin["unicode"]:
        raise SystemExit(
            f"refusing to generate: running CPython {running} / Unicode "
            f"{unicode_version}, but {PIN_PATH.name} pins CPython "
            f"{pin['cpython']} / Unicode {pin['unicode']}. Use the npm script "
            "(`uv run --python <pin>` selects the pinned interpreter)."
        )
    return pin


def generator_sha256(generator: str | Path) -> str:
    """Hex sha256 of the generator script's own bytes (``__file__``).

    Args:
        generator: The calling script's ``__file__``.

    Returns:
        Lower-case hex digest, as embedded in the output header.
    """
    return hashlib.sha256(Path(generator).read_bytes()).hexdigest()
