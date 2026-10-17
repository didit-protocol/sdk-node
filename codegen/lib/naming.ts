// Name conversions for the generated code (docs/DESIGN.md sections 4 and 5.1).

const WORD = /[A-Z]+(?=[A-Z][a-z0-9])|[A-Z]?[a-z0-9]+|[A-Z]+|[0-9]+/g;

export function words(text: string): string[] {
  return text.replace(/[^A-Za-z0-9]+/g, " ").match(WORD) ?? [];
}

function cap(word: string): string {
  if (word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word)) {
    return word.charAt(0) + word.slice(1).toLowerCase();
  }
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** `key_people_checks` -> `KeyPeopleChecks`; `ID verification` -> `IdVerification`. */
export function pascal(text: string): string {
  const out = words(text).map(cap).join("");
  if (!out) return "Value";
  return /^[0-9]/.test(out) ? `V${out}` : out;
}

/** `retrieve_decision` -> `retrieveDecision`; `sessionId` -> `sessionId`. */
export function camel(text: string): string {
  const p = pascal(text);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

/** `sessions.imports` -> `SessionsImports`. */
export function resourceClass(resource: string): string {
  return resource.split(".").map(pascal).join("");
}

/** `sessions.imports` -> `sessions-imports`, for file names. */
export function kebab(text: string): string {
  return words(text)
    .map((w) => w.toLowerCase())
    .join("-");
}

const RESERVED = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
  "let",
  "static",
  "implements",
  "interface",
  "package",
  "private",
  "protected",
  "public",
  "await",
  "arguments",
  "eval",
  "options",
  "params",
  "body",
]);

/** A valid JavaScript identifier for a positional argument. */
export function argName(name: string, taken: ReadonlySet<string>): string {
  let out = camel(name);
  if (RESERVED.has(out)) out = `${out}Value`;
  while (taken.has(out)) out = `${out}_`;
  return out;
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** A property key as written in a type or object literal: quoted when needed. */
export function propKey(name: string): string {
  return IDENT.test(name) ? name : JSON.stringify(name);
}

/**
 * Order strings by UTF-16 code unit, the same on every machine (localeCompare
 * follows the host's locale, so generated files would differ between machines).
 */
export function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
