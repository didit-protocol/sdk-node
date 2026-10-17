// `Authentication` (docs/DESIGN.md section 10): verifies the tokens an
// application's issuer signs and calls its token, session and step-up
// endpoints. The decisions live in the pure helpers (jwt.ts, cache.ts,
// issuer.ts); this file wires them to the issuer over fetch.

import {
  APIConnectionError,
  APIResponseValidationError,
  APIStatusError,
  ConfigurationError,
  TokenVerificationError,
} from "../core/errors.js";
import { envLogLevel, type Logger, type LogLevel } from "../core/logger.js";
import { webCrypto } from "../core/runtime.js";
import { IssuerCache, parseDiscovery, parseKeySet, type Discovery, type KeySet } from "./cache.js";
import { isRecord } from "./encoding.js";
import { pathOf, send, type IssuerRequest, type IssuerResponse, type Transport } from "./http.js";
import { normaliseIssuer, parsePublishableKey } from "./issuer.js";
import { checkClaims, parseToken, shown, type ParsedToken, type TokenKind } from "./jwt.js";
import type {
  AccessTokenClaims,
  AuthenticationSession,
  IdTokenClaims,
  StepUp,
  StepUpAction,
  StepUpNotRequired,
  TokenResponse,
} from "./types.js";

const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_LEEWAY = 60;
const DISCOVERY_PATH = ".well-known/openid-configuration";
const JWKS_PATH = ".well-known/jwks.json";
const TOKEN_PATH = "token/";
const SESSION_PATH = "session/";
const STEP_UP_PATH = "step-up/";
// Sent as written, so only plain ASCII decimals ("1500.00"): no exponents,
// separators, other digits or NaN, which the issuer would read differently.
const DECIMAL_TEXT = /^-?[0-9]+(\.[0-9]+)?$/;

/** One audience (the application id) or several, any of which is accepted. */
export type Audience = string | readonly string[];

/** A money amount: a decimal string such as `"1500.00"`, or a finite number. Sent as a decimal string. */
export type Amount = string | number;

/** Options of `new Authentication(...)`. */
export interface AuthenticationOptions {
  /**
   * The application's issuer: `https://<slug>.auth.didit.me`,
   * `https://<slug>.sandbox.auth.didit.me` or its active custom domain. A
   * trailing slash is removed. Plain http only for localhost while testing.
   */
  issuer: string;
  /**
   * The application id. When set it is sent with token requests (the issuer
   * checks it) and is the default audience of `verifyAccessToken` and
   * `verifyIdToken`.
   */
  clientId?: string | null;
  /** The fetch implementation; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Milliseconds a request to the issuer may take, body included. Default 10 000. */
  timeout?: number;
  /** Seconds of clock skew allowed for `exp`, `nbf` and `iat`. Default 60. */
  leeway?: number;
  /** `debug` logs one line per request (never tokens); defaults to `DIDIT_LOG`. */
  logLevel?: LogLevel;
  /** Where debug lines go; defaults to `console`. */
  logger?: Logger;
  /** Extra headers sent with every request to the issuer. */
  defaultHeaders?: Record<string, string>;
}

/** Options of `verifyAccessToken`. */
export interface VerifyAccessTokenOptions {
  /** `aud` must contain this (or one of these); defaults to `clientId` when configured. */
  audience?: Audience;
}

/** Options of `verifyIdToken`. */
export interface VerifyIdTokenOptions {
  /**
   * The nonce sent with this sign-in's authorization request; the ID token must
   * carry the same value. Pass `null` only for an ID token returned by
   * `refresh`, which carries no nonce.
   */
  nonce: string | null;
  /** `aud` must contain this (or one of these). Required unless `clientId` is configured. */
  audience?: Audience;
}

/** Arguments of `exchangeCode`. */
export interface ExchangeCodeParams {
  /** The `code` of the callback, after you checked its `state`. */
  code: string;
  /** The PKCE verifier of this sign-in (`createPkce().codeVerifier`). */
  codeVerifier: string;
  /** Exactly the redirect URI the sign-in used. */
  redirectUri: string;
}

