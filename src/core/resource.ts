import type { APIClient } from "./api-client.js";

/** Base of every resource class: holds the client that sends its requests. */
export abstract class APIResource {
  protected readonly _client: APIClient;

  constructor(client: APIClient) {
    this._client = client;
  }
}
