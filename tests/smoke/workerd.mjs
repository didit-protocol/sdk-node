// Smoke test of the built package on Cloudflare Workers (workerd): the checks of
// smoke.mjs, with the API stand-in as the client's fetch. The Worker answers 200
// with a summary when every check passes, 500 with the failure otherwise.
//
//   pnpm build
//   npx workerd serve tests/smoke/workerd.capnp --experimental   # then GET http://127.0.0.1:8787/

import vectors from "./webhook-vectors.json";
import * as sdk from "./sdk.js";
import { checkAuthentication, checkClient, checkWebhookVectors, mockApi } from "./checks.mjs";

async function run() {
  let userAgent = "";
  const fetch = (input, init) => {
    const request = new Request(input, init);
    userAgent = request.headers.get("user-agent") ?? "";
    return mockApi(request);
  };
  await checkClient(sdk, { fetch });
  const verified = await checkWebhookVectors(sdk, vectors.vectors);
  await checkAuthentication(sdk, crypto.subtle);
  return `smoke ok: @didit-protocol/sdk-node ${sdk.VERSION} on workerd (${userAgent}): client, ${verified} webhook vectors, Authentication`;
}

export default {
  async fetch() {
    try {
      return new Response(await run());
    } catch (error) {
      return new Response(String(error?.stack ?? error), { status: 500 });
    }
  },
};
