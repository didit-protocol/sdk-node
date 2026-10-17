// Canonical JSON (docs/DESIGN.md section 9.2) and the strict parser behind it.
// Every expected value below was produced by CPython 3.11 running
//   json.dumps(shorten_floats(json.loads(text)), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
// with the backend's shorten_floats, or repr(float) for the repr table.

import { describe, expect, it } from "vitest";

import { WebhookVerificationError } from "../../src/core/errors.js";
import {
  canonicalJson,
  compareCodePoints,
  encodeUtf8SurrogatePass,
  hasLoneSurrogate,
  pyFloatRepr,
} from "../../src/webhooks/canonical.js";
import { decodeUtf8, LosslessNumber, MAX_DEPTH, parseJson } from "../../src/webhooks/json.js";

/** Canonical JSON of a raw body, the way verifyWebhook computes it. */
function canonical(text: string): string {
  return canonicalJson(parseJson(text));
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof WebhookVerificationError) return error.reason;
    throw error;
  }
  throw new Error("expected a WebhookVerificationError");
}

const MAX_DOUBLE_INTEGER =
  "179769313486231570814527423731704356798070567525844996598917476803157260780028538760589558632766878171540458953514382464234321326889464182768467546703537516986049910576551282076245490090389328944075868508455133942304583236903222948165808559332123348274797826204144723168738177180919299881250404026184124858368";

// [JSON number literal, canonical output from Python]
const NUMBER_LITERALS: [string, string][] = [
  ["1e-05", "1e-05"],
  ["1.5e-05", "1.5e-05"],
  ["1e+16", "10000000000000000"],
  ["1e16", "10000000000000000"],
  ["1E16", "10000000000000000"],
  ["1.0e16", "10000000000000000"],
  ["9999999999999998.0", "9999999999999998"],
  ["1e15", "1000000000000000"],
  ["5e-324", "5e-324"],
  ["4.9e-324", "5e-324"],
  ["1.7976931348623157e+308", MAX_DOUBLE_INTEGER],
  ["0.1", "0.1"],
  ["-0.0", "0"],
  ["0.0", "0"],
  ["-0", "0"],
  ["100.0", "100"],
  ["1e22", "10000000000000000000000"],
  ["1E+22", "10000000000000000000000"],
  ["123456789012345678901234567890", "123456789012345678901234567890"],
  ["-123456789012345678901234567890", "-123456789012345678901234567890"],
  ["1e-400", "0"],
  ["-1e-400", "0"],
  ["0.30000000000000004", "0.30000000000000004"],
  ["2.5e-07", "2.5e-07"],
  ["1.5e-07", "1.5e-07"],
  ["1e-07", "1e-07"],
  ["0.0001", "0.0001"],
  ["0.00001", "1e-05"],
  ["123456789.123456789", "123456789.12345679"],
  ["1234567890123456.7", "1234567890123456.8"],
  ["12345678901234567.0", "12345678901234568"],
  ["1.2345e+20", "123450000000000000000"],
  [
    "1e+100",
    "10000000000000000159028911097599180468360808563945281389781327557747838772170381060813469985856815104",
  ],
  ["9007199254740993", "9007199254740993"],
  ["9007199254740993.0", "9007199254740992"],
  ["2.2250738585072014e-308", "2.2250738585072014e-308"],
  ["87.0", "87"],
  ["87.000", "87"],
  ["-2.5", "-2.5"],
  ["0.5e1", "5"],
  ["10E-1", "1"],
];

