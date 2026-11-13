import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Didit, {
  APITimeoutError,
  ConfigurationError,
  ConflictError,
  InternalServerError,
} from "../../src/index.js";
import { shouldRetryStatus } from "../../src/core/api-client.js";
import { fakeFetch, type Reply } from "../helpers/mock-api.js";

const KEY = "order-123";

function client(
  handler: Parameters<typeof fakeFetch>[0],
  options: ConstructorParameters<typeof Didit>[0] = {},
) {
  const { fetch, calls } = fakeFetch(handler);
  return { didit: new Didit({ apiKey: "k", fetch, ...options }), calls };
}

function sequence(...replies: Reply[]) {
  return (_req: unknown, index: number): Reply => replies[Math.min(index, replies.length - 1)]!;
}

beforeEach(() => {
  // No real waiting: full jitter with random() = 0 means no delay.
  vi.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("idempotencyKey option: header", () => {
  it.each([
    ["POST", (d: Didit) => d.sessions.create({ workflow_id: "wf" }, { idempotencyKey: KEY })],
    ["PUT", (d: Didit) => d.travelRule.updateSettings({}, { idempotencyKey: KEY })],
    ["PATCH", (d: Didit) => d.users.update("u", {}, { idempotencyKey: KEY })],
    ["DELETE", (d: Didit) => d.workflows.delete("wf", { idempotencyKey: KEY })],
  ])("sends the header on %s", async (method, call) => {
    const { didit, calls } = client(() => ({ json: {} }));
    await call(didit);
    expect(calls[0]!.method).toBe(method);
    expect(calls[0]!.headers.get("idempotency-key")).toBe(KEY);
  });

  it("leaves the header out of GET", async () => {
    const { didit, calls } = client(() => ({ json: {} }));
    await didit.users.retrieve("u", { idempotencyKey: KEY });
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.headers.has("idempotency-key")).toBe(false);
  });

  it("sends nothing without the option", async () => {
    const { didit, calls } = client(() => ({ json: {} }));
    await didit.sessions.create({ workflow_id: "wf" });
    expect(calls[0]!.headers.has("idempotency-key")).toBe(false);
  });

  it("is not a client option and sets no client-wide default", async () => {
    const { fetch, calls } = fakeFetch(() => ({ json: {} }));
    // @ts-expect-error idempotencyKey exists only per request
    const didit = new Didit({ apiKey: "k", fetch, idempotencyKey: KEY });
    await didit.sessions.create({ workflow_id: "wf" });
    expect(calls[0]!.headers.has("idempotency-key")).toBe(false);
  });

  it("wins over an Idempotency-Key header of the same request, on an operation with the generated option", async () => {
    const { didit, calls } = client(() => ({ json: {} }));
    await didit.aml.screen(
      { full_name: "Ada Lovelace" },
      { idempotencyKey: "from-option", headers: { "Idempotency-Key": "from-header" } },
    );
    expect(calls[0]!.headers.get("idempotency-key")).toBe("from-option");
  });
});

describe("idempotencyKey option: allow-list and client defaults", () => {
  it("sends no header on a method outside the allow-list, whatever its source", async () => {
    const { didit, calls } = client(() => ({ json: {} }));
    const op = { method: "OPTIONS" as "GET", path: "/v3/anything/" };
    await didit.request(op, [], undefined, {
      idempotencyKey: KEY,
      headers: { "Idempotency-Key": "raw" },
    });
    expect(calls[0]!.method).toBe("OPTIONS");
    expect(calls[0]!.headers.has("idempotency-key")).toBe(false);
  });

  it("ignores a client default Idempotency-Key header: not sent, POST not retried", async () => {
    const { didit, calls } = client(() => ({ status: 500 }), {
      defaultHeaders: { "idempotency-KEY": "shared" },
    });
    await expect(didit.sessions.create({ workflow_id: "wf" })).rejects.toBeInstanceOf(
      InternalServerError,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers.has("idempotency-key")).toBe(false);
  });

  it("still honours the per-request option on a client with that default", async () => {
    const { didit, calls } = client(sequence({ status: 500 }, { json: {} }), {
      defaultHeaders: { "Idempotency-Key": "shared" },
    });
    await didit.sessions.create({ workflow_id: "wf" }, { idempotencyKey: KEY });
    expect(calls.map((c) => c.headers.get("idempotency-key"))).toEqual([KEY, KEY]);
  });

  it("ignores the default on a derived client too", async () => {
    const { didit, calls } = client(() => ({ json: {} }));
    const derived = didit.withOptions({ defaultHeaders: { "Idempotency-Key": "shared" } });
    await derived.sessions.create({ workflow_id: "wf" });
    expect(calls[0]!.headers.has("idempotency-key")).toBe(false);
  });
});

describe("idempotency key from a per-request header", () => {
  it("sends one header for a lower-case raw header and retries the POST", async () => {
    const { didit, calls } = client(sequence({ status: 503 }, { json: {} }));
    await didit.sessions.create({ workflow_id: "wf" }, { headers: { "idempotency-key": KEY } });
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect([...c.headers.keys()].filter((k) => k === "idempotency-key")).toHaveLength(1);
      expect(c.headers.get("idempotency-key")).toBe(KEY);
    }
  });

  it.each([
    ["empty", ""],
    ["256 characters", "a".repeat(256)],
  ])("rejects a raw header that is %s before any request", async (_l, value) => {
    const { didit, calls } = client(() => ({ json: {} }));
    await expect(
      didit.sessions.create({ workflow_id: "wf" }, { headers: { "Idempotency-Key": value } }),
    ).rejects.toBeInstanceOf(ConfigurationError);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["empty", ""],
    ["256 characters", "a".repeat(256)],
  ])(
    "rejects an invalid key (%s) on an operation with the generated parameter",
    async (_l, value) => {
      const { didit, calls } = client(() => ({ json: {} }));
      await expect(
        didit.aml.screen({ full_name: "Ada Lovelace" }, { idempotencyKey: value }),
      ).rejects.toBeInstanceOf(ConfigurationError);
      expect(calls).toHaveLength(0);
    },
  );

  it("makes an AML screening POST with a valid key retryable", async () => {
    const { didit, calls } = client(sequence({ status: 500 }, { json: {} }));
    await didit.aml.screen({ full_name: "Ada Lovelace" }, { idempotencyKey: KEY });
    expect(calls).toHaveLength(2);
  });

  it("sends exactly one header, with the option's value, when option and raw headers are given", async () => {
    const { didit, calls } = client(() => ({ json: {} }), {
      defaultHeaders: { "Idempotency-Key": "default" },
    });
    await didit.aml.screen(
      { full_name: "Ada Lovelace" },
      {
        idempotencyKey: "from-option",
        headers: { "IDEMPOTENCY-KEY": "raw", "idempotency-key": "raw2" },
      },
    );
    expect(calls[0]!.headers.get("idempotency-key")).toBe("from-option");
    expect([...calls[0]!.headers.keys()].filter((k) => k === "idempotency-key")).toHaveLength(1);
  });

  it("raises a 409 with a key and a non-JSON body at once", async () => {
    const { didit, calls } = client(() => ({ status: 409, body: "idempotency_key_in_progress" }));
    await expect(
      didit.sessions.create({ workflow_id: "wf" }, { idempotencyKey: KEY }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(calls).toHaveLength(1);
  });

  it("counts in-progress 409 retries against maxRetries", async () => {
    const { didit, calls } = client(() => ({
      status: 409,
      json: { code: "idempotency_key_in_progress" },
    }));
    await expect(
      didit.sessions.create({ workflow_id: "wf" }, { idempotencyKey: KEY, maxRetries: 1 }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(calls).toHaveLength(2);
  });
});

describe("idempotencyKey option: validation", () => {
  it.each([
    ["an empty string", ""],
    ["256 characters", "a".repeat(256)],
    ["a number", 42],
    ["null", null],
  ])("rejects %s before any request is sent", async (_label, value) => {
    const { didit, calls } = client(() => ({ json: {} }));
    await expect(
      didit.sessions.create({ workflow_id: "wf" }, { idempotencyKey: value as unknown as string }),
    ).rejects.toBeInstanceOf(ConfigurationError);
    expect(calls).toHaveLength(0);
  });

  it("accepts 1 and 255 characters", async () => {
    const { didit, calls } = client(() => ({ json: {} }));
    await didit.sessions.create({ workflow_id: "wf" }, { idempotencyKey: "a" });
    await didit.sessions.create({ workflow_id: "wf" }, { idempotencyKey: "a".repeat(255) });
    expect(calls).toHaveLength(2);
  });
});

describe("idempotencyKey option: retries", () => {
  it("retries a POST with a key on 5xx, sending the same key every time", async () => {
    const { didit, calls } = client(
      sequence({ status: 503 }, { status: 500 }, { status: 201, json: { session_id: "s" } }),
    );
    await expect(
      didit.sessions.create({ workflow_id: "wf" }, { idempotencyKey: KEY }),
    ).resolves.toEqual({ session_id: "s" });
    expect(calls.map((c) => c.headers.get("idempotency-key"))).toEqual([KEY, KEY, KEY]);
  });

  it("stops after maxRetries and throws the 5xx error", async () => {
    const { didit, calls } = client(() => ({ status: 503 }));
    await expect(
      didit.sessions.create({ workflow_id: "wf" }, { idempotencyKey: KEY }),
    ).rejects.toBeInstanceOf(InternalServerError);
    expect(calls).toHaveLength(3);
  });

  it("still does not retry a POST without a key", async () => {
    const { didit, calls } = client(() => ({ status: 500 }));
    await expect(didit.sessions.create({ workflow_id: "wf" })).rejects.toBeInstanceOf(
      InternalServerError,
    );
    expect(calls).toHaveLength(1);
  });

  it("retries a PATCH with a key on 5xx", async () => {
    const { didit, calls } = client(sequence({ status: 502 }, { status: 200, json: {} }));
    await didit.users.update("u", {}, { idempotencyKey: KEY });
    expect(calls.map((c) => c.headers.get("idempotency-key"))).toEqual([KEY, KEY]);
  });

  it("retries a POST with a key after a connection error and a read timeout", async () => {
    let n = 0;
    const { didit, calls } = client(() => {
      n++;
      if (n === 1) throw new TypeError("fetch failed");
      return { status: 201, json: {} };
    });
    await didit.sessions.create({ workflow_id: "wf" }, { idempotencyKey: KEY });
    expect(calls).toHaveLength(2);

    const hanging = fakeFetch(() => new Promise<Response>(() => undefined));
    const withAbort = (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
      new Promise((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("This operation was aborted", "AbortError"));
        });
        hanging.fetch(input, init).then(resolve, reject);
      });
    const slow = new Didit({ apiKey: "k", fetch: withAbort, timeout: 20 });
    await expect(
      slow.sessions.create({ workflow_id: "wf" }, { idempotencyKey: KEY }),
    ).rejects.toBeInstanceOf(APITimeoutError);
    expect(hanging.calls).toHaveLength(3);
    expect(hanging.calls.every((c) => c.headers.get("idempotency-key") === KEY)).toBe(true);
  });

  it("retries a 409 idempotency_key_in_progress, waiting for Retry-After", async () => {
    vi.useFakeTimers();
    const { didit, calls } = client(
      sequence(
        {
          status: 409,
          json: { detail: "busy", code: "idempotency_key_in_progress" },
          headers: { "retry-after": "1" },
        },
        { status: 201, json: { session_id: "s" } },
      ),
    );
    let done = false;
    const result = didit.sessions
      .create({ workflow_id: "wf" }, { idempotencyKey: KEY })
      .then((r) => {
        done = true;
        return r;
      });
    await vi.advanceTimersByTimeAsync(900);
    expect(done).toBe(false);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    await expect(result).resolves.toEqual({ session_id: "s" });
    expect(calls).toHaveLength(2);
  });

  it("raises 409 idempotency_key_reused at once as ConflictError", async () => {
    const { didit, calls } = client(() => ({
      status: 409,
      json: { detail: "other body", code: "idempotency_key_reused" },
    }));
    await expect(
      didit.sessions.create({ workflow_id: "wf" }, { idempotencyKey: KEY }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(calls).toHaveLength(1);
  });

  it("does not retry an in-progress 409 without a key", async () => {
    const { didit, calls } = client(() => ({
      status: 409,
      json: { detail: "busy", code: "idempotency_key_in_progress" },
    }));
    await expect(didit.sessions.create({ workflow_id: "wf" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(calls).toHaveLength(1);
  });

  it("shouldRetryStatus follows the GET rule for a keyed POST", () => {
    expect(shouldRetryStatus("POST", 503, true)).toBe(true);
    expect(shouldRetryStatus("PATCH", 408, true)).toBe(true);
    expect(shouldRetryStatus("POST", 503)).toBe(false);
    expect(shouldRetryStatus("POST", 400, true)).toBe(false);
  });
});

describe("idempotencyKey option: logging", () => {
  it("never logs the key", async () => {
    const lines: string[] = [];
    const { didit } = client(sequence({ status: 503 }, { status: 200, json: {} }), {
      logLevel: "debug",
      logger: { debug: (m) => lines.push(m) },
    });
    await didit.sessions.create({ workflow_id: "wf" }, { idempotencyKey: "secret-key-xyz" });
    expect(lines).toHaveLength(2);
    expect(lines.join("\n")).not.toContain("secret-key-xyz");
  });
});
