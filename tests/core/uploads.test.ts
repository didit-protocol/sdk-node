import { createReadStream, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import Didit, {
  ConfigurationError,
  fileFromPath,
  toFile,
  type Uploadable,
} from "../../src/index.js";
import { guessContentType, isUploadable, prepareFile } from "../../src/core/uploads.js";
import { fakeFetch } from "../helpers/mock-api.js";

function client() {
  const { fetch, calls } = fakeFetch(() => ({ json: {} }));
  return { didit: new Didit({ apiKey: "k", maxRetries: 0, fetch }), calls };
}

async function sent(front: Uploadable) {
  const { didit, calls } = client();
  await didit.idVerification.verify({ front_image: front });
  return calls[0]!.files.front_image![0]!;
}

const BYTES = new Uint8Array([1, 2, 3]);

function ascii(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0));
}

describe("file inputs", () => {
  it.each([
    ["a Blob", () => new Blob([BYTES], { type: "image/png" }), "file.png", "image/png"],
    ["a Uint8Array", () => BYTES, "file", "application/octet-stream"],
    ["an ArrayBuffer", () => BYTES.slice().buffer, "file", "application/octet-stream"],
    ["a DataView", () => new DataView(BYTES.slice().buffer), "file", "application/octet-stream"],
    ["a web stream", () => new Blob([BYTES]).stream(), "file", "application/octet-stream"],
    [
      "a Node.js stream",
      () => Readable.from([Buffer.from([1]), Buffer.from([2, 3])]),
      "file",
      "application/octet-stream",
    ],
    ["toFile", () => toFile(BYTES, "front.jpg"), "front.jpg", "image/jpeg"],
    [
      "a FileUpload with a content type",
      () => ({ data: BYTES, filename: "x.bin", contentType: "image/heic" }),
      "x.bin",
      "image/heic",
    ],
  ])("accepts %s", async (_label, make, filename, type) => {
    const file = await sent(make() as Uploadable);
    expect(file).toEqual({ filename, type, bytes: [1, 2, 3] });
  });

  // File is a global from Node.js 20 on.
  it.skipIf(typeof File === "undefined")("accepts a File and uses its name", async () => {
    const file = await sent(new File([BYTES], "dir/id.webp", { type: "image/webp" }));
    expect(file).toEqual({ filename: "id.webp", type: "image/webp", bytes: [1, 2, 3] });
  });

  it("names a file from an fs.ReadStream path and guesses its type", async () => {
    const dir = mkdtempSync(join(tmpdir(), "didit-"));
    const path = join(dir, "passport.JPG");
    writeFileSync(path, BYTES);
    expect(await sent(createReadStream(path))).toEqual({
      filename: "passport.JPG",
      type: "image/jpeg",
      bytes: [1, 2, 3],
    });
    expect(await sent(await fileFromPath(path))).toEqual({
      filename: "passport.JPG",
      type: "image/jpeg",
      bytes: [1, 2, 3],
    });
    const renamed = await fileFromPath(path, { filename: "front.png", contentType: "image/png" });
    expect(await sent(renamed)).toEqual({
      filename: "front.png",
      type: "image/png",
      bytes: [1, 2, 3],
    });
  });

  it.each([
    ["JPEG", [0xff, 0xd8, 0xff, 0xe0], "file.jpg", "image/jpeg"],
    ["PNG", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a], "file.png", "image/png"],
    ["WebP", [...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")], "file.webp", "image/webp"],
    ["HEIC", [0, 0, 0, 24, ...ascii("ftypheic")], "file.heic", "image/heic"],
    ["MP4", [0, 0, 0, 24, ...ascii("ftypisom")], "file.mp4", "video/mp4"],
    ["PDF", ascii("%PDF-1.7"), "file.pdf", "application/pdf"],
    ["TIFF", [0x49, 0x49, 0x2a, 0], "file.tiff", "image/tiff"],
  ])("names unnamed %s bytes by their type", async (_label, head, filename, type) => {
    const bytes = new Uint8Array([...head, 9, 9]);
    expect(await sent(bytes)).toEqual({ filename, type, bytes: [...bytes] });
    expect(await sent(new Blob([bytes]).stream())).toEqual({ filename, type, bytes: [...bytes] });
  });

  it("names an unnamed upload from its content type before its bytes", async () => {
    const file = await sent({ data: new Uint8Array([0xff, 0xd8, 0xff]), contentType: "image/png" });
    expect(file).toEqual({ filename: "file.png", type: "image/png", bytes: [0xff, 0xd8, 0xff] });
  });

  it("does not take an object with a non-file data key for a file", () => {
    expect(isUploadable({ data: "order-42" })).toBe(false);
    expect(isUploadable({ data: { nested: true } })).toBe(false);
    expect(isUploadable({ data: BYTES, filename: "a.jpg" })).toBe(true);
  });

  it("refuses something that is not a file", async () => {
    await expect(prepareFile({ data: 42 } as unknown as Uploadable)).rejects.toBeInstanceOf(
      ConfigurationError,
    );
    expect(isUploadable("text")).toBe(false);
    expect(isUploadable(null)).toBe(false);
    expect(isUploadable({ a: 1 })).toBe(false);
    expect(isUploadable(BYTES)).toBe(true);
  });

  it("guesses content types the same way on every system", () => {
    expect(guessContentType("a.PDF")).toBe("application/pdf");
    expect(guessContentType("a.tiff")).toBe("image/tiff");
    expect(guessContentType("noext")).toBe("application/octet-stream");
    expect(guessContentType("a.unknown")).toBe("application/octet-stream");
  });
});

describe("multipart bodies", () => {
  it("sends text fields next to the files: objects as JSON, booleans and dates as text", async () => {
    const { didit, calls } = client();
    await didit.idVerification.verify({
      front_image: toFile(BYTES, "front.jpg"),
      back_image: undefined,
      perform_document_liveness: true,
      vendor_data: "user-1",
      expiration_date_not_detected_action: null,
      extra: { nested: [1] },
      when: new Date("2026-01-02T00:00:00Z"),
    } as never);
    const request = calls[0]!;
    expect(request.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(request.form).toEqual({
      perform_document_liveness: "true",
      vendor_data: "user-1",
      extra: '{"nested":[1]}',
      when: "2026-01-02T00:00:00.000Z",
    });
    expect(Object.keys(request.files)).toEqual(["front_image"]);
  });

  it("sends an object with a data key in a non-file field as JSON text, not as a file", async () => {
    const { didit, calls } = client();
    await didit.idVerification.verify({
      front_image: toFile(BYTES, "front.jpg"),
      metadata: { data: "order-42" },
      bytes_meta: { data: BYTES },
    } as never);
    const request = calls[0]!;
    expect(Object.keys(request.files)).toEqual(["front_image"]);
    expect(request.form.metadata).toBe('{"data":"order-42"}');
    expect(request.form.bytes_meta).toBe('{"data":{"0":1,"1":2,"2":3}}');
  });

  it("repeats the field for a list of files", async () => {
    const { didit, calls } = client();
    await didit.idVerification.verify({
      front_image: [toFile(BYTES, "a.jpg"), toFile(BYTES, "b.jpg")],
    } as never);
    expect(calls[0]!.files.front_image!.map((f) => f.filename)).toEqual(["a.jpg", "b.jpg"]);
  });

  it("sends JSON without a file and multipart with one, for an operation that takes either", async () => {
    const { didit, calls } = client();
    await didit.customization.update({ color_primary: "#000000" });
    await didit.customization.update({
      color_primary: "#000000",
      image_square: toFile(BYTES, "logo.png"),
    });
    expect(calls[0]!.contentType).toBe("application/json");
    expect(calls[0]!.json).toEqual({ color_primary: "#000000" });
    expect(calls[1]!.contentType).toMatch(/^multipart\/form-data/);
    expect(calls[1]!.form).toEqual({ color_primary: "#000000" });
    expect(calls[1]!.files.image_square![0]).toEqual({
      filename: "logo.png",
      type: "image/png",
      bytes: [1, 2, 3],
    });
  });

  it("sends the same bytes again when a request is retried", async () => {
    let attempt = 0;
    const { fetch, calls } = fakeFetch(() => (attempt++ === 0 ? { status: 429 } : { json: {} }));
    const didit = new Didit({ apiKey: "k", fetch, maxRetries: 1 });
    await didit.idVerification.verify({ front_image: Readable.from([Buffer.from(BYTES)]) });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.files.front_image![0]!.bytes).toEqual([1, 2, 3]);
  });
});
