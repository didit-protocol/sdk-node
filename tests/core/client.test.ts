import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";

import Didit, {
  APIConnectionError,
  APIResponseValidationError,
  ConfigurationError,
  DEFAULT_ACCOUNT_BASE_URL,
  DEFAULT_BASE_URL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT,
  DiditError,
  VERSION,
} from "../../src/index.js";
import { fakeFetch } from "../helpers/mock-api.js";

const KEY = "test-api-key";

function client(
  options: ConstructorParameters<typeof Didit>[0] = {},
  reply: Parameters<typeof fakeFetch>[0] = () => ({ json: {} }),
) {
  const { fetch, calls } = fakeFetch(reply);
  return { didit: new Didit({ apiKey: KEY, maxRetries: 0, fetch, ...options }), calls };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("configuration", () => {
  it("has the documented defaults", () => {
    const didit = new Didit({ apiKey: KEY });
    expect(didit.baseURL).toBe(DEFAULT_BASE_URL);
    expect(didit.accountBaseURL).toBe(DEFAULT_ACCOUNT_BASE_URL);
    expect(didit.timeout).toBe(DEFAULT_TIMEOUT);
    expect(didit.maxRetries).toBe(DEFAULT_MAX_RETRIES);
    expect(DEFAULT_BASE_URL).toBe("https://verification.didit.me");
    expect(DEFAULT_ACCOUNT_BASE_URL).toBe("https://apx.didit.me/auth/v2");
    expect(DEFAULT_TIMEOUT).toBe(60_000);
    expect(DEFAULT_MAX_RETRIES).toBe(2);
  });

  it("falls back to the DIDIT_* environment variables", async () => {
    vi.stubEnv("DIDIT_API_KEY", " env-key ");
    vi.stubEnv("DIDIT_ORGANIZATION_ID", "env-org");
    vi.stubEnv("DIDIT_APPLICATION_ID", "env-app");
    const { fetch, calls } = fakeFetch(() => ({
      json: { count: 0, next: null, previous: null, results: [] },
    }));
    const didit = new Didit({ fetch });
    expect(didit.organizationId).toBe("env-org");
    expect(didit.applicationId).toBe("env-app");
    await didit.cases.list();
    expect(calls[0]!.headers.get("x-api-key")).toBe("env-key");
    expect(calls[0]!.path).toBe("/v3/organization/env-org/application/env-app/cases/");
  });

  it("prefers explicit options to the environment", async () => {
    vi.stubEnv("DIDIT_API_KEY", "env-key");
    vi.stubEnv("DIDIT_ORGANIZATION_ID", "env-org");
    const { didit, calls } = client({
      apiKey: "explicit",
      organizationId: "org",
      applicationId: "app",
    });
    await didit.workflows.list();
    expect(calls[0]!.headers.get("x-api-key")).toBe("explicit");
    expect(didit.organizationId).toBe("org");
  });

  it("ignores empty environment variables", () => {
    vi.stubEnv("DIDIT_ORGANIZATION_ID", "   ");
    expect(new Didit({ apiKey: KEY }).organizationId).toBeUndefined();
  });

  it("refuses a request without an API key before sending anything", async () => {
    vi.stubEnv("DIDIT_API_KEY", "");
    const { fetch, calls } = fakeFetch(() => ({ json: {} }));
    const didit = new Didit({ fetch });
    const error = await didit.workflows.list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigurationError);
    expect((error as Error).message).toMatch(/DIDIT_API_KEY/);
    expect(calls).toHaveLength(0);
  });

  it("refuses an application-scoped method without the organization and application ids", async () => {
    vi.stubEnv("DIDIT_ORGANIZATION_ID", "");
    vi.stubEnv("DIDIT_APPLICATION_ID", "");
    const { didit, calls } = client({ organizationId: "org" });
    await expect(didit.cases.list()).rejects.toBeInstanceOf(ConfigurationError);
    expect(calls).toHaveLength(0);
  });

  it("validates the base URLs", () => {
    expect(() => new Didit({ apiKey: KEY, baseURL: "not a url" })).toThrow(ConfigurationError);
    expect(() => new Didit({ apiKey: KEY, baseURL: "ftp://example.com" })).toThrow(
      ConfigurationError,
    );
    expect(() => new Didit({ apiKey: KEY, baseURL: "https://user:pw@example.com" })).toThrow(
      /credentials/,
    );
    expect(() => new Didit({ apiKey: KEY, baseURL: "https://example.com/?a=1" })).toThrow(/query/);
    expect(() => new Didit({ apiKey: KEY, accountBaseURL: "mailto:x" })).toThrow(
      ConfigurationError,
    );
    expect(new Didit({ apiKey: KEY, baseURL: "http://localhost:8080/api/" }).baseURL).toBe(
      "http://localhost:8080/api",
    );
  });

  it("validates timeout and maxRetries", () => {
    expect(() => new Didit({ apiKey: KEY, timeout: 0 })).toThrow(/timeout/);
    expect(() => new Didit({ apiKey: KEY, timeout: Number.NaN })).toThrow(/timeout/);
    expect(() => new Didit({ apiKey: KEY, maxRetries: -1 })).toThrow(/maxRetries/);
    expect(() => new Didit({ apiKey: KEY, maxRetries: 1.5 })).toThrow(/maxRetries/);
  });

  it("validates per-request timeout and maxRetries", async () => {
    const { didit } = client();
    await expect(didit.workflows.list({}, { timeout: -1 })).rejects.toThrow(/timeout/);
    await expect(didit.workflows.list({}, { maxRetries: -2 })).rejects.toThrow(/maxRetries/);
  });

  it("needs a fetch implementation", () => {
    vi.stubGlobal("fetch", undefined);
    expect(() => new Didit({ apiKey: KEY })).toThrow(/fetch/);
  });

  it("sends requests to a custom base URL with a path prefix", async () => {
    const { didit, calls } = client({ baseURL: "http://127.0.0.1:9000/proxy" });
    await didit.workflows.list();
    expect(calls[0]!.url.href).toBe("http://127.0.0.1:9000/proxy/v3/workflows/");
  });

  it("withOptions returns a new client and leaves this one as it is", async () => {
    const { didit, calls } = client();
    const other = didit.withOptions({ apiKey: "other-key", timeout: 5_000 });
    expect(other).toBeInstanceOf(Didit);
    expect(other).not.toBe(didit);
    expect(other.timeout).toBe(5_000);
    expect(didit.timeout).toBe(DEFAULT_TIMEOUT);
    await other.workflows.list();
    await didit.workflows.list();
    expect(calls.map((c) => c.headers.get("x-api-key"))).toEqual(["other-key", KEY]);
  });

  it("never shows the API key or the account token when the client is logged", () => {
    const didit = new Didit({ apiKey: "secret-key-123", accountToken: "secret-token-456" });
    const shown = inspect(didit, { depth: 4, showHidden: false });
    expect(shown).not.toContain("secret-key-123");
    expect(shown).not.toContain("secret-token-456");
    expect(Object.keys(didit)).not.toContain("apiKey");
  });
});

