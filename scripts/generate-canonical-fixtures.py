"""Generate packages/core/test/compat/fixtures/canonical-fixtures.json.

CPython itself is the oracle for the heads-platform **canonical form**
(`mixpanel-desktop-app/docs/specs/heads/02-queryref-and-two-body-identity.md`
sections 3.1, 3.3 and 6.1): the canonical string of a bookmark ``params``
object is

    json.dumps(params, sort_keys=True, separators=(",", ":"))

byte for byte, and the QueryRef hash is the sha256 of its UTF-8 bytes.
``packages/core/src/compat/python-json-dumps-canonical.ts`` is the
TypeScript twin; this script emits the table the twin is diffed against so
the parity claim never rests on a human transcribing escapes.

Two input sets are emitted:

* **hand** — authored below, covering the cases a corpus sample will not
  reliably contain: astral-plane keys whose code-point order differs from
  UTF-16 code-unit order, C0 control characters, the seven short escapes,
  the float/int split, deep nesting and empty containers.
* **corpus** — a deterministic sample of ``kind == "builder"`` vector
  outputs from ``conformance-runner/corpus/**/*.jsonl`` (read-only; the
  corpus is a committed snapshot and is never hand-edited). These are real
  ``build_*_params`` results, so the fixture table exercises the shapes the
  two-body identity actually hashes.

The **numeric normalization rule** (canonical form, both bodies): any
number whose value is integral renders as an integer — ``2.0`` -> ``2``,
``1000000000000000.0`` -> ``1000000000000000``, ``-0.0`` -> ``0``. Python
needs a pre-pass (``normalize_numbers`` below, ``float.is_integer()`` ->
``int``); JavaScript gets it free, having one number type. The rule closes
a **reachable** divergence, not a theoretical one: Python
``bookmark_builders.py:514`` emits ``"filterValue"`` verbatim and
``GroupBy.bucket_size`` accepts a float, so ``Filter.greater_than("age",
1e15)`` puts a genuine float in params. ``REQUIRED_CORPUS_VECTORS`` pins
the corpus vector that does exactly that, so the case can never fall out
of the sample again.

Two refusals, both deliberate and both hard errors — including for corpus
input, because a skip is how the previous version of this file hid a live
divergence:

1. ``default=str`` must never fire. The TS twin throws for an
   unserializable value rather than guessing a rendering, so a fixture that
   needed the ``default`` hook would be asserting a divergence. The
   ``_never_default`` hook below raises if CPython ever reaches for it.
2. No number may exceed ``Number.MAX_SAFE_INTEGER`` in magnitude, and none
   may be non-finite. Past 2**53 a JS number no longer names one integer
   and ``String()`` flips to exponent form; ``NaN``/``inf`` have no JSON
   spelling that round-trips. No real params carry either (verified: zero
   such values across all builder vectors at corpus pin c9991d1), so if a
   re-pin introduces one we want a **red build**, not a quiet skip.

``$type`` carrier objects are the one thing still skipped: they are the
corpus's own encoding for non-JSON Python values (datetime, bytes,
callables), so they are not params data at all. The skip is counted and
printed.

Usage (any CPython 3.11+):

    python3 scripts/generate-canonical-fixtures.py
    npm run fmt

**The `npm run fmt` step is required**, not optional: Prettier owns
formatting for every file in this repo including the emitted JSON, and it
reflows the arrays and rewrites number literals in the ``params`` field
(``1e-07`` -> ``1e-7``). Both spellings parse to the same double, so the
fixtures are unaffected — but skipping the step leaves ``npm run check``
red on ``prettier --check``. The ``canonical`` field is a JSON *string*
and is never touched.

Re-run + commit whenever the hand table changes or the corpus pin in
``conformance-runner/corpus.config.json`` moves.
"""

