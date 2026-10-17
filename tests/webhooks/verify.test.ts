// Webhook verification rules (docs/DESIGN.md section 9.3), the edge cases the
// reference SDK (sdk-python tests/test_webhooks.py) covers, and the TypeScript
// specifics: header shapes, non-enumerable event properties, verifyParsed.

import type { IncomingHttpHeaders } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { APIClient } from "../../src/core/api-client.js";
import { ConfigurationError, DiditError, WebhookVerificationError } from "../../src/core/errors.js";
import * as publicApi from "../../src/webhooks/index.js";
import { WebhookHelpers } from "../../src/webhooks/resource.js";
import {
  DEFAULT_WEBHOOK_TOLERANCE,
  verifyWebhook,
  verifyWebhookParsed,
  type WebhookHeaders,
} from "../../src/webhooks/verify.js";
import { delivery, NOW, payload, PREVIOUS, reasonOf, SECRET, sign } from "./helpers.js";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const HEX_A = "a".repeat(64);
const HEX_0 = "0".repeat(64);

function only(headers: Record<string, string>, ...names: string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([k]) => names.includes(k)));
}

/** X-Signature over any body, so that only the payload can be at fault. */
function rawSigned(body: string): Record<string, string> {
  return { "X-Signature": sign(SECRET, body) };
}

describe("a valid delivery", () => {
  it("returns the typed event, equal to the payload", async () => {
    const data = payload({ vendor_data: "user-1", workflow_version: 3, metadata: { plan: "pro" } });
    const { body, headers } = delivery(data);
    const event = await verifyWebhook(body, headers, SECRET);
    expect(event.verifiedBy).toBe("signature");
    expect(event.bodyAuthenticated).toBe(true);
    if (event.webhook_type !== "status.updated") throw new Error("narrowing failed");
    expect(event.status).toBe("Approved");
    expect(event.vendor_data).toBe("user-1");
    expect(event.workflow_version).toBe(3);
    expect(event.environment).toBe("sandbox");
    expect(JSON.parse(JSON.stringify(event))).toEqual(data);
  });

  it("adds verifiedBy and bodyAuthenticated as non-enumerable read-only properties", async () => {
    const { body, headers } = delivery(payload());
    const event = await verifyWebhook(body, headers, SECRET);
    expect(Object.keys(event)).not.toContain("verifiedBy");
    expect(Object.keys(event)).not.toContain("bodyAuthenticated");
    expect(JSON.stringify(event)).toBe(body);
    expect({ ...event }).not.toHaveProperty("verifiedBy");
    for (const name of ["verifiedBy", "bodyAuthenticated"]) {
      const descriptor = Object.getOwnPropertyDescriptor(event, name);
      expect(descriptor).toMatchObject({ enumerable: false, writable: false, configurable: false });
    }
    expect(() => {
      (event as { verifiedBy: string }).verifiedBy = "signature_simple";
    }).toThrow(TypeError);
  });

  it("verifies a re-encoded body with X-Signature-V2", async () => {
    const { body, headers } = delivery(payload({ metadata: { name: "Jos\u00e9", score: 87 } }));
    // Middleware that re-encodes the JSON: indentation, unescaped Unicode, 87.0.
    const reencoded = JSON.stringify(JSON.parse(body), null, 2).replace('"score": 87', '"score": 87.0');
    expect(reencoded).toContain("Jos\u00e9");
    const event = await verifyWebhook(reencoded, headers, SECRET);
    expect(event.verifiedBy).toBe("signature_v2");
  });

  it("accepts every body type", async () => {
    const { body, headers } = delivery(payload());
    const bytes = new TextEncoder().encode(body);
    for (const raw of [
      bytes,
      bytes.buffer,
      Buffer.from(body),
      new DataView(bytes.buffer) as unknown as Uint8Array,
      // A view into a larger buffer.
      new TextEncoder().encode(`xx${body}yy`).subarray(2, 2 + bytes.length),
    ]) {
      expect((await verifyWebhook(raw, headers, SECRET)).verifiedBy).toBe("signature");
    }
  });

  it("checks a wrong X-Signature and a right X-Signature-V2 independently, and the reverse", async () => {
    const { body, headers } = delivery(payload());
    const v2 = await verifyWebhook(body, { ...headers, "X-Signature": HEX_0 }, SECRET);
    expect(v2.verifiedBy).toBe("signature_v2");
    const raw = await verifyWebhook(body, { ...headers, "X-Signature-V2": HEX_0 }, SECRET);
    expect(raw.verifiedBy).toBe("signature");
  });
});

