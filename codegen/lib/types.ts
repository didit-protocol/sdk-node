// OpenAPI schemas to TypeScript types (docs/DESIGN.md section 5.1).
//
// Responses and request parameters get separate types when they differ: a
// response date-time is a `Date`, a parameter accepts `string | Date`; a binary
// parameter is an `Uploadable`; readOnly fields only appear in responses and
// writeOnly fields only in parameters. A `$ref` component keeps its component
// name (`SessionDecision`); its parameter variant, when it needs one, adds
// `Param`. Inline objects are named after their parent plus the property.

import { pascal, propKey } from "./naming.ts";
import { CodegenError, isObject, type Json, type JsonObject, type Spec } from "./spec.ts";

export type Mode = "response" | "param";

/** A type expression and the generated type names it uses. */
export interface TypeRef {
  expr: string;
  deps: ReadonlySet<string>;
}

export interface FieldDecl {
  wire: string;
  type: TypeRef;
  optional: boolean;
  description: string | undefined;
  deprecated: boolean;
}

export interface Decl {
  name: string;
  module: string;
  mode: Mode;
  description: string | undefined;
  kind: "interface" | "alias";
  fields: FieldDecl[];
  /** `[key: string]: <type>` on an interface, for objects that allow extra keys. */
  index: TypeRef | undefined;
  alias: TypeRef | undefined;
}

/**
 * How to turn the date-time strings of a response into `Date` objects:
 * `1` this value is one; a string, the plan of that named type; `s` this value
 * is one when it is a string (a union); `p` object properties; `i` array items;
 * `a` values of a map.
 */
export type DatePlan = 1 | string | PlanNode;

export interface PlanNode {
  s?: 1;
  p?: Record<string, DatePlan>;
  i?: DatePlan;
  a?: DatePlan;
}

const ANY: TypeRef = { expr: "unknown", deps: new Set() };

function ref(expr: string, deps: Iterable<string> = []): TypeRef {
  return { expr, deps: new Set(deps) };
}

function depsOf(...refs: TypeRef[]): Set<string> {
  const out = new Set<string>();
  for (const r of refs) for (const d of r.deps) out.add(d);
  return out;
}

function splitUnion(expr: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]!;
    if ("<([{".includes(ch)) depth++;
    else if (">)]}".includes(ch)) depth--;
    else if (ch === '"') {
      // Skip a string literal.
      const end = expr.indexOf('"', i + 1);
      let j = end;
      while (j > 0 && expr[j - 1] === "\\") j = expr.indexOf('"', j + 1);
      current += expr.slice(i, j + 1);
      i = j;
      continue;
    }
    if (depth === 0 && expr.startsWith(" | ", i)) {
      out.push(current);
      current = "";
      i += 2;
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((p) => p.trim()).filter(Boolean);
}

const OPEN = "(string & {})";

/** `a | b`, flattened, without duplicates; `unknown` absorbs everything. */
export function union(refs: TypeRef[]): TypeRef {
  const parts: string[] = [];
  let nullable = false;
  let open = false;
  for (const r of refs) {
    for (const part of splitUnion(r.expr)) {
      if (part === "null") nullable = true;
      else if (part === OPEN) open = true;
      else if (!parts.includes(part)) parts.push(part);
    }
  }
  const deps = depsOf(...refs);
  if (parts.includes("unknown")) return ref("unknown", deps);
  if (open) parts.push(OPEN);
  if (nullable) parts.push("null");
  return ref(parts.length ? parts.join(" | ") : "unknown", deps);
}

export function nullable(r: TypeRef): TypeRef {
  if (r.expr === "unknown" || splitUnion(r.expr).includes("null")) return r;
  return ref(`${r.expr} | null`, r.deps);
}

/** Wrap a union in parentheses before using it as an array element. */
function arrayOf(r: TypeRef): TypeRef {
  const inner = splitUnion(r.expr).length > 1 || r.expr.includes("&") ? `(${r.expr})` : r.expr;
  return ref(`${inner}[]`, r.deps);
}

export function description(schema: Json): string | undefined {
  if (!isObject(schema)) return undefined;
  const text = schema.description;
  return typeof text === "string" && text.trim() ? text.trim() : undefined;
}

function literal(value: Json): string {
  return JSON.stringify(value);
}

interface ComponentKey {
  spec: Spec;
  name: string;
}

