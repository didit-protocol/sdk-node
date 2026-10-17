// The HTTP transport shared by every resource (docs/DESIGN.md sections 6 to 8):
// configuration, headers, credentials, retries, timeouts, errors, pagination,
// multipart bodies and binary responses.

import { APIPromise, type RawResponse } from "./api-promise.js";
import { decodeDates, type DatePlan } from "./dates.js";
import {
  APIConnectionError,
  APIResponseValidationError,
  APITimeoutError,
  ConfigurationError,
  DiditError,
  makeStatusError,
  requestIdOf,
} from "./errors.js";
import { envLogLevel, formatLogLine, type Logger, type LogLevel } from "./logger.js";
import type { OperationSpec } from "./operation.js";
import { makePage, PagePromise, type Page } from "./pagination.js";
import type { RequestOptions } from "./request-options.js";
import { clientHeader, readEnv, userAgent } from "./runtime.js";
import { isUploadable, prepareFile, type Uploadable } from "./uploads.js";

export const DEFAULT_BASE_URL = "https://verification.didit.me";
export const DEFAULT_ACCOUNT_BASE_URL = "https://apx.didit.me/auth/v2";
/** Milliseconds. */
export const DEFAULT_TIMEOUT = 60_000;
export const DEFAULT_MAX_RETRIES = 2;
const INITIAL_RETRY_DELAY = 500;
const MAX_RETRY_DELAY = 8_000;
const MAX_RETRY_AFTER = 60_000;
const MAX_REDIRECTS = 5;

/** A `fetch` implementation. */
export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Options of the {@link Didit} client (docs/DESIGN.md section 6). */
export interface ClientOptions {
  /** The application's API key (header `x-api-key`). Default: `DIDIT_API_KEY`. */
  apiKey?: string | undefined;
  /** Default: `https://verification.didit.me`. */
  baseURL?: string | undefined;
  /** Needed by application-scoped methods (cases, networks, regulatory reports). Default: `DIDIT_ORGANIZATION_ID`. */
  organizationId?: string | undefined;
  /** Needed by application-scoped methods. Default: `DIDIT_APPLICATION_ID`. */
  applicationId?: string | undefined;
  /** Base URL of the account management API. Default: `https://apx.didit.me/auth/v2`. */
  accountBaseURL?: string | undefined;
  /** The `access_token` from `didit.account.login(...)`, for the account methods that need it. */
  accountToken?: string | undefined;
  /** Milliseconds per attempt. Default: 60 000. */
  timeout?: number | undefined;
  /** Retries of failed requests that are safe to retry. Default: 2. */
  maxRetries?: number | undefined;
  /** Headers to add to every request. */
  defaultHeaders?: Record<string, string> | undefined;
  /** Your own `fetch` (proxies, instrumentation, mocks). Default: the global `fetch`. */
  fetch?: Fetch | undefined;
  /** Extra `fetch` options for every request (for example a proxy `dispatcher` on Node.js). */
  fetchOptions?: RequestInit | undefined;
  /** `debug` logs one line per request. Default: `DIDIT_LOG`, else `off`. */
  logLevel?: LogLevel | undefined;
  /** Where debug lines go. Default: `console`. */
  logger?: Logger | undefined;
}

interface PreparedRequest {
  method: string;
  url: string;
  /** The origin credentials may be sent to. */
  origin: string;
  headers: Headers;
  body: string | FormData | undefined;
  timeout: number;
  maxRetries: number;
  signal: AbortSignal | undefined;
  fetchOptions: RequestInit | undefined;
}

const IDEMPOTENT = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);

// Errors raised before any byte of the request left this process (undici, Bun).
const NOT_SENT = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EADDRNOTAVAIL",
  "UND_ERR_CONNECT_TIMEOUT",
  "ConnectionRefused",
  "FailedToOpenSocket",
]);

function errorCodes(error: unknown, depth = 0): string[] {
  if (typeof error !== "object" || error === null || depth > 4) return [];
  const out: string[] = [];
  const { code, cause, errors } = error as { code?: unknown; cause?: unknown; errors?: unknown };
  if (typeof code === "string") out.push(code);
  out.push(...errorCodes(cause, depth + 1));
  if (Array.isArray(errors)) for (const e of errors) out.push(...errorCodes(e, depth + 1));
  return out;
}

/** Whether a fetch error proves the request never reached the server. */
export function failedBeforeSending(error: unknown): boolean {
  const codes = errorCodes(error);
  return codes.length > 0 && codes.every((c) => NOT_SENT.has(c));
}

