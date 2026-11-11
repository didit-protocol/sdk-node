// The issuer's token, session and step-up endpoints, errors, timeouts and
// logging (docs/DESIGN.md sections 7 and 10), against a stubbed issuer.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Authentication,
  AuthenticationSession,
  StepUp,
  StepUpNotRequired,
  TokenResponse,
} from "../../src/authentication/index.js";
import {
  APIConnectionError,
  APIResponseValidationError,
  APIStatusError,
  APITimeoutError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
} from "../../src/core/errors.js";
import { VERSION } from "../../src/core/version.js";
import {
  ACCESS_TOKEN,
  APPLICATION_ID,
  CODE,
  CODE_VERIFIER,
  DISCOVERY,
  FakeIssuer,
  IDENTITY_ID,
  ISSUER,
  REDIRECT_URI,
  REFRESH_TOKEN,
  SESSION_ID,
  STEP_UP_ID,
  SigningKey,
  accessClaims,
  formOf,
  freezeClock,
  json,
  rejection,
  synthetic,
} from "./helpers.js";

const ISSUED_ACCESS_TOKEN = synthetic("issued-access-jwt");
const ISSUED_ID_TOKEN = synthetic("issued-id-jwt");
const ISSUED_REFRESH_TOKEN = synthetic("issued-refresh");

const TOKEN_RESPONSE = {
  access_token: ISSUED_ACCESS_TOKEN,
  id_token: ISSUED_ID_TOKEN,
  refresh_token: ISSUED_REFRESH_TOKEN,
  token_type: "Bearer",
  expires_in: 300,
  session_id: SESSION_ID,
};

const SESSION_RESPONSE = {
  sub: IDENTITY_ID,
  sid: SESSION_ID,
  application_id: APPLICATION_ID,
  vendor_data: "user-42",
  amr: ["passkey"],
  mfa_verified: true,
  email: "person@example.com",
  email_verified: true,
  phone: null,
  verified_identity: null,
  verified: { level: "liveness", liveness: true },
  expires_at: "2027-01-15T10:00:00Z",
  post_logout_redirect_uri: "https://app.example.com/signed-out",
  organizations: [
    {
      organization_id: "6f1c2d3e-0000-4000-8000-00000000e001",
      organization__name: "Acme Treasury",
      role: "admin",
      custom_role: { key: "approver", permissions: ["payouts:approve"] },
    },
  ],
  future_field: { kept: true },
};

const STEP_UP_REQUIRED = {
  id: STEP_UP_ID,
  rule: "payout",
  method: "selfie",
  status: "pending",
  level: null,
  amount: "1500.00",
  currency: "EUR",
  created_at: "2027-01-15T10:00:00Z",
  completed_at: null,
  expires_at: "2027-01-15T10:30:00Z",
  required: true,
  verification_url: `${ISSUER}/verify/?verification=synthetic-proof`,
  expires_in: 1800,
};

let issuer: FakeIssuer;
let auth: Authentication;

beforeEach(() => {
  issuer = new FakeIssuer([]);
  auth = issuer.client();
});

afterEach(() => {
  vi.useRealTimers();
});

function expectIssuerHeaders(headers: Headers): void {
  expect(headers.get("accept")).toBe("application/json");
  expect(headers.get("user-agent")).toMatch(new RegExp(`^didit-node/${VERSION} \\(`));
  expect(headers.get("x-didit-client")).toBe(`node/${VERSION}`);
  expect(headers.has("x-api-key")).toBe(false);
}

