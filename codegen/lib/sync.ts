// Sync openapi/ with the published API contract (docs/DESIGN.md section 3.1).
//
// When a download differs from the committed copy:
// - refuse anything that is not an OpenAPI 3 document with paths;
// - write it byte for byte and record URL, SHA-256 and fetch time in SOURCE.json;
// - drop overlay.json entries that upstream now carries as x-didit-sdk;
// - never delete a public method silently: a server method whose operation was
//   removed, renamed or is no longer a server operation is recorded in
//   deprecated-operations.json (with the component schemas it uses, so its
//   types keep their names) and stays as a deprecated method until the next
//   minor version; a name that reappears on another path counts as moved;
// - describe added, removed, renamed, moved and changed operations and schemas,
//   with everything that can break code written against the SDK listed first.

import { createHash } from "node:crypto";

import { isObject, type Json, type JsonObject } from "./spec.ts";

export const UPSTREAM: Record<string, string> = {
  "verification.json": "https://docs.didit.me/openapi-25.json",
  "account.json": "https://docs.didit.me/openapi-auth.json",
};
const PREFIXES: Record<string, string> = { "verification.json": "", "account.json": "account " };
const METHODS = ["get", "put", "post", "delete", "patch", "head", "options"];
// Keys that document a schema without changing what is sent or received.
const DOC_KEYS = new Set([
  "description",
  "summary",
  "title",
  "example",
  "examples",
  "externalDocs",
]);
const MAX_NOTES = 25;
const COMPONENT_PREFIX = "#/components/schemas/";

/** A download is not a document the SDK can be generated from. */
export class SpecSyncError extends Error {
  override name = "SpecSyncError";
}

type Note = [text: string, breaking: boolean];

/** Parse a download and refuse anything that is not an OpenAPI 3 document with paths. */
export function checkOpenAPI(name: string, data: Uint8Array): JsonObject {
  let doc: unknown;
  try {
    doc = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch (error) {
    throw new SpecSyncError(`${name}: the download is not JSON (${(error as Error).message}).`);
  }
  if (!isObject(doc)) throw new SpecSyncError(`${name}: the download is not a JSON object.`);
  if (typeof doc.openapi !== "string" || !doc.openapi.startsWith("3.")) {
    throw new SpecSyncError(
      `${name}: the download is not an OpenAPI 3 document (openapi=${JSON.stringify(doc.openapi)}).`,
    );
  }
  if (!isObject(doc.paths) || !Object.keys(doc.paths).length) {
    throw new SpecSyncError(`${name}: the download has no paths.`);
  }
  return doc;
}

function pointer(doc: Json, ref: string): Json {
  let cur = doc;
  for (const raw of ref.slice(2).split("/")) {
    if (!isObject(cur) && !Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, Json>)[raw.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return cur;
}

/** `node` with every local `$ref` inlined. */
export function dereference(doc: Json, node: Json, depth = 0): Json {
  if (depth > 64) return {};
  if (Array.isArray(node)) return node.map((v: Json) => dereference(doc, v, depth + 1));
  if (!isObject(node)) return node;
  if (typeof node.$ref === "string") {
    const found = pointer(doc, node.$ref);
    if (found === undefined) return { "x-unresolved-ref": node.$ref };
    const target = dereference(doc, found, depth + 1);
    const extra = Object.fromEntries(Object.entries(node).filter(([k]) => k !== "$ref"));
    return isObject(target) ? { ...target, ...extra } : target;
  }
  return Object.fromEntries(
    Object.entries(node).map(([k, v]) => [k, dereference(doc, v, depth + 1)]),
  );
}

/**
 * `node` with every `$ref` inlined except component schemas, plus the component
 * schemas it uses (transitively), so a deprecated method keeps its type names.
 */
export function detach(doc: Json, node: Json): { node: Json; components: Record<string, Json> } {
  const components: Record<string, Json> = {};
  const inline = (value: Json, depth: number): Json => {
    if (depth > 64) return {};
    if (Array.isArray(value)) return value.map((v: Json) => inline(v, depth + 1));
    if (!isObject(value)) return value;
    if (typeof value.$ref === "string") {
      if (value.$ref.startsWith(COMPONENT_PREFIX)) {
        const name = value.$ref
          .slice(COMPONENT_PREFIX.length)
          .replace(/~1/g, "/")
          .replace(/~0/g, "~");
        if (!(name in components)) {
          components[name] = {};
          components[name] = inline(pointer(doc, value.$ref) ?? {}, depth + 1);
        }
        return value;
      }
      const found = pointer(doc, value.$ref);
      if (found === undefined) return { "x-unresolved-ref": value.$ref };
      const target = inline(found, depth + 1);
      const extra = Object.fromEntries(Object.entries(value).filter(([k]) => k !== "$ref"));
      return isObject(target) ? { ...target, ...extra } : target;
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, inline(v, depth + 1)]));
  };
  return { node: inline(node, 0), components };
}

export function operations(doc: JsonObject, prefix: string): Map<string, JsonObject> {
  const out = new Map<string, JsonObject>();
  const paths = isObject(doc.paths) ? doc.paths : {};
  for (const [path, rawItem] of Object.entries(paths)) {
    const item = isObject(rawItem) ? rawItem : {};
    for (const method of METHODS) {
      const op = item[method];
      if (!isObject(op)) continue;
      const merged: JsonObject = { ...op };
      if (Array.isArray(item.parameters) && item.parameters.length) {
        merged.parameters = [
          ...(item.parameters as Json[]),
          ...(Array.isArray(op.parameters) ? (op.parameters as Json[]) : []),
        ];
      }
      out.set(`${prefix}${method.toUpperCase()} ${path}`, merged);
    }
  }
  return out;
}

// Schema comparison --------------------------------------------------------------

function shape(node: Json): Json {
  if (Array.isArray(node)) return node.map(shape);
  if (!isObject(node)) return node;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([k]) => !DOC_KEYS.has(k) && !k.startsWith("x-"))
      .map(([k, v]) => [k, shape(v)]),
  );
}