describe("headers", () => {
  it("sends the API key, User-Agent, X-Didit-Client and Accept on every request", async () => {
    const { didit, calls } = client();
    await didit.workflows.list();
    const headers = calls[0]!.headers;
    expect(headers.get("x-api-key")).toBe(KEY);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("x-didit-client")).toBe(`node/${VERSION}`);
    expect(headers.get("user-agent")).toMatch(
      new RegExp(
        `^didit-node/${VERSION.replace(/\./g, "\\.")} \\(node \\d+\\.\\d+\\.\\d+; [a-z0-9]+\\)$`,
      ),
    );
  });

  it("adds default headers, then per-request headers, and removes a header set to null", async () => {
    const { didit, calls } = client({ defaultHeaders: { "X-Team": "kyc", "X-Trace": "a" } });
    await didit.workflows.list(
      {},
      { headers: { "X-Trace": "b", "X-Team": null, "X-Skip": undefined } },
    );
    const headers = calls[0]!.headers;
    expect(headers.get("x-trace")).toBe("b");
    expect(headers.get("x-team")).toBeNull();
    expect(headers.has("x-skip")).toBe(false);
  });

  it("never lets default or per-request headers replace, remove or misdirect the credentials", async () => {
    const { didit, calls } = client(
      { defaultHeaders: { "X-Api-Key": "other-key", Authorization: "Bearer default" } },
      (request) => ({
        json:
          request.origin === DEFAULT_BASE_URL
            ? { count: 0, next: null, previous: null, results: [] }
            : [],
      }),
    );
    await didit.workflows.list({}, { headers: { "x-api-key": null } });
    await didit.workflows.list({}, { headers: { "X-API-KEY": "per-request" } });
    await didit.withOptions({ accountToken: "acct" }).account.organizations.list();
    await didit.account.login({ email: "user@example.com", password: "pw" });
    expect(calls.map((c) => c.headers.get("x-api-key"))).toEqual([KEY, KEY, null, null]);
    expect(calls.map((c) => c.headers.get("authorization"))).toEqual([
      null,
      null,
      "Bearer acct",
      null,
    ]);
  });

  it("refuses header values HTTP cannot carry without echoing them", async () => {
    const secret = "sk_live_SECRET";
    const attempts: [string, () => Promise<unknown>][] = [
      ["api key", () => client({ apiKey: `${secret}\r\nX-Evil: 1` }).didit.workflows.list()],
      ["api key", () => client({ apiKey: `${secret} two` }).didit.workflows.list()],
      [
        "account token",
        () => client({ accountToken: `${secret}\n` }).didit.account.organizations.list(),
      ],
      [
        "default header",
        () =>
          client({ defaultHeaders: { "X-Team": `${secret}\r\nX-Evil: 1` } }).didit.workflows.list(),
      ],
      [
        "request header",
        () => client().didit.workflows.list({}, { headers: { "X-Team": `${secret}\nX-Evil: 1` } }),
      ],
    ];
    for (const [label, attempt] of attempts) {
      const error = await attempt().catch((e: unknown) => e);
      expect(error, label).toBeInstanceOf(ConfigurationError);
      expect((error as Error).message, label).not.toContain(secret);
      expect((error as Error).cause, label).toBeUndefined();
    }
  });

  it("sends Idempotency-Key from the request options", async () => {
    const { didit, calls } = client({}, () => ({ status: 201, json: { session_id: "s" } }));
    await didit.sessions.create({ workflow_id: "wf" }, { idempotencyKey: "idem-1" });
    expect(calls[0]!.headers.get("idempotency-key")).toBe("idem-1");
  });

  it("sends the account token, not the API key, to the account API", async () => {
    const { didit, calls } = client({ accountToken: "acct" }, () => ({ json: [] }));
    await didit.account.organizations.list();
    expect(calls[0]!.origin).toBe("https://apx.didit.me");
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer acct");
    expect(calls[0]!.headers.get("x-api-key")).toBeNull();
  });

  it("refuses an account method that needs a token when there is none", async () => {
    const { didit, calls } = client();
    await expect(didit.account.organizations.list()).rejects.toThrow(/accountToken/);
    expect(calls).toHaveLength(0);
  });

  it("calls the account methods without credentials when they need none, even without an API key", async () => {
    vi.stubEnv("DIDIT_API_KEY", "");
    const { fetch, calls } = fakeFetch(() => ({ json: { access_token: "t" } }));
    const didit = new Didit({ fetch, maxRetries: 0 });
    await didit.account.login({ email: "user@example.com", password: "pw" });
    expect(calls[0]!.headers.get("x-api-key")).toBeNull();
    expect(calls[0]!.headers.get("authorization")).toBeNull();
  });
});

