// Configuration, publishable keys, PKCE, state and nonce (docs/DESIGN.md section 10).

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  Authentication,
  createNonce,
  createPkce,
  createState,
  parsePublishableKey,
  type PkcePair,
} from "../../src/authentication/index.js";
import { s256Challenge } from "../../src/authentication/pkce.js";
import { ConfigurationError } from "../../src/core/errors.js";
import { APPLICATION_ID, FakeIssuer, ISSUER, b64url, synthetic } from "./helpers.js";

const BASE64URL_CHARS = /^[A-Za-z0-9_-]+$/;
// RFC 7636 section 4.1: unreserved characters, 43 to 128 of them.
const VERIFIER_CHARS = /^[A-Za-z0-9._~-]{43,128}$/;

function pk(prefix: string, issuer: string | Uint8Array): string {
  return prefix + b64url(issuer);
}

describe("publishable keys", () => {
  it("carry the issuer and the environment", () => {
    expect(parsePublishableKey(pk("pk_live_", ISSUER))).toEqual({
      issuer: ISSUER,
      environment: "live",
    });
    const sandbox = "https://acme-0001.sandbox.auth.didit.me";
    expect(parsePublishableKey(pk("pk_test_", sandbox))).toEqual({
      issuer: sandbox,
      environment: "test",
    });
    expect(parsePublishableKey(`  ${pk("pk_live_", `${ISSUER}/`)}\n`).issuer).toBe(ISSUER);
    expect(parsePublishableKey(pk("pk_test_", "http://acme.auth.localhost:8000")).issuer).toBe(
      "http://acme.auth.localhost:8000",
    );
    expect(parsePublishableKey(pk("pk_test_", "http://127.0.0.1:8000")).issuer).toBe(
      "http://127.0.0.1:8000",
    );
  });

  it("build a client for that issuer", () => {
    const issuer = new FakeIssuer([]);
    const auth = Authentication.fromPublishableKey(pk("pk_live_", ISSUER), {
      clientId: APPLICATION_ID,
      fetch: issuer.fetch,
      leeway: 5,
      timeout: 1234,
    });
    expect([auth.issuer, auth.clientId, auth.leeway, auth.timeout]).toEqual([
      ISSUER,
      APPLICATION_ID,
      5,
      1234,
    ]);
    expect(Authentication.fromPublishableKey(pk("pk_test_", ISSUER)).issuer).toBe(ISSUER);
  });

  it.each([
    ["empty", ""],
    ["a bare live prefix", "pk_live_"],
    ["a bare prefix", "pk_"],
    ["a secret key prefix", pk("sk_live_", ISSUER)],
    ["an upper-case prefix", pk("PK_LIVE_", ISSUER)],
    ["characters outside base64url", "pk_live_!!!notbase64"],
    ["padding", `${pk("pk_live_", ISSUER)}=`],
    ["standard base64", `pk_live_${Buffer.from(`${ISSUER}/?>`).toString("base64")}`],
    ["an impossible length", "pk_live_a"],
    ["bytes that are not UTF-8", pk("pk_live_", new Uint8Array([0xff, 0xfe, 0xfd]))],
    ["an http issuer in a live key", pk("pk_live_", "http://acme.auth.didit.me")],
    ["an http issuer in a test key", pk("pk_test_", "http://acme.auth.didit.me")],
    ["a localhost http issuer in a live key", pk("pk_live_", "http://localhost:8000")],
    ["no scheme", pk("pk_live_", "acme.auth.didit.me")],
    ["a query", pk("pk_live_", "https://acme.auth.didit.me?x=1")],
    ["null", null],
    ["a number", 42],
  ])("refuse %s", (_name, key) => {
    expect(() => parsePublishableKey(key as string)).toThrow(ConfigurationError);
    expect(() => Authentication.fromPublishableKey(key as string)).toThrow(ConfigurationError);
  });

  it("explain what is wrong without echoing the key", () => {
    expect(() => parsePublishableKey(pk("sk_live_", ISSUER))).toThrow(
      /starts with pk_live_ or pk_test_/,
    );
    const bad = "pk_live_!!!notbase64";
    expect(() => parsePublishableKey(bad)).toThrow(
      "The publishable key is not valid: expected pk_live_ followed by the base64url-encoded issuer.",
    );
  });
});

