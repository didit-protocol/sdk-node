// A mocked HTTP layer for the generated tests: a Didit client whose fetch
// records every request and answers with a fixed response. No network.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

import { Didit } from "../../src/index.js";

export const API_ORIGIN = "https://verification.didit.me";
export const ACCOUNT_ORIGIN = "https://apx.didit.me";
export const TEST_API_KEY = "test-api-key";
export const TEST_ACCOUNT_TOKEN = "test-account-token";
export const BINARY = new Uint8Array([37, 80, 68, 70, 45, 49]);

export interface RecordedFile {
  filename: string;
  type: string;
  bytes: number[];
}

export interface RecordedRequest {
  method: string;
  url: URL;
  origin: string;
  path: string;
  query: Record<string, string | string[]>;
  headers: Headers;
  contentType: string | null;
  bodyText: string;
  json: unknown;
  form: Record<string, string | string[]>;
  files: Record<string, RecordedFile[]>;
}

export interface Reply {
  status?: number;
  json?: unknown;
  body?: Uint8Array | string;
  contentType?: string;
  headers?: Record<string, string>;
}

async function record(input: string | URL | Request, init: RequestInit = {}): Promise<RecordedRequest> {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    query[key] = values.length === 1 ? values[0]! : values;
  }
  const contentType = request.headers.get("content-type");
  const out: RecordedRequest = {
    method: request.method,
    url,
    origin: url.origin,
    path: url.pathname,
    query,
    headers: request.headers,
    contentType,
    bodyText: "",
    json: undefined,
    form: {},
    files: {},
  };
  if (contentType?.startsWith("multipart/form-data")) {
    const form = await request.formData();
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") {
        const existing = out.form[key];
        out.form[key] = existing === undefined ? value : [...[existing].flat(), value];
      } else {
        const file: RecordedFile = {
          filename: value.name,
          type: value.type,
          bytes: [...new Uint8Array(await value.arrayBuffer())],
        };
        (out.files[key] ??= []).push(file);
      }
    }
  } else {
    out.bodyText = await request.text();
    if (out.bodyText && contentType?.startsWith("application/json")) out.json = JSON.parse(out.bodyText);
  }
  return out;
}

export function replyResponse(reply: Reply): Response {
  const status = reply.status ?? 200;
  const headers = new Headers(reply.headers);
  let body: BodyInit | null = null;
  if (reply.body !== undefined) {
    body = typeof reply.body === "string" ? reply.body : (reply.body as Uint8Array<ArrayBuffer>);
    headers.set("content-type", reply.contentType ?? "application/octet-stream");
  } else if (reply.json !== undefined) {
    body = JSON.stringify(reply.json);
    headers.set("content-type", "application/json");
  }
  if (status === 204 || status === 304) body = null;
  return new Response(body, { status, headers });
}

/** A client against a fake API that answers every request with `reply`. */
export function mockClient(reply: Reply | ((request: RecordedRequest) => Reply)): {
  client: Didit;
  calls: RecordedRequest[];
} {
  const calls: RecordedRequest[] = [];
  const client = new Didit({
    apiKey: TEST_API_KEY,
    accountToken: TEST_ACCOUNT_TOKEN,
    organizationId: "org-123",
    applicationId: "app-456",
    maxRetries: 0,
    fetch: async (input, init) => {
      const recorded = await record(input, init);
      calls.push(recorded);
      return replyResponse(typeof reply === "function" ? reply(recorded) : reply);
    },
  });
  return { client, calls };
}