describe("headers", () => {
  it("accepts Headers, records in any case, pairs and maps", async () => {
    const { body, headers } = delivery(payload());
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const upper = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toUpperCase(), v]));
    const shapes: WebhookHeaders[] = [
      new Headers(headers),
      headers,
      lower,
      upper,
      Object.entries(headers),
      new Map(Object.entries(headers)),
    ];
    for (const shape of shapes) {
      expect((await verifyWebhook(body, shape, SECRET)).bodyAuthenticated).toBe(true);
    }
  });

  it("accepts Node.js IncomingHttpHeaders, using the first value of an array", async () => {
    const { body, headers } = delivery(payload());
    const node: IncomingHttpHeaders = {
      "content-type": "application/json",
      "set-cookie": ["a=1", "b=2"],
      "x-signature": headers["X-Signature"],
      "x-timestamp": headers["X-Timestamp"],
      "x-forwarded-for": undefined,
    };
    expect((await verifyWebhook(body, node, SECRET)).verifiedBy).toBe("signature");
    const arrays = { "x-signature": [headers["X-Signature"]!, HEX_0] };
    expect((await verifyWebhook(body, arrays, SECRET)).verifiedBy).toBe("signature");
    const reversed = { "x-signature": [HEX_0, headers["X-Signature"]!] };
    expect(await reasonOf(verifyWebhook(body, reversed, SECRET))).toBe("invalid_signature");
  });

  it("trims values the way Python's str.strip() does", async () => {
    const { body, headers } = delivery(payload());
    const padded = {
      "X-Signature": `\u001f\t ${headers["X-Signature"]!} \u0085\u3000`,
      "X-Timestamp": ` ${headers["X-Timestamp"]!}\n`,
    };
    expect((await verifyWebhook(body, padded, SECRET)).verifiedBy).toBe("signature");
    // Python does not strip U+FEFF, so neither does the SDK.
    const bom = { "X-Signature": `\ufeff${headers["X-Signature"]!}` };
    expect(await reasonOf(verifyWebhook(body, bom, SECRET))).toBe("invalid_signature");
  });

  it("counts empty signature headers as absent", async () => {
    const { body } = delivery(payload());
    const empty = {
      "X-Signature": "",
      "X-Signature-V2": "   ",
      "X-Signature-Simple": [] as string[],
      "X-Signature-Previous": undefined,
    };
    expect(await reasonOf(verifyWebhook(body, empty, SECRET, { allowSimple: true }))).toBe(
      "missing_signature",
    );
  });

  it("lets the first occurrence of a name win, as the reference does", async () => {
    const { body, headers } = delivery(payload());
    const first = [
      ["x-signature", headers["X-Signature"]!],
      ["X-Signature", HEX_0],
    ] as const;
    expect((await verifyWebhook(body, first, SECRET)).verifiedBy).toBe("signature");
    const emptyFirst = { "x-signature": "", "X-Signature": headers["X-Signature"]! };
    expect(await reasonOf(verifyWebhook(body, emptyFirst, SECRET))).toBe("missing_signature");
  });

  it("refuses headers that are not headers", async () => {
    const { body } = delivery(payload());
    await expect(verifyWebhook(body, null as unknown as WebhookHeaders, SECRET)).rejects.toThrow(
      TypeError,
    );
    await expect(
      verifyWebhook(body, new Set(["x-signature"]) as unknown as WebhookHeaders, SECRET),
    ).rejects.toThrow(TypeError);
  });
});

