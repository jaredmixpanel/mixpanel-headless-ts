"""B3-K1 mandatory CPython pydantic probe.

Drives ``validate_with_pydantic`` over the four non-sorting root models
(``InsightsBookmarkParams``, ``FlowsBookmarkParams``, ``Sections``,
``DisplayOptions``) plus the leaf models the K1 twin must reproduce,
recording pydantic-core's error TYPE / LOC / ORDER / MULTIPLICITY.

Run: uv run python throwaway/b3-k1/probe-schema.py
"""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel
from pydantic import ValidationError as PydanticValidationError

from mixpanel_headless._internal import bookmark_schema as bs


def errs(model: type[BaseModel], raw: Any) -> list[dict[str, Any]]:
    """Return pydantic's raw error stream for ``model.model_validate(raw)``."""
    try:
        model.model_validate(raw)
    except PydanticValidationError as exc:
        return [
            {"type": e["type"], "loc": list(e["loc"]), "msg": e["msg"]}
            for e in exc.errors()
        ]
    return []


def valid_insights() -> dict[str, Any]:
    """Minimal valid InsightsBookmarkParams dict (PBT twin)."""
    return {
        "displayOptions": {"chartType": "bar"},
        "sections": {
            "show": [{"type": "metric", "behavior": {"type": "event", "name": "L"}}],
            "time": [],
        },
    }


def valid_flows() -> dict[str, Any]:
    """Minimal valid FlowsBookmarkParams dict."""
    return {"steps": [{"event": "Login"}], "date_range": {"from_date": "2025-01-01"}}


CASES: list[tuple[str, type[BaseModel], Any]] = []


def case(name: str, model: type[BaseModel], raw: Any) -> None:
    """Register one probe case."""
    CASES.append((name, model, raw))


IBP = bs.InsightsBookmarkParams
FBP = bs.FlowsBookmarkParams
SEC = bs.Sections
DO = bs.DisplayOptions

# --- baseline valid -----------------------------------------------------
case("ibp/valid-minimal", IBP, valid_insights())
case("fbp/valid-minimal", FBP, valid_flows())
case("sections/valid-minimal", SEC, valid_insights()["sections"])
case("do/valid-minimal", DO, {"chartType": "bar"})

# --- multi-error ordering ----------------------------------------------
case("ibp/missing-sections+extra-key", IBP, {"displayOptions": {"chartType": "bar"}, "zzz": 1})
case("ibp/extra-first-then-missing", IBP, {"zzz": 1, "displayOptions": {"chartType": "bar"}})
case("ibp/empty", IBP, {})
case("ibp/two-extras-insertion-order", IBP, {**valid_insights(), "bbb": 1, "aaa": 2})
case("ibp/integer-like-extra-keys", IBP, {**valid_insights(), "2": 1, "b": 2, "1": 3})
case("ibp/not-a-dict", IBP, [])
case("ibp/none", IBP, None)
case("ibp/string", IBP, "x")

# --- ShowClause discriminator ------------------------------------------
def sections_with_show(show: Any) -> dict[str, Any]:
    """Sections dict with a custom ``show`` value."""
    return {"show": show, "time": []}


case("sections/show-formula-key", SEC, sections_with_show([{"formula": "A/B"}]))
case("sections/show-type-formula", SEC, sections_with_show([{"type": "formula"}]))
case("sections/show-type-metric", SEC, sections_with_show([{"type": "metric"}]))
case("sections/show-type-bogus", SEC, sections_with_show([{"type": "bogus"}]))
case("sections/show-no-type", SEC, sections_with_show([{}]))
case("sections/show-element-not-dict", SEC, sections_with_show([5]))
case("sections/show-element-null", SEC, sections_with_show([None]))
case("sections/show-not-a-list", SEC, sections_with_show("x"))
case("sections/show-null", SEC, sections_with_show(None))
case("sections/missing-show-and-time", SEC, {})
case("sections/extra", SEC, {"show": [], "time": [], "nope": 1})
case("sections/time-not-list", SEC, {"show": [], "time": 3})
case("sections/filter-null", SEC, {"show": [], "time": [], "filter": None})
case("sections/filter-not-list", SEC, {"show": [], "time": [], "filter": 1})

