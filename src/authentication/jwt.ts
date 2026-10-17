// JWS parsing and claim checks for Didit Authentication tokens (no I/O here).
//
// Didit issuers sign with ES256 only (service-didit-auth
// authentication/services/issuer.py): access tokens carry the header
// `typ: at+jwt` and ID tokens `typ: JWT`. Every other algorithm, including
// `none`, is refused before any key is looked up.

import { TokenVerificationError, type TokenVerificationReason } from "../core/errors.js";
import {
  base64UrlDecode,
  constantTimeEqual,
  hasMember,
  isRecord,
  parseStrictJson,
  utf8Decode,
  utf8Encode,
} from "./encoding.js";

/** The one algorithm Didit issuers sign with. */
export const ALGORITHM = "ES256";
/** Bounds the work done on an untrusted token. */
export const MAX_TOKEN_LENGTH = 16384;

/** Which kind of token is being verified. */
export type TokenKind = "access" | "id";

// Media type names are case-insensitive and may omit "application/" (RFC 7515
// section 4.1.9). Access tokens are typed at+jwt (RFC 9068).
const ACCESS_TYPES = new Set(["at+jwt", "application/at+jwt"]);
const ID_TYPES = new Set(["jwt", "application/jwt"]);

/** A JWS whose header passed the algorithm and type checks; not yet verified. */
export interface ParsedToken {
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
  signingInput: Uint8Array<ArrayBuffer>;
  signature: Uint8Array<ArrayBuffer>;
  kid: string;
}

/** What `checkClaims` compares the claims with. */
export interface ClaimExpectations {
  kind: TokenKind;
  issuer: string;
  /** Any one of these must be in `aud`; `null` skips the audience check. */
  audience: readonly string[] | null;
  /** The ID token's `nonce` must equal it; `null` skips the nonce check. */
  nonce: string | null;
  /** Seconds of clock skew allowed for `exp`, `nbf` and `iat`. */
  leeway: number;
  /** Seconds since the epoch. */
  now: number;
}

function fail(reason: TokenVerificationReason, message: string): never {
  throw new TokenVerificationError(reason, message);
}

// JSON.stringify returns undefined for undefined, functions and symbols.
function jsonText(value: unknown): string | undefined {
  return JSON.stringify(value);
}

/** A short, safe rendering of a header or claim value for an error message. */
export function shown(value: unknown): string {
  let text: string;
  try {
    text = jsonText(value) ?? String(value);
  } catch {
    text = typeof value;
  }
  return text.length <= 64 ? text : `${text.slice(0, 61)}...`;
}

function jsonObject(segment: string, part: string): Record<string, unknown> {
  const bytes = base64UrlDecode(segment);
  if (!bytes) fail("malformed", `The token ${part} is not base64url.`);
  const text = utf8Decode(bytes);
  let value: unknown;
  try {
    if (text === null) throw new SyntaxError("not UTF-8");
    value = parseStrictJson(text);
  } catch {
    fail("malformed", `The token ${part} is not valid JSON.`);
  }
  if (!isRecord(value)) fail("malformed", `The token ${part} is not a JSON object.`);
  return value;
}

function checkType(header: Record<string, unknown>, kind: TokenKind): void {
  const typ = header.typ;
  if (kind === "access") {
    if (typeof typ !== "string" || !ACCESS_TYPES.has(typ.toLowerCase())) {
      fail(
        "invalid_type",
        `The token is not an access token: its header typ is ${shown(typ)}, not "at+jwt".`,
      );
    }
    return;
  }
  // ID tokens are signed with typ JWT; refusing at+jwt keeps an access token from passing as one.
  if (typ !== undefined && typ !== null) {
    if (typeof typ !== "string" || !ID_TYPES.has(typ.toLowerCase())) {
      fail(
        "invalid_type",
        `The token is not an ID token: its header typ is ${shown(typ)}, not "JWT".`,
      );
    }
  }
}

/**
 * Split and decode a compact JWS and check its header (`alg`, `crit`, `typ`,
 * `kid`) and the signature's length. Throws `TokenVerificationError`; nothing
 * here is trusted until the signature has been checked.
 */
