// `didit.webhooks.verify(...)`: the webhook verifier, reachable from the client.
// The generated `webhooks` resource extends this class.

import { APIResource } from "../core/resource.js";
import type { WebhookEvent } from "./events.js";
import {
  verifyWebhook,
  verifyWebhookParsed,
  type VerifyWebhookOptions,
  type VerifyWebhookParsedOptions,
  type WebhookHeaders,
  type WebhookSecret,
} from "./verify.js";

/**
 * Adds `verify` and `verifyParsed` to `didit.webhooks`. They need no API key and
 * send no request.
 */
export class WebhookHelpers extends APIResource {
  /** See {@link verifyWebhook}. */
  verify(
    rawBody: string | Uint8Array | ArrayBuffer,
    headers: WebhookHeaders,
    secret: WebhookSecret,
    options?: VerifyWebhookOptions,
  ): Promise<WebhookEvent> {
    return verifyWebhook(rawBody, headers, secret, options);
  }

  /** See {@link verifyWebhookParsed}. */
  verifyParsed(
    payload: unknown,
    headers: WebhookHeaders,
    secret: WebhookSecret,
    options?: VerifyWebhookParsedOptions,
  ): Promise<WebhookEvent> {
    return verifyWebhookParsed(payload, headers, secret, options);
  }
}
