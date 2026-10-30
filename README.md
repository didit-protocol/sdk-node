# Didit TypeScript / JavaScript SDK

The official Didit TypeScript and JavaScript library.
Identity verification (KYC), business verification (KYB), AML screening, biometrics, transaction monitoring, Travel Rule and customer authentication, from your backend.

- Every server endpoint of the [Didit API](https://docs.didit.me), with full types, generated from the OpenAPI contract.
- Webhook verification with typed events, and Didit Authentication token verification.
- No runtime dependencies. Runs on Node.js 18 or later, Bun, Deno and edge runtimes with `fetch` and Web Crypto (Cloudflare Workers, Vercel Edge).
- ESM and CommonJS, TypeScript strict.

## Installation

```sh
npm install @didit-protocol/sdk-node
# or: pnpm add @didit-protocol/sdk-node / yarn add @didit-protocol/sdk-node / bun add @didit-protocol/sdk-node
```

## Quickstart

Create a verification session, send the user to its URL, read the decision, and verify the webhook Didit sends when the status changes.

```ts
import Didit from "@didit-protocol/sdk-node";

const didit = new Didit(); // reads DIDIT_API_KEY

// 1. Create a session and send the user to session.url.
const session = await didit.sessions.create({
  workflow_id: "11111111-2222-3333-4444-555555555555",
  vendor_data: "user-42",
  callback: "https://example.com/verification/done",
});
console.log(session.url);

// 2. Later, read the decision.
const decision = await didit.sessions.retrieveDecision(session.session_id);
console.log(decision.status, decision.created_at); // "Approved", a Date
```

```ts
// 3. Verify the webhook (Express). Pass the raw body, not parsed JSON.
import express from "express";
import { webhooks, WebhookVerificationError } from "@didit-protocol/sdk-node";

const app = express();
app.post("/webhooks/didit", express.raw({ type: "application/json" }), async (req, res) => {
  // express.raw leaves req.body empty for other content types.
  if (!Buffer.isBuffer(req.body)) return res.status(400).send("expected a JSON body");
  try {
    const event = await webhooks.verify(req.body, req.headers, process.env.DIDIT_WEBHOOK_SECRET!);
    if (event.webhook_type === "status.updated") {
      console.log(event.session_id, event.status);
    }
    res.sendStatus(200);
  } catch (error) {
    if (error instanceof WebhookVerificationError) return res.status(400).send(error.reason);
    throw error;
  }
});
```

More runnable examples, including webhook receivers for Express, Fastify, Hono, Next.js, Cloudflare Workers, Bun and Deno, are in [`examples/`](examples/).

## Configuration

```ts
const didit = new Didit({
  apiKey: "...", // default: DIDIT_API_KEY
  organizationId: "...", // default: DIDIT_ORGANIZATION_ID
  applicationId: "...", // default: DIDIT_APPLICATION_ID
  timeout: 60_000, // milliseconds per attempt
  maxRetries: 2,
});
```

| Option                            | Default                                         | Notes                                                                                                             |
| --------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `apiKey`                          | `DIDIT_API_KEY`                                 | Sent as `x-api-key`, only to `baseURL`. A client without a key can still use `didit.account` and verify webhooks. |
| `baseURL`                         | `https://verification.didit.me`                 |                                                                                                                   |
| `organizationId`, `applicationId` | `DIDIT_ORGANIZATION_ID`, `DIDIT_APPLICATION_ID` | Needed by application-scoped methods (cases, networks, ongoing monitoring and others; see [api.md](api.md)).      |
| `accountBaseURL`                  | `https://apx.didit.me/auth/v2`                  | The account management API (`didit.account`).                                                                     |
| `accountToken`                    | none                                            | The `access_token` from `didit.account.login(...)`.                                                               |
| `timeout`                         | `60_000`                                        | Milliseconds, per attempt, including reading the body.                                                            |
| `maxRetries`                      | `2`                                             | See [Retries](#retries).                                                                                          |
| `defaultHeaders`                  | none                                            | Added to every request. They cannot replace the credentials (`x-api-key`, `Authorization`).                       |
| `fetch`                           | global `fetch`                                  | Your own `fetch` (proxies, instrumentation, tests).                                                               |
| `fetchOptions`                    | none                                            | Extra `fetch` options for every request, such as an undici `dispatcher`. A `signal` here cancels every request.   |
| `logLevel`, `logger`              | `DIDIT_LOG`, `console`                          | `debug` logs one line per request.                                                                                |

The environment variables are read on Node.js, Bun and Deno (with `--allow-env`). Edge runtimes such as Cloudflare Workers pass configuration to the handler instead, so give it to the client: `new Didit({ apiKey: env.DIDIT_API_KEY })`.

Create one client and reuse it. `didit.withOptions({ ... })` returns a new client with some options changed. Every method also takes request options as its last argument:

```ts
await didit.sessions.create(
  { workflow_id },
  {
    timeout: 10_000,
    maxRetries: 0,
    idempotencyKey: "order-123",
    headers: { "X-Trace": "abc" },
    signal,
  },
);
```

`signal` cancels the request, its retries and the wait between them; a `signal` in `fetchOptions` does the same.

## Using the API

Resources and methods follow the API: `didit.<resource>.<method>(...)`, with nested resources such as `didit.sessions.imports` or `didit.cases.notes`.
Path parameters are positional; everything else goes in one params object whose fields keep the API's names (snake_case).
[api.md](api.md) lists every method with its HTTP route and types, generated from `openapi/`.

```ts
import { fileFromPath } from "@didit-protocol/sdk-node";

await didit.idVerification.verify({ front_image: await fileFromPath("id-front.jpg") });
await didit.aml.screen({ full_name: "Ada Lovelace", date_of_birth: "1815-12-10" });
await didit.users.updateStatus("user-42", { status: "FLAGGED" });
await didit.cases.notes.create(caseUuid, { comment: "Checked with the customer" });
```

Every request and response has a type, exported from the package:

```ts
import type {
  SessionsCreateParams,
  SessionsCreateResponse,
  TransactionDetail,
} from "@didit-protocol/sdk-node";
```

Enums are open (`"Approved" | "Declined" | (string & {})`): a value added to the API later never breaks your build.
Fields the API adds later are kept on the objects you receive.
Optional fields are `?:`; fields the API can send as `null` include `| null`.
Date-time fields are `Date` objects (a date-time the API sends without a time zone is read as UTC); in parameters you can pass a `Date` or an ISO 8601 string.

The account management API (organizations and applications) is under `didit.account`:

```ts
const { access_token } = await didit.account.login({ email, password });
const account = didit.withOptions({ accountToken: access_token });
const organizations = await account.account.organizations.list();
```

### Pagination

Paginated list methods (a "page" in [api.md](api.md)) return a page with `count`, `next`, `previous` and `results`. Iterate with `for await` to walk every item of every page:

```ts
for await (const session of didit.sessions.list({ limit: 100 })) {
  console.log(session.session_id);
}

const page = await didit.sessions.list({ limit: 100 });
if (page.hasNextPage()) {
  const next = await page.getNextPage();
}
```

The SDK follows the API's `next` links and refuses a link to another origin, so your API key never leaves the API.

### Files

Upload parameters accept a `Blob` or `File`, a `Uint8Array` or `ArrayBuffer`, a web `ReadableStream`, a Node.js stream such as `fs.createReadStream("id.jpg")`, or `{ data, filename, contentType }`.
`fileFromPath(path)` reads a file on Node.js, Bun and Deno; `toFile(bytes, filename)` names bytes.
An upload without a name is sent as `file` plus the extension its content type or first bytes give (`file.jpg`, `file.pdf`).
A request with a file is sent as multipart form data: objects in it travel as JSON text, and `null` fields are left out (multipart has no null).

Binary responses (session and user PDFs, network reports, wallet screening PDFs, the import template, case attachments) return a `Blob`:

```ts
import { writeFile } from "node:fs/promises";

const pdf = await didit.sessions.generatePdf(sessionId);
await writeFile("report.pdf", new Uint8Array(await pdf.arrayBuffer()));
```

## Errors

| Error                                                                                                                                                                                                    | When                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `DiditError`                                                                                                                                                                                             | Base class of every error below.                                                                                             |
| `APIConnectionError` / `APITimeoutError`                                                                                                                                                                 | No response (network failure, timeout).                                                                                      |
| `APIStatusError`                                                                                                                                                                                         | Any non-2xx answer, with `status`, `body` (parsed JSON when possible), `headers` and `requestId`.                            |
| `BadRequestError` 400, `AuthenticationError` 401, `PermissionDeniedError` 403, `NotFoundError` 404, `ConflictError` 409, `UnprocessableEntityError` 422, `RateLimitError` 429, `InternalServerError` 5xx | Subclasses of `APIStatusError`.                                                                                              |
| `APIResponseValidationError`                                                                                                                                                                             | A 2xx answer the SDK cannot use (not JSON, a pagination link to another origin).                                             |
| `WebhookVerificationError`                                                                                                                                                                               | A webhook failed verification; `reason` says why.                                                                            |
| `TokenVerificationError`                                                                                                                                                                                 | An Authentication token failed verification; `reason` says why.                                                              |
| `ConfigurationError`                                                                                                                                                                                     | Missing API key, organization or application id, an empty webhook secret, an invalid option. Thrown before anything is sent. |

```ts
import { APIStatusError, NotFoundError } from "@didit-protocol/sdk-node";

try {
  await didit.sessions.retrieveDecision(sessionId);
} catch (error) {
  if (error instanceof NotFoundError) {
    // ...
  } else if (error instanceof APIStatusError) {
    console.error(error.status, error.body, error.requestId);
  } else {
    throw error;
  }
}
```

The API key never appears in an error message, a log line or the logged client.

### Retries

Failed requests are retried up to `maxRetries` times (default 2) with exponential backoff from 0.5 s, full jitter, capped at 8 s, honouring `Retry-After` (capped at 60 s).
`GET`, `HEAD`, `PUT` and `DELETE` are retried on connection errors, timeouts, 408, 429 and 5xx.
`POST` and `PATCH` are never retried once the request may have reached the server: only on 429 or when the connection failed before anything was sent.

### Raw responses

```ts
const { data, response, requestId } = await didit.sessions.create({ workflow_id }).withResponse();
const raw: Response = await didit.sessions.generatePdf(sessionId).asResponse(); // unread, for streaming
```

## Webhooks

`webhooks.verify(rawBody, headers, secret, options?)` checks the signature and the timestamp and returns a typed event; it throws `WebhookVerificationError` otherwise.
It is also available as `didit.webhooks.verify(...)`.

- `rawBody`: the exact body bytes (a `Buffer`, `Uint8Array`, `ArrayBuffer` or string). Configure your framework to give you the raw body.
- `headers`: a `Headers` object, Node.js `req.headers`, or `[name, value]` pairs.
- `secret`: the destination's secret, or a list of secrets during a rotation.
- `options.tolerance`: seconds between the delivery's timestamp and now (default 300).

Didit signs three ways: `X-Signature` (the raw body), `X-Signature-V2` (a canonical JSON form that survives middleware that re-encodes JSON) and the deprecated `X-Signature-Simple`; during a secret rotation the `-Previous` variants are signed with the old secret. Any of the first two, with either secret, is accepted.

```ts
const event = await webhooks.verify(rawBody, headers, [currentSecret, previousSecret]);
switch (event.webhook_type) {
  case "status.updated":
  case "data.updated":
    console.log(event.session_id, event.status, event.decision?.status);
    break;
  case "transaction.status.updated":
    console.log(event.transaction_id, event.status, event.score);
    break;
  default:
    console.log("unhandled event", event.webhook_type);
}
```

Events are a union discriminated by `webhook_type`: session (`status.updated`, `data.updated`), user, business, transaction and Travel Rule events, `activity.created`, `workflow.compliance_changed`, `kyb.registry_search.resolved`, and `UnknownEvent` for any other type.
Each event also has `event.verifiedBy` (which signature matched) and `event.bodyAuthenticated`.
The event is the body as sent, except that the session `decision` is the generated decision type, so its date-times are `Date` objects.

The KYB registry search callback (`kyb.registry_search.resolved`) is delivered unsigned today (`X-Didit-Unsigned-Callback: true`), so `verify` rejects it with `missing_signature`. Do not trust its body: read the result from the API by its `request_id` instead.

If your framework only gives you the parsed JSON body, `webhooks.verifyParsed(payload, headers, secret)` checks `X-Signature-V2` only, and fails for integers above 2^53 that `JSON.parse` has already rounded. Prefer the raw body.
`X-Signature-Simple` signs the envelope only, not the body; it is accepted with `{ allowSimple: true }`, and then `event.bodyAuthenticated` is `false`: re-fetch the record from the API before acting on it.

## Transactions, wallet screening and Travel Rule

```ts
const txn = await didit.transactions.create({
  transaction_id: "txn-1001",
  transaction_category: "finance",
  transaction_details: { direction: "outbound", amount: 2500, currency: "EUR" },
  subject: { vendor_data: "user-42", full_name: "Ada Lovelace" },
});
console.log(txn.status, txn.score); // "APPROVED" | "IN_REVIEW" | "DECLINED" | ...

const screening = await didit.walletScreening.screen({
  wallet_address: "0x...",
  blockchain: "ETH",
});
for await (const rule of didit.transactions.rules.list()) console.log(rule.title, rule.mode);
const settings = await didit.travelRule.retrieveSettings();
const vasps = await didit.travelRule.listVasps({ limit: 20 });
```

The `transaction.created`, `transaction.status.updated` and `travel_rule.status.updated` webhooks are typed events.

## Authentication

Didit Authentication gives each application its own OpenID Connect issuer for its end users. The `Authentication` helper verifies the ES256 tokens it signs and calls its token, session and step-up endpoints from your backend. It never uses your API key.

```ts
import { Authentication, TokenVerificationError } from "@didit-protocol/sdk-node";

const auth = Authentication.fromPublishableKey(process.env.DIDIT_PUBLISHABLE_KEY!, {
  clientId: process.env.DIDIT_APPLICATION_ID!,
});
// or: new Authentication({ issuer: "https://acme.auth.didit.me", clientId: "<application id>" })

try {
  const claims = await auth.verifyAccessToken(accessToken);
  console.log(claims.sub, claims.org?.role);
} catch (error) {
  if (error instanceof TokenVerificationError)
    console.log(error.reason); // e.g. "expired"
  else throw error;
}
```

- Options: `issuer` (or the publishable key), `clientId` (the application id: the default audience, and sent as `client_id` to the token endpoint), `leeway` (seconds, default 60), `timeout` (milliseconds per issuer request, default 10 000), `fetch`, `logLevel`, `logger`.
- `verifyAccessToken(token, { audience? })` and `verifyIdToken(token, { nonce, audience? })`: ES256 only; issuer, audience, expiry, not-before and issued-at are checked with 60 s leeway. Keys come from the issuer's JWKS, cached and refreshed when a new key appears. Pass `nonce: null` when no nonce was sent (an ID token from `refresh`); the token must then carry none. An access token an agent uses for a person also verifies: its `act` claim names the agent.
- `createPkce()`, `createState()` and `createNonce()` are standalone functions (`import { createPkce } from "@didit-protocol/sdk-node"`) for the authorization code flow; then `auth.exchangeCode({ code, codeVerifier, redirectUri })`.
- `refresh(refreshToken)`: serialise refreshes for one session; reusing a consumed refresh token revokes the session.
- `getSession(accessToken)` for an instant revocation check, `revokeSession(accessToken)`.
- `createStepUp(accessToken, { action, amount?, currency?, returnTo? })` and `retrieveStepUp(accessToken, id)`: act only on status `approved`. The issuer currently requires `returnTo` and answers 400 without it.

Authentication is in early access and reaches production with the 2026-11-01 Didit release.

## Logging

Set `DIDIT_LOG=debug` (or `logLevel: "debug"`) to log one line per HTTP request: method, path, status, duration and request id. Bodies, headers, query strings and credentials are never logged.

## Supported runtimes

| Runtime       | Versions                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------- |
| Node.js       | 18, 20, 22, 24                                                                              |
| Bun           | 1.x                                                                                         |
| Deno          | 2.x                                                                                         |
| Edge runtimes | Cloudflare Workers, Vercel Edge and other runtimes with `fetch`, Web Crypto and Web Streams |

CI runs the test suite on every Node.js version and a smoke test of the built package on Node.js 18, Bun, Deno and workerd (the Cloudflare Workers runtime).

The SDK refuses to send your API key anywhere but the API, but it is a server-side library: never ship your API key to a browser.

## Language notes

Choices this SDK makes where the shared design leaves them to each language:

- **Names.** Resources and methods are camelCase (`didit.idVerification.verify`, `retrieveDecision`); request and response fields keep the API's snake_case names. A query parameter named like a body field takes a `_query` suffix in the params object (`node_id_query`). Fields the SDK adds are camelCase: `requestId` on errors and raw responses, `verifiedBy` and `bodyAuthenticated` on webhook events.
- **Options.** Options are objects, not positional arguments: `new Didit({ apiKey })`, `new Authentication({ issuer })`, `verifyIdToken(token, { nonce, audience })`, `exchangeCode({ code, codeVerifier, redirectUri })`, `createStepUp(token, { action, ... })`. The design's `http_client` is the `fetch` option (plus `fetchOptions`); `logLevel` and `logger` choose where debug lines go. On edge runtimes, pass the API key as an option (environment variables are read only on Node.js, Bun and Deno).
- **Errors.** `APITimeoutError` extends `APIConnectionError`. `TokenVerificationError` (Authentication) and `APIResponseValidationError` (a 2xx answer the SDK cannot use) complete the design's table.
- **Times.** `timeout` is in milliseconds; webhook `tolerance` and Authentication `leeway` are in seconds, like the timestamps they compare.
- **Dates.** Response date-times are `Date` objects, which keep millisecond precision (the API sends microseconds); one without a time zone is read as UTC. Date-only fields (`format: date`) stay `YYYY-MM-DD` strings. Webhook events and Authentication claims are the JSON payloads as sent, so their timestamps stay numbers or strings, except a session event's `decision`, which is the generated decision type with `Date` objects.
- **Async.** Every API method, `webhooks.verify` and the Authentication helpers return promises (Web Crypto is asynchronous). `createPkce`, `createState` and `createNonce` are asynchronous for the same reason.
- **Results.** Methods return an `APIPromise`: await it for the data, or call `.withResponse()` / `.asResponse()`.
- **Absent and null.** Optional fields are `?:`; nullable fields add `| null`; a field you leave `undefined` is not sent.
- **Large integers.** Webhook signatures are checked on the raw body with a parser that keeps every number's digits, so integers above 2^53 are verified exactly. The typed event you get back is parsed with `JSON.parse`, like every response.
- **CommonJS.** `const { Didit } = require("@didit-protocol/sdk-node")`; the ESM default export is also `require(...).default`.
- **Files.** Paths are read with `fileFromPath(path)`; everything else is passed as bytes, a Blob or a stream.
- **Client header.** `User-Agent: didit-node/<version> (<runtime> <version>; <os>)` and `X-Didit-Client: node/<version>`, after the repository name, on every runtime.

## Versioning

This package follows [semantic versioning](https://semver.org). A breaking change to the public SDK surface is a major version (a minor version while the version is 0.x).
Releases and `CHANGELOG.md` are produced by release-please from conventional commits.
When the API removes or renames an endpoint, the SDK keeps the old method as deprecated for one more minor version.

## Links

- API reference and guides: https://docs.didit.me
- Design contract shared by every Didit server SDK (Python, TypeScript, Go, Java, PHP, Ruby, .NET): [docs/DESIGN.md](docs/DESIGN.md)
- Contributing (regenerate, test, release): [CONTRIBUTING.md](CONTRIBUTING.md)
- Security: [SECURITY.md](SECURITY.md)

## License

MIT