/** The credentials each kind of operation must send, and nothing else. */
export function expectAuth(request: RecordedRequest, auth: string): void {
  if (auth === "api_key") {
    expect(request.headers.get("x-api-key")).toBe(TEST_API_KEY);
    expect(request.headers.get("authorization")).toBeNull();
  } else if (auth === "account_token") {
    expect(request.headers.get("authorization")).toBe(`Bearer ${TEST_ACCOUNT_TOKEN}`);
    expect(request.headers.get("x-api-key")).toBeNull();
  } else {
    expect(request.headers.get("authorization")).toBeNull();
    expect(request.headers.get("x-api-key")).toBeNull();
  }
  expect(request.headers.get("user-agent")).toMatch(/^didit-node\/\d+\.\d+\.\d+/);
  expect(request.headers.get("x-didit-client")).toMatch(/^node\/\d+\.\d+\.\d+/);
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
let specs: { verification: JsonObject; account: JsonObject; deprecated: JsonObject } | undefined;

function loadSpecs(): NonNullable<typeof specs> {
  if (!specs) {
    const read = (name: string): JsonObject => JSON.parse(readFileSync(join(ROOT, "openapi", name), "utf8"));
    let deprecated: JsonObject = {};
    try {
      deprecated = read("deprecated-operations.json");
    } catch {
      deprecated = {};
    }
    specs = { verification: read("verification.json"), account: read("account.json"), deprecated };
  }
  return specs;
}

function resolve(doc: JsonObject, node: unknown): unknown {
  let cur = node;
  for (let i = 0; isObject(cur) && typeof cur.$ref === "string" && i < 32; i++) {
    let target: unknown = doc;
    for (const raw of cur.$ref.slice(2).split("/")) {
      target = (target as JsonObject)[raw.replace(/~1/g, "/").replace(/~0/g, "~")];
    }
    cur = target;
  }
  return cur;
}

/**
 * The first 2xx JSON example of an operation, as the generator reads it; `{}`
 * (or an empty page) when the spec has none.
 */
export function responseExample(key: string, kind?: "page"): unknown {
  const { verification, account, deprecated } = loadSpecs();
  const isAccount = key.startsWith("account ");
  const [method, path] = key.replace(/^account /, "").split(" ") as [string, string];
  const doc = isAccount ? account : verification;
  let op = (resolve(doc, (doc.paths as JsonObject)[path]) as JsonObject | undefined)?.[method.toLowerCase()];
  if (!isObject(op)) {
    const methods = isObject(deprecated.methods) ? deprecated.methods : {};
    const entry = Object.values(methods).find((e) => isObject(e) && e.operation_key === key);
    op = isObject(entry) ? entry.operation : undefined;
  }
  const fallback = kind === "page" ? { count: 0, next: null, previous: null, results: [] } : {};
  if (!isObject(op) || !isObject(op.responses)) return fallback;
  const codes = Object.keys(op.responses)
    .filter((c) => c.startsWith("2"))
    .sort();
  for (const code of codes) {
    const response = resolve(doc, op.responses[code]) as JsonObject;
    const media = isObject(response.content) ? response.content["application/json"] : undefined;
    if (!isObject(media)) continue;
    if ("example" in media) return media.example;
    if (isObject(media.examples)) {
      const first = Object.values(media.examples)[0];
      if (isObject(first) && "value" in first) return first.value;
    }
    const schema = resolve(doc, media.schema);
    if (isObject(schema) && "example" in schema) return schema.example;
    return fallback;
  }
  return fallback;
}

/**
 * The parsed result equals the example, except that date-time strings may have
 * become `Date` objects for the same instant.
 */
export function expectMatchesExample(actual: unknown, example: unknown, path = "$"): void {
  if (actual instanceof Date) {
    expect(typeof example, `${path} should be a date-time string`).toBe("string");
    expect(actual.getTime(), path).toBe(new Date(example as string).getTime());
    return;
  }
  if (Array.isArray(example)) {
    expect(Array.isArray(actual), `${path} should be an array`).toBe(true);
    const list = actual as unknown[];
    expect(list.length, path).toBe(example.length);
    example.forEach((item, i) => {
      expectMatchesExample(list[i], item, `${path}[${i}]`);
    });
    return;
  }
  if (isObject(example)) {
    expect(isObject(actual), `${path} should be an object`).toBe(true);
    const record = actual as JsonObject;
    expect(Object.keys(record).sort(), path).toEqual(Object.keys(example).sort());
    for (const [key, value] of Object.entries(example)) expectMatchesExample(record[key], value, `${path}.${key}`);
    return;
  }
  expect(actual, path).toEqual(example);
}
