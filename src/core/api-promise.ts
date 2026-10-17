import { requestIdOf } from "./errors.js";

/** A response that arrived and is not yet read. */
export interface RawResponse {
  response: Response;
  /** Stop the request timeout; called once the body is read. */
  done(): void;
}

/** The parsed value together with the HTTP response it came from. */
export interface WithResponse<T> {
  data: T;
  /** The HTTP response (status, headers). Its body has been read. */
  response: Response;
  /** The request id the API returned, when it returned one. Quote it to support. */
  requestId: string | null;
}

/**
 * The result of every API method: a Promise of the parsed response, with access
 * to the raw HTTP response (docs/DESIGN.md section 7).
 *
 * ```ts
 * const session = await didit.sessions.create({ workflow_id });
 * const { data, response, requestId } = await didit.sessions.create({ workflow_id }).withResponse();
 * const raw = await didit.sessions.create({ workflow_id }).asResponse();
 * ```
 */
export class APIPromise<T> extends Promise<T> {
  readonly #raw: Promise<RawResponse>;
  readonly #parse: (raw: RawResponse) => Promise<T>;
  #parsed: Promise<WithResponse<T>> | undefined;

  constructor(raw: Promise<RawResponse>, parse: (raw: RawResponse) => Promise<T>) {
    super((resolve) => {
      // The base promise is never observed: then/catch/finally use the parsed one.
      resolve(undefined as T);
    });
    this.#raw = raw;
    this.#parse = parse;
    // The request may fail before anyone awaits it; that is reported when they do.
    raw.catch(() => undefined);
  }

  // Promise methods that build a new promise use the plain Promise class.
  static override get [Symbol.species](): PromiseConstructor {
    return Promise;
  }

  /** The raw HTTP response, unread: for streaming a body or reading headers only. */
  asResponse(): Promise<Response> {
    return this.#raw.then((raw) => {
      raw.done();
      return raw.response;
    });
  }

  /** The parsed value, the HTTP response and its request id. */
  withResponse(): Promise<WithResponse<T>> {
    this.#parsed ??= this.#raw.then(async (raw) => {
      const data = await this.#parse(raw);
      return { data, response: raw.response, requestId: requestIdOf(raw.response.headers) };
    });
    return this.#parsed;
  }

  override then<R1 = T, R2 = never>(
    onfulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.withResponse().then((r) => r.data).then(onfulfilled, onrejected);
  }

  override catch<R = never>(
    onrejected?: ((reason: unknown) => R | PromiseLike<R>) | null,
  ): Promise<T | R> {
    return this.then(undefined, onrejected);
  }

  override finally(onfinally?: (() => void) | null): Promise<T> {
    return this.then().finally(onfinally);
  }
}
