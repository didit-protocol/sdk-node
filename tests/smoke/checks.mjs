// Checks shared by the smoke tests of the built package (smoke.mjs on Node.js,
// Bun and Deno; workerd.mjs on Cloudflare Workers): a stand-in for the API, the
// client against it, every webhook vector, and an Authentication token signed
// with a key made here. Web platform APIs only, and nothing leaves the process
// or 127.0.0.1.

export function check(condition, message) {
  if (!condition) throw new Error(`smoke test failed: ${message}`);
}

const SESSIONS = Array.from({ length: 3 }, (_, i) => ({
  session_id: `s-${i}`,
  status: "Approved",
}));

/** The API stand-in: a fetch-style handler for the few routes the checks call. */
export async function mockApi(request) {
  const url = new URL(request.url);
  const send = (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "x-request-id": "req-smoke" },
    });
  if (request.headers.get("x-api-key") !== "smoke-key") return send(401, { detail: "bad key" });
  if (request.method === "POST" && url.pathname === "/v3/session/") {
    const body = await request.json();
    return send(201, {
      session_id: "s-new",
      url: "https://verify.didit.me/s-new",
      workflow_id: body.workflow_id,
    });
  }
  if (url.pathname === "/v3/session/s-new/decision/") {
    return send(200, {
      session_id: "s-new",
      status: "Approved",
      created_at: "2026-10-17T10:00:00.123456Z",
    });
  }
  if (url.pathname === "/v3/sessions/") {
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const next =
      offset + 2 < SESSIONS.length
        ? `${url.origin}/v3/sessions/?limit=2&offset=${offset + 2}`
        : null;
    return send(200, {
      count: SESSIONS.length,
      next,
      previous: null,
      results: SESSIONS.slice(offset, offset + 2),
    });
  }
  return send(404, { detail: "Not found." });
}

/** The client against {@link mockApi}; returns the User-Agent it sent. */
export async function checkClient(sdk, options) {
  const { default: Didit, NotFoundError } = sdk;
  const didit = new Didit({ apiKey: "smoke-key", maxRetries: 0, ...options });
  const session = await didit.sessions.create({ workflow_id: "wf-1", vendor_data: "user-1" });
  check(session.session_id === "s-new" && session.workflow_id === "wf-1", "sessions.create");
  const decision = await didit.sessions.retrieveDecision(session.session_id);
  check(decision.status === "Approved", "retrieveDecision status");
  check(decision.created_at instanceof Date, "date-times become Date objects");
  const ids = [];
  for await (const item of didit.sessions.list({ limit: 2 })) ids.push(item.session_id);
  check(ids.join() === "s-0,s-1,s-2", `pagination walked ${ids.join()}`);
  const missing = await didit.users.retrieve("nobody").catch((error) => error);
  check(
    missing instanceof NotFoundError && missing.requestId === "req-smoke",
    "404 is NotFoundError",
  );
}

/** Every vector of openapi/webhook-vectors.json; returns how many were checked. */
export async function checkWebhookVectors(sdk, vectors) {
  const { webhooks, WebhookVerificationError } = sdk;
  const realNow = Date.now;
  let verified = 0;
  try {
    for (const vector of vectors) {
      Date.now = () => vector.now * 1000;
      const secrets = vector.previous_secret
        ? [vector.secret, vector.previous_secret]
        : vector.secret;
      const allowSimple = vector.expect === "valid_only_with_allow_simple";
      let outcome;
      try {
        const event = await webhooks.verify(vector.body, vector.headers, secrets, { allowSimple });
        outcome = "valid";
        check(typeof event.webhook_type === "string", `${vector.name} has a type`);
        check(event.bodyAuthenticated === !allowSimple, `${vector.name} bodyAuthenticated`);
      } catch (error) {
        if (!(error instanceof WebhookVerificationError)) throw error;
        outcome = error.reason;
      }
      const expected = allowSimple ? "valid" : vector.expect;
      check(outcome === expected, `${vector.name}: expected ${expected}, got ${outcome}`);
      verified++;
    }
  } finally {
    Date.now = realNow;
  }
  return verified;
}

/** An access token signed with a P-256 key made here, verified and then tampered with. */
export async function checkAuthentication(sdk, subtle) {
  const { Authentication, TokenVerificationError } = sdk;
  const issuer = "https://smoke.auth.didit.me";
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const jwk = {
    ...(await subtle.exportKey("jwk", pair.publicKey)),
    kid: "smoke-key-1",
    use: "sig",
    alg: "ES256",
  };
  const b64 = (bytes) =>
    btoa(String.fromCharCode(...new Uint8Array(bytes)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const text = (value) => b64(new TextEncoder().encode(JSON.stringify(value)));
  const nowSeconds = Math.floor(Date.now() / 1000);
  const input = `${text({ alg: "ES256", typ: "at+jwt", kid: "smoke-key-1" })}.${text({
    iss: issuer,
    aud: "app-1",
    client_id: "app-1",
    sub: "user-1",
    sid: "sid-1",
    jti: "jti-1",
    iat: nowSeconds,
    exp: nowSeconds + 300,
  })}`;
  const signature = await subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    pair.privateKey,
    new TextEncoder().encode(input),
  );
  const token = `${input}.${b64(signature)}`;
  const issuerFetch = async (url) => {
    const href = String(url);
    if (href === `${issuer}/.well-known/openid-configuration`) {
      return Response.json({
        issuer,
        jwks_uri: `${issuer}/.well-known/jwks.json`,
        token_endpoint: `${issuer}/token/`,
      });
    }
    if (href === `${issuer}/.well-known/jwks.json`) return Response.json({ keys: [jwk] });
    return new Response("not found", { status: 404 });
  };
  const auth = new Authentication({ issuer, clientId: "app-1", fetch: issuerFetch });
  const claims = await auth.verifyAccessToken(token);
  check(claims.sub === "user-1", "verifyAccessToken");
  // Flip a bit inside the signature (not the last character, whose low bits are unused).
  const at = token.length - 10;
  const flipped = token[at] === "A" ? "B" : "A";
  const tampered = `${token.slice(0, at)}${flipped}${token.slice(at + 1)}`;
  const rejected = await auth.verifyAccessToken(tampered).catch((error) => error);
  check(
    rejected instanceof TokenVerificationError && rejected.reason === "invalid_signature",
    "a tampered token is refused",
  );
}
