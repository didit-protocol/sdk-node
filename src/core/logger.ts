// Optional debug logging (docs/DESIGN.md section 6). Each line names the method,
// the path, the status, the duration and the request id; never bodies, headers,
// query strings or credentials.

import { readEnv } from "./runtime.js";

/** Where the SDK writes its debug lines. `console` fits. */
export interface Logger {
  debug(message: string): void;
}

/** `debug` logs one line per HTTP request; `off` (the default) logs nothing. */
export type LogLevel = "debug" | "off";

/** The log level from the `DIDIT_LOG` environment variable. */
export function envLogLevel(): LogLevel {
  return readEnv("DIDIT_LOG")?.toLowerCase() === "debug" ? "debug" : "off";
}

export interface RequestLogLine {
  method: string;
  url: string;
  status: number | null;
  durationMs: number;
  requestId: string | null;
  attempt: number;
  error?: string;
}

/** `didit: GET /v3/sessions/ 200 123ms request_id=abc`. Only the path, never the query. */
export function formatLogLine(line: RequestLogLine): string {
  let path = line.url;
  try {
    path = new URL(line.url).pathname;
  } catch {
    // Keep the raw value; it never carries a query in practice.
  }
  const status = line.status === null ? (line.error ?? "error") : String(line.status);
  const retry = line.attempt > 0 ? ` retry=${line.attempt}` : "";
  const id = line.requestId ? ` request_id=${line.requestId}` : "";
  return `didit: ${line.method} ${path} ${status} ${Math.round(line.durationMs)}ms${retry}${id}`;
}
