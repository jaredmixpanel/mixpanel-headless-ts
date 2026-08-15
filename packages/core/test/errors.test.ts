// Error-shape unit tests (phase2-design C3 lock #3), translated from
// tests/unit/test_exceptions.py + test_exceptions_session_replay.py.
//
// Translation notes (documented exclusions, NOT weakened assertions):
// - Message-TEXT assertions from the Python suites are deliberately not
//   carried: error message text is out of contract (R5.4). Everything the
//   vectors compare — class name, `code`, `details`, `toDict()` key set —
//   is asserted here.
// - Python's dual-inheritance assertions (`isinstance(exc, ValueError)`)
//   have no JS analog (phase2-design C3): the conformance key is class
//   name + code, asserted via the registry test and the chains below.
import { describe, expect, it } from "vitest";
import {
  AccountExistsError,
  AccountInUseError,
  AccountNotFoundError,
  APIError,
  AuthenticationError,
  BookmarkValidationError,
  BusinessContextValidationError,
  ConfigError,
  DateRangeTooLargeError,
  EventNotFoundError,
  InvalidArgumentError,
  MixpanelHeadlessError,
  OAuthError,
  ParamTypeError,
  ParamValidationError,
  ProjectNotFoundError,
  QueryError,
  RateLimitError,
  RegionProbeError,
  RegionProbeNetworkError,
  ReplayNotFoundError,
  ResponseValidationError,
  ServerError,
  SessionReplayAccessError,
  SessionReplayError,
  SignedURLExpiredError,
  UnsupportedReplayFormatError,
  ValidationError,
  WorkspaceScopeError,
} from "../src/errors.js";

describe("MixpanelHeadlessError", () => {
  it("initializes with defaults (code UNKNOWN_ERROR, empty details)", () => {
    const exc = new MixpanelHeadlessError("Something went wrong");
    expect(exc.message).toBe("Something went wrong");
    expect(exc.code).toBe("UNKNOWN_ERROR");
    expect(exc.details).toEqual({});
    expect(exc.name).toBe("MixpanelHeadlessError");
    expect(exc).toBeInstanceOf(Error);
  });

  it("carries code and details", () => {
    const exc = new MixpanelHeadlessError("msg", "MY_CODE", { key: "value" });
    expect(exc.code).toBe("MY_CODE");
    expect(exc.details).toEqual({ key: "value" });
  });

  it("toDict emits exactly {code, message, details}", () => {
    const exc = new MixpanelHeadlessError("msg", "MY_CODE", { key: "value" });
    const d = exc.toDict();
    expect(Object.keys(d)).toEqual(["code", "message", "details"]);
    expect(d).toEqual({
      code: "MY_CODE",
      message: "msg",
      details: { key: "value" },
    });
    // toDict output must be JSON-serializable.
    expect(() => JSON.stringify(d)).not.toThrow();
  });

  it("threads cause via ErrorOptions", () => {
    const original = new Error("boom");
    const exc = new MixpanelHeadlessError("wrapped", "UNKNOWN_ERROR", null, {
      cause: original,
    });
    expect(exc.cause).toBe(original);
  });
});

describe("coded-guard classes (E2)", () => {
  it("ParamValidationError defaults to VALIDATION_ERROR", () => {
    const exc = new ParamValidationError("bad value");
    expect(exc.code).toBe("VALIDATION_ERROR");
    expect(exc).toBeInstanceOf(MixpanelHeadlessError);
    expect(exc.name).toBe("ParamValidationError");
  });

  it("ParamValidationError carries a registry code + details", () => {
    const exc = new ParamValidationError("bad", "FD1_QUANTITY_NOT_POSITIVE", {
      quantity: 0,
    });
    expect(exc.code).toBe("FD1_QUANTITY_NOT_POSITIVE");
    expect(exc.toDict()).toEqual({
      code: "FD1_QUANTITY_NOT_POSITIVE",
      message: "bad",
      details: { quantity: 0 },
    });
  });

  it("ParamTypeError defaults to VALIDATION_ERROR and inherits from base only", () => {
    const exc = new ParamTypeError("bad type");
    expect(exc.code).toBe("VALIDATION_ERROR");
    expect(exc).toBeInstanceOf(MixpanelHeadlessError);
    expect(exc).not.toBeInstanceOf(ParamValidationError);
    expect(exc.name).toBe("ParamTypeError");
  });

  it("ResponseValidationError defaults, carries details, threads cause", () => {
    const original = new Error("pydantic-equivalent failure");
    const exc = new ResponseValidationError(
      "response invalid",
      "RESPONSE_VALIDATION_ERROR",
      { model: "Dashboard" },
      { cause: original },
    );
    expect(exc.code).toBe("RESPONSE_VALIDATION_ERROR");
    expect(exc.details).toEqual({ model: "Dashboard" });
    expect(exc.cause).toBe(original);
    expect(exc).toBeInstanceOf(MixpanelHeadlessError);
    expect(exc).not.toBeInstanceOf(APIError);
    expect(new ResponseValidationError("x").code).toBe(
      "RESPONSE_VALIDATION_ERROR",
    );
  });
});

