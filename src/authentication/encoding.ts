// Byte and JSON helpers for tokens, keys and publishable keys, on web platform
// APIs only (atob, btoa, TextEncoder, TextDecoder).

const BASE64URL = /^[A-Za-z0-9_-]*$/;

// fatal: invalid UTF-8 is an error, not U+FFFD. ignoreBOM: a byte order mark is
// kept, so JSON.parse refuses it as Python's json.loads does.
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const ENCODER = new TextEncoder();

/** Unpadded base64url (RFC 7515 section 2) to bytes, or `null` when `text` is not that. */
export function base64UrlDecode(text: string): Uint8Array<ArrayBuffer> | null {
  if (!BASE64URL.test(text) || text.length % 4 === 1) return null;
  const padded =
    text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  // atob ignores the unused low bits of the last character, so several strings
  // decode to the same bytes; only the canonical one is accepted.
  return base64UrlEncode(bytes) === text ? bytes : null;
}

/** Bytes to unpadded base64url. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Strict UTF-8 to a string, or `null` when the bytes are not valid UTF-8. */
export function utf8Decode(bytes: Uint8Array): string | null {
  try {
    return UTF8.decode(bytes);
  } catch {
    return null;
  }
}

/** A string to UTF-8 bytes. */
export function utf8Encode(text: string): Uint8Array<ArrayBuffer> {
  return ENCODER.encode(text);
}

/** A JSON object (not an array, not `null`). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether `object` has `name` as its own member (not one inherited from Object.prototype). */
export function hasMember(object: Record<string, unknown>, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, name);
}

/** Deeper nesting than any token carries; bounds the work on untrusted input. */
const MAX_DEPTH = 64;

/**
 * `JSON.parse` that also refuses an object with two members of the same name
 * and nesting deeper than 64 levels, by throwing a `SyntaxError`. JSON.parse
 * keeps the last duplicate silently, so `{"alg":"ES256","alg":"none"}` would
 * mean different things to different parsers; a token must be unambiguous.
 */
export function parseStrictJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  // The text is valid JSON now, so a scan only has to track strings and brackets.
  const stack: (Set<string> | null)[] = [];
  let expectKey = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      let end = i + 1;
      while (text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      const members = stack[stack.length - 1];
      if (expectKey && members) {
        const name = JSON.parse(text.slice(i, end + 1)) as string;
        if (members.has(name)) throw new SyntaxError("Duplicate member name in a JSON object.");
        members.add(name);
        expectKey = false;
      }
      i = end;
    } else if (char === "{" || char === "[") {
      stack.push(char === "{" ? new Set() : null);
      if (stack.length > MAX_DEPTH) throw new SyntaxError("JSON nested too deeply.");
      expectKey = char === "{";
    } else if (char === "}" || char === "]") {
      stack.pop();
      expectKey = false;
    } else if (char === ",") {
      expectKey = stack[stack.length - 1] instanceof Set;
    }
  }
  return value;
}

/** Compare two strings without an early exit on the first differing character. */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = utf8Encode(a);
  const right = utf8Encode(b);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return difference === 0;
}