from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
CORPUS_DIR = REPO_ROOT / "conformance-runner" / "corpus"
CORPUS_CONFIG = REPO_ROOT / "conformance-runner" / "corpus.config.json"
OUT_PATH = (
    REPO_ROOT
    / "packages"
    / "core"
    / "test"
    / "compat"
    / "fixtures"
    / "canonical-fixtures.json"
)

#: Take every Nth eligible corpus vector (sorted by id) so the sample is
#: stable across runs and small enough to read in a diff.
CORPUS_STRIDE = 24
MAX_SAFE_INTEGER = 2**53 - 1

#: Corpus vectors that must be in the sample no matter where the stride
#: lands. Named individually because each one pins a specific hazard, and
#: stride sampling is exactly how the first version of this file lost the
#: integral-float case.
REQUIRED_CORPUS_VECTORS: tuple[str, ...] = (
    # `Filter.greater_than("age", 1e15)` -> "filterValue": 1000000000000000.0,
    # a real build_params payload carrying an integral FLOAT. Without the
    # normalization rule CPython spells it "1e+15" and TypeScript "1e+15"
    # only by luck of magnitude; with it, both spell the digits.
    "bookmarks/workspace.build_params/"
    "test_validation_bypass_r2-testr2v4inffilterfixed-"
    "test_large_finite_value_passes",
)


class UnsafeNumber(Exception):
    """A number with no stable cross-language canonical spelling."""


class CarrierValue(Exception):
    """A corpus ``$type`` carrier — not plain JSON params data."""


def _never_default(value: object) -> object:
    """``json.dumps(default=...)`` hook that must never be called.

    Args:
        value: The value CPython could not serialize.

    Raises:
        AssertionError: Always — reaching the ``default`` branch means the
            fixture would encode a spelling the TS twin refuses to produce.
    """
    raise AssertionError(
        f"default=str branch reached for {type(value).__name__} ({value!r}); "
        "the TypeScript twin throws here, so this input cannot be a fixture"
    )


def normalize_numbers(value: Any, path: str = "$") -> Any:
    """Apply the canonical numeric normalization rule to a whole value.

    Integral numbers become Python ``int`` so ``json.dumps`` spells them
    as bare digit runs — the same bytes JavaScript produces natively for
    the same value. Non-integral floats are returned untouched and keep
    CPython ``repr``.

    Args:
        value: The (sub)value to normalize.
        path: Dotted path used in error messages.

    Returns:
        The value with every integral number replaced by an ``int``.

    Raises:
        UnsafeNumber: For non-finite numbers and magnitudes past
            ``Number.MAX_SAFE_INTEGER``.
        CarrierValue: For a corpus ``$type`` carrier object.
        TypeError: For anything that is not JSON data (which would send
            ``json.dumps`` down the forbidden ``default`` branch).
    """
    # bool is an int subclass — test it first or True becomes 1.
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, (int, float)):
        if isinstance(value, float) and not math.isfinite(value):
            raise UnsafeNumber(
                f"{path}: non-finite number {value!r} has no canonical JSON "
                "spelling that round-trips"
            )
        if abs(value) > MAX_SAFE_INTEGER:
            raise UnsafeNumber(
                f"{path}: {value!r} exceeds Number.MAX_SAFE_INTEGER "
                f"({MAX_SAFE_INTEGER}); past 2**53 a JS number no longer names "
                "one integer, so there is no shared canonical spelling"
            )
        if isinstance(value, float) and value.is_integer():
            # THE rule. int(-0.0) is 0, which is what JS String(-0) gives.
            return int(value)
        return value
    if isinstance(value, list):
        return [normalize_numbers(item, f"{path}[{i}]") for i, item in enumerate(value)]
    if isinstance(value, dict):
        if "$type" in value:
            raise CarrierValue(
                f"{path}: corpus $type carrier ({value.get('$type')!r}) "
                "is not plain JSON params data"
            )
        out: dict[str, Any] = {}
        for key, member in value.items():
            if not isinstance(key, str):
                raise TypeError(f"{path}: non-str key {key!r}")
            out[key] = normalize_numbers(member, f"{path}.{key}")
        return out
    raise TypeError(f"{path}: {type(value).__name__} is not JSON data")


