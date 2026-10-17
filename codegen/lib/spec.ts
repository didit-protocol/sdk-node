// Load openapi/ and merge the x-didit-sdk naming layer (docs/DESIGN.md sections 3 and 4).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type Json = unknown;
export type JsonObject = Record<string, unknown>;

export const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "head"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];
const AUTH_VALUES = new Set(["api_key", "account_token", "none", "device_token", "public"]);
const SDK_KEYS = new Set(["resource", "method", "auth", "server", "scope"]);
export const APPLICATION_PREFIX = "/v3/organization/{organization_id}/application/{application_id}/";
const SNAKE = /^[a-z][a-z0-9_]*$/;

/** The OpenAPI documents or the overlay cannot be turned into the SDK. */
export class CodegenError extends Error {
  override name = "CodegenError";
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type Auth = "api_key" | "account_token" | "none" | "device_token" | "public";

export interface SdkNaming {
  resource: string;
  method: string;
  auth: Auth;
  server: boolean;
  scope?: "application";
}

export function parseNaming(where: string, raw: unknown): SdkNaming {
  if (!isObject(raw)) throw new CodegenError(`${where}: x-didit-sdk must be an object.`);
  const unknown = Object.keys(raw).filter((k) => !SDK_KEYS.has(k));
  if (unknown.length) {
    throw new CodegenError(`${where}: unknown x-didit-sdk keys ${JSON.stringify(unknown.sort())}.`);
  }
  for (const key of ["resource", "method", "auth", "server"]) {
    if (!(key in raw)) throw new CodegenError(`${where}: x-didit-sdk is missing "${key}".`);
  }
  const { resource, method, auth, server, scope } = raw;
  if (typeof resource !== "string" || !resource.split(".").every((s) => SNAKE.test(s))) {
    throw new CodegenError(
      `${where}: resource ${JSON.stringify(resource)} must be a dot path of snake_case names.`,
    );
  }
  if (typeof method !== "string" || !SNAKE.test(method)) {
    throw new CodegenError(`${where}: method ${JSON.stringify(method)} must be a snake_case name.`);
  }
  if (typeof auth !== "string" || !AUTH_VALUES.has(auth)) {
    throw new CodegenError(
      `${where}: auth ${JSON.stringify(auth)} must be one of ${[...AUTH_VALUES].sort().join(", ")}.`,
    );
  }
  if (typeof server !== "boolean") throw new CodegenError(`${where}: server must be true or false.`);
  if (scope !== undefined && scope !== "application") {
    throw new CodegenError(`${where}: scope must be "application" when present.`);
  }
  const out: SdkNaming = { resource, method, auth: auth as Auth, server };
  if (scope === "application") out.scope = "application";
  return out;
}

/** One OpenAPI document: `verification` or `account`. */
export class Spec {
  readonly name: "verification" | "account";
  readonly doc: JsonObject;

  constructor(name: "verification" | "account", doc: JsonObject) {
    this.name = name;
    this.doc = doc;
  }

  pointer(ref: string): Json {
    if (!ref.startsWith("#/")) {
      throw new CodegenError(`${this.name}: only local $refs are supported, got ${ref}.`);
    }
    let cur: Json = this.doc;
    for (const raw of ref.slice(2).split("/")) {
      const part = raw.replace(/~1/g, "/").replace(/~0/g, "~");
      if (!isObject(cur) && !Array.isArray(cur)) {
        throw new CodegenError(`${this.name}: unresolvable $ref ${ref}.`);
      }
      cur = (cur as Record<string, Json>)[part];
      if (cur === undefined) throw new CodegenError(`${this.name}: unresolvable $ref ${ref}.`);
    }
    return cur;
  }

  /** Follow `$ref`s until a node without one. */
  resolve(node: Json): Json {
    const seen = new Set<string>();
    let cur = node;
    while (isObject(cur) && typeof cur.$ref === "string") {
      const ref = cur.$ref;
      if (seen.has(ref)) throw new CodegenError(`${this.name}: circular $ref ${ref}.`);
      seen.add(ref);
      cur = this.pointer(ref);
    }
    return cur;
  }