describe("exchangeCode", () => {
  it("posts the form to the discovered token endpoint", async () => {
    issuer.reply("POST", "/token/", 200, TOKEN_RESPONSE);
    const tokens: TokenResponse = await auth.exchangeCode({
      code: CODE,
      codeVerifier: CODE_VERIFIER,
      redirectUri: REDIRECT_URI,
    });
    expect(tokens).toEqual(TOKEN_RESPONSE);
    expect(issuer.requests.map((r) => [r.method, r.url.pathname])).toEqual([
      ["GET", DISCOVERY],
      ["POST", "/token/"],
    ]);
    const request = issuer.last("/token/");
    expect(request.url.toString()).toBe(`${ISSUER}/token/`);
    expect(request.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expectIssuerHeaders(request.headers);
    expect(request.headers.has("authorization")).toBe(false);
    expect(request.init.redirect).toBe("manual");
    expect(formOf(request)).toEqual({
      grant_type: "authorization_code",
      code: CODE,
      code_verifier: CODE_VERIFIER,
      redirect_uri: REDIRECT_URI,
    });
  });

  it("form-encodes reserved characters", async () => {
    issuer.reply("POST", "/token/", 200, TOKEN_RESPONSE);
    const redirectUri = "https://app.example.com/callback?next=/a b&x=1";
    await auth.exchangeCode({ code: "a+b/c=", codeVerifier: CODE_VERIFIER, redirectUri });
    const request = issuer.last("/token/");
    expect(request.body).toContain("code=a%2Bb%2Fc%3D");
    expect(request.body).toContain(
      "redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback%3Fnext%3D%2Fa+b%26x%3D1",
    );
    expect(formOf(request).redirect_uri).toBe(redirectUri);
  });

  it("sends client_id when configured, and fetches discovery once", async () => {
    issuer.reply("POST", "/token/", 200, TOKEN_RESPONSE);
    const configured = issuer.client({ clientId: ` ${APPLICATION_ID} ` });
    await configured.exchangeCode({
      code: CODE,
      codeVerifier: CODE_VERIFIER,
      redirectUri: REDIRECT_URI,
    });
    expect(formOf(issuer.last("/token/")).client_id).toBe(APPLICATION_ID);
    await configured.refresh(REFRESH_TOKEN);
    expect(formOf(issuer.last("/token/"))).toEqual({
      grant_type: "refresh_token",
      refresh_token: REFRESH_TOKEN,
      client_id: APPLICATION_ID,
    });
    expect(issuer.count(DISCOVERY)).toBe(1);
  });

  it("refuses empty arguments before any request", async () => {
    const cases: [unknown, RegExp][] = [
      [{ code: "", codeVerifier: CODE_VERIFIER, redirectUri: REDIRECT_URI }, /^code is empty/],
      [{ code: CODE, codeVerifier: " ", redirectUri: REDIRECT_URI }, /^codeVerifier is empty/],
      [{ code: CODE, codeVerifier: CODE_VERIFIER, redirectUri: null }, /^redirectUri is empty/],
      [{ code: CODE, codeVerifier: CODE_VERIFIER }, /^redirectUri is empty/],
      [undefined, /^code is empty/],
    ];
    for (const [params, message] of cases) {
      const error = await rejection(auth.exchangeCode(params as never));
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toMatch(message);
    }
    expect(issuer.requests).toEqual([]);
  });

  it.each([
    ["invalid_grant", { error: "invalid_grant" }, "HTTP 400: invalid_grant"],
    [
      "invalid_grant with a description",
      { error: "invalid_grant", error_description: "The code was already used." },
      "HTTP 400: invalid_grant: The code was already used.",
    ],
    ["mfa_required", { error: "mfa_required" }, "HTTP 400: mfa_required"],
  ])("maps a 400 %s to BadRequestError with a useful message", async (_name, body, message) => {
    issuer.reply("POST", "/token/", 400, body);
    const error = await rejection(
      auth.exchangeCode({ code: CODE, codeVerifier: CODE_VERIFIER, redirectUri: REDIRECT_URI }),
    );
    expect(error).toBeInstanceOf(BadRequestError);
    expect((error as BadRequestError).status).toBe(400);
    expect((error as BadRequestError).body).toEqual(body);
    expect((error as BadRequestError).requestId).toBe("req_synthetic");
    expect(error.message).toBe(`${message} (request id req_synthetic)`);
    expect(error.message).not.toContain(CODE);
    expect(error.message).not.toContain(CODE_VERIFIER);
    expect(issuer.count("/token/")).toBe(1);
  });

  it("redacts an echoed code and verifier from the message and the body", async () => {
    issuer.reply("POST", "/token/", 400, { detail: `${CODE} / ${CODE_VERIFIER}` });
    const error = await rejection(
      auth.exchangeCode({ code: CODE, codeVerifier: CODE_VERIFIER, redirectUri: REDIRECT_URI }),
    );
    expect(error.message).toBe("HTTP 400: [redacted] / [redacted] (request id req_synthetic)");
    expect(JSON.stringify((error as BadRequestError).body)).not.toContain(CODE);
  });
});

describe("refresh", () => {
  it("posts the refresh token form and returns the new tokens", async () => {
    issuer.reply("POST", "/token/", 200, TOKEN_RESPONSE);
    const tokens = await auth.refresh(REFRESH_TOKEN);
    expect(tokens.refresh_token).toBe(ISSUED_REFRESH_TOKEN);
    const request = issuer.last("/token/");
    expect(request.method).toBe("POST");
    expect(request.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(formOf(request)).toEqual({ grant_type: "refresh_token", refresh_token: REFRESH_TOKEN });
    expect(request.headers.has("authorization")).toBe(false);
  });

  it("uses the discovered token endpoint", async () => {
    issuer.discovery!.token_endpoint = `${ISSUER}/oauth/token/`;
    issuer.reply("POST", "/oauth/token/", 200, TOKEN_RESPONSE);
    await auth.refresh(REFRESH_TOKEN);
    expect(issuer.paths()).toEqual([DISCOVERY, "/oauth/token/"]);
  });

  it("refuses an empty refresh token", async () => {
    const error = await rejection(auth.refresh(""));
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/refreshToken/);
    expect(issuer.requests).toEqual([]);
  });

  it.each([
    [400, { error: "invalid_grant" }, BadRequestError, "HTTP 400: invalid_grant"],
    [
      400,
      { error: "invalid_grant", error_description: "The refresh token was already used." },
      BadRequestError,
      "HTTP 400: invalid_grant: The refresh token was already used.",
    ],
    [
      400,
      { non_field_errors: ["invalid_request"] },
      BadRequestError,
      "HTTP 400: non_field_errors: invalid_request",
    ],
    [401, { detail: "invalid_token" }, AuthenticationError, "HTTP 401: invalid_token"],
    [403, { detail: "origin_not_allowed" }, PermissionDeniedError, "HTTP 403: origin_not_allowed"],
    [404, { detail: "Not found." }, NotFoundError, "HTTP 404: Not found."],
    [409, { detail: "conflict" }, ConflictError, "HTTP 409: conflict"],
    [422, { detail: "unprocessable" }, UnprocessableEntityError, "HTTP 422: unprocessable"],
    [429, { detail: "Too many requests." }, RateLimitError, "HTTP 429: Too many requests."],
    [500, undefined, InternalServerError, "HTTP 500"],
    [503, { detail: "unavailable" }, InternalServerError, "HTTP 503: unavailable"],
    [418, { detail: "teapot" }, APIStatusError, "HTTP 418: teapot"],
    [302, undefined, APIStatusError, "HTTP 302"],
  ])(
    "maps HTTP %i to its error class and never retries",
    async (status, body, ErrorClass, message) => {
      issuer.reply("POST", "/token/", status, body);
      const error = await rejection(auth.refresh(REFRESH_TOKEN));
      expect(error.constructor).toBe(ErrorClass);
      expect((error as APIStatusError).status).toBe(status);
      expect((error as APIStatusError).body).toEqual(body ?? null);
      expect(error.message.startsWith(message)).toBe(true);
      expect(error.message).not.toContain(REFRESH_TOKEN);
      expect(issuer.count("/token/")).toBe(1);
    },
  );

  it("redacts an echoed refresh token", async () => {
    issuer.reply("POST", "/token/", 400, { detail: `bad token ${REFRESH_TOKEN}` });
    const error = await rejection(auth.refresh(REFRESH_TOKEN));
    expect(error.message).toBe("HTTP 400: bad token [redacted] (request id req_synthetic)");
  });

  it("does not follow a redirect to another origin", async () => {
    issuer.route(
      "POST",
      "/token/",
      () =>
        new Response(null, { status: 307, headers: { location: "https://evil.example/token/" } }),
    );
    const error = await rejection(auth.refresh(REFRESH_TOKEN));
    expect(error).toBeInstanceOf(APIStatusError);
    expect((error as APIStatusError).status).toBe(307);
    expect(issuer.requests.every((request) => request.url.origin === ISSUER)).toBe(true);
    expect(issuer.last("/token/").init.redirect).toBe("manual");
  });

  it("keeps a non-JSON error body as text", async () => {
    issuer.route("POST", "/token/", () => new Response("Bad Gateway", { status: 502 }));
    const error = await rejection(auth.refresh(REFRESH_TOKEN));
    expect(error).toBeInstanceOf(InternalServerError);
    expect((error as InternalServerError).body).toBe("Bad Gateway");
  });
});

describe("getSession and revokeSession", () => {
  it("reads the session with the bearer token, without discovery", async () => {
    issuer.reply("GET", "/session/", 200, SESSION_RESPONSE);
    const session: AuthenticationSession = await auth.getSession(ACCESS_TOKEN);
    expect(session).toEqual(SESSION_RESPONSE);
    expect(session.organizations?.[0]?.organization__name).toBe("Acme Treasury");
    expect(session.future_field).toEqual({ kept: true });
    const request = issuer.last("/session/");
    expect([request.method, request.url.toString()]).toEqual(["GET", `${ISSUER}/session/`]);
    expect(request.headers.get("authorization")).toBe(`Bearer ${ACCESS_TOKEN}`);
    expectIssuerHeaders(request.headers);
    expect(request.body).toBeNull();
    expect(issuer.count(DISCOVERY)).toBe(0);
  });

  it("revokes the session with DELETE", async () => {
    issuer.reply("DELETE", "/session/", 204);
    await expect(auth.revokeSession(ACCESS_TOKEN)).resolves.toBeUndefined();
    const request = issuer.last("/session/");
    expect(request.method).toBe("DELETE");
    expect(request.headers.get("authorization")).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  it("does not retry DELETE session/ or GET session/", async () => {
    issuer.reply("DELETE", "/session/", 503, { detail: "unavailable" });
    expect(await rejection(auth.revokeSession(ACCESS_TOKEN))).toBeInstanceOf(InternalServerError);
    issuer.reply("GET", "/session/", 503, { detail: "unavailable" });
    expect(await rejection(auth.getSession(ACCESS_TOKEN))).toBeInstanceOf(InternalServerError);
    expect(issuer.count("/session/")).toBe(2);
  });

  it("maps a revoked session to AuthenticationError without the token", async () => {
    issuer.reply("GET", "/session/", 401, { detail: `${ACCESS_TOKEN} is not valid` });
    const error = await rejection(auth.getSession(ACCESS_TOKEN));
    expect(error).toBeInstanceOf(AuthenticationError);
    expect(error.message).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify((error as AuthenticationError).body)).not.toContain(ACCESS_TOKEN);
  });

  it("refuses an empty token or one that cannot be a header, without echoing it", async () => {
    for (const bad of ["", "  ", "abc\ndef", "tökén", undefined] as unknown[]) {
      const error = await rejection(auth.getSession(bad as string));
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toMatch(/^accessToken /);
      if (typeof bad === "string" && bad) expect(error.message).not.toContain(bad);
    }
    expect(await rejection(auth.revokeSession(""))).toBeInstanceOf(TypeError);
    expect(issuer.requests).toEqual([]);
  });

  it.each([
    [
      "HTML",
      () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }),
      "got text/html",
    ],
    [
      "a JSON array",
      () => json(200, ["not", "an", "object"]),
      "Expected a JSON object from GET /session/.",
    ],
    [
      "no content",
      () => new Response(null, { status: 204 }),
      "Expected a JSON object from GET /session/.",
    ],
    ["no content type", () => new Response("not json", { status: 200, headers: {} }), "/session/"],
  ])("treats %s on success as a response validation error", async (_name, respond, message) => {
    issuer.route("GET", "/session/", respond);
    const error = await rejection(auth.getSession(ACCESS_TOKEN));
    expect(error).toBeInstanceOf(APIResponseValidationError);
    expect(error.message).toContain(message);
    expect(error.message).not.toContain(ACCESS_TOKEN);
  });
});