export function parseToken(token: unknown, kind: TokenKind): ParsedToken {
  if (typeof token !== "string" || !token) fail("malformed", "The token is empty or not a string.");
  if (token.length > MAX_TOKEN_LENGTH) {
    fail("malformed", `The token is longer than ${MAX_TOKEN_LENGTH} characters.`);
  }
  const parts = token.split(".");
  const [headerPart, payloadPart, signaturePart] = parts;
  if (parts.length !== 3 || headerPart === undefined || payloadPart === undefined) {
    fail("malformed", "The token is not a compact JWS (three dot-separated segments).");
  }
  const header = jsonObject(headerPart, "header");
  const alg = header.alg;
  if (alg !== ALGORITHM) {
    fail(
      "unsupported_algorithm",
      alg === undefined
        ? "The token header names no algorithm (alg); only ES256 is accepted."
        : `The token is signed with ${shown(alg)}; only ES256 is accepted.`,
    );
  }
  if (hasMember(header, "crit")) {
    fail("malformed", "The token header has critical extensions (crit), which are not supported.");
  }
  checkType(header, kind);
  const kid = header.kid;
  if (typeof kid !== "string" || !kid)
    fail("malformed", "The token header names no signing key (kid).");
  const claims = jsonObject(payloadPart, "payload");
  const signature = base64UrlDecode(signaturePart ?? "");
  if (!signature) fail("malformed", "The token signature is not base64url.");
  // Checked before any key is looked up, so junk never causes a key set fetch.
  if (signature.length !== 64) {
    fail("invalid_signature", "The token's signature is not a 64-byte ES256 (r || s) signature.");
  }
  return {
    header,
    claims,
    signingInput: utf8Encode(`${headerPart}.${payloadPart}`),
    signature,
    kid,
  };
}

/**
 * The public JWK to import for a P-256 signing key, or `null` when the key is
 * anything else (another curve or key type, or not meant for ES256 signatures).
 * Only the public members are copied, so a stray `d` or `key_ops` never changes
 * what is imported.
 */
export function p256Jwk(jwk: Record<string, unknown>): JsonWebKey | null {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") return null;
  const use = hasMember(jwk, "use") ? jwk.use : "sig";
  const alg = hasMember(jwk, "alg") ? jwk.alg : ALGORITHM;
  if (use !== "sig" || alg !== ALGORITHM) return null;
  const { x, y } = jwk;
  if (typeof x !== "string" || typeof y !== "string") return null;
  if (base64UrlDecode(x)?.length !== 32 || base64UrlDecode(y)?.length !== 32) return null;
  return { kty: "EC", crv: "P-256", x, y, ext: true };
}

function numericDate(claims: Record<string, unknown>, name: string): number {
  if (!hasMember(claims, name)) fail("missing_claim", `The token has no ${name} claim.`);
  const value = claims[name];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail("malformed", `The token's ${name} claim is not a number of seconds.`);
  }
  return value;
}

function audiences(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

/**
 * Check the registered claims of a token whose signature is already verified.
 * `iss` must equal the issuer; `sub`, `exp` and `iat` must be present; `exp`,
 * `nbf` and `iat` are compared with `now` allowing `leeway` seconds of clock
 * skew; `aud` must contain one of `audience` when it is given; for an ID token
 * `nonce` must equal the expected nonce when one is given.
 */
export function checkClaims(claims: Record<string, unknown>, expected: ClaimExpectations): void {
  const { iss } = claims;
  if (iss === undefined || iss === null) fail("missing_claim", "The token has no iss claim.");
  if (iss !== expected.issuer) {
    fail(
      "invalid_issuer",
      `The token was issued by ${shown(iss)}, not by ${JSON.stringify(expected.issuer)}.`,
    );
  }
  const { sub } = claims;
  if (typeof sub !== "string" || !sub) fail("missing_claim", "The token has no sub claim.");
  const exp = numericDate(claims, "exp");
  const iat = numericDate(claims, "iat");
  const nbf = hasMember(claims, "nbf") ? numericDate(claims, "nbf") : null;
  const { now, leeway } = expected;
  if (now >= exp + leeway) fail("expired", "The token has expired.");
  if (nbf !== null && now + leeway < nbf) {
    fail("not_yet_valid", "The token is not valid yet (nbf is in the future).");
  }
  if (now + leeway < iat) fail("invalid_issued_at", "The token was issued in the future (iat).");
  if (expected.audience !== null) {
    if (!hasMember(claims, "aud")) fail("missing_claim", "The token has no aud claim.");
    const granted = audiences(claims.aud);
    if (!expected.audience.some((audience) => granted.includes(audience))) {
      fail("invalid_audience", "The token was not issued for this audience.");
    }
  }
  if (expected.kind === "id" && expected.nonce !== null) {
    const { nonce } = claims;
    if (typeof nonce !== "string" || !constantTimeEqual(nonce, expected.nonce)) {
      fail("invalid_nonce", "The ID token's nonce does not match this sign-in.");
    }
  }
}
