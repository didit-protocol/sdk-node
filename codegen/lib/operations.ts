// Turn each server operation into the description of one SDK method.

import { argName, camel, resourceClass, pascal } from "./naming.ts";
import {
  CodegenError,
  isObject,
  type Json,
  type JsonObject,
  type Operation,
  type Spec,
} from "./spec.ts";
import {
  description,
  nullable,
  union,
  type DatePlan,
  type TypeBuilder,
  type TypeRef,
} from "./types.ts";

const BINARY_TYPES = [
  "application/pdf",
  "text/csv",
  "image/",
  "application/octet-stream",
  "application/zip",
];

export interface PathArg {
  wire: string;
  name: string;
  description: string | undefined;
  example: Json;
}

export interface Field {
  /** The key in the params object; differs from `wire` only for a query parameter named like a body field. */
  key: string;
  wire: string;
  location: "query" | "body";
  required: boolean;
  schema: Json;
  example: Json;
  hasExample: boolean;
}

export type BodyMode = "none" | "json" | "multipart" | "auto";

export interface ResponseInfo {
  kind: "json" | "binary" | "none" | "page";
  type: TypeRef;
  item: TypeRef | undefined;
  accept: string;
  status: number;
  contentType: string | undefined;
  plan: DatePlan | null;
  example: Json;
  hasExample: boolean;
}

export interface Method {
  op: Operation;
  resource: string;
  /** camelCase method name. */
  name: string;
  /** Name of the constant holding the operation descriptor. */
  constName: string;
  module: string;
  pathArgs: PathArg[];
  fields: Field[];
  /** The params object type, or undefined when the method takes none. */
  params: TypeRef | undefined;
  paramsRequired: boolean;
  /** The params object is the request body itself (an array or a union body). */
  wholeBody: boolean;
  bodyMode: BodyMode;
  fileFields: string[];
  idempotencyKey: boolean;
  response: ResponseInfo;
  summary: string;
  description: string;
  bodyExample: Json;
  hasBodyExample: boolean;
}

function text(op: JsonObject, key: string): string {
  const value = op[key];
  return typeof value === "string" ? value.trim() : "";
}

function exampleOf(media: Json, schema: Json): { has: boolean; value: Json } {
  if (isObject(media)) {
    if ("example" in media) return { has: true, value: media.example };
    const examples = media.examples;
    if (isObject(examples)) {
      const first = Object.values(examples)[0];
      if (isObject(first) && "value" in first) return { has: true, value: first.value };
    }
  }
  if (isObject(schema) && "example" in schema) return { has: true, value: schema.example };
  return { has: false, value: undefined };
}

function binaryFields(spec: Spec, schema: Json): Set<string> {
  const out = new Set<string>();
  const root = spec.resolveObject(schema);
  const props = isObject(root.properties) ? root.properties : {};
  for (const [name, raw] of Object.entries(props)) {
    const prop = spec.resolveObject(raw);
    const items = spec.resolveObject(prop.items);
    if (prop.format === "binary" || (prop.type === "array" && items.format === "binary"))
      out.add(name);
  }
  return out;
}

