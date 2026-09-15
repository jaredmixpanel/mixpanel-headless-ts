// TS twin of `tests/unit/_bookmark_fixtures.py` — the shared
// minimal-valid bookmark `params` dicts the B6-W3 CRUD translations
// pass so they exercise the full create/update path (including the
// client-side schema mirror) without false-rejection.
//
// Values are copied VERBATIM from the Python module; the
// retention fixture is carried over even though no W3 test uses it
// today, so later shards do not re-derive it.

/** Minimal valid insights bookmark params dict. */
export const MINIMAL_INSIGHTS_PARAMS: Readonly<Record<string, unknown>> = {
  displayOptions: { chartType: "bar" },
  sections: {
    show: [
      {
        type: "metric",
        behavior: { type: "event", name: "Login" },
      },
    ],
    time: [],
  },
};

/** Minimal valid funnel bookmark params dict. */
export const MINIMAL_FUNNEL_PARAMS: Readonly<Record<string, unknown>> = {
  displayOptions: { chartType: "funnel-steps" },
  sections: {
    show: [
      {
        type: "metric",
        behavior: {
          type: "funnel",
          behaviors: [
            { type: "event", name: "Signup" },
            { type: "event", name: "Purchase" },
          ],
        },
      },
    ],
    time: [],
  },
};
