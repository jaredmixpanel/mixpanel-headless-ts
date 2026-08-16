/**
 * B6-W6 R10.9 harness — the lexicon + tracking/history facade
 * wire/edge set (packet `b6-packets.md` §8 "R10.9
 * `throwaway/b6-w6/`").
 *
 * The W6 members are facade delegations with no oracle-call surface
 * (all-wire batch, §11.5), so the harness runs them through the
 * injected-fetch seam with hand-built interactions and asserts:
 *
 *   (i)   delegation equivalence — facade result === direct client
 *         result re-validated through the SAME model seam, over the
 *         same canned interaction;
 *   (ii)  wire status branches — `get_event_definitions` (200 / 404)
 *         and `export_lexicon` (200 / 500);
 *   (iii) the mandatory edge set (18.0, 1.5, true, null, [], "", "𝒳")
 *         pushed through (a) the definition-update payloads where the
 *         declared annotation admits the value (Discrepancy #8: the
 *         contract is the ANNOTATION — `tags: list[str] | None`,
 *         `description: str | None`, the four `bool | None` flags; the
 *         two float members have NO admitting param in this shard) and
 *         (b) the four `dict[str, Any]` / `list[dict[str, Any]]`
 *         opaque passthroughs, where the whole set including both
 *         floats IS in-annotation and must survive byte-exact
 *         (Discrepancy #12: `18.0` must not narrow to `18`). NO
 *         integer-like unknown keys anywhere (#9/#10).
 *   (iv)  EVERY W6-local branch. The shard has ZERO empty-response
 *         guards (grep-verified over `workspace.py:7197-7581` and
 *         `:8526-8648`), so the local branch set is: the
 *         `list_lexicon_tags` string-vs-object discrimination (both
 *         arms + a mixed list), the TWO dump spellings (`by_alias` on
 *         the four definition writers vs plain on the two tag
 *         writers) with `exclude_none` drops, the two `?? null`
 *         forwards (`resource_type`, `export_types`), the four
 *         verbatim passthroughs, the two void members, and
 *         `RESPONSE_VALIDATION_ERROR` from a malformed 200 body for
 *         every validated member.
 *
 *     npx vite-node throwaway/b6-w6/wire-edges.ts
 *
 * Deterministic: no RNG, no seed — every case is a hand-built canned
 * interaction over the injected-fetch seam.
 *
 * THROWAWAY: deleted at the B6 gate; the RUN record lives in
 * `context/phase3/notes/B6-W6-notes.md` §3, which survives.
 */

import {
  createMockClient,
  makeSession,
  type CannedResponse,
  type CapturedFetchRequest,
} from "../../packages/core/test/client/client-test-helpers.js";
import type { MixpanelClient } from "../../packages/core/src/client/client.js";
import { toNativeJson } from "../../packages/core/src/client/json-value.js";
import {
  validateResponseModel,
  validateResponseModels,
} from "../../packages/core/src/client/response-validation.js";
import { Workspace } from "../../packages/core/src/workspace.js";
import {
  BulkEventUpdate,
  BulkPropertyUpdate,
  BulkUpdateEventsParams,
  BulkUpdatePropertiesParams,
  CreateTagParams,
  EventDefinition,
  LexiconTag,
  PropertyDefinition,
  UpdateEventDefinitionParams,
  UpdatePropertyDefinitionParams,
  UpdateTagParams,
} from "../../packages/core/src/types/entities/lexicon.js";
import * as members from "../../packages/core/src/workspace-members/lexicon-tracking.js";

let checks = 0;
let failures = 0;

/**
 * Record one expectation.
 *
 * @param label - What is being checked.
 * @param actual - The observed value (JSON-compared).
 * @param expected - The expected value.
 */
