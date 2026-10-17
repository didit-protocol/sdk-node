/** Options for one request; they override the client's options for that request only. */
export interface RequestOptions {
  /** Milliseconds before the request is abandoned (each attempt). Default: the client's `timeout`. */
  timeout?: number;
  /** Retries of failed requests that are safe to retry. Default: the client's `maxRetries`. */
  maxRetries?: number;
  /** Extra headers; `null` removes a header the SDK would send (never the credentials). */
  headers?: Record<string, string | null | undefined>;
  /** Extra query parameters. */
  query?: Record<string, string | number | boolean | Date | null | undefined>;
  /** Extra top-level fields for the JSON or multipart body. */
  body?: Record<string, unknown>;
  /** The `Idempotency-Key` header, for the operations that accept it. */
  idempotencyKey?: string;
  /** Cancels the request (and its retries). */
  signal?: AbortSignal;
  /** Extra `fetch` options for this request (for example a proxy `dispatcher` on Node.js). */
  fetchOptions?: RequestInit;
}