/** The schema of the body fields, the body mode, the file fields and the media used for examples. */
function mergeBody(
  op: Operation,
  content: JsonObject,
): { schema: Json; mode: BodyMode; files: string[]; media: Json } {
  let json = content["application/json"];
  const multipart = content["multipart/form-data"];
  if (json === undefined && multipart === undefined) {
    const form = content["application/x-www-form-urlencoded"];
    if (form === undefined) {
      throw new CodegenError(
        `${op.key}: unsupported request content types ${Object.keys(content).join(", ")}.`,
      );
    }
    json = form;
  }
  const jsonMedia = isObject(json) ? json : undefined;
  const multipartMedia = isObject(multipart) ? multipart : undefined;
  if (jsonMedia && !multipartMedia)
    return { schema: jsonMedia.schema ?? {}, mode: "json", files: [], media: jsonMedia };
  if (!jsonMedia) {
    const schema = multipartMedia!.schema ?? {};
    return {
      schema,
      mode: "multipart",
      files: [...binaryFields(op.spec, schema)].sort(),
      media: multipartMedia,
    };
  }
  const jsonSchema = op.spec.resolveObject(jsonMedia.schema);
  const multipartSchema = op.spec.resolveObject(multipartMedia!.schema);
  const jsonProps = isObject(jsonSchema.properties) ? jsonSchema.properties : {};
  const files = [...binaryFields(op.spec, multipartSchema)].filter((f) => !(f in jsonProps));
  if (!files.length)
    return { schema: jsonMedia.schema ?? {}, mode: "json", files: [], media: jsonMedia };
  // Either encoding works: JSON without files, multipart once a file is set.
  const props: Record<string, Json> = { ...jsonProps };
  const multipartProps = isObject(multipartSchema.properties) ? multipartSchema.properties : {};
  for (const [name, prop] of Object.entries(multipartProps))
    if (!(name in props)) props[name] = prop;
  const multipartRequired = new Set(
    Array.isArray(multipartSchema.required) ? multipartSchema.required.map(String) : [],
  );
  const required = (
    Array.isArray(jsonSchema.required) ? jsonSchema.required.map(String) : []
  ).filter((r) => multipartRequired.has(r));
  const merged: JsonObject = { ...jsonSchema, properties: props, required };
  delete merged.$ref;
  return { schema: merged, mode: "auto", files: files.sort(), media: jsonMedia };
}

function pathNames(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);
}