# --- nested Behavior ----------------------------------------------------
def show_behavior(behavior: Any) -> dict[str, Any]:
    """Sections with one BehaviorShowClause carrying ``behavior``."""
    return {"show": [{"type": "metric", "behavior": behavior}], "time": []}


case("sections/behavior-bad-type", SEC, show_behavior({"type": "nope"}))
case("sections/behavior-extra-key", SEC, show_behavior({"type": "event", "zzz": 1}))
case("sections/behavior-not-dict", SEC, show_behavior(5))
case("sections/behavior-null", SEC, show_behavior(None))
case(
    "sections/behavior-nested-subbehavior-bad",
    SEC,
    show_behavior({"behaviors": [{"type": "nope"}]}),
)
case(
    "sections/behavior-deep-subbehavior",
    SEC,
    show_behavior({"behaviors": [{"behaviors": [{"type": "nope"}]}]}),
)
case(
    "sections/behavior-exclusions-missing-steps",
    SEC,
    show_behavior({"exclusions": [{"event": "X"}]}),
)
case(
    "sections/behavior-exclusions-steps-alias",
    SEC,
    show_behavior({"exclusions": [{"event": "X", "steps": {"from": 1, "to": 2}}]}),
)
case(
    "sections/behavior-exclusions-steps-pyname",
    SEC,
    show_behavior({"exclusions": [{"event": "X", "steps": {"from_step": 1}}]}),
)
case(
    "sections/behavior-exclusions-steps-badkey",
    SEC,
    show_behavior({"exclusions": [{"event": "X", "steps": {"nope": 1}}]}),
)
case(
    "sections/behavior-custombucket-bad",
    SEC,
    show_behavior({"customBucket": {"bucketSize": "x"}}),
)
case("sections/behavior-ignore-filter-junk", SEC, show_behavior({"filter": {"a": [1]}}))
case("sections/behavior-hasUnsavedChanges-null", SEC, show_behavior({"hasUnsavedChanges": None}))
case("sections/behavior-behaviors-null", SEC, show_behavior({"behaviors": None}))
case("sections/behavior-raw_cohort-any", SEC, show_behavior({"raw_cohort": {"a": 1}}))

# --- BehaviorShowClause / FormulaShowClause -----------------------------
case(
    "sections/showclause-idx-alias",
    SEC,
    {"show": [{"_idx": "a", "type": "metric"}], "time": []},
)
case(
    "sections/showclause-idx-pyname",
    SEC,
    {"show": [{"idx": "a", "type": "metric"}], "time": []},
)
case(
    "sections/showclause-goals",
    SEC,
    {
        "show": [
            {
                "type": "metric",
                "goals": [{"id": "g", "label": "L", "checkpoints": [["a", 1.0]]}],
            }
        ],
        "time": [],
    },
)
case(
    "sections/showclause-goal-missing",
    SEC,
    {"show": [{"type": "metric", "goals": [{}]}], "time": []},
)
case(
    "sections/showclause-goal-checkpoint-arity",
    SEC,
    {
        "show": [
            {"type": "metric", "goals": [{"id": "g", "label": "L", "checkpoints": [["a"]]}]}
        ],
        "time": [],
    },
)
case(
    "sections/showclause-goal-checkpoint-long",
    SEC,
    {
        "show": [
            {
                "type": "metric",
                "goals": [{"id": "g", "label": "L", "checkpoints": [["a", 1, 2]]}],
            }
        ],
        "time": [],
    },
)
case(
    "sections/showclause-overrides-dict",
    SEC,
    {"show": [{"type": "metric", "overrides": {"a": [1, {"b": None}]}}], "time": []},
)
case(
    "sections/showclause-overrides-not-dict",
    SEC,
    {"show": [{"type": "metric", "overrides": [1]}], "time": []},
)
case(
    "sections/showclause-statsig-missing-control",
    SEC,
    {"show": [{"type": "metric", "statsig": {}}], "time": []},
)
case(
    "sections/showclause-srm",
    SEC,
    {"show": [{"type": "metric", "srm": {"expectedRatios": {"a": 1}}}], "time": []},
)
case(
    "sections/showclause-srm-bad-value",
    SEC,
    {"show": [{"type": "metric", "srm": {"expectedRatios": {"a": "x"}}}], "time": []},
)
case(
    "sections/formula-referencedMetrics",
    SEC,
    {
        "show": [
            {"type": "formula", "formula": "A", "referencedMetrics": [{"type": "metric"}]}
        ],
        "time": [],
    },
)
case(
    "sections/formula-referencedMetrics-bad",
    SEC,
    {"show": [{"type": "formula", "referencedMetrics": [{"zzz": 1}]}], "time": []},
)
case(
    "sections/formula-extra-behavior-key",
    SEC,
    {"show": [{"formula": "A", "behavior": {}}], "time": []},
)