function same(a: Json, b: Json): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(node: Json): Json {
  if (Array.isArray(node)) return node.map(sortKeys);
  if (!isObject(node)) return node;
  return Object.fromEntries(
    Object.keys(node)
      .sort()
      .map((k) => [k, sortKeys(node[k])]),
  );
}

function types(schema: JsonObject): Set<string> {
  const out = new Set<string>();
  if (typeof schema.type === "string") out.add(schema.type);
  if (Array.isArray(schema.type)) for (const t of schema.type) out.add(String(t));
  if (schema.nullable === true) out.add("null");
  for (const v of [...asArray(schema.anyOf), ...asArray(schema.oneOf)]) {
    if (isObject(v) && v.type === "null") out.add("null");
  }
  return out;
}

function asArray(value: Json): Json[] {
  return Array.isArray(value) ? (value as Json[]) : [];
}

function objectProps(schema: JsonObject): { props: Record<string, Json>; required: Set<string> } {
  const props: Record<string, Json> = {};
  const required = new Set<string>();
  const stack: Json[] = [schema];
  while (stack.length) {
    const cur = stack.pop();
    if (!isObject(cur)) continue;
    if (isObject(cur.properties)) Object.assign(props, cur.properties);
    for (const r of asArray(cur.required)) required.add(String(r));
    stack.push(...asArray(cur.allOf));
  }
  return { props, required };
}

function variants(schema: JsonObject, keyword: string): Json[] {
  return asArray(schema[keyword]).filter((v) => !(isObject(v) && v.type === "null"));
}