  resolveObject(node: Json): JsonObject {
    const out = this.resolve(node);
    return isObject(out) ? out : {};
  }

  get components(): Record<string, JsonObject> {
    const components = this.doc.components;
    const schemas = isObject(components) ? components.schemas : undefined;
    return isObject(schemas) ? (schemas as Record<string, JsonObject>) : {};
  }
}

export interface Operation {
  /** `POST /v3/session/`, or `account POST /programmatic/login/`. */
  key: string;
  api: "verification" | "account";
  httpMethod: HttpMethod;
  path: string;
  op: JsonObject;
  spec: Spec;
  sdk: SdkNaming;
  deprecated: boolean;
  deprecationNote?: string;
  parameters: JsonObject[];
}

export interface DeprecatedEntry {
  "x-didit-sdk": unknown;
  operation_key: string;
  reason: "removed" | "renamed";
  replacement?: string;
  deprecated_since?: string;
  remove_in?: string;
  note?: string;
  operation: JsonObject;
  components?: Record<string, JsonObject>;
}

export interface Model {
  specs: { verification: Spec; account: Spec };
  operations: Operation[];
  overlay: Record<string, unknown>;
}

export function operationKey(api: string, method: string, path: string): string {
  return `${api === "account" ? "account " : ""}${method.toUpperCase()} ${path}`;
}

function readJson(path: string): JsonObject {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isObject(value)) throw new CodegenError(`${path} must hold a JSON object.`);
  return value;
}

function mergeParameters(spec: Spec, shared: unknown, own: unknown): JsonObject[] {
  const out = new Map<string, JsonObject>();
  for (const raw of [...(Array.isArray(shared) ? shared : []), ...(Array.isArray(own) ? own : [])]) {
    const param = spec.resolveObject(raw);
    out.set(`${String(param.in)}:${String(param.name)}`, param);
  }
  return [...out.values()];
}

/** Read openapi/ and return every operation with its SDK naming. */
export function load(openapiDir: string): Model {
  const specs = {
    verification: new Spec("verification", readJson(join(openapiDir, "verification.json"))),
    account: new Spec("account", readJson(join(openapiDir, "account.json"))),
  };
  const overlayDoc = readJson(join(openapiDir, "overlay.json"));
  const overlay = isObject(overlayDoc.operations) ? overlayDoc.operations : {};
  const deprecatedPath = join(openapiDir, "deprecated-operations.json");
  let deprecated: Record<string, DeprecatedEntry> = {};
  if (existsSync(deprecatedPath)) {
    const doc = readJson(deprecatedPath);
    deprecated = (isObject(doc.methods) ? doc.methods : {}) as Record<string, DeprecatedEntry>;
  }

  const operations: Operation[] = [];
  const seenKeys = new Set<string>();
  const missing: string[] = [];
  for (const spec of [specs.verification, specs.account]) {
    const paths = isObject(spec.doc.paths) ? spec.doc.paths : {};
    for (const [path, rawItem] of Object.entries(paths)) {
      const item = spec.resolveObject(rawItem);
      for (const method of HTTP_METHODS) {
        const op = item[method];
        if (!isObject(op)) continue;
        const key = operationKey(spec.name, method, path);
        seenKeys.add(key);
        const raw = op["x-didit-sdk"] ?? overlay[key];
        if (raw === undefined) {
          missing.push(`${key} (operationId ${typeof op.operationId === "string" ? op.operationId : "-"})`);
          continue;
        }
        operations.push({
          key,
          api: spec.name,
          httpMethod: method,
          path,
          op,
          spec,
          sdk: parseNaming(key, raw),
          deprecated: op.deprecated === true,
          parameters: mergeParameters(spec, item.parameters, op.parameters),
        });
      }
    }
  }
  if (missing.length) {
    throw new CodegenError(
      "These operations have no SDK naming (x-didit-sdk). Add an entry to openapi/overlay.json " +
        "(or ask for x-didit-sdk upstream) with resource, method, auth and server; see " +
        `docs/DESIGN.md section 4:\n  ${missing.join("\n  ")}`,
    );
  }
  const stale = Object.keys(overlay)
    .filter((k) => !seenKeys.has(k))
    .sort();
  if (stale.length) {
    throw new CodegenError(
      "openapi/overlay.json names operations that no longer exist upstream. Run " +
        "`pnpm spec-sync`, which records removed operations in openapi/deprecated-operations.json, " +
        `or delete the entries:\n  ${stale.join("\n  ")}`,
    );
  }
  operations.push(...deprecatedOperations(deprecated, operations));
  checkUnique(operations);
  for (const operation of operations) {
    if (operation.sdk.scope === "application" && !operation.path.startsWith(APPLICATION_PREFIX)) {
      throw new CodegenError(
        `${operation.key}: scope application needs a path under ${APPLICATION_PREFIX}.`,
      );
    }
  }
  return { specs, operations, overlay };
}