describe("signatures", () => {
  it("is missing_signature without any signature header", async () => {
    const { body, headers } = delivery(payload());
    const reason = await reasonOf(verifyWebhook(body, only(headers, "X-Timestamp"), SECRET));
    expect(reason).toBe("missing_signature");
  });

  it.each([
    ["uppercase hex", "A".repeat(64)],
    ["not hex", "g".repeat(64)],
    ["too short", "0".repeat(63)],
    ["too long", "0".repeat(65)],
    ["short after trimming", ` ${"0".repeat(63)}`],
  ])("ignores a signature that is %s", async (_name, bad) => {
    const { body } = delivery(payload());
    const verify = vi.spyOn(globalThis.crypto.subtle, "verify");
    const headers = { "X-Signature": bad, "X-Signature-V2": bad, "X-Signature-Simple": bad };
    expect(await reasonOf(verifyWebhook(body, headers, SECRET, { allowSimple: true }))).toBe(
      "invalid_signature",
    );
    // Malformed values never reach the constant-time comparison.
    expect(verify).not.toHaveBeenCalled();
  });

  it("compares well-formed signatures with crypto.subtle.verify", async () => {
    const { body, headers } = delivery(payload());
    const verify = vi.spyOn(globalThis.crypto.subtle, "verify");
    await verifyWebhook(body, only(headers, "X-Signature"), SECRET);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify.mock.calls[0]![0]).toBe("HMAC");
    verify.mockClear();
    const wrong = { "X-Signature": HEX_0, "X-Signature-Previous": HEX_A };
    expect(await reasonOf(verifyWebhook(body, wrong, [SECRET, PREVIOUS]))).toBe("invalid_signature");
    expect(verify).toHaveBeenCalledTimes(4);
  });

  it("refuses the uppercase form of a valid signature", async () => {
    const { body, headers } = delivery(payload());
    const upper = { "X-Signature": headers["X-Signature"]!.toUpperCase() };
    expect(await reasonOf(verifyWebhook(body, upper, SECRET))).toBe("invalid_signature");
  });

  it("checks each -Previous header on its own", async () => {
    const { body, headers } = delivery(payload(), PREVIOUS);
    const previous = { "X-Signature-Previous": headers["X-Signature"]!, "X-Timestamp": String(NOW) };
    expect((await verifyWebhook(body, previous, PREVIOUS)).verifiedBy).toBe("signature");
    const v2Previous = { "X-Signature-V2-Previous": headers["X-Signature-V2"]! };
    expect((await verifyWebhook(body, v2Previous, PREVIOUS)).verifiedBy).toBe("signature_v2");
    const simplePrevious = { "X-Signature-Simple-Previous": headers["X-Signature-Simple"]! };
    const event = await verifyWebhook(body, simplePrevious, PREVIOUS, { allowSimple: true });
    expect(event.verifiedBy).toBe("signature_simple");
  });

  it("accepts a list of secrets during a rotation", async () => {
    const { body, headers } = delivery(payload(), PREVIOUS);
    expect(await reasonOf(verifyWebhook(body, headers, SECRET))).toBe("invalid_signature");
    expect((await verifyWebhook(body, headers, [SECRET, PREVIOUS])).bodyAuthenticated).toBe(true);
    const set = new Set([SECRET, PREVIOUS]) as unknown as readonly string[];
    expect((await verifyWebhook(body, headers, set)).bodyAuthenticated).toBe(true);
  });

  it("never puts the secret or a signature in an error message", async () => {
    const { body, headers } = delivery(payload(), PREVIOUS);
    const error = await verifyWebhook(body, headers, SECRET).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WebhookVerificationError);
    expect(error).toBeInstanceOf(DiditError);
    const message = (error as Error).message;
    expect(message).not.toContain(SECRET);
    for (const value of Object.values(headers)) {
      if (value.length === 64) expect(message).not.toContain(value);
    }
  });
});