# --- measurement / multiAttribution (plain union) -----------------------
def meas(m: Any) -> dict[str, Any]:
    """Sections with one BehaviorShowClause carrying ``measurement``."""
    return {"show": [{"type": "metric", "measurement": m}], "time": []}


case("sections/meas-math-bad", SEC, meas({"math": "totl"}))
case("sections/meas-math-ok", SEC, meas({"math": "total"}))
case("sections/meas-ignore-id-junk", SEC, meas({"id": {"a": 1}}))
case("sections/meas-ignore-type-junk", SEC, meas({"type": [1, 2]}))
case(
    "sections/meas-multiattr-predefined",
    SEC,
    meas({"multiAttribution": {"type": "linear"}}),
)
case(
    "sections/meas-multiattr-custom",
    SEC,
    meas(
        {
            "multiAttribution": {
                "type": "custom",
                "name": "n",
                "weights": {"first": 1, "middle": 2, "last": 3},
            }
        }
    ),
)
case(
    "sections/meas-multiattr-bad-type",
    SEC,
    meas({"multiAttribution": {"type": "nope"}}),
)
case(
    "sections/meas-multiattr-custom-missing",
    SEC,
    meas({"multiAttribution": {"type": "custom"}}),
)
case("sections/meas-multiattr-not-dict", SEC, meas({"multiAttribution": 5}))
case("sections/meas-percentile-int", SEC, meas({"percentile": 5}))
case("sections/meas-percentile-str", SEC, meas({"percentile": "5"}))
case("sections/meas-percentile-strfrac", SEC, meas({"percentile": "1.5"}))
case("sections/meas-percentile-bool", SEC, meas({"percentile": True}))
case("sections/meas-rolling", SEC, meas({"rolling": {"rollingWindowSize": 3}}))
case("sections/meas-rolling-frac", SEC, meas({"rolling": {"rollingWindowSize": 1.5}}))
case("sections/meas-rolling-intfloat", SEC, meas({"rolling": {"rollingWindowSize": 18.0}}))
case("sections/meas-property-any", SEC, meas({"property": {"a": [1]}}))