describe("request encoding", () => {
  it("percent-encodes path ids and refuses empty and dot segments", async () => {
    const { didit, calls } = client();
    await didit.users.retrieve("a/b c?d");
    expect(calls[0]!.url.pathname).toBe("/v3/users/a%2Fb%20c%3Fd/");
    for (const bad of ["", ".", ".."]) {
      await expect(didit.users.retrieve(bad)).rejects.toThrow(ConfigurationError);
    }
    await expect(didit.users.retrieve(undefined as unknown as string)).rejects.toThrow(/required/);
    await expect(didit.users.retrieve("a\ud800")).rejects.toThrow(ConfigurationError);
    expect(calls).toHaveLength(1);
  });

  it("encodes query parameters and leaves out undefined and null", async () => {
    const { didit, calls } = client({}, () => ({
      json: { count: 0, next: null, previous: null, results: [] },
    }));
    await didit.sessions.list(
      { limit: 10, offset: undefined, vendor_data: null as unknown as string },
      { query: { extra: true, since: new Date("2026-01-02T03:04:05Z"), skip: undefined } },
    );
    expect(calls[0]!.query).toEqual({
      limit: "10",
      extra: "true",
      since: "2026-01-02T03:04:05.000Z",
    });
  });

  it("sends the body as JSON with dates as ISO 8601 and the extra body fields", async () => {
    const { didit, calls } = client({}, () => ({ status: 201, json: {} }));
    await didit.sessions.create(
      { workflow_id: "wf", metadata: { at: new Date("2026-01-02T00:00:00Z") } },
      { body: { experimental: 1 } },
    );
    expect(calls[0]!.contentType).toBe("application/json");
    expect(calls[0]!.json).toEqual({
      workflow_id: "wf",
      metadata: { at: "2026-01-02T00:00:00.000Z" },
      experimental: 1,
    });
  });

  it("refuses values JSON cannot carry before sending", async () => {
    const { didit, calls } = client();
    await expect(
      didit.sessions.create({ workflow_id: "wf", metadata: { n: Number.NaN } }),
    ).rejects.toThrow(DiditError);
    await expect(didit.sessions.create({ workflow_id: "wf", metadata: { n: 1n } })).rejects.toThrow(
      /BigInt/,
    );
    expect(calls).toHaveLength(0);
  });

  it("sends a whole-body operation's params as the JSON body", async () => {
    const { didit, calls } = client({}, () => ({
      body: new Uint8Array([1]),
      contentType: "application/pdf",
    }));
    const blob = await didit.walletScreening.screenPdf({
      address: "0xabc",
      blockchain: "ethereum",
    } as never);
    expect(blob).toBeInstanceOf(Blob);
    expect(calls[0]!.json).toEqual({ address: "0xabc", blockchain: "ethereum" });
    expect(calls[0]!.headers.get("accept")).toBe("application/pdf");
  });
});

