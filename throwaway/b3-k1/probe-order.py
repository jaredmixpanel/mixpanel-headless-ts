"""B3-K1 probe 4: inheritance field order + required-model-null shapes."""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel
from pydantic import ValidationError as PydanticValidationError

from mixpanel_headless._internal import bookmark_schema as bs


def errs(model: type[BaseModel], raw: Any) -> list[str]:
    """Return ``type@loc`` strings for pydantic's error stream."""
    try:
        model.model_validate(raw)
    except PydanticValidationError as exc:
        return [
            f"{e['type']}@{'.'.join(str(x) for x in e['loc'])}" for e in exc.errors()
        ]
    return ["OK"]


out: dict[str, Any] = {}

# Declared field order per model (drives emission order in the twin).
for name in [
    "RollingMeasurement",
    "MultiAttributionWeights",
    "CustomMultiAttribution",
    "PredefinedMultiAttribution",
    "StepRange",
    "FunnelStep",
    "ExclusionFunnelStep",
    "MetricDisplay",
    "Bucket",
    "Winsorization",
    "Statsig",
    "SRM",
    "Goal",
    "SubBehavior",
    "Behavior",
    "BehaviorMeasurement",
    "FormulaMeasurement",
    "BehaviorShowClause",
    "FormulaShowClause",
    "Sections",
    "AnnotationOptions",
    "CommentOptions",
    "SegmentId",
    "FunnelStepsSelectedTableColumns",
    "DisplayOptions",
    "InsightsBookmarkParams",
    "FlowsBookmarkStep",
    "FlowsBookmarkParams",
]:
    model = getattr(bs, name)
    out[f"fields/{name}"] = [
        {
            "name": fname,
            "alias": f.alias,
            "required": f.is_required(),
        }
        for fname, f in model.model_fields.items()
    ]

SEC = bs.Sections
DO = bs.DisplayOptions


def beh(b: Any) -> dict[str, Any]:
    """Sections carrying a behavior."""
    return {"show": [{"type": "metric", "behavior": b}], "time": []}


out["excl/empty"] = errs(SEC, beh({"exclusions": [{}]}))
out["excl/steps-null"] = errs(SEC, beh({"exclusions": [{"steps": None}]}))
out["excl/multi"] = errs(SEC, beh({"exclusions": [{"steps": None, "event": 5, "zzz": 1}]}))
out["multiattr/weights-null"] = errs(
    SEC,
    {
        "show": [
            {
                "type": "metric",
                "measurement": {
                    "multiAttribution": {"type": "custom", "name": "n", "weights": None}
                },
            }
        ],
        "time": [],
    },
)
out["multiattr/weights-partial"] = errs(
    SEC,
    {
        "show": [
            {
                "type": "metric",
                "measurement": {
                    "multiAttribution": {
                        "type": "custom",
                        "name": "n",
                        "weights": {"first": 1},
                    }
                },
            }
        ],
        "time": [],
    },
)
out["fbp/pfpl-null"] = errs(
    bs.FlowsBookmarkParams,
    {"steps": [{"property_filter_params_list": None}], "date_range": {}},
)
out["fbp/collapse_repeated-null"] = errs(
    bs.FlowsBookmarkParams, {"steps": [], "date_range": {}, "collapse_repeated": None}
)
out["fbp/flows_merge_type-null"] = errs(
    bs.FlowsBookmarkParams, {"steps": [], "date_range": {}, "flows_merge_type": None}
)
out["sections/globalDataGroupId-int"] = errs(
    SEC, {"show": [], "time": [], "globalDataGroupId": 5}
)
out["do/commentOptions-null"] = errs(DO, {"chartType": "bar", "commentOptions": None})
out["do/statSigControl-null"] = errs(DO, {"chartType": "bar", "statSigControl": None})
out["do/statSigControl-elem-null"] = errs(
    DO, {"chartType": "bar", "statSigControl": [None]}
)
out["ibp/sorting-nested"] = errs(
    bs.InsightsBookmarkParams,
    {
        "displayOptions": {"chartType": "bar"},
        "sections": {"show": [], "time": []},
        "sorting": {"bar": {"sortBy": "value"}},
    },
)
out["ibp/sorting-null"] = errs(
    bs.InsightsBookmarkParams,
    {
        "displayOptions": {"chartType": "bar"},
        "sections": {"show": [], "time": []},
        "sorting": None,
    },
)
out["ibp/executedMigrations-bad"] = errs(
    bs.InsightsBookmarkParams,
    {
        "displayOptions": {"chartType": "bar"},
        "sections": {"show": [], "time": []},
        "executedMigrations": 5,
    },
)
print(json.dumps(out, indent=1, ensure_ascii=False))
