import { type ClientOptions } from "./core/api-client.js";
import { DiditResources } from "./resources/index.js";

/**
 * The Didit API client.
 *
 * ```ts
 * import Didit from "@didit-protocol/sdk-node";
 *
 * const didit = new Didit(); // reads DIDIT_API_KEY
 * const session = await didit.sessions.create({ workflow_id: "..." });
 * ```
 *
 * Create one client per process and reuse it. `apiKey` falls back to
 * `DIDIT_API_KEY`, `organizationId` and `applicationId` to
 * `DIDIT_ORGANIZATION_ID` and `DIDIT_APPLICATION_ID`. A client without an API
 * key can still call `didit.account` and verify webhooks.
 */
export class Didit extends DiditResources {
  constructor(options: ClientOptions = {}) {
    super(options);
  }

  /** A new client with some options changed; this one is left as it is. */
  withOptions(options: ClientOptions): Didit {
    return new Didit(this.mergedOptions(options));
  }
}
