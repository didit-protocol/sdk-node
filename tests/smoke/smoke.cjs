// CommonJS smoke test of the built package (dist/index.cjs): the exports load,
// errors keep their classes, and a webhook vector verifies.
//
//   pnpm build && node tests/smoke/smoke.cjs

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const sdk = require("../../dist/index.cjs");

async function main() {
  const { Didit, DiditError, ConfigurationError, webhooks, WebhookVerificationError, VERSION } =
    sdk;
  assert.equal(sdk.default, Didit);
  const didit = new Didit({ apiKey: "cjs-key" });
  assert.equal(typeof didit.sessions.create, "function");
  assert.equal(typeof didit.webhooks.verify, "function");
  const error = await didit.cases.list().catch((e) => e);
  assert.ok(error instanceof ConfigurationError && error instanceof DiditError);

  const { vectors } = JSON.parse(
    readFileSync(join(__dirname, "../../openapi/webhook-vectors.json"), "utf8"),
  );
  const vector = vectors.find((v) => v.expect === "valid");
  const realNow = Date.now;
  Date.now = () => vector.now * 1000;
  try {
    const event = await webhooks.verify(Buffer.from(vector.body), vector.headers, vector.secret);
    assert.equal(event.verifiedBy, "signature");
    const bad = await webhooks.verify(vector.body, {}, vector.secret).catch((e) => e);
    assert.ok(bad instanceof WebhookVerificationError && bad.reason === "missing_signature");
  } finally {
    Date.now = realNow;
  }
  const runtime = process.versions.bun
    ? `bun ${process.versions.bun}`
    : `node ${process.versions.node}`;
  console.log(`smoke ok (CommonJS): @didit-protocol/sdk-node ${VERSION} on ${runtime}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