/** Every schema construct that makes a parameter type differ from its response type. */
function modeSensitive(spec: Spec, schema: Json, seen: Set<string>): boolean {
  const stack: Json[] = [schema];
  while (stack.length) {
    const cur = stack.pop();
    if (Array.isArray(cur)) {
      stack.push(...(cur as Json[]));
      continue;
    }
    if (!isObject(cur)) continue;
    if (typeof cur.$ref === "string") {
      if (seen.has(cur.$ref)) continue;
      seen.add(cur.$ref);
      stack.push(spec.pointer(cur.$ref));
      continue;
    }
    if (cur.readOnly === true || cur.writeOnly === true) return true;
    if (cur.format === "date-time" || cur.format === "binary") return true;
    for (const [k, v] of Object.entries(cur)) {
      if (k === "example" || k === "examples" || k === "default" || k === "enum") continue;
      stack.push(v);
    }
  }
  return false;
}

export class TypeBuilder {
  readonly decls = new Map<string, Decl>();
  /** Date plans of named response types that contain date-times. */
  readonly plans = new Map<string, DatePlan>();
  private readonly componentNames = new Map<Spec, Map<string, string>>();
  private readonly built = new Map<string, string>();
  private readonly planBusy = new Set<string>();
  private readonly planDone = new Set<string>();
  private readonly sensitive = new Map<string, boolean>();
  private readonly reserved: ReadonlySet<string>;
  /** Components of the live documents, for the deprecated operations that reuse them. */
  private readonly live: Spec[];
  /** `spec:name` of every component reachable from a response. */
  private responseUsage = new Set<string>();

  constructor(live: Spec[], reserved: ReadonlySet<string>) {
    this.live = live;
    this.reserved = reserved;
    const names = new Map<Spec, Set<string>>();
    for (const spec of live) names.set(spec, new Set(Object.keys(spec.components)));
    for (const spec of live) {
      const own = new Map<string, string>();
      const others = new Set<string>();
      for (const [s, n] of names) if (s !== spec) for (const x of n) others.add(x);
      for (const name of Object.keys(spec.components)) {
        let ts = /^[A-Z][A-Za-z0-9]*$/.test(name) ? name : pascal(name);
        if (others.has(name) && spec.name === "account") ts = `Account${ts}`;
        own.set(name, ts);
      }
      this.componentNames.set(spec, own);
    }
  }

  /** Components used by responses get a `Param` variant when parameters need one. */
  setResponseUsage(usage: Set<string>): void {
    this.responseUsage = usage;
  }

  // Components -------------------------------------------------------------

  /** The live spec and name that a component of `spec` stands for. */
  private canonical(key: ComponentKey): ComponentKey {
    if (this.componentNames.has(key.spec)) return key;
    // A deprecated operation's own copy: reuse the live component when unchanged.
    const schema = key.spec.components[key.name];
    for (const spec of this.live) {
      if (spec.name !== key.spec.name) continue;
      const liveSchema = spec.components[key.name];
      if (liveSchema !== undefined && JSON.stringify(liveSchema) === JSON.stringify(schema)) {
        return { spec, name: key.name };
      }
    }
    return key;
  }

  private componentTypeName(key: ComponentKey): string {
    const own = this.componentNames.get(key.spec);
    if (own) return own.get(key.name)!;
    let names = this.componentNames.get(key.spec);
    if (!names) {
      names = new Map();
      this.componentNames.set(key.spec, names);
    }
    const ts = `${/^[A-Z][A-Za-z0-9]*$/.test(key.name) ? key.name : pascal(key.name)}Deprecated`;
    names.set(key.name, ts);
    return ts;
  }

  private isSensitive(key: ComponentKey): boolean {
    const id = `${key.spec.name}:${key.name}:${this.componentTypeName(key)}`;
    let value = this.sensitive.get(id);
    if (value === undefined) {
      value = modeSensitive(key.spec, key.spec.components[key.name], new Set());
      this.sensitive.set(id, value);
    }
    return value;
  }