describe("X-Signature-Simple", () => {
  const simple = (message: string, secret = SECRET) => ({
    "X-Signature-Simple": sign(secret, message),
  });

  it.each([
    [
      "strings",
      '{"timestamp":1760702400,"session_id":"abc","status":"Approved","webhook_type":"status.updated"}',
      "1760702400:abc:Approved:status.updated",
    ],
    ["missing fields", '{"timestamp":1760702400}', "1760702400:::"],
    [
      "null",
      '{"timestamp":1760702400,"session_id":null,"status":"Approved","webhook_type":"status.updated"}',
      "1760702400:None:Approved:status.updated",
    ],
    [
      "booleans",
      '{"timestamp":1760702400,"session_id":true,"status":false,"webhook_type":"status.updated"}',
      "1760702400:True:False:status.updated",
    ],
    [
      "integers",
      '{"timestamp":1760702400,"session_id":12345678901234567890,"status":-0,"webhook_type":"x"}',
      "1760702400:12345678901234567890:0:x",
    ],
    [
      "floats",
      '{"timestamp":1760702400,"session_id":87.0,"status":1e16,"webhook_type":0.1}',
      "1760702400:87.0:1e+16:0.1",
    ],
    [
      "unicode",
      '{"timestamp":1760702400,"session_id":"Jos\\u00e9","status":"In Review","webhook_type":"data.updated"}',
      "1760702400:Jos\u00e9:In Review:data.updated",
    ],
  ])("formats %s like Python's str()", async (_name, body, message) => {
    const headers = simple(message);
    const error = await verifyWebhook(body, headers, SECRET).catch((e: unknown) => e);
    expect((error as WebhookVerificationError).reason).toBe("invalid_signature");
    expect((error as Error).message).toContain("allowSimple");
    const event = await verifyWebhook(body, headers, SECRET, { allowSimple: true });
    expect(event.verifiedBy).toBe("signature_simple");
    expect(event.bodyAuthenticated).toBe(false);
    const previous = { "X-Signature-Simple-Previous": sign(PREVIOUS, message) };
    const rotated = await verifyWebhook(body, previous, [SECRET, PREVIOUS], { allowSimple: true });
    expect(rotated.verifiedBy).toBe("signature_simple");
  });

  it("never matches a field holding an object, or a lone surrogate the backend cannot sign", async () => {
    const object =
      '{"timestamp":1760702400,"session_id":{"a":1},"status":"Approved","webhook_type":"status.updated"}';
    const headers = simple("1760702400:{'a': 1}:Approved:status.updated");
    expect(await reasonOf(verifyWebhook(object, headers, SECRET, { allowSimple: true }))).toBe(
      "invalid_signature",
    );
    const lone = '{"timestamp":1760702400,"session_id":"\\ud800","status":"Approved","webhook_type":"x"}';
    expect(
      await reasonOf(verifyWebhook(lone, simple("1760702400:?:Approved:x"), SECRET, { allowSimple: true })),
    ).toBe("invalid_signature");
  });

  it("does not let a full-body match report an unauthenticated body", async () => {
    const { body, headers } = delivery(payload());
    const event = await verifyWebhook(body, headers, SECRET, { allowSimple: true });
    expect(event.verifiedBy).toBe("signature");
    expect(event.bodyAuthenticated).toBe(true);
  });

  it("refuses a tampered envelope", async () => {
    const body = '{"timestamp":1760702400,"session_id":"abc","status":"Declined","webhook_type":"status.updated"}';
    const headers = simple("1760702400:abc:Approved:status.updated");
    expect(await reasonOf(verifyWebhook(body, headers, SECRET, { allowSimple: true }))).toBe(
      "invalid_signature",
    );
  });

  it("keeps bodyAuthenticated false even when the unsigned body claims otherwise", async () => {
    const body =
      '{"bodyAuthenticated":true,"verifiedBy":"signature","timestamp":1760702400,"session_id":"abc","status":"Approved","webhook_type":"status.updated"}';
    const headers = simple("1760702400:abc:Approved:status.updated");
    const event = await verifyWebhook(body, headers, SECRET, { allowSimple: true });
    expect(event.bodyAuthenticated).toBe(false);
    expect(event.verifiedBy).toBe("signature_simple");
  });

  it("counts only with allowSimple set to true", async () => {
    const { body, headers } = delivery(payload());
    const simpleOnly = only(headers, "X-Signature-Simple");
    const options = { allowSimple: "yes" } as unknown as { allowSimple: boolean };
    expect(await reasonOf(verifyWebhook(body, simpleOnly, SECRET, options))).toBe("invalid_signature");
  });
});

