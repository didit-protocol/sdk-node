// File inputs for multipart uploads (docs/DESIGN.md section 8).

import { ConfigurationError } from "./errors.js";

/** The bytes of a file: a Blob or File, a byte array, a web stream or a Node.js stream. */
export type FileData =
  | Blob
  | ArrayBuffer
  | ArrayBufferView
  | ReadableStream<Uint8Array>
  | AsyncIterable<Uint8Array>;

/** File bytes with the file name and content type to send. */
export interface FileUpload {
  data: FileData;
  /** Sent as the part's file name. Default: the File's or stream's name, else `file`. */
  filename?: string;
  /** Default: guessed from the file name. */
  contentType?: string;
}

/**
 * What a file parameter accepts: a Blob or File, bytes, a stream (for example
 * `fs.createReadStream("id.jpg")`), or a {@link FileUpload} with its name and
 * content type. {@link fileFromPath} reads a file on Node.js, Bun and Deno.
 */
export type Uploadable = FileData | FileUpload;

// The upload types the API accepts, so the content type never depends on the host.
const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  heif: "image/heif",
  gif: "image/gif",
  bmp: "image/bmp",
  pdf: "application/pdf",
  zip: "application/zip",
  csv: "text/csv",
  ndjson: "application/x-ndjson",
  json: "application/json",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

/** The content type for a file name, from its extension. */
export function guessContentType(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/** Wrap file bytes with a file name and content type. */
export function toFile(data: FileData, filename?: string, contentType?: string): FileUpload {
  const out: FileUpload = { data };
  if (filename !== undefined) out.filename = filename;
  if (contentType !== undefined) out.contentType = contentType;
  return out;
}

/**
 * Read a file from disk (Node.js, Bun, Deno). The name defaults to the file's
 * base name and the content type to one guessed from it.
 */
export async function fileFromPath(
  path: string,
  options: { filename?: string; contentType?: string } = {},
): Promise<FileUpload> {
  // Computed so that bundlers for edge runtimes do not try to resolve it.
  const specifier = ["node", "fs/promises"].join(":");
  let readFile: (path: string) => Promise<Uint8Array>;
  try {
    const fs = (await import(/* webpackIgnore: true */ /* @vite-ignore */ specifier)) as {
      readFile: (path: string) => Promise<Uint8Array>;
    };
    readFile = fs.readFile;
  } catch {
    throw new ConfigurationError(
      "fileFromPath needs a runtime with a file system (Node.js, Bun or Deno); pass the bytes instead.",
    );
  }
  const data = await readFile(path);
  const filename = options.filename ?? baseName(path);
  return { data, filename, contentType: options.contentType ?? guessContentType(filename) };
}

function isFileUpload(value: unknown): value is FileUpload {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    !(value instanceof Blob) &&
    !ArrayBuffer.isView(value) &&
    !(value instanceof ArrayBuffer)
  );
}

function nameOf(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  // A File has `name`; a Node.js fs.ReadStream has `path`.
  const named = data as { name?: unknown; path?: unknown };
  if (typeof named.name === "string" && named.name) return baseName(named.name);
  if (typeof named.path === "string" && named.path) return baseName(named.path);
  return undefined;
}

// The Blob constructor copies its parts, so a view on a shared or pooled buffer is fine.
function part(bytes: Uint8Array): BlobPart {
  return bytes as Uint8Array<ArrayBuffer>;
}

async function collect(stream: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>): Promise<Blob> {
  const chunks: BlobPart[] = [];
  if (typeof (stream as ReadableStream<Uint8Array>).getReader === "function") {
    const reader = (stream as ReadableStream<Uint8Array>).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(part(value));
    }
  } else {
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(part(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk));
    }
  }
  return new Blob(chunks);
}

/** A file part ready for FormData. Streams are read once, so a retry sends the same bytes. */
export interface PreparedFile {
  blob: Blob;
  filename: string;
}

/** Read an upload into memory with its name and content type. */
export async function prepareFile(value: Uploadable): Promise<PreparedFile> {
  const upload: FileUpload = isFileUpload(value) ? value : { data: value };
  const data = upload.data;
  const filename = upload.filename ?? nameOf(data) ?? "file";
  let blob: Blob;
  if (data instanceof Blob) {
    blob = data;
  } else if (data instanceof ArrayBuffer) {
    blob = new Blob([data]);
  } else if (ArrayBuffer.isView(data)) {
    blob = new Blob([part(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))]);
  } else if (
    typeof data === "object" &&
    (Symbol.asyncIterator in data || typeof (data as ReadableStream).getReader === "function")
  ) {
    blob = await collect(data);
  } else {
    throw new ConfigurationError(
      "A file must be a Blob, a File, an ArrayBuffer, a typed array, a stream or { data, filename, contentType }.",
    );
  }
  const type = upload.contentType ?? (blob.type || guessContentType(filename));
  if (blob.type !== type) blob = new Blob([blob], { type });
  return { blob, filename };
}

/** Whether a params value is (or holds) a file. */
export function isUploadable(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
  if (typeof value !== "object") return false;
  if (isFileUpload(value)) return true;
  return Symbol.asyncIterator in value || typeof (value as ReadableStream).getReader === "function";
}