function check(label: string, actual: unknown, expected: unknown): void {
  checks += 1;
  const a = JSON.stringify(actual) ?? "undefined";
  const b = JSON.stringify(expected) ?? "undefined";
  if (a !== b) {
    failures += 1;
    console.log(`FAIL ${label}\n  actual   ${a}\n  expected ${b}`);
  }
}

/**
 * Run a thunk and describe the thrown error.
 *
 * @param fn - The thunk.
 * @returns `[name, code]`, or `["<resolved>", ""]` when it did not throw.
 */
async function thrown(fn: () => Promise<unknown>): Promise<string[]> {
  try {
    await fn();
    return ["<resolved>", ""];
  } catch (error) {
    const err = error as { name?: string; code?: string };
    return [err.name ?? "?", err.code ?? "?"];
  }
}

const SESSION = makeSession({
  projectId: "12345",
  region: "us",
  oauthToken: "test-token",
});

/**
 * Build the facade + its client over one canned handler
 * (`_make_workspace`, `test_workspace_data_governance.py:97-110`).
 *
 * @param handler - The canned-response handler.
 * @returns The facade, its client and the capture log.
 */
function rig(handler: (request: CapturedFetchRequest) => CannedResponse): {
  ws: Workspace;
  client: MixpanelClient;
  captures: readonly CapturedFetchRequest[];
} {
  const { client, transport } = createMockClient(SESSION, handler);
  return {
    ws: new Workspace({ session: SESSION, client }),
    client,
    captures: transport.captures,
  };
}

/**
 * A stub client whose single method records its args and resolves.
 *
 * @param method - The client method name.
 * @param value - The resolved value.
 * @param calls - Log receiving each argument list.
 * @returns The stub cast to the client type.
 */
function stub(
  method: string,
  value: unknown,
  calls: unknown[][] = [],
): MixpanelClient {
  return {
    [method]: (...args: unknown[]): Promise<unknown> => {
      calls.push(args);
      return Promise.resolve(value);
    },
  } as unknown as MixpanelClient;
}

/**
 * A 200 App-API envelope wrapping `results`.
 *
 * @param results - The `results` payload.
 * @returns The canned response.
 */
function ok(results: unknown): CannedResponse {
  return { status: 200, json: { status: "ok", results } };
}

/**
 * An event-definition payload (`_event_def_json` twin).
 *
 * @param id - Definition ID.
 * @param name - Event name.
 * @returns The payload.
 */
function ev(id: number, name: string): Record<string, unknown> {
  return {
    id,
    name,
    description: `Description for ${name}`,
    hidden: false,
    dropped: false,
  };
}

/**
 * A property-definition payload (`_property_def_json` twin).
 *
 * @param id - Definition ID.
 * @param name - Property name.
 * @returns The payload.
 */
function pr(id: number, name: string): Record<string, unknown> {
  return {
    id,
    name,
    resource_type: "event",
    description: `Description for ${name}`,
    hidden: false,
  };
}

/** The mandatory R10.9 edge set, as a JSON-admitting record. */
const EDGE_RECORD: Record<string, unknown> = {
  integral_float: 18.0,
  fractional: 1.5,
  flag: true,
  nothing: null,
  empty_list: [],
  empty_string: "",
  astral: "𝒳",
};

/** The raw JSON text of {@link EDGE_RECORD} with `18.0` spelled out. */
const EDGE_RECORD_JSON =
  '{"integral_float":18.0,"fractional":1.5,"flag":true,' +
  '"nothing":null,"empty_list":[],"empty_string":"","astral":"𝒳"}';

/**
 * Run the whole harness.
 *
 * @returns Nothing; sets `process.exitCode` on failure.
 */
