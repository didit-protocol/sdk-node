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
//   opening with the changes that can break typed code (exactly the list of
//   DESIGN section 3.1), and classify the sync as `feat` (a caller can observe
//   the change) or `chore` (documentation only). Never a major version: a change
//   that mirrors the API is a minor one (DESIGN section 13). The shared vectors in
//   openapi/breaking-vectors.json (copied byte for byte from sdk-python) check that
//   list: codegen/tests/breaking-vectors.test.ts.

import { createHash } from "node:crypto";

import { byCodePoint, pascal } from "./naming.ts";
import { isObject, type Json, type JsonObject } from "./spec.ts";

export const UPSTREAM: Record<string, string> = {
  "verification.json": "https://docs.didit.me/openapi-25.json",
  "account.json": "https://docs.didit.me/openapi-auth.json",
  "authentication.json": "https://docs.didit.me/openapi-authentication.json",
};
const PREFIXES: Record<string, string> = {
  "verification.json": "",
  "account.json": "account ",
  "authentication.json": "authentication ",
};
/**
 * Documents whose operations the hand-written `authentication` module implements
 * (DESIGN section 10). The sync describes their changes like any other, but never
 * names, generates or deprecates a method for them: the contract test in
 * tests/authentication/contract.test.ts fails until the module follows.
 */
const HAND_WRITTEN = new Set(["authentication.json"]);
const METHODS = ["get", "put", "post", "delete", "patch", "head", "options"];
// Keys that document a schema without changing what is sent or received.
const DOC_KEYS = new Set([
  "description",
  "summary",
  "title",
  "example",
  "examples",
  "externalDocs",
  "tags",
]);
const MAX_NOTES = 25;
const MAX_DEPTH = 32;
const COMPONENT_PREFIX = "#/components/schemas/";
/**
 * The longest summary plus release section written for the pull request body. GitHub
 * refuses a body over 65,536 characters, and the workflow appends the checks.
 */
export const MAX_SUMMARY = 60_000;
/**
 * The longest release section with its BEGIN_COMMIT_OVERRIDE block, so the summary
 * keeps some room. A longer one leaves the block out: the sync commit's message
 * carries every line instead (releaseSection).
 */
export const MAX_RELEASE = 50_000;
/**
 * The commit type of each change that can break typed code in the release block;
 * release-please-config.json shows it under RELEASE_NOTES_HEADING.
 */
export const BREAKING_TYPE = "api";
export const RELEASE_NOTES_HEADING = "API changes that can break typed code";
// Objects whose keys are names (properties, media types, status codes), not keywords.
const NAME_MAPS = new Set([
  "properties",
  "patternProperties",
  "dependentSchemas",
  "$defs",
  "definitions",
  "content",
  "encoding",
  "headers",
  "links",
  "callbacks",
  "responses",
  "mapping",
]);
// Keywords whose value is data sent or received as it is, not a schema.
const LITERALS = new Set(["enum", "const", "default"]);
// String formats with a type of their own in the server SDKs (a date, a date-time, a
// file), so a change to or from one is a type change (the same in all seven).
const TYPED_FORMATS = new Set(["date", "date-time", "binary"]);
// Where a request body has no content at all: nothing to compare with, unlike `{}`,
// which allows any value. Compared by identity.
const NO_SCHEMA: JsonObject = {};

/**
 * Sample data a deprecated method does not need: examples and vendor extensions such
 * as x-codeSamples (curl commands with API keys). Upstream examples can look like
 * credentials (JWTs, API keys); the secret scan allowlists the upstream copies only,
 * so deprecated-operations.json must not carry them.
 */
function isSample(key: string): boolean {
  return key === "example" || key === "examples" || (key.startsWith("x-") && key !== "x-didit-sdk");
}

/** A download is not a document the SDK can be generated from. */
export class SpecSyncError extends Error {
  override name = "SpecSyncError";
}

/** Where a change that can break typed code is: a parameter goes by its `in`. */
export type BreakingPlace =
  "operation" | "request" | "response" | "query" | "path" | "header" | "cookie";

/**
 * A change that can break typed code, as the rules of DESIGN section 3.1 count it.
 * Every SDK repository detects exactly this list (`normalized` is the line the shared
 * vectors compare). Everything else stays in the summary only.
 */
export interface BreakingChange {
  /** The operation: `POST /v3/session/`, `account ...` or `authentication ...`. */
  operation: string;
  in: BreakingPlace;
  /**
   * The field path (`registry_checks[].company.registry_data`, `[]` for array items,
   * `{}` for map values) or the parameter name; empty for the operation or a whole body.
   */
  field: string;
  /**
   * As the shared vectors spell it: `removed`, `type <old> -> <new>` (`type string ->
   * string (date-time)`, `type object|object -> object`, `type any -> object`), `can
   * now be null`, `no longer required`, `now required`, `enum value "closed" removed`,
   * `body now required` or `operation removed`.
   */
  kind: string;
  /** The sentence the pull request and the release notes show. */
  text: string;
}

type Finding = Omit<BreakingChange, "operation" | "text"> & { says: string };

interface Note {
  text: string;
  /** Set when the note is one of the changes that can break typed code. */
  breaking?: Finding;
}

/** Where diffSchema is: the label of its notes and the place of what it finds. */
interface At {
  /** `response.items[].id`, `body.name` or `parameter status (query)`. */
  label: string;
  /** Parameters and the request body; the response otherwise. */
  request: boolean;
  in: Exclude<BreakingPlace, "operation">;
  field: string;
}

const DOCS_ONLY = "descriptions, examples or other details changed";

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

/**
 * `node` with every local `$ref` inlined. `refTitles: false` drops the title of every
 * referenced schema: the generated code names it after its component, so only an
 * inline union variant's title names a type.
 */
export function dereference(doc: Json, node: Json, depth = 0, refTitles = true): Json {
  if (depth > 64) return {};
  if (Array.isArray(node)) return node.map((v: Json) => dereference(doc, v, depth + 1, refTitles));
  if (!isObject(node)) return node;
  if (typeof node.$ref === "string") {
    const found = pointer(doc, node.$ref);
    if (found === undefined) return { "x-unresolved-ref": node.$ref };
    const target = dereference(doc, found, depth + 1, refTitles);
    const dropped = refTitles ? ["$ref"] : ["$ref", "title"];
    const keep = ([k]: [string, Json]): boolean => !dropped.includes(k);
    const extra = Object.fromEntries(Object.entries(node).filter(keep));
    if (!isObject(target)) return target;
    return { ...Object.fromEntries(Object.entries(target).filter(keep)), ...extra };
  }
  return Object.fromEntries(
    Object.entries(node).map(([k, v]) => [k, dereference(doc, v, depth + 1, refTitles)]),
  );
}

/**
 * `node` with every `$ref` inlined except component schemas, plus the component
 * schemas it uses (transitively), so a deprecated method keeps its type names.
 * Sample data (examples, x-codeSamples and other vendor extensions) is left out.
 */