// [double, Python repr()] (X-Signature-Simple formats floats this way)
const REPRS: [number, string][] = [
  [0.1, "0.1"],
  [1e-5, "1e-05"],
  [1.5e-5, "1.5e-05"],
  [0.0001, "0.0001"],
  [1e16, "1e+16"],
  [1e15, "1000000000000000.0"],
  [9999999999999998.0, "9999999999999998.0"],
  [1.7976931348623157e308, "1.7976931348623157e+308"],
  [5e-324, "5e-324"],
  [123456789.12345679, "123456789.12345679"],
  [1e22, "1e+22"],
  [0.30000000000000004, "0.30000000000000004"],
  [-2.5e-7, "-2.5e-07"],
  [1.2345e20, "1.2345e+20"],
  [0.5, "0.5"],
  [-0, "-0.0"],
  [0, "0.0"],
  [87, "87.0"],
  [100, "100.0"],
  [1.5e300, "1.5e+300"],
  [2.2250738585072014e-308, "2.2250738585072014e-308"],
  [1 / 3, "0.3333333333333333"],
  [1234567890123456.8, "1234567890123456.8"],
  [1.2345678901234568e16, "1.2345678901234568e+16"],
  [9.999999999999999e-5, "9.999999999999999e-05"],
  [299792458, "299792458.0"],
  [-1e-5, "-1e-05"],
  [1e21, "1e+21"],
  [1e-7, "1e-07"],
  [1.23e-18, "1.23e-18"],
];

describe("numbers", () => {
  it.each(NUMBER_LITERALS)("%s canonicalises like Python", (literal, expected) => {
    expect(canonical(literal)).toBe(expected);
    expect(canonical(`{"x":[${literal}]}`)).toBe(`{"x":[${expected}]}`);
  });

  it.each(REPRS)("repr(%d) is %s", (value, expected) => {
    expect(pyFloatRepr(value)).toBe(expected);
  });

  it("keeps integers above 2^53 and 2^63 exactly", () => {
    const body = '{"a":9007199254740993,"b":18446744073709551617,"c":-9223372036854775809}';
    expect(canonical(body)).toBe(body);
    // JSON.parse would have changed them.
    expect(canonicalJson(JSON.parse(body))).not.toBe(body);
  });

  it("refuses integers longer than Python's 4300-digit limit", () => {
    const limit = "1".repeat(4300);
    expect(canonical(limit)).toBe(limit);
    expect(canonical(`-${limit}`)).toBe(`-${limit}`);
    expect(reason(() => parseJson(`${limit}1`))).toBe("invalid_payload");
    // The limit is about integers; a long float literal is fine.
    expect(canonical(`0.${"1".repeat(5000)}`)).toBe("0.1111111111111111");
  });

  it("refuses numbers that overflow a double, like Python's infinity", () => {
    for (const literal of ["1e400", "-1e400", "1e309", `1${"0".repeat(400)}.5`]) {
      expect(reason(() => parseJson(literal))).toBe("invalid_payload");
    }
  });

  it("writes JavaScript numbers like the floats and ints Python would hold", () => {
    expect(canonicalJson({ a: 87, b: 87.5, c: -0, d: 1e16, e: 1e22, f: 1e-5, g: 5e-324 })).toBe(
      '{"a":87,"b":87.5,"c":0,"d":10000000000000000,"e":10000000000000000000000,"f":1e-05,"g":5e-324}',
    );
    expect(canonicalJson(Number.MAX_VALUE)).toBe(MAX_DOUBLE_INTEGER);
    expect(canonicalJson(-Number.MAX_VALUE)).toBe(`-${MAX_DOUBLE_INTEGER}`);
    expect(canonicalJson(9007199254740993n)).toBe("9007199254740993");
    expect(canonicalJson([new LosslessNumber("-0"), new LosslessNumber("2.50")])).toBe("[0,2.5]");
  });
});