  component(spec: Spec, name: string, mode: Mode): TypeRef {
    const key = this.canonical({ spec, name });
    const schema = key.spec.components[key.name];
    if (schema === undefined) throw new CodegenError(`${spec.name}: no component ${name}.`);
    const base = this.componentTypeName(key);
    const effective: Mode = mode === "param" && this.isSensitive(key) ? "param" : "response";
    // A component used only as a parameter keeps the plain name.
    const inResponses = this.responseUsage.has(`${key.spec.name}:${key.name}`);
    const typeName = effective === "param" && inResponses ? `${base}Param` : base;
    const id = `${effective}:${key.spec.name}:${key.name}:${base}`;
    if (!this.built.has(id)) {
      this.built.set(id, typeName);
      this.define(key.spec, schema, typeName, "components", effective);
    }
    const out = ref(typeName, [typeName]);
    return schema.nullable === true ? nullable(out) : out;
  }

  /** Declare `name` for `schema` (an object becomes an interface, anything else an alias). */
  private define(spec: Spec, schema: JsonObject, name: string, module: string, mode: Mode): void {
    if (this.reserved.has(name)) {
      throw new CodegenError(
        `The generated type ${name} would shadow a hand-written export of the SDK; rename it in codegen.`,
      );
    }
    const shape = this.objectShape(spec, schema);
    if (shape) {
      this.declareInterface(spec, schema, shape, name, module, mode);
      return;
    }
    // Reserve the name first so that recursive references find it.
    const decl: Decl = {
      name,
      module,
      mode,
      description: description(schema),
      kind: "alias",
      fields: [],
      index: undefined,
      alias: undefined,
    };
    this.register(decl);
    decl.alias = this.inner(spec, schema, name, module, mode, true);
  }

  private register(decl: Decl): void {
    const existing = this.decls.get(decl.name);
    if (existing) {
      throw new CodegenError(
        `Two different types are both named ${decl.name} (${existing.module} and ${decl.module}); ` +
          "rename one of the operations or properties in openapi/overlay.json.",
      );
    }
    this.decls.set(decl.name, decl);
  }

  // Schemas ------------------------------------------------------------------

  /** The type of `schema` in `mode`; `hint` names any inline object it declares. */
  type(spec: Spec, schema: Json, hint: string, module: string, mode: Mode): TypeRef {
    const out = this.inner(spec, schema, hint, module, mode, false);
    return isObject(schema) && schema.nullable === true ? nullable(out) : out;
  }

  private inner(
    spec: Spec,
    schema: Json,
    hint: string,
    module: string,
    mode: Mode,
    defining: boolean,
  ): TypeRef {
    if (!isObject(schema)) return ANY;
    const target = schema.$ref;
    if (typeof target === "string") {
      if (target.startsWith("#/components/schemas/")) {
        return this.component(spec, target.slice("#/components/schemas/".length), mode);
      }
      return this.inner(spec, spec.pointer(target), hint, module, mode, defining);
    }
    if (Array.isArray(schema.allOf)) {
      const parts = schema.allOf as Json[];
      if (parts.length === 1 && !isObject(schema.properties)) {
        return this.type(spec, parts[0], hint, module, mode);
      }
    }
    for (const key of ["oneOf", "anyOf"] as const) {
      const members = schema[key];
      if (Array.isArray(members)) {
        return union(
          members.map((member: Json, i) =>
            this.type(spec, member, this.variantName(member, hint, i), module, mode),
          ),
        );
      }
    }
    if (Array.isArray(schema.enum)) return this.enumType(schema);
    const shape = this.objectShape(spec, schema);
    if (shape) {
      this.declareInterface(spec, schema, shape, hint, module, mode);
      return ref(hint, [hint]);
    }
    switch (schema.type) {
      case "string":
        if (schema.format === "date-time") return ref(mode === "param" ? "string | Date" : "Date");
        if (schema.format === "binary") return mode === "param" ? ref("Uploadable", ["@Uploadable"]) : ref("string");
        return ref("string");
      case "integer":
      case "number":
        return ref("number");
      case "boolean":
        return ref("boolean");
      case "array":
        // A named array's inline items get their own name; a property's items share its name.
        return arrayOf(this.type(spec, schema.items, defining ? `${hint}Item` : hint, module, mode));
      case "object":
      default: {
        if (schema.type === undefined && !("additionalProperties" in schema)) return ANY;
        const extra = schema.additionalProperties;
        if (isObject(extra) && Object.keys(extra).length) {
          const value = this.type(spec, extra, `${hint}Value`, module, mode);
          return ref(`Record<string, ${value.expr}>`, value.deps);
        }
        return ref("Record<string, unknown>");
      }
    }
  }

