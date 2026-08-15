"""Generate packages/core/src/compat/whitespace.gen.ts (R11.3 / pythonStrip).

Emits two pinned codepoint tables, generated from CPython itself (the
reference implementation is the oracle):

1. ``PYTHON_STR_WHITESPACE`` — the ``str.isspace()`` sweep: exactly what
   ``str.strip()`` (→ ``pythonStrip``) strips.
2. ``PYTHON_NUMERIC_WHITESPACE`` — the whitespace ``int(str)``/``float(str)``
   tolerate, probed empirically per codepoint (``int(ch + "7" + ch)``).
   This is NOT the same set: CPython's numeric parse strips the C-level
   ``Py_ISSPACE`` set for ASCII (which excludes the ``str.isspace()``-true
   file/group/record/unit separators U+001C..U+001F) plus every non-ASCII
   ``isspace`` codepoint (mapped to a space by
   ``_PyUnicode_TransformDecimalAndSpaceToASCII``).

Pinning both keeps ``pythonStrip``/``pythonInt``/``pythonFloat`` whitespace
decisions independent of the JS engine's Unicode database version.

Usage (any CPython matching the port's pinned target):
    uv run --no-project python scripts/generate-whitespace.py

Re-run + commit when the port's target CPython (and thus its Unicode
database) is upgraded; the provenance header records both versions.
"""

from __future__ import annotations

import sys
import unicodedata
from pathlib import Path

OUT_PATH = (
    Path(__file__).resolve().parents[1]
    / "packages"
    / "core"
    / "src"
    / "compat"
    / "whitespace.gen.ts"
)


def build_tables() -> tuple[list[int], list[int]]:
    """Sweep the codepoint space for both whitespace sets.

    Returns:
        ``(str_whitespace, numeric_whitespace)`` codepoint lists, each
        ascending.
    """
    str_ws: list[int] = []
    numeric_ws: list[int] = []
    for cp in range(0x110000):
        ch = chr(cp)
        if ch.isspace():
            str_ws.append(cp)
        # Skip decimal digits and sign chars: the probe below would parse
        # for the wrong reason. (No isspace codepoint is a digit or sign.)
        try:
            int(ch)
            continue
        except ValueError:
            pass
        if ch in "+-":
            continue
        try:
            int(ch + "7" + ch)
        except ValueError:
            continue
        numeric_ws.append(cp)
    return str_ws, numeric_ws


def main() -> int:
    """Write the generated TS module.

    Returns:
        Process exit code (0 on success).
    """
    str_ws, numeric_ws = build_tables()
    # Sanity locks (CPython 3.14.6 / Unicode 16 facts the port relies on):
    assert set(numeric_ws) == set(str_ws) - {0x1C, 0x1D, 0x1E, 0x1F}
    assert 0xFEFF not in str_ws  # BOM: JS-trim-only, never Python whitespace
    py_version = ".".join(str(part) for part in sys.version_info[:3])
    lines = [
        "// GENERATED FILE — do not edit by hand.",
        "// Source: scripts/generate-whitespace.py (CPython is the oracle).",
        f"// Provenance: CPython {py_version}, Unicode database "
        f"{unicodedata.unidata_version}, "
        f"{len(str_ws)} str / {len(numeric_ws)} numeric codepoints.",
        "//",
        "// Two pinned whitespace sets (NOT equal, and neither equals the JS",
        "// String.prototype.trim() set — Python strips U+001C..U+001F which",
        "// JS keeps; JS trims U+FEFF which Python keeps):",
        "// - PYTHON_STR_WHITESPACE: str.isspace() == str.strip() strip set.",
        "// - PYTHON_NUMERIC_WHITESPACE: int()/float() surround tolerance",
        "//   (the str set minus U+001C..U+001F).",
        "// Re-generate on CPython upgrade.",
        "",
        "/** Codepoints `str.isspace()` reports true for (the `str.strip()` set). */",
        "export const PYTHON_STR_WHITESPACE: ReadonlySet<number> = new Set([",
        *(f"  0x{cp:x}," for cp in str_ws),
        "]);",
        "",
        "/** Codepoints `int(str)`/`float(str)` tolerate around the number. */",
        "export const PYTHON_NUMERIC_WHITESPACE: ReadonlySet<number> = new Set([",
        *(f"  0x{cp:x}," for cp in numeric_ws),
        "]);",
        "",
    ]
    OUT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(
        f"wrote {OUT_PATH} ({len(str_ws)} str, {len(numeric_ws)} numeric codepoints)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
