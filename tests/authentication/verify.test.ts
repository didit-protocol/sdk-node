// Access token and ID token verification (docs/DESIGN.md section 10) against a
// stubbed issuer with locally generated keys; nothing touches the network.

import { createHmac } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Authentication,
  TokenVerificationError,
  type AccessTokenClaims,
  type IdTokenClaims,
} from "../../src/authentication/index.js";
import { ConfigurationError } from "../../src/core/errors.js";
import {
  APPLICATION_ID,
  DISCOVERY,
  FakeIssuer,
  IDENTITY_ID,
  ISSUER,
  JWKS,
  NONCE,
  NOW,
  REMOVE,
  SESSION_ID,
  SigningKey,
  accessClaims,
  b64url,
  freezeClock,
  idClaims,
  reason,
  rejection,
  segment,
  unsignedToken,
} from "./helpers.js";

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

describe("verifyAccessToken", () => {
  it("verifies a valid access token and returns its payload", async () => {
    const token = await key.sign(accessClaims({ custom_claim: "kept" }));
    const claims: AccessTokenClaims = await auth.verifyAccessToken(token);
    expect(claims).toMatchObject({
      iss: ISSUER,
      sub: IDENTITY_ID,
      sid: SESSION_ID,
      aud: APPLICATION_ID,
      client_id: APPLICATION_ID,
      iat: NOW,
      exp: NOW + 300,
      jti: "synthetic-jti-0001",
      vendor_data: "user-42",
      amr: ["passkey"],
      org: { id: "6f1c2d3e-0000-4000-8000-00000000e001", role: "admin" },
      verified: { level: "full_id", over_18: true, country: "ES" },
      act: null,
    });
    expect(claims.custom_claim).toBe("kept");
    expect(issuer.paths()).toEqual([DISCOVERY, JWKS]);
  });

  it("returns the actor of an agent access token", async () => {
    const act = { sub: "agent-0001", agent: "Synthetic Agent", scopes: ["payouts:read"] };
    const claims = await auth.verifyAccessToken(
      await key.sign(accessClaims({ act, amr: [], verified: {} })),
    );
    expect(claims.act).toEqual(act);
    expect(claims.verified).toEqual({});
  });

  it.each(["at+jwt", "AT+JWT", "application/at+jwt"])("accepts typ %s", async (typ) => {
    const claims = await auth.verifyAccessToken(await key.sign(accessClaims(), { typ }));
    expect(claims.sub).toBe(IDENTITY_ID);
  });

  it.each([null, "JWT", "jwt", "application/jwt", "id+jwt", "at+jwe"])(
    "rejects typ %s as invalid_type",
    async (typ) => {
      const token = await key.sign(accessClaims(), { typ });
      expect(await reason(auth.verifyAccessToken(token))).toBe("invalid_type");
    },
  );

  it("rejects an ID token used as an access token", async () => {
    const idToken = await key.sign(idClaims(), { typ: "JWT" });
    expect(await reason(auth.verifyAccessToken(idToken))).toBe("invalid_type");
  });

  it("checks the audience when given", async () => {
    const token = await key.sign(accessClaims());
    expect((await auth.verifyAccessToken(token, { audience: APPLICATION_ID })).aud).toBe(
      APPLICATION_ID,
    );
    expect(
      (await auth.verifyAccessToken(token, { audience: ["other", APPLICATION_ID] })).sub,
    ).toBe(IDENTITY_ID);
    expect(await reason(auth.verifyAccessToken(token, { audience: "other-application" }))).toBe(
      "invalid_audience",
    );
    const listed = await key.sign(accessClaims({ aud: ["other", APPLICATION_ID] }));
    expect((await auth.verifyAccessToken(listed, { audience: APPLICATION_ID })).aud).toEqual([
      "other",
      APPLICATION_ID,
    ]);
    for (const odd of [7, { aud: APPLICATION_ID }, [7, null], null]) {
      const oddToken = await key.sign(accessClaims({ aud: odd }));
      expect(await reason(auth.verifyAccessToken(oddToken, { audience: APPLICATION_ID }))).toBe(
        "invalid_audience",
      );
    }
    const noAud = await key.sign(accessClaims({ aud: REMOVE }));
    expect((await auth.verifyAccessToken(noAud)).sub).toBe(IDENTITY_ID);
    expect(await reason(auth.verifyAccessToken(noAud, { audience: APPLICATION_ID }))).toBe(
      "missing_claim",
    );
  });

  it("refuses an empty audience argument before any request", async () => {
    const token = await key.sign(accessClaims());
    for (const audience of [[], "", [""], [APPLICATION_ID, 7]]) {
      const error = await rejection(
        auth.verifyAccessToken(token, { audience: audience as string[] }),
      );
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toMatch(/audience/);
    }
    expect(issuer.requests).toEqual([]);
  });

  it("uses clientId as the default audience", async () => {
    const configured = issuer.client({ clientId: APPLICATION_ID });
    expect((await configured.verifyAccessToken(await key.sign(accessClaims()))).sub).toBe(
      IDENTITY_ID,
    );
    const other = await key.sign(accessClaims({ aud: "another-application" }));
    expect(await reason(configured.verifyAccessToken(other))).toBe("invalid_audience");
    expect((await configured.verifyAccessToken(other, { audience: "another-application" })).sub).toBe(
      IDENTITY_ID,
    );
  });

  it.each(["HS256", "HS512", "RS256", "PS256", "EdDSA", "ES384", "ES512", "es256", "none"])(
    "rejects alg %s before any request",
    async (alg) => {
      const header = { alg, typ: "at+jwt", kid: key.kid };
      const token = unsignedToken(header, accessClaims(), new Uint8Array(64).fill(1));
      expect(await reason(auth.verifyAccessToken(token))).toBe("unsupported_algorithm");
      expect(issuer.requests).toEqual([]);
    },
  );

  it.each([
    ["alg none", { alg: "none", kid: "k_synthetic_key_1" }],
    ["a missing alg", { kid: "k_synthetic_key_1" }],
    ["alg null", { alg: null, kid: "k_synthetic_key_1" }],
  ])("rejects %s, unsigned, as unsupported_algorithm", async (_name, header) => {
    const token = unsignedToken({ ...header, typ: "at+jwt" }, accessClaims());
    expect(token.endsWith(".")).toBe(true);
    const error = await rejection(auth.verifyAccessToken(token));
    expect(error).toBeInstanceOf(TokenVerificationError);
    expect((error as TokenVerificationError).reason).toBe("unsupported_algorithm");
    expect(error.message).toMatch(/only ES256/);
    expect(issuer.requests).toEqual([]);
  });

  it("rejects HS256 signed with the public key bytes (key confusion)", async () => {
    const header = { alg: "HS256", typ: "at+jwt", kid: key.kid };
    const signingInput = `${segment(header)}.${segment(accessClaims())}`;
    for (const secret of [JSON.stringify(key.jwk()), String(key.jwk().x)]) {
      const mac = createHmac("sha256", secret).update(signingInput).digest();
      const token = `${signingInput}.${b64url(mac)}`;
      expect(await reason(auth.verifyAccessToken(token))).toBe("unsupported_algorithm");
    }
    expect(issuer.requests).toEqual([]);
  });

  describe("tokens signed with other algorithms", () => {
    let rsa: CryptoKeyPair;
    let p384: CryptoKeyPair;

    beforeAll(async () => {
      rsa = await crypto.subtle.generateKey(
        {
          name: "RSASSA-PKCS1-v1_5",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
        false,
        ["sign", "verify"],
      );
      p384 = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, false, [
        "sign",
        "verify",
      ]);
    });

    it("rejects a real RS256 token", async () => {
      const signingInput = `${segment({ alg: "RS256", typ: "at+jwt", kid: key.kid })}.${segment(accessClaims())}`;
      const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        rsa.privateKey,
        new TextEncoder().encode(signingInput),
      );
      const token = `${signingInput}.${b64url(new Uint8Array(signature))}`;
      expect(await reason(auth.verifyAccessToken(token))).toBe("unsupported_algorithm");
    });

    it("rejects a real ES384 token", async () => {
      const signingInput = `${segment({ alg: "ES384", typ: "at+jwt", kid: key.kid })}.${segment(accessClaims())}`;
      const signature = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-384" },
        p384.privateKey,
        new TextEncoder().encode(signingInput),
      );
      const token = `${signingInput}.${b64url(new Uint8Array(signature))}`;
      expect(await reason(auth.verifyAccessToken(token))).toBe("unsupported_algorithm");
    });

    it("rejects an ES256 header over a P-384 signature", async () => {
      const signingInput = `${segment({ alg: "ES256", typ: "at+jwt", kid: key.kid })}.${segment(accessClaims())}`;
      const signature = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        p384.privateKey,
        new TextEncoder().encode(signingInput),
      );
      const token = `${signingInput}.${b64url(new Uint8Array(signature))}`;
      expect(await reason(auth.verifyAccessToken(token))).toBe("invalid_signature");
    });
  });

  it("rejects a token signed by another key under the same kid", async () => {
    const impostor = await SigningKey.generate(key.kid);
    const token = await impostor.sign(accessClaims());
    const error = await rejection(auth.verifyAccessToken(token));
    expect((error as TokenVerificationError).reason).toBe("invalid_signature");
    expect(error.message).not.toContain(token);
    expect(error.message).not.toContain(token.split(".")[2]);
  });

  it("rejects tampered claims and bad signature bytes", async () => {
    const [header, , signature] = (await key.sign(accessClaims())).split(".");
    const forged = `${header}.${segment(accessClaims({ sub: "someone-else" }))}.${signature}`;
    expect(await reason(auth.verifyAccessToken(forged))).toBe("invalid_signature");
    const short = `${header}.${segment(accessClaims())}.${b64url(new Uint8Array(63).fill(7))}`;
    expect(await reason(auth.verifyAccessToken(short))).toBe("invalid_signature");
    const empty = `${header}.${segment(accessClaims())}.`;
    expect(await reason(auth.verifyAccessToken(empty))).toBe("invalid_signature");
    const zeros = `${header}.${segment(accessClaims())}.${b64url(new Uint8Array(64))}`;
    expect(await reason(auth.verifyAccessToken(zeros))).toBe("invalid_signature");
  });

  it("rejects the wrong issuer", async () => {
    const other = await key.sign(accessClaims({ iss: "https://other-0001.auth.didit.me" }));
    expect(await reason(auth.verifyAccessToken(other))).toBe("invalid_issuer");
    const slash = await key.sign(accessClaims({ iss: `${ISSUER}/` }));
    expect(await reason(auth.verifyAccessToken(slash))).toBe("invalid_issuer");
    const upper = await key.sign(accessClaims({ iss: ISSUER.toUpperCase() }));
    expect(await reason(auth.verifyAccessToken(upper))).toBe("invalid_issuer");
    const missing = await key.sign(accessClaims({ iss: REMOVE }));
    expect(await reason(auth.verifyAccessToken(missing))).toBe("missing_claim");
    const nullIss = await key.sign(accessClaims({ iss: null }));
    expect(await reason(auth.verifyAccessToken(nullIss))).toBe("missing_claim");
  });

  it("names the token's issuer, never the token, in the message", async () => {
    const token = await key.sign(accessClaims({ iss: "https://other-0001.auth.didit.me" }));
    const error = await rejection(auth.verifyAccessToken(token));
    expect(error.message).toBe(
      `The token was issued by "https://other-0001.auth.didit.me", not by "${ISSUER}".`,
    );
  });

  it.each([
    [{ exp: NOW - 61 }, "expired"],
    [{ exp: NOW - 60 }, "expired"],
    [{ nbf: NOW + 61 }, "not_yet_valid"],
    [{ nbf: NOW + 120 }, "not_yet_valid"],
    [{ iat: NOW + 61 }, "invalid_issued_at"],
    [{ iat: NOW + 120 }, "invalid_issued_at"],
    [{ exp: REMOVE }, "missing_claim"],
    [{ iat: REMOVE }, "missing_claim"],
    [{ sub: REMOVE }, "missing_claim"],
    [{ sub: "" }, "missing_claim"],
    [{ sub: 42 }, "missing_claim"],
    [{ exp: "soon" }, "malformed"],
    [{ exp: String(NOW + 300) }, "malformed"],
    [{ exp: true }, "malformed"],
    [{ iat: [NOW] }, "malformed"],
    [{ nbf: null }, "malformed"],
    [{ exp: null }, "malformed"],
  ] as const)("claims %o are rejected as %s", async (overrides, expected) => {
    const token = await key.sign(accessClaims(overrides, NOW));
    expect(await reason(auth.verifyAccessToken(token))).toBe(expected);
  });

  it.each([
    { exp: NOW - 59 },
    { exp: NOW + 1.5 },
    { nbf: NOW + 60 },
    { nbf: NOW + 59 },
    { iat: NOW + 60 },
    { iat: NOW + 59 },
    { nbf: NOW - 10 },
  ])("allows 60 seconds of clock skew: %o", async (overrides) => {
    const token = await key.sign(accessClaims(overrides, NOW));
    expect((await auth.verifyAccessToken(token)).sub).toBe(IDENTITY_ID);
  });

  it("tracks the clock to the millisecond at the expiry boundary", async () => {
    const token = await key.sign(accessClaims({ exp: NOW - 59 }, NOW));
    vi.setSystemTime(NOW * 1000 + 999);
    expect((await auth.verifyAccessToken(token)).sub).toBe(IDENTITY_ID);
    vi.setSystemTime((NOW + 1) * 1000);
    expect(await reason(auth.verifyAccessToken(token))).toBe("expired");
  });

  it("makes the leeway configurable", async () => {
    const strict = issuer.client({ leeway: 0 });
    expect(await reason(strict.verifyAccessToken(await key.sign(accessClaims({ exp: NOW }))))).toBe(
      "expired",
    );
    const lenient = issuer.client({ leeway: 600 });
    const old = await key.sign(accessClaims({ exp: NOW - 500 }));
    expect((await lenient.verifyAccessToken(old)).sub).toBe(IDENTITY_ID);
  });

  it.each(["exp", "nbf", "iat"])("rejects a %s beyond any number as malformed", async (claim) => {
    // 1e400 parses as Infinity; sign the raw JSON so that it reaches the claim checks.
    const payload = JSON.stringify(accessClaims({ [claim]: 123456789 })).replace(
      `"${claim}":123456789`,
      `"${claim}":1e400`,
    );
    const header = segment({ alg: "ES256", typ: "at+jwt", kid: key.kid });
    const token = await key.signSegments(header, b64url(payload));
    expect(await reason(auth.verifyAccessToken(token))).toBe("malformed");
  });

  describe("malformed tokens", () => {
    function malformed(kid: string): [string, unknown][] {
      const goodHeader = segment({ alg: "ES256", typ: "at+jwt", kid });
      const payload = segment(accessClaims());
      const signature = b64url(new Uint8Array(64));
      return [
        ["empty", ""],
        ["one segment", "abc"],
        ["two segments", `${goodHeader}.${payload}`],
        ["four segments", `${goodHeader}.${payload}.${signature}.x`],
        ["five segments (JWE)", "a.b.c.d.e"],
        ["a header that is not base64url", `!!!.${payload}.${signature}`],
        ["a padded header", `${goodHeader}=.${payload}.${signature}`],
        ["a header of impossible length", `abcde.${payload}.${signature}`],
        ["a header that is not JSON", `${b64url("not json")}.${payload}.${signature}`],
        ["a header that is an array", `${b64url("[1, 2]")}.${payload}.${signature}`],
        ["a header that is null", `${b64url("null")}.${payload}.${signature}`],
        [
          "duplicate header members",
          `${b64url('{"alg":"ES256","typ":"at+jwt","kid":"k","alg":"none"}')}.${payload}.${signature}`,
        ],
        [
          "duplicate members written with escapes",
          `${b64url('{"alg":"ES256","typ":"at+jwt","kid":"k","\\u0061lg":"ES256"}')}.${payload}.${signature}`,
        ],
        ["a header that is not UTF-8", `${b64url(new Uint8Array([0xff, 0xfe]))}.${payload}.${signature}`],
        [
          "a header with a byte order mark",
          `${b64url(`﻿${JSON.stringify({ alg: "ES256", typ: "at+jwt", kid })}`)}.${payload}.${signature}`,
        ],
        ["a payload that is not JSON", `${goodHeader}.${b64url("not json")}.${signature}`],
        ["a payload that is an array", `${goodHeader}.${b64url("[]")}.${signature}`],
        ["a payload that is a string", `${goodHeader}.${b64url('"claims"')}.${signature}`],
        ["a payload of impossible length", `${goodHeader}.abcde.${signature}`],
        [
          "duplicate payload members",
          `${goodHeader}.${b64url(`{"sub":"a","exp":${NOW + 300},"exp":${NOW - 300}}`)}.${signature}`,
        ],
        ["NaN in the payload", `${goodHeader}.${b64url('{"exp":NaN}')}.${signature}`],
        ["a deeply nested payload", `${goodHeader}.${b64url(`${"[".repeat(5000)}${"]".repeat(5000)}`)}.${signature}`],
        ["a signature that is not base64url", `${goodHeader}.${payload}.abc!`],
        ["no kid", `${segment({ alg: "ES256", typ: "at+jwt" })}.${payload}.${signature}`],
        ["an empty kid", `${segment({ alg: "ES256", typ: "at+jwt", kid: "" })}.${payload}.${signature}`],
        ["a kid that is a number", `${segment({ alg: "ES256", typ: "at+jwt", kid: 7 })}.${payload}.${signature}`],
        [
          "critical extensions",
          `${segment({ alg: "ES256", typ: "at+jwt", kid, crit: ["b64"] })}.${payload}.${signature}`,
        ],
        ["a token over 16 KiB", "x".repeat(20_000)],
        ["a number", 123],
        ["null", null],
        ["undefined", undefined],
        ["bytes", new TextEncoder().encode("a.b.c")],
      ];
    }

    it("rejects each one as malformed, without a request and without echoing it", async () => {
      for (const [name, token] of malformed(key.kid)) {
        const error = await rejection(auth.verifyAccessToken(token as string));
        expect(error, name).toBeInstanceOf(TokenVerificationError);
        expect((error as TokenVerificationError).reason, name).toBe("malformed");
        if (typeof token === "string" && token.length > 10) {
          expect(error.message, name).not.toContain(token);
        }
      }
      expect(issuer.requests).toEqual([]);
    });

    it("accepts nesting that real tokens use and keys that only look alike", async () => {
      const claims = accessClaims({
        nested: { a: { b: [{ c: { d: [1, 2, { e: "f" }] } }] } },
        "a,b": { "{": "}", '"quoted"': "[", "\\": 1 },
        arr: [{ x: 1 }, { x: 2 }],
      });
      const verified = await auth.verifyAccessToken(await key.sign(claims));
      expect(verified.nested).toEqual(claims.nested);
      expect(verified["a,b"]).toEqual(claims["a,b"]);
    });
  });
});