describe("strings", () => {
  it("escapes like Python with ensure_ascii=False", () => {
    let s = "";
    for (let c = 0; c < 0x20; c++) s += String.fromCharCode(c);
    s += '\u007f/\u2028\u2029"\\';
    expect(canonicalJson({ s })).toBe(
      '{"s":"\\u0000\\u0001\\u0002\\u0003\\u0004\\u0005\\u0006\\u0007\\b\\t\\n\\u000b\\f\\r\\u000e\\u000f\\u0010\\u0011\\u0012\\u0013\\u0014\\u0015\\u0016\\u0017\\u0018\\u0019\\u001a\\u001b\\u001c\\u001d\\u001e\\u001f\u007f/\u2028\u2029\\"\\\\"}',
    );
  });

  it("reads every escape and writes non-ASCII text literally", () => {
    expect(canonical('"\\"\\\\\\/\\b\\f\\n\\r\\t\\u00e9\\u00E9\\ud83d\\ude00"')).toBe(
      '"\\"\\\\/\\b\\f\\n\\r\\t\u00e9\u00e9\ud83d\ude00"',
    );
    expect(canonical('"<script>&amp;</script>"')).toBe('"<script>&amp;</script>"');
  });

  it("keeps lone surrogates and encodes them like Python's surrogatepass", () => {
    const text = '{"x":"a\\ud800b","y":"\\ud83d\\ude00","z":"\\udc00\\ud800","w":"\\ud83d\\u0041"}';
    const result = canonical(text);
    expect(hasLoneSurrogate(result)).toBe(true);
    expect(hex(encodeUtf8SurrogatePass(result))).toBe(
      "7b2277223a22eda0bd41222c2278223a2261eda08062222c2279223a22f09f9880222c227a223a22edb080eda080227d",
    );
  });

  it("encodes well-formed text exactly like TextEncoder", () => {
    const s = "Jos\u00e9 \ud83d\ude00 \u5c71\u7530";
    expect(encodeUtf8SurrogatePass(s)).toEqual(new TextEncoder().encode(s));
    expect(hex(encodeUtf8SurrogatePass("\ud800"))).toBe("eda080");
    expect(hex(encodeUtf8SurrogatePass("\udbff\ud83d\ude00\u00e9a"))).toBe("edafbff09f9880c3a961");
  });
});

describe("objects", () => {
  it("sorts keys by code point, not by UTF-16 code unit", () => {
    const text =
      '{"\\ud83d\\ude00":1,"\\ufb00":2,"\\uffff":3,"\\ue000":4,"a":5,"\\u00e9":6,"\\ud800\\udc00":7,"Z":8,"":9,"\\u007f":10}';
    const expected =
      '{"":9,"Z":8,"a":5,"\u007f":10,"\u00e9":6,"\ue000":4,"\ufb00":2,"\uffff":3,"\ud800\udc00":7,"\ud83d\ude00":1}';
    expect(canonical(text)).toBe(expected);
    expect(hex(encodeUtf8SurrogatePass(expected))).toBe(
      "7b22223a392c225a223a382c2261223a352c227f223a31302c22c3a9223a362c22ee8080223a342c22efac80223a322c22efbfbf223a332c22f0908080223a372c22f09f9880223a317d",
    );
    // Default sort puts the astral keys first among the non-ASCII ones; the
    // canonical order must not.
    expect(Object.keys(JSON.parse(text) as object).sort()).not.toEqual(
      Object.keys(JSON.parse(text) as object).sort(compareCodePoints),
    );
  });

  it("sorts lone surrogate keys as their own code points", () => {
    const result = canonical(
      '{"\\ue000":2,"\\ud800":1,"\\ud83d\\ude00":3,"\\udbff":4,"\\uffff":5}',
    );
    expect(hex(encodeUtf8SurrogatePass(result))).toBe(
      "7b22eda080223a312c22edafbf223a342c22ee8080223a322c22efbfbf223a352c22f09f9880223a337d",
    );
  });

  it("compares code points in every position", () => {
    expect(compareCodePoints("a", "b")).toBeLessThan(0);
    expect(compareCodePoints("ab", "a")).toBeGreaterThan(0);
    expect(compareCodePoints("x", "x")).toBe(0);
    expect(compareCodePoints("\ud83d\ude00", "\ud83d\ude00z")).toBeLessThan(0);
    // A pair (U+1F600) against a lone high surrogate then U+E000.
    expect(compareCodePoints("\ud83d\ude00", "\ud83d\ue000")).toBeGreaterThan(0);
    expect(compareCodePoints("x\ud83d", "x\ud83d\ude00")).toBeLessThan(0);
    expect(compareCodePoints("\ufb00", "\ud83d\ude00")).toBeLessThan(0);
  });

  it("lets the last duplicate key win and treats __proto__ as a plain key", () => {
    expect(canonical('{"a":1,"b":2,"a":3}')).toBe('{"a":3,"b":2}');
    expect(canonical('{"__proto__":{"x":1},"constructor":2}')).toBe(
      '{"__proto__":{"x":1},"constructor":2}',
    );
    const parsed = parseJson('{"__proto__":1}') as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["__proto__"]);
  });

  it("drops insignificant whitespace and shortens floats in nested values", () => {
    expect(canonical(' {\n "b" : [ 1 , 2.50 ] ,\t"a" : { } }\r\n')).toBe('{"a":{},"b":[1,2.5]}');
    expect(canonical('{"z":{"y":[{"b":1.0,"a":[]}]},"n":[true,false,null]}')).toBe(
      '{"n":[true,false,null],"z":{"y":[{"a":[],"b":1}]}}',
    );
    expect(canonicalJson(Object.assign(Object.create(null) as object, { b: 1, a: "x" }))).toBe(
      '{"a":"x","b":1}',
    );
  });
});

