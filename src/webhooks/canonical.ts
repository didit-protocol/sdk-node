// Canonical JSON, the text X-Signature-V2 signs (docs/DESIGN.md section 9.2).
// It is exactly what the backend computes in Python:
//
//   json.dumps(shorten_floats(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
//
// where shorten_floats turns every float with an integral value into an int.

import { WebhookVerificationError } from "../core/errors.js";
import { LosslessNumber, MAX_DEPTH } from "./json.js";

/**
 * Compare two strings by Unicode code point, the order Python's `sorted` gives
 * `str` keys. Plain `<` compares UTF-16 code units, which puts U+1F600 (a
 * surrogate pair) before U+FB00. A lone surrogate counts as its own code point,
 * as it does in Python.
 */
export function compareCodePoints(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  let i = 0;
  while (i < length) {
    // Equal code points take the same number of code units, so one index
    // walks both strings.
    const ca = a.codePointAt(i) ?? 0;
    const cb = b.codePointAt(i) ?? 0;
    if (ca !== cb) return ca - cb;
    i += ca > 0xffff ? 2 : 1;
  }
  return a.length - b.length;
}

const NEEDS_ESCAPE = /["\\\u0000-\u001f]/;

function escapeChar(c: number): string {
  switch (c) {
    case 0x22:
      return '\\"';
    case 0x5c:
      return "\\\\";
    case 0x0a:
      return "\\n";
    case 0x0d:
      return "\\r";
    case 0x09:
      return "\\t";
    case 0x08:
      return "\\b";
    case 0x0c:
      return "\\f";
    default:
      return `\\u00${c.toString(16).padStart(2, "0")}`;
  }
}

/**
 * A JSON string the way Python writes it with `ensure_ascii=False`: only `"`,
 * `\` and characters below U+0020 are escaped (short forms where they exist,
 * else `\u00xx` in lowercase); everything else, including `/`, U+007F, U+2028
 * and U+2029, stays literal.
 */
export function quoteString(s: string): string {
  if (!NEEDS_ESCAPE.test(s)) return `"${s}"`;
  let out = '"';
  let runStart = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x20 && c !== 0x22 && c !== 0x5c) continue;
    out += s.slice(runStart, i) + escapeChar(c);
    runStart = i + 1;
  }
  return `${out}${s.slice(runStart)}"`;
}

/**
 * Python's `repr(float)` of a finite double: the shortest digits that read
 * back as the same double, in positional notation (with `.0` when integral)
 * when the decimal exponent is between -4 and 15, else in scientific notation
 * with a signed exponent of at least two digits (`1e-05`, `1.5e+16`).
 */