describe("APIError", () => {
  it("carries full HTTP context and mirrors it into snake_case details", () => {
    const exc = new APIError("API failed", {
      statusCode: 500,
      responseBody: { error: "Internal error" },
      requestMethod: "POST",
      requestUrl: "https://mixpanel.com/api/query/segmentation",
      requestParams: { event: "login" },
      requestBody: { filter: "x" },
    });
    expect(exc.statusCode).toBe(500);
    expect(exc.responseBody).toEqual({ error: "Internal error" });
    expect(exc.requestMethod).toBe("POST");
    expect(exc.requestUrl).toBe("https://mixpanel.com/api/query/segmentation");
    expect(exc.requestParams).toEqual({ event: "login" });
    expect(exc.requestBody).toEqual({ filter: "x" });
    expect(exc.code).toBe("API_ERROR");
    expect(exc.details).toEqual({
      status_code: 500,
      response_body: { error: "Internal error" },
      request_method: "POST",
      request_url: "https://mixpanel.com/api/query/segmentation",
      request_params: { event: "login" },
      request_body: { filter: "x" },
    });
  });

  it("omits detail keys for absent optional context (R4.11 absent-vs-null)", () => {
    const exc = new APIError("minimal", { statusCode: 404 });
    expect(exc.statusCode).toBe(404);
    expect(exc.responseBody).toBeNull();
    expect(exc.requestMethod).toBeNull();
    expect(exc.requestUrl).toBeNull();
    expect(exc.requestParams).toBeNull();
    expect(exc.requestBody).toBeNull();
    expect(Object.keys(exc.details)).toEqual(["status_code"]);
  });

  it("is catchable as the base class and JSON-serializable", () => {
    const exc = new APIError("x", { statusCode: 500, responseBody: "text" });
    expect(exc).toBeInstanceOf(MixpanelHeadlessError);
    expect(() => JSON.stringify(exc.toDict())).not.toThrow();
  });
});

describe("config errors", () => {
  it("ConfigError has code CONFIG_ERROR", () => {
    const exc = new ConfigError("bad config");
    expect(exc.code).toBe("CONFIG_ERROR");
    expect(exc).toBeInstanceOf(MixpanelHeadlessError);
  });

  it("AccountNotFoundError carries name + available accounts", () => {
    const exc = new AccountNotFoundError("missing", ["prod", "dev"]);
    expect(exc.code).toBe("ACCOUNT_NOT_FOUND");
    expect(exc.accountName).toBe("missing");
    expect(exc.availableAccounts).toEqual(["prod", "dev"]);
    expect(exc.details).toEqual({
      account_name: "missing",
      available_accounts: ["prod", "dev"],
    });
    expect(exc).toBeInstanceOf(ConfigError);
  });

  it("AccountNotFoundError with no available accounts", () => {
    const exc = new AccountNotFoundError("missing");
    expect(exc.code).toBe("ACCOUNT_NOT_FOUND");
    expect(exc.availableAccounts).toEqual([]);
    expect(exc.details["available_accounts"]).toEqual([]);
  });

  it("ProjectNotFoundError carries id + available projects", () => {
    const exc = new ProjectNotFoundError("123", ["456", "789"]);
    expect(exc.code).toBe("PROJECT_NOT_FOUND");
    expect(exc.projectId).toBe("123");
    expect(exc.availableProjects).toEqual(["456", "789"]);
    expect(exc.details).toEqual({
      project_id: "123",
      available_projects: ["456", "789"],
    });
    expect(exc).toBeInstanceOf(ConfigError);
  });

  it("AccountExistsError carries the conflicting name", () => {
    const exc = new AccountExistsError("dupe");
    expect(exc.code).toBe("ACCOUNT_EXISTS");
    expect(exc.accountName).toBe("dupe");
    expect(exc.details).toEqual({ account_name: "dupe" });
    expect(exc).toBeInstanceOf(ConfigError);
  });

  it("InvalidArgumentError carries violation + detected auth type", () => {
    const exc = new InvalidArgumentError("bad flags", {
      violation: "mutually_exclusive",
      detectedAuthType: "service_account",
    });
    expect(exc.code).toBe("INVALID_ARGUMENT");
    expect(exc.violation).toBe("mutually_exclusive");
    expect(exc.detectedAuthType).toBe("service_account");
    expect(exc.details).toEqual({
      violation: "mutually_exclusive",
      detected_auth_type: "service_account",
    });
    expect(exc).toBeInstanceOf(ConfigError);
  });

  it("InvalidArgumentError omits detected_auth_type when absent (R4.11)", () => {
    const exc = new InvalidArgumentError("bad flags", {
      violation: "no_browser_misuse",
    });
    expect(exc.detectedAuthType).toBeNull();
    expect(Object.keys(exc.details)).toEqual(["violation"]);
  });

  it("InvalidArgumentError rejects an unknown violation", () => {
    expect(
      () =>
        new InvalidArgumentError("bad", {
          // Runtime guard parity: Python raises on unknown discriminators.
          violation: "nonsense" as never,
        }),
    ).toThrow(ParamValidationError);
  });

  it("AccountInUseError carries referencing targets", () => {
    const exc = new AccountInUseError("team", ["ecom", "growth"]);
    expect(exc.code).toBe("ACCOUNT_IN_USE");
    expect(exc.accountName).toBe("team");
    expect(exc.referencedBy).toEqual(["ecom", "growth"]);
    expect(exc.details).toEqual({
      account_name: "team",
      referenced_by: ["ecom", "growth"],
    });
    expect(new AccountInUseError("solo").referencedBy).toEqual([]);
  });
});