/** Whether a response status may be retried (docs/DESIGN.md section 7). */
export function shouldRetryStatus(method: string, status: number): boolean {
  // 429 guarantees the request was not processed, so even POST and PATCH retry.
  if (status === 429) return true;
  if (!IDEMPOTENT.has(method)) return false;
  return status === 408 || status >= 500;
}

/** Milliseconds to wait from a `Retry-After` header (seconds or HTTP date), capped at 60 s. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const text = value.trim();
  let ms: number;
  if (/^[+-]?\d+(\.\d+)?$/.test(text)) ms = Number(text) * 1000;
  else {
    const date = Date.parse(text);
    if (Number.isNaN(date)) return undefined;
    ms = date - now;
  }
  return Math.max(0, Math.min(ms, MAX_RETRY_AFTER));
}

/** Exponential backoff from 0.5 s with full jitter, capped at 8 s. */
export function retryDelay(retriesTaken: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_RETRY_DELAY, INITIAL_RETRY_DELAY * 2 ** retriesTaken);
  return random() * ceiling;
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(signal: AbortSignal | undefined): APIConnectionError {
  return new APIConnectionError("Request was aborted.", { cause: signal?.reason });
}

function validateBaseURL(name: string, value: string): { url: string; origin: string } {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigurationError(
      `${name} must be an absolute http(s) URL, got ${JSON.stringify(value)}.`,
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ConfigurationError(
      `${name} must be an absolute http(s) URL, got ${JSON.stringify(value)}.`,
    );
  }
  if (parsed.username || parsed.password) {
    throw new ConfigurationError(`${name} must not contain credentials.`);
  }
  if (parsed.search || parsed.hash) {
    throw new ConfigurationError(`${name} must not have a query string or fragment.`);
  }
  return { url: parsed.href.replace(/\/+$/, ""), origin: parsed.origin };
}

function scalarText(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return JSON.stringify(value);
}

/** Fill `{name}` placeholders. Empty ids and the dot segments are refused so an id can never change the endpoint. */
export function encodePath(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined || value === null) {
      throw new ConfigurationError(`The path parameter ${name} is required.`);
    }
    const text = scalarText(value);
    if (text === "" || text === "." || text === "..") {
      throw new ConfigurationError(
        `The path parameter ${name} must be a non-empty id, got ${JSON.stringify(text)}.`,
      );
    }
    return encodeURIComponent(text);
  });
}

