// Discovery, the JWKS cache and the unknown-kid refetch policy (docs/DESIGN.md
// section 10), against a stubbed issuer; the clock is a fake Date.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Authentication, TokenVerificationError } from "../../src/authentication/index.js";
import { cacheSeconds, parseKeySet } from "../../src/authentication/cache.js";
import {
  APIConnectionError,
  APIResponseValidationError,
  ConfigurationError,
  InternalServerError,
} from "../../src/core/errors.js";
import { webCrypto } from "../../src/core/runtime.js";
import { VERSION } from "../../src/core/version.js";
import {
  DISCOVERY,
  FakeIssuer,
  IDENTITY_ID,
  ISSUER,
  JWKS,
  REFRESH_TOKEN,
  SigningKey,
  accessClaims,
  advance,
  b64url,
  freezeClock,
  json,
  reason,
  rejection,
  synthetic,
} from "./helpers.js";

const TOKEN_RESPONSE = { access_token: "a", token_type: "Bearer", expires_in: 300 };

let key: SigningKey;
let issuer: FakeIssuer;
let auth: Authentication;

beforeEach(async () => {
  freezeClock();
  key = await SigningKey.generate("k_synthetic_key_1");
  issuer = new FakeIssuer([key]);
  auth = issuer.client();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("discovery and JWKS", () => {
  it("are fetched lazily, with the SDK headers, and cached", async () => {
    expect(issuer.requests).toEqual([]);
    const token = await key.sign(accessClaims());
    await auth.verifyAccessToken(token);
    await auth.verifyAccessToken(token);
    advance(299);
    await auth.verifyAccessToken(await key.sign(accessClaims()));
    expect([issuer.count(DISCOVERY), issuer.count(JWKS)]).toEqual([1, 1]);
    advance(2);
    await auth.verifyAccessToken(await key.sign(accessClaims()));
    expect([issuer.count(DISCOVERY), issuer.count(JWKS)]).toEqual([2, 2]);
    const jwks = issuer.last(JWKS);
    expect(jwks.url.toString()).toBe(`${ISSUER}/.well-known/jwks.json`);
    expect(jwks.headers.get("accept")).toBe("application/json");
    expect(jwks.headers.get("user-agent")).toMatch(new RegExp(`^didit-node/${VERSION} \\(`));
    expect(jwks.headers.get("x-didit-client")).toBe(`node/${VERSION}`);
    expect(jwks.headers.has("authorization")).toBe(false);
    expect(jwks.headers.has("x-api-key")).toBe(false);
    expect(jwks.init.redirect).toBe("manual");
    expect(issuer.last(DISCOVERY).url.toString()).toBe(`${ISSUER}${DISCOVERY}`);
  });

  it.each([
    ["public, max-age=10", 60],
    [null, 300],
    ["public, max-age=3600", 3600],
    ["no-store", 60],
    ["no-cache", 60],
  ])("keeps the key set for Cache-Control %s: %i seconds", async (cacheControl, freshFor) => {
    issuer.metadataCacheControl = cacheControl;
    await auth.verifyAccessToken(await key.sign(accessClaims()));
    advance(freshFor - 1);
    await auth.verifyAccessToken(await key.sign(accessClaims()));
    expect(issuer.count(JWKS)).toBe(1);
    advance(1);
    await auth.verifyAccessToken(await key.sign(accessClaims()));
    expect(issuer.count(JWKS)).toBe(2);
  });

  it.each([
    [{}, 300],
    [{ "cache-control": "public, max-age=300" }, 300],
    [{ "cache-control": "max-age=120" }, 120],
    [{ "cache-control": 'MAX-AGE="900", public' }, 900],
    [{ "cache-control": "max-age=1" }, 60],
    [{ "cache-control": "max-age=0" }, 60],
    [{ "cache-control": "max-age=999999999" }, 86400],
    [{ "cache-control": "max-age=soon" }, 300],
    [{ "cache-control": "max-age" }, 300],
    [{ "cache-control": "public, max-age=300", age: "100" }, 200],
    [{ "cache-control": "public, max-age=300", age: "290" }, 60],
    [{ "cache-control": "public, max-age=300", age: "old" }, 300],
    [{ "cache-control": "max-age=300, no-cache" }, 60],
    [{ "cache-control": "no-store" }, 60],
    [{ "cache-control": "private, no-store, max-age=600" }, 60],
  ] as const)("cacheSeconds(%o) is %i", (headers, seconds) => {
    expect(cacheSeconds(new Headers(headers))).toBe(seconds);
  });

  it("shares one in-flight discovery and JWKS fetch between concurrent calls", async () => {
    issuer.jwksDelay = 20;
    const tokens = await Promise.all(
      Array.from({ length: 10 }, (_, n) => key.sign(accessClaims({ jti: `jti-${n}` }))),
    );
    const results = await Promise.all(tokens.map((token) => auth.verifyAccessToken(token)));
    expect(results.map((claims) => claims.sub)).toEqual(Array(10).fill(IDENTITY_ID));
    expect([issuer.count(DISCOVERY), issuer.count(JWKS)]).toEqual([1, 1]);
  });

  it("shares the discovery fetch between token requests and verification", async () => {
    issuer.reply("POST", "/token/", 200, TOKEN_RESPONSE);
    await Promise.all([
      auth.refresh(REFRESH_TOKEN),
      auth.verifyAccessToken(await key.sign(accessClaims())),
      auth.refresh(REFRESH_TOKEN),
    ]);
    expect(issuer.count(DISCOVERY)).toBe(1);
  });

  it("shares a failed fetch with every concurrent caller", async () => {
    issuer.route("GET", JWKS, () => json(503, { detail: "down" }));
    const tokens = await Promise.all([key.sign(accessClaims()), key.sign(accessClaims())]);
    const errors = await Promise.all(
      tokens.map((token) => rejection(auth.verifyAccessToken(token))),
    );
    for (const error of errors) expect(error).toBeInstanceOf(InternalServerError);
    expect(issuer.count(JWKS)).toBe(1);
  });

  it("refetches an unknown kid at most once a minute", async () => {
    await auth.verifyAccessToken(await key.sign(accessClaims()));
    expect(issuer.count(JWKS)).toBe(1);
    const rotated = await SigningKey.generate("k_synthetic_key_2");
    advance(1);
    // Not published yet, and the last fetch is less than a minute old: no refetch.
    expect(await reason(auth.verifyAccessToken(await rotated.sign(accessClaims())))).toBe(
      "unknown_key",
    );
    issuer.keys.push(rotated);
    advance(30);
    expect(await reason(auth.verifyAccessToken(await rotated.sign(accessClaims())))).toBe(
      "unknown_key",
    );
    expect(issuer.count(JWKS)).toBe(1);
    advance(29);
    expect((await auth.verifyAccessToken(await rotated.sign(accessClaims()))).sub).toBe(
      IDENTITY_ID,
    );
    expect(issuer.count(JWKS)).toBe(2);
    const stranger = await SigningKey.generate("k_never_published");
    for (let i = 0; i < 5; i++) {
      advance(10);
      expect(await reason(auth.verifyAccessToken(await stranger.sign(accessClaims())))).toBe(
        "unknown_key",
      );
    }
    expect(issuer.count(JWKS)).toBe(2);
    advance(10);
    expect(await reason(auth.verifyAccessToken(await stranger.sign(accessClaims())))).toBe(
      "unknown_key",
    );
    expect(issuer.count(JWKS)).toBe(3);
    // Known keys keep verifying from the cache meanwhile.
    await auth.verifyAccessToken(await key.sign(accessClaims()));
    expect(issuer.count(JWKS)).toBe(3);
  });

  it("refetches an unknown kid once on a cold cache, then waits a minute", async () => {
    const stranger = await SigningKey.generate("k_never_published");
    const errors = await Promise.all(
      [1, 2, 3].map(async () =>
        reason(auth.verifyAccessToken(await stranger.sign(accessClaims()))),
      ),
    );
    expect(errors).toEqual(["unknown_key", "unknown_key", "unknown_key"]);
    expect(issuer.count(JWKS)).toBe(1);
  });

  it.each([
    ["kty RSA", { kty: "RSA" }],
    ["crv P-384", { crv: "P-384" }],
    ["alg ES384", { alg: "ES384" }],
    ["use enc", { use: "enc" }],
    ["use null", { use: null }],
    ["a 31-byte x", { x: b64url(new Uint8Array(31).fill(1)) }],
    ["a numeric y", { y: 42 }],
    ["x not base64url", { x: "!!!" }],
    ["a point off the curve", { x: b64url(new Uint8Array(32)), y: b64url(new Uint8Array(32)) }],
  ])("treats a published key with %s as an unknown key", async (_name, change) => {
    issuer.keys = [];
    const odd = { ...key.jwk(), ...change };
    issuer.route("GET", JWKS, () => json(200, { keys: [odd] }));
    expect(await reason(auth.verifyAccessToken(await key.sign(accessClaims())))).toBe(
      "unknown_key",
    );
  });

  it("accepts a published key without use and alg, and ignores other members", async () => {
    const { use: _use, alg: _alg, ...bare } = key.jwk();
    const extra = { d: b64url(new Uint8Array(32)), key_ops: ["sign"], ext: false };
    issuer.route("GET", JWKS, () => json(200, { keys: [{ ...bare, ...extra }] }));
    expect((await auth.verifyAccessToken(await key.sign(accessClaims()))).sub).toBe(IDENTITY_ID);
  });

  it("ignores JWKS entries without a kid and keeps the first of a duplicated kid", async () => {
    const impostor = await SigningKey.generate(key.kid);
    issuer.route("GET", "/keys/custom.json", () =>
      json(200, {
        keys: [{ kty: "EC" }, "junk", { ...key.jwk(), kid: "" }, key.jwk(), impostor.jwk()],
      }),
    );
    issuer.discovery!.jwks_uri = `${ISSUER}/keys/custom.json`;
    expect((await auth.verifyAccessToken(await key.sign(accessClaims()))).sub).toBe(IDENTITY_ID);
    expect(await reason(auth.verifyAccessToken(await impostor.sign(accessClaims())))).toBe(
      "invalid_signature",
    );
    expect(issuer.count("/keys/custom.json")).toBe(1);
    expect(issuer.count(JWKS)).toBe(0);
    expect(parseKeySet({ keys: [key.jwk()] })?.has(key.kid)).toBe(true);
  });

  it("remembers imported keys for published kids only", async () => {
    const keySet = parseKeySet({ keys: [key.jwk()] })!;
    // Not the global: Node.js 18 has no global `crypto`.
    const { subtle } = await webCrypto();
    const importKey = vi.spyOn(subtle, "importKey");
    try {
      // Forged tokens pick their own kid; none of them may stay in memory.
      for (let i = 0; i < 1000; i++) {
        const error = await rejection(keySet.publicKey(`forged-${"x".repeat(1000)}-${i}`, subtle));
        expect((error as TokenVerificationError).reason).toBe("unknown_key");
      }
      expect(keySet.importedCount).toBe(0);
      expect(importKey).not.toHaveBeenCalled();
      const [first, second] = await Promise.all([
        keySet.publicKey(key.kid, subtle),
        keySet.publicKey(key.kid, subtle),
      ]);
      expect(first).toBe(second);
      expect(keySet.importedCount).toBe(1);
      expect(importKey).toHaveBeenCalledTimes(1);
    } finally {
      importKey.mockRestore();
    }
  });

  it("does not let an unusable entry hide a usable key with the same kid", async () => {
    const rsa = { kty: "RSA", kid: key.kid, n: b64url(new Uint8Array(256).fill(1)), e: "AQAB" };
    issuer.route("GET", JWKS, () => json(200, { keys: [rsa, key.jwk()] }));
    expect((await auth.verifyAccessToken(await key.sign(accessClaims()))).sub).toBe(IDENTITY_ID);
  });

  it("uses the documented paths when discovery omits the endpoints or they are not URLs", async () => {
    issuer.discovery!.jwks_uri = "https://[::1";
    issuer.discovery!.token_endpoint = 42;
    issuer.reply("POST", "/token/", 200, TOKEN_RESPONSE);
    expect((await auth.verifyAccessToken(await key.sign(accessClaims()))).sub).toBe(IDENTITY_ID);
    expect((await auth.refresh(REFRESH_TOKEN)).token_type).toBe("Bearer");
    expect(issuer.paths()).toEqual([DISCOVERY, JWKS, "/token/"]);
    delete issuer.discovery!.jwks_uri;
    issuer.discovery!.token_endpoint = "ftp://acme.example/token/";
    const fresh = issuer.client();
    await fresh.verifyAccessToken(await key.sign(accessClaims()));
    await fresh.refresh(REFRESH_TOKEN);
    expect(issuer.paths().slice(3)).toEqual([DISCOVERY, JWKS, "/token/"]);
  });

  it("must name exactly the configured issuer", async () => {
    issuer.discovery!.issuer = "https://login.example.com";
    const error = await rejection(auth.verifyAccessToken(await key.sign(accessClaims())));
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(error.message).toContain('names the issuer "https://login.example.com"');
    for (const other of [`${ISSUER}/`, ISSUER.toUpperCase(), ` ${ISSUER}`]) {
      issuer.discovery!.issuer = other;
      expect(
        await rejection(issuer.client().verifyAccessToken(await key.sign(accessClaims()))),
      ).toBeInstanceOf(ConfigurationError);
    }
    // OpenID Connect Discovery 1.0 section 4.3: the issuer must be present too.
    advance(60);
    delete issuer.discovery!.issuer;
    issuer.reply("POST", "/token/", 200, TOKEN_RESPONSE);
    const missing = await rejection(auth.refresh(REFRESH_TOKEN));
    expect(missing).toBeInstanceOf(APIResponseValidationError);
    expect(missing.message).toMatch(/names no issuer/);
    expect(issuer.count("/token/")).toBe(0);
    issuer.discovery!.issuer = ISSUER;
    expect((await auth.refresh(REFRESH_TOKEN)).token_type).toBe("Bearer");
  });

  it("raises an issuer mismatch for a minute without fetching discovery again", async () => {
    issuer.discovery!.issuer = "https://login.example.com";
    for (let i = 0; i < 5; i++) {
      expect(
        await rejection(auth.verifyAccessToken(await key.sign(accessClaims()))),
      ).toBeInstanceOf(ConfigurationError);
    }
    expect(issuer.count(DISCOVERY)).toBe(1);
    expect(issuer.count(JWKS)).toBe(0);
    advance(59);
    expect(await rejection(auth.refresh(REFRESH_TOKEN))).toBeInstanceOf(ConfigurationError);
    expect(issuer.count(DISCOVERY)).toBe(1);
    // A minute later it is fetched again, and the fixed issuer is used at once.
    advance(1);
    issuer.discovery!.issuer = ISSUER;
    expect((await auth.verifyAccessToken(await key.sign(accessClaims()))).sub).toBeDefined();
    expect(issuer.count(DISCOVERY)).toBe(2);
  });

  it.each([
    ["token_endpoint", "http://acme.auth.didit.me/token/", "does not use https"],
    ["token_endpoint", "https://evil.example/steal", "not on the issuer's origin"],
    ["token_endpoint", `${ISSUER}:8443/token/`, "not on the issuer's origin"],
    [
      "token_endpoint",
      ISSUER.replace("https://", `https://user:${synthetic("pw")}@`) + "/token/",
      "not on the issuer's origin",
    ],
    ["jwks_uri", ISSUER.replace("https://", "http://") + JWKS, "does not use https"],
    ["jwks_uri", "https://keys.example.com/jwks.json", "not on the issuer's origin"],
    [
      "jwks_uri",
      "https://sub.acme-0a1b2c3d4e5f60718293a4b5c6d7e8f9.auth.didit.me/jwks.json",
      "not on the issuer's origin",
    ],
  ])("refuses a %s of %s (%s) and sends nothing there", async (field, value, message) => {
    issuer.discovery![field] = value;
    issuer.reply("POST", "/token/", 200, TOKEN_RESPONSE);
    const error = await rejection(auth.refresh(REFRESH_TOKEN));
    expect(error).toBeInstanceOf(APIResponseValidationError);
    expect(error.message).toContain(message);
    const verify = await rejection(auth.verifyAccessToken(await key.sign(accessClaims())));
    expect(verify).toBeInstanceOf(APIResponseValidationError);
    // Only the discovery document was read (once per call: a refused one is not cached).
    expect(issuer.paths()).toEqual([DISCOVERY, DISCOVERY]);
    expect(issuer.requests.every((request) => request.url.origin === ISSUER)).toBe(true);
  });

  it("allows endpoints with another path on the issuer's origin", async () => {
    issuer.discovery!.token_endpoint = `${ISSUER}/oauth/token/`;
    issuer.discovery!.jwks_uri = `${ISSUER}:443/keys/`;
    issuer.reply("POST", "/oauth/token/", 200, TOKEN_RESPONSE);
    issuer.route("GET", "/keys/", () => json(200, { keys: [key.jwk()] }));
    await auth.refresh(REFRESH_TOKEN);
    await auth.verifyAccessToken(await key.sign(accessClaims()));
    expect(issuer.paths()).toEqual([DISCOVERY, "/oauth/token/", "/keys/"]);
  });

  it("rate-limits failed key fetches too", async () => {
    const keysPath = "/keys/flaky.json";
    issuer.discovery!.jwks_uri = `${ISSUER}${keysPath}`;
    let up = false;
    issuer.route("GET", keysPath, () =>
      up ? json(200, { keys: [key.jwk()] }) : json(500, { detail: "down" }),
    );
    expect(await rejection(auth.verifyAccessToken(await key.sign(accessClaims())))).toBeInstanceOf(
      InternalServerError,
    );
    // Random kids (an attacker, or a burst during an outage) do not refetch for a
    // minute: they fail fast as a connection problem, not as an invalid token.
    for (let i = 0; i < 10; i++) {
      advance(1);
      const stranger = await (await SigningKey.generate(`k_random_${i}`)).sign(accessClaims());
      const error = await rejection(auth.verifyAccessToken(stranger));
      expect(error).toBeInstanceOf(APIConnectionError);
      expect(error).not.toBeInstanceOf(TokenVerificationError);
      expect(error.message).toMatch(/less than a minute ago/);
    }
    expect(issuer.count(keysPath)).toBe(1);
    // Once a minute has passed the SDK tries again, and recovers when the issuer does.
    advance(50);
    up = true;
    expect((await auth.verifyAccessToken(await key.sign(accessClaims()))).sub).toBe(IDENTITY_ID);
    expect(issuer.count(keysPath)).toBe(2);
    // With a fresh key set, an unknown kid right after a failed refetch waits a minute too.
    advance(60);
    up = false;
    const rotated = await SigningKey.generate("k_new");
    expect(
      await rejection(auth.verifyAccessToken(await rotated.sign(accessClaims()))),
    ).toBeInstanceOf(InternalServerError);
    advance(1);
    const newer = await SigningKey.generate("k_newer");
    expect(await reason(auth.verifyAccessToken(await newer.sign(accessClaims())))).toBe(
      "unknown_key",
    );
    expect(issuer.count(keysPath)).toBe(3);
    // Known keys keep verifying from the cache meanwhile.
    expect((await auth.verifyAccessToken(await key.sign(accessClaims()))).sub).toBe(IDENTITY_ID);
  });

  it("counts a failed discovery as a failed key fetch", async () => {
    const discovery = issuer.discovery;
    issuer.discovery = null; // the issuer answers "null"
    expect(await rejection(auth.verifyAccessToken(await key.sign(accessClaims())))).toBeInstanceOf(
      APIResponseValidationError,
    );
    const error = await rejection(auth.verifyAccessToken(await key.sign(accessClaims())));
    expect(error.message).toMatch(/less than a minute ago/);
    expect(issuer.count(DISCOVERY)).toBe(1);
    issuer.discovery = discovery;
    advance(60);
    expect((await auth.verifyAccessToken(await key.sign(accessClaims()))).sub).toBe(IDENTITY_ID);
  });

  it.each([
    [
      DISCOVERY,
      () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }),
    ],
    [DISCOVERY, () => json(200, ["not", "an", "object"])],
    [DISCOVERY, () => new Response(null, { status: 200 })],
    [DISCOVERY, () => new Response(null, { status: 204 })],
    [JWKS, () => json(200, { keys: "none" })],
    [JWKS, () => json(200, [])],
    [JWKS, () => new Response("{", { status: 200 })],
  ])("treats an unreadable %s as a response validation error", async (path, respond) => {
    issuer.route("GET", path, respond);
    const error = await rejection(auth.verifyAccessToken(await key.sign(accessClaims())));
    expect(error).toBeInstanceOf(APIResponseValidationError);
    expect((error as APIResponseValidationError).status).toBeGreaterThanOrEqual(200);
  });

  it("maps metadata HTTP errors to status errors", async () => {
    issuer.route("GET", DISCOVERY, () => new Response("upstream unavailable", { status: 503 }));
    const error = await rejection(auth.verifyAccessToken(await key.sign(accessClaims())));
    expect(error).toBeInstanceOf(InternalServerError);
    expect((error as InternalServerError).status).toBe(503);
    expect(error.message).toBe("HTTP 503: upstream unavailable");
    expect(issuer.paths()).toEqual([DISCOVERY]);
  });

  it("allows a plain http issuer only on loopback", async () => {
    for (const local of [
      "http://localhost:8000",
      "http://127.0.0.1:8000",
      "http://[::1]:8000",
      "http://acme.auth.localhost",
    ]) {
      const localIssuer = new FakeIssuer([key], local);
      const localAuth = localIssuer.client();
      expect(localAuth.issuer).toBe(local);
      await localAuth.verifyAccessToken(await key.sign(accessClaims({ iss: local })));
      expect(localIssuer.last(DISCOVERY).url.toString()).toBe(`${local}${DISCOVERY}`);
    }
    for (const remote of [
      "http://acme.auth.didit.me",
      "http://127.0.0.1.nip.io",
      "http://localhost.example.com",
    ]) {
      expect(() => new Authentication({ issuer: remote })).toThrow(ConfigurationError);
    }
  });

  it("keeps a loopback http issuer's endpoints on http", async () => {
    const local = "http://localhost:8000";
    const localIssuer = new FakeIssuer([key], local);
    localIssuer.discovery!.token_endpoint = "http://localhost:8000/token/";
    localIssuer.reply("POST", "/token/", 200, TOKEN_RESPONSE);
    await localIssuer.client().refresh(REFRESH_TOKEN);
    expect(localIssuer.last("/token/").url.toString()).toBe("http://localhost:8000/token/");
  });
});
