// Caching of the issuer's discovery document and key set (no I/O here).
//
// Both are cached for the response's `Cache-Control: max-age` (Didit sends
// `public, max-age=300`), five minutes when the header is absent, never less
// than a minute and never more than a day. A token whose `kid` is not in the
// cached key set triggers a refetch only when the last fetch, successful or
// failed, is at least a minute old. After a failed fetch, verification that
// needs the keys fails fast for a minute (as a connection error) instead of
// fetching again for every token.

import { TokenVerificationError } from "../core/errors.js";
import { isRecord } from "./encoding.js";
import { p256Jwk } from "./jwt.js";

/** Seconds a response without `max-age` is kept. */
export const DEFAULT_MAX_AGE = 300;
/** The shortest time anything is kept, so no response makes the SDK fetch on every token. */
export const MIN_MAX_AGE = 60;
/** The longest time anything is kept, so a rotated key is always picked up within a day. */
export const MAX_MAX_AGE = 86_400;
/** The least time between two key set fetches caused by unknown `kid`s. */
export const REFETCH_INTERVAL = 60;

const INTEGER = /^[+-]?\d+$/;

/**
 * How long, in seconds, a discovery or JWKS response may be kept: `max-age`
 * (less the `Age` a shared cache reports), or zero for `no-store` and
 * `no-cache`, or five minutes without either; then clamped to 60 seconds ..
 * one day.
 */
export function cacheSeconds(headers: Headers): number {
  let maxAge: number | null = null;
  for (const directive of (headers.get("cache-control") ?? "").split(",")) {
    const [rawName = "", ...rest] = directive.split("=");
    const name = rawName.trim().toLowerCase();
    if (name === "no-store" || name === "no-cache") {
      maxAge = 0;
      break;
    }
    if (name === "max-age") {
      const value = rest.join("=").trim().replace(/^"|"$/g, "");
      if (INTEGER.test(value)) maxAge = Number.parseInt(value, 10);
    }
  }
  let seconds = DEFAULT_MAX_AGE;
  if (maxAge !== null) {
    seconds = maxAge;
    const age = (headers.get("age") ?? "0").trim();
    if (INTEGER.test(age)) seconds -= Number.parseInt(age, 10);
  }
  return Math.min(MAX_MAX_AGE, Math.max(MIN_MAX_AGE, seconds));
}

/** The parts of `/.well-known/openid-configuration` the SDK uses. */
export interface Discovery {
  issuer: string | null;
  tokenEndpoint: string | null;
  jwksUri: string | null;
}

function absoluteUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return (url.protocol === "https:" || url.protocol === "http:") && url.hostname ? value : null;
}

/**
 * The discovery document, or `null` when `data` is not a JSON object. An
 * endpoint that is not an absolute http(s) URL counts as absent, and the
 * documented path under the issuer is used instead.
 */
export function parseDiscovery(data: unknown): Discovery | null {
  if (!isRecord(data)) return null;
  const { issuer } = data;
  return {
    issuer: typeof issuer === "string" ? issuer : null,
    tokenEndpoint: absoluteUrl(data.token_endpoint),
    jwksUri: absoluteUrl(data.jwks_uri),
  };
}

/** The issuer's published keys by `kid`, with the public keys imported so far. */
export class KeySet {
  readonly keys: ReadonlyMap<string, Record<string, unknown>>;
  readonly #imported = new Map<string, Promise<CryptoKey | null>>();

  constructor(keys: ReadonlyMap<string, Record<string, unknown>>) {
    this.keys = keys;
  }

  /** Whether the issuer publishes a key (usable or not) with this `kid`. */
  has(kid: string): boolean {
    return this.keys.has(kid);
  }

  /** How many published keys have been imported (or are being imported); never more than `keys.size`. */
  get importedCount(): number {
    return this.#imported.size;
  }