export function buildMethod(op: Operation, builder: TypeBuilder): Method {
  const { sdk, spec } = op;
  const rc = resourceClass(sdk.resource) + pascal(sdk.method);
  const module = sdk.resource.split(".")[0]!;
  const used = new Set<string>(["params", "options", "body"]);

  const pathParams = new Map<string, JsonObject>();
  for (const p of op.parameters) if (p.in === "path") pathParams.set(String(p.name), p);
  const pathArgs: PathArg[] = [];
  for (const wire of pathNames(op.path)) {
    if (sdk.scope === "application" && (wire === "organization_id" || wire === "application_id"))
      continue;
    const param = pathParams.get(wire) ?? { name: wire, schema: { type: "string" } };
    const name = argName(wire, used);
    used.add(name);
    const schema = isObject(param.schema) ? param.schema : {};
    pathArgs.push({
      wire,
      name,
      description: description(param),
      example: param.example ?? schema.example,
    });
  }

  const fields: Field[] = [];
  let bodyMode: BodyMode = "none";
  let fileFields: string[] = [];
  let params: TypeRef | undefined;
  let paramsRequired = false;
  let wholeBody = false;
  let bodyExample: Json;
  let hasBodyExample = false;
  const paramsName = `${rc}Params`;

  const requestBody = op.op.requestBody ? spec.resolveObject(op.op.requestBody) : undefined;
  const queryParams = op.parameters.filter((p) => p.in === "query");
  let bodyProps: Record<string, Json> = {};
  let bodyRequired = new Set<string>();
  let bodySchema: JsonObject | undefined;
  if (requestBody) {
    const content = isObject(requestBody.content) ? requestBody.content : {};
    const merged = mergeBody(op, content);
    bodyMode = merged.mode;
    fileFields = merged.files;
    const root = spec.resolveObject(merged.schema);
    const ex = exampleOf(merged.media, root);
    hasBodyExample = ex.has;
    bodyExample = ex.value;
    const shape = builder.objectShape(spec, root);
    if (shape) {
      bodyProps = shape.props;
      bodyRequired = shape.required;
      bodySchema = { ...root, type: "object" };
    } else {
      wholeBody = true;
      if (queryParams.length) {
        throw new CodegenError(
          `${op.key}: a non-object request body together with query parameters is not supported.`,
        );
      }
      params = builder.type(spec, merged.schema, paramsName, module, "param");
      paramsRequired = requestBody.required === true;
    }
  }

  if (!wholeBody && (Object.keys(bodyProps).length || queryParams.length)) {
    // One params object: the body fields plus the query parameters.
    const props: Record<string, Json> = { ...bodyProps };
    const required = new Set(bodyRequired);
    for (const [wire, schema] of Object.entries(bodyProps)) {
      const resolved = spec.resolveObject(schema);
      if (resolved.readOnly === true) continue;
      const ex = exampleOf(undefined, resolved);
      fields.push({
        key: wire,
        wire,
        location: "body",
        required: bodyRequired.has(wire),
        schema,
        example: ex.value,
        hasExample: ex.has,
      });
    }
    for (const param of queryParams) {
      const wire = String(param.name);
      let key = wire;
      // A query parameter named like a body field takes a `_query` suffix (as in the Python SDK).
      while (key in props) key = `${key}_query`;
      const schema: JsonObject = { ...(isObject(param.schema) ? param.schema : {}) };
      const desc = description(param);
      if (desc) schema.description = desc;
      if (param.deprecated === true) schema.deprecated = true;
      props[key] = schema;
      if (param.required === true) required.add(key);
      const ex =
        "example" in param ? { has: true, value: param.example } : exampleOf(undefined, schema);
      fields.push({
        key,
        wire,
        location: "query",
        required: param.required === true,
        schema,
        example: ex.value,
        hasExample: ex.has,
      });
    }
    const combined: JsonObject = {
      type: "object",
      properties: props,
      required: [...required],
    };
    if (bodySchema?.description) combined.description = bodySchema.description;
    if (bodySchema && "additionalProperties" in bodySchema)
      combined.additionalProperties = bodySchema.additionalProperties;
    params = builder.type(spec, combined, paramsName, module, "param");
    paramsRequired = fields.some((f) => f.required);
  }

  const idempotencyKey = op.parameters.some(
    (p) => p.in === "header" && String(p.name).toLowerCase() === "idempotency-key",
  );

  const response = buildResponse(op, builder, rc, module);
  return {
    op,
    resource: sdk.resource,
    name: camel(sdk.method),
    constName: `${sdk.resource.replace(/\./g, "_")}_${sdk.method}`.toUpperCase(),
    module,
    pathArgs,
    fields,
    params,
    paramsRequired,
    wholeBody,
    bodyMode,
    fileFields,
    idempotencyKey,
    response,
    summary: text(op.op, "summary"),
    description: text(op.op, "description"),
    bodyExample,
    hasBodyExample,
  };
}

