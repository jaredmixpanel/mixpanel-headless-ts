#!/usr/bin/env python3
"""Generate packages/core/src/compat/non-printable.gen.ts (R11.1).

Emits the closed-form table of codepoint ranges CPython's
``str.isprintable()`` reports as NON-printable, generated from CPython's
own ``unicodedata`` — i.e. the reference implementation itself is the
oracle. Pinning the table makes ``pythonRepr``'s escape decisions
independent of the JS engine's Unicode database version (the TS-7
differential run caught V8 Unicode 17 treating Unicode-17-assigned
codepoints as printable while CPython 3.14 / Unicode 16 escapes them).

Usage (any CPython matching the port's pinned target):
    uv run --no-project python scripts/generate-non-printable.py

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
    / "non-printable.gen.ts"
)


def build_ranges() -> list[tuple[int, int]]:
    """Collect maximal contiguous non-printable codepoint ranges.

    Returns:
        Inclusive ``(start, end)`` pairs covering exactly the codepoints
        for which ``chr(cp).isprintable()`` is False.
    """
    ranges: list[tuple[int, int]] = []
    start: int | None = None
    for cp in range(0x110000):
        if not chr(cp).isprintable():
            if start is None:
                start = cp
        elif start is not None:
            ranges.append((start, cp - 1))
            start = None
    if start is not None:
        ranges.append((start, 0x10FFFF))
    return ranges


def main() -> int:
    """Write the generated TS module.

    Returns:
        Process exit code (0 on success).
    """
    ranges = build_ranges()
    py = ".".join(str(v) for v in sys.version_info[:3])
    body_lines = [
        "// GENERATED FILE — do not edit by hand.",
        "// Source: scripts/generate-non-printable.py (CPython unicodedata is the oracle).",
        "// Regenerate with: npm run generate:compat-tables",
        f"// Provenance: CPython {py}, Unicode database {unicodedata.unidata_version}, {len(ranges)} ranges.",
        "//",
        "// The inclusive [start, end] codepoint ranges CPython str.isprintable()",
        "// reports as NON-printable (categories Cc, Cf, Cs, Co, Cn, Zl, Zp, Zs,",
        "// with U+0020 SPACE special-cased printable). pythonRepr escapes exactly",
        "// these codepoints, independent of the JS engine's Unicode version.",
        "",
        "/** Inclusive non-printable codepoint ranges, ascending and disjoint. */",
        "export const NON_PRINTABLE_RANGES: readonly (readonly [number, number])[] = [",
    ]
    for start, end in ranges:
        body_lines.append(f"  [0x{start:x}, 0x{end:x}],")
    body_lines.append("];")
    body_lines.append("")
    OUT_PATH.write_text("\n".join(body_lines), encoding="utf-8")
    print(f"wrote {OUT_PATH} ({len(ranges)} ranges)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