describe("verifyIdToken", () => {
  it("verifies a valid ID token", async () => {
    const token = await key.sign(idClaims(), { typ: "JWT" });
    const claims: IdTokenClaims = await auth.verifyIdToken(token, {
      nonce: NONCE,
      audience: APPLICATION_ID,
    });
    expect(claims).toMatchObject({
      sub: IDENTITY_ID,
      sid: SESSION_ID,
      nonce: NONCE,
      email: "person@example.com",
      email_verified: true,
      name: "Synthetic Person",
      auth_time: NOW - 10,
      org: null,
    });
    expect(claims.phone_number).toBeUndefined();
  });

  it.each(["JWT", "jwt", "application/jwt", null])("accepts typ %s", async (typ) => {
    const token = await key.sign(idClaims(), { typ });
    const claims = await auth.verifyIdToken(token, { nonce: NONCE, audience: APPLICATION_ID });
    expect(claims.sub).toBe(IDENTITY_ID);
  });

  it.each(["at+jwt", "application/at+jwt", "AT+JWT", "dpop+jwt", 1])(
    "never accepts typ %s (an access token is never an ID token)",
    async (typ) => {
      const token = await key.sign(idClaims(), { header: { typ } });
      expect(
        await reason(auth.verifyIdToken(token, { nonce: NONCE, audience: APPLICATION_ID })),
      ).toBe("invalid_type");
    },
  );

  it("rejects an access token used as an ID token", async () => {
    const accessToken = await key.sign(accessClaims({ nonce: NONCE }));
    expect(
      await reason(auth.verifyIdToken(accessToken, { nonce: NONCE, audience: APPLICATION_ID })),
    ).toBe("invalid_type");
  });

  it("checks the nonce", async () => {
    const token = await key.sign(idClaims(), { typ: "JWT" });
    expect(
      await reason(auth.verifyIdToken(token, { nonce: "another-sign-in", audience: APPLICATION_ID })),
    ).toBe("invalid_nonce");
    expect(
      await reason(auth.verifyIdToken(token, { nonce: `${NONCE}x`, audience: APPLICATION_ID })),
    ).toBe("invalid_nonce");
    const noNonce = await key.sign(idClaims({ nonce: REMOVE }), { typ: "JWT" });
    expect(
      await reason(auth.verifyIdToken(noNonce, { nonce: NONCE, audience: APPLICATION_ID })),
    ).toBe("invalid_nonce");
    const numeric = await key.sign(idClaims({ nonce: 7 }), { typ: "JWT" });
    expect(
      await reason(auth.verifyIdToken(numeric, { nonce: "7", audience: APPLICATION_ID })),
    ).toBe("invalid_nonce");
    // An ID token from refresh() carries no nonce; the caller opts out explicitly.
    const refreshed = await auth.verifyIdToken(noNonce, { nonce: null, audience: APPLICATION_ID });
    expect(refreshed.nonce).toBeUndefined();
  });

  it("requires the nonce argument", async () => {
    const token = await key.sign(idClaims(), { typ: "JWT" });
    for (const options of [{ nonce: "" }, {}, undefined]) {
      const error = await rejection(
        auth.verifyIdToken(token, { audience: APPLICATION_ID, ...options } as never),
      );
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toMatch(/nonce/);
    }
    expect(issuer.requests).toEqual([]);
  });

  it("requires the audience, or clientId", async () => {
    const token = await key.sign(idClaims(), { typ: "JWT" });
    const error = await rejection(auth.verifyIdToken(token, { nonce: NONCE }));
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(error.message).toMatch(/audience/);
    expect(issuer.requests).toEqual([]);
    expect(
      await reason(auth.verifyIdToken(token, { nonce: NONCE, audience: "other" })),
    ).toBe("invalid_audience");
    const noAud = await key.sign(idClaims({ aud: REMOVE }), { typ: "JWT" });
    expect(
      await reason(auth.verifyIdToken(noAud, { nonce: NONCE, audience: APPLICATION_ID })),
    ).toBe("missing_claim");
    const configured = issuer.client({ clientId: APPLICATION_ID });
    expect((await configured.verifyIdToken(token, { nonce: NONCE })).aud).toBe(APPLICATION_ID);
  });

  it("checks time and signature like an access token", async () => {
    const expired = await key.sign(idClaims({ exp: NOW - 120 }), { typ: "JWT" });
    expect(
      await reason(auth.verifyIdToken(expired, { nonce: NONCE, audience: APPLICATION_ID })),
    ).toBe("expired");
    const other = await (await SigningKey.generate(key.kid)).sign(idClaims(), { typ: "JWT" });
    expect(
      await reason(auth.verifyIdToken(other, { nonce: NONCE, audience: APPLICATION_ID })),
    ).toBe("invalid_signature");
    const hs = unsignedToken({ alg: "HS256", typ: "JWT", kid: key.kid }, idClaims(), new Uint8Array(32));
    expect(await reason(auth.verifyIdToken(hs, { nonce: NONCE, audience: APPLICATION_ID }))).toBe(
      "unsupported_algorithm",
    );
  });
});