def canonical(params: Any) -> str:
    """Spell one value in the canonical form (spec section 3.1).

    Args:
        params: The value to canonicalize.

    Returns:
        ``json.dumps(params, sort_keys=True, separators=(",", ":"))``.
    """
    return json.dumps(
        params, sort_keys=True, separators=(",", ":"), default=_never_default
    )


def hand_authored() -> list[tuple[str, Any]]:
    """The authored input set.

    Returns:
        ``(name, params)`` pairs, ordered as they appear in the output.
    """
    return [
        ("empty-object", {}),
        ("empty-containers", {"a": [], "o": {}, "s": ""}),
        (
            "nested-objects-and-arrays",
            {
                "b": {"z": 1, "a": [1, 2, {"k": None, "j": [[], [{}]]}]},
                "a": True,
                "c": [{"n": 1}, {"n": 2}],
            },
        ),
        (
            "numbers-int-vs-float",
            {
                "int_one": 1,
                "int_zero": 0,
                "int_neg": -42,
                "int_large_safe": MAX_SAFE_INTEGER,
                "int_large_safe_neg": -MAX_SAFE_INTEGER,
                "float_half": 1.5,
                "float_tiny": 1e-7,
                "float_tinier": 2.5e-10,
                # Every float >= 2**53 is integral AND out of safe range,
                # so the high-exponent repr branch cannot appear at all;
                # the low-exponent branch is float_tiny/float_tinier.
                "float_exact_binary": 123456789.0625,
                "float_near_int": 0.9999999999999999,
                "float_third": 1 / 3,
                "float_neg": -0.125,
            },
        ),
        (
            # The normalization rule, isolated. Each value on the left is a
            # Python FLOAT; each must canonicalize to the integer spelling,
            # which is what the TypeScript twin produces natively for the
            # same JS number. This row is the fixture the cross-body test
            # in python-json-dumps-canonical.test.ts compares against.
            "integral-floats-normalize-to-ints",
            {
                "two": 2.0,
                "neg_zero": -0.0,
                "pos_zero": 0.0,
                "e15": 1e15,
                "neg_two": -2.0,
                "max_safe_as_float": float(MAX_SAFE_INTEGER - 1),
            },
        ),
        (
            # ...and the other side of the rule: non-integral floats are
            # untouched and keep CPython repr.
            "non-integral-floats-keep-repr",
            {"tiny": 1e-7, "half": 2.5, "third": 1 / 3, "neg": -0.125},
        ),
        (
            # The reachable divergence in its natural habitat: a filter
            # value that build_params emits verbatim (bookmark_builders.py
            # :514). Mirrors the pinned corpus vector below.
            "filter-value-integral-float",
            {
                "sections": {
                    "filter": {
                        "clauses": [
                            {
                                "filterOperator": "greater",
                                "filterValue": 1e15,
                                "resourceType": "events",
                            }
                        ],
                        "determiner": "all",
                    }
                }
            },
        ),
        ("booleans-and-null", {"t": True, "f": False, "n": None}),
        (
            "non-ascii-bmp",
            {
                "café": "résumé",
                "こんにちは": "世界",
                "ЀЁ": "אב",
            },
        ),
        (
            "astral-values",
            {"emoji": "\U0001f600\U0001f1fa\U0001f1f8", "math": "\U0001d4b3"},
        ),
        (
            # THE ordering case: sorted() by code point puts U+FF5E before
            # U+1F600; a naive JS `.sort()` (UTF-16 code units) inverts them,
            # because U+1F600's high surrogate is 0xD83D < 0xFF5E.
            "key-order-codepoint-vs-utf16",
            {
                "～": "fullwidth tilde U+FF5E",
                "\U0001f600": "grinning face U+1F600",
                "｡": "halfwidth ideographic full stop U+FF61",
                "\U0001d4b3": "script capital X U+1D4B3",
                "퟿": "last BMP char below the surrogate block",
                "": "first private-use char above it",
                "Z": "ascii upper",
                "a": "ascii lower",
                "": "empty key sorts first",
            },
        ),
        (
            "control-characters-and-short-escapes",
            {
                "short": "\b\t\n\f\r\"\\",
                "c0": "\x00\x01\x02\x1e\x1f",
                "del-and-c1": "\x7f\x80\x9f",
                # chr() rather than a literal: U+2028/U+2029 ARE line
                # separators to some tooling, and a source file that
                # renormalized them would silently change the fixture.
                "line-separators": chr(0x2028) + chr(0x2029),
            },
        ),
        (
            # Same object written two ways in the source: an escaped literal
            # and a raw one. Identical Python strings => identical canonical
            # bytes and hash; the pair proves the fixture pipeline is not
            # smuggling source spelling into the identity.
            "unicode-escaped-source",
            {"k": "café", "astral": "\U0001f600"},
        ),
        ("unicode-raw-source", {"k": "café", "astral": "😀"}),
        (
            # Shapes lifted from real bookmark params (spec section 3.1's
            # payload) without depending on a corpus pin.
            "bookmark-shaped",
            {
                "sections": {
                    "show": [
                        {
                            "dataset": "$mixpanel",
                            "value": {"name": "Purchase", "resourceType": "events"},
                            "resourceType": "events",
                            "profileType": None,
                            "search": "",
                            "math": "total",
                            "property": None,
                            "type": "metric",
                        }
                    ],
                    "time": [{"unit": "day", "value": 30, "type": "unit"}],
                    "filter": {"clauses": [], "determiner": "all"},
                    "group": [],
                    "formula": [],
                },
                "displayOptions": {
                    "chartType": "line",
                    "plotStyle": "standard",
                    "analysis": "linear",
                    "value": "absolute",
                },
            },
        ),
        (
            "slot-markers-templated-params",
            # Spec section 7.5: `$`-prefixed marker keys sort first under
            # code-point order, which is what makes templateHash stable.
            {
                "event": {"$slot": "checkout_event"},
                "property": {"$slot": "platform_property", "$as": "event_property"},
                "zz": 1,
            },
        ),
        ("top-level-array", [1, "two", None, True, {"k": [1.5]}]),
        ("top-level-scalar-string", "just a string with é and \U0001f600"),
        ("top-level-scalar-int", 12345),
    ]


