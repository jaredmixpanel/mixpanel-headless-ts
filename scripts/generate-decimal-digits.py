"""Generate packages/core/src/compat/decimal-digits.gen.ts (R11.3).

Emits the closed-form table of Unicode decimal-digit codepoints (the
characters CPython's ``int(str)`` / ``float(str)`` accept as digits via
``_PyUnicode_TransformDecimalAndSpaceToASCII``) with their digit values,
generated from CPython itself — the reference implementation is the
oracle. Membership is probed empirically (``int(ch)`` on every single
character), NOT derived from category tables, so the table is exactly the
accept set of the pinned interpreter.

Pinning the table makes ``pythonInt``/``pythonFloat`` digit acceptance
independent of the JS engine's Unicode database version (V8 tracks a
newer Unicode than CPython 3.14's 16.0.0 — the same skew the TS-7
differential run caught for ``str.isprintable``).

Usage (any CPython matching the port's pinned target):
    uv run --no-project python scripts/generate-decimal-digits.py

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
    / "decimal-digits.gen.ts"
)


def build_runs() -> list[tuple[int, int, int]]:
    """Collect maximal runs of consecutive decimal-digit codepoints.

    A run is ``(startCp, startDigit, length)``: codepoint ``startCp + i``
    carries digit value ``startDigit + i`` for ``0 <= i < length``. Every
    Unicode 16 decimal block is a 0..9 run, but the encoding does not
    assume it — runs break wherever consecutive codepoints stop carrying
    consecutive digit values.

    Returns:
        The runs, ascending and disjoint, covering exactly the codepoints
        for which ``int(chr(cp))`` succeeds.
    """
    digits: list[tuple[int, int]] = []
    for cp in range(0x110000):
        ch = chr(cp)
        try:
            value = int(ch)
        except ValueError:
            continue
        # Cross-check the probe against the property CPython consults.
        assert unicodedata.decimal(ch) == value, hex(cp)
        digits.append((cp, value))
    runs: list[tuple[int, int, int]] = []
    for cp, value in digits:
        if runs:
            start_cp, start_digit, length = runs[-1]
            if cp == start_cp + length and value == start_digit + length:
                runs[-1] = (start_cp, start_digit, length + 1)
                continue
        runs.append((cp, value, 1))
    return runs


def main() -> int:
    """Write the generated TS module.

    Returns:
        Process exit code (0 on success).
    """
    runs = build_runs()
    total = sum(length for _, _, length in runs)
    py_version = ".".join(str(part) for part in sys.version_info[:3])
    lines = [
        "// GENERATED FILE — do not edit by hand.",
        "// Source: scripts/generate-decimal-digits.py (CPython int() is the oracle).",
        f"// Provenance: CPython {py_version}, Unicode database "
        f"{unicodedata.unidata_version}, {len(runs)} runs / {total} codepoints.",
        "//",
        "// Codepoints CPython int(str)/float(str) accept as decimal digits",
        "// (the Unicode decimal-digit property consulted by",
        "// _PyUnicode_TransformDecimalAndSpaceToASCII), with digit values.",
        "// pythonInt/pythonFloat map exactly these, independent of the JS",
        "// engine's Unicode version. Re-generate on CPython upgrade.",
        "",
        "/**",
        " * Decimal-digit runs: `[startCodepoint, startDigit, length]` — codepoint",
        " * `startCodepoint + i` carries digit value `startDigit + i`.",
        " */",
        "export const DECIMAL_DIGIT_RUNS: readonly (readonly [",
        "  number,",
        "  number,",
        "  number,",
        "])[] = [",
    ]
    lines.extend(
        f"  [0x{start:x}, {digit}, {length}]," for start, digit, length in runs
    )
    lines.append("];")
    lines.append("")
    OUT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {OUT_PATH} ({len(runs)} runs, {total} codepoints)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
