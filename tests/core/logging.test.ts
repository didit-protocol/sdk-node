import { afterEach, describe, expect, it, vi } from "vitest";

import Didit from "../../src/index.js";
import { envLogLevel, formatLogLine } from "../../src/core/logger.js";
import { fakeFetch } from "../helpers/mock-api.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("debug logging", () => {
  it("logs method, path, status, duration and request id, never the query, body or headers", async () => {
    const lines: string[] = [];
    const { fetch } = fakeFetch(() => ({
      status: 200,
      json: { secret: "body" },
      headers: { "x-request-id": "req_1" },
    }));
    const didit = new Didit({
      apiKey: "sk_key_abc",
      fetch,
      logLevel: "debug",
      logger: { debug: (m) => lines.push(m) },
    });
    await didit.sessions.list({ vendor_data: "user@example.com" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^didit: GET \/v3\/sessions\/ 200 \d+ms request_id=req_1$/);
    expect(lines.join("\n")).not.toMatch(/sk_key_abc|user@example\.com|secret/);
  });

  it("logs every attempt of a retried request and connection errors", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const lines: string[] = [];
    let n = 0;
    const { fetch } = fakeFetch(() => {
      n++;
      if (n === 1) throw new TypeError("fetch failed");
      return n === 2 ? { status: 503 } : { json: {} };
    });
    const didit = new Didit({
      apiKey: "k",
      fetch,
      logLevel: "debug",
      logger: { debug: (m) => lines.push(m) },
    });
    await didit.users.retrieve("u");
    expect(lines.map((l) => l.replace(/\d+ms/, "Nms"))).toEqual([
      "didit: GET /v3/users/u/ connection error Nms",
      "didit: GET /v3/users/u/ 503 Nms retry=1",
      "didit: GET /v3/users/u/ 200 Nms retry=2",
    ]);
  });

  it("is off by default and on with DIDIT_LOG=debug", async () => {
    expect(envLogLevel()).toBe("off");
    vi.stubEnv("DIDIT_LOG", "DEBUG");
    expect(envLogLevel()).toBe("debug");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const { fetch } = fakeFetch(() => ({ json: {} }));
    await new Didit({ apiKey: "k", fetch }).users.retrieve("u");
    expect(debug).toHaveBeenCalledOnce();
    vi.stubEnv("DIDIT_LOG", "");
    const quiet = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    quiet.mockClear();
    await new Didit({ apiKey: "k", fetch }).users.retrieve("u");
    expect(quiet).not.toHaveBeenCalled();
  });

  it("formats a line without a parsable URL", () => {
    expect(
      formatLogLine({
        method: "GET",
        url: "/raw",
        status: null,
        durationMs: 1.4,
        requestId: null,
        attempt: 0,
      }),
    ).toBe("didit: GET /raw error 1ms");
  });
});