# --- DisplayOptions -----------------------------------------------------
case("do/missing-chartType", DO, {})
case("do/bad-chartType", DO, {"chartType": "lien"})
case("do/chartType-null", DO, {"chartType": None})
case("do/precision-int-literal", DO, {"chartType": "bar", "precision": 3})
case("do/extra", DO, {"chartType": "bar", "zzz": 1})
case("do/ignore-axisAssignments", DO, {"chartType": "bar", "axisAssignments": {"a": 1}})
case(
    "do/annotationOptions-bad",
    DO,
    {"chartType": "bar", "annotationOptions": {"sortOrder": "up"}},
)
case(
    "do/statSigControl-missing-prop",
    DO,
    {"chartType": "bar", "statSigControl": [{}]},
)
case(
    "do/funnelStepsSelectedTableColumns-kebab",
    DO,
    {"chartType": "bar", "funnelStepsSelectedTableColumns": {"conv-first-step": True}},
)
case(
    "do/funnelStepsSelectedTableColumns-snake",
    DO,
    {"chartType": "bar", "funnelStepsSelectedTableColumns": {"conv_first_step": True}},
)
case(
    "do/funnelStepsSelectedTableColumns-null-field",
    DO,
    {"chartType": "bar", "funnelStepsSelectedTableColumns": {"count": None}},
)
case(
    "do/funnelStepsSelectedTableColumns-int-field",
    DO,
    {"chartType": "bar", "funnelStepsSelectedTableColumns": {"count": 1}},
)
case("do/rollingWindowSize-str", DO, {"chartType": "bar", "rollingWindowSize": "5"})
case("do/rollingWindowSize-badstr", DO, {"chartType": "bar", "rollingWindowSize": "5x"})
case("do/theme-any", DO, {"chartType": "bar", "theme": {"a": [1, None]}})
case("do/queryTimeSampling-str", DO, {"chartType": "bar", "queryTimeSampling": "yes"})
case("do/queryTimeSampling-int", DO, {"chartType": "bar", "queryTimeSampling": 1})
case("do/queryTimeSampling-int2", DO, {"chartType": "bar", "queryTimeSampling": 2})

# --- MetricDisplay precision literal ------------------------------------
case(
    "sections/display-precision-bad",
    SEC,
    {"show": [{"type": "metric", "display": {"precision": 9}}], "time": []},
)
case(
    "sections/display-precision-strnum",
    SEC,
    {"show": [{"type": "metric", "display": {"precision": "3"}}], "time": []},
)
case(
    "sections/display-precision-bool",
    SEC,
    {"show": [{"type": "metric", "display": {"precision": True}}], "time": []},
)

# --- FlowsBookmarkParams (extra="allow") --------------------------------
case("fbp/extra-allowed", FBP, {**valid_flows(), "totally_unknown_ui_field": 12345})
case("fbp/missing-both", FBP, {})
case("fbp/steps-not-list", FBP, {"steps": 5, "date_range": {}})
case("fbp/step-bad-bool-op", FBP, {"steps": [{"event": "X", "bool_op": "annd"}], "date_range": {}})
case("fbp/step-forward-null", FBP, {"steps": [{"forward": None}], "date_range": {}})
case("fbp/step-forward-str", FBP, {"steps": [{"forward": "3"}], "date_range": {}})
case("fbp/step-extra", FBP, {"steps": [{"zzz": 1}], "date_range": {}})
case("fbp/date_range-not-dict", FBP, {"steps": [], "date_range": 5})
case("fbp/date_range-null", FBP, {"steps": [], "date_range": None})
case("fbp/alignment-bad", FBP, {**valid_flows(), "alignment": ["x"]})
case("fbp/version-str", FBP, {**valid_flows(), "version": "2"})
case("fbp/conversion_window-list", FBP, {**valid_flows(), "conversion_window": []})
case("fbp/chartType-int", FBP, {**valid_flows(), "chartType": 5})
case("fbp/not-a-dict", FBP, 5)

# --- Ignore[T] typed variants (icon=str, id=int, isNewQBEnabled=bool) ---
for _name, _val in [
    ("icon", 12345),
    ("icon", None),
    ("icon", "ok"),
    ("id", "notanint"),
    ("id", 1.5),
    ("id", "12"),
    ("id", None),
    ("isNewQBEnabled", "yes"),
    ("isNewQBEnabled", 1),
    ("isNewQBEnabled", 2),
    ("isNewQBEnabled", None),
    ("alignment", {"deep": [1, None, "x"]}),
    ("title", 5),
]:
    case(f"ibp/ignore-{_name}={_val!r}", IBP, {**valid_insights(), _name: _val})

