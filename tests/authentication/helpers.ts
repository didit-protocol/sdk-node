// A stub Didit Authentication issuer for the tests in this directory.
//
// Signing keys are generated with Web Crypto when a test runs and tokens are
// signed here; the issuer is a `fetch` stub, so nothing touches the network.
// Every id, token and secret below is synthetic and built at run time.

import { expect, vi } from "vitest";
import { Authentication, type AuthenticationOptions } from "../../src/authentication/index.js";
import { TokenVerificationError, type TokenVerificationReason } from "../../src/core/errors.js";

/** A synthetic value: never a real credential. */
export function synthetic(name: string): string {
  return ["synthetic", name, "0001"].join("-");
}

export const ISSUER = "https://acme-0a1b2c3d4e5f60718293a4b5c6d7e8f9.auth.didit.me";
export const APPLICATION_ID = "6f1c2d3e-0000-4000-8000-00000000a001";
export const IDENTITY_ID = "6f1c2d3e-0000-4000-8000-00000000b001";
export const SESSION_ID = "6f1c2d3e-0000-4000-8000-00000000c001";
export const STEP_UP_ID = "6f1c2d3e-0000-4000-8000-00000000d001";
export const ACCESS_TOKEN = synthetic("access-token");
export const REFRESH_TOKEN = synthetic("refresh-token");
export const CODE = synthetic("authorization-code");
export const CODE_VERIFIER = synthetic("code-verifier-000000000000000000000");
export const REDIRECT_URI = "https://app.example.com/callback";
export const NONCE = synthetic("nonce");
/** 2027-01-15T08:00:00Z, in seconds. */
export const NOW = 1_800_000_000;

export const DISCOVERY = "/.well-known/openid-configuration";
export const JWKS = "/.well-known/jwks.json";

/** Pass as a claim override to leave the claim out. */
export const REMOVE = Symbol("remove");

export type Claims = Record<string, unknown>;
export type Overrides = Record<string, unknown>;

const encoder = new TextEncoder();

export function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  return Buffer.from(bytes).toString("base64url");
}

export function segment(value: unknown): string {
  return b64url(JSON.stringify(value));
}

/** A token with any header and signature bytes, for the rejection tests. */
export function unsignedToken(
  header: Record<string, unknown>,
  claims: Claims,
  signature: Uint8Array = new Uint8Array(),
): string {
  return `${segment(header)}.${segment(claims)}.${b64url(signature)}`;
}

/** Fake `Date` only: request timers stay real, so a stubbed fetch answers at once. */
export function freezeClock(seconds = NOW): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(seconds * 1000);
}

export function advance(seconds: number): void {
  vi.setSystemTime(Date.now() + seconds * 1000);
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export interface SignOptions {
  typ?: string | null;
  kid?: string;
  header?: Record<string, unknown>;
}

export class SigningKey {
  readonly kid: string;
  readonly keyPair: CryptoKeyPair;
  #jwk: JsonWebKey | undefined;

  private constructor(kid: string, keyPair: CryptoKeyPair) {
    this.kid = kid;
    this.keyPair = keyPair;
  }

  static async generate(kid: string): Promise<SigningKey> {
    const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    const key = new SigningKey(kid, keyPair);
    key.#jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    return key;
  }

  /** The public key as the issuer publishes it. */
  jwk(): Record<string, unknown> {
    const { x, y } = this.#jwk!;
    return { kty: "EC", crv: "P-256", x, y, kid: this.kid, use: "sig", alg: "ES256" };
  }

  /** An ES256 JWS as the Didit issuer signs it (raw r || s signature). */
  async sign(claims: Claims, options: SignOptions = {}): Promise<string> {
    const header: Record<string, unknown> = { alg: "ES256", kid: options.kid ?? this.kid };
    const typ = options.typ === undefined ? "at+jwt" : options.typ;
    if (typ !== null) header.typ = typ;
    Object.assign(header, options.header ?? {});
    const signingInput = `${segment(header)}.${segment(claims)}`;
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      this.keyPair.privateKey,
      encoder.encode(signingInput),
    );
    return `${signingInput}.${b64url(new Uint8Array(signature))}`;
  }
}

function withOverrides(base: Claims, overrides: Overrides): Claims {
  const out: Claims = { ...base, ...overrides };
  for (const [name, value] of Object.entries(out)) if (value === REMOVE) delete out[name];
  return out;
}

/** The claims of a person's access token (issuer.session_tokens). */
export function accessClaims(overrides: Overrides = {}, now = nowSeconds()): Claims {
  return withOverrides(
    {
      iss: ISSUER,
      aud: APPLICATION_ID,
      sub: IDENTITY_ID,
      sid: SESSION_ID,
      jti: "synthetic-jti-0001",
      iat: now,
      exp: now + 300,
      vendor_data: "user-42",
      org: { id: "6f1c2d3e-0000-4000-8000-00000000e001", role: "admin" },
      verified: { level: "full_id", over_18: true, country: "ES" },
      amr: ["passkey"],
      act: null,
      client_id: APPLICATION_ID,
    },
    overrides,
  );
}

