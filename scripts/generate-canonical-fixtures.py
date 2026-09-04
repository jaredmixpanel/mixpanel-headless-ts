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

Two refusals, both deliberate and both hard errors for hand inputs:

1. ``default=str`` must never fire. The TS twin throws for an
   unserializable value rather than guessing a rendering, so a fixture that
   needed the ``default`` hook would be asserting a divergence. The
   ``_never_default`` hook below raises if CPython ever reaches for it.
2. The input must be **JS-representable**. JavaScript has one number type:
   an integral Python float (``1.0``, ``-0.0``) and an integer wider than
   ``Number.MAX_SAFE_INTEGER`` both lose the distinction CPython spells
   (``"1.0"`` vs ``"1"``; the digits vs ``"1e+22"``). Bookmark params carry
   neither — spec section 3.1 rule 4 — so rather than paper over it with a
   carrier format the generator refuses such inputs. Corpus vectors that
   trip this (or that carry a ``$type`` carrier object, which is the
   corpus's own encoding for non-JSON Python values) are skipped and
   counted, so a corpus re-pin cannot silently break the build.

Usage (any CPython 3.11+):
    python3 scripts/generate-canonical-fixtures.py

Re-run + commit whenever the hand table changes or the corpus pin in
``conformance-runner/corpus.config.json`` moves.
"""

from __future__ import annotations

import hashlib
import json
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


class NotRepresentable(Exception):
    """An input JavaScript cannot hold without losing the distinction."""


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


def assert_js_representable(value: Any, path: str = "$") -> None:
    """Refuse inputs whose CPython spelling JavaScript cannot reproduce.

    Args:
        value: The (sub)value to check.
        path: Dotted path used in the error message.

    Raises:
        NotRepresentable: For integral/non-finite floats, out-of-range
            integers, ``$type`` carrier objects, and non-JSON values.
    """
    if value is None or isinstance(value, (str, bool)):
        return
    if isinstance(value, int):
        if abs(value) > MAX_SAFE_INTEGER:
            raise NotRepresentable(
                f"{path}: int {value} exceeds Number.MAX_SAFE_INTEGER; JSON.parse "
                "would round it (pass a bigint in TypeScript instead)"
            )
        return
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise NotRepresentable(
                f"{path}: non-finite float {value!r} cannot live in a JSON fixture "
                "file (covered by the hand-written oracle table instead)"
            )
        if value.is_integer():
            raise NotRepresentable(
                f"{path}: integral float {value!r} spells {value!r} in CPython but "
                '"' + repr(int(value)) + '" in JavaScript, which has one number type'
            )
        return
    if isinstance(value, list):
        for i, item in enumerate(value):
            assert_js_representable(item, f"{path}[{i}]")
        return
    if isinstance(value, dict):
        if "$type" in value:
            raise NotRepresentable(
                f"{path}: corpus $type carrier ({value.get('$type')!r}) is not plain JSON"
            )
        for key, member in value.items():
            if not isinstance(key, str):
                raise NotRepresentable(f"{path}: non-str key {key!r}")
            assert_js_representable(member, f"{path}.{key}")
        return
    raise NotRepresentable(f"{path}: {type(value).__name__} is not JSON data")


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
                # Every float >= 2**53 is integral, so the high-exponent
                # repr branch cannot appear in a JSON fixture at all (see
                # the module docstring's representability refusal); the
                # low-exponent branch is covered by float_tiny/float_tinier.
                "float_exact_binary": 123456789.0625,
                "float_near_int": 0.9999999999999999,
                "float_third": 1 / 3,
                "float_neg": -0.125,
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

    Returns:
        ``(name, params)`` pairs; ``name`` is the corpus vector id.
    """
    eligible: list[tuple[str, Any]] = []
    skipped = 0
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
                    assert_js_representable(output, "$")
                except NotRepresentable:
                    skipped += 1
                    continue
                eligible.append((vector_id, output))
    eligible.sort(key=lambda pair: pair[0])
    sampled = eligible[::CORPUS_STRIDE]
    print(
        f"corpus: {len(eligible)} eligible builder outputs "
        f"({skipped} skipped as not JS-representable), "
        f"sampled {len(sampled)} at stride {CORPUS_STRIDE}"
    )
    return sampled


def main() -> int:
    """Write the fixture table.

    Returns:
        Process exit code (0 on success).
    """
    fixtures: list[dict[str, Any]] = []

    for name, params in hand_authored():
        # Hand inputs are a hard error, not a skip: an unrepresentable one
        # is an authoring mistake, and silently dropping it would hollow out
        # the table the parity claim rests on.
        assert_js_representable(params, "$")
        text = canonical(params)
        fixtures.append(
            {
                "name": name,
                "source": "hand",
                "params": params,
                "canonical": text,
                "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            }
        )

    for vector_id, params in corpus_sample():
        text = canonical(params)
        fixtures.append(
            {
                "name": vector_id,
                "source": "corpus",
                "params": params,
                "canonical": text,
                "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            }
        )

    names = [f["name"] for f in fixtures]
    if len(set(names)) != len(names):
        raise AssertionError("duplicate fixture names")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    # ensure_ascii keeps the committed file pure ASCII, so no editor or
    # transport can renormalize an astral character out from under the test.
    OUT_PATH.write_text(
        json.dumps(fixtures, indent=2, ensure_ascii=True, sort_keys=False) + "\n",
        encoding="utf-8",
    )
    pin = json.loads(CORPUS_CONFIG.read_text(encoding="utf-8"))["sourceCommit"]
    py = ".".join(str(v) for v in sys.version_info[:3])
    print(
        f"wrote {OUT_PATH.relative_to(REPO_ROOT)}: {len(fixtures)} fixtures "
        f"(CPython {py}, corpus pin {pin})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
