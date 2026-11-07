// Contract test for the Authentication document (docs/DESIGN.md sections 10 and 11).
// Every `server: true` operation of openapi/authentication.json, and each of its
// `x-didit-sdk` variants, maps to the hand-written authentication module, which
// has no other method that calls the issuer; each call is checked against the
// document: HTTP method, path, credentials and body fields. A spec sync that adds,
// removes, renames or reshapes an Authentication operation fails here until the
// module follows. The expected set comes from openapi/ itself.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { Authentication } from "../../src/authentication/index.js";
import {
  ACCESS_TOKEN,
  CODE,
  CODE_VERIFIER,
  FakeIssuer,
  ISSUER,
  REDIRECT_URI,
  REFRESH_TOKEN,
  STEP_UP_ID,
  SigningKey,
  accessClaims,
  json,
  type Recorded,
} from "./helpers.js";

type Doc = Record<string, unknown>;

const document = JSON.parse(
  readFileSync(new URL("../../openapi/authentication.json", import.meta.url), "utf8"),
) as Doc;

function isDoc(value: unknown): value is Doc {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolve(node: unknown): Doc {
  if (!isDoc(node)) return {};
  if (typeof node.$ref !== "string") return node;
  let current: unknown = document;
  for (const part of node.$ref.slice(2).split("/")) current = isDoc(current) ? current[part] : {};
  return resolve(current);
}

interface Operation {
  /** `POST /token/` */
  key: string;
  method: string;
  path: string;
  /** `x-didit-sdk` auth: `none` or `access_token`. */
  auth: string;
  /** The request body schema of this operation or variant, with its content types. */
  body: { types: string[]; schema: Doc } | null;
  /** The discriminator property and value that select a variant. */
  variant: [property: string, value: string] | null;
}

/** Every `server: true` operation and variant of the document, by its method name. */
function serverOperations(): Map<string, Operation> {
  const out = new Map<string, Operation>();
  for (const [path, item] of Object.entries(document.paths as Doc)) {
    for (const [method, value] of Object.entries(item as Doc)) {
      const op = resolve(value);
      const sdk = op["x-didit-sdk"];
      if (!isDoc(sdk) || sdk.server !== true) continue;
      expect(sdk.resource, `${method} ${path}`).toBe("authentication");
      const requestBody = resolve(op.requestBody);
      const content = isDoc(requestBody.content) ? requestBody.content : {};
      const types = Object.keys(content);
      const schema = types.length ? resolve(resolve(content[types[0]!]).schema) : null;
      const base = {
        key: `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(),
        path,
        auth: String(sdk.auth),
      };
      const variants = Array.isArray(sdk.variants) ? (sdk.variants as Doc[]) : [];
      if (!variants.length) {
        out.set(String(sdk.method), {
          ...base,
          body: schema ? { types, schema } : null,
          variant: null,
        });
        continue;
      }
      const discriminator = resolve(schema?.discriminator);
      const property = String(discriminator.propertyName);
      const mapping = discriminator.mapping as Record<string, string>;
      for (const variant of variants) {
        const value = String(variant.discriminator);
        out.set(String(variant.method), {
          ...base,
          body: { types, schema: resolve({ $ref: mapping[value] }) },
          variant: [property, value],
        });
      }
    }
  }
  return out;
}

const signingKey = await SigningKey.generate("contract-key");
const STEP_UP = { id: STEP_UP_ID, status: "approved", required: true };

/** How the hand-written module provides each operation: a public method, or internally. */
const PROVIDED: Record<string, { by: string; call: (auth: Authentication) => Promise<unknown> }> = {
  // Discovery and the signing keys are fetched lazily and cached (DESIGN section 10).
  get_openid_configuration: {
    by: "verifyAccessToken (discovery, fetched and cached)",
    call: async (auth) => auth.verifyAccessToken(await signingKey.sign(accessClaims())),
  },
  get_jwks: {
    by: "verifyAccessToken (signing keys, fetched and cached)",
    call: async (auth) => auth.verifyAccessToken(await signingKey.sign(accessClaims())),
  },
  exchange_code: {
    by: "exchangeCode",
    call: (auth) =>
      auth.exchangeCode({ code: CODE, codeVerifier: CODE_VERIFIER, redirectUri: REDIRECT_URI }),
  },
  refresh: { by: "refresh", call: (auth) => auth.refresh(REFRESH_TOKEN) },
  get_session: { by: "getSession", call: (auth) => auth.getSession(ACCESS_TOKEN) },
  revoke_session: { by: "revokeSession", call: (auth) => auth.revokeSession(ACCESS_TOKEN) },
  create_step_up: {
    by: "createStepUp",
    call: (auth) =>
      auth.createStepUp(ACCESS_TOKEN, {
        action: "payout",
        amount: "900.00",
        currency: "EUR",
        returnTo: "https://app.example.com/payouts",
      }),
  },
  retrieve_step_up: {
    by: "retrieveStepUp",
    call: (auth) => auth.retrieveStepUp(ACCESS_TOKEN, STEP_UP_ID),
  },
};

/** Public methods that verify tokens offline, with the discovery document and keys above. */
const OFFLINE = ["verifyAccessToken", "verifyIdToken"];

function stubIssuer(): FakeIssuer {
  const issuer = new FakeIssuer([signingKey]);
  const tokens = { access_token: "issued", token_type: "Bearer", expires_in: 300 };
  issuer.reply("POST", "/token/", 200, tokens);
  issuer.reply("GET", "/session/", 200, { sid: "s" });
  issuer.reply("DELETE", "/session/", 204);
  issuer.reply("POST", "/step-up/", 201, STEP_UP);
  issuer.route("GET", `/step-up/${STEP_UP_ID}/`, () => json(200, STEP_UP));
  return issuer;
}

function matches(op: Operation, request: Recorded): boolean {
  const pattern = new RegExp(`^${op.path.replace(/\{[^}]+\}/g, "[^/]+")}$`);
  return request.method === op.method && pattern.test(request.url.pathname);
}

function bodyOf(request: Recorded): Record<string, unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (type.startsWith("application/x-www-form-urlencoded"))
    return Object.fromEntries(new URLSearchParams(request.body ?? ""));
  return JSON.parse(request.body ?? "{}") as Record<string, unknown>;
}

describe("Authentication contract", () => {
  const operations = serverOperations();

  it("maps every server operation of openapi/authentication.json, and nothing else", () => {
    expect([...operations.keys()].sort()).toEqual(Object.keys(PROVIDED).sort());
    const publicMethods = Object.getOwnPropertyNames(Authentication.prototype).filter(
      (name) => name !== "constructor",
    );
    const mapped = Object.values(PROVIDED)
      .map(({ by }) => by)
      .filter((by) => !by.includes(" "));
    expect(publicMethods.sort()).toEqual([...mapped, ...OFFLINE].sort());
  });

  for (const [name, op] of serverOperations()) {
    const provided = PROVIDED[name];
    it(`${name}: ${provided?.by ?? "no method"} calls ${op.key} as the document describes`, async () => {
      expect(provided, `${name} (${op.key}) has no method in src/authentication`).toBeDefined();
      const issuer = stubIssuer();
      await provided!.call(issuer.client());
      const request = issuer.requests.find((r) => matches(op, r));
      expect(request, `no ${op.key} request`).toBeDefined();
      expect(request!.url.origin).toBe(new URL(ISSUER).origin);
      const authorization = request!.headers.get("authorization");
      if (op.auth === "access_token") expect(authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
      else expect(op.auth).toBe("none");
      if (op.auth === "none") expect(authorization).toBeNull();
      if (!op.body) {
        expect(request!.body).toBeNull();
        return;
      }
      const type = (request!.headers.get("content-type") ?? "").split(";")[0]!;
      expect(op.body.types).toContain(type);
      const sent = bodyOf(request!);
      const properties = Object.keys((op.body.schema.properties as Doc | undefined) ?? {});
      const required = (op.body.schema.required as string[] | undefined) ?? [];
      expect(Object.keys(sent).filter((key) => !properties.includes(key))).toEqual([]);
      expect(required.filter((key) => !(key in sent))).toEqual([]);
      if (op.variant) expect(sent[op.variant[0]]).toBe(op.variant[1]);
    });
  }
});