describe("timestamp", () => {
  it("accepts the tolerance bound inclusively, in both directions", async () => {
    const { body, headers } = delivery(payload());
    vi.setSystemTime((NOW + DEFAULT_WEBHOOK_TOLERANCE) * 1000);
    expect((await verifyWebhook(body, headers, SECRET)).bodyAuthenticated).toBe(true);
    vi.setSystemTime((NOW + 300) * 1000 + 1);
    expect(await reasonOf(verifyWebhook(body, headers, SECRET))).toBe("timestamp_out_of_tolerance");
    vi.setSystemTime((NOW + 301) * 1000);
    expect(await reasonOf(verifyWebhook(body, headers, SECRET))).toBe("timestamp_out_of_tolerance");
    expect((await verifyWebhook(body, headers, SECRET, { tolerance: 600 })).bodyAuthenticated).toBe(true);
    vi.setSystemTime((NOW - 301) * 1000);
    expect(await reasonOf(verifyWebhook(body, headers, SECRET))).toBe("timestamp_out_of_tolerance");
    vi.setSystemTime(NOW * 1000);
    expect((await verifyWebhook(body, headers, SECRET, { tolerance: 0 })).bodyAuthenticated).toBe(true);
  });

  it("checks the timestamp before the signature", async () => {
    const { body } = delivery(payload());
    vi.setSystemTime((NOW + 1000) * 1000);
    expect(await reasonOf(verifyWebhook(body, { "X-Signature": HEX_0 }, SECRET))).toBe(
      "timestamp_out_of_tolerance",
    );
    expect(await reasonOf(verifyWebhook(body, {}, SECRET))).toBe("timestamp_out_of_tolerance");
  });

  it.each(["soon", "", "1_760_702_400", "+1760702400", "1760702400.0", "\u0661760702400", "1760702401", "-1760702400"])(
    "is timestamp_mismatch for X-Timestamp %j",
    async (value) => {
      const { body, headers } = delivery(payload());
      const reason = await reasonOf(verifyWebhook(body, { ...headers, "X-Timestamp": value }, SECRET));
      expect(reason).toBe("timestamp_mismatch");
    },
  );

  it("accepts a missing X-Timestamp and one with leading zeros", async () => {
    const { body, headers } = delivery(payload());
    expect((await verifyWebhook(body, only(headers, "X-Signature"), SECRET)).verifiedBy).toBe("signature");
    const padded = { ...headers, "X-Timestamp": `0${NOW}` };
    expect((await verifyWebhook(body, padded, SECRET)).verifiedBy).toBe("signature");
  });

  it.each([
    ['{"webhook_type": "status.updated"}', "missing_timestamp"],
    ['{"timestamp": "1760702400"}', "missing_timestamp"],
    ['{"timestamp": true}', "missing_timestamp"],
    ['{"timestamp": null}', "missing_timestamp"],
    ['{"timestamp": 1760702400.0}', "missing_timestamp"],
    ['{"timestamp": 1.7607024e9}', "missing_timestamp"],
    ['{"timestamp": [1760702400]}', "missing_timestamp"],
  ])("is %s for %s", async (body, reason) => {
    expect(await reasonOf(verifyWebhook(body, rawSigned(body), SECRET))).toBe(reason);
  });

  it("treats -0 as the integer 0", async () => {
    vi.setSystemTime(0);
    const body = '{"timestamp":-0}';
    const event = await verifyWebhook(body, { ...rawSigned(body), "X-Timestamp": "0" }, SECRET);
    expect(event.timestamp).toBe(-0);
  });
});