describe("API error subclasses", () => {
  it("AuthenticationError defaults (401, AUTH_FAILED, default message ok)", () => {
    const exc = new AuthenticationError();
    expect(exc.code).toBe("AUTH_FAILED");
    expect(exc.statusCode).toBe(401);
    expect(exc).toBeInstanceOf(APIError);
  });

  it("AuthenticationError carries request body context", () => {
    const exc = new AuthenticationError("no", {
      requestBody: { name: "x" },
      requestMethod: "PATCH",
    });
    expect(exc.requestBody).toEqual({ name: "x" });
    expect(exc.details["request_body"]).toEqual({ name: "x" });
  });

  it("RateLimitError with retry_after", () => {
    const exc = new RateLimitError("Rate limit exceeded", { retryAfter: 60 });
    expect(exc.code).toBe("RATE_LIMITED");
    expect(exc.statusCode).toBe(429);
    expect(exc.retryAfter).toBe(60);
    expect(exc.details["retry_after"]).toBe(60);
    expect(exc).toBeInstanceOf(APIError);
  });

  it("RateLimitError without retry_after leaves the key absent", () => {
    const exc = new RateLimitError();
    expect(exc.retryAfter).toBeNull();
    expect(Object.hasOwn(exc.details, "retry_after")).toBe(false);
  });

  it("RateLimitError carries project_id when known", () => {
    const exc = new RateLimitError("x", { projectId: "3018488" });
    expect(exc.projectId).toBe("3018488");
    expect(exc.details["project_id"]).toBe("3018488");
  });

  it("RateLimitError omits project_id when unknown", () => {
    const exc = new RateLimitError("x");
    expect(exc.projectId).toBeNull();
    expect(Object.hasOwn(exc.details, "project_id")).toBe(false);
  });

  it("rate-limit form URL is prefilled with the project id", () => {
    const exc = new RateLimitError("x", { projectId: "3018488" });
    expect(exc.rateLimitFormUrl).toBe(
      "https://docs.google.com/forms/d/e/" +
        "1FAIpQLSe8h0ZpB-V3zoK9qeUnUeh7vCs2lvP1IJ6IYMAiayHJ4g5LQA/viewform" +
        "?usp=pp_url&entry.1636741534=3018488",
    );
  });

  it("rate-limit form URL falls back to the short link", () => {
    const exc = new RateLimitError("x");
    expect(exc.rateLimitFormUrl).toBe("https://forms.gle/7Y9UcUHe69bh8EgC7");
  });

  it("QueryError defaults (400, QUERY_FAILED)", () => {
    const exc = new QueryError();
    expect(exc.code).toBe("QUERY_FAILED");
    expect(exc.statusCode).toBe(400);
    expect(exc).toBeInstanceOf(APIError);
  });

  it("ServerError defaults (500, SERVER_ERROR)", () => {
    const exc = new ServerError("boom", { statusCode: 503 });
    expect(exc.code).toBe("SERVER_ERROR");
    expect(exc.statusCode).toBe(503);
    expect(new ServerError().statusCode).toBe(500);
    expect(exc).toBeInstanceOf(APIError);
  });

  it("all API errors are catchable as APIError (translated catch-all)", () => {
    const errors: APIError[] = [
      new AuthenticationError("test"),
      new RateLimitError("test"),
      new QueryError("test"),
      new ServerError("test", { statusCode: 500 }),
    ];
    for (const error of errors) {
      expect(error).toBeInstanceOf(APIError);
      expect(error).toBeInstanceOf(MixpanelHeadlessError);
    }
  });
});

