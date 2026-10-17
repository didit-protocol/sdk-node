// A strict JSON parser for webhook bodies that keeps every number as its exact
// source text. `JSON.parse` turns 9007199254740993 into 9007199254740992, and
// X-Signature-V2 covers the exact digits, so canonical JSON (docs/DESIGN.md
// section 9.2) is built from this parser's output instead.
//
// It accepts exactly what Python's `json.loads` accepts in the reference SDK
// (sdk-python, didit/webhooks/_canonical.py), and builds the same values:
//
// - RFC 8259 grammar only: no NaN or Infinity, no leading zeros, no trailing
//   commas or data, no control characters inside strings, only the standard
//   escapes, whitespace limited to space, tab, CR and LF. A byte order mark is
//   not whitespace, so a body starting with one is refused (Python raises
//   "Unexpected UTF-8 BOM").
// - Duplicate keys: the last value wins, like a Python dict.
// - `\uXXXX` escapes are joined into one code point only when a high surrogate
//   escape is directly followed by a low surrogate escape, as Python does. Any
//   other surrogate escape stays a lone surrogate in the string (a JavaScript
//   string can hold one, like a Python str); canonical.ts encodes it the way
//   the reference does (UTF-8 with "surrogatepass").
// - An integer with more than 4300 digits is refused: Python's default
//   `sys.get_int_max_str_digits()` makes `json.loads` raise for it, so the
//   backend can never send one.
// - A number with a fraction or exponent that overflows a double (1e400) is
//   refused: Python reads it as infinity, which the reference rejects.
// - Nesting deeper than MAX_DEPTH is refused, like Python's RecursionError
//   (about 1000 levels by default).

import { WebhookVerificationError } from "../core/errors.js";

/** The deepest nesting of objects and arrays a webhook body may have. */
export const MAX_DEPTH = 1000;

/** Python refuses to convert integers with more digits than this (3.11+ default). */
export const MAX_INT_DIGITS = 4300;

/** A JSON number, kept as the exact text it had in the body. */
export class LosslessNumber {
  /** The number's source text, for example `9007199254740993` or `1.5e-07`. */
  readonly raw: string;
  /** True when the text has no fraction and no exponent (a Python int). */
  readonly isInteger: boolean;

  constructor(raw: string) {
    this.raw = raw;
    this.isInteger = !/[.eE]/.test(raw);
  }
}

/** A parsed JSON value. Objects have a null prototype, so `__proto__` is an ordinary key. */
export type JsonValue = null | boolean | string | LosslessNumber | JsonValue[] | JsonObject;

/** A parsed JSON object (null prototype). */
export interface JsonObject {
  [key: string]: JsonValue;
}

function invalid(detail: string): WebhookVerificationError {
  return new WebhookVerificationError("invalid_payload", `The webhook body is not valid JSON: ${detail}.`);
}

/**
 * Decode a body as strict UTF-8. Invalid bytes are an `invalid_payload` error,
 * and a leading byte order mark is kept (and then refused by the parser), as
 * Python's `bytes.decode("utf-8")` keeps it.
 */
export function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new WebhookVerificationError("invalid_payload", "The webhook body is not valid UTF-8.");
  }
}

const Char = {
  Tab: 0x09,
  LineFeed: 0x0a,
  CarriageReturn: 0x0d,
  Space: 0x20,
  Quote: 0x22,
  Plus: 0x2b,
  Comma: 0x2c,
  Minus: 0x2d,
  Dot: 0x2e,
  Slash: 0x2f,
  Zero: 0x30,
  One: 0x31,
  Nine: 0x39,
  Colon: 0x3a,
  UpperE: 0x45,
  OpenBracket: 0x5b,
  Backslash: 0x5c,
  CloseBracket: 0x5d,
  LowerB: 0x62,
  LowerE: 0x65,
  LowerF: 0x66,
  LowerN: 0x6e,
  LowerR: 0x72,
  LowerT: 0x74,
  LowerU: 0x75,
  OpenBrace: 0x7b,
  CloseBrace: 0x7d,
} as const;

