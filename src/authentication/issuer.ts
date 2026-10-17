// The issuer URL and the publishable key that carries it.
//
// An application's issuer is its canonical origin: https://<slug>.auth.didit.me
// (live), https://<slug>.sandbox.auth.didit.me (sandbox) or its active custom
// domain, with no trailing slash. A publishable key is `pk_live_` (live) or
// `pk_test_` (sandbox) followed by the unpadded base64url encoding of the issuer.

import { ConfigurationError } from "../core/errors.js";
import { base64UrlDecode, utf8Decode } from "./encoding.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const PREFIXES = { pk_live_: "live", pk_test_: "test" } as const;
// `scheme://` and a host character: the WHATWG URL parser would also read
// `https:///host` or `https:host` as https://host/, which the issuer text then
// would not match.
const ABSOLUTE = /^[a-z][a-z0-9+.-]*:\/\/[^/]/i;

/** Where a publishable key's application runs: `live`, or `test` for sandbox. */
export type PublishableKeyEnvironment = "live" | "test";

/** What a publishable key carries. */
export interface PublishableKey {
  /** The application's issuer, without a trailing slash. */
  issuer: string;
  /** `live` for `pk_live_` keys, `test` (sandbox) for `pk_test_` keys. */
  environment: PublishableKeyEnvironment;
}

/** Hosts that may use plain http: what Didit allows for local sandbox development. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost");
}

function hasControlOrSpace(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f || /\s/.test(text.charAt(i))) return true;
  }
  return false;
}

/**
 * The issuer without trailing slashes, or a `ConfigurationError`. It must be an
 * absolute https URL with no credentials, query or fragment; plain http is
 * accepted only for localhost and loopback addresses when `allowLoopbackHttp`
 * is true. The text is kept as written (not re-serialised by the URL parser),
 * because tokens must name exactly this value in `iss`.
 */
export function normaliseIssuer(issuer: unknown, allowLoopbackHttp = true): string {
  if (typeof issuer !== "string" || !issuer.trim()) {
    throw new ConfigurationError(
      "The issuer is empty: pass your application's issuer " +
        "(https://<slug>.auth.didit.me or your custom domain) or use " +
        "Authentication.fromPublishableKey(...).",
    );
  }
  const text = issuer.trim();
  let url: URL | null;
  try {
    url = new URL(text);
  } catch {
    url = null;
  }
  if (url && (url.username || url.password)) {
    throw new ConfigurationError("The issuer URL must not contain a user name or password.");
  }
  if (!url?.hostname || !ABSOLUTE.test(text) || /[?#\\]/.test(text) || hasControlOrSpace(text)) {
    throw new ConfigurationError(
      `The issuer must be an absolute https URL with no query or fragment, got ${JSON.stringify(text)}.`,
    );
  }
  const secure = url.protocol === "https:";
  const local = allowLoopbackHttp && url.protocol === "http:" && isLoopbackHost(url.hostname);
  if (!secure && !local) {
    throw new ConfigurationError(
      `The issuer must use https (http only for localhost while testing), got ${JSON.stringify(text)}.`,
    );
  }
  return text.replace(/\/+$/, "");
}

/**
 * The issuer and environment a `pk_live_` or `pk_test_` publishable key carries.
 * A publishable key is a public identifier, not a credential. Surrounding
 * whitespace is ignored. A live key must name an https issuer; a test (sandbox)
 * key may also name http on localhost, as the console allows for sandbox
 * applications. Throws `ConfigurationError` for anything else.
 */
export function parsePublishableKey(key: string): PublishableKey {
  const raw: unknown = key;
  const text = typeof raw === "string" ? raw.trim() : "";
  const prefix = text.slice(0, 8);
  if (prefix !== "pk_live_" && prefix !== "pk_test_") {
    throw new ConfigurationError(
      "A publishable key starts with pk_live_ or pk_test_; copy it from the " +
        "Developers section of Authentication in the Didit console.",
    );
  }
  const encoded = text.slice(8);
  const bytes = encoded ? base64UrlDecode(encoded) : null;
  const issuer = bytes ? utf8Decode(bytes) : null;
  if (issuer === null) {
    throw new ConfigurationError(
      `The publishable key is not valid: expected ${prefix} followed by the base64url-encoded issuer.`,
    );
  }
  const environment = PREFIXES[prefix];
  return { issuer: normaliseIssuer(issuer, environment === "test"), environment };
}