/**
 * The methods openapi/deprecated-operations.json keeps for one more minor
 * version: operations removed upstream and the old names of renamed ones. Each
 * entry carries its operation with the component schemas it uses, so its types
 * keep their names and nothing depends on the current documents.
 */
function deprecatedOperations(
  deprecated: Record<string, DeprecatedEntry>,
  live: Operation[],
): Operation[] {
  const liveNames = new Map<string, string>();
  for (const op of live) if (op.sdk.server) liveNames.set(`${op.sdk.resource}.${op.sdk.method}`, op.key);
  const out: Operation[] = [];
  for (const name of Object.keys(deprecated).sort()) {
    const entry = deprecated[name]!;
    const where = `openapi/deprecated-operations.json ${name}`;
    const sdk = parseNaming(where, entry["x-didit-sdk"]);
    if (`${sdk.resource}.${sdk.method}` !== name) {
      throw new CodegenError(`${where}: the entry name must equal its resource.method.`);
    }
    const provider = liveNames.get(name);
    if (provider !== undefined) {
      throw new CodegenError(
        `${where}: ${provider} provides ${name} again, so it is no longer deprecated; ` +
          "delete this entry from openapi/deprecated-operations.json.",
      );
    }
    const key = String(entry.operation_key);
    const api = key.startsWith("account ") ? "account" : "verification";
    const [method = "", path = ""] = key.replace(/^account /, "").split(" ");
    const httpMethod = method.toLowerCase() as HttpMethod;
    if (!HTTP_METHODS.includes(httpMethod) || !path.startsWith("/")) {
      throw new CodegenError(`${where}: operation_key ${JSON.stringify(key)} is not "METHOD /path".`);
    }
    const note =
      entry.note ??
      (entry.replacement
        ? `Renamed to ${entry.replacement}; this name is removed in version ${entry.remove_in}.`
        : `Removed from the API contract; this method is removed in version ${entry.remove_in}.`);
    const spec = new Spec(api, {
      openapi: "3.0.0",
      paths: {},
      components: { schemas: entry.components ?? {} },
    });
    out.push({
      key,
      api,
      httpMethod,
      path,
      op: entry.operation,
      spec,
      sdk,
      deprecated: true,
      deprecationNote: note,
      parameters: mergeParameters(spec, [], entry.operation.parameters),
    });
  }
  return out;
}

function checkUnique(operations: Operation[]): void {
  const byName = new Map<string, string>();
  for (const op of operations) {
    if (!op.sdk.server) continue;
    const name = `${op.sdk.resource}.${op.sdk.method}`;
    const other = byName.get(name);
    if (other !== undefined) {
      throw new CodegenError(
        `${op.key} and ${other} both map to ${name}; give one of them another method name in openapi/overlay.json.`,
      );
    }
    byName.set(name, op.key);
  }
  const resources = new Set(operations.filter((o) => o.sdk.server).map((o) => o.sdk.resource));
  for (const op of operations) {
    if (!op.sdk.server) continue;
    const child = `${op.sdk.resource}.${op.sdk.method}`;
    if ([...resources].some((r) => r === child || r.startsWith(`${child}.`))) {
      throw new CodegenError(
        `${op.key}: method "${op.sdk.method}" clashes with the nested resource "${child}".`,
      );
    }
  }
}