describe("responses", () => {
  it("exposes the raw response with withResponse and asResponse", async () => {
    const { didit } = client({}, () => ({
      json: { a: 1 },
      headers: { "x-request-id": "req_123" },
    }));
    const { data, response, requestId } = await didit.users.retrieve("u").withResponse();
    expect(data).toEqual({ a: 1 });
    expect(response.status).toBe(200);
    expect(requestId).toBe("req_123");
    const raw = await didit.users.retrieve("u").asResponse();
    expect(raw.bodyUsed).toBe(false);
    expect(await raw.json()).toEqual({ a: 1 });
  });

  it("supports then, catch and finally on the result", async () => {
    const { didit } = client({}, () => ({ json: { a: 1 } }));
    const onFinally = vi.fn();
    const value = await didit.users
      .retrieve("u")
      .finally(onFinally)
      .then((r) => r);
    expect(value).toEqual({ a: 1 });
    expect(onFinally).toHaveBeenCalledOnce();
    const failing = client({}, () => ({ status: 404, json: { detail: "no" } })).didit;
    const caught = await failing.users.retrieve("u").catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(DiditError);
  });

  it("returns undefined for operations without a response body", async () => {
    const { didit } = client({}, () => ({ status: 204 }));
    await expect(didit.workflows.delete("wf")).resolves.toBeUndefined();
  });

  it("returns null for an empty JSON body", async () => {
    const { didit } = client({}, () => ({ status: 200 }));
    await expect(didit.users.retrieve("u")).resolves.toBeNull();
  });

  it("throws APIResponseValidationError for a 2xx body that is not JSON", async () => {
    const { didit } = client({}, () => ({ body: "<html>proxy</html>", contentType: "text/html" }));
    const error = await didit.users.retrieve("u").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(APIResponseValidationError);
    expect((error as APIResponseValidationError).status).toBe(200);
  });

  it("returns binary responses as a Blob with the response content type", async () => {
    const { didit } = client({}, () => ({
      body: new Uint8Array([37, 80]),
      contentType: "application/pdf",
    }));
    const pdf = await didit.sessions.generatePdf("s");
    expect(pdf.type).toBe("application/pdf");
    expect(pdf.size).toBe(2);
  });

  it("turns the response's date-times into Date objects", async () => {
    const { didit } = client({}, () => ({
      json: { session_id: "s", created_at: "2026-10-17T10:00:00.123456Z", status: "Approved" },
    }));
    const decision = await didit.sessions.retrieveDecision("s");
    expect(decision.created_at).toBeInstanceOf(Date);
    expect(decision.created_at!.toISOString()).toBe("2026-10-17T10:00:00.123Z");
    expect(decision.status).toBe("Approved");
  });

  it("fails with APIConnectionError when the body cannot be read", async () => {
    const { didit } = client({}, () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.error(new Error("socket hang up"));
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
    });
    await expect(didit.users.retrieve("u")).rejects.toBeInstanceOf(APIConnectionError);
  });
});

