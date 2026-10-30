import type { DatePlan } from "./dates.js";

/**
 * How one API operation is called: the generated resource methods pass one of
 * these to the client together with the caller's arguments.
 */
export interface OperationSpec {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  /** Path template, e.g. `/v3/session/{sessionId}/decision/`. */
  path: string;
  /** `account`: the account management API at `accountBaseURL`. */
  api?: "account";
  /** Credentials to send; the API key when absent. */
  auth?: "account_token" | "none";
  /** The path starts with the organization and application ids from the client options. */
  scope?: "application";
  /** Params fields sent in the query string; `[key, wire]` when the names differ. */
  query?: readonly (string | readonly [string, string])[];
  /** Where the other params fields go: a JSON body, multipart, or multipart once a file is set. `whole`: params is the JSON body. */
  body?: "json" | "multipart" | "auto" | "whole";
  /** Multipart fields that carry files. */
  files?: readonly string[];
  /** `binary`: the body is returned as a Blob; `none`: nothing is returned. JSON when absent. */
  response?: "binary" | "none";
  /** Accept header for binary responses. */
  accept?: string;
  /** Where the response has date-times to decode. */
  dates?: DatePlan;
}