describe("issuer and options", () => {
  it.each([
    "",
    "   ",
    "acme.auth.didit.me",
    "http://acme.auth.didit.me",
    "ftp://acme.auth.didit.me",
    "https://",
    "https:///acme.auth.didit.me",
    "https:acme.auth.didit.me",
    `https://user:${synthetic("pw")}@acme.auth.didit.me`,
    "https://user@acme.auth.didit.me",
    "https://acme.auth.didit.me/?x=1",
    "https://acme.auth.didit.me?",
    "https://acme.auth.didit.me#top",
    "https://acme.auth.didit.me:99999",
    "https://acme.auth.didit.me/a b",
    "https://acme.auth.didit.me/a\tb",
    "https://acme.auth.didit.me\\evil.example",
    "https://[::1",
    null,
    42,
  ])("refuses the issuer %j", (issuer) => {
    expect(() => new Authentication({ issuer: issuer as string })).toThrow(ConfigurationError);
  });

  it("never echoes issuer credentials", () => {
    const password = synthetic("pw");
    let message = "";
    try {
      new Authentication({ issuer: `https://user:${password}@acme.auth.didit.me` });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe("The issuer URL must not contain a user name or password.");
    expect(message).not.toContain(password);
  });

  it("normalises the issuer and keeps its text", () => {
    expect(new Authentication({ issuer: `${ISSUER}/` }).issuer).toBe(ISSUER);
    expect(new Authentication({ issuer: ` ${ISSUER}// ` }).issuer).toBe(ISSUER);
    expect(new Authentication({ issuer: "https://login.example.com/tenant/" }).issuer).toBe(
      "https://login.example.com/tenant",
    );
    const auth = new Authentication({ issuer: ISSUER });
    expect([auth.clientId, auth.leeway, auth.timeout]).toEqual([null, 60, 10_000]);
    const local = new Authentication({
      issuer: "http://localhost:8000",
      clientId: ` ${APPLICATION_ID} `,
    });
    expect([local.issuer, local.clientId]).toEqual(["http://localhost:8000", APPLICATION_ID]);
    expect(new Authentication({ issuer: ISSUER, clientId: null }).clientId).toBeNull();
  });

  it("refuses invalid options", () => {
    for (const clientId of ["", "  ", 7]) {
      expect(() => new Authentication({ issuer: ISSUER, clientId: clientId as string })).toThrow(
        /clientId/,
      );
    }
    for (const leeway of [-1, true, "60", Number.NaN, Infinity]) {
      expect(() => new Authentication({ issuer: ISSUER, leeway: leeway as number })).toThrow(
        /leeway/,
      );
    }
    for (const timeout of [0, -5, "1000", Number.NaN, Infinity]) {
      expect(() => new Authentication({ issuer: ISSUER, timeout: timeout as number })).toThrow(
        /timeout/,
      );
    }
    expect(() => new Authentication({ issuer: ISSUER, fetch: "fetch" as never })).toThrow(/fetch/);
    expect(
      () => new Authentication({ issuer: ISSUER, defaultHeaders: { "bad header": "x" } }),
    ).toThrow(ConfigurationError);
    const secret = synthetic("header-value");
    let headerError: unknown;
    try {
      new Authentication({
        issuer: ISSUER,
        defaultHeaders: { "X-Secret": `${secret}\nX-Injected: 1` },
      });
    } catch (error) {
      headerError = error;
    }
    expect(headerError).toBeInstanceOf(ConfigurationError);
    expect((headerError as Error).message).not.toContain(secret);
    expect((headerError as Error).cause).toBeUndefined();
    expect(() => new Authentication(undefined as never)).toThrow(/issuer is empty/);
    expect(new Authentication({ issuer: ISSUER, leeway: 0 }).leeway).toBe(0);
  });

  it("does not expose its fetch, cache or headers as fields", () => {
    const auth = new Authentication({ issuer: ISSUER, defaultHeaders: { "X-Trace": "1" } });
    expect(Object.keys(auth).sort()).toEqual(["clientId", "issuer", "leeway", "timeout"]);
    expect(JSON.stringify(auth)).toBe(
      JSON.stringify({ issuer: ISSUER, clientId: null, leeway: 60, timeout: 10_000 }),
    );
  });
});

describe("PKCE, state and nonce", () => {
  it("matches RFC 7636 appendix B", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbU" + "JU1p1r_wW1gFWFOEjXk";
    expect(await s256Challenge(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("creates S256 pairs with RFC 7636 verifiers", async () => {
    const pairs: PkcePair[] = await Promise.all(Array.from({ length: 50 }, () => createPkce()));
    for (const pair of pairs) {
      expect(pair.codeChallengeMethod).toBe("S256");
      expect(pair.codeVerifier).toMatch(VERIFIER_CHARS);
      expect(pair.codeVerifier).toHaveLength(43);
      expect(Buffer.from(pair.codeVerifier, "base64url")).toHaveLength(32);
      const digest = createHash("sha256").update(pair.codeVerifier, "ascii").digest("base64url");
      expect(pair.codeChallenge).toBe(digest);
      expect(pair.codeChallenge).toHaveLength(43);
    }
    expect(new Set(pairs.map((pair) => pair.codeVerifier)).size).toBe(50);
  });

  it("creates distinct base64url state and nonce values from 32 random bytes", async () => {
    const values = await Promise.all([
      ...Array.from({ length: 50 }, () => createState()),
      ...Array.from({ length: 50 }, () => createNonce()),
    ]);
    expect(new Set(values).size).toBe(100);
    for (const value of values) {
      expect(value).toMatch(BASE64URL_CHARS);
      expect(value).toHaveLength(43);
      expect(Buffer.from(value, "base64url")).toHaveLength(32);
    }
    // Every byte value shows up across 100 x 32 random bytes: no fixed or biased source.
    const bytes = new Set(values.flatMap((value) => [...Buffer.from(value, "base64url")]));
    expect(bytes.size).toBeGreaterThan(240);
  });
});