  /** The P-256 key published as `kid`, or `TokenVerificationError("unknown_key")`. */
  async publicKey(kid: string, subtle: SubtleCrypto): Promise<CryptoKey> {
    // Only published kids are remembered: a `kid` comes from an unverified token,
    // so remembering every one would let forged tokens grow this map without limit.
    const jwk = this.keys.get(kid);
    let imported = jwk ? this.#imported.get(kid) : undefined;
    if (jwk && !imported) {
      const usable = p256Jwk(jwk);
      imported = usable
        ? subtle
            .importKey("jwk", usable, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
            .catch(() => null) // a point that is not on the curve
        : Promise.resolve(null);
      this.#imported.set(kid, imported);
    }
    const key = imported ? await imported : null;
    if (!key) {
      throw new TokenVerificationError(
        "unknown_key",
        "The issuer publishes no ES256 (P-256) key with the token's key id (kid).",
      );
    }
    return key;
  }
}

/**
 * The key set, or `null` when `data` is not a JWKS (`{"keys": [...]}`). Keys
 * without a string `kid` are ignored: Didit always sets one, and a token is
 * matched to its key by `kid` only. The first usable (ES256, P-256) key with a
 * given `kid` wins, so an entry of another type cannot hide it.
 */
export function parseKeySet(data: unknown): KeySet | null {
  if (!isRecord(data) || !Array.isArray(data.keys)) return null;
  const byKid = new Map<string, Record<string, unknown>>();
  for (const item of data.keys as unknown[]) {
    if (!isRecord(item)) continue;
    const { kid } = item;
    if (typeof kid !== "string" || !kid) continue;
    const current = byKid.get(kid);
    if (!current || (!p256Jwk(current) && p256Jwk(item))) byKid.set(kid, item);
  }
  return new KeySet(byKid);
}

interface Entry<T> {
  value: T;
  expiresAt: number;
}

/** What is cached for one issuer, and when to fetch again. Times are in seconds. */
export class IssuerCache {
  readonly #clock: () => number;
  #discovery: Entry<Discovery> | null = null;
  #keySet: Entry<KeySet> | null = null;
  #keySetAttemptedAt: number | null = null;
  #keySetFailed = false;
  #discoveryRefusal: { error: Error; until: number } | null = null;

  constructor(clock: () => number) {
    this.#clock = clock;
  }

  /**
   * Remember for a minute that the discovery document cannot be used (it names
   * another issuer), so a misconfigured backend does not fetch it on every
   * request. Returns `error`.
   */
  refuseDiscovery(error: Error): Error {
    this.#discoveryRefusal = { error, until: this.#clock() + REFETCH_INTERVAL };
    return error;
  }

  /** The error from {@link refuseDiscovery} while its minute lasts. */
  discoveryRefusal(): Error | null {
    const refusal = this.#discoveryRefusal;
    return refusal && this.#clock() < refusal.until ? refusal.error : null;
  }

  /** The cached discovery document while it is fresh. */
  discovery(): Discovery | null {
    const entry = this.#discovery;
    return entry && this.#clock() < entry.expiresAt ? entry.value : null;
  }

  storeDiscovery(discovery: Discovery, headers: Headers): Discovery {
    this.#discovery = { value: discovery, expiresAt: this.#clock() + cacheSeconds(headers) };
    return discovery;
  }

  /** The cached key set while it is fresh. */
  keySet(): KeySet | null {
    const entry = this.#keySet;
    return entry && this.#clock() < entry.expiresAt ? entry.value : null;
  }

  storeKeySet(keySet: KeySet, headers: Headers): KeySet {
    const now = this.#clock();
    this.#keySet = { value: keySet, expiresAt: now + cacheSeconds(headers) };
    this.#keySetAttemptedAt = now;
    this.#keySetFailed = false;
    return keySet;
  }

  /** Note a fetch of the key set (or of the discovery document before it) that failed. */
  keySetFetchFailed(): void {
    this.#keySetAttemptedAt = this.#clock();
    this.#keySetFailed = true;
  }

  /** No key set is fresh and the last fetch failed less than a minute ago. */
  keySetUnavailable(): boolean {
    const attemptedAt = this.#keySetAttemptedAt;
    return (
      this.#keySetFailed &&
      this.keySet() === null &&
      attemptedAt !== null &&
      this.#clock() - attemptedAt < REFETCH_INTERVAL
    );
  }

  /**
   * The fresh key set to look `kid` up in, or `null` when it must be fetched
   * first: when none is fresh, or when `kid` is not in it and the last fetch,
   * successful or failed, was at least a minute ago. A fresh key set without
   * `kid` is returned within that minute, so the lookup fails as `unknown_key`.
   */
  keySetFor(kid: string): KeySet | null {
    const keySet = this.keySet();
    if (!keySet) return null;
    if (keySet.has(kid)) return keySet;
    const attemptedAt = this.#keySetAttemptedAt;
    return attemptedAt !== null && this.#clock() - attemptedAt < REFETCH_INTERVAL ? keySet : null;
  }
}
