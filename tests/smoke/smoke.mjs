// Smoke test of the built package (dist/index.js) on Node.js 18+, Bun and Deno:
// a local HTTP server stands in for the API, every webhook vector is verified,
// and an Authentication token signed with a key generated here is checked.
// Nothing leaves 127.0.0.1. (tests/smoke/workerd.mjs runs the same checks on
// Cloudflare Workers.)
//
//   pnpm build && node tests/smoke/smoke.mjs
//   bun tests/smoke/smoke.mjs
//   deno run --allow-read --allow-net=127.0.0.1 tests/smoke/smoke.mjs

import { readFileSync } from "node:fs";
import { createServer } from "node:http";

import * as sdk from "../../dist/index.js";
import { checkAuthentication, checkClient, checkWebhookVectors, mockApi } from "./checks.mjs";

const runtime = globalThis.Bun ? "bun" : globalThis.Deno ? "deno" : `node ${process.versions.node}`;

// 1. The client against a local API: real HTTP in front of the shared stand-in.
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  const body = chunks.length ? new Uint8Array(Buffer.concat(chunks)) : undefined;
  const response = await mockApi(
    new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body }),
  );
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  await checkClient(sdk, { baseURL: `http://127.0.0.1:${server.address().port}` });
} finally {
  await new Promise((resolve) => server.close(resolve));
}

// 2. Every webhook vector.
const { vectors } = JSON.parse(
  readFileSync(new URL("../../openapi/webhook-vectors.json", import.meta.url), "utf8"),
);
const verified = await checkWebhookVectors(sdk, vectors);

// 3. An Authentication token. Web Crypto is a global from Node.js 19 on.
const subtle = globalThis.crypto?.subtle ?? (await import("node:crypto")).webcrypto.subtle;
await checkAuthentication(sdk, subtle);

console.log(
  `smoke ok: @didit-protocol/sdk-node ${sdk.VERSION} on ${runtime}: client, ${verified} webhook vectors, Authentication`,
);