describe("EventNotFoundError", () => {
  it("carries the event name and similar events", () => {
    const exc = new EventNotFoundError("sign up", ["Sign Up", "signup"]);
    expect(exc.code).toBe("EVENT_NOT_FOUND");
    expect(exc.eventName).toBe("sign up");
    expect(exc.similarEvents).toEqual(["Sign Up", "signup"]);
    expect(exc.toDict().details).toEqual({
      event_name: "sign up",
      similar_events: ["Sign Up", "signup"],
    });
    expect(exc).toBeInstanceOf(MixpanelHeadlessError);
    expect(exc).not.toBeInstanceOf(APIError);
  });

  it("details keep the FULL similar list (message truncation is display-only)", () => {
    const seven = ["a", "b", "c", "d", "e", "f", "g"];
    const exc = new EventNotFoundError("x", seven);
    expect(exc.similarEvents).toEqual(seven);
    expect(exc.details["similar_events"]).toEqual(seven);
  });
});

describe("DateRangeTooLargeError", () => {
  it("carries the full date-range context", () => {
    const exc = new DateRangeTooLargeError("2024-01-01", "2024-06-30", 182);
    expect(exc.code).toBe("DATE_RANGE_TOO_LARGE");
    expect(exc.fromDate).toBe("2024-01-01");
    expect(exc.toDate).toBe("2024-06-30");
    expect(exc.daysRequested).toBe(182);
    expect(exc.maxDays).toBe(100);
    expect(exc.toDict().details).toEqual({
      from_date: "2024-01-01",
      to_date: "2024-06-30",
      days_requested: 182,
      max_days: 100,
    });
    expect(exc).toBeInstanceOf(MixpanelHeadlessError);
  });

  it("supports a custom max_days", () => {
    const exc = new DateRangeTooLargeError("2024-01-01", "2024-01-31", 31, 30);
    expect(exc.maxDays).toBe(30);
    expect(exc.details["max_days"]).toBe(30);
  });
});

describe("OAuth errors", () => {
  it("OAuthError defaults to OAUTH_TOKEN_ERROR", () => {
    const exc = new OAuthError("token exchange failed");
    expect(exc.code).toBe("OAUTH_TOKEN_ERROR");
    expect(exc).toBeInstanceOf(MixpanelHeadlessError);
    expect(new OAuthError("t", "OAUTH_TIMEOUT").code).toBe("OAUTH_TIMEOUT");
  });

  it("RegionProbeError carries attempts in details and top-level toDict", () => {
    const attempts = [
      ["us", 401, "unauthorized"],
      ["eu", 401, "unauthorized"],
      ["in", 0, "dns failure"],
    ] as const;
    const exc = new RegionProbeError("no region accepted", { attempts });
    expect(exc.code).toBe("OAUTH_REGION_PROBE_FAILED");
    expect(exc.attempts).toEqual([
      ["us", 401, "unauthorized"],
      ["eu", 401, "unauthorized"],
      ["in", 0, "dns failure"],
    ]);
    const d = exc.toDict();
    expect(Object.keys(d)).toEqual(["code", "message", "details", "attempts"]);
    expect(d.attempts).toEqual([
      ["us", 401, "unauthorized"],
      ["eu", 401, "unauthorized"],
      ["in", 0, "dns failure"],
    ]);
    expect(exc.details["attempts"]).toEqual(d.attempts);
    expect(exc).toBeInstanceOf(OAuthError);
  });

  it("RegionProbeError attempts getter returns a fresh copy each call", () => {
    const exc = new RegionProbeError("x", { attempts: [["us", 0, "net"]] });
    expect(exc.attempts).not.toBe(exc.attempts);
  });

  it("RegionProbeNetworkError uses OAUTH_NETWORK_UNREACHABLE and chains", () => {
    const exc = new RegionProbeNetworkError("offline", {
      attempts: [
        ["us", 0, "dns"],
        ["eu", 0, "dns"],
        ["in", 0, "dns"],
      ],
    });
    expect(exc.code).toBe("OAUTH_NETWORK_UNREACHABLE");
    expect(exc).toBeInstanceOf(RegionProbeError);
    expect(exc).toBeInstanceOf(OAuthError);
    expect(exc.attempts).toHaveLength(3);
  });
});