  private variantName(member: Json, hint: string, index: number): string {
    const title = isObject(member) ? member.title : undefined;
    if (typeof title === "string" && title.trim()) return hint + pascal(title);
    return `${hint}Variant${index + 1}`;
  }

  private enumType(schema: JsonObject): TypeRef {
    const all = schema.enum as Json[];
    const values = all.filter((v) => v !== null);
    const hasNull = all.length !== values.length;
    let out: TypeRef;
    if (values.length && values.every((v) => typeof v === "string")) {
      out = ref([...values.map(literal), OPEN].join(" | "));
    } else if (values.length && values.every((v) => typeof v === "number")) {
      out = ref("number");
    } else if (values.length && values.every((v) => typeof v === "boolean")) {
      out = ref("boolean");
    } else if (schema.type === "string") {
      out = ref("string");
    } else {
      out = ANY;
    }
    return hasNull ? nullable(out) : out;
  }

  /** Properties and required names of an object schema (allOf parts merged), or null. */
  objectShape(
    spec: Spec,
    schema: JsonObject,
  ): { props: Record<string, Json>; required: Set<string>; extra: Json } | null {
    const hasAllOf = Array.isArray(schema.allOf) && (schema.allOf as Json[]).length > 0;
    if (!hasAllOf && !(isObject(schema.properties) && Object.keys(schema.properties).length)) {
      return null;
    }
    if (hasAllOf && (schema.allOf as Json[]).length === 1 && !isObject(schema.properties)) {
      return null;
    }
    const props: Record<string, Json> = {};
    const required = new Set<string>();
    let extra: Json = schema.additionalProperties;
    const collect = (node: JsonObject, seen: Set<string>): void => {
      for (const part of Array.isArray(node.allOf) ? (node.allOf as Json[]) : []) {
        if (isObject(part) && typeof part.$ref === "string") {
          if (seen.has(part.$ref)) continue;
          seen.add(part.$ref);
        }
        const resolved = spec.resolveObject(part);
        collect(resolved, seen);
        if (resolved.additionalProperties !== undefined && extra === undefined) {
          extra = resolved.additionalProperties;
        }
      }
      if (isObject(node.properties)) Object.assign(props, node.properties);
      if (Array.isArray(node.required)) for (const r of node.required) required.add(String(r));
    };
    collect(schema, new Set());
    return { props, required, extra };
  }

  private declareInterface(
    spec: Spec,
    schema: JsonObject,
    shape: { props: Record<string, Json>; required: Set<string>; extra: Json },
    name: string,
    module: string,
    mode: Mode,
  ): void {
    const decl: Decl = {
      name,
      module,
      mode,
      description: description(schema),
      kind: "interface",
      fields: [],
      index: undefined,
      alias: undefined,
    };
    // Register first so that nested and recursive names see it.
    this.register(decl);
    for (const [wire, prop] of Object.entries(shape.props)) {
      const resolved = spec.resolveObject(prop);
      const own = isObject(prop) ? prop : {};
      const readOnly = own.readOnly === true || resolved.readOnly === true;
      const writeOnly = own.writeOnly === true || resolved.writeOnly === true;
      if ((mode === "param" && readOnly) || (mode === "response" && writeOnly)) continue;
      const type = this.type(spec, prop, name + pascal(wire), module, mode);
      decl.fields.push({
        wire,
        type,
        optional: !shape.required.has(wire),
        description: description(prop) ?? description(resolved),
        deprecated: own.deprecated === true || resolved.deprecated === true,
      });
    }
    const extra = shape.extra;
    if (extra === true || (isObject(extra) && Object.keys(extra).length === 0)) {
      decl.index = ANY;
    } else if (isObject(extra)) {
      // Every declared property must fit the index signature, so it stays unknown.
      decl.index = ANY;
    }
  }

  // Date plans -----------------------------------------------------------------

