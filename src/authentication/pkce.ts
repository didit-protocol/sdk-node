// PKCE (RFC 7636), `state` and `nonce` values for the authorization code flow.
// They are async because Web Crypto is loaded lazily on Node.js 18.

import { webCrypto } from "../core/runtime.js";
import { base64UrlEncode, utf8Encode } from "./encoding.js";

// 32 random octets, base64url encoded: the 43-character verifier RFC 7636 section 4.1 recommends.
const RANDOM_BYTES = 32;

/**
 * A PKCE verifier and its S256 challenge. Send `codeChallenge` and
 * `codeChallengeMethod` with the authorization request, keep `codeVerifier` on
 * your server and pass it to `exchangeCode`.
 */
export interface PkcePair {
  /** 43 characters of unpadded base64url from 32 random bytes. Keep it secret. */
  codeVerifier: string;
  /** `BASE64URL(SHA256(codeVerifier))`, without padding. */
  codeChallenge: string;
  /** Always `S256`, the only method Didit accepts. */
  codeChallengeMethod: "S256";
}

async function randomValue(): Promise<string> {
  const crypto = await webCrypto();
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(RANDOM_BYTES)));
}

/** `BASE64URL(SHA256(ASCII(verifier)))` without padding (RFC 7636 section 4.2). */
export async function s256Challenge(verifier: string): Promise<string> {
  const crypto = await webCrypto();
  const digest = await crypto.subtle.digest("SHA-256", utf8Encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/** A new random PKCE verifier (43 characters) and its S256 challenge. */
export async function createPkce(): Promise<PkcePair> {
  const codeVerifier = await randomValue();
  return {
    codeVerifier,
    codeChallenge: await s256Challenge(codeVerifier),
    codeChallengeMethod: "S256",
  };
}

/**
 * A new random `state` value (43 characters of base64url). Store it with the
 * sign-in attempt and compare it with the `state` on the callback before
 * exchanging the code.
 */
export function createState(): Promise<string> {
  return randomValue();
}

/**
 * A new random `nonce` value (43 characters of base64url). Send it with the
 * authorization request and pass it to `verifyIdToken`, which checks that the
 * ID token carries the same value.
 */
export function createNonce(): Promise<string> {
  return randomValue();
}