describe("payload", () => {
  it.each([
    ["not JSON", "not json"],
    ["an array", "[1, 2]"],
    ["a string", '"x"'],
    ["NaN", '{"timestamp": NaN}'],
    ["an overflowing number", '{"timestamp": 1e400}'],
    ["a byte order mark", `\ufeff{"timestamp":${NOW}}`],
    ["trailing data", `{"timestamp":${NOW}} {}`],
  ])("is invalid_payload for %s", async (_name, body) => {
    expect(await reasonOf(verifyWebhook(body, rawSigned(body), SECRET))).toBe("invalid_payload");
  });

  it("is invalid_payload for bytes that are not UTF-8 and for a string with a lone surrogate", async () => {
    const headers = { "X-Signature": HEX_0 };
    expect(await reasonOf(verifyWebhook(new Uint8Array([0xff, 0xfe]), headers, SECRET))).toBe(
      "invalid_payload",
    );
    const lone = `{"timestamp": ${NOW}, "x": "\ud800"}`;
    expect(await reasonOf(verifyWebhook(lone, headers, SECRET))).toBe("invalid_payload");
  });

  it.each([
    ["a huge timestamp", `{"timestamp": 1${"0".repeat(400)}, "webhook_type": "status.updated"}`],
    ["a huge negative timestamp", `{"timestamp": -1${"0".repeat(400)}}`],
    ["1500 levels of nesting", `{"timestamp": ${NOW}, "x": ${"[".repeat(1500)}${"]".repeat(1500)}}`],
    ["30000 levels of nesting", `{"timestamp": ${NOW}, "x": ${"[".repeat(30000)}${"]".repeat(30000)}}`],
    ["a 5000-digit integer", `{"timestamp": ${NOW}, "x": ${"9".repeat(5000)}}`],
  ])("only ever throws a WebhookVerificationError for %s", async (_name, body) => {
    // Anyone can send these before any signature is checked.
    const headers = { "X-Signature-V2": HEX_0, "X-Signature": HEX_0 };
    expect(["invalid_payload", "timestamp_out_of_tolerance", "invalid_signature"]).toContain(
      await reasonOf(verifyWebhook(body, headers, SECRET)),
    );
  });

  it("keeps a lone surrogate the way the reference does and verifies through X-Signature-V2", async () => {
    // The canonical bytes hold U+D800 as ED A0 80 (Python's surrogatepass).
    const body = `{"timestamp":${NOW},"webhook_type":"status.updated","x":"a\\ud800"}`;
    const canonical = Buffer.concat([
      Buffer.from(`{"timestamp":${NOW},"webhook_type":"status.updated","x":"a`),
      Buffer.from([0xed, 0xa0, 0x80]),
      Buffer.from('"}'),
    ]);
    const event = await verifyWebhook(body, { "X-Signature-V2": sign(SECRET, canonical) }, SECRET);
    expect(event.verifiedBy).toBe("signature_v2");
    expect(event.x).toBe("a\ud800");
  });

  it("needs the raw body, and says so for an object", async () => {
    await expect(verifyWebhook(payload() as never, {}, SECRET)).rejects.toThrow(/verifyWebhookParsed/);
  });
});