function jsonBody(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, v: unknown) => {
      if (typeof v === "number" && !Number.isFinite(v)) {
        throw new TypeError(`${v} cannot be sent as JSON`);
      }
      if (typeof v === "bigint") throw new TypeError("a BigInt cannot be sent as JSON");
      return v;
    });
  } catch (error) {
    throw new DiditError(`The request body cannot be sent as JSON: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

async function multipartBody(
  fields: Record<string, unknown>,
  fileFields: ReadonlySet<string>,
): Promise<FormData> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    const isFile = fileFields.has(key) || isUploadable(value);
    if (isFile) {
      const files = Array.isArray(value) ? (value as Uploadable[]) : [value as Uploadable];
      for (const file of files) {
        const prepared = await prepareFile(file);
        form.append(key, prepared.blob, prepared.filename);
      }
    } else if (value instanceof Date) {
      form.append(key, value.toISOString());
    } else if (typeof value === "object") {
      // The API reads structured values in multipart requests as JSON text.
      form.append(key, jsonBody(value));
    } else {
      form.append(key, scalarText(value));
    }
  }
  return form;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function queryKeys(op: OperationSpec): [string, string][] {
  return (op.query ?? []).map((q) => (typeof q === "string" ? [q, q] : [q[0], q[1]]));
}

/**
 * Sends the requests of every generated resource method. Use {@link Didit},
 * which adds the resources.
 */
export class APIClient {
  /** Base URL of the verification API. */
  readonly baseURL: string;
  /** Base URL of the account management API. */
  readonly accountBaseURL: string;
  readonly organizationId: string | undefined;
  readonly applicationId: string | undefined;
  /** Milliseconds per attempt. */
  readonly timeout: number;
  readonly maxRetries: number;
  /** Date-time decoding plans of the named response types; set by the generated resources. */
  protected readonly datePlans: Readonly<Record<string, DatePlan>> = {};

  // Private fields: never enumerable, so logging the client never shows the key.
  readonly #options: ClientOptions;
  readonly #apiKey: string | undefined;
  readonly #accountToken: string | undefined;
  readonly #origin: string;
  readonly #accountOrigin: string;
  readonly #fetch: Fetch;
  readonly #logLevel: LogLevel;
  readonly #logger: Logger;

  constructor(options: ClientOptions = {}) {
    this.#options = { ...options };
    this.#apiKey = options.apiKey ?? readEnv("DIDIT_API_KEY");
    // An empty token counts as none.
    this.#accountToken = options.accountToken || undefined;
    this.organizationId = options.organizationId ?? readEnv("DIDIT_ORGANIZATION_ID");
    this.applicationId = options.applicationId ?? readEnv("DIDIT_APPLICATION_ID");
    const base = validateBaseURL("baseURL", options.baseURL ?? DEFAULT_BASE_URL);
    const account = validateBaseURL(
      "accountBaseURL",
      options.accountBaseURL ?? DEFAULT_ACCOUNT_BASE_URL,
    );
    this.baseURL = base.url;
    this.#origin = base.origin;
    this.accountBaseURL = account.url;
    this.#accountOrigin = account.origin;
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new ConfigurationError("timeout must be a positive number of milliseconds.");
    }
    this.timeout = timeout;
    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    if (!Number.isInteger(maxRetries) || maxRetries < 0) {
      throw new ConfigurationError("maxRetries must be an integer, 0 or more.");
    }
    this.maxRetries = maxRetries;
    const fetchImpl = options.fetch ?? (globalThis as { fetch?: Fetch }).fetch;
    if (typeof fetchImpl !== "function") {
      throw new ConfigurationError("No fetch implementation: pass one as the fetch option.");
    }
    this.#fetch = fetchImpl;
    this.#logLevel = options.logLevel ?? envLogLevel();
    this.#logger = options.logger ?? {
      debug: (message: string) => {
        console.debug(message);
      },
    };
  }

  /** The options this client was created with, merged with `overrides` (for `withOptions`). */
  protected mergedOptions(overrides: ClientOptions): ClientOptions {
    return { ...this.#options, ...overrides };
  }

  // Requests -------------------------------------------------------------------

  /** Send one operation and parse its response. Used by the generated resources. */
  request<T>(
    op: OperationSpec,
    pathArgs: readonly string[],
    params: unknown,
    options?: RequestOptions,
  ): APIPromise<T> {
    const raw = this.#prepare(op, pathArgs, params, options).then((prepared) =>
      this.#send(prepared),
    );
    return new APIPromise<T>(raw, (r) => this.#parse<T>(op, r));
  }

  /** Send a list operation; the result can be awaited or iterated with `for await`. */
  requestPage<R, Item>(
    op: OperationSpec,
    pathArgs: readonly string[],
    params: unknown,
    options?: RequestOptions,
  ): PagePromise<R, Item> {
    const prepared = this.#prepare(op, pathArgs, params, options);
    const raw = prepared.then((p) => this.#send(p));
    return new PagePromise<R, Item>(raw, async (r) => this.#page<R, Item>(op, await prepared, r));
  }

  async #page<R, Item>(
    op: OperationSpec,
    prepared: PreparedRequest,
    raw: RawResponse,
  ): Promise<Page<R, Item>> {
    const invalid = (message: string, response: Response): APIResponseValidationError =>
      new APIResponseValidationError(message, response.status, response.headers);
    const build = async (current: string, response: RawResponse): Promise<Page<R, Item>> => {
      const body = await this.#parse<R>(op, response);
      if (!isRecord(body)) {
        throw invalid("The API returned a list response that is not an object.", response.response);
      }
      const fetchNext = async (next: string, seen: Set<string>): Promise<Page<R, Item>> => {
        let target: URL;
        try {
          target = new URL(next, current);
        } catch {
          throw invalid("The API returned an invalid pagination link.", response.response);
        }
        if (
          (target.protocol !== "https:" && target.protocol !== "http:") ||
          target.origin !== prepared.origin
        ) {
          throw invalid(
            `Refusing to follow a pagination link to another origin (${target.origin}); ` +
              `the credentials are only sent to ${prepared.origin}.`,
            response.response,
          );
        }
        if (seen.has(target.href)) {
          throw invalid(
            "The API returned a pagination link that repeats an earlier page.",
            response.response,
          );
        }
        seen.add(target.href);
        const nextRaw = await this.#send({
          ...prepared,
          method: "GET",
          url: target.href,
          body: undefined,
        });
        return build(target.href, nextRaw);
      };
      return makePage<R, Item>(body, current, fetchNext);
    };
    return build(prepared.url, raw);
  }

  async #prepare(
    op: OperationSpec,
    pathArgs: readonly string[],
    params: unknown,
    options: RequestOptions = {},
  ): Promise<PreparedRequest> {
    const account = op.api === "account";
    const base = account ? this.accountBaseURL : this.baseURL;
    const origin = account ? this.#accountOrigin : this.#origin;

    // Path: application scope first, then the positional ids in template order.
    const values: Record<string, unknown> = {};
    const names = [...op.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] ?? "");
    let positional = names;
    if (op.scope === "application") {
      if (!this.organizationId || !this.applicationId) {
        throw new ConfigurationError(
          "This method is application scoped: pass organizationId and applicationId to the client " +
            "(or set DIDIT_ORGANIZATION_ID and DIDIT_APPLICATION_ID).",
        );
      }
      values.organization_id = this.organizationId;
      values.application_id = this.applicationId;
      positional = names.filter((n) => n !== "organization_id" && n !== "application_id");
    }
    positional.forEach((name, i) => {
      values[name] = pathArgs[i];
    });
    const url = new URL(base + encodePath(op.path, values));

    // Credentials, checked before anything is sent.
    const auth = op.auth ?? "api_key";
    const apiKey = this.#apiKey;
    const accountToken = this.#accountToken;
    if (auth === "api_key" && !apiKey) {
      throw new ConfigurationError(
        "No API key: pass apiKey to the client or set the DIDIT_API_KEY environment variable.",
      );
    }
    if (auth === "account_token" && !accountToken) {
      throw new ConfigurationError(
        "This account method needs an account token: call didit.account.login(...) and pass its " +
          "access_token as accountToken (didit.withOptions({ accountToken })).",
      );
    }

    // Query string and body fields.
    const fields: Record<string, unknown> =
      isRecord(params) && op.body !== "whole" ? { ...params } : {};
    for (const [key, wire] of queryKeys(op)) {
      const value = fields[key];
      Reflect.deleteProperty(fields, key);
      if (value === undefined || value === null) continue;
      for (const item of Array.isArray(value) ? (value as unknown[]) : [value]) {
        url.searchParams.append(wire, scalarText(item));
      }
    }
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.append(key, scalarText(value));
    }

    const headers = new Headers();
    headers.set("Accept", op.accept ?? "application/json");
    headers.set("User-Agent", userAgent());
    headers.set("X-Didit-Client", clientHeader());
    for (const [name, value] of Object.entries(this.#options.defaultHeaders ?? {}))
      headers.set(name, value);
    // Credentials only ever go to the origin of the API they belong to.
    if (auth === "api_key") headers.set("x-api-key", apiKey ?? "");
    else if (auth === "account_token") headers.set("Authorization", `Bearer ${accountToken ?? ""}`);

    let body: string | FormData | undefined;
    if (op.body === "whole") {
      if (params !== undefined) {
        body = jsonBody(params);
        headers.set("Content-Type", "application/json");
      }
    } else if (op.body !== undefined) {
      Object.assign(fields, options.body ?? {});
      const files = new Set(op.files ?? []);
      const multipart =
        op.body === "multipart" ||
        (op.body === "auto" && [...files].some((name) => isUploadable(fields[name])));
      if (multipart) {
        body = await multipartBody(fields, files);
      } else {
        body = jsonBody(fields);
        headers.set("Content-Type", "application/json");
      }
    }
    if (options.idempotencyKey !== undefined)
      headers.set("Idempotency-Key", options.idempotencyKey);
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      if (value === null) headers.delete(name);
      else if (value !== undefined) headers.set(name, value);
    }

    const timeout = options.timeout ?? this.timeout;
    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new ConfigurationError("timeout must be a positive number of milliseconds.");
    }
    const maxRetries = options.maxRetries ?? this.maxRetries;
    if (!Number.isInteger(maxRetries) || maxRetries < 0) {
      throw new ConfigurationError("maxRetries must be an integer, 0 or more.");
    }
    const fetchOptions =
      this.#options.fetchOptions || options.fetchOptions
        ? { ...this.#options.fetchOptions, ...options.fetchOptions }
        : undefined;
    return {
      method: op.method,
      url: url.href,
      origin,
      headers,
      body,
      timeout,
      maxRetries,
      signal: options.signal,
      fetchOptions,
    };
  }

  #secrets(): string[] {
    return [this.#apiKey, this.#accountToken].filter(
      (s): s is string => typeof s === "string" && s !== "",
    );
  }

  #log(
    method: string,
    url: string,
    started: number,
    attempt: number,
    response?: Response,
    error?: string,
  ): void {
    if (this.#logLevel !== "debug") return;
    const line: Parameters<typeof formatLogLine>[0] = {
      method,
      url,
      status: response ? response.status : null,
      durationMs: Date.now() - started,
      requestId: response ? requestIdOf(response.headers) : null,
      attempt,
    };
    if (error !== undefined) line.error = error;
    this.#logger.debug(formatLogLine(line));
  }

  /** Send with retries; resolves with a 2xx response whose body is not read yet. */
  async #send(prepared: PreparedRequest): Promise<RawResponse> {
    const { method, signal } = prepared;
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw abortError(signal);
      const controller = new AbortController();
      const timedOut = { value: false };
      const timer = setTimeout(() => {
        timedOut.value = true;
        controller.abort();
      }, prepared.timeout);
      const onAbort = (): void => {
        controller.abort();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      const done = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      const started = Date.now();
      let response: Response;
      try {
        response = await this.#fetchFollowingRedirects(prepared, controller.signal);
      } catch (error) {
        done();
        if (signal?.aborted) throw abortError(signal);
        const label = timedOut.value ? "timeout" : "connection error";
        this.#log(method, prepared.url, started, attempt, undefined, label);
        const retry = timedOut.value
          ? IDEMPOTENT.has(method)
          : IDEMPOTENT.has(method) || failedBeforeSending(error);
        if (retry && attempt < prepared.maxRetries) {
          await sleep(retryDelay(attempt), signal);
          continue;
        }
        if (timedOut.value) throw new APITimeoutError(undefined, { cause: error });
        if (error instanceof DiditError) throw error;
        throw new APIConnectionError(undefined, { cause: error });
      }
      this.#log(method, prepared.url, started, attempt, response);
      if (response.status >= 200 && response.status < 300) {
        return { response, done, timedOut: () => timedOut.value };
      }

      // An error status: read the body (still under the timeout) for the error.
      let text = "";
      try {
        text = await response.text();
      } catch {
        // Keep what we have; the status says enough.
      } finally {
        done();
      }
      if (shouldRetryStatus(method, response.status) && attempt < prepared.maxRetries) {
        const wait = parseRetryAfter(response.headers.get("retry-after")) ?? retryDelay(attempt);
        await sleep(wait, signal);
        continue;
      }
      let body: unknown = text === "" ? null : text;
      try {
        if (text) body = JSON.parse(text);
      } catch {
        // Not JSON: keep the text.
      }
      throw makeStatusError(response.status, body, response.headers, this.#secrets());
    }
  }

  /**
   * fetch with `redirect: "manual"`: the API key must never follow a redirect to
   * another origin, so only same-origin redirects of GET and HEAD are followed.
   */
  async #fetchFollowingRedirects(
    prepared: PreparedRequest,
    signal: AbortSignal,
  ): Promise<Response> {
    let url = prepared.url;
    for (let hop = 0; ; hop++) {
      const init: RequestInit = {
        ...prepared.fetchOptions,
        method: prepared.method,
        headers: prepared.headers,
        signal,
        redirect: "manual",
      };
      if (prepared.body !== undefined) init.body = prepared.body;
      const response = await this.#fetch(url, init);
      const location = response.headers.get("location");
      const redirect = [301, 302, 303, 307, 308].includes(response.status) && location !== null;
      if (
        !redirect ||
        hop >= MAX_REDIRECTS ||
        (prepared.method !== "GET" && prepared.method !== "HEAD")
      ) {
        return response;
      }
      const target = new URL(location, url);
      if (target.origin !== prepared.origin) return response;
      await response.body?.cancel();
      url = target.href;
    }
  }

  async #parse<T>(op: OperationSpec, raw: RawResponse): Promise<T> {
    const { response } = raw;
    try {
      if (op.response === "none") {
        await response.body?.cancel();
        return undefined as T;
      }
      if (op.response === "binary") {
        const blob = await response.blob();
        const type = response.headers.get("content-type");
        return (type && blob.type !== type ? new Blob([blob], { type }) : blob) as T;
      }
      const text = await response.text();
      if (response.status === 204 || text.trim() === "") return null as T;
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch (error) {
        throw new APIResponseValidationError(
          `The API returned a ${response.status} response that is not JSON.`,
          response.status,
          response.headers,
          { cause: error },
        );
      }
      return decodeDates(data, op.dates, this.datePlans) as T;
    } catch (error) {
      if (error instanceof DiditError) throw error;
      if (raw.timedOut()) throw new APITimeoutError(undefined, { cause: error });
      // Reading the body failed: the connection broke.
      throw new APIConnectionError("The connection failed while reading the response.", {
        cause: error,
      });
    } finally {
      raw.done();
    }
  }
}
