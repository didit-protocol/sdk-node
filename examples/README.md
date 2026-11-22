# Examples

Each script reads the API key from `DIDIT_API_KEY` (Business Console, Developers, API keys).
Use a sandbox application while you try them.

| Script                          | What it shows                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `quickstart.ts`                 | Create a KYC session, read its decision, verify a webhook (needs `DIDIT_WORKFLOW_ID`) |
| `id-verification.ts`            | Standalone ID verification with file uploads                                          |
| `aml-screening.ts`              | AML screening with an idempotency key, the raw response and error handling            |
| `transactions.ts`               | Transactions (KYT): submit one, then list them with `for await`                       |
| `travel-rule.ts`                | Travel Rule settings, the VASP directory, wallet addresses, wallet screening          |
| `authentication.ts`             | Verify a Didit Authentication access token in your backend                            |
| `webhooks/express.ts`           | Webhook receiver for Express                                                          |
| `webhooks/fastify.ts`           | Webhook receiver for Fastify                                                          |
| `webhooks/hono.ts`              | Webhook receiver for Hono                                                             |
| `webhooks/nextjs-route.ts`      | Webhook receiver for the Next.js App Router                                           |
| `webhooks/cloudflare-worker.ts` | Webhook receiver for Cloudflare Workers                                               |
| `webhooks/bun.ts`               | Webhook receiver for Bun                                                              |
| `webhooks/deno.ts`              | Webhook receiver for Deno                                                             |

In your own project, install the package and copy a script:

```sh
npm install @didit-protocol/sdk-node
```

From this repository, build first; Node.js 22.18 or later runs the TypeScript files directly
(the package imports itself through its `exports`):

```sh
pnpm install && pnpm build
DIDIT_API_KEY=... DIDIT_WORKFLOW_ID=... node examples/quickstart.ts
```

The webhook receivers need their framework and `DIDIT_WEBHOOK_SECRET`, the secret of the
webhook destination. Always pass the raw request body to `webhooks.verify`; verify before you parse.