export function pyFloatRepr(value: number): string {
  if (value === 0) return Object.is(value, -0) ? "-0.0" : "0.0";
  const sign = value < 0 ? "-" : "";
  // Number#toString gives the shortest round-trip digits too (ECMA-262
  // Number::toString), only with different notation rules. Take its digits and
  // exponent and lay them out the way Python does.
  const text = Math.abs(value).toString();
  const e = text.indexOf("e");
  const mantissa = e < 0 ? text : text.slice(0, e);
  const exponent = e < 0 ? 0 : Number(text.slice(e + 1));
  const dot = mantissa.indexOf(".");
  const integerPart = dot < 0 ? mantissa : mantissa.slice(0, dot);
  let digits = integerPart + (dot < 0 ? "" : mantissa.slice(dot + 1));
  // value = 0.<digits> * 10^point
  let point = integerPart.length + exponent;
  const leadingZeros = /^0*/.exec(digits)?.[0].length ?? 0;
  digits = digits.slice(leadingZeros).replace(/0+$/, "");
  point -= leadingZeros;
  // CPython (format_float_short, mode "r"): exponent form when point <= -4 or point > 16.
  if (point <= -4 || point > 16) {
    const exp = point - 1;
    const head = digits.length > 1 ? `${digits[0] ?? ""}.${digits.slice(1)}` : digits;
    return `${sign}${head}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  }
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${"0".repeat(point - digits.length)}.0`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/** The exact integer value of an integral double, as Python's `int(f)` prints it (`-0.0` is `0`). */
export function integralFloatString(value: number): string {
  return BigInt(value).toString();
}

/** Python's `str(int)` of a JSON integer literal: its digits, with `-0` as `0`. */
export function integerLiteralString(raw: string): string {
  return raw === "-0" ? "0" : raw;
}

function notJson(detail: string): WebhookVerificationError {
  return new WebhookVerificationError(
    "invalid_payload",
    `The webhook payload is not JSON data Didit sends: ${detail}.`,
  );
}

function writeFloat(value: number): string {
  if (!Number.isFinite(value)) throw notJson("NaN and Infinity are not JSON");
  // shorten_floats: a float with an integral value is written as an integer.
  return Number.isInteger(value) ? integralFloatString(value) : pyFloatRepr(value);
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function write(value: unknown, depth: number): string {
  switch (typeof value) {
    case "string":
      return quoteString(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return writeFloat(value);
    case "bigint":
      return value.toString();
    case "object": {
      if (value === null) return "null";
      if (value instanceof LosslessNumber) {
        return value.isInteger ? integerLiteralString(value.raw) : writeFloat(Number(value.raw));
      }
      // Python's RecursionError, which also stops a self-referencing payload.
      if (depth >= MAX_DEPTH) throw notJson(`nesting deeper than ${MAX_DEPTH} levels`);
      if (Array.isArray(value)) {
        const parts: string[] = [];
        for (let i = 0; i < value.length; i++) parts.push(write(value[i], depth + 1));
        return `[${parts.join(",")}]`;
      }
      if (!isPlainObject(value)) throw notJson("an object that is not a plain object");
      const keys = Object.keys(value).sort(compareCodePoints);
      const parts: string[] = [];
      for (const key of keys) parts.push(`${quoteString(key)}:${write(value[key], depth + 1)}`);
      return `{${parts.join(",")}}`;
    }
    default:
      throw notJson(`a value of type ${typeof value}`);
  }
}

/**
 * The canonical JSON of a parsed webhook body: the text `X-Signature-V2` signs
 * (docs/DESIGN.md section 9.2), equal to the backend's
 * `json.dumps(shorten_floats(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False)`.
 *
 * `value` is made of plain objects, arrays, strings, booleans, `null`,
 * numbers and bigints. A number with an integral value is written as an
 * integer; any other finite number in Python `repr` form. Numbers from
 * `JSON.parse` lose precision above 2^53, so an integer like
 * 9007199254740993 must be given as a bigint to keep its digits
 * ({@link verifyWebhook} canonicalises from the raw body and never has this
 * problem).
 *
 * Throws a `WebhookVerificationError` with reason `invalid_payload` for
 * anything that is not JSON data: NaN, Infinity, `undefined`, functions,
 * class instances (such as `Date` or `Map`), and nesting deeper than 1000
 * levels (which includes a payload that contains itself).
 */
export function canonicalJson(value: unknown): string {
  return write(value, 0);
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** True when `s` contains a surrogate code unit that is not half of a pair. */
export function hasLoneSurrogate(s: string): boolean {
  return LONE_SURROGATE.test(s);
}

const encoder = new TextEncoder();

/**
 * The UTF-8 bytes of `s`, encoding a lone surrogate as its three-byte form
 * like Python's `str.encode("utf-8", "surrogatepass")`, which the reference
 * SDK applies to canonical JSON. (TextEncoder would replace it with U+FFFD.)
 */
export function encodeUtf8SurrogatePass(s: string): Uint8Array<ArrayBuffer> {
  if (!hasLoneSurrogate(s)) return encoder.encode(s);
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0x10000) {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      bytes.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}