export function detach(doc: Json, node: Json): { node: Json; components: Record<string, Json> } {
  const components: Record<string, Json> = {};
  // `names`: the keys of `value` are names (of properties, media types...), not keywords.
  const inline = (value: Json, depth: number, names = false): Json => {
    if (depth > 64) return {};
    if (Array.isArray(value)) return value.map((v: Json) => inline(v, depth + 1));
    if (!isObject(value)) return value;
    if (names) {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, inline(v, depth + 1)]));
    }
    const entries = Object.entries(value)
      .filter(([k]) => !isSample(k))
      .map(([k, v]): [string, Json] => [
        k,
        k === "$ref" ? v : inline(v, depth + 1, NAME_MAPS.has(k)),
      ]);
    if (typeof value.$ref === "string") {
      const extra = Object.fromEntries(entries.filter(([k]) => k !== "$ref"));
      if (value.$ref.startsWith(COMPONENT_PREFIX)) {
        const name = value.$ref
          .slice(COMPONENT_PREFIX.length)
          .replace(/~1/g, "/")
          .replace(/~0/g, "~");
        if (!(name in components)) {
          components[name] = {};
          components[name] = inline(pointer(doc, value.$ref) ?? {}, depth + 1);
        }
        return { $ref: value.$ref, ...extra };
      }
      const found = pointer(doc, value.$ref);
      if (found === undefined) return { "x-unresolved-ref": value.$ref };
      const target = inline(found, depth + 1);
      return isObject(target) ? { ...target, ...extra } : target;
    }
    return Object.fromEntries(entries);
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

/**
 * What an inline `oneOf`/`anyOf` variant's title adds to its generated type name
 * (`TypeWriter.variantName`); undefined without one, or for a `$ref` (named after
 * its component).
 */
function variantTypeName(schema: Json): string | undefined {
  if (!isObject(schema) || "$ref" in schema) return undefined;
  return typeof schema.title === "string" && schema.title.trim() ? pascal(schema.title) : undefined;
}

/**
 * `node` without what only documents it (descriptions, examples, vendor extensions), so
 * two equal shapes are the same to a caller. `names`: the keys of `node` are names (of
 * properties, media types, status codes...), kept even when they read like a keyword.
 * `required` and `type` lists compare in any order. `variant`: a `oneOf`/`anyOf`
 * variant, whose title names its generated type, so it stays.
 */
function shape(node: Json, names = false, variant = false): Json {
  if (Array.isArray(node)) return node.map((v: Json) => shape(v));
  if (!isObject(node)) return node;
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(node)) {
    if (names) {
      out[k] = shape(v);
    } else if (variant && k === "title") {
      const name = variantTypeName(node);
      if (name !== undefined) out[k] = name;
    } else if (DOC_KEYS.has(k) || k.startsWith("x-")) {
      continue;
    } else if ((k === "required" || k === "type") && Array.isArray(v)) {
      out[k] = [...(v as Json[])].sort((a, b) => byCodePoint(String(a), String(b)));
    } else if ((k === "oneOf" || k === "anyOf") && Array.isArray(v)) {
      out[k] = (v as Json[]).map((member) => shape(member, false, true));
    } else {
      out[k] = keywordShape(k, v);
    }
  }
  return out;
}

/** The shape of the value of keyword `key`: data such as enum values stays as it is. */
function keywordShape(key: string, value: Json): Json {
  return LITERALS.has(key) ? value : shape(value, NAME_MAPS.has(key));
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

function asArray(value: Json): Json[] {
  return Array.isArray(value) ? (value as Json[]) : [];
}

function has(schema: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(schema, key);
}

function without(schema: JsonObject, ...keys: string[]): JsonObject {
  return Object.fromEntries(Object.entries(schema).filter(([k]) => !keys.includes(k)));
}

function nullOnly(schema: Json): boolean {
  return (
    isObject(schema) &&
    (schema.type === "null" || (Array.isArray(schema.enum) && same(schema.enum, [null])))
  );
}

/** The `oneOf`/`anyOf` variants other than null (of `keyword`, or of both). */
function variants(schema: JsonObject, keyword?: string): Json[] {
  return (keyword ? [keyword] : ["oneOf", "anyOf"]).flatMap((k) =>
    asArray(schema[k]).filter((v) => !nullOnly(v)),
  );
}

/**
 * Each of `variants(schema)` as the shared vectors number it: its keyword and its
 * position from 1 in that keyword's list, a null variant included (`anyOf 2` in
 * `[null, X, Y]`).
 */
function positions(schema: JsonObject): string[] {
  return ["oneOf", "anyOf"].flatMap((k) =>
    asArray(schema[k]).flatMap((v, n) => (nullOnly(v) ? [] : [`${k} ${n + 1}`])),
  );
}

function unionKeyword(schema: JsonObject): string | undefined {
  return ["oneOf", "anyOf"].find((k) => variants(schema, k).length);
}

/**
 * A union's variant with the fields the union itself requires, which JSON Schema
 * applies to every variant: dropping one from the union drops it from each variant.
 */
function withRequired(variant: Json, union: JsonObject): Json {
  const inherited = asArray(union.required).filter((n): n is string => typeof n === "string");
  if (!inherited.length || !isObject(variant)) return variant;
  const own = asArray(variant.required).filter((n): n is string => typeof n === "string");
  return { ...variant, required: [...new Set([...own, ...inherited])].sort(byCodePoint) };
}

/** Whether `schema` accepts null: a null type, `nullable`, null in its enum, or a null or nullable variant. */
function nullable(schema: Json, depth = 0): boolean {
  if (!isObject(schema) || depth > MAX_DEPTH) return false;
  const raw = schema.type;
  if (raw === "null" || (Array.isArray(raw) && raw.includes("null"))) return true;
  if (schema.nullable === true) return true;
  if (Array.isArray(schema.enum) && schema.enum.includes(null)) return true;
  const members = asArray(schema.allOf);
  if (!has(schema, "type") && members.length && members.every((m) => nullable(m, depth + 1)))
    return true;
  return [...asArray(schema.oneOf), ...asArray(schema.anyOf)].some((v) => nullable(v, depth + 1));
}

/**
 * `schema` read as one type: `allOf` members merged into it, and a `oneOf`/`anyOf`
 * with a single non-null variant replaced by that variant, so that `anyOf: [X, null]`
 * reads as a nullable X rather than as X's fields removed.
 */
function single(schema: JsonObject, depth = 0): JsonObject {
  if (depth > MAX_DEPTH) return schema;
  const members = schema.allOf;
  if (Array.isArray(members) && members.every(isObject)) {
    const merged = without(schema, "allOf");
    for (const member of members) {
      for (const [key, value] of Object.entries(single(member, depth + 1))) {
        if (key === "properties" && isObject(value)) {
          merged.properties = {
            ...value,
            ...(isObject(merged.properties) ? merged.properties : {}),
          };
        } else if (key === "required" && Array.isArray(value)) {
          merged.required = [...new Set([...asArray(merged.required), ...(value as Json[])])].sort(
            (a, b) => byCodePoint(String(a), String(b)),
          );
        } else if (!has(merged, key)) {
          merged[key] = value;
        }
      }
    }
    schema = merged;
  }
  const only = variants(schema);
  if (only.length !== 1 || !isObject(only[0])) return schema;
  const rest = without(schema, "oneOf", "anyOf", "required");
  return single({ ...(withRequired(only[0], schema) as JsonObject), ...rest }, depth + 1);
}

function jsonType(value: Json): string {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "string") return "string";
  return Array.isArray(value) ? "array" : "object";
}

/**
 * The JSON types `schema` allows besides null, inferred when it has no `type` (a
 * union allows its variants' types); empty when it does not say.
 */