function setEq(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

/**
 * Append a note for every difference between two dereferenced schemas.
 * `request` tells which side the schema is on: a removed enum value breaks
 * callers that send it, while response enums are open (DESIGN 5.1).
 */
export function diffSchema(
  old: Json,
  next: Json,
  where: string,
  request: boolean,
  notes: Note[],
  depth = 0,
): void {
  if (depth > 16 || same(shape(old), shape(next))) return;
  if (!isObject(old) || !isObject(next)) {
    notes.push([`${where}: schema replaced`, true]);
    return;
  }
  const oldTypes = types(old);
  const newTypes = types(next);
  const oldPlain = new Set([...oldTypes].filter((t) => t !== "null"));
  const newPlain = new Set([...newTypes].filter((t) => t !== "null"));
  if (oldPlain.size && newPlain.size && !setEq(oldPlain, newPlain)) {
    const widened = setEq(oldPlain, new Set(["integer"])) && setEq(newPlain, new Set(["number"]));
    const narrowed = setEq(oldPlain, new Set(["number"])) && setEq(newPlain, new Set(["integer"]));
    const harmless = (request && widened) || (!request && narrowed);
    notes.push([
      `${where}: type ${[...oldPlain].sort().join("/")} -> ${[...newPlain].sort().join("/")}`,
      !harmless,
    ]);
    return;
  }
  if (newTypes.has("null") && !oldTypes.has("null") && !request)
    notes.push([`${where}: can now be null`, true]);
  if (oldTypes.has("null") && !newTypes.has("null") && request)
    notes.push([`${where}: no longer accepts null`, true]);

  const oldEnum = old.enum;
  const newEnum = next.enum;
  if (Array.isArray(oldEnum) && Array.isArray(newEnum)) {
    const gone = oldEnum.filter((v) => !newEnum.some((w) => same(v, w)));
    const added = newEnum.filter((v) => !oldEnum.some((w) => same(v, w)));
    if (gone.length) notes.push([`${where}: values removed ${JSON.stringify(gone)}`, request]);
    if (added.length) notes.push([`${where}: values added ${JSON.stringify(added)}`, false]);
  } else if (Array.isArray(newEnum)) {
    notes.push([`${where}: now limited to ${JSON.stringify(newEnum)}`, request]);
  } else if (Array.isArray(oldEnum)) {
    notes.push([`${where}: no longer limited to fixed values`, false]);
  }

  const a = objectProps(old);
  const b = objectProps(next);
  for (const name of Object.keys(a.props)
    .filter((n) => !(n in b.props))
    .sort()) {
    notes.push([`${where}.${name}: removed`, true]);
  }
  for (const name of Object.keys(b.props)
    .filter((n) => !(n in a.props))
    .sort()) {
    const required = request && b.required.has(name);
    notes.push([`${where}.${name}: added${required ? " (required)" : ""}`, required]);
  }
  for (const name of Object.keys(a.props)
    .filter((n) => n in b.props)
    .sort()) {
    if (request && b.required.has(name) && !a.required.has(name))
      notes.push([`${where}.${name}: now required`, true]);
    if (!request && a.required.has(name) && !b.required.has(name)) {
      notes.push([`${where}.${name}: no longer always present`, true]);
    }
    diffSchema(a.props[name], b.props[name], `${where}.${name}`, request, notes, depth + 1);
  }
  for (const [key, suffix] of [
    ["items", "[]"],
    ["additionalProperties", "{}"],
  ] as const) {
    if (isObject(old[key]) || isObject(next[key])) {
      diffSchema(
        isObject(old[key]) ? old[key] : {},
        isObject(next[key]) ? next[key] : {},
        `${where}${suffix}`,
        request,
        notes,
        depth + 1,
      );
    }
  }
  for (const keyword of ["oneOf", "anyOf"]) {
    const ov = variants(old, keyword);
    const nv = variants(next, keyword);
    if (nv.length < ov.length)
      notes.push([`${where}: ${ov.length - nv.length} ${keyword} variant(s) removed`, true]);
    else if (nv.length > ov.length)
      notes.push([`${where}: ${nv.length - ov.length} ${keyword} variant(s) added`, false]);
    else
      ov.forEach((v, i) => {
        diffSchema(v, nv[i], `${where}<${keyword} ${i + 1}>`, request, notes, depth + 1);
      });
  }
}

function body(op: JsonObject): { types: Set<string>; schema: Json } {
  const rb = isObject(op.requestBody) ? op.requestBody : {};
  const content = isObject(rb.content) ? rb.content : {};
  const media = content["application/json"] ?? content["multipart/form-data"];
  return {
    types: new Set(Object.keys(content)),
    schema: isObject(media) ? (media.schema ?? {}) : {},
  };
}

function success(op: JsonObject): { types: Set<string>; schema: Json } {
  const responses = isObject(op.responses) ? op.responses : {};
  for (const code of Object.keys(responses).sort()) {
    if (!code.startsWith("2")) continue;
    const response = responses[code];
    const content = isObject(response) && isObject(response.content) ? response.content : {};
    const media = content["application/json"];
    return {
      types: new Set(Object.keys(content)),
      schema: isObject(media) ? (media.schema ?? {}) : {},
    };
  }
  return { types: new Set(), schema: {} };
}

/** Human-readable differences of one operation, and whether any is breaking. */
export function describeChange(
  oldDoc: JsonObject,
  old: JsonObject,
  newDoc: JsonObject,
  next: JsonObject,
): { notes: string[]; breaking: boolean } {
  const found: Note[] = [];
  const params = (doc: JsonObject, op: JsonObject): Map<string, JsonObject> => {
    const out = new Map<string, JsonObject>();
    for (const p of asArray(dereference(doc, op.parameters ?? []))) {
      if (isObject(p)) out.set(`${String(p.name)} (${String(p.in)})`, p);
    }
    return out;
  };
  const oldParams = params(oldDoc, old);
  const newParams = params(newDoc, next);
  for (const key of [...oldParams.keys()].filter((k) => !newParams.has(k)).sort())
    found.push([`parameter removed: ${key}`, true]);
  for (const key of [...newParams.keys()].filter((k) => !oldParams.has(k)).sort()) {
    const required = newParams.get(key)!.required === true;
    found.push([`parameter added: ${key}${required ? ", required" : ""}`, required]);
  }
  for (const key of [...oldParams.keys()].filter((k) => newParams.has(k)).sort()) {
    const a = oldParams.get(key)!;
    const b = newParams.get(key)!;
    if (a.required !== true && b.required === true)
      found.push([`parameter now required: ${key}`, true]);
    diffSchema(a.schema ?? {}, b.schema ?? {}, `parameter ${key}`, true, found);
  }
  const ob = body(old);
  const nb = body(next);
  if (!setEq(ob.types, nb.types) && ob.types.size && nb.types.size) {
    const subset = [...ob.types].every((t) => nb.types.has(t));
    found.push([
      `request content type ${JSON.stringify([...ob.types].sort())} -> ${JSON.stringify([...nb.types].sort())}`,
      !subset,
    ]);
  }
  const oldRequired = isObject(old.requestBody) && old.requestBody.required === true;
  const newRequired = isObject(next.requestBody) && next.requestBody.required === true;
  if (!oldRequired && newRequired) found.push(["request body now required", true]);
  diffSchema(dereference(oldDoc, ob.schema), dereference(newDoc, nb.schema), "body", true, found);
  const or = success(old);
  const nr = success(next);
  if (!setEq(or.types, nr.types)) {
    found.push([
      `response content type ${JSON.stringify([...or.types].sort())} -> ${JSON.stringify([...nr.types].sort())}`,
      true,
    ]);
  }
  diffSchema(
    dereference(oldDoc, or.schema),
    dereference(newDoc, nr.schema),
    "response",
    false,
    found,
  );
  if (old.deprecated !== true && next.deprecated === true)
    found.push(["marked deprecated upstream", false]);
  if (!same(old["x-didit-sdk"], next["x-didit-sdk"]) && next["x-didit-sdk"] !== undefined) {
    found.push([`x-didit-sdk now ${JSON.stringify(sortKeys(next["x-didit-sdk"]))}`, false]);
  }
  if (!found.length)
    return { notes: ["descriptions, examples or other details changed"], breaking: false };
  const ordered = [...found.filter(([, b]) => b), ...found.filter(([, b]) => !b)];
  let notes = ordered.map(([n, b]) => (b ? `${n} (breaking)` : n));
  if (notes.length > MAX_NOTES)
    notes = [...notes.slice(0, MAX_NOTES), `and ${notes.length - MAX_NOTES} more differences`];
  return { notes, breaking: found.some(([, b]) => b) };
}

/** The version in which a method deprecated in `version` is deleted. */
export function nextMinor(version: string): string {
  const match = /^(\d+)\.(\d+)/.exec(version);
  if (!match) return "0.1.0";
  return `${match[1]}.${Number(match[2]) + 1}.0`;
}

interface Naming {
  resource: string;
  method: string;
  auth?: string;
  server?: boolean;
}

function nameOf(naming: Naming): string {
  return `${naming.resource}.${naming.method}`;
}

function naming(value: Json): Naming | undefined {
  return isObject(value) && typeof value.resource === "string" && typeof value.method === "string"
    ? (value as unknown as Naming)
    : undefined;
}

export interface SyncInput {
  /** Current contents of openapi/ by file name (SOURCE.json, overlay.json, deprecated-operations.json and the specs). */
  files: Map<string, Uint8Array | undefined>;
  /** Upstream downloads by file name. */
  downloads: Map<string, Uint8Array>;
  now: Date;
  version: string;
}

export interface SyncResult {
  changed: boolean;
  breaking: boolean;
  summary: string;
  /** Files of openapi/ to write. */
  writes: Map<string, Uint8Array>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function json(text: Uint8Array | undefined, fallback: JsonObject): JsonObject {
  if (text === undefined) return fallback;
  const value: unknown = JSON.parse(decoder.decode(text));
  return isObject(value) ? value : fallback;
}

function equalBytes(a: Uint8Array | undefined, b: Uint8Array): boolean {
  if (a?.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Apply the downloads to openapi/; returns what to write and the pull request summary. */
export function sync(input: SyncInput): SyncResult {
  const today = input.now.toISOString().slice(0, 10);
  const oldDocs = new Map<string, JsonObject>();
  const newDocs = new Map<string, JsonObject>();
  const changedFiles: string[] = [];
  for (const [name, data] of input.downloads) {
    newDocs.set(name, checkOpenAPI(name, data));
    const old = input.files.get(name);
    oldDocs.set(name, json(old, {}));
    if (!equalBytes(old, data)) changedFiles.push(name);
  }
  if (!changedFiles.length) {
    return { changed: false, breaking: false, summary: "No upstream change.\n", writes: new Map() };
  }

  const removeIn = nextMinor(input.version);
  const overlay = json(input.files.get("overlay.json"), { operations: {} });
  const overlayOps = (isObject(overlay.operations) ? overlay.operations : {}) as Record<
    string,
    Json
  >;
  const oldOverlay = { ...overlayOps };
  const deprecated = json(input.files.get("deprecated-operations.json"), {
    description: "",
    methods: {},
  });
  if (!isObject(deprecated.methods)) deprecated.methods = {};
  const deprecatedMethods = deprecated.methods as Record<string, JsonObject>;

  const oldOps = new Map<string, [string, JsonObject]>();
  const newOps = new Map<string, [string, JsonObject]>();
  for (const name of input.downloads.keys()) {
    for (const [key, op] of operations(oldDocs.get(name)!, PREFIXES[name] ?? ""))
      oldOps.set(key, [name, op]);
    for (const [key, op] of operations(newDocs.get(name)!, PREFIXES[name] ?? ""))
      newOps.set(key, [name, op]);
  }
  const oldNaming = (key: string): Naming | undefined =>
    naming(oldOps.get(key)![1]["x-didit-sdk"] ?? oldOverlay[key]);
  const newNaming = (key: string): Naming | undefined =>
    naming(newOps.get(key)![1]["x-didit-sdk"] ?? oldOverlay[key]);

  const added = [...newOps.keys()].filter((k) => !oldOps.has(k)).sort();
  const removed = [...oldOps.keys()].filter((k) => !newOps.has(k)).sort();
  const common = [...oldOps.keys()].filter((k) => newOps.has(k)).sort();
  const newServerNames = new Map<string, string>();
  for (const key of newOps.keys()) {
    const n = newNaming(key);
    if (n?.server) newServerNames.set(nameOf(n), key);
  }
  const oldServerNames = new Map<string, string>();
  for (const key of oldOps.keys()) {
    const n = oldNaming(key);
    if (n?.server) oldServerNames.set(nameOf(n), key);
  }

  const lines: string[] = [
    `Spec sync ${today}. Upstream files changed: ${changedFiles.join(", ")}.`,
    "",
  ];
  const breaking: string[] = [];
  const kept: string[] = [];

  const keep = (
    n: Naming,
    key: string,
    reason: "removed" | "renamed",
    replacement?: string,
  ): void => {
    const [docName, op] = oldOps.get(key)!;
    const method = nameOf(n);
    const note = replacement
      ? `Renamed to ${replacement} on ${today}; this name is removed in version ${removeIn}.`
      : `Removed from the API contract on ${today}; this method is removed in version ${removeIn}.`;
    const detached = detach(oldDocs.get(docName)!, op);
    const entry: JsonObject = {
      reason,
      operation_key: key,
      "x-didit-sdk": n,
      operation: detached.node,
      components: detached.components,
      since: today,
      deprecated_since: input.version,
      remove_in: removeIn,
      note,
    };
    if (replacement) entry.replacement = replacement;
    deprecatedMethods[method] = entry;
    kept.push(method);
  };

  lines.push(`## Added operations (${added.length})`);
  for (const key of added) {
    const n = newNaming(key);
    if (!n)
      lines.push(
        `- \`${key}\`: **no SDK naming**; add an entry to \`openapi/overlay.json\` (DESIGN section 4)`,
      );
    else if (n.server) lines.push(`- \`${key}\` -> \`${nameOf(n)}\``);
    else lines.push(`- \`${key}\` (not exposed by server SDKs: ${n.auth ?? "-"})`);
  }
  lines.push("");

  lines.push(`## Removed operations (${removed.length})`);
  for (const key of removed) {
    const n = oldNaming(key);
    if (!n) lines.push(`- \`${key}\``);
    else if (!n.server) lines.push(`- \`${key}\` (not exposed by server SDKs)`);
    else if (newServerNames.has(nameOf(n))) {
      lines.push(
        `- \`${key}\` moved to \`${newServerNames.get(nameOf(n))!}\`; \`${nameOf(n)}\` keeps its name`,
      );
    } else {
      breaking.push(
        `\`${nameOf(n)}\` was removed upstream (${key}); kept as a deprecated method until version ${removeIn}`,
      );
      lines.push(
        `- \`${key}\` (\`${nameOf(n)}\`): kept as a deprecated method until version ${removeIn}, recorded in \`openapi/deprecated-operations.json\``,
      );
      keep(n, key, "removed");
    }
    Reflect.deleteProperty(overlayOps, key);
  }
  lines.push("");

  const renames: string[] = [];
  for (const key of common) {
    const before = oldNaming(key);
    const after = newNaming(key);
    if (!before?.server) continue;
    if (after?.server && nameOf(after) === nameOf(before)) continue;
    if (newServerNames.has(nameOf(before))) continue; // another operation provides the name now
    if (!after) {
      // The generator fails until the operation is named again, so this cannot ship silently.
      renames.push(
        `- \`${key}\` lost its SDK naming: add \`${nameOf(before)}\` back to \`openapi/overlay.json\` (the generator fails until it is named)`,
      );
      breaking.push(`\`${nameOf(before)}\` (${key}) has no SDK naming any more`);
    } else if (!after.server) {
      renames.push(
        `- \`${key}\` (\`${nameOf(before)}\`) is no longer a server operation (auth ${after.auth ?? "-"}); kept as a deprecated method until version ${removeIn}`,
      );
      breaking.push(
        `\`${nameOf(before)}\` (${key}) now needs ${after.auth ?? "-"}, which server SDKs do not expose; kept as a deprecated method until version ${removeIn}`,
      );
      keep(before, key, "removed");
    } else {
      renames.push(
        `- \`${key}\`: \`${nameOf(before)}\` renamed to \`${nameOf(after)}\`; the old name stays as a deprecated alias until version ${removeIn}`,
      );
      breaking.push(
        `\`${nameOf(before)}\` was renamed upstream to \`${nameOf(after)}\` (${key}); the old name is a deprecated alias until version ${removeIn}`,
      );
      keep(before, key, "renamed", nameOf(after));
    }
  }
  lines.push(`## Renamed methods (${renames.length})`, ...renames, "");

  const moves: string[] = [];
  for (const method of [...oldServerNames.keys()].filter((m) => newServerNames.has(m)).sort()) {
    const oldKey = oldServerNames.get(method)!;
    const newKey = newServerNames.get(method)!;
    if (oldKey === newKey) continue;
    const [oldName, old] = oldOps.get(oldKey)!;
    const [newName, next] = newOps.get(newKey)!;
    const change = describeChange(oldDocs.get(oldName)!, old, newDocs.get(newName)!, next);
    const isBreaking = change.breaking;
    const notes =
      change.notes.length === 1 &&
      change.notes[0] === "descriptions, examples or other details changed"
        ? ["same parameters, body and response"]
        : change.notes;
    const detail = notes.join("; ");
    if (newOps.has(oldKey)) {
      moves.push(
        `- \`${method}\` **(breaking)** now calls \`${newKey}\` instead of \`${oldKey}\` (which is still in the API): ${detail}`,
      );
      breaking.push(
        `\`${method}\` now calls \`${newKey}\` instead of \`${oldKey}\`, a different operation`,
      );
    } else {
      moves.push(
        `- \`${method}\`${isBreaking ? " **(breaking)**" : ""} moved from \`${oldKey}\` to \`${newKey}\`: ${detail}`,
      );
      if (isBreaking) {
        breaking.push(
          `\`${method}\` moved from \`${oldKey}\` to \`${newKey}\`: ${notes.filter((n) => n.endsWith("(breaking)")).join("; ")}`,
        );
      }
    }
  }
  lines.push(`## Moved or reassigned methods (${moves.length})`, ...moves, "");

  for (const method of Object.keys(deprecatedMethods).sort()) {
    if (newServerNames.has(method) && !kept.includes(method)) {
      Reflect.deleteProperty(deprecatedMethods, method);
      lines.push(
        `- \`${method}\` is provided again by \`${newServerNames.get(method)!}\`; its deprecation entry was dropped.`,
      );
    }
  }

  const changes: string[] = [];
  for (const key of common) {
    const [oldName, old] = oldOps.get(key)!;
    const [newName, next] = newOps.get(key)!;
    const sameOp = same(old, next);
    if (sameOp && same(oldDocs.get(oldName)!.components, newDocs.get(newName)!.components))
      continue;
    const { notes, breaking: isBreaking } = describeChange(
      oldDocs.get(oldName)!,
      old,
      newDocs.get(newName)!,
      next,
    );
    if (
      sameOp &&
      notes.length === 1 &&
      notes[0] === "descriptions, examples or other details changed"
    )
      continue;
    changes.push(`- \`${key}\`${isBreaking ? " **(breaking)**" : ""}: ${notes.join("; ")}`);
    if (isBreaking)
      breaking.push(`\`${key}\`: ${notes.filter((n) => n.endsWith("(breaking)")).join("; ")}`);
  }
  lines.push(`## Changed operations (${changes.length})`, ...changes, "");

  lines.push("## Schemas");
  for (const name of input.downloads.keys()) {
    const schemasOf = (doc: JsonObject): Record<string, Json> => {
      const components = isObject(doc.components) ? doc.components : {};
      return isObject(components.schemas) ? components.schemas : {};
    };
    const oldSchemas = schemasOf(oldDocs.get(name)!);
    const newSchemas = schemasOf(newDocs.get(name)!);
    const gone = Object.keys(oldSchemas)
      .filter((k) => !(k in newSchemas))
      .sort();
    for (const schema of gone)
      breaking.push(`${name}: schema \`${schema}\` removed (its type leaves the SDK)`);
    const groups: [string, string[]][] = [
      [
        "added",
        Object.keys(newSchemas)
          .filter((k) => !(k in oldSchemas))
          .sort(),
      ],
      ["removed", gone],
      [
        "changed",
        Object.keys(oldSchemas)
          .filter((k) => k in newSchemas && !same(oldSchemas[k], newSchemas[k]))
          .sort(),
      ],
    ];
    for (const [label, names] of groups) {
      if (names.length)
        lines.push(`- ${name} ${label}: ${names.map((n) => `\`${n}\``).join(", ")}`);
    }
  }
  lines.push("");

  const dropped: string[] = [];
  for (const key of Object.keys(overlayOps)) {
    const entry = newOps.get(key);
    const upstream = entry?.[1]["x-didit-sdk"];
    if (upstream === undefined) continue;
    if (!same(upstream, overlayOps[key]))
      lines.push(`- \`${key}\`: upstream x-didit-sdk differs from the overlay; upstream wins.`);
    dropped.push(key);
    Reflect.deleteProperty(overlayOps, key);
  }
  if (dropped.length)
    lines.push(`Dropped ${dropped.length} overlay entries that upstream now carries.`, "");

  lines.splice(
    2,
    0,
    "## Breaking changes",
    breaking.length ? breaking.map((b) => `- ${b}`).join("\n") : "None detected.",
    "",
  );

  const writes = new Map<string, Uint8Array>();
  for (const [name, data] of input.downloads) writes.set(name, data);
  const source = json(input.files.get("SOURCE.json"), {});
  for (const [name, data] of input.downloads) {
    const previous = isObject(source[name]) ? source[name] : {};
    source[name] = {
      url: UPSTREAM[name] ?? previous.url ?? "",
      sha256: createHash("sha256").update(data).digest("hex"),
      fetched_at: `${input.now.toISOString().slice(0, 19)}Z`,
    };
  }
  // Same layout as the seeded files (one-space indent, no trailing newline), so diffs stay small.
  writes.set("SOURCE.json", encoder.encode(JSON.stringify(source, null, 1)));
  overlay.operations = overlayOps;
  writes.set("overlay.json", encoder.encode(JSON.stringify(overlay, null, 1)));
  writes.set(
    "deprecated-operations.json",
    encoder.encode(`${JSON.stringify(deprecated, null, 1)}\n`),
  );
  return {
    changed: true,
    breaking: breaking.length > 0,
    summary: `${lines.join("\n").trimEnd()}\n`,
    writes,
  };
}