  /** How to decode the date-times in a response of this schema, or null when it has none. */
  datePlan(spec: Spec, schema: Json): DatePlan | null {
    if (!isObject(schema)) return null;
    const target = schema.$ref;
    if (typeof target === "string") {
      if (target.startsWith("#/components/schemas/")) {
        const key = this.canonical({ spec, name: target.slice("#/components/schemas/".length) });
        const name = this.componentTypeName(key);
        if (this.planDone.has(name)) return this.plans.has(name) ? name : null;
        if (this.planBusy.has(name)) return name; // recursive: resolved by name at run time
        this.planBusy.add(name);
        const plan = this.datePlan(key.spec, key.spec.components[key.name]);
        this.planBusy.delete(name);
        this.planDone.add(name);
        if (plan === null) return null;
        this.plans.set(name, plan);
        return name;
      }
      return this.datePlan(spec, spec.pointer(target));
    }
    for (const key of ["oneOf", "anyOf"] as const) {
      const members = schema[key];
      if (Array.isArray(members)) {
        return this.mergePlans((members as Json[]).map((m) => this.datePlan(spec, m)));
      }
    }
    if (schema.type === "string") return schema.format === "date-time" ? 1 : null;
    if (schema.type === "array") {
      const item = this.datePlan(spec, schema.items);
      return item === null ? null : { i: item };
    }
    const shape = this.objectShape(spec, schema);
    if (shape) {
      const p: Record<string, DatePlan> = {};
      for (const [wire, prop] of Object.entries(shape.props)) {
        const plan = this.datePlan(spec, prop);
        if (plan !== null) p[wire] = plan;
      }
      return Object.keys(p).length ? { p } : null;
    }
    if (Array.isArray(schema.allOf) && (schema.allOf as Json[]).length === 1) {
      return this.datePlan(spec, (schema.allOf as Json[])[0]);
    }
    const extra = schema.additionalProperties;
    if (isObject(extra)) {
      const value = this.datePlan(spec, extra);
      return value === null ? null : { a: value };
    }
    return null;
  }

  /** One plan for the members of a union: the value's own JSON type picks the branch. */
  private mergePlans(plans: (DatePlan | null)[]): DatePlan | null {
    const present = plans.filter((p): p is DatePlan => p !== null);
    if (present.length === 0) return null;
    if (present.length === 1) return present[0]!;
    const out: PlanNode = {};
    for (let plan of present) {
      if (typeof plan === "string") {
        const named = this.plans.get(plan);
        if (named === undefined) return plan; // still being built (recursive): keep the name
        plan = named;
      }
      if (plan === 1) {
        out.s = 1;
        continue;
      }
      if (typeof plan === "string") return plan;
      if (plan.s) out.s = 1;
      if (plan.p) out.p = { ...plan.p, ...out.p };
      if (plan.i !== undefined) out.i ??= plan.i;
      if (plan.a !== undefined) out.a ??= plan.a;
    }
    return out;
  }
}

/** `/** ... *\/` lines for a description, safe inside a comment. */
export function docLines(text: string | undefined, indent = "", extra: string[] = []): string[] {
  const lines: string[] = [];
  if (text) {
    for (const line of text.replace(/\*\//g, "*\\/").split("\n")) lines.push(line.trimEnd());
  }
  if (extra.length) {
    if (lines.length) lines.push("");
    lines.push(...extra);
  }
  if (!lines.length) return [];
  if (lines.length === 1) return [`${indent}/** ${lines[0]} */`];
  return [`${indent}/**`, ...lines.map((l) => (l ? `${indent} * ${l}` : `${indent} *`)), `${indent} */`];
}

/** Render a declaration as TypeScript source. */
export function renderDecl(decl: Decl): string {
  const out: string[] = [];
  out.push(...docLines(decl.description));
  if (decl.kind === "alias") {
    out.push(`export type ${decl.name} = ${decl.alias!.expr};`);
    return out.join("\n");
  }
  out.push(`export interface ${decl.name} {`);
  for (const field of decl.fields) {
    const tags = field.deprecated ? ["@deprecated"] : [];
    out.push(...docLines(field.description, "  ", tags));
    out.push(`  ${propKey(field.wire)}${field.optional ? "?" : ""}: ${field.type.expr};`);
  }
  if (decl.index) out.push(`  [key: string]: ${decl.index.expr};`);
  out.push("}");
  return out.join("\n");
}

export function declDeps(decl: Decl): Set<string> {
  const out = new Set<string>();
  const add = (r: TypeRef | undefined): void => {
    if (r) for (const d of r.deps) out.add(d);
  };
  for (const f of decl.fields) add(f.type);
  add(decl.index);
  add(decl.alias);
  out.delete(decl.name);
  return out;
}