/** The claims of an ID token (issuer.session_tokens): no client_id, plus profile claims. */
export function idClaims(overrides: Overrides = {}, now = nowSeconds()): Claims {
  return withOverrides(
    {
      iss: ISSUER,
      aud: APPLICATION_ID,
      sub: IDENTITY_ID,
      sid: SESSION_ID,
      jti: "synthetic-jti-0002",
      iat: now,
      exp: now + 300,
      vendor_data: "user-42",
      org: null,
      verified: {},
      amr: ["password"],
      act: null,
      auth_time: now - 10,
      email_verified: true,
      email: "person@example.com",
      name: "Synthetic Person",
      nonce: NONCE,
    },
    overrides,
  );
}

/** A request the stub issuer received. */
export interface Recorded {
  method: string;
  url: URL;
  headers: Headers;
  body: string | null;
  init: RequestInit;
}

export type Handler = (request: Recorded) => Response | Promise<Response>;

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-request-id": "req_synthetic", ...headers },
  });
}

/** The issuer's HTTP side: discovery and JWKS built in, other routes per test. */
export class FakeIssuer {
  readonly issuer: string;
  keys: SigningKey[];
  metadataCacheControl: string | null = "public, max-age=300";
  discovery: Record<string, unknown> | null;
  readonly routes = new Map<string, Handler>();
  readonly requests: Recorded[] = [];
  /** Milliseconds the JWKS answer waits. */
  jwksDelay = 0;

  constructor(keys: SigningKey[], issuer = ISSUER) {
    this.issuer = issuer;
    this.keys = keys;
    this.discovery = {
      issuer,
      authorization_endpoint: `${issuer}/sign-in/`,
      token_endpoint: `${issuer}/token/`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      id_token_signing_alg_values_supported: ["ES256"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
    };
  }

  route(method: string, path: string, handler: Handler): void {
    this.routes.set(`${method} ${path}`, handler);
  }

  /** Answer `method path` with `status` and a JSON `body` (no body when `undefined`). */
  reply(method: string, path: string, status: number, body?: unknown): void {
    this.route(method, path, () =>
      body === undefined ? new Response(null, { status }) : json(status, body),
    );
  }

  #metadata(body: unknown): Response {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.metadataCacheControl !== null) headers["cache-control"] = this.metadataCacheControl;
    return new Response(JSON.stringify(body), { status: 200, headers });
  }

  /** The `fetch` to give `Authentication`. */
  readonly fetch: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const request: Recorded = {
      method: init.method ?? "GET",
      url,
      headers: new Headers(init.headers),
      body: typeof init.body === "string" ? init.body : null,
      init,
    };
    this.requests.push(request);
    return this.handle(request);
  };

  async handle(request: Recorded): Promise<Response> {
    const { method, url } = request;
    const route = this.routes.get(`${method} ${url.pathname}`);
    if (route) return route(request);
    if (url.origin === new URL(this.issuer).origin && method === "GET") {
      if (url.pathname === DISCOVERY) return this.#metadata(this.discovery);
      if (url.pathname === JWKS) {
        if (this.jwksDelay) await new Promise((resolve) => setTimeout(resolve, this.jwksDelay));
        return this.#metadata({ keys: this.keys.map((key) => key.jwk()) });
      }
    }
    return json(404, { detail: "Not found." });
  }

  count(path: string): number {
    return this.requests.filter((request) => request.url.pathname === path).length;
  }

  last(path: string): Recorded {
    const matching = this.requests.filter((request) => request.url.pathname === path);
    const found = matching[matching.length - 1];
    if (!found) throw new Error(`no request to ${path}`);
    return found;
  }

  paths(): string[] {
    return this.requests.map((request) => request.url.pathname);
  }

  client(options: Partial<AuthenticationOptions> = {}): Authentication {
    return new Authentication({ issuer: this.issuer, fetch: this.fetch, ...options });
  }
}

/** The reason a verification failed with; fails the test when it did not fail that way. */
export async function reason(promise: Promise<unknown>): Promise<TokenVerificationReason> {
  const error: unknown = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(TokenVerificationError);
  return (error as TokenVerificationError).reason;
}

/** The error a promise rejects with; fails the test when it resolves. */
export async function rejection(promise: Promise<unknown>): Promise<Error> {
  const error: unknown = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  return error as Error;
}

export function formOf(request: Recorded): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(request.body ?? ""));
}