/** Arguments of `createStepUp`. */
export interface CreateStepUpParams {
  /** `payout` (with `amount` and an optional `currency`), `bank` or `contact`. */
  action: StepUpAction;
  /** The payout amount: a decimal string such as `"1500.00"` or a finite number. */
  amount?: Amount;
  /** A three-letter ISO 4217 code such as `"EUR"`. */
  currency?: string;
  /**
   * Where the person comes back after verifying; one of the application's
   * registered redirect URIs. The issuer currently requires it and answers
   * HTTP 400 (`BadRequestError`) without it.
   */
  returnTo?: string;
}

/** The fields of an options object; a JavaScript caller may pass nothing where one is required. */
function fieldsOf<T extends object>(value: T | undefined): Partial<T> {
  return value ?? {};
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} is empty.`);
  return value.trim();
}

function bearerToken(value: unknown, name: string): string {
  const token = requiredText(value, name);
  // Checked here so that fetch never echoes a bad header value (the token) in its error.
  for (let i = 0; i < token.length; i++) {
    const code = token.charCodeAt(i);
    if (code < 0x21 || code > 0x7e) {
      throw new TypeError(`${name} contains characters that cannot be sent in a header.`);
    }
  }
  return token;
}

function optionalText(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new TypeError(`${name} must be a string.`);
  return value;
}

/** A number in plain decimal notation, as Python's `format(Decimal(repr(x)), "f")` writes it. */
function plainDecimal(value: number): string {
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
  if (!match) return text;
  const [, sign = "", whole = "", fraction = "", exponentText = "0"] = match;
  const digits = whole + fraction;
  const point = whole.length + Number(exponentText);
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return sign + digits + "0".repeat(point - digits.length);
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

function amountText(amount: unknown): string {
  if (typeof amount === "string") {
    const text = amount.trim();
    if (!DECIMAL_TEXT.test(text)) {
      throw new TypeError(
        `amount must be a decimal number such as "1500.00", got ${shown(amount)}.`,
      );
    }
    return text;
  }
  if (typeof amount === "number") {
    if (!Number.isFinite(amount))
      throw new TypeError(`amount must be a finite number, got ${amount}.`);
    return plainDecimal(amount);
  }
  throw new TypeError("amount must be a decimal string or a number.");
}

/** A path segment from a caller-supplied id: never empty, `.` or `..`, and percent-encoded. */
function pathSegment(value: unknown, name: string): string {
  if (typeof value !== "string" || value === "" || value === "." || value === "..") {
    throw new TypeError(`${name} must be a non-empty id.`);
  }
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function sameOrigin(url: URL, origin: URL): boolean {
  return url.origin === origin.origin && !url.username && !url.password;
}

/**
 * Didit Authentication for your backend: verify the tokens your application's
 * issuer signs and call its token, session and step-up endpoints.
 *
 * ```ts
 * const auth = Authentication.fromPublishableKey("pk_live_...", { clientId: APPLICATION_ID });
 * const claims = await auth.verifyAccessToken(accessToken);
 * console.log(claims.sub, claims.vendor_data);
 * ```
 *
 * It never takes or sends your Didit API key, and sends nothing to any origin
 * but the issuer's. The discovery document and the issuer's keys are fetched on
 * first use, cached, and shared by concurrent calls; create one instance per
 * issuer and reuse it.
 */
export class Authentication {
  /** The issuer every token must name in `iss`, without a trailing slash. */
  readonly issuer: string;
  /** The application id: sent with token requests and the default audience. */
  readonly clientId: string | null;
  /** Seconds of clock skew allowed for `exp`, `nbf` and `iat`. */
  readonly leeway: number;
  /** Milliseconds a request to the issuer may take. */
  readonly timeout: number;

  readonly #origin: URL;
  readonly #transport: Transport;
  readonly #cache = new IssuerCache(() => Date.now() / 1000);
  #discoveryFetch: Promise<Discovery> | undefined;
  #keySetFetch: Promise<KeySet> | undefined;

  /** Throws `ConfigurationError` for an invalid issuer or option; sends no request. */
  constructor(options: AuthenticationOptions) {
    const given = fieldsOf(options);
    this.issuer = normaliseIssuer(given.issuer);
    this.#origin = new URL(this.issuer);
    const clientId: unknown = given.clientId;
    if (
      clientId !== undefined &&
      clientId !== null &&
      (typeof clientId !== "string" || !clientId.trim())
    ) {
      throw new ConfigurationError("clientId is empty: pass your application id or leave it out.");
    }
    this.clientId = typeof clientId === "string" ? clientId.trim() : null;
    const leeway: unknown = given.leeway ?? DEFAULT_LEEWAY;
    if (typeof leeway !== "number" || !Number.isFinite(leeway) || leeway < 0) {
      throw new ConfigurationError("leeway must be 0 or more seconds.");
    }
    this.leeway = leeway;
    const timeout: unknown = given.timeout ?? DEFAULT_TIMEOUT;
    if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0) {
      throw new ConfigurationError("timeout must be a positive number of milliseconds.");
    }
    this.timeout = timeout;
    const fetchImpl: unknown = given.fetch;
    if (fetchImpl !== undefined && typeof fetchImpl !== "function") {
      throw new ConfigurationError("fetch must be a function compatible with the global fetch.");
    }
    let defaultHeaders: Headers;
    try {
      defaultHeaders = new Headers(given.defaultHeaders);
    } catch (error) {
      throw new ConfigurationError("defaultHeaders must map header names to string values.", {
        cause: error,
      });
    }
    const level = given.logLevel ?? envLogLevel();
    this.#transport = {
      fetch: fetchImpl as typeof fetch | undefined,
      timeout,
      defaultHeaders,
      logger: level === "debug" ? (given.logger ?? console) : null,
    };
  }

  /**
   * The client for the issuer a `pk_live_` or `pk_test_` publishable key carries
   * (see `parsePublishableKey`).
   */
  static fromPublishableKey(
    key: string,
    options: Omit<AuthenticationOptions, "issuer"> = {},
  ): Authentication {
    return new Authentication({ ...options, issuer: parsePublishableKey(key).issuer });
  }

  // Tokens --------------------------------------------------------------------

  /**
   * Verify an access token offline and return its claims (the JWT payload).
   *
   * Checks, in order: the header (`alg` ES256 only, so `none`, HS*, RS*, PS*,
   * EdDSA and every other algorithm are refused; `typ` `at+jwt`), the ES256
   * signature against the issuer's published key with the token's `kid`, then
   * `iss` (equal to the issuer), `sub`, `exp`, `nbf` and `iat` (with `leeway`
   * seconds of clock skew) and, when `audience` is given or `clientId` is
   * configured, `aud`.
   *
   * An offline check cannot see a session revoked a moment ago: access tokens
   * expire within five minutes. Call `getSession` when the action needs an
   * instant revocation check.
   *
   * Throws `TokenVerificationError` (answer 401) with a machine-readable
   * `reason`; `APIConnectionError`, `APIStatusError` or
   * `APIResponseValidationError` (answer 503) when the issuer's keys cannot be
   * fetched.
   */
  async verifyAccessToken(
    token: string,
    options?: VerifyAccessTokenOptions,
  ): Promise<AccessTokenClaims> {
    const audience = this.#audience(options?.audience, false);
    const parsed = parseToken(token, "access");
    const claims = await this.#verify(parsed, "access", audience, null);
    return claims as AccessTokenClaims;
  }

  /**
   * Verify an ID token and return its claims (the JWT payload).
   *
   * The same checks as `verifyAccessToken` (`typ` must be `JWT` or absent, never
   * `at+jwt`), plus `aud`, which is always checked: pass `audience` or configure
   * `clientId`. `nonce` must equal the nonce you sent with the authorization
   * request; pass `null` only for an ID token returned by `refresh`, which
   * carries no nonce.
   */
  async verifyIdToken(token: string, options: VerifyIdTokenOptions): Promise<IdTokenClaims> {
    const given = fieldsOf(options);
    const audience = this.#audience(given.audience, true);
    const nonce: unknown = given.nonce;
    if (nonce !== null && (typeof nonce !== "string" || !nonce)) {
      throw new TypeError(
        "nonce is empty: pass the nonce of this sign-in, or null for an ID token returned by refresh().",
      );
    }
    const parsed = parseToken(token, "id");
    const claims = await this.#verify(parsed, "id", audience, nonce);
    return claims as IdTokenClaims;
  }

  /**
   * Exchange an authorization code for tokens (`POST token/`, form encoded).
   *
   * Check the callback's `state` first. The code is single use and expires
   * after 60 seconds. Never retried. A used, expired or unknown code, or a
   * verifier or redirect URI that does not match, is a `BadRequestError` with
   * body `{"error": "invalid_grant"}`; `mfa_required` means the person still
   * has to complete a second factor.
   */
  async exchangeCode(params: ExchangeCodeParams): Promise<TokenResponse> {
    const given = fieldsOf(params);
    const code = requiredText(given.code, "code");
    const codeVerifier = requiredText(given.codeVerifier, "codeVerifier");
    const redirectUri = requiredText(given.redirectUri, "redirectUri");
    const form = {
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    };
    return this.#token(form, [code, codeVerifier]);
  }

  /**
   * Swap a refresh token for new tokens (`POST token/`, form encoded).
   *
   * Refresh tokens are single use: replace both tokens with the result.
   * Serialise refreshes for one session (one at a time, across processes and
   * browser tabs), because presenting a refresh token that was already used
   * revokes the whole session. For the same reason this request is never
   * retried; if its outcome is unknown, sign the person in again.
   */
  async refresh(refreshToken: string): Promise<TokenResponse> {
    const token = requiredText(refreshToken, "refreshToken");
    return this.#token({ grant_type: "refresh_token", refresh_token: token }, [token]);
  }

  // Sessions and step-ups -----------------------------------------------------

  /**
   * The live session behind `accessToken` (`GET session/`).
   *
   * The instant revocation check: unlike `verifyAccessToken` it fails
   * (`AuthenticationError`, HTTP 401) as soon as the session is revoked,
   * expired or idle, or the token was replaced by a refresh. Agent access
   * tokens are refused here.
   */
  async getSession(accessToken: string): Promise<AuthenticationSession> {
    const token = bearerToken(accessToken, "accessToken");
    const call = this.#bearerCall("GET", SESSION_PATH, token);
    return (await this.#object(call)) as AuthenticationSession;
  }

  /**
   * Sign the person out: revoke the session behind `accessToken`
   * (`DELETE session/`). Never retried: a revoked session no longer accepts its
   * token, so calling it again after an unknown outcome answers 401.
   */
  async revokeSession(accessToken: string): Promise<void> {
    const token = bearerToken(accessToken, "accessToken");
    await this.#send(this.#bearerCall("DELETE", SESSION_PATH, token));
  }

  /**
   * Ask whether the person must verify before a sensitive action
   * (`POST step-up/`). Never retried.
   *
   * `{ required: false }` (HTTP 200) means no rule applies and the action may
   * go ahead. Otherwise (HTTP 201) send the person to `verification_url`; they
   * come back to `returnTo` with `step_up=<id>&status=approved`, which proves
   * nothing: call `retrieveStepUp` and act only on status `approved`.
   *
   * The issuer currently requires `returnTo` and answers HTTP 400
   * (`BadRequestError`) without it.
   */
  async createStepUp(
    accessToken: string,
    params: CreateStepUpParams,
  ): Promise<StepUp | StepUpNotRequired> {
    const token = bearerToken(accessToken, "accessToken");
    const given = fieldsOf(params);
    const body: Record<string, unknown> = { action: requiredText(given.action, "action") };
    const amount: unknown = given.amount;
    if (amount !== undefined && amount !== null) body.amount = amountText(amount);
    const currency = optionalText(given.currency, "currency");
    if (currency !== undefined) body.currency = currency;
    const returnTo = optionalText(given.returnTo, "returnTo");
    if (returnTo !== undefined) body.return_to = returnTo;
    const call = { ...this.#bearerCall("POST", STEP_UP_PATH, token), json: body };
    return (await this.#object(call)) as StepUp | StepUpNotRequired;
  }

  /**
   * Read a step-up (`GET step-up/{id}/`) with a token of the session that asked
   * for it. Act only when its `status` is `approved`; `pending`, `review`,
   * `declined`, `expired`, `superseded` and any other value all mean no. A
   * step-up of another session is a `NotFoundError`.
   */
  async retrieveStepUp(accessToken: string, id: string): Promise<StepUp> {
    const token = bearerToken(accessToken, "accessToken");
    const path = `${STEP_UP_PATH}${pathSegment(id, "id")}/`;
    return (await this.#object(this.#bearerCall("GET", path, token))) as StepUp;
  }

  // Requests ------------------------------------------------------------------

  #url(path: string): string {
    return `${this.issuer}/${path}`;
  }

  #bearerCall(method: IssuerRequest["method"], path: string, token: string): IssuerRequest {
    return { method, url: this.#url(path), bearer: token, secrets: [token] };
  }

  #send(call: IssuerRequest): Promise<IssuerResponse> {
    return send(this.#transport, call);
  }

  async #object(call: IssuerRequest): Promise<Record<string, unknown>> {
    const response = await this.#send(call);
    if (!isRecord(response.data)) {
      throw new APIResponseValidationError(
        `Expected a JSON object from ${call.method} ${pathOf(call.url)}.`,
        response.status,
        response.headers,
      );
    }
    return response.data;
  }

  async #token(form: Record<string, string>, secrets: readonly string[]): Promise<TokenResponse> {
    const discovery = await this.#discovery();
    const body = this.clientId ? { ...form, client_id: this.clientId } : form;
    const url = discovery.tokenEndpoint ?? this.#url(TOKEN_PATH);
    return (await this.#object({ method: "POST", url, form: body, secrets })) as TokenResponse;
  }

  // Discovery and keys --------------------------------------------------------

  /** The discovery document: cached, or fetched once for every concurrent caller. */
  #discovery(): Promise<Discovery> {
    const cached = this.#cache.discovery();
    if (cached) return Promise.resolve(cached);
    this.#discoveryFetch ??= this.#fetchDiscovery().finally(() => {
      this.#discoveryFetch = undefined;
    });
    return this.#discoveryFetch;
  }

  async #fetchDiscovery(): Promise<Discovery> {
    const url = this.#url(DISCOVERY_PATH);
    const response = await this.#send({ method: "GET", url });
    const invalid = (message: string): APIResponseValidationError =>
      new APIResponseValidationError(message, response.status, response.headers);
    const discovery = parseDiscovery(response.data);
    if (!discovery) throw invalid("The issuer's discovery document is not a JSON object.");
    if (discovery.issuer === null)
      throw invalid(`The discovery document at ${url} names no issuer.`);
    if (discovery.issuer !== this.issuer) {
      // Not cached and not counted as a failed fetch: it is raised every time.
      throw new ConfigurationError(
        `The discovery document at ${url} names the issuer ${shown(discovery.issuer)}, ` +
          `not ${JSON.stringify(this.issuer)}. Configure Authentication with the issuer it names ` +
          "(an application's issuer changes when its custom domain is activated).",
      );
    }
    // Codes and refresh tokens go to the token endpoint, and the keys decide which
    // tokens are trusted: neither may downgrade to plain http or leave the issuer's origin.
    const endpoints = [
      ["token_endpoint", discovery.tokenEndpoint],
      ["jwks_uri", discovery.jwksUri],
    ] as const;
    for (const [name, value] of endpoints) {
      if (value === null) continue;
      const endpoint = new URL(value);
      if (endpoint.protocol !== "https:" && endpoint.protocol !== this.#origin.protocol) {
        throw invalid(`The discovery document's ${name} ${shown(value)} does not use https.`);
      }
      if (!sameOrigin(endpoint, this.#origin)) {
        throw invalid(
          `The discovery document's ${name} ${shown(value)} is not on the issuer's origin ${this.#origin.origin}.`,
        );
      }
    }
    return this.#cache.storeDiscovery(discovery, response.headers);
  }

  /** The key set to look `kid` up in: cached, or fetched once for every concurrent caller. */
  async #keySetFor(kid: string): Promise<KeySet> {
    for (;;) {
      const cached = this.#cache.keySetFor(kid);
      if (cached) return cached;
      if (!this.#keySetFetch) {
        if (this.#cache.keySetUnavailable()) {
          throw new APIConnectionError(
            "The issuer's keys could not be fetched less than a minute ago; the next attempt " +
              "is made once that minute has passed.",
          );
        }
        this.#keySetFetch = this.#fetchKeySet().finally(() => {
          this.#keySetFetch = undefined;
        });
      }
      // Then look again: the kid is in the new key set, or it is unknown for a minute.
      await this.#keySetFetch;
    }
  }

  async #fetchKeySet(): Promise<KeySet> {
    try {
      const discovery = await this.#discovery();
      const url = discovery.jwksUri ?? this.#url(JWKS_PATH);
      const response = await this.#send({ method: "GET", url });
      const keySet = parseKeySet(response.data);
      if (!keySet) {
        throw new APIResponseValidationError(
          'The issuer\'s JWKS is not a key set ({"keys": [...]}).',
          response.status,
          response.headers,
        );
      }
      return this.#cache.storeKeySet(keySet, response.headers);
    } catch (error) {
      // Counted only when the issuer failed, not for a configuration error,
      // which is raised every time.
      if (
        error instanceof APIConnectionError ||
        error instanceof APIStatusError ||
        error instanceof APIResponseValidationError
      ) {
        this.#cache.keySetFetchFailed();
      }
      throw error;
    }
  }

  // Token checks --------------------------------------------------------------

  #audience(audience: unknown, required: boolean): readonly string[] | null {
    if (audience === undefined || audience === null) {
      if (this.clientId) return [this.clientId];
      if (required) {
        throw new ConfigurationError(
          "verifyIdToken needs the audience: pass { audience: <application id> }, " +
            "or clientId: <application id> to Authentication.",
        );
      }
      return null;
    }
    const values: unknown[] =
      typeof audience === "string" ? [audience] : Array.isArray(audience) ? audience : [];
    if (!values.length || values.some((value) => typeof value !== "string" || !value)) {
      throw new TypeError("audience must be a non-empty string or a list of them.");
    }
    return values as string[];
  }

  async #verify(
    parsed: ParsedToken,
    kind: TokenKind,
    audience: readonly string[] | null,
    nonce: string | null,
  ): Promise<Record<string, unknown>> {
    const keySet = await this.#keySetFor(parsed.kid);
    const { subtle } = await webCrypto();
    const key = await keySet.publicKey(parsed.kid, subtle);
    const valid = await subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      parsed.signature,
      parsed.signingInput,
    );
    if (!valid) {
      throw new TokenVerificationError(
        "invalid_signature",
        "The token's signature does not verify with the issuer's key.",
      );
    }
    checkClaims(parsed.claims, {
      kind,
      issuer: this.issuer,
      audience,
      nonce,
      leeway: this.leeway,
      now: Date.now() / 1000,
    });
    return parsed.claims;
  }
}