describe("WorkspaceScopeError / BusinessContextValidationError", () => {
  it("WorkspaceScopeError defaults to NO_WORKSPACES", () => {
    const exc = new WorkspaceScopeError("no workspaces");
    expect(exc.code).toBe("NO_WORKSPACES");
    expect(
      new WorkspaceScopeError("m", "AMBIGUOUS_WORKSPACE", { n: 2 }).code,
    ).toBe("AMBIGUOUS_WORKSPACE");
    expect(exc).toBeInstanceOf(MixpanelHeadlessError);
  });

  it("BusinessContextValidationError carries length/max details", () => {
    const exc = new BusinessContextValidationError("too long", {
      length: 60000,
      max: 50000,
    });
    expect(exc.code).toBe("BUSINESS_CONTEXT_TOO_LONG");
    expect(exc.details).toEqual({ length: 60000, max: 50000 });
  });
});

describe("ValidationError (plain class, not an exception)", () => {
  it("is NOT an Error subclass", () => {
    const err = new ValidationError("path", "msg");
    expect(err).not.toBeInstanceOf(Error);
  });

  it("defaults: code VALIDATION_ERROR, severity error, null suggestion/fix", () => {
    const err = new ValidationError("sections.show[0]", "bad");
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.severity).toBe("error");
    expect(err.suggestion).toBeNull();
    expect(err.fix).toBeNull();
  });

  it("toDict always emits {path, message, code, severity} in order", () => {
    const err = new ValidationError("p", "m", "C", "warning");
    expect(Object.keys(err.toDict())).toEqual([
      "path",
      "message",
      "code",
      "severity",
    ]);
    expect(err.toDict()).toEqual({
      path: "p",
      message: "m",
      code: "C",
      severity: "warning",
    });
  });

  it("toDict conditionally adds suggestion (as array) and fix", () => {
    const err = new ValidationError(
      "sections.show[0].measurement.math",
      "Invalid math type 'totl'",
      "INVALID_MATH_TYPE",
      "error",
      ["total"],
      { math: "total" },
    );
    const d = err.toDict();
    expect(Object.keys(d)).toEqual([
      "path",
      "message",
      "code",
      "severity",
      "suggestion",
      "fix",
    ]);
    expect(d["suggestion"]).toEqual(["total"]);
    expect(d["fix"]).toEqual({ math: "total" });
  });

  it("toString formats severity prefix and first suggestion", () => {
    expect(String(new ValidationError("p", "m"))).toBe("[ERROR] p: m");
    expect(String(new ValidationError("p", "m", "C", "warning"))).toBe(
      "[WARNING] p: m",
    );
    expect(String(new ValidationError("p", "m", "C", "error", ["total"]))).toBe(
      "[ERROR] p: m Did you mean 'total'?",
    );
    // Python truthiness: an EMPTY suggestion tuple adds no suffix.
    expect(String(new ValidationError("p", "m", "C", "error", []))).toBe(
      "[ERROR] p: m",
    );
  });
});

describe("BookmarkValidationError", () => {
  const errors = [
    new ValidationError("a", "bad a"),
    new ValidationError("b", "warn b", "W", "warning"),
    new ValidationError("c", "bad c", "C", "error", ["fix-c"]),
  ];

  it("counts errors and warnings", () => {
    const exc = new BookmarkValidationError(errors);
    expect(exc.code).toBe("BOOKMARK_VALIDATION_ERROR");
    expect(exc.errorCount).toBe(2);
    expect(exc.warningCount).toBe(1);
    expect(exc.errors).toHaveLength(3);
    expect(exc).toBeInstanceOf(MixpanelHeadlessError);
  });

  it("details carry counts and serialized errors", () => {
    const exc = new BookmarkValidationError(errors);
    expect(exc.details["error_count"]).toBe(2);
    expect(exc.details["warning_count"]).toBe(1);
    expect(exc.details["errors"]).toEqual(errors.map((e) => e.toDict()));
    expect(() => JSON.stringify(exc.toDict())).not.toThrow();
  });
});

