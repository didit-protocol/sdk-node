// What the SDK needs from the JavaScript runtime it runs on: environment
// variables, the runtime's name for the User-Agent header, and Web Crypto.
// Only web platform APIs are used, so the same code runs on Node.js, Bun, Deno
// and edge runtimes (Cloudflare Workers, Vercel Edge).

import { DiditError } from "./errors.js";
import { VERSION } from "./version.js";

interface ProcessLike {
  env?: Record<string, string | undefined>;
  versions?: Record<string, string | undefined>;
  version?: string;
  platform?: string;
}

interface DenoLike {
  env?: { get?: (name: string) => string | undefined };
  version?: { deno?: string };
  build?: { os?: string };
}

function processLike(): ProcessLike | undefined {
  const value = (globalThis as { process?: unknown }).process;
  return typeof value === "object" && value !== null ? (value) : undefined;
}

function denoLike(): DenoLike | undefined {
  const value = (globalThis as { Deno?: unknown }).Deno;
  return typeof value === "object" && value !== null ? (value) : undefined;
}

/**
 * An environment variable, trimmed, or `undefined` when it is not set, empty,
 * or the runtime has no environment (or denies access to it).
 */
export function readEnv(name: string): string | undefined {
  let value: string | undefined;
  try {
    value = processLike()?.env?.[name] ?? denoLike()?.env?.get?.(name);
  } catch {
    // Deno without --allow-env throws; treat it as unset.
    return undefined;
  }
  // An empty value counts as unset.
  return value?.trim() || undefined;
}

export interface RuntimeInfo {
  /** `node`, `bun`, `deno`, `workerd`, `edge-runtime` or `unknown`. */
  name: string;
  version: string;
  os: string;
}

let cachedRuntime: RuntimeInfo | undefined;

/** The runtime this code is running on, for the User-Agent header. */
export function runtimeInfo(): RuntimeInfo {
  if (cachedRuntime) return cachedRuntime;
  const proc = processLike();
  const deno = denoLike();
  const nav = (globalThis as { navigator?: { userAgent?: unknown } }).navigator;
  let info: RuntimeInfo;
  if (proc?.versions?.bun) {
    info = { name: "bun", version: proc.versions.bun, os: proc.platform ?? "unknown" };
  } else if (deno?.version?.deno) {
    info = { name: "deno", version: deno.version.deno, os: deno.build?.os ?? "unknown" };
  } else if (typeof (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime === "string") {
    info = { name: "edge-runtime", version: "unknown", os: "unknown" };
  } else if (nav?.userAgent === "Cloudflare-Workers") {
    info = { name: "workerd", version: "unknown", os: "unknown" };
  } else if (proc?.versions?.node) {
    info = { name: "node", version: proc.versions.node, os: proc.platform ?? "unknown" };
  } else {
    info = { name: "unknown", version: "unknown", os: "unknown" };
  }
  cachedRuntime = info;
  return info;
}

/** `didit-node/<version> (<runtime> <version>; <os>)` (docs/DESIGN.md section 6). */
export function userAgent(): string {
  const { name, version, os } = runtimeInfo();
  return `didit-node/${VERSION} (${name} ${version}; ${os})`;
}

/** `node/<version>`, the value of the X-Didit-Client header. */
export function clientHeader(): string {
  return `node/${VERSION}`;
}

let cachedCrypto: Promise<Crypto> | undefined;

/**
 * Web Crypto. It is a global on every supported runtime except Node.js 18,
 * where it comes from `node:crypto`. The module name is computed so that
 * bundlers for edge runtimes do not try to resolve it.
 */
export function webCrypto(): Promise<Crypto> {
  if (cachedCrypto) return cachedCrypto;
  const global = (globalThis as { crypto?: Crypto }).crypto;
  if (global?.subtle) {
    cachedCrypto = Promise.resolve(global);
    return cachedCrypto;
  }
  const specifier = ["node", "crypto"].join(":");
  const loaded = (async () => {
    let mod: { webcrypto?: Crypto } | undefined;
    try {
      mod = (await import(/* webpackIgnore: true */ /* @vite-ignore */ specifier)) as {
        webcrypto?: Crypto;
      };
    } catch {
      mod = undefined;
    }
    if (!mod?.webcrypto?.subtle) {
      cachedCrypto = undefined;
      throw new DiditError(
        "This runtime has no Web Crypto (globalThis.crypto.subtle); the Didit SDK needs it for webhooks and Authentication.",
      );
    }
    return mod.webcrypto;
  })();
  cachedCrypto = loaded;
  return cachedCrypto;
}