function kinds(schema: Json, depth = 0): Set<string> {
  if (!isObject(schema) || depth > MAX_DEPTH) return new Set();
  const raw = schema.type;
  const out = new Set(Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? [raw] : []);
  out.delete("null");
  if (out.size) return out;
  if (["properties", "additionalProperties", "patternProperties"].some((k) => has(schema, k)))
    return new Set(["object"]);
  if (has(schema, "items")) return new Set(["array"]);
  const union = variants(schema);
  if (union.length) {
    const found = union.map((v) => kinds(v, depth + 1));
    return found.every((f) => f.size) ? new Set(found.flatMap((f) => [...f])) : new Set();
  }
  for (const member of asArray(schema.allOf)) for (const k of kinds(member, depth + 1)) out.add(k);
  if (!out.size) {
    const values = has(schema, "const") ? [schema.const] : asArray(schema.enum);
    for (const value of values) if (value !== null) out.add(jsonType(value));
  }
  return out;
}

/**
 * `found` as the shared vectors name it: sorted and joined with `|`, a string with a
 * typed format as its own type (`string (date-time)`), and `any` for a schema that
 * does not say.
 */
function typeNames(schema: JsonObject, found: Set<string>): string {
  if (!found.size) return "any";
  const format = typeof schema.format === "string" ? schema.format : "";
  return [...found]
    .sort(byCodePoint)
    .map((kind) => (kind === "string" && TYPED_FORMATS.has(format) ? `string (${format})` : kind))
    .join("|");
}

/**
 * The types of a union's variants (or of a method's 2xx bodies), sorted and repeated
 * per variant, so that losing one of two objects reads `object|object -> object`.
 */
function unionNames(schemas: Json[]): string {
  return schemas
    .flatMap((schema) => {
      const one = isObject(schema) ? single(schema) : {};
      return typeNames(one, kinds(one)).split("|");
    })
    .sort(byCodePoint)
    .join("|");
}

/** The enum values other than null, or undefined without an enum. */
function enumValues(schema: JsonObject): Json[] | undefined {
  return Array.isArray(schema.enum) ? schema.enum.filter((v) => v !== null) : undefined;
}

function objectProps(schema: JsonObject): { props: Record<string, Json>; required: Set<string> } {
  const props: Record<string, Json> = {};
  const required = new Set<string>();
  const stack: Json[] = [schema];
  while (stack.length) {
    const cur = stack.pop();
    if (!isObject(cur)) continue;
    if (isObject(cur.properties)) Object.assign(props, cur.properties);
    for (const r of asArray(cur.required)) if (typeof r === "string") required.add(r);
    stack.push(...asArray(cur.allOf));
  }
  return { props, required };
}

