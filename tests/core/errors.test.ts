import { describe, expect, it } from "vitest";

import Didit, {
  APIConnectionError,
  APIStatusError,
  APITimeoutError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  DiditError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
} from "../../src/index.js";
import { makeStatusError, redact, requestIdOf } from "../../src/core/errors.js";
import { fakeFetch } from "../helpers/mock-api.js";

function failing(status: number, json?: unknown, headers?: Record<string, string>, body?: string) {
  const { fetch } = fakeFetch(() =>
    body !== undefined
      ? { status, body, contentType: "text/plain", headers }
      : { status, json, headers },
  );
  return new Didit({ apiKey: "sk_test_key_123", maxRetries: 0, fetch });
}

describe("status errors", () => {
  it.each([
    [400, BadRequestError],
    [401, AuthenticationError],
    [403, PermissionDeniedError],
    [404, NotFoundError],
    [409, ConflictError],
    [422, UnprocessableEntityError],
    [429, RateLimitError],
    [500, InternalServerError],
    [502, InternalServerError],
    [503, InternalServerError],
  ])("maps %i to its class", async (status, ErrorClass) => {
    const error = await failing(status, { detail: "nope" })
      .users.retrieve("u")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorClass);
    expect(error).toBeInstanceOf(APIStatusError);
    expect(error).toBeInstanceOf(DiditError);
    expect(error).toBeInstanceOf(Error);
    const e = error as APIStatusError;
    expect(e.status).toBe(status);
    expect(e.name).toBe(ErrorClass.name);
    expect(e.message).toBe(`HTTP ${status}: nope`);
  });

  it("uses APIStatusError for other statuses", async () => {
    const error = await failing(418, { detail: "teapot" })
      .users.retrieve("u")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(APIStatusError);
    expect(error).not.toBeInstanceOf(BadRequestError);
    expect((error as APIStatusError).status).toBe(418);
  });

  it("keeps the parsed body, the headers and the request id", async () => {
    const error = (await failing(
      400,
      { workflow_id: ["This field is required."] },
      { "x-request-id": "req_9" },
    )
      .users.retrieve("u")
      .catch((e: unknown) => e)) as APIStatusError;
    expect(error.body).toEqual({ workflow_id: ["This field is required."] });
    expect(error.headers.get("x-request-id")).toBe("req_9");
    expect(error.requestId).toBe("req_9");
    expect(error.message).toBe("HTTP 400: workflow_id: This field is required. (request id req_9)");
  });

  it("keeps a text body that is not JSON", async () => {
    const error = (await failing(502, undefined, undefined, "Bad gateway")
      .users.retrieve("u")
      .catch((e: unknown) => e)) as APIStatusError;
    expect(error.body).toBe("Bad gateway");
    expect(error.message).toBe("HTTP 502: Bad gateway");
  });

  it("has a null body when the response has none", async () => {
    const error = (await failing(404)
      .users.retrieve("u")
      .catch((e: unknown) => e)) as APIStatusError;
    expect(error.body).toBeNull();
    expect(error.message).toBe("HTTP 404");
  });

  it("never puts the API key in a message or a body", async () => {
    const error = (await failing(401, {
      detail: "Invalid key sk_test_key_123",
      echo: ["sk_test_key_123"],
    })
      .users.retrieve("u")
      .catch((e: unknown) => e)) as APIStatusError;
    expect(error.message).toBe("HTTP 401: Invalid key [redacted]");
    expect(JSON.stringify(error.body)).not.toContain("sk_test_key_123");
    expect(String(error.stack)).not.toContain("sk_test_key_123");
  });

  it("never keeps the API key in the error's headers", async () => {
    const error = (await failing(
      401,
      { detail: "no" },
      { "x-echo": "key=sk_test_key_123", "x-request-id": "req_1" },
    )
      .users.retrieve("u")
      .catch((e: unknown) => e)) as APIStatusError;
    expect(error.headers.get("x-echo")).toBe("key=[redacted]");
    expect(error.headers.get("x-request-id")).toBe("req_1");
  });

  it("falls back to the body's request_id when no header carries one", async () => {
    const error = (await failing(400, { detail: "bad", request_id: "body-req-1" })
      .users.retrieve("u")
      .catch((e: unknown) => e)) as APIStatusError;
    expect(error.requestId).toBe("body-req-1");
    expect(error.message).toBe("HTTP 400: bad (request id body-req-1)");
    const header = (await failing(400, { request_id: "body" }, { "x-request-id": "hdr" })
      .users.retrieve("u")
      .catch((e: unknown) => e)) as APIStatusError;
    expect(header.requestId).toBe("hdr");
  });
});

describe("error messages", () => {
  const headers = new Headers();
  it.each([
    [{ detail: "d" }, "HTTP 400: d"],
    [{ message: "m" }, "HTTP 400: m"],
    [{ error: "e" }, "HTTP 400: e"],
    [
      { error: "invalid_grant", error_description: "Code expired" },
      "HTTP 400: invalid_grant: Code expired",
    ],
    [{ a: ["x"], b: "y", c: 1 }, "HTTP 400: a: x; b: y"],
    [["one", "two"], "HTTP 400: one; two"],
    ["  text  ", "HTTP 400: text"],
    ["x".repeat(501), "HTTP 400"],
    [{}, "HTTP 400"],
    [[1, 2], "HTTP 400"],
  ])("formats %j", (body, message) => {
    expect(makeStatusError(400, body, headers).message).toBe(message);
  });

  it("reads the request id from the usual headers", () => {
    expect(requestIdOf(new Headers({ "request-id": "a" }))).toBe("a");
    expect(requestIdOf(new Headers({ "x-amzn-requestid": "b" }))).toBe("b");
    expect(requestIdOf(new Headers({ "x-correlation-id": "c" }))).toBe("c");
    expect(requestIdOf(new Headers({ "x-request-id": "d", "request-id": "e" }))).toBe("d");
    expect(requestIdOf(new Headers())).toBeNull();
  });

  it("redacts secrets in nested values and ignores empty secrets", () => {
    expect(redact({ a: ["k1 and k1"], b: { c: "k1" }, d: 3 }, ["k1", ""])).toEqual({
      a: ["[redacted] and [redacted]"],
      b: { c: "[redacted]" },
      d: 3,
    });
    expect(redact("same", [])).toBe("same");
  });

  it("redacts the percent-encoded and form-encoded spellings and keys too", () => {
    const secret = "c/d e+f~g";
    expect(
      redact({ a: "code=c%2Fd%20e%2Bf~g", b: "code=c%2Fd+e%2Bf%7Eg", [secret]: secret }, [secret]),
    ).toEqual({ a: "code=[redacted]", b: "code=[redacted]", "[redacted]": "[redacted]" });
    expect(redact("x\ud800", ["\ud800"])).toBe("x[redacted]");
  });

  it("names the connection errors", () => {
    expect(new APIConnectionError().message).toBe("Connection error.");
    expect(new APITimeoutError().message).toBe("Request timed out.");
    expect(new APITimeoutError()).toBeInstanceOf(APIConnectionError);
    expect(new APITimeoutError().name).toBe("APITimeoutError");
  });
});
