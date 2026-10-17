// Date-time strings in responses become `Date` objects (docs/DESIGN.md section
// 5.1). The generator records where a response has date-times as a small plan,
// so nothing else in the response is touched.

/**
 * `1` this value is a date-time; a string, the plan of that named type; `s` this
 * value is one when it is a string; `p` object properties; `i` array items; `a`
 * the values of a map.
 */
export type DatePlan =
  1 | string | { s?: 1; p?: Record<string, DatePlan>; i?: DatePlan; a?: DatePlan };

// RFC 3339 / ISO 8601 date-time with a time zone, as the API writes them.
const DATE_TIME =
  /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:?\d{2})$/;

function toDate(value: string): Date | string {
  if (!DATE_TIME.test(value)) return value;
  const date = new Date(value.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? value : date;
}

/**
 * A copy-free conversion: date-time strings named by `plan` are replaced in
 * place by `Date` objects. A value that is not a valid date-time is left as it is.
 */
export function decodeDates(
  value: unknown,
  plan: DatePlan | undefined,
  named: Readonly<Record<string, DatePlan>>,
  depth = 0,
): unknown {
  if (plan === undefined || value === null || value === undefined || depth > 64) return value;
  let node = plan;
  // A chain of names resolves to its plan; an unknown name means nothing to decode.
  for (let hops = 0; typeof node === "string"; hops++) {
    const next: DatePlan | undefined = named[node];
    if (next === undefined || hops > 16) return value;
    node = next;
  }
  if (typeof value === "string") {
    return node === 1 || node.s === 1 ? toDate(value) : value;
  }
  if (node === 1) return value;
  if (Array.isArray(value)) {
    if (node.i !== undefined) {
      for (let i = 0; i < value.length; i++)
        value[i] = decodeDates(value[i], node.i, named, depth + 1);
    }
    return value;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (node.p) {
      for (const [key, child] of Object.entries(node.p)) {
        if (Object.prototype.hasOwnProperty.call(record, key)) {
          record[key] = decodeDates(record[key], child, named, depth + 1);
        }
      }
    }
    if (node.a !== undefined) {
      for (const key of Object.keys(record)) {
        record[key] = decodeDates(record[key], node.a, named, depth + 1);
      }
    }
  }
  return value;
}