function setEq(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

function below(at: At, name: string, separator = "."): At {
  return {
    ...at,
    label: `${at.label}${separator}${name}`,
    field: at.field && separator === "." ? `${at.field}.${name}` : `${at.field}${name}`,
  };
}

/** A difference the summary lists without counting it. */
function listed(notes: Note[], at: At, text: string): void {
  notes.push({ text: `${at.label}: ${text}` });
}

/**
 * A change DESIGN section 3.1 counts: `kind` as the shared vectors spell it, `says`
 * for the release notes and `text` for the summary.
 */
function counted(notes: Note[], at: At, kind: string, says: string, text = kind): void {
  notes.push({
    text: `${at.label}: ${text}`,
    breaking: { in: at.in, field: at.field, kind, says },
  });
}

/** A type as the release notes write it (`string or integer`). */
function spoken(names: string): string {
  return names.split("|").join(" or ");
}

/**
 * Append a note for every difference between two dereferenced schemas; the ones
 * DESIGN section 3.1 counts carry `breaking`. In requests and responses: a type
 * change in either direction (a typed string format and `any` included), a removed
 * field, enum value or union variant. Only in a response: a value that can now be
 * null and a field that is no longer required. Only in a request: a field that is
 * newly required. Everything else is listed, not counted.
 */
export function diffSchema(
  oldSchema: Json,
  nextSchema: Json,
  at: At,
  notes: Note[],
  depth = 0,
): void {
  if (depth > MAX_DEPTH || same(shape(oldSchema), shape(nextSchema))) return;
  const { request } = at;
  const start = notes.length;
  // A request body that appears or disappears is compared field by field, not as a
  // type change (a response's is a success status change: diffStatuses).
  const present = oldSchema !== NO_SCHEMA && nextSchema !== NO_SCHEMA;
  // A schema that is not an object (`true`) allows any value.
  let old = isObject(oldSchema) ? oldSchema : {};
  let next = isObject(nextSchema) ? nextSchema : {};
  if (nullable(next) && !nullable(old)) {
    // A request that accepts null only widens what a caller may send.
    if (request) listed(notes, at, "can now be null");
    else counted(notes, at, "can now be null", "can now be null");
  } else if (nullable(old) && !nullable(next)) {
    listed(notes, at, request ? "no longer accepts null" : "is never null now");
  }
  old = single(old);
  next = single(next);
  const oldKinds = kinds(old);
  const newKinds = kinds(next);
  const from = typeNames(old, oldKinds);
  const to = typeNames(next, newKinds);
  if (present && (oldKinds.size || newKinds.size) && from !== to) {
    counted(
      notes,
      at,
      `type ${from} -> ${to}`,
      `changed type from ${spoken(from)} to ${spoken(to)}`,
    );
    // A union's variants can change too, also when an untyped variant made it `any`;
    // the type change already covers those removed. A schema untyped as a whole has none.
    if ((oldKinds.size || variants(old).length) && (newKinds.size || variants(next).length))
      diffVariants(old, next, at, notes, depth, true);
    return;
  }

  const oldEnum = enumValues(old);
  const newEnum = enumValues(next);
  if (oldEnum && newEnum) {
    for (const value of oldEnum.filter((v) => !newEnum.some((w) => same(v, w)))) {
      const kind = `enum value ${JSON.stringify(value)} removed`;
      counted(notes, at, kind, `no longer has the enum value \`${JSON.stringify(value)}\``);
    }
    const added = newEnum.filter((v) => !oldEnum.some((w) => same(v, w)));
    if (added.length) listed(notes, at, `values added ${JSON.stringify(added)}`);
  } else if (newEnum) {
    listed(notes, at, `now limited to ${JSON.stringify(newEnum)}`);
  } else if (oldEnum) {
    listed(notes, at, "no longer limited to fixed values");
  }

  const a = objectProps(old);
  const b = objectProps(next);
  const oldNames = Object.keys(a.props);
  const newNames = Object.keys(b.props);
  // A plain object against a union is compared as one of its variants (below). The
  // fields a union declares beside its variants are shared by all of them and compared
  // here, also when the last of them goes or the first one comes.
  const oldUnion = variants(old).length > 0;
  const newUnion = variants(next).length > 0;
  const asVariant = oldNames.length
    ? !newNames.length && !oldUnion && newUnion
    : newNames.length > 0 && !newUnion && oldUnion;
  if (!asVariant) {
    for (const name of oldNames.filter((n) => !(n in b.props)).sort(byCodePoint))
      counted(notes, below(at, name), "removed", "was removed");
    for (const name of newNames.filter((n) => !(n in a.props)).sort(byCodePoint)) {
      if (request && b.required.has(name))
        counted(
          notes,
          below(at, name),
          "now required",
          "was added and is required",
          "added (required)",
        );
      else listed(notes, below(at, name), "added");
    }
    for (const name of oldNames.filter((n) => n in b.props).sort(byCodePoint)) {
      const field = below(at, name);
      if (b.required.has(name) && !a.required.has(name)) {
        if (request) counted(notes, field, "now required", "is now required");
        else listed(notes, field, "now always present");
      } else if (a.required.has(name) && !b.required.has(name)) {
        // A response field that may be missing breaks code that reads it.
        if (request) listed(notes, field, "now optional");
        else
          counted(notes, field, "no longer required", "is no longer required (it can be missing)");
      }
      diffSchema(a.props[name], b.props[name], field, notes, depth + 1);
    }
  }
  for (const [key, suffix] of [
    ["items", "[]"],
    ["additionalProperties", "{}"],
  ] as const) {
    if (isObject(old[key]) || isObject(next[key])) {
      diffSchema(
        isObject(old[key]) ? old[key] : {},
        isObject(next[key]) ? next[key] : {},
        below(at, suffix, ""),
        notes,
        depth + 1,
      );
    }
  }
  diffVariants(old, next, at, notes, depth, false);
  // Any other difference a caller can observe (format, pattern, limits, default...).
  if (notes.length === start) {
    const keys = [...new Set([...Object.keys(old), ...Object.keys(next)])]
      .filter((k) => !same(keywordShape(k, old[k]), keywordShape(k, next[k])))
      .sort();
    listed(notes, at, `${keys.join(", ") || "schema"} changed`);
  }
}

/** Old and new types allow the same JSON types, or one of them does not say. */
function compatible(old: Json, next: Json): boolean {
  const a = kinds(old);
  const b = kinds(next);
  return !a.size || !b.size || setEq(a, b);
}

function fieldNames(schema: Json): Set<string> {
  return new Set(isObject(schema) ? Object.keys(objectProps(single(schema)).props) : []);
}

/**
 * Pair each old union variant with the new one it became: an unchanged one first,
 * then one with the same title, then one of a compatible type with the most fields in
 * common. Returns the pairs (old and new position, by new position) and the
 * positions left over on each side (variants removed and added).
 */
function pairVariants(
  old: Json[],
  next: Json[],
): { pairs: [number, number][]; removed: number[]; added: number[] } {
  const leftOld = old.map((_, i) => i);
  const leftNew = next.map((_, j) => j);
  const pairs: [number, number][] = [];
  const pair = (i: number, j: number): void => {
    pairs.push([i, j]);
    leftOld.splice(leftOld.indexOf(i), 1);
    leftNew.splice(leftNew.indexOf(j), 1);
  };
  const title = (schema: Json): Json => (isObject(schema) ? schema.title : undefined);
  const oldShapes = old.map((v) => shape(v));
  const newShapes = next.map((v) => shape(v));
  const sameShape = (i: number, j: number): boolean => same(oldShapes[i], newShapes[j]);
  const sameTitle = (i: number, j: number): boolean =>
    title(old[i]) !== undefined && title(old[i]) !== null && same(title(old[i]), title(next[j]));
  for (const match of [sameShape, sameTitle]) {
    for (const i of [...leftOld]) {
      const j = leftNew.find((k) => match(i, k));
      if (j !== undefined) pair(i, j);
    }
  }
  const candidates: [number, number, number][] = [];
  for (const i of leftOld) {
    for (const j of leftNew) {
      if (!compatible(old[i], next[j])) continue;
      const theirs = fieldNames(next[j]);
      candidates.push([-[...fieldNames(old[i])].filter((n) => theirs.has(n)).length, i, j]);
    }
  }
  candidates.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
  for (const [, i, j] of candidates) if (leftOld.includes(i) && leftNew.includes(j)) pair(i, j);
  return { pairs: pairs.sort((x, y) => x[1] - y[1]), removed: leftOld, added: leftNew };
}

/**
 * Compare two unions variant by variant; a plain schema is a union of one, so that
 * `[X, null]` against X loses no variant and X against `[X', Y]` compares X with X'.
 * A variant added or removed never hides a change inside the others.
 */
function diffVariants(
  old: JsonObject,
  next: JsonObject,
  at: At,
  notes: Note[],
  depth: number,
  retyped: boolean,
): void {
  const oldVars = variants(old).length ? variants(old) : [old];
  const newVars = variants(next).length ? variants(next) : [next];
  if (oldVars.length === 1 && newVars.length === 1) return; // compared as the schema itself
  const keyword = unionKeyword(next) ?? unionKeyword(old) ?? "oneOf";
  const { pairs, removed, added } = pairVariants(oldVars, newVars);
  const numbered = positions(next);
  for (const [i, j] of pairs) {
    const inner = newVars.length > 1 ? below(at, `(${numbered[j]!})`, "") : at;
    // The fields the union requires are required in each variant too.
    diffSchema(
      withRequired(oldVars[i], old),
      withRequired(newVars[j], next),
      inner,
      notes,
      depth + 1,
    );
    const before = variantTypeName(oldVars[i]) ?? "a numbered name";
    const after = variantTypeName(newVars[j]) ?? "a numbered name";
    // The variant's title names its generated type, which gets another name.
    if (before !== after) listed(notes, inner, `variant type renamed from ${before} to ${after}`);
  }
  if (removed.length && !retyped) {
    const from = unionNames(oldVars);
    const to = unionNames(newVars);
    counted(
      notes,
      at,
      `type ${from} -> ${to}`,
      `lost ${removed.length} of its ${keyword} variants (changed type from ${spoken(from)} to ${spoken(to)})`,
      `${removed.length} ${keyword} variant(s) removed (type ${from} -> ${to})`,
    );
  }
  if (added.length) listed(notes, at, `${added.length} ${keyword} variant(s) added`);
  const order = [...pairs].sort((x, y) => x[0] - y[0]).map(([, j]) => j);
  if (order.some((j, k) => k > 0 && order[k - 1]! > j))
    listed(notes, at, `${keyword} variants reordered`);
}

/** The schema of each media type of a request body or response, references inlined. */
function content(doc: JsonObject, node: Json): Map<string, Json> {
  const resolved = dereference(doc, node ?? {}, 0, false);
  const media = isObject(resolved) && isObject(resolved.content) ? resolved.content : {};
  const out = new Map<string, Json>();
  for (const [type, entry] of Object.entries(media))
    if (isObject(entry)) out.set(type, entry.schema ?? {});
  return out;
}

/** Every success response by status code: the schema of each of its media types. */
function successes(doc: JsonObject, op: JsonObject): Map<string, Map<string, Json>> {
  const out = new Map<string, Map<string, Json>>();
  const responses = isObject(op.responses) ? op.responses : {};
  for (const code of Object.keys(responses).sort())
    if (code.startsWith("2")) out.set(code, content(doc, responses[code]));
  return out;
}

function first<T>(keys: Iterable<T>): T {
  return [...keys].sort()[0]!;
}

/**
 * Compare a body per media type; when none is shared, the first against the first,
 * so that a body that changes content type, appears or disappears is compared too.
 */
function diffContent(old: Map<string, Json>, next: Map<string, Json>, at: At, notes: Note[]): void {
  const oldTypes = new Set(old.keys());
  const newTypes = new Set(next.keys());
  if (old.size && next.size && !setEq(oldTypes, newTypes))
    listed(
      notes,
      at,
      `content type ${[...oldTypes].sort().join(", ")} -> ${[...newTypes].sort().join(", ")}`,
    );
  const pairs: [Json, Json][] = [...oldTypes]
    .filter((t) => newTypes.has(t))
    .sort()
    .map((t) => [old.get(t), next.get(t)]);
  if (!pairs.length && (old.size || next.size)) {
    pairs.push([
      old.size ? old.get(first(old.keys())) : NO_SCHEMA,
      next.size ? next.get(first(next.keys())) : NO_SCHEMA,
    ]);
  }
  for (const [before, after] of pairs) diffSchema(before, after, at, notes);
}

/**
 * The success statuses not compared body by body: `removed` (only `old` has them, or
 * their body disappeared) and `added` (only `next` has them, or their body appeared).
 * The method returns every 2xx body, nullable when one has none: a status without a
 * body makes it nullable, and a removed status whose body no other one returns
 * removes a variant of it, `null` when no body is left (DESIGN section 3.1).
 */
function diffStatuses(
  old: Map<string, Map<string, Json>>,
  next: Map<string, Map<string, Json>>,
  removed: string[],
  added: string[],
  notes: Note[],
): void {
  const at: At = { label: "response", request: false, in: "response", field: "" };
  const shaped = (media: Map<string, Json>): Json =>
    Object.fromEntries([...media].map(([type, schema]) => [type, shape(schema)]));
  const bodies = (responses: Map<string, Map<string, Json>>): Json[] =>
    [...responses.values()].filter((media) => media.size).map(shaped);
  const returnsNull = (responses: Map<string, Map<string, Json>>): boolean =>
    [...responses.values()].some((media) => !media.size);
  const among = (body: Json, others: Json[]): boolean => others.some((o) => same(o, body));
  const types = (responses: Map<string, Map<string, Json>>): string => {
    const distinct = new Map<string, Json>();
    for (const media of responses.values()) {
      if (!media.size) continue;
      const key = JSON.stringify(sortKeys(shaped(media)));
      if (!distinct.has(key))
        distinct.set(
          key,
          media.get(media.has("application/json") ? "application/json" : first(media.keys())),
        );
    }
    return unionNames([...distinct.values()]) || "null";
  };
  for (const status of added) {
    const media = next.get(status)!;
    if (!media.size && bodies(old).length && !returnsNull(old)) {
      const how = old.has(status) ? "lost its body" : "has no body";
      counted(
        notes,
        at,
        "can now be null",
        `can now be null (success status ${status} ${how})`,
        `can now be null (status ${status} ${how})`,
      );
    } else if (old.has(status)) {
      continue; // a body that appeared or disappeared: said with the old side below
    } else if (media.size && !among(shaped(media), bodies(old))) {
      listed(notes, at, `status ${status} added with another body`);
    } else {
      listed(notes, at, `status ${status} added`);
    }
  }
  for (const status of removed) {
    const media = old.get(status)!;
    let change = "removed";
    if (next.has(status)) change = media.size ? "lost its body" : "now has a body";
    if (!media.size && bodies(next).length && !returnsNull(next)) {
      listed(notes, at, `is never null now (status ${status} ${change})`);
    } else if (media.size && !among(shaped(media), bodies(next))) {
      const from = types(old);
      const to = types(next);
      counted(
        notes,
        at,
        `type ${from} -> ${to}`,
        `changed type from ${spoken(from)} to ${spoken(to)} (success status ${status} ${change}, and no other success status returns its body)`,
        `type ${from} -> ${to} (status ${status} ${change}, and no other status returns its body)`,
      );
    } else {
      listed(notes, at, `status ${status} ${change}`);
    }
  }
}

const PARAMETER_PLACES = new Set(["query", "path", "header", "cookie"]);

/** The operation as a caller sees it: its references inlined, without tags and operationId. */
function observable(doc: JsonObject, op: JsonObject): Json {
  const { tags: _tags, operationId: _id, ...rest } = op;
  return shape(dereference(doc, rest, 0, false));
}

export interface OperationChange {
  /** Human-readable differences, the breaking ones first and marked "(breaking)". */
  notes: string[];
  /** The differences that can break typed code (DESIGN section 3.1). */
  breaking: Finding[];
  /**
   * No difference in parameters, body, success response or naming. The rest of the
   * operation (error responses, security...) can still differ: see `observable`.
   */
  docsOnly: boolean;
}

/** Human-readable differences of one operation, and which of them can break typed code. */
export function describeChange(
  oldDoc: JsonObject,
  old: JsonObject,
  newDoc: JsonObject,
  next: JsonObject,
): OperationChange {
  const found: Note[] = [];
  const params = (doc: JsonObject, op: JsonObject): Map<string, JsonObject> => {
    const out = new Map<string, JsonObject>();
    for (const p of asArray(dereference(doc, op.parameters ?? [], 0, false))) {
      if (isObject(p)) out.set(`${String(p.name)} (${String(p.in)})`, p);
    }
    return out;
  };
  const parameterAt = (p: JsonObject, key: string): At => ({
    label: `parameter ${key}`,
    request: true,
    in: (PARAMETER_PLACES.has(String(p.in)) ? p.in : "query") as At["in"],
    field: String(p.name),
  });
  const oldParams = params(oldDoc, old);
  const newParams = params(newDoc, next);
  for (const key of [...oldParams.keys()].filter((k) => !newParams.has(k)).sort()) {
    found.push({
      text: `parameter removed: ${key}`,
      breaking: {
        ...finding(parameterAt(oldParams.get(key)!, key)),
        kind: "removed",
        says: "was removed",
      },
    });
  }
  for (const key of [...newParams.keys()].filter((k) => !oldParams.has(k)).sort()) {
    const p = newParams.get(key)!;
    const note: Note = { text: `parameter added: ${key}` };
    if (p.required === true) {
      note.text += ", required";
      note.breaking = {
        ...finding(parameterAt(p, key)),
        kind: "now required",
        says: "was added and is required",
      };
    }
    found.push(note);
  }
  for (const key of [...oldParams.keys()].filter((k) => newParams.has(k)).sort()) {
    const a = oldParams.get(key)!;
    const b = newParams.get(key)!;
    const at = parameterAt(b, key);
    if (a.required !== true && b.required === true)
      found.push({
        text: `parameter now required: ${key}`,
        breaking: { ...finding(at), kind: "now required", says: "is now required" },
      });
    if (a.required === true && b.required !== true)
      found.push({ text: `parameter now optional: ${key}` });
    diffSchema(a.schema ?? {}, b.schema ?? {}, at, found);
  }
  const bodyAt: At = { label: "body", request: true, in: "request", field: "" };
  const required = (doc: JsonObject, op: JsonObject): boolean => {
    const body = dereference(doc, op.requestBody ?? {});
    return isObject(body) && body.required === true;
  };
  if (!required(oldDoc, old) && required(newDoc, next)) {
    found.push({
      text: "request body now required",
      breaking: { ...finding(bodyAt), kind: "body now required", says: "is now required" },
    });
  } else if (required(oldDoc, old) && !required(newDoc, next)) {
    found.push({ text: "request body now optional" });
  }
  diffContent(content(oldDoc, old.requestBody), content(newDoc, next.requestBody), bodyAt, found);
  // Every 2xx response both have, with a body on both sides or on neither; when the
  // only success status changed (200 to 201), the old body against the new one. The
  // other statuses, and a body that appeared or disappeared, change what the method
  // returns (diffStatuses). The same change in several responses is listed once (see sync).
  const or = successes(oldDoc, old);
  const nr = successes(newDoc, next);
  const hasBody = (media: Map<string, Json> | undefined): boolean => Boolean(media?.size);
  let pairs: [string, string][] = [...or.keys()]
    .filter((code) => nr.has(code) && hasBody(or.get(code)) === hasBody(nr.get(code)))
    .map((code) => [code, code]);
  if (
    !pairs.length &&
    or.size === 1 &&
    nr.size === 1 &&
    hasBody([...or.values()][0]) === hasBody([...nr.values()][0])
  ) {
    pairs = [[[...or.keys()][0]!, [...nr.keys()][0]!]];
    found.push({ text: `success status ${pairs[0]![0]} -> ${pairs[0]![1]}` });
  } else {
    const compared = new Set(pairs.map(([code]) => code));
    diffStatuses(
      or,
      nr,
      [...or.keys()].filter((c) => !compared.has(c)),
      [...nr.keys()].filter((c) => !compared.has(c)),
      found,
    );
  }
  for (const [oldCode, newCode] of pairs) {
    const label = pairs.length > 1 ? `response ${newCode}` : "response";
    diffContent(
      or.get(oldCode)!,
      nr.get(newCode)!,
      { label, request: false, in: "response", field: "" },
      found,
    );
  }
  if (old.deprecated !== true && next.deprecated === true)
    found.push({ text: "marked deprecated upstream" });
  if (!same(old["x-didit-sdk"], next["x-didit-sdk"]) && next["x-didit-sdk"] !== undefined) {
    found.push({ text: `x-didit-sdk now ${JSON.stringify(sortKeys(next["x-didit-sdk"]))}` });
  }
  if (!found.length) return { notes: [DOCS_ONLY], breaking: [], docsOnly: true };
  const ordered = [...found.filter((n) => n.breaking), ...found.filter((n) => !n.breaking)];
  let notes = [...new Set(ordered.map((n) => (n.breaking ? `${n.text} (breaking)` : n.text)))];
  if (notes.length > MAX_NOTES)
    notes = [...notes.slice(0, MAX_NOTES), `and ${notes.length - MAX_NOTES} more differences`];
  return {
    notes,
    breaking: found.flatMap((n) => (n.breaking ? [n.breaking] : [])),
    docsOnly: false,
  };
}

function finding(at: At): Pick<Finding, "in" | "field"> {
  return { in: at.in, field: at.field };
}

/** The sentence for one change that can break typed code. */
function sentence(operation: string, f: Finding): string {
  let subject: string;
  if (f.in === "operation") subject = "";
  else if (f.in === "request")
    subject = f.field ? `request field \`${f.field}\`` : "the request body";
  else if (f.in === "response")
    subject = f.field ? `response field \`${f.field}\`` : "the response";
  else subject = `${f.in} parameter \`${f.field}\``;
  return `\`${operation}\` ${subject ? `${subject} ` : ""}${f.says}`;
}

function breakingChange(operation: string, f: Finding): BreakingChange {
  return { operation, in: f.in, field: f.field, kind: f.kind, text: sentence(operation, f) };
}

/** Kinds of the operation itself, normalized without `<where> <field>`. */
const OPERATION_KINDS = new Set(["operation removed", "body now required"]);
const WHERE: Record<BreakingPlace, string> = {
  operation: "",
  request: "request body",
  response: "response",
  query: "query",
  path: "path",
  header: "header",
  cookie: "cookie",
};

/**
 * The line `openapi/breaking-vectors.json` compares in all seven SDKs:
 * `<METHOD> <path> <where> <field>: <kind>`, without `<field>` for a whole body and
 * without `<where> <field>` for the operation itself.
 */
export function normalized(change: BreakingChange): string {
  if (change.in === "operation" || OPERATION_KINDS.has(change.kind))
    return `${change.operation}: ${change.kind}`;
  const target = [WHERE[change.in], change.field].filter(Boolean).join(" ");
  return `${change.operation} ${target}: ${change.kind}`;
}

/** The pull request title and the sync's commit message (DESIGN section 3.1). */
export function syncTitle(type: SyncType, date: string): string {
  return `${type}(spec): sync API spec ${date}`;
}

/**
 * The sync commit's message: its title, then one nested `api(spec)` commit per change
 * that can break typed code, every one of them (DESIGN section 3.1: no cap), which
 * release-please-config.json lists under RELEASE_NOTES_HEADING. Never `!` and never
 * a `BREAKING CHANGE:` footer (DESIGN section 13).
 */
export function commitMessage(
  type: SyncType,
  breaking: readonly BreakingChange[],
  date: string,
): string {
  const nested = type === "feat" ? breaking.map((change) => nestedCommit(change.text)) : [];
  return [syncTitle(type, date), ...(nested.length ? ["", ...nested] : [])].join("\n") + "\n";
}

function nestedCommit(text: string): string {
  return `BEGIN_NESTED_COMMIT\n${BREAKING_TYPE}(spec): ${text}\nEND_NESTED_COMMIT`;
}

/**
 * The "Release" section the workflow appends to the pull request body: a
 * BEGIN_COMMIT_OVERRIDE block with the commit message, which release-please reads
 * instead of the commits, so a squash merge with any title still releases the sync as
 * `feat(spec)`, a minor version, with every change that can break typed code under
 * RELEASE_NOTES_HEADING. Empty for `chore`, which releases nothing on its own. A block
 * longer than `max` characters does not fit the description: then the section says
 * so and release-please reads the merged commit, whose message (the sync commit's,
 * commitMessage) carries every line.
 */
export function releaseSection(
  type: SyncType,
  breaking: readonly BreakingChange[],
  date: string,
  max = MAX_RELEASE,
): string {
  if (type !== "feat") return "";
  const intro = ["", "## Release", ""];
  const block = [
    ...intro,
    `release-please reads the block below instead of the commits of this pull request, so the release is a minor version${
      breaking.length
        ? `, and its notes list each change that can break typed code under "${RELEASE_NOTES_HEADING}"`
        : ""
    } (docs/DESIGN.md section 13). Keep the block when you edit this description, and merge with "Squash and merge": after a merge commit, release-please reads the block for both commits and lists every line twice.`,
    "",
    "BEGIN_COMMIT_OVERRIDE",
    commitMessage(type, breaking, date).trimEnd(),
    "END_COMMIT_OVERRIDE",
    "",
  ].join("\n");
  if (block.length <= max) return block;
  return [
    ...intro,
    `The ${breaking.length} changes that can break typed code do not fit this description, so it has no commit override block and release-please reads the merged commit instead. Merge with "Squash and merge" and keep the message of this branch's sync commit as the commit message: its first line releases a minor version, and it lists every change as its own \`${BREAKING_TYPE}(spec)\` nested commit under "${RELEASE_NOTES_HEADING}" (docs/DESIGN.md section 13).`,
    "",
  ].join("\n");
}

/**
 * `summary` cut at a line to at most `max` characters, with a note that says so and
 * where the full text is.
 */
export function boundSummary(summary: string, max: number, fullAt: string): string {
  if (summary.length <= max) return summary;
  const note = `\n**The summary is cut here: it has ${summary.length} characters, more than fit. The full summary is in ${fullAt}.**\n`;
  const room = Math.max(0, max - note.length - 1);
  const cut = summary.lastIndexOf("\n", room);
  return `${summary.slice(0, cut > 0 ? cut : room)}\n${note}`;
}

/** The minor version after `version`. */
export function nextMinor(version: string): string {
  const match = /^(\d+)\.(\d+)/.exec(version);
  if (!match) return "0.1.0";
  return `${match[1]}.${Number(match[2]) + 1}.0`;
}

/**
 * The version in which a method deprecated while the package is at `version`
 * is deleted: two minors on. The sync pull request is a `feat`, so the first
 * release that ships the deprecation is at most the next minor, and the method
 * then stays deprecated for at least one minor version (DESIGN section 3.1).
 */
export function removalVersion(version: string): string {
  return nextMinor(nextMinor(version));
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

/**
 * The conventional commit type of the sync (DESIGN section 3.1): `feat` when it adds
 * or changes anything a caller can observe, a minor version even when it can break
 * typed code; `chore` when only documentation changed, which releases nothing.
 */
export type SyncType = "feat" | "chore";

export interface SyncResult {
  changed: boolean;
  type: SyncType;
  /** The changes that can break typed code, sorted by operation and field. */
  breaking: BreakingChange[];
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
    return {
      changed: false,
      type: "chore",
      breaking: [],
      summary: "No upstream change.\n",
      writes: new Map(),
    };
  }

  const removeIn = removalVersion(input.version);
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
  // Naming carried over to an operation that moved to another path (see below).
  const carried = new Map<string, { from: string; naming: Json }>();
  const oldNaming = (key: string): Naming | undefined =>
    naming(oldOps.get(key)![1]["x-didit-sdk"] ?? oldOverlay[key]);
  const newNaming = (key: string): Naming | undefined =>
    naming(newOps.get(key)![1]["x-didit-sdk"] ?? oldOverlay[key] ?? carried.get(key)?.naming);
  // Only server operations become SDK methods; the rest cannot change the release.
  const exposed = (n: Naming | undefined): boolean => n?.server !== false;
  // Operations of the hand-written authentication module: never generated or deprecated.
  const handWritten = (ops: Map<string, [string, JsonObject]>, key: string): boolean =>
    HAND_WRITTEN.has(ops.get(key)![0]);
  const follow =
    "the hand-written `authentication` module must follow (its contract test fails until it does)";

  const added = [...newOps.keys()].filter((k) => !oldOps.has(k)).sort();
  const removed = [...oldOps.keys()].filter((k) => !newOps.has(k)).sort();
  const common = [...oldOps.keys()].filter((k) => newOps.has(k)).sort();

  // An added operation without naming that has the operationId of a removed one in
  // the same document is that operation on another path: its naming moves with it,
  // so the method keeps its name and the overlay needs no hand edit.
  const removedById = new Map<string, string>();
  for (const key of removed) {
    const [docName, op] = oldOps.get(key)!;
    if (typeof op.operationId === "string" && op.operationId)
      removedById.set(`${docName} ${op.operationId}`, key);
  }
  for (const key of added) {
    const [docName, op] = newOps.get(key)!;
    if (HAND_WRITTEN.has(docName)) continue;
    if (op["x-didit-sdk"] !== undefined || oldOverlay[key] !== undefined) continue;
    const id = op.operationId;
    const from = typeof id === "string" ? removedById.get(`${docName} ${id}`) : undefined;
    if (from === undefined || !oldNaming(from)) continue;
    const value = oldOps.get(from)![1]["x-didit-sdk"] ?? oldOverlay[from];
    carried.set(key, { from, naming: value });
    overlayOps[key] = value;
  }
  // The generated server methods by name.
  const newServerNames = new Map<string, string>();
  for (const key of newOps.keys()) {
    const n = newNaming(key);
    if (n?.server && !handWritten(newOps, key)) newServerNames.set(nameOf(n), key);
  }
  const oldServerNames = new Map<string, string>();
  for (const key of oldOps.keys()) {
    const n = oldNaming(key);
    if (n?.server && !handWritten(oldOps, key)) oldServerNames.set(nameOf(n), key);
  }

  const lines: string[] = [
    `Spec sync ${today}. Upstream files changed: ${changedFiles.join(", ")}.`,
    "",
  ];
  const breaking: BreakingChange[] = [];
  // Kept as deprecated methods: not breaking until removeIn.
  const deprecations: string[] = [];
  // Anything that changes the generated methods or types.
  let feature = false;
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

  // An added or removed operation is observable even when server SDKs do not expose it.
  if (added.length || removed.length) feature = true;
  lines.push(`## Added operations (${added.length})`);
  for (const key of added) {
    const n = newNaming(key);
    const from = carried.get(key)?.from;
    const moved = from
      ? ` (moved from \`${from}\`, same operationId; its overlay naming moved with it)`
      : "";
    if (!n)
      lines.push(
        `- \`${key}\`: **no SDK naming**; add an entry to \`openapi/overlay.json\` (DESIGN section 4)`,
      );
    else if (n.server && handWritten(newOps, key))
      lines.push(`- \`${key}\` -> \`${nameOf(n)}\`: ${follow}`);
    else if (n.server) lines.push(`- \`${key}\` -> \`${nameOf(n)}\`${moved}`);
    else lines.push(`- \`${key}\` (not exposed by server SDKs: ${n.auth ?? "-"})${moved}`);
  }
  lines.push("");

  lines.push(`## Removed operations (${removed.length})`);
  for (const key of removed) {
    const n = oldNaming(key);
    if (!n) lines.push(`- \`${key}\``);
    else if (!n.server) lines.push(`- \`${key}\` (not exposed by server SDKs)`);
    else if (handWritten(oldOps, key)) {
      lines.push(`- \`${key}\` (\`${nameOf(n)}\`): ${follow}`);
      breaking.push(
        breakingChange(key, {
          in: "operation",
          field: "",
          kind: "operation removed",
          says: "was removed",
        }),
      );
    } else if (newServerNames.has(nameOf(n))) {
      lines.push(
        `- \`${key}\` moved to \`${newServerNames.get(nameOf(n))!}\`; \`${nameOf(n)}\` keeps its name`,
      );
    } else {
      deprecations.push(
        `\`${nameOf(n)}\` was removed upstream (${key}); kept as a deprecated method until version ${removeIn}`,
      );
      lines.push(
        `- \`${key}\` (\`${nameOf(n)}\`): kept as a deprecated method until version ${removeIn}, recorded in \`openapi/deprecated-operations.json\``,
      );
      breaking.push(
        breakingChange(key, {
          in: "operation",
          field: "",
          kind: "operation removed",
          says: `was removed (\`${nameOf(n)}\` stays as a deprecated method until version ${removeIn})`,
        }),
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
    if (handWritten(newOps, key)) {
      const now = after
        ? `${nameOf(after)}${after.server ? "" : " (not a server operation)"}`
        : "unnamed";
      renames.push(`- \`${key}\`: \`${nameOf(before)}\` is now \`${now}\` upstream; ${follow}`);
      continue;
    }
    if (newServerNames.has(nameOf(before))) continue; // another operation provides the name now
    if (!after) {
      // The generator fails until the operation is named again, so this cannot ship silently.
      renames.push(
        `- \`${key}\` lost its SDK naming: add \`${nameOf(before)}\` back to \`openapi/overlay.json\` (the generator fails until it is named)`,
      );
    } else if (!after.server) {
      renames.push(
        `- \`${key}\` (\`${nameOf(before)}\`) is no longer a server operation (auth ${after.auth ?? "-"}); kept as a deprecated method until version ${removeIn}`,
      );
      deprecations.push(
        `\`${nameOf(before)}\` (${key}) now needs ${after.auth ?? "-"}, which server SDKs do not expose; kept as a deprecated method until version ${removeIn}`,
      );
      // Its method goes from server SDKs, as for a removed operation (DESIGN section 3.1).
      breaking.push(
        breakingChange(key, {
          in: "operation",
          field: "",
          kind: "operation removed",
          says: `is no longer a server operation: it now needs ${after.auth ?? "-"} (\`${nameOf(before)}\` stays as a deprecated method until version ${removeIn})`,
        }),
      );
      keep(before, key, "removed");
    } else {
      renames.push(
        `- \`${key}\`: \`${nameOf(before)}\` renamed to \`${nameOf(after)}\`; the old name stays as a deprecated alias until version ${removeIn}`,
      );
      deprecations.push(
        `\`${nameOf(before)}\` was renamed upstream to \`${nameOf(after)}\` (${key}); the old name is a deprecated alias until version ${removeIn}`,
      );
      keep(before, key, "renamed", nameOf(after));
    }
  }
  if (renames.length) feature = true;
  lines.push(`## Renamed methods (${renames.length})`, ...renames, "");

  const moves: string[] = [];
  for (const method of [...oldServerNames.keys()].filter((m) => newServerNames.has(m)).sort()) {
    const oldKey = oldServerNames.get(method)!;
    const newKey = newServerNames.get(method)!;
    if (oldKey === newKey) continue;
    const [oldName, old] = oldOps.get(oldKey)!;
    const [newName, next] = newOps.get(newKey)!;
    const change = describeChange(oldDocs.get(oldName)!, old, newDocs.get(newName)!, next);
    const isBreaking = change.breaking.length > 0;
    const notes = change.docsOnly ? ["same parameters, body and response"] : change.notes;
    const detail = notes.join("; ");
    const marker = isBreaking ? " **(breaking)**" : "";
    // The method's types now follow the new operation: report what can break them there.
    for (const f of change.breaking) breaking.push(breakingChange(newKey, f));
    if (newOps.has(oldKey)) {
      moves.push(
        `- \`${method}\`${marker} now calls \`${newKey}\` instead of \`${oldKey}\` (which is still in the API): ${detail}`,
      );
    } else {
      moves.push(`- \`${method}\`${marker} moved from \`${oldKey}\` to \`${newKey}\`: ${detail}`);
    }
  }
  if (moves.length) feature = true;
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
  // Compared once per document: components can be megabytes.
  const sameComponents = new Map<string, boolean>();
  for (const name of input.downloads.keys())
    sameComponents.set(name, same(oldDocs.get(name)!.components, newDocs.get(name)!.components));
  for (const key of common) {
    const [oldName, oldOp] = oldOps.get(key)!;
    const [newName, newOp] = newOps.get(key)!;
    const before = oldNaming(key);
    const after = newNaming(key);
    // Upstream taking over the overlay's naming as it is changes nothing in the SDK.
    const sameNaming = same(before ?? null, after ?? null);
    const old = sameNaming ? withoutNaming(oldOp) : oldOp;
    const next = sameNaming ? withoutNaming(newOp) : newOp;
    const sameOp = same(old, next);
    const oldDoc = oldDocs.get(oldName)!;
    const newDoc = newDocs.get(newName)!;
    if (sameOp && oldName === newName && sameComponents.get(oldName)) continue;
    const described = describeChange(oldDoc, old, newDoc, next);
    let { notes } = described;
    // Operations with server: false on either side are listed and never counted
    // (DESIGN section 3.1): no server SDK method calls them, before or after.
    const hidden = !exposed(before) || !exposed(after);
    let docsOnly = described.docsOnly;
    // Error responses, security and the like are not documentation either, also when
    // only a component they reference (a response, a parameter...) changed.
    if (docsOnly && !same(observable(oldDoc, old), observable(newDoc, next))) {
      notes = ["other request or response details changed"];
      docsOnly = false;
    }
    // A method that keeps its name but changes scope or credentials takes other
    // arguments or needs another client option.
    if (before?.server && after?.server && nameOf(before) === nameOf(after)) {
      for (const field of ["scope", "auth"] as const) {
        const was = (before as unknown as JsonObject)[field] ?? null;
        const now = (after as unknown as JsonObject)[field] ?? null;
        if (was !== now) {
          notes = [
            `x-didit-sdk ${field} ${JSON.stringify(was)} -> ${JSON.stringify(now)}`,
            ...notes,
          ];
          docsOnly = false;
        }
      }
    }
    if (docsOnly) notes = [DOCS_ONLY];
    // An unchanged operation whose components changed only in what documents them: the
    // Schemas section lists them.
    if (sameOp && docsOnly) continue;
    if (!docsOnly) feature = true;
    if (hidden) {
      changes.push(
        `- \`${key}\` (not exposed by server SDKs): ${notes.map((n) => n.replace(/ \(breaking\)$/, "")).join("; ")}`,
      );
      continue;
    }
    const isBreaking = described.breaking.length > 0;
    changes.push(`- \`${key}\`${isBreaking ? " **(breaking)**" : ""}: ${notes.join("; ")}`);
    for (const f of described.breaking) breaking.push(breakingChange(key, f));
  }
  lines.push(`## Changed operations (${changes.length})`, ...changes, "");

  // Components a deprecated method still uses keep their types.
  const stillUsed = new Set<string>();
  for (const entry of Object.values(deprecatedMethods)) {
    if (isObject(entry.components))
      for (const name of Object.keys(entry.components)) stillUsed.add(name);
  }

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
    const keptSchemas = gone.filter((schema) => stillUsed.has(schema));
    const groups: [string, string[]][] = [
      [
        "added",
        Object.keys(newSchemas)
          .filter((k) => !(k in oldSchemas))
          .sort(),
      ],
      ["removed (its type leaves the SDK)", gone.filter((schema) => !stillUsed.has(schema))],
      ["removed upstream, type kept for the deprecated methods that use it", keptSchemas],
      [
        "changed",
        Object.keys(oldSchemas)
          .filter((k) => k in newSchemas && !same(shape(oldSchemas[k]), shape(newSchemas[k])))
          .sort(),
      ],
      [
        "descriptions or examples changed",
        Object.keys(oldSchemas)
          .filter(
            (k) =>
              k in newSchemas &&
              !same(oldSchemas[k], newSchemas[k]) &&
              same(shape(oldSchemas[k]), shape(newSchemas[k])),
          )
          .sort(),
      ],
    ];
    for (const [label, names] of groups) {
      if (!names.length) continue;
      if (label !== "descriptions or examples changed") feature = true;
      lines.push(`- ${name} ${label}: ${names.map((n) => `\`${n}\``).join(", ")}`);
    }
  }
  lines.push("");

  const dropped: string[] = [];
  const differing: string[] = [];
  for (const key of Object.keys(overlayOps)) {
    const entry = newOps.get(key);
    const upstream = entry?.[1]["x-didit-sdk"];
    if (upstream === undefined) continue;
    if (!same(upstream, overlayOps[key]))
      differing.push(`- \`${key}\`: upstream x-didit-sdk differs from the overlay; upstream wins.`);
    dropped.push(key);
    Reflect.deleteProperty(overlayOps, key);
  }
  if (dropped.length) {
    lines.push(
      "## Overlay",
      ...differing,
      `Dropped ${dropped.length} overlay entries that upstream now carries.`,
      "",
    );
  }

  // One entry per change (several success responses can share one), sorted by operation,
  // field and kind, so every repository lists the same.
  const order = (b: BreakingChange): string[] => [b.operation, b.field, b.kind, b.in];
  const listed = new Map<string, BreakingChange>();
  for (const b of breaking) listed.set(JSON.stringify([...order(b), b.text]), b);
  const breakingChanges = [...listed.values()].sort((x, y) => {
    const a = order(x);
    const b = order(y);
    const i = a.findIndex((part, index) => part !== b[index]);
    return i < 0 ? 0 : a[i]! < b[i]! ? -1 : 1;
  });
  lines.unshift(
    "## Breaking changes",
    breakingChanges.length
      ? breakingChanges.map((b) => `- ${b.text}`).join("\n")
      : "None detected.",
    "",
    "## Deprecated methods",
    deprecations.length ? deprecations.map((d) => `- ${d}`).join("\n") : "None.",
    "",
  );
  const type: SyncType = breakingChanges.length || feature ? "feat" : "chore";

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
    type,
    breaking: breakingChanges,
    summary: `${lines.join("\n").trimEnd()}\n`,
    writes,
  };
}

/** `op` without its `x-didit-sdk`, for comparing operations whose naming did not change. */
function withoutNaming(op: JsonObject): JsonObject {
  const { "x-didit-sdk": _naming, ...rest } = op;
  return rest;
}
