import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Didit, {
  APIConnectionError,
  APITimeoutError,
  InternalServerError,
  RateLimitError,
} from "../../src/index.js";
import {
  failedBeforeSending,
  parseRetryAfter,
  retryDelay,
  shouldRetryStatus,
} from "../../src/core/api-client.js";
import { fakeFetch, type Reply } from "../helpers/mock-api.js";

function refused(code: string): TypeError {
  return new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });
}

function client(
  handler: Parameters<typeof fakeFetch>[0],
  options: ConstructorParameters<typeof Didit>[0] = {},
) {
  const { fetch, calls } = fakeFetch(handler);
  return { didit: new Didit({ apiKey: "k", fetch, ...options }), calls };
}

function sequence(...replies: (Reply | Error)[]) {
  return (_req: unknown, index: number): Reply => {
    const reply = replies[Math.min(index, replies.length - 1)]!;
    if (reply instanceof Error) throw reply;
    return reply;
  };
}

beforeEach(() => {
  // No real waiting: full jitter with random() = 0 means no delay.
  vi.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("retry policy", () => {
  it("retries a GET on 5xx up to maxRetries and then throws", async () => {
    const { didit, calls } = client(() => ({ status: 503, json: { detail: "down" } }));
    await expect(didit.users.retrieve("u")).rejects.toBeInstanceOf(InternalServerError);
    expect(calls).toHaveLength(3);
  });

  it("succeeds when a retry succeeds", async () => {
    const { didit, calls } = client(sequence({ status: 502 }, { status: 200, json: { ok: true } }));
    await expect(didit.users.retrieve("u")).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it.each([
    ["PUT", (d: Didit) => d.travelRule.updateSettings({})],
    ["DELETE", (d: Didit) => d.workflows.delete("wf")],
  ])("retries a %s on 500", async (_method, call) => {
    const { didit, calls } = client(sequence({ status: 500 }, { status: 200, json: {} }));
    await call(didit);
    expect(calls).toHaveLength(2);
  });

  it("retries a GET on 408", async () => {
    const { didit, calls } = client(sequence({ status: 408 }, { status: 200, json: {} }));
    await didit.users.retrieve("u");
    expect(calls).toHaveLength(2);
  });

  it.each([500, 503, 408])(
    "never retries a POST after a %i: it may have reached the server",
    async (status) => {
      const { didit, calls } = client(() => ({ status, json: {} }));
      await expect(didit.sessions.create({ workflow_id: "wf" })).rejects.toBeDefined();
      expect(calls).toHaveLength(1);
    },
  );

  it("never retries a PATCH after a 5xx", async () => {
    const { didit, calls } = client(() => ({ status: 500, json: {} }));
    await expect(didit.users.update("u", {})).rejects.toBeInstanceOf(InternalServerError);
    expect(calls).toHaveLength(1);
  });

  it("retries a POST on 429, which guarantees it was not processed", async () => {
    const { didit, calls } = client(
      sequence({ status: 429 }, { status: 201, json: { session_id: "s" } }),
    );
    await expect(didit.sessions.create({ workflow_id: "wf" })).resolves.toEqual({
      session_id: "s",
    });
    expect(calls).toHaveLength(2);
  });

  it("throws RateLimitError when 429 persists", async () => {
    const { didit, calls } = client(() => ({ status: 429, json: {} }));
    await expect(didit.users.retrieve("u")).rejects.toBeInstanceOf(RateLimitError);
    expect(calls).toHaveLength(3);
  });

  it("does not retry 4xx other than 408 and 429", async () => {
    const { didit, calls } = client(() => ({ status: 400, json: {} }));
    await expect(didit.users.retrieve("u")).rejects.toBeDefined();
    expect(calls).toHaveLength(1);
  });

  it("honours maxRetries from the client and from the request", async () => {
    const zero = client(() => ({ status: 503 }), { maxRetries: 0 });
    await expect(zero.didit.users.retrieve("u")).rejects.toBeDefined();
    expect(zero.calls).toHaveLength(1);
    const five = client(() => ({ status: 503 }));
    await expect(five.didit.users.retrieve("u", { maxRetries: 5 })).rejects.toBeDefined();
    expect(five.calls).toHaveLength(6);
  });
});

describe("connection errors", () => {
  it("retries a GET after any connection error, then throws APIConnectionError", async () => {
    const { didit, calls } = client(() => {
      throw new TypeError("fetch failed");
    });
    const error = await didit.users.retrieve("u").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(APIConnectionError);
    expect(error).not.toBeInstanceOf(APITimeoutError);
    expect((error as Error).cause).toBeInstanceOf(TypeError);
    expect(calls).toHaveLength(3);
  });

  it("retries a POST when the connection failed before sending", async () => {
    const { didit, calls } = client(sequence(refused("ECONNREFUSED"), { status: 201, json: {} }));
    await didit.sessions.create({ workflow_id: "wf" });
    expect(calls).toHaveLength(2);
  });

  it("never retries a POST when the connection broke after it may have been sent", async () => {
    const { didit, calls } = client(() => {
      throw refused("ECONNRESET");
    });
    await expect(didit.sessions.create({ workflow_id: "wf" })).rejects.toBeInstanceOf(
      APIConnectionError,
    );
    expect(calls).toHaveLength(1);
  });

  it("knows which errors prove nothing was sent", () => {
    expect(failedBeforeSending(refused("ECONNREFUSED"))).toBe(true);
    expect(failedBeforeSending(refused("ENOTFOUND"))).toBe(true);
    expect(failedBeforeSending(refused("UND_ERR_CONNECT_TIMEOUT"))).toBe(true);
    expect(
      failedBeforeSending(new AggregateError([refused("ECONNREFUSED"), refused("EHOSTUNREACH")])),
    ).toBe(true);
    expect(failedBeforeSending(Object.assign(new Error("x"), { code: "ConnectionRefused" }))).toBe(
      true,
    );
    expect(failedBeforeSending(refused("ECONNRESET"))).toBe(false);
    expect(
      failedBeforeSending(new AggregateError([refused("ECONNREFUSED"), refused("ECONNRESET")])),
    ).toBe(false);
    expect(failedBeforeSending(new TypeError("fetch failed"))).toBe(false);
    expect(failedBeforeSending("text")).toBe(false);
  });
});

describe("timeouts", () => {
  function hanging() {
    return fakeFetch(() => new Promise<Response>(() => undefined));
  }

  function withAbort(fetch: ReturnType<typeof hanging>["fetch"]) {
    return (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
      new Promise((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("This operation was aborted", "AbortError"));
        });
        fetch(input, init).then(resolve, reject);
      });
  }

  it("retries a GET that timed out and then throws APITimeoutError", async () => {
    const { fetch, calls } = hanging();
    const didit = new Didit({ apiKey: "k", fetch: withAbort(fetch), timeout: 20 });
    await expect(didit.users.retrieve("u")).rejects.toBeInstanceOf(APITimeoutError);
    expect(calls).toHaveLength(3);
  });

  it("never retries a POST that timed out", async () => {
    const { fetch, calls } = hanging();
    const didit = new Didit({ apiKey: "k", fetch: withAbort(fetch), timeout: 20 });
    await expect(didit.sessions.create({ workflow_id: "wf" })).rejects.toBeInstanceOf(
      APITimeoutError,
    );
    expect(calls).toHaveLength(1);
  });

  it("applies the timeout to reading the body too", async () => {
    const didit = new Didit({
      apiKey: "k",
      maxRetries: 0,
      timeout: 20,
      fetch: (_input, init) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("{"));
            init?.signal?.addEventListener("abort", () => {
              controller.error(new DOMException("aborted", "AbortError"));
            });
          },
        });
        return Promise.resolve(
          new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
        );
      },
    });
    await expect(didit.users.retrieve("u")).rejects.toBeInstanceOf(APITimeoutError);
  });

  it("uses the per-request timeout", async () => {
    const { fetch } = hanging();
    const didit = new Didit({ apiKey: "k", fetch: withAbort(fetch), maxRetries: 0 });
    const started = Date.now();
    await expect(didit.users.retrieve("u", { timeout: 15 })).rejects.toBeInstanceOf(
      APITimeoutError,
    );
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe("Retry-After and backoff", () => {
  it("waits for Retry-After seconds before retrying", async () => {
    vi.useFakeTimers();
    const { didit, calls } = client(
      sequence({ status: 503, headers: { "retry-after": "2" } }, { status: 200, json: {} }),
    );
    const result = didit.users.retrieve("u");
    await vi.advanceTimersByTimeAsync(1_900);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    await result;
    expect(calls).toHaveLength(2);
  });

  it("parses seconds and HTTP dates, caps at 60 s and ignores garbage", () => {
    const now = Date.parse("2026-10-17T10:00:00Z");
    expect(parseRetryAfter("3", now)).toBe(3_000);
    expect(parseRetryAfter("1.5", now)).toBe(1_500);
    expect(parseRetryAfter("600", now)).toBe(60_000);
    expect(parseRetryAfter("Sat, 17 Oct 2026 10:00:10 GMT", now)).toBe(10_000);
    expect(parseRetryAfter("Sat, 17 Oct 2026 09:00:00 GMT", now)).toBe(0);
    expect(parseRetryAfter("soon", now)).toBeUndefined();
    expect(parseRetryAfter("-1", now)).toBe(0);
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });

  it("backs off exponentially from 0.5 s with full jitter, capped at 8 s", () => {
    expect(retryDelay(0, () => 1)).toBe(500);
    expect(retryDelay(1, () => 1)).toBe(1_000);
    expect(retryDelay(3, () => 1)).toBe(4_000);
    expect(retryDelay(10, () => 1)).toBe(8_000);
    expect(retryDelay(2, () => 0.5)).toBe(1_000);
    expect(retryDelay(2, () => 0)).toBe(0);
  });

  it("decides which statuses are retried", () => {
    expect(shouldRetryStatus("GET", 500)).toBe(true);
    expect(shouldRetryStatus("HEAD", 504)).toBe(true);
    expect(shouldRetryStatus("POST", 500)).toBe(false);
    expect(shouldRetryStatus("PATCH", 408)).toBe(false);
    expect(shouldRetryStatus("POST", 429)).toBe(true);
    expect(shouldRetryStatus("GET", 404)).toBe(false);
  });

  it("stops waiting when the request is aborted during a backoff", async () => {
    const controller = new AbortController();
    vi.mocked(Math.random).mockReturnValue(1);
    const { didit, calls } = client(() => ({ status: 503 }));
    const result = didit.users
      .retrieve("u", { signal: controller.signal })
      .catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    const error = await result;
    expect(error).toBeInstanceOf(APIConnectionError);
    expect(calls).toHaveLength(1);
  });

  it("stops waiting when the client's fetchOptions signal aborts during a backoff", async () => {
    const controller = new AbortController();
    vi.mocked(Math.random).mockReturnValue(1);
    const { didit, calls } = client(() => ({ status: 503 }), {
      fetchOptions: { signal: controller.signal },
    });
    const result = didit.users.retrieve("u").catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    const error = await result;
    expect(error).toBeInstanceOf(APIConnectionError);
    expect((error as Error).message).toMatch(/aborted/);
    expect(calls).toHaveLength(1);
  });

  it("does not start a backoff when aborted while reading a retryable error body", async () => {
    const controller = new AbortController();
    vi.mocked(Math.random).mockReturnValue(1);
    let calls = 0;
    const didit = new Didit({
      apiKey: "k",
      fetchOptions: { signal: controller.signal },
      fetch: (_input, init) => {
        calls++;
        // A 503 whose body only ends when the request is aborted.
        const body = new ReadableStream({
          start(stream) {
            init?.signal?.addEventListener("abort", () => {
              stream.error(new DOMException("aborted", "AbortError"));
            });
          },
        });
        queueMicrotask(() => {
          controller.abort();
        });
        return Promise.resolve(new Response(body, { status: 503 }));
      },
    });
    const started = Date.now();
    const error = await didit.users.retrieve("u").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(APIConnectionError);
    expect((error as Error).message).toMatch(/aborted/);
    // The first backoff would be 500 ms.
    expect(Date.now() - started).toBeLessThan(400);
    expect(calls).toBe(1);
  });
});