const SHORT_ESCAPES: Partial<Record<number, string>> = {
  [Char.Quote]: '"',
  [Char.Backslash]: "\\",
  [Char.Slash]: "/",
  [Char.LowerB]: "\b",
  [Char.LowerF]: "\f",
  [Char.LowerN]: "\n",
  [Char.LowerR]: "\r",
  [Char.LowerT]: "\t",
};

function isDigit(c: number): boolean {
  return c >= Char.Zero && c <= Char.Nine;
}

function hexValue(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  return -1;
}

class Parser {
  private pos = 0;

  constructor(private readonly text: string) {}

  parseDocument(): JsonValue {
    this.skipWhitespace();
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.pos < this.text.length) throw invalid(`extra data at position ${this.pos}`);
    return value;
  }

  private skipWhitespace(): void {
    const { text } = this;
    while (this.pos < text.length) {
      const c = text.charCodeAt(this.pos);
      if (c !== Char.Space && c !== Char.LineFeed && c !== Char.CarriageReturn && c !== Char.Tab) {
        return;
      }
      this.pos++;
    }
  }

  private unexpected(): WebhookVerificationError {
    return this.pos >= this.text.length
      ? invalid("unexpected end of input")
      : invalid(`unexpected character at position ${this.pos}`);
  }

  private parseValue(depth: number): JsonValue {
    const c = this.text.charCodeAt(this.pos);
    switch (c) {
      case Char.OpenBrace:
        return this.parseObject(depth + 1);
      case Char.OpenBracket:
        return this.parseArray(depth + 1);
      case Char.Quote:
        return this.parseString();
      case Char.LowerT:
        return this.parseLiteral("true", true);
      case Char.LowerF:
        return this.parseLiteral("false", false);
      case Char.LowerN:
        return this.parseLiteral("null", null);
      default:
        if (c === Char.Minus || isDigit(c)) return this.parseNumber();
        throw this.unexpected();
    }
  }

  private parseLiteral<T>(word: string, value: T): T {
    if (!this.text.startsWith(word, this.pos)) throw this.unexpected();
    this.pos += word.length;
    return value;
  }

  private parseObject(depth: number): JsonObject {
    if (depth > MAX_DEPTH) throw invalid(`nesting deeper than ${MAX_DEPTH} levels`);
    const { text } = this;
    const object = Object.create(null) as JsonObject;
    this.pos++; // {
    this.skipWhitespace();
    if (text.charCodeAt(this.pos) === Char.CloseBrace) {
      this.pos++;
      return object;
    }
    for (;;) {
      if (text.charCodeAt(this.pos) !== Char.Quote) throw this.unexpected();
      const key = this.parseString();
      this.skipWhitespace();
      if (text.charCodeAt(this.pos) !== Char.Colon) throw this.unexpected();
      this.pos++;
      this.skipWhitespace();
      // Assignment on a null-prototype object always creates an own property,
      // and a repeated key overwrites the earlier value (last wins).
      object[key] = this.parseValue(depth);
      this.skipWhitespace();
      const next = text.charCodeAt(this.pos);
      if (next === Char.Comma) {
        this.pos++;
        this.skipWhitespace();
      } else if (next === Char.CloseBrace) {
        this.pos++;
        return object;
      } else {
        throw this.unexpected();
      }
    }
  }

  private parseArray(depth: number): JsonValue[] {
    if (depth > MAX_DEPTH) throw invalid(`nesting deeper than ${MAX_DEPTH} levels`);
    const { text } = this;
    const array: JsonValue[] = [];
    this.pos++; // [
    this.skipWhitespace();
    if (text.charCodeAt(this.pos) === Char.CloseBracket) {
      this.pos++;
      return array;
    }
    for (;;) {
      array.push(this.parseValue(depth));
      this.skipWhitespace();
      const next = text.charCodeAt(this.pos);
      if (next === Char.Comma) {
        this.pos++;
        this.skipWhitespace();
      } else if (next === Char.CloseBracket) {
        this.pos++;
        return array;
      } else {
        throw this.unexpected();
      }
    }
  }

  private parseString(): string {
    const { text } = this;
    let pos = this.pos + 1; // after the opening quote
    let out = "";
    let runStart = pos;
    for (;;) {
      if (pos >= text.length) {
        this.pos = pos;
        throw invalid("unterminated string");
      }
      const c = text.charCodeAt(pos);
      if (c === Char.Quote) {
        out += text.slice(runStart, pos);
        this.pos = pos + 1;
        return out;
      }
      if (c < Char.Space) {
        this.pos = pos;
        throw invalid(`control character in a string at position ${pos}`);
      }
      if (c !== Char.Backslash) {
        pos++;
        continue;
      }
      out += text.slice(runStart, pos);
      const escape = text.charCodeAt(pos + 1);
      const short = SHORT_ESCAPES[escape];
      if (short !== undefined) {
        out += short;
        pos += 2;
      } else if (escape === Char.LowerU) {
        let unit = 0;
        for (let i = pos + 2; i < pos + 6; i++) {
          const digit = hexValue(text.charCodeAt(i));
          if (digit < 0) {
            this.pos = pos;
            throw invalid(`invalid \\uXXXX escape at position ${pos}`);
          }
          unit = unit * 16 + digit;
        }
        // Code units are appended one by one: a high surrogate escape directly
        // followed by a low surrogate escape forms one code point, exactly the
        // pairs Python joins; any other surrogate stays lone, as in Python.
        out += String.fromCharCode(unit);
        pos += 6;
      } else {
        this.pos = pos;
        throw invalid(`invalid escape at position ${pos}`);
      }
      runStart = pos;
    }
  }

  private parseNumber(): LosslessNumber {
    const { text } = this;
    const start = this.pos;
    let pos = start;
    if (text.charCodeAt(pos) === Char.Minus) pos++;
    const first = text.charCodeAt(pos);
    if (first === Char.Zero) {
      pos++;
    } else if (first >= Char.One && first <= Char.Nine) {
      while (isDigit(text.charCodeAt(pos))) pos++;
    } else {
      this.pos = pos;
      throw this.unexpected();
    }
    const integerEnd = pos;
    let isFloat = false;
    if (text.charCodeAt(pos) === Char.Dot) {
      if (!isDigit(text.charCodeAt(pos + 1))) {
        this.pos = pos + 1;
        throw this.unexpected();
      }
      pos += 2;
      while (isDigit(text.charCodeAt(pos))) pos++;
      isFloat = true;
    }
    const e = text.charCodeAt(pos);
    if (e === Char.LowerE || e === Char.UpperE) {
      pos++;
      const sign = text.charCodeAt(pos);
      if (sign === Char.Plus || sign === Char.Minus) pos++;
      if (!isDigit(text.charCodeAt(pos))) {
        this.pos = pos;
        throw this.unexpected();
      }
      while (isDigit(text.charCodeAt(pos))) pos++;
      isFloat = true;
    }
    this.pos = pos;
    const raw = text.slice(start, pos);
    if (isFloat) {
      if (!Number.isFinite(Number(raw))) throw invalid(`number ${raw} overflows a double`);
    } else if (integerEnd - start - (text.charCodeAt(start) === Char.Minus ? 1 : 0) > MAX_INT_DIGITS) {
      throw invalid(`integer with more than ${MAX_INT_DIGITS} digits`);
    }
    return new LosslessNumber(raw);
  }
}

/**
 * Parse JSON text strictly (see the top of this file), keeping numbers as
 * {@link LosslessNumber}. Throws a `WebhookVerificationError` with reason
 * `invalid_payload` for anything Python's `json.loads` would refuse.
 */
export function parseJson(text: string): JsonValue {
  return new Parser(text).parseDocument();
}

/** True when `value` is a parsed JSON object (not an array, not null). */
export function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof LosslessNumber);
}