async function main(): Promise<void> {
  // -----------------------------------------------------------------
  // (i) Delegation equivalence — the facade result must equal the
  //     direct client result pushed through the SAME model seam.
  // -----------------------------------------------------------------
  {
    const payload = [ev(1, "Purchase"), ev(2, "Signup")];
    const a = rig(() => ok(payload));
    const b = rig(() => ok(payload));
    check(
      "(i) get_event_definitions equivalence",
      (await a.ws.getEventDefinitions({ names: ["Purchase", "Signup"] })).map(
        (m) => m.toJSON(),
      ),
      validateResponseModels(
        EventDefinition,
        (await b.client.getEventDefinitions(["Purchase", "Signup"])).map((x) =>
          toNativeJson(x),
        ),
        { endpoint: "get_event_definitions" },
      ).map((m) => m.toJSON()),
    );
  }
  {
    const payload = [pr(1, "$browser")];
    const a = rig(() => ok(payload));
    const b = rig(() => ok(payload));
    check(
      "(i) get_property_definitions equivalence",
      (await a.ws.getPropertyDefinitions({ names: ["$browser"] })).map((m) =>
        m.toJSON(),
      ),
      validateResponseModels(
        PropertyDefinition,
        (await b.client.getPropertyDefinitions(["$browser"], null)).map((x) =>
          toNativeJson(x),
        ),
        { endpoint: "get_property_definitions" },
      ).map((m) => m.toJSON()),
    );
  }
  {
    const payload = [
      { id: 1, name: "core-metrics" },
      { id: 2, name: "growth" },
    ];
    const a = rig(() => ok(payload));
    const b = rig(() => ok(payload));
    check(
      "(i) list_lexicon_tags equivalence",
      (await a.ws.listLexiconTags()).map((m) => m.toJSON()),
      (await b.client.listLexiconTags())
        .map((x) =>
          validateResponseModel(LexiconTag, toNativeJson(x), {
            endpoint: "list_lexicon_tags",
          }),
        )
        .map((m) => m.toJSON()),
    );
  }
  {
    const payload = { last_seen: "2026-01-01", platforms: ["web", "ios"] };
    const a = rig(() => ok(payload));
    const b = rig(() => ok(payload));
    check(
      "(i) get_tracking_metadata equivalence",
      await a.ws.getTrackingMetadata("Purchase"),
      toNativeJson(await b.client.getTrackingMetadata("Purchase")),
    );
  }
  {
    const payload = [{ action: "created", timestamp: "2026-01-01" }];
    const a = rig(() => ok(payload));
    const b = rig(() => ok(payload));
    check(
      "(i) get_event_history equivalence",
      await a.ws.getEventHistory("Purchase"),
      (await b.client.getEventHistory("Purchase")).map((x) => toNativeJson(x)),
    );
  }
  {
    const payload = [{ action: "hidden", timestamp: "2026-03-01" }];
    const a = rig(() => ok(payload));
    const b = rig(() => ok(payload));
    check(
      "(i) get_property_history equivalence",
      await a.ws.getPropertyHistory("$browser", "event"),
      (await b.client.getPropertyHistory("$browser", "event")).map((x) =>
        toNativeJson(x),
      ),
    );
  }
  {
    const payload = { events: [], properties: [] };
    const a = rig(() => ok(payload));
    const b = rig(() => ok(payload));
    check(
      "(i) export_lexicon equivalence",
      await a.ws.exportLexicon(),
      toNativeJson(await b.client.exportLexicon(null)),
    );
  }
  {
    const payload = ev(1, "Purchase");
    const a = rig(() => ok(payload));
    const b = rig(() => ok(payload));
    const params = new UpdateEventDefinitionParams({ verified: true });
    check(
      "(i) update_event_definition equivalence",
      (await a.ws.updateEventDefinition("Purchase", params)).toJSON(),
      validateResponseModel(
        EventDefinition,
        toNativeJson(
          await b.client.updateEventDefinition(
            "Purchase",
            params.modelDumpExcludeNone({ byAlias: true }),
          ),
        ),
        { endpoint: "update_event_definition" },
      ).toJSON(),
    );
  }

  // -----------------------------------------------------------------
  // (ii) Wire status branches.
  // -----------------------------------------------------------------
  {
    const { ws } = rig(() => ok([ev(1, "Purchase")]));
    check(
      "(ii) get_event_definitions 200",
      (await ws.getEventDefinitions({ names: ["Purchase"] })).length,
      1,
    );
  }
  {
    const { ws } = rig(() => ({
      status: 404,
      json: { error: "no such event" },
    }));
    check(
      "(ii) get_event_definitions 404",
      await thrown(() => ws.getEventDefinitions({ names: ["Nope"] })),
      ["QueryError", "QUERY_FAILED"],
    );
  }
  {
    const { ws } = rig(() => ok({ events: [] }));
    check(
      "(ii) export_lexicon 200",
      Object.hasOwn(await ws.exportLexicon(), "events"),
      true,
    );
  }
  {
    const { ws } = rig(() => ({ status: 500, json: { error: "boom" } }));
    check("(ii) export_lexicon 500", await thrown(() => ws.exportLexicon()), [
      "ServerError",
      "SERVER_ERROR",
    ]);
  }

  // -----------------------------------------------------------------
  // (iii) The mandatory edge set.
  //
  //  (a) Definition-update payloads, ANNOTATION-BOUNDED (#8): the W6
  //      param models declare `bool | None`, `str | None` and
  //      `list[str] | None` only — `true`, `null`, `""`, `"𝒳"` and
  //      `[]` are all in-annotation; the two float members are NOT
  //      admitted by any W6 param field and are exercised in (b).
  // -----------------------------------------------------------------
  {
    const calls: unknown[][] = [];
    await members.updateEventDefinition(
      stub("updateEventDefinition", ev(1, "E"), calls),
      "E",
      new UpdateEventDefinitionParams({
        hidden: true,
        dropped: null,
        description: "",
        display_name: "𝒳",
        tags: [],
      }),
    );
    check(
      "(iii-a) edge values survive the by_alias dump, None dropped",
      calls[0]?.[1],
      { hidden: true, tags: [], displayName: "𝒳", description: "" },
    );
  }
  {
    const calls: unknown[][] = [];
    await members.updatePropertyDefinition(
      stub("updatePropertyDefinition", pr(1, "p"), calls),
      "p",
      new UpdatePropertyDefinitionParams({
        sensitive: true,
        merged: null,
        example_value: "",
        description: "𝒳",
      }),
    );
    check(
      "(iii-a) property edge values survive the by_alias dump",
      calls[0]?.[1],
      { sensitive: true, description: "𝒳", exampleValue: "" },
    );
  }
  {
    const calls: unknown[][] = [];
    await members.bulkUpdateEventDefinitions(
      stub("bulkUpdateEventDefinitions", [], calls),
      new BulkUpdateEventsParams({
        events: [
          new BulkEventUpdate({ name: "", tags: [] }),
          new BulkEventUpdate({ name: "𝒳", hidden: true }),
        ],
      }),
    );
    check("(iii-a) bulk event edge entries", calls[0]?.[0], {
      events: [
        { name: "", tags: [] },
        { name: "𝒳", hidden: true },
      ],
    });
  }
  {
    const calls: unknown[][] = [];
    await members.bulkUpdatePropertyDefinitions(
      stub("bulkUpdatePropertyDefinitions", [], calls),
      new BulkUpdatePropertiesParams({
        properties: [
          new BulkPropertyUpdate({
            name: "𝒳",
            resource_type: "Event",
            hidden: true,
          }),
        ],
      }),
    );
    check("(iii-a) bulk property edge entries", calls[0]?.[0], {
      properties: [{ name: "𝒳", resourceType: "Event", hidden: true }],
    });
  }
  {
    const calls: unknown[][] = [];
    await members.createLexiconTag(
      stub("createLexiconTag", { id: 1, name: "" }, calls),
      new CreateTagParams({ name: "" }),
    );
    check("(iii-a) empty-string tag name reaches the wire", calls[0]?.[0], {
      name: "",
    });
  }
  {
    const calls: unknown[][] = [];
    await members.getEventDefinitions(stub("getEventDefinitions", [], calls), {
      names: [],
    });
    check("(iii-a) empty names list forwarded verbatim", calls[0], [[]]);
  }
  {
    const calls: unknown[][] = [];
    await members.exportLexicon(stub("exportLexicon", {}, calls), {
      export_types: [""],
    });
    check("(iii-a) empty-string export type forwarded", calls[0], [[""]]);
  }

  //  (b) The opaque passthroughs — `dict[str, Any]` /
  //      `list[dict[str, Any]]`: the WHOLE edge set is in-annotation
  //      here, including both floats (#12: `18.0` must not narrow).
  {
    const { ws } = rig(() => ({
      status: 200,
      text: `{"status":"ok","results":${EDGE_RECORD_JSON}}`,
    }));
    check(
      "(iii-b) get_tracking_metadata edge record round-trips",
      await ws.getTrackingMetadata("E"),
      EDGE_RECORD,
    );
  }
  {
    const { ws } = rig(() => ({
      status: 200,
      text: `{"status":"ok","results":[${EDGE_RECORD_JSON}]}`,
    }));
    check(
      "(iii-b) get_event_history edge record round-trips",
      await ws.getEventHistory("E"),
      [EDGE_RECORD],
    );
  }
  {
    const { ws } = rig(() => ({
      status: 200,
      text: `{"status":"ok","results":[${EDGE_RECORD_JSON}]}`,
    }));
    check(
      "(iii-b) get_property_history edge record round-trips",
      await ws.getPropertyHistory("p", "event"),
      [EDGE_RECORD],
    );
  }
  {
    const { ws } = rig(() => ({
      status: 200,
      text: `{"status":"ok","results":${EDGE_RECORD_JSON}}`,
    }));
    const exported = await ws.exportLexicon();
    check(
      "(iii-b) export_lexicon edge record round-trips",
      exported,
      EDGE_RECORD,
    );
    // Discrepancy #12 (ratified): the opaque passthroughs hand back the
    // NATIVE tree, so the `18.0` wire token arrives as the JS number
    // `18` and re-serializes as `18`. The distinction survives only in
    // the lossless `JsonValue` tree the CLIENT returns — the facade
    // annotation (`dict[str, Any]`) is where it is deliberately lost,
    // exactly as Python's `json.loads` loses it into a `float` whose
    // `repr` is `18.0`. Recorded, not "fixed".
    check(
      "(iii-b) #12 — integral float narrows to an int-valued JS number",
      [
        typeof exported["integral_float"],
        JSON.stringify(exported["integral_float"]),
      ],
      ["number", "18"],
    );
  }
  {
    // extra='allow' spillover: an unknown key with an edge value must
    // reach `__extras` untouched (no integer-like keys, #9/#10).
    const { ws } = rig(() => ({
      status: 200,
      text: `{"status":"ok","results":[{"id":1,"name":"E","astral":"𝒳","f":1.5}]}`,
    }));
    const defs = await ws.getEventDefinitions({ names: ["E"] });
    check(
      "(iii-b) extras spillover keeps the astral string",
      defs[0]?.__extras["astral"],
      "𝒳",
    );
    check(
      "(iii-b) extras spillover keeps the float",
      defs[0]?.__extras["f"],
      1.5,
    );
  }

  // -----------------------------------------------------------------
  // (iv) EVERY W6-local branch.
  // -----------------------------------------------------------------

  // (iv.1) list_lexicon_tags: the shard's ONE non-forwarding body.
  {
    const tags = await members.listLexiconTags(
      stub("listLexiconTags", ["alpha", "beta"]),
    );
    check(
      "(iv) list_lexicon_tags all-string arm -> id=0 sentinel",
      tags.map((t) => t.toJSON()),
      [
        { id: 0, name: "alpha" },
        { id: 0, name: "beta" },
      ],
    );
  }
  {
    const tags = await members.listLexiconTags(
      stub("listLexiconTags", [{ id: 3, name: "gamma" }]),
    );
    check(
      "(iv) list_lexicon_tags all-object arm -> validated",
      tags.map((t) => t.toJSON()),
      [{ id: 3, name: "gamma" }],
    );
  }
  {
    const tags = await members.listLexiconTags(
      stub("listLexiconTags", ["alpha", { id: 3, name: "gamma" }, ""]),
    );
    check(
      "(iv) list_lexicon_tags mixed arm, order preserved",
      tags.map((t) => t.toJSON()),
      [
        { id: 0, name: "alpha" },
        { id: 3, name: "gamma" },
        { id: 0, name: "" },
      ],
    );
  }
  {
    check(
      "(iv) list_lexicon_tags empty list",
      (await members.listLexiconTags(stub("listLexiconTags", []))).length,
      0,
    );
  }

  // (iv.2) The two dump spellings.
  {
    const calls: unknown[][] = [];
    await members.createLexiconTag(
      stub("createLexiconTag", { id: 1, name: "t" }, calls),
      new CreateTagParams({ name: "t" }),
    );
    check("(iv) create_lexicon_tag plain dump", calls[0]?.[0], { name: "t" });
  }
  {
    const calls: unknown[][] = [];
    await members.updateLexiconTag(
      stub("updateLexiconTag", { id: 1, name: "t" }, calls),
      9,
      new UpdateTagParams({}),
    );
    check("(iv) update_lexicon_tag plain dump, None dropped", calls[0], [
      9,
      {},
    ]);
  }
  {
    const calls: unknown[][] = [];
    await members.updateEventDefinition(
      stub("updateEventDefinition", ev(1, "E"), calls),
      "E",
      new UpdateEventDefinitionParams({}),
    );
    check("(iv) update_event_definition all-None dump is empty", calls[0], [
      "E",
      {},
    ]);
  }
  {
    const calls: unknown[][] = [];
    await members.updatePropertyDefinition(
      stub("updatePropertyDefinition", pr(1, "p"), calls),
      "p",
      new UpdatePropertyDefinitionParams({}),
    );
    check("(iv) update_property_definition all-None dump is empty", calls[0], [
      "p",
      {},
    ]);
  }

  // (iv.3) The two `?? null` forwards.
  {
    const calls: unknown[][] = [];
    await members.getPropertyDefinitions(
      stub("getPropertyDefinitions", [], calls),
      { names: ["p"] },
    );
    check("(iv) resource_type default -> null", calls[0], [["p"], null]);
  }
  {
    const calls: unknown[][] = [];
    await members.getPropertyDefinitions(
      stub("getPropertyDefinitions", [], calls),
      { names: ["p"], resource_type: "user" },
    );
    check("(iv) resource_type populated -> verbatim", calls[0], [
      ["p"],
      "user",
    ]);
  }
  {
    const calls: unknown[][] = [];
    await members.exportLexicon(stub("exportLexicon", {}, calls), {});
    check("(iv) export_types default -> null", calls[0], [null]);
  }
  {
    const calls: unknown[][] = [];
    await members.exportLexicon(stub("exportLexicon", {}, calls), {
      export_types: ["All Events and Properties"],
    });
    check("(iv) export_types populated -> verbatim", calls[0], [
      ["All Events and Properties"],
    ]);
  }

  // (iv.4) The two void members forward the NAME.
  {
    const calls: unknown[][] = [];
    check(
      "(iv) delete_event_definition returns undefined",
      await members.deleteEventDefinition(
        stub("deleteEventDefinition", { ignored: true }, calls),
        "OldEvent",
      ),
      undefined,
    );
    check("(iv) delete_event_definition forwards the name", calls[0], [
      "OldEvent",
    ]);
  }
  {
    const calls: unknown[][] = [];
    check(
      "(iv) delete_lexicon_tag returns undefined",
      await members.deleteLexiconTag(
        stub("deleteLexiconTag", { ignored: true }, calls),
        "core-metrics",
      ),
      undefined,
    );
    check("(iv) delete_lexicon_tag forwards the NAME (not an id)", calls[0], [
      "core-metrics",
    ]);
  }

  // (iv.5) RESPONSE_VALIDATION_ERROR from a malformed 200 body, for
  //        every validated member (10 of the 15).
  {
    const bad = { id: "not-an-int", name: "E" };
    const badProp = { id: 1, name: 42 };
    const badTag = { id: "x", name: "t" };
    const cases: Array<[string, () => Promise<unknown>]> = [
      [
        "get_event_definitions",
        () =>
          members.getEventDefinitions(stub("getEventDefinitions", [bad]), {
            names: ["E"],
          }),
      ],
      [
        "update_event_definition",
        () =>
          members.updateEventDefinition(
            stub("updateEventDefinition", bad),
            "E",
            new UpdateEventDefinitionParams({}),
          ),
      ],
      [
        "bulk_update_event_definitions",
        () =>
          members.bulkUpdateEventDefinitions(
            stub("bulkUpdateEventDefinitions", [bad]),
            new BulkUpdateEventsParams({ events: [] }),
          ),
      ],
      [
        "get_property_definitions",
        () =>
          members.getPropertyDefinitions(
            stub("getPropertyDefinitions", [badProp]),
            { names: ["p"] },
          ),
      ],
      [
        "update_property_definition",
        () =>
          members.updatePropertyDefinition(
            stub("updatePropertyDefinition", badProp),
            "p",
            new UpdatePropertyDefinitionParams({}),
          ),
      ],
      [
        "bulk_update_property_definitions",
        () =>
          members.bulkUpdatePropertyDefinitions(
            stub("bulkUpdatePropertyDefinitions", [badProp]),
            new BulkUpdatePropertiesParams({ properties: [] }),
          ),
      ],
      [
        "list_lexicon_tags",
        () => members.listLexiconTags(stub("listLexiconTags", [badTag])),
      ],
      [
        "create_lexicon_tag",
        () =>
          members.createLexiconTag(
            stub("createLexiconTag", badTag),
            new CreateTagParams({ name: "t" }),
          ),
      ],
      [
        "update_lexicon_tag",
        () =>
          members.updateLexiconTag(
            stub("updateLexiconTag", badTag),
            1,
            new UpdateTagParams({}),
          ),
      ],
    ];
    for (const [name, fn] of cases) {
      check(
        `(iv) ${name} malformed 200 -> RESPONSE_VALIDATION_ERROR`,
        (await thrown(fn))[1],
        "RESPONSE_VALIDATION_ERROR",
      );
    }
  }

  // (iv.6) The four passthroughs never validate — an "invalid" shape
  //        for a model is simply returned.
  {
    const opaque = { anything: [1, { deep: true }] };
    check(
      "(iv) get_tracking_metadata verbatim (no model construction)",
      await members.getTrackingMetadata(
        stub("getTrackingMetadata", opaque),
        "E",
      ),
      opaque,
    );
    check(
      "(iv) export_lexicon verbatim (no model construction)",
      await members.exportLexicon(stub("exportLexicon", opaque), {}),
      opaque,
    );
    check(
      "(iv) get_event_history verbatim",
      await members.getEventHistory(stub("getEventHistory", [opaque]), "E"),
      [opaque],
    );
    check(
      "(iv) get_property_history verbatim",
      await members.getPropertyHistory(
        stub("getPropertyHistory", [opaque]),
        "p",
        "event",
      ),
      [opaque],
    );
  }

  console.log(`\nchecks ${String(checks)}   failures ${String(failures)}`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

await main();