describe("configuration", () => {
  it.each([
    ["an empty string", ""],
    ["an empty list", []],
    ["a list with an empty secret", [""]],
    ["a list with one empty secret", [SECRET, ""]],
    ["undefined", undefined],
    ["null", null],
    ["bytes", new TextEncoder().encode(SECRET)],
    ["a number", 5],
    ["a list with a non-string", [SECRET, null]],
    ["a lone surrogate", "whsec_\ud800"],
  ])("refuses %s as the secret", async (_name, secret) => {
    const { body, headers } = delivery(payload());
    await expect(verifyWebhook(body, headers, secret as never)).rejects.toThrow(ConfigurationError);
    await expect(verifyWebhookParsed(payload(), headers, secret as never)).rejects.toThrow(
      ConfigurationError,
    );
  });

  it.each([-1, NaN, "300", true, null])("refuses tolerance %j", async (tolerance) => {
    const { body, headers } = delivery(payload());
    const options = { tolerance } as unknown as { tolerance: number };
    await expect(verifyWebhook(body, headers, SECRET, options)).rejects.toThrow(ConfigurationError);
    // Checked before the body, so a bad body cannot hide the configuration error.
    await expect(verifyWebhook("x", headers, SECRET, options)).rejects.toThrow(ConfigurationError);
    await expect(verifyWebhookParsed({}, headers, SECRET, options)).rejects.toThrow(ConfigurationError);
  });

  it("accepts an infinite tolerance, as the reference does", async () => {
    const { body, headers } = delivery(payload());
    vi.setSystemTime(0);
    expect((await verifyWebhook(body, headers, SECRET, { tolerance: Infinity })).bodyAuthenticated).toBe(
      true,
    );
  });

  it("never logs the secret in a configuration error", async () => {
    const error = await verifyWebhook("{}", {}, [SECRET, ""]).catch((e: unknown) => e);
    expect((error as Error).message).not.toContain(SECRET);
  });
});

describe("verifyWebhookParsed", () => {
  it("verifies X-Signature-V2 and returns a copy of the payload", async () => {
    const data = payload({ metadata: { score: 87.5, big: 2 ** 60 } });
    const { headers } = delivery(data);
    const parsed = structuredClone(data);
    const event = await verifyWebhookParsed(parsed, headers, SECRET);
    expect(event.verifiedBy).toBe("signature_v2");
    expect(event.bodyAuthenticated).toBe(true);
    expect(event).toEqual(data);
    expect(event).not.toBe(parsed);
    expect(Object.getOwnPropertyDescriptor(parsed, "verifiedBy")).toBeUndefined();
  });

  it("needs X-Signature-V2", async () => {
    const data = payload();
    const { headers } = delivery(data);
    const error = await verifyWebhookParsed(data, only(headers, "X-Signature", "X-Signature-Simple"), SECRET).catch(
      (e: unknown) => e,
    );
    expect((error as WebhookVerificationError).reason).toBe("missing_signature");
    expect((error as Error).message).toContain("verifyWebhook");
  });

  it("refuses a changed payload", async () => {
    const data = payload();
    const { headers } = delivery(data);
    const reason = await reasonOf(verifyWebhookParsed({ ...data, status: "Declined" }, headers, SECRET));
    expect(reason).toBe("invalid_signature");
  });

  it.each([
    ["an array", [payload()]],
    ["null", null],
    ["a string", JSON.stringify(payload())],
    ["bytes", new Uint8Array(2)],
  ])("is invalid_payload for %s", async (_name, value) => {
    const { headers } = delivery(payload());
    expect(await reasonOf(verifyWebhookParsed(value, headers, SECRET))).toBe("invalid_payload");
  });

  it("applies the timestamp rules", async () => {
    const data = payload();
    const { headers } = delivery(data);
    expect(await reasonOf(verifyWebhookParsed({ ...data, timestamp: NOW + 0.5 }, headers, SECRET))).toBe(
      "missing_timestamp",
    );
    expect(await reasonOf(verifyWebhookParsed(data, { ...headers, "X-Timestamp": "1" }, SECRET))).toBe(
      "timestamp_mismatch",
    );
    const big = { ...data, timestamp: BigInt(NOW) };
    expect((await verifyWebhookParsed(big, headers, SECRET)).verifiedBy).toBe("signature_v2");
    vi.setSystemTime((NOW + 301) * 1000);
    expect(await reasonOf(verifyWebhookParsed(data, headers, SECRET))).toBe("timestamp_out_of_tolerance");
  });

  it("is invalid_payload for values that are not JSON data", async () => {
    const data = payload();
    const { headers } = delivery(data);
    const deep: unknown[] = [];
    let node = deep;
    for (let i = 0; i < 5000; i++) {
      const child: unknown[] = [];
      node.push(child);
      node = child;
    }
    for (const extra of [{ x: deep }, { x: NaN }, { x: new Date(0) }, { x: undefined }]) {
      expect(await reasonOf(verifyWebhookParsed({ ...data, ...extra }, headers, SECRET))).toBe(
        "invalid_payload",
      );
    }
  });
});