def corpus_sample() -> list[tuple[str, Any]]:
    """A deterministic sample of builder-vector outputs from the corpus.

    Every ``REQUIRED_CORPUS_VECTORS`` entry is included regardless of where
    the stride lands, and a missing one is a hard error — the point of
    naming them is that they cannot drift out of the sample.

    Returns:
        ``(name, params)`` pairs, ``name`` being the corpus vector id and
        ``params`` the RAW output (normalization happens once, in `emit`).

    Raises:
        UnsafeNumber: If any builder output carries a non-finite or
            out-of-safe-range number (none do at the current pin; a re-pin
            that introduces one must break the build, not be skipped).
        AssertionError: If a required vector is absent from the corpus.
    """
    eligible: list[tuple[str, Any]] = []
    carriers = 0
    for path in sorted(CORPUS_DIR.rglob("*.jsonl")):
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                vector = json.loads(line)
                if vector.get("kind") != "builder":
                    continue
                output = vector.get("expect", {}).get("output")
                vector_id = vector.get("id")
                if not isinstance(output, dict) or not isinstance(vector_id, str):
                    continue
                try:
                    # Validation only — the RAW output is what gets stored,
                    # so `emit` can tell whether normalization changed it.
                    normalize_numbers(output, "$")
                except CarrierValue:
                    # Not params data — the corpus's encoding for a Python
                    # value JSON has no spelling for. Skipped, counted.
                    carriers += 1
                    continue
                except UnsafeNumber as exc:
                    raise UnsafeNumber(f"{vector_id}: {exc}") from exc
                eligible.append((vector_id, output))

    eligible.sort(key=lambda pair: pair[0])
    by_id = dict(eligible)
    sampled = dict(eligible[::CORPUS_STRIDE])

    for required in REQUIRED_CORPUS_VECTORS:
        if required not in by_id:
            raise AssertionError(
                f"required corpus vector missing at this pin: {required}"
            )
        sampled[required] = by_id[required]

    ordered = sorted(sampled.items(), key=lambda pair: pair[0])
    print(
        f"corpus: {len(eligible)} eligible builder outputs "
        f"({carriers} skipped as $type carriers), "
        f"sampled {len(ordered)} at stride {CORPUS_STRIDE} "
        f"(+{len(REQUIRED_CORPUS_VECTORS)} pinned)"
    )
    return ordered