# --- R10.9 mandatory edge set: raw + leaf --------------------------------
EDGE_VALUES: list[tuple[str, Any]] = [
    ("int-float-18.0", 18.0),
    ("frac-1.5", 1.5),
    ("true", True),
    ("none", None),
    ("empty-list", []),
    ("empty-str", ""),
    ("non-bmp", "\U0001d4b3"),
]
for _label, _v in EDGE_VALUES:
    case(f"edge/raw/ibp/{_label}", IBP, _v)
    case(f"edge/raw/fbp/{_label}", FBP, _v)
    case(f"edge/raw/sections/{_label}", SEC, _v)
    case(f"edge/raw/do/{_label}", DO, _v)
    case(f"edge/leaf/ibp.name/{_label}", IBP, {**valid_insights(), "name": _v})
    case(
        f"edge/leaf/do.rollingWindowSize/{_label}",
        DO,
        {"chartType": "bar", "rollingWindowSize": _v},
    )
    case(f"edge/leaf/do.chartType/{_label}", DO, {"chartType": _v})
    case(f"edge/leaf/ibp.versions/{_label}", IBP, {**valid_insights(), "versions": _v})
    case(
        f"edge/leaf/sections.show/{_label}",
        SEC,
        {"show": [{"type": "metric", "name": _v}], "time": []},
    )
    case(
        f"edge/leaf/behavior.id/{_label}",
        SEC,
        show_behavior({"id": _v}),
    )
    case(f"edge/leaf/fbp.step.forward/{_label}", FBP, {"steps": [{"forward": _v}], "date_range": {}})
    case(f"edge/leaf/fbp.date_range/{_label}", FBP, {"steps": [], "date_range": _v})

# --- every _DEFAULT_CODE_MAP row through the non-sorting models ----------
case("codemap/missing", IBP, {})
case("codemap/extra_forbidden", DO, {"chartType": "bar", "zzz": 1})
case("codemap/literal_error", DO, {"chartType": "nope"})
case("codemap/string_type", IBP, {**valid_insights(), "name": 5})
case("codemap/int_type", DO, {"chartType": "bar", "rollingWindowSize": []})
case("codemap/int_parsing", DO, {"chartType": "bar", "rollingWindowSize": "abc"})
case("codemap/bool_type", DO, {"chartType": "bar", "queryTimeSampling": []})
case("codemap/bool_parsing", DO, {"chartType": "bar", "queryTimeSampling": "nope"})
case("codemap/float_type", SEC, show_behavior({"customBucket": {"bucketSize": []}}))
case("codemap/float_parsing", SEC, show_behavior({"customBucket": {"bucketSize": "abc"}}))
case("codemap/list_type", IBP, {**valid_insights(), "versions": 5})
case("codemap/dict_type", FBP, {"steps": [], "date_range": 5})
case("codemap/model_type", DO, {"chartType": "bar", "annotationOptions": 5})
case("codemap/union_tag", SEC, sections_with_show([5]))

# --- lax coercion battery on representative leaves ----------------------
LAX_INPUTS: list[Any] = [
    5,
    5.0,
    5.5,
    "5",
    " 5 ",
    "+5",
    "05",
    "1_0",
    "1_000.0",
    "0.000",
    "5.",
    ".5",
    "1e3",
    "0x5",
    "10.01",
    True,
    False,
    None,
    [],
    {},
    "",
    "﻿5",
    " 5",
    "٥",
]
for _v in LAX_INPUTS:
    case(f"lax/int/{_v!r}", DO, {"chartType": "bar", "rollingWindowSize": _v})
    case(f"lax/float/{_v!r}", SEC, show_behavior({"customBucket": {"bucketSize": _v}}))
    case(f"lax/str/{_v!r}", IBP, {**valid_insights(), "name": _v})
    case(f"lax/bool/{_v!r}", DO, {"chartType": "bar", "queryTimeSampling": _v})


def main() -> None:
    """Run every probe case and print the JSON transcript."""
    out = []
    for name, model, raw in CASES:
        out.append(
            {
                "case": name,
                "model": model.__name__,
                "input": repr(raw),
                "errors": errs(model, raw),
            }
        )
    print(json.dumps(out, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
