// The official Didit TypeScript and JavaScript library.
//
//   import Didit from "@didit-protocol/sdk-node";
//   const didit = new Didit(); // reads DIDIT_API_KEY
//
// See README.md and https://docs.didit.me.

import { Didit } from "./client.js";

export { Didit };
export default Didit;

export {
  DEFAULT_ACCOUNT_BASE_URL,
  DEFAULT_BASE_URL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT,
  type ClientOptions,
  type Fetch,
} from "./core/api-client.js";
export { APIPromise, type WithResponse } from "./core/api-promise.js";
export {
  APIConnectionError,
  APIResponseValidationError,
  APIStatusError,
  APITimeoutError,
  AuthenticationError,
  BadRequestError,
  ConfigurationError,
  ConflictError,
  DiditError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  TokenVerificationError,
  UnprocessableEntityError,
  WebhookVerificationError,
  type TokenVerificationReason,
  type WebhookVerificationReason,
} from "./core/errors.js";
export type { Logger, LogLevel } from "./core/logger.js";
export { PagePromise, type Page, type PageMethods, type PageResponse } from "./core/pagination.js";
export type { RequestOptions } from "./core/request-options.js";
export {
  fileFromPath,
  toFile,
  type FileData,
  type FileUpload,
  type Uploadable,
} from "./core/uploads.js";
export { VERSION } from "./core/version.js";
export * from "./resources/index.js";
export * from "./webhooks/index.js";
export * from "./authentication/index.js";
export type * from "./types/index.js";