def main() -> int:
    """Write the fixture table.

    Returns:
        Process exit code (0 on success).
    """
    fixtures: list[dict[str, Any]] = []

    def emit(name: str, source: str, raw: Any) -> None:
        """Normalize one input and append its fixture row.

        Args:
            name: Fixture id.
            source: ``"hand"`` or ``"corpus"``.
            raw: The pre-normalization value.
        """
        params = normalize_numbers(raw, "$")
        text = canonical(params)
        fixtures.append(
            {
                "name": name,
                "source": source,
                # True when the numeric normalization rule actually changed
                # the bytes — i.e. this row is a regression fixture for it.
                "normalized": canonical(raw) != text,
                "params": params,
                "canonical": text,
                "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            }
        )

    # Hand inputs are a hard error, never a skip: an unsafe one is an
    # authoring mistake, and dropping it would hollow out the table.
    for name, raw in hand_authored():
        emit(name, "hand", raw)
    for vector_id, params in corpus_sample():
        emit(vector_id, "corpus", params)

    names = [f["name"] for f in fixtures]
    if len(set(names)) != len(names):
        raise AssertionError("duplicate fixture names")

    pin = json.loads(CORPUS_CONFIG.read_text(encoding="utf-8"))["sourceCommit"]
    py = ".".join(str(v) for v in sys.version_info[:3])
    document = {
        "$comment": [
            "GENERATED FILE - do not hand-edit.",
            "Source: scripts/generate-canonical-fixtures.py (CPython is the oracle).",
            "Reproduce with:  python3 scripts/generate-canonical-fixtures.py "
            "&& npm run fmt",
            "The `npm run fmt` step is REQUIRED - Prettier owns formatting for",
            "this file and rewrites number literals in `params` (1e-07 -> 1e-7);",
            "both parse to the same double, and the `canonical` field is a",
            "string Prettier never touches. Skipping it leaves the gate red.",
            "",
            "Each row: `canonical` is CPython json.dumps(params, sort_keys=True,",
            "separators=(',', ':')) byte for byte and `sha256` is the sha256 of",
            "its UTF-8 bytes - the heads-platform QueryRef hash (spec 02 3.1).",
            "`normalized: true` means the numeric normalization rule (integral",
            "number -> integer spelling) changed the bytes for this row.",
            f"Provenance: CPython {py}, corpus pin {pin}, {len(fixtures)} fixtures.",
        ],
        "fixtures": fixtures,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    # ensure_ascii keeps the committed file pure ASCII, so no editor or
    # transport can renormalize an astral character out from under the test.
    OUT_PATH.write_text(
        json.dumps(document, indent=2, ensure_ascii=True, sort_keys=False) + "\n",
        encoding="utf-8",
    )
    changed = sum(1 for f in fixtures if f["normalized"])
    print(
        f"wrote {OUT_PATH.relative_to(REPO_ROOT)}: {len(fixtures)} fixtures "
        f"({changed} exercise the normalization rule) "
        f"(CPython {py}, corpus pin {pin})"
    )
    print("NEXT: run `npm run fmt` — Prettier owns this file's formatting.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
