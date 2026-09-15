// Shared minimal-valid bookmark `params` dicts for the CRUD suites, so the
// create/update paths (including the client-side schema mirror) run without
// false rejection. Twin of `tests/unit/_bookmark_fixtures.py`; values are
// copied verbatim from the Python module.

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