describe("events", () => {
  it("keeps an unknown event type with its whole payload", async () => {
    const data = payload({ webhook_type: "transaction_rule_suggestions.created", suggestions: [1, 2] });
    const { body, headers } = delivery(data);
    const event = await verifyWebhook(body, headers, SECRET);
    expect(event.webhook_type).toBe("transaction_rule_suggestions.created");
    expect(event.suggestions).toEqual([1, 2]);
    expect(event.event_id).toBe(data.event_id);
    expect(JSON.parse(JSON.stringify(event))).toEqual(data);
  });

  it("reads the registry search callback's event_type as its webhook_type", async () => {
    const data = { event_type: "kyb.registry_search.resolved", timestamp: NOW, search_status: "resolved" };
    const { body, headers } = delivery(data);
    const event = await verifyWebhook(body, headers, SECRET);
    expect(event.webhook_type).toBe("kyb.registry_search.resolved");
    expect(Object.keys(event)).not.toContain("webhook_type");
    expect(JSON.stringify(event)).toBe(body);
    if (event.webhook_type === "kyb.registry_search.resolved") {
      expect(event.search_status).toBe("resolved");
    }
    // A body that has webhook_type keeps it.
    const both = delivery({ ...data, webhook_type: "status.updated" });
    expect((await verifyWebhook(both.body, both.headers, SECRET)).webhook_type).toBe("status.updated");
  });

  it("keeps fields of unexpected types as sent", async () => {
    const data = payload({ webhook_type: "user.status.updated", status: ["not", "a", "string"], new_field: { a: 1 } });
    const { body, headers } = delivery(data);
    const event = await verifyWebhook(body, headers, SECRET);
    expect(event.status).toEqual(["not", "a", "string"]);
    expect(event.new_field).toEqual({ a: 1 });
  });
});

describe("entry points", () => {
  it("exposes verify and verifyParsed through webhooks and the client resource", async () => {
    const data = payload();
    const { body, headers } = delivery(data);
    expect(publicApi.webhooks.verify).toBe(verifyWebhook);
    expect(publicApi.webhooks.verifyParsed).toBe(verifyWebhookParsed);
    expect(publicApi.DEFAULT_WEBHOOK_TOLERANCE).toBe(300);
    expect((await publicApi.webhooks.verify(body, headers, SECRET)).verifiedBy).toBe("signature");
    const resource = new WebhookHelpers({} as APIClient);
    expect((await resource.verify(body, headers, SECRET)).verifiedBy).toBe("signature");
    expect((await resource.verify(body, only(headers, "X-Signature-Simple"), SECRET, { allowSimple: true })).verifiedBy).toBe(
      "signature_simple",
    );
    expect((await resource.verifyParsed(data, headers, SECRET)).verifiedBy).toBe("signature_v2");
    expect(publicApi.canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});