describe("createStepUp and retrieveStepUp", () => {
  it("returns the step-up the issuer created (201)", async () => {
    issuer.reply("POST", "/step-up/", 201, STEP_UP_REQUIRED);
    const result = await auth.createStepUp(ACCESS_TOKEN, {
      action: "payout",
      amount: "1500.00",
      currency: "EUR",
      returnTo: "https://app.example.com/payouts",
    });
    expect(result).toEqual(STEP_UP_REQUIRED);
    if (result.required === false) throw new Error("expected a step-up");
    const stepUp: StepUp = result;
    expect([stepUp.id, stepUp.status, stepUp.verification_url, stepUp.expires_in]).toEqual([
      STEP_UP_ID,
      "pending",
      `${ISSUER}/verify/?verification=synthetic-proof`,
      1800,
    ]);
    const request = issuer.last("/step-up/");
    expect([request.method, request.url.toString()]).toEqual(["POST", `${ISSUER}/step-up/`]);
    expect(request.headers.get("authorization")).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(request.headers.get("content-type")).toBe("application/json");
    expectIssuerHeaders(request.headers);
    expect(JSON.parse(request.body!)).toEqual({
      action: "payout",
      amount: "1500.00",
      currency: "EUR",
      return_to: "https://app.example.com/payouts",
    });
    expect(issuer.count(DISCOVERY)).toBe(0);
  });

  it("returns { required: false } when no rule applies (200)", async () => {
    issuer.reply("POST", "/step-up/", 200, { required: false });
    const result = await auth.createStepUp(ACCESS_TOKEN, {
      action: "contact",
      returnTo: "https://app.example.com/profile",
    });
    expect(result).toEqual({ required: false });
    const notRequired: StepUpNotRequired | StepUp = result;
    expect(notRequired.required).toBe(false);
    expect(JSON.parse(issuer.last("/step-up/").body!)).toEqual({
      action: "contact",
      return_to: "https://app.example.com/profile",
    });
    await auth.createStepUp(ACCESS_TOKEN, {
      action: "bank",
      currency: undefined,
      returnTo: undefined,
    });
    expect(JSON.parse(issuer.last("/step-up/").body!)).toEqual({ action: "bank" });
  });

  it("surfaces the 400 the issuer answers without returnTo", async () => {
    issuer.reply("POST", "/step-up/", 400, { return_to: ["This field is required."] });
    const error = await rejection(auth.createStepUp(ACCESS_TOKEN, { action: "bank" }));
    expect(error).toBeInstanceOf(BadRequestError);
    expect(error.message).toContain("return_to: This field is required.");
    expect(issuer.count("/step-up/")).toBe(1);
  });

  it.each([
    ["1500.00", "1500.00"],
    [" 12.30 ", "12.30"],
    ["-5", "-5"],
    [1500, "1500"],
    [1500.5, "1500.5"],
    [0.1, "0.1"],
    [1e-7, "0.0000001"],
    [1.5e-7, "0.00000015"],
    [1e21, "1000000000000000000000"],
    [1.25e22, "12500000000000000000000"],
    [-2.5e-7, "-0.00000025"],
  ])("sends amount %o as the decimal string %s", async (amount, sent) => {
    issuer.reply("POST", "/step-up/", 200, { required: false });
    await auth.createStepUp(ACCESS_TOKEN, { action: "payout", amount, returnTo: REDIRECT_URI });
    expect(JSON.parse(issuer.last("/step-up/").body!).amount).toBe(sent);
  });

  it("refuses bad arguments before any request", async () => {
    const amounts = [
      Number.NaN,
      Infinity,
      "Infinity",
      "12,50",
      "",
      "1_000",
      "1e3",
      "١٠",
      "NaN",
      ".5",
      "5.",
      true,
      [1],
      {},
    ];
    for (const amount of amounts) {
      const error = await rejection(
        auth.createStepUp(ACCESS_TOKEN, { action: "payout", amount: amount as never }),
      );
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toMatch(/^amount /);
    }
    for (const params of [{ action: "" }, { action: 7 }, {}, undefined]) {
      const error = await rejection(auth.createStepUp(ACCESS_TOKEN, params as never));
      expect(error.message).toMatch(/^action is empty/);
    }
    for (const params of [
      { action: "bank", currency: 978 },
      { action: "bank", returnTo: {} },
    ]) {
      expect(await rejection(auth.createStepUp(ACCESS_TOKEN, params as never))).toBeInstanceOf(
        TypeError,
      );
    }
    expect(await rejection(auth.createStepUp("", { action: "bank" }))).toBeInstanceOf(TypeError);
    for (const id of ["", ".", "..", undefined] as unknown[]) {
      const error = await rejection(auth.retrieveStepUp(ACCESS_TOKEN, id as string));
      expect(error.message).toMatch(/^id must be a non-empty id/);
    }
    expect(issuer.requests).toEqual([]);
  });

  it.each([
    "approved",
    "pending",
    "review",
    "declined",
    "expired",
    "superseded",
    "some_future_status",
  ])("retrieves a step-up with status %s", async (status) => {
    const { required: _r, verification_url: _v, expires_in: _e, ...record } = STEP_UP_REQUIRED;
    const body = { ...record, status, level: status === "approved" ? "liveness_face_match" : null };
    issuer.reply("GET", `/step-up/${STEP_UP_ID}/`, 200, body);
    const stepUp = await auth.retrieveStepUp(ACCESS_TOKEN, STEP_UP_ID);
    expect(stepUp).toEqual(body);
    expect(stepUp.required).toBeUndefined();
    const request = issuer.last(`/step-up/${STEP_UP_ID}/`);
    expect(request.method).toBe("GET");
    expect(request.url.toString()).toBe(`${ISSUER}/step-up/${STEP_UP_ID}/`);
    expect(request.headers.get("authorization")).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  it("percent-encodes the step-up id", async () => {
    expect(await rejection(auth.retrieveStepUp(ACCESS_TOKEN, "a/b?c#d"))).toBeInstanceOf(
      NotFoundError,
    );
    expect(await rejection(auth.retrieveStepUp(ACCESS_TOKEN, "it's(*)!"))).toBeInstanceOf(
      NotFoundError,
    );
    const [first, second] = issuer.requests;
    expect(first!.url.pathname).toBe("/step-up/a%2Fb%3Fc%23d/");
    expect(first!.url.search).toBe("");
    expect(second!.url.pathname).toBe("/step-up/it%27s%28%2A%29%21/");
  });

  it("maps another session's step-up to NotFoundError", async () => {
    issuer.reply("GET", `/step-up/${STEP_UP_ID}/`, 404, { detail: "Not found." });
    expect(await rejection(auth.retrieveStepUp(ACCESS_TOKEN, STEP_UP_ID))).toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("submitAgentConsent and createAgentApprovalOptions", () => {
  const CHALLENGE = synthetic("agent-request-challenge");
  const ASSERTION = {
    id: "credential-id",
    rawId: "credential-raw-id",
    type: "public-key" as const,
    response: {
      clientDataJSON: synthetic("client-data"),
      authenticatorData: synthetic("authenticator-data"),
      signature: synthetic("signature"),
      userHandle: null,
    },
  };

  it("approves with an assertion and narrowed scopes (200)", async () => {
    const approved = { code: "agent-code", redirect_uri: "https://agent.example/cb", state: "st" };
    issuer.reply("POST", "/agents/consent/", 200, approved);
    const result = await auth.submitAgentConsent(ACCESS_TOKEN, {
      challenge: CHALLENGE,
      decision: "approve",
      assertion: ASSERTION,
      scopes: ["read"],
      organizationIds: [IDENTITY_ID],
      lifetime: 86400,
    });
    expect(result).toEqual(approved);
    expect("code" in result).toBe(true);
    const request = issuer.last("/agents/consent/");
    expect([request.method, request.url.toString()]).toEqual(["POST", `${ISSUER}/agents/consent/`]);
    expect(request.headers.get("authorization")).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(request.body!)).toEqual({
      challenge: CHALLENGE,
      decision: "approve",
      assertion: ASSERTION,
      scopes: ["read"],
      organization_ids: [IDENTITY_ID],
      lifetime: 86400,
    });
  });

  it("denies without an assertion (200)", async () => {
    issuer.reply("POST", "/agents/consent/", 200, { status: "denied" });
    const result = await auth.submitAgentConsent(ACCESS_TOKEN, {
      challenge: CHALLENGE,
      decision: "deny",
    });
    expect(result).toEqual({ status: "denied" });
    expect("code" in result).toBe(false);
    expect(JSON.parse(issuer.last("/agents/consent/").body!)).toEqual({
      challenge: CHALLENGE,
      decision: "deny",
    });
  });

  it("returns WebAuthn options for the pending request", async () => {
    const options = {
      challenge: "c3ludGhldGlj",
      rpId: "acme.auth.didit.me",
      timeout: 60000,
      userVerification: "required",
      allowCredentials: [{ id: "Y3JlZA", type: "public-key" }],
    };
    issuer.reply("POST", "/agents/consent/passkey/", 200, { options });
    const result = await auth.createAgentApprovalOptions(ACCESS_TOKEN, { challenge: CHALLENGE });
    expect(result.options).toEqual(options);
    const request = issuer.last("/agents/consent/passkey/");
    expect([request.method, request.url.toString()]).toEqual([
      "POST",
      `${ISSUER}/agents/consent/passkey/`,
    ]);
    expect(request.headers.get("authorization")).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(JSON.parse(request.body!)).toEqual({ challenge: CHALLENGE });
  });

  it("maps 400 invalid_grant and 403 passkey_required, once each (POST is not retried)", async () => {
    issuer.reply("POST", "/agents/consent/", 400, { error: "invalid_grant" });
    const invalid = await rejection(
      auth.submitAgentConsent(ACCESS_TOKEN, { challenge: CHALLENGE, decision: "approve" }),
    );
    expect(invalid).toBeInstanceOf(BadRequestError);
    expect(invalid.message).toContain("invalid_grant");
    issuer.reply("POST", "/agents/consent/", 403, { error: "passkey_required" });
    const forbidden = await rejection(
      auth.submitAgentConsent(ACCESS_TOKEN, { challenge: CHALLENGE, decision: "approve" }),
    );
    expect(forbidden).toBeInstanceOf(PermissionDeniedError);
    expect(forbidden.message).toContain("passkey_required");
    expect(issuer.count("/agents/consent/")).toBe(2);
    issuer.reply("POST", "/agents/consent/passkey/", 503, { detail: "unavailable" });
    expect(
      await rejection(auth.createAgentApprovalOptions(ACCESS_TOKEN, { challenge: CHALLENGE })),
    ).toBeInstanceOf(InternalServerError);
    expect(issuer.count("/agents/consent/passkey/")).toBe(1);
  });

  it("redacts an echoed challenge, assertion and token from errors", async () => {
    issuer.reply("POST", "/agents/consent/", 400, {
      detail: `bad ${CHALLENGE} ${ASSERTION.response.signature} ${ACCESS_TOKEN}`,
    });
    const error = await rejection(
      auth.submitAgentConsent(ACCESS_TOKEN, {
        challenge: CHALLENGE,
        decision: "approve",
        assertion: ASSERTION,
      }),
    );
    for (const secret of [CHALLENGE, ASSERTION.response.signature, ACCESS_TOKEN]) {
      expect(error.message).not.toContain(secret);
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });

  it("redacts every assertion string, at any depth, from 400 and malformed 200 answers", async () => {
    const marks = {
      id: 'mark-id-"q"\\1-padpad0123',
      rawId: "mark-raw-id-2-padpad0123",
      clientDataJSON: "mark-client-data-3-padpad0123",
      authenticatorData: "mark-authenticator-data-4-padpad0123",
      signature: "mark-signature-5-padpad0123",
      userHandle: "mark-user-handle-6-padpad0123",
      extra: "mark-response-extra-7-padpad0123",
      ext: "mark-extension-8-padpad0123",
      deep: "mark-extension-deep-9-padpad0123",
      listed: "mark-extension-listed-10-padpad0123",
    };
    const assertion = {
      id: marks.id,
      rawId: marks.rawId,
      type: "public-key" as const,
      response: {
        clientDataJSON: marks.clientDataJSON,
        authenticatorData: marks.authenticatorData,
        signature: marks.signature,
        userHandle: marks.userHandle,
        transports: marks.extra,
      },
      clientExtensionResults: {
        credProps: { rk: marks.ext, nested: { deeper: [marks.deep, { x: marks.listed }] } },
      },
    };
    const secrets = [CHALLENGE, ACCESS_TOKEN, ...Object.values(marks)];
    const call = (): Promise<unknown> =>
      auth.submitAgentConsent(ACCESS_TOKEN, {
        challenge: CHALLENGE,
        decision: "approve",
        assertion: assertion,
      });
    const leaks = (error: Error): string[] => {
      const retained = [
        error.message,
        String(error),
        JSON.stringify(error),
        JSON.stringify((error as { body?: unknown }).body ?? null),
        JSON.stringify([...((error as { headers?: Headers }).headers?.entries() ?? [])]),
      ].join("\n");
      return secrets.filter(
        (secret) =>
          retained.includes(secret) || retained.includes(JSON.stringify(secret).slice(1, -1)),
      );
    };
    // 400 JSON body echoing the challenge, the token and the whole assertion.
    issuer.reply("POST", "/agents/consent/", 400, {
      detail: `bad ${CHALLENGE} ${ACCESS_TOKEN}`,
      echo: assertion,
      error: "passkey_required",
    });
    const json400 = await rejection(call());
    expect(leaks(json400)).toEqual([]);
    expect(JSON.stringify((json400 as unknown as { body: unknown }).body)).toContain(
      "passkey_required",
    );
    // 400 raw text body carrying the JSON-escaped assertion.
    issuer.route(
      "POST",
      "/agents/consent/",
      () =>
        new Response(`failed: ${JSON.stringify({ challenge: CHALLENGE, assertion })}`, {
          status: 400,
          headers: { "content-type": "text/plain" },
        }),
    );
    expect(leaks(await rejection(call()))).toEqual([]);
    // Malformed 200 (not JSON, then not an object).
    issuer.route(
      "POST",
      "/agents/consent/",
      () => new Response(`oops ${JSON.stringify(assertion)} ${CHALLENGE}`, { status: 200 }),
    );
    expect(leaks(await rejection(call()))).toEqual([]);
    issuer.reply("POST", "/agents/consent/", 200, [assertion, CHALLENGE]);
    expect(leaks(await rejection(call()))).toEqual([]);
  });

  describe("structural redaction of agent consent errors", () => {
    const consent = async (
      assertion: Record<string, unknown>,
    ): Promise<Error & { body?: unknown; status?: number }> =>
      await rejection(
        auth.submitAgentConsent(ACCESS_TOKEN, {
          challenge: CHALLENGE,
          decision: "approve",
          assertion: assertion as never,
        }),
      );
    const shown = (error: Error & { body?: unknown }): string =>
      [error.message, String(error), JSON.stringify(error), JSON.stringify(error.body)].join("\n");
    const replyRaw = (status: number, text: string, type: string): void => {
      issuer.route(
        "POST",
        "/agents/consent/",
        () => new Response(text, { status, headers: { "content-type": type } }),
      );
    };

    it("leaves no fragment of a secret that another secret prefixes", async () => {
      issuer.reply("POST", "/agents/consent/", 400, {
        detail: "bad abcCREDENTIALID0123456 and abcCREDENTIALID0123",
        other: "abcCREDENTIALID0123456",
      });
      const error = await consent({
        id: "abcCREDENTIALID0123",
        signature: "abcCREDENTIALID0123456",
      });
      expect(error.body).toEqual({ detail: "[redacted]", other: "[redacted]" });
      expect(shown(error)).not.toMatch(/abcCRED|456/);
    });

    it("redacts the whole string that contains a secret", async () => {
      issuer.reply("POST", "/agents/consent/", 400, {
        detail: "bad assertion xyzSECRET-0123456789abcdefxyz",
        keep: "fine",
      });
      const error = await consent({ id: "SECRET-0123456789abcdef" });
      expect(error.body).toEqual({ detail: "[redacted]", keep: "fine" });
      expect(error.message).toMatch(/^HTTP 400: \[redacted\]/);
    });

    it("redacts a secret used as an object key and numbers colliding keys", async () => {
      issuer.reply("POST", "/agents/consent/", 400, {
        detail: "no",
        "echo-SECRET-0123456789abcdef-1": "a",
        "echo-SECRET-0123456789abcdef-2": "b",
      });
      const error = await consent({ id: "SECRET-0123456789abcdef" });
      expect(error.body).toEqual({ detail: "no", "[redacted]": "a", "[redacted]2": "b" });
      expect(shown(error)).not.toContain("SECRET-0123456789abcdef");
    });

    it("keeps an error code and short assertion strings readable while redacting long values", async () => {
      const long = "Y3JlZGVudGlhbC1pZC0xMjM0NTY3ODkw";
      issuer.reply("POST", "/agents/consent/", 400, {
        error: "invalid_grant",
        detail: `id public-key ${long}`,
      });
      const error = await consent({ id: long, type: "public-key" });
      expect(error.body).toEqual({ error: "invalid_grant", detail: "[redacted]" });
      expect(shown(error)).toContain("invalid_grant");
      expect(shown(error)).not.toContain(long);
    });

    it("redacts a secret echoed with other JSON escape spellings", async () => {
      replyRaw(400, '{"detail":"x","echo":"a\\/b+\\u00E9-padding0123456"}', "application/json");
      const error = await consent({ id: "a/b+\u00e9-padding0123456" });
      expect(error.body).toEqual({ detail: "x", echo: "[redacted]" });
      expect(shown(error)).not.toMatch(/a\/b|00E9|\u00e9|padding0123456/);
    });

    it("replaces a body that is not JSON with [redacted]", async () => {
      replyRaw(502, `<html>Bad gateway ${CHALLENGE}</html>`, "text/html");
      const error = await consent({ id: "x" });
      expect(error.body).toBe("[redacted]");
      expect(shown(error)).not.toContain(CHALLENGE);
    });

    it("redacts a secret that sits past the length cap of a long body", async () => {
      replyRaw(400, `${"x".repeat(600)} ${CHALLENGE}`, "text/plain");
      const error = await consent({ id: "x" });
      expect(error.body).toBe("[redacted]");
      expect(shown(error)).not.toContain(CHALLENGE);
    });

    it("applies to the options call too", async () => {
      issuer.reply("POST", "/agents/consent/passkey/", 400, { detail: `bad ${CHALLENGE}` });
      const error = (await rejection(
        auth.createAgentApprovalOptions(ACCESS_TOKEN, { challenge: CHALLENGE }),
      )) as Error & { body?: unknown };
      expect(error.body).toEqual({ detail: "[redacted]" });
    });
  });

  it("refuses bad arguments before any request", async () => {
    const bad: unknown[] = [
      { challenge: "", decision: "approve" },
      { challenge: CHALLENGE, decision: "maybe" },
      { challenge: CHALLENGE },
      { challenge: CHALLENGE, decision: "approve", scopes: "read" },
      { challenge: CHALLENGE, decision: "approve", organizationIds: [1] },
      { challenge: CHALLENGE, decision: "approve", lifetime: 1.5 },
      { challenge: CHALLENGE, decision: "approve", assertion: "x" },
      undefined,
    ];
    for (const params of bad) {
      expect(
        await rejection(auth.submitAgentConsent(ACCESS_TOKEN, params as never)),
      ).toBeInstanceOf(TypeError);
    }
    expect(
      await rejection(auth.createAgentApprovalOptions(ACCESS_TOKEN, { challenge: "" })),
    ).toBeInstanceOf(TypeError);
    expect(
      await rejection(auth.createAgentApprovalOptions("", { challenge: CHALLENGE })),
    ).toBeInstanceOf(TypeError);
    expect(issuer.requests).toEqual([]);
  });
});

describe("transport failures", () => {
  it("maps a network failure to APIConnectionError without the token", async () => {
    const attempts: string[] = [];
    issuer.route("POST", "/token/", (request) => {
      attempts.push(request.method);
      throw new TypeError("fetch failed");
    });
    const error = await rejection(
      auth.exchangeCode({ code: CODE, codeVerifier: CODE_VERIFIER, redirectUri: REDIRECT_URI }),
    );
    expect(error.constructor).toBe(APIConnectionError);
    expect(error.message).toBe("Could not reach the issuer for POST /token/.");
    expect(error.message).not.toContain(CODE);
    expect((error.cause as Error).message).toBe("fetch failed");
    expect(attempts).toEqual(["POST"]);
  });

  it("maps a body that breaks off to APIConnectionError", async () => {
    issuer.route("GET", "/session/", () => {
      const body = new ReadableStream({
        start(controller) {
          controller.error(new Error("connection reset"));
        },
      });
      return new Response(body, { status: 200 });
    });
    expect((await rejection(auth.getSession(ACCESS_TOKEN))).constructor).toBe(APIConnectionError);
  });

  it("maps a timeout to APITimeoutError and never retries", async () => {
    const slow = new FakeIssuer([]);
    let calls = 0;
    slow.route("GET", "/session/", (request) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        request.init.signal!.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });
    const client = slow.client({ timeout: 20 });
    const error = await rejection(client.getSession(ACCESS_TOKEN));
    expect(error.constructor).toBe(APITimeoutError);
    expect(error).toBeInstanceOf(APIConnectionError);
    expect(error.message).toBe("The issuer did not answer GET /session/ within 20 ms.");
    expect(calls).toBe(1);
  });

  it("times out a body that never ends", async () => {
    const slow = new FakeIssuer([]);
    slow.route(
      "POST",
      "/token/",
      (request) =>
        new Response(
          new ReadableStream({
            start(controller) {
              request.init.signal!.addEventListener("abort", () => {
                controller.error(new DOMException("aborted", "AbortError"));
              });
            },
          }),
          { status: 200 },
        ),
    );
    const error = await rejection(slow.client({ timeout: 20 }).refresh(REFRESH_TOKEN));
    expect(error.constructor).toBe(APITimeoutError);
    expect(error.message).not.toContain(REFRESH_TOKEN);
  });

  it("times out key fetches and rate-limits them like other failures", async () => {
    freezeClock();
    const key = await SigningKey.generate("k_synthetic_key_1");
    const slow = new FakeIssuer([key]);
    slow.route(
      "GET",
      "/.well-known/jwks.json",
      (request) =>
        new Promise((_resolve, reject) => {
          request.init.signal!.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const client = slow.client({ timeout: 20 });
    expect(
      (await rejection(client.verifyAccessToken(await key.sign(accessClaims())))).constructor,
    ).toBe(APITimeoutError);
    const error = await rejection(client.verifyAccessToken(await key.sign(accessClaims())));
    expect(error.message).toMatch(/less than a minute ago/);
  });

  it("uses the global fetch when none is given", async () => {
    const stub = vi.fn(issuer.fetch);
    vi.stubGlobal("fetch", stub);
    try {
      issuer.reply("GET", "/session/", 200, SESSION_RESPONSE);
      const { Authentication } = await import("../../src/authentication/index.js");
      await new Authentication({ issuer: ISSUER }).getSession(ACCESS_TOKEN);
      expect(stub).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("headers and logging", () => {
  it("sends defaultHeaders, but never lets them replace the bearer token or content type", async () => {
    issuer.reply("GET", "/session/", 200, SESSION_RESPONSE);
    issuer.reply("POST", "/token/", 200, TOKEN_RESPONSE);
    const client = issuer.client({
      defaultHeaders: {
        "X-Trace": "trace-1",
        Authorization: "Bearer someone-else",
        "Content-Type": "text/plain",
      },
    });
    await client.getSession(ACCESS_TOKEN);
    const session = issuer.last("/session/");
    expect(session.headers.get("x-trace")).toBe("trace-1");
    expect(session.headers.get("authorization")).toBe(`Bearer ${ACCESS_TOKEN}`);
    await client.refresh(REFRESH_TOKEN);
    expect(issuer.last("/token/").headers.get("content-type")).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  it("logs one line per request with debug logging, never a token", async () => {
    const lines: string[] = [];
    const client = issuer.client({
      logLevel: "debug",
      logger: { debug: (line) => lines.push(line) },
    });
    issuer.reply("GET", "/session/", 200, SESSION_RESPONSE);
    issuer.reply("POST", "/token/", 200, TOKEN_RESPONSE);
    issuer.route("GET", `/step-up/${STEP_UP_ID}/`, () => {
      throw new TypeError("fetch failed");
    });
    await client.getSession(ACCESS_TOKEN);
    await client.refresh(REFRESH_TOKEN);
    await rejection(client.retrieveStepUp(ACCESS_TOKEN, STEP_UP_ID));
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^didit: GET \/session\/ 200 \d+ms request_id=req_synthetic$/);
    expect(lines[1]).toMatch(/^didit: GET \/\.well-known\/openid-configuration 200 \d+ms$/);
    expect(lines[2]).toMatch(/^didit: POST \/token\/ 200 \d+ms request_id=req_synthetic$/);
    expect(lines[3]).toMatch(
      new RegExp(`^didit: GET /step-up/${STEP_UP_ID}/ connection_error \\d+ms$`),
    );
    const text = lines.join("\n");
    for (const secret of [ACCESS_TOKEN, REFRESH_TOKEN, ISSUED_ACCESS_TOKEN, ISSUED_REFRESH_TOKEN]) {
      expect(text).not.toContain(secret);
    }
  });

  it("logs nothing by default, and follows DIDIT_LOG", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    try {
      issuer.reply("GET", "/session/", 200, SESSION_RESPONSE);
      await auth.getSession(ACCESS_TOKEN);
      expect(debug).not.toHaveBeenCalled();
      vi.stubEnv("DIDIT_LOG", "debug");
      await issuer.client().getSession(ACCESS_TOKEN);
      expect(debug).toHaveBeenCalledTimes(1);
      expect(debug.mock.calls[0]![0]).toMatch(/^didit: GET \/session\/ 200/);
      await issuer.client({ logLevel: "off" }).getSession(ACCESS_TOKEN);
      expect(debug).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
      debug.mockRestore();
    }
  });

  it("logs a timeout", async () => {
    const lines: string[] = [];
    const slow = new FakeIssuer([]);
    slow.route(
      "GET",
      "/session/",
      (request) =>
        new Promise((_resolve, reject) => {
          request.init.signal!.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const client = slow.client({
      timeout: 10,
      logLevel: "debug",
      logger: { debug: (line) => lines.push(line) },
    });
    await rejection(client.getSession(ACCESS_TOKEN));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^didit: GET \/session\/ timeout \d+ms$/);
  });
});

describe("verification after the endpoints", () => {
  it("verifies the access token a refresh returned", async () => {
    freezeClock();
    const key = await SigningKey.generate("k_synthetic_key_1");
    const keyed = new FakeIssuer([key]);
    const accessToken = await key.sign(accessClaims());
    keyed.reply("POST", "/token/", 200, { ...TOKEN_RESPONSE, access_token: accessToken });
    const client = keyed.client({ clientId: APPLICATION_ID });
    const tokens = await client.refresh(REFRESH_TOKEN);
    expect((await client.verifyAccessToken(tokens.access_token)).sub).toBe(IDENTITY_ID);
    expect(keyed.count(DISCOVERY)).toBe(1);
  });
});