describe("session-replay errors", () => {
  it("SessionReplayError defaults (500, SESSION_REPLAY_ERROR)", () => {
    const exc = new SessionReplayError("replay failed");
    expect(exc.code).toBe("SESSION_REPLAY_ERROR");
    expect(exc.statusCode).toBe(500);
    expect(exc).toBeInstanceOf(APIError);
  });

  it("merges replay details on top of HTTP context", () => {
    const exc = new SessionReplayAccessError("denied", {
      details: {
        project_id: 3018488,
        flag: "SESSION_RECORDING_SENSITIVE_DATA",
        permission_required: "sensitive_data_replay",
      },
      responseBody: "forbidden",
    });
    expect(exc.details).toEqual({
      status_code: 403,
      response_body: "forbidden",
      project_id: 3018488,
      flag: "SESSION_RECORDING_SENSITIVE_DATA",
      permission_required: "sensitive_data_replay",
    });
  });

  it("subclass defaults: access 403, expiry 403, not-found 404, format 501", () => {
    const access = new SessionReplayAccessError("x");
    expect(access.code).toBe("SESSION_REPLAY_ACCESS_ERROR");
    expect(access.statusCode).toBe(403);

    const expired = new SignedURLExpiredError("x", {
      details: { replay_id: "r-1", signed_at: 100, expired_at: 400 },
    });
    expect(expired.code).toBe("SIGNED_URL_EXPIRED");
    expect(expired.statusCode).toBe(403);
    expect(expired.details["replay_id"]).toBe("r-1");

    const missing = new ReplayNotFoundError("x", {
      details: { replay_id: "r-2", retention_days: 30, cdn_url_prefix: "p/" },
    });
    expect(missing.code).toBe("REPLAY_NOT_FOUND");
    expect(missing.statusCode).toBe(404);

    const unsupported = new UnsupportedReplayFormatError("x", {
      details: { replay_id: "r-3", format: "non-rrweb" },
    });
    expect(unsupported.code).toBe("UNSUPPORTED_REPLAY_FORMAT");
    expect(unsupported.statusCode).toBe(501);
  });

  it("explicit statusCode/code override the class defaults", () => {
    const exc = new ReplayNotFoundError("x", { statusCode: 410 });
    expect(exc.statusCode).toBe(410);
    expect(exc.code).toBe("REPLAY_NOT_FOUND");
  });

  it("every subclass is catchable as SessionReplayError and APIError", () => {
    const all = [
      new SessionReplayAccessError("a"),
      new SignedURLExpiredError("b"),
      new ReplayNotFoundError("c"),
      new UnsupportedReplayFormatError("d"),
    ];
    for (const exc of all) {
      expect(exc).toBeInstanceOf(SessionReplayError);
      expect(exc).toBeInstanceOf(APIError);
      expect(exc).toBeInstanceOf(MixpanelHeadlessError);
    }
  });

  it("toDict round-trips through JSON", () => {
    const exc = new SignedURLExpiredError("expired", {
      details: {
        replay_id: "r-1",
        signed_at: 1700000000,
        expired_at: 1700000300,
      },
      requestUrl: "https://cdn/replay",
    });
    const parsed = JSON.parse(JSON.stringify(exc.toDict())) as {
      code: string;
      details: Record<string, unknown>;
    };
    expect(parsed.code).toBe("SIGNED_URL_EXPIRED");
    expect(parsed.details["replay_id"]).toBe("r-1");
    expect(parsed.details["request_url"]).toBe("https://cdn/replay");
  });
});

describe("class-name correctness (name === constructor.name)", () => {
  it("every instance reports its own class name", () => {
    const samples: [Error, string][] = [
      [new MixpanelHeadlessError("m"), "MixpanelHeadlessError"],
      [new AuthenticationError(), "AuthenticationError"],
      [
        new RegionProbeNetworkError("m", { attempts: [] }),
        "RegionProbeNetworkError",
      ],
      [new UnsupportedReplayFormatError("m"), "UnsupportedReplayFormatError"],
      [
        new BookmarkValidationError([new ValidationError("p", "m")]),
        "BookmarkValidationError",
      ],
    ];
    for (const [exc, name] of samples) {
      expect(exc.name).toBe(name);
    }
  });
});
