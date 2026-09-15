// GENERATED FILE — do not edit by hand.
// Source: scripts/generate-whitespace.py (CPython is the oracle).
// Regenerate with: npm run generate:compat-tables
// Provenance: CPython 3.14.6, Unicode database 16.0.0, 29 str / 25 numeric codepoints.
// Generator sha256: de308bf77357d6667efbf3cc3094dec0d3b4327c0431dd86d860b6f7c5097a7e (scripts/generate-whitespace.py).
//
// Two pinned whitespace sets (NOT equal, and neither equals the JS
// String.prototype.trim() set — Python strips U+001C..U+001F which
// JS keeps; JS trims U+FEFF which Python keeps):
// - PYTHON_STR_WHITESPACE: str.isspace() == str.strip() strip set.
// - PYTHON_NUMERIC_WHITESPACE: int()/float() surround tolerance
//   (the str set minus U+001C..U+001F).
// Re-generate on CPython upgrade.

/** Codepoints `str.isspace()` reports true for (the `str.strip()` set). */
export const PYTHON_STR_WHITESPACE: ReadonlySet<number> = new Set([
  0x9,
  0xa,
  0xb,
  0xc,
  0xd,
  0x1c,
  0x1d,
  0x1e,
  0x1f,
  0x20,
  0x85,
  0xa0,
  0x1680,
  0x2000,
  0x2001,
  0x2002,
  0x2003,
  0x2004,
  0x2005,
  0x2006,
  0x2007,
  0x2008,
  0x2009,
  0x200a,
  0x2028,
  0x2029,
  0x202f,
  0x205f,
  0x3000,
]);

/** Codepoints `int(str)`/`float(str)` tolerate around the number. */
export const PYTHON_NUMERIC_WHITESPACE: ReadonlySet<number> = new Set([
  0x9,
  0xa,
  0xb,
  0xc,
  0xd,
  0x20,
  0x85,
  0xa0,
  0x1680,
  0x2000,
  0x2001,
  0x2002,
  0x2003,
  0x2004,
  0x2005,
  0x2006,
  0x2007,
  0x2008,
  0x2009,
  0x200a,
  0x2028,
  0x2029,
  0x202f,
  0x205f,
  0x3000,
]);