function buildResponse(
  op: Operation,
  builder: TypeBuilder,
  rc: string,
  module: string,
): ResponseInfo {
  const { spec } = op;
  const responses = isObject(op.op.responses) ? op.op.responses : {};
  const successes = Object.entries(responses)
    .filter(([code]) => code.startsWith("2"))
    .map(([code, raw]) => [Number(code), spec.resolveObject(raw)] as const)
    .sort((a, b) => a[0] - b[0]);
  const jsonResponses: [number, JsonObject][] = [];
  let binary: [number, string] | undefined;
  let empty = false;
  for (const [code, resp] of successes) {
    const content = isObject(resp.content) ? resp.content : {};
    const media = content["application/json"];
    if (isObject(media)) {
      jsonResponses.push([code, "schema" in media ? media : { ...media, schema: {} }]);
      continue;
    }
    const other = Object.keys(content).filter((ct) => BINARY_TYPES.some((b) => ct.startsWith(b)));
    if (other.length) binary = [code, other[0]!];
    else if (
      !Object.keys(content).length &&
      code !== 204 &&
      op.httpMethod !== "delete" &&
      op.httpMethod !== "head"
    ) {
      // A body is promised but not described: return the JSON as it comes.
      jsonResponses.push([code, { schema: {} }]);
    } else empty = true;
  }
  if (jsonResponses.length) {
    const types: TypeRef[] = [];
    const seen: [string, TypeRef][] = [];
    const plans: (DatePlan | null)[] = [];
    jsonResponses.forEach(([code, media], index) => {
      const schema = media.schema;
      const key = JSON.stringify(schema);
      const reuse = seen.find(([s]) => s === key);
      if (reuse) {
        types.push(reuse[1]);
        return;
      }
      const hint = `${rc}Response${index === 0 ? "" : String(code)}`;
      const type = builder.type(spec, schema, hint, module, "response");
      seen.push([key, type]);
      types.push(type);
      const plan = builder.datePlan(spec, schema);
      plans.push(plan);
      // Named response types get a named plan too, so hand-written code (webhook
      // events carry the session decision) can decode the same type.
      if (plan !== null && typeof plan !== "string" && builder.decls.has(type.expr)) {
        builder.plans.set(type.expr, plan);
      }
    });
    let type = types.length === 1 ? types[0]! : union(types);
    if (empty) type = nullable(type);
    const [status, media] = jsonResponses[0]!;
    const ex = exampleOf(media, spec.resolveObject(media.schema));
    const plan = plans.find((p) => p !== null) ?? null;
    const item = pageItem(op, builder, type);
    return {
      kind: item ? "page" : "json",
      type,
      item,
      accept: "application/json",
      status,
      contentType: "application/json",
      plan,
      example: ex.value,
      hasExample: ex.has,
    };
  }
  if (binary) {
    return {
      kind: "binary",
      type: { expr: "Blob", deps: new Set() },
      item: undefined,
      accept: binary[1],
      status: binary[0],
      contentType: binary[1],
      plan: null,
      example: undefined,
      hasExample: false,
    };
  }
  return {
    kind: "none",
    type: { expr: "void", deps: new Set() },
    item: undefined,
    accept: "application/json",
    status: successes[0]?.[0] ?? 204,
    contentType: undefined,
    plan: null,
    example: undefined,
    hasExample: false,
  };
}

/** The item type when the operation is a `{count, next, previous, results}` list (docs/DESIGN.md section 8). */
function pageItem(op: Operation, builder: TypeBuilder, type: TypeRef): TypeRef | undefined {
  if (op.httpMethod !== "get") return undefined;
  const decl = builder.decls.get(type.expr);
  if (decl?.kind !== "interface") return undefined;
  const names = new Set(decl.fields.map((f) => f.wire));
  if (!["count", "next", "previous", "results"].every((n) => names.has(n))) return undefined;
  const results = decl.fields.find((f) => f.wire === "results")!;
  const match = /^\((.*)\)\[\]$|^(.*)\[\]$/.exec(results.type.expr.replace(/ \| null$/, ""));
  if (!match) return undefined;
  return { expr: match[1] ?? match[2]!, deps: results.type.deps };
}

/** Components reachable from any response, as `spec:name`. */
export function responseComponents(operations: Operation[]): Set<string> {
  const out = new Set<string>();
  for (const op of operations) {
    const responses = isObject(op.op.responses) ? op.op.responses : {};
    const stack: Json[] = Object.entries(responses)
      .filter(([code]) => code.startsWith("2"))
      .map(([, r]) => r);
    while (stack.length) {
      const cur = stack.pop();
      if (Array.isArray(cur)) {
        stack.push(...(cur as Json[]));
        continue;
      }
      if (!isObject(cur)) continue;
      if (typeof cur.$ref === "string") {
        const name = cur.$ref.startsWith("#/components/schemas/") ? cur.$ref.slice(21) : undefined;
        const id = name ? `${op.spec.name}:${name}` : undefined;
        if (id && out.has(id)) continue;
        if (id) out.add(id);
        stack.push(op.spec.pointer(cur.$ref));
        continue;
      }
      for (const [k, v] of Object.entries(cur))
        if (k !== "example" && k !== "examples") stack.push(v);
    }
  }
  return out;
}