describe("strict parsing", () => {
  it.each([
    "",
    "   ",
    "{",
    "[",
    "[1,]",
    "[1 2]",
    "{,}",
    '{"a":1,}',
    '{"a" 1}',
    "{a:1}",
    "{1:1}",
    "'a'",
    "NaN",
    "Infinity",
    "-Infinity",
    '{"timestamp": NaN}',
    "tru",
    "nul",
    "01",
    "-01",
    "1.",
    ".5",
    "+1",
    "-",
    "1e",
    "1e+",
    "0x10",
    '"\\x"',
    '"\\u12"',
    '"\\u12G4"',
    '"\\ud83d\\uZZZZ"',
    '"unterminated',
    '"tab\there"',
    '"nul\u0000"',
    "{} {}",
    '{"a":1}x',
    "\ufeff{}",
  ])("refuses %j", (text) => {
    expect(reason(() => parseJson(text))).toBe("invalid_payload");
  });

  it("accepts nesting up to the limit and refuses one more level", () => {
    const nested = (depth: number) => "[".repeat(depth) + "]".repeat(depth);
    expect(canonical(nested(MAX_DEPTH))).toBe(nested(MAX_DEPTH));
    expect(reason(() => parseJson(nested(MAX_DEPTH + 1)))).toBe("invalid_payload");
    expect(
      reason(() => parseJson('{"a":'.repeat(MAX_DEPTH + 1) + "1" + "}".repeat(MAX_DEPTH + 1))),
    ).toBe("invalid_payload");
    expect(reason(() => parseJson(nested(30_000)))).toBe("invalid_payload");
  });

  it("decodes strict UTF-8 and keeps a byte order mark for the parser to refuse", () => {
    expect(decodeUtf8(new Uint8Array([0x7b, 0x7d]))).toBe("{}");
    for (const bytes of [
      [0xff, 0xfe],
      [0xc0, 0xaf],
      [0xed, 0xa0, 0x80],
      [0xe2, 0x82],
    ]) {
      expect(reason(() => decodeUtf8(new Uint8Array(bytes)))).toBe("invalid_payload");
    }
    const withBom = decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]));
    expect(withBom).toBe("\ufeff{}");
    expect(reason(() => parseJson(withBom))).toBe("invalid_payload");
  });
});

describe("canonicalJson of JavaScript values", () => {
  it.each([
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity in an object", { x: -Infinity }],
    ["undefined", undefined],
    ["undefined in an object", { x: undefined }],
    ["a hole in an array", new Array<number>(2)],
    ["a function", () => 1],
    ["a symbol", Symbol("x")],
    ["a Date", new Date(0)],
    ["a Map", new Map()],
    [
      "a class instance",
      new (class Point {
        x = 1;
      })(),
    ],
  ])("refuses %s", (_name, value) => {
    expect(reason(() => canonicalJson(value))).toBe("invalid_payload");
  });

  it("refuses a payload that contains itself and absurd nesting", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(reason(() => canonicalJson(cyclic))).toBe("invalid_payload");
    let deep: unknown[] = [];
    const root = deep;
    for (let i = 0; i < 5000; i++) {
      const child: unknown[] = [];
      deep.push(child);
      deep = child;
    }
    expect(reason(() => canonicalJson(root))).toBe("invalid_payload");
  });
});