describe("redirects", () => {
  it("never follows a redirect to another origin, so the key stays with the API", async () => {
    const { didit, calls } = client({}, (req) =>
      req.origin === "https://verification.didit.me"
        ? new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } })
        : { json: {} },
    );
    const error = await didit.users.retrieve("u").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DiditError);
    expect(calls.map((c) => c.origin)).toEqual(["https://verification.didit.me"]);
  });

  it("follows a same-origin redirect of a GET to the new path", async () => {
    const { didit, calls } = client({}, (req) =>
      req.path === "/v3/users/u/"
        ? new Response(null, { status: 308, headers: { location: "/v3/users/u2/" } })
        : { json: { moved: true } },
    );
    await expect(didit.users.retrieve("u")).resolves.toEqual({ moved: true });
    expect(calls.map((c) => c.path)).toEqual(["/v3/users/u/", "/v3/users/u2/"]);
    expect(calls[1]!.headers.get("x-api-key")).toBe(KEY);
  });

  it("does not follow redirects of a POST", async () => {
    const { didit, calls } = client(
      {},
      () => new Response(null, { status: 307, headers: { location: "/v3/session/2/" } }),
    );
    await expect(didit.sessions.create({ workflow_id: "wf" })).rejects.toBeInstanceOf(DiditError);
    expect(calls).toHaveLength(1);
  });
});

describe("cancellation", () => {
  it("aborts a request with the signal", async () => {
    const controller = new AbortController();
    const { fetch } = fakeFetch(
      (_req) =>
        new Promise<Response>(() => {
          // Never answers; the abort ends it.
        }),
    );
    const didit = new Didit({
      apiKey: KEY,
      fetch: (input, init) => {
        const pending = fetch(input, init);
        return new Promise((resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
          void pending.then(resolve, reject);
        });
      },
    });
    const result = didit.users.retrieve("u", { signal: controller.signal });
    controller.abort();
    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(APIConnectionError);
    expect((error as Error).message).toMatch(/aborted/);
  });

  it("does not start a request whose signal is already aborted", async () => {
    const { didit, calls } = client();
    await expect(didit.users.retrieve("u", { signal: AbortSignal.abort() })).rejects.toThrow(
      /aborted/,
    );
    expect(calls).toHaveLength(0);
  });
});
