// The spec sync's classification of two real upstream changes (docs/DESIGN.md
// sections 3.1 and 13), shared by every SDK repository. The fixtures are
// openapi/verification.json as sdk-python committed it at the pinned commits
// (https://raw.githubusercontent.com/didit-protocol/sdk-python/<commit>/openapi/verification.json):
//
// - 2026-11-04, an API change: before 9fe57fc69299601e59cc7a64c1db370fea5c7461 (tag
//   v1.0.1), after e002a815773bbd1599256e2774046ee76520c6c8. A minor `feat(spec)` that
//   lists the changes that can break typed code, the list sdk-python PR #14 printed.
// - 2026-11-06, documentation only (descriptions of POST /v3/poa/): before
//   fe9f57a1dfb6374bfd391750d2044fc7a206e4ea, after ccc799410f82eee1c25c7ce5abc6caa53846be6b.
//   A `chore(spec)` that releases nothing.
//
// The release-please part runs the release-please version the release workflow uses
// (release-please-action v5.0.0 bundles 17.6.0) with this repository's
// release-please-config.json, against a stub of the GitHub API.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { releaseSection, sync, syncTitle, type SyncResult } from "../lib/sync.ts";

const FIXTURES = new URL("./fixtures/spec-sync/", import.meta.url);
const NOW = new Date("2026-11-07T06:37:00Z");
const DATE = "2026-11-07";

const PINNED = {
  "2026-11-04-before": "12b2fdb05572755d61b93791f6964b7d883ba7b20f7ea9b31543903b6edab8a9",
  "2026-11-04-after": "d1783bd862848198f7e5275c28f6a1bcdd59737c0d92f72bba3f6f3cf8b8ae3e",
  "2026-11-06-before": "9f8cdf8be8157588facc8059c9bd306f3f516a3a5b66b78c8e63cf595ddb6627",
  "2026-11-06-after": "1b0c7bdd8d7957bdf314651ebd7ecc491457810dd7a1430bce84feac9caea305",
} as const;

function fixture(name: keyof typeof PINNED): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`${name}.json`, FIXTURES)));
}

const encoder = new TextEncoder();
// The other documents do not change in these syncs.
const UNCHANGED = encoder.encode(
  JSON.stringify({ openapi: "3.0.3", info: { title: "t", version: "1" }, paths: { "/x/": {} } }),
);

function syncPair(before: keyof typeof PINNED, after: keyof typeof PINNED): SyncResult {
  const files = new Map<string, Uint8Array | undefined>([
    ["verification.json", fixture(before)],
    ["account.json", UNCHANGED],
    ["authentication.json", UNCHANGED],
    // Every operation in the fixtures carries its x-didit-sdk naming upstream.
    ["overlay.json", encoder.encode(JSON.stringify({ operations: {} }))],
  ]);
  const downloads = new Map([
    ["verification.json", fixture(after)],
    ["account.json", UNCHANGED],
    ["authentication.json", UNCHANGED],
  ]);
  return sync({ files, downloads, now: NOW, version: "2.1.0" });
}

/** The changes that can break typed code in the 2026-11-04 API change: (operation, field, kind). */
const EXPECTED_2026_11_04 = [
  ["GET /v3/session/{sessionId}/decision/", "registry_checks[].company.registry_data", "now-null"],
  ["GET /v3/session/{sessionId}/decision/", "registry_checks[].ownership_structure", "now-null"],
  ["GET /v3/session/{sessionId}/decision/", "signatures[].confirmation.channel", "now-null"],
  ["POST /v3/email/risk/", "email.email_intelligence.reason_codes[]", "string->object"],
  ["POST /v3/email/risk/", "email.enrichment.reason_codes[]", "string->object"],
  ["POST /v3/kyb/select/", "kyb_registry.registry_data", "now-null"],
  ["POST /v3/kyb/shareholders/", "kyb_registry.registry_data", "now-null"],
  ["POST /v3/kyb/ubo/", "kyb_registry.registry_data", "now-null"],
  ["POST /v3/phone/risk/", "phone.enrichment.reason_codes[]", "string->object"],
  ["POST /v3/phone/risk/", "phone.phone_intelligence.reason_codes[]", "string->object"],
  ["POST /v3/session/import-shared/", "registry_checks[].company.registry_data", "now-null"],
  ["POST /v3/session/import-shared/", "registry_checks[].ownership_structure", "now-null"],
  ["POST /v3/session/import-shared/", "signatures[].confirmation.channel", "now-null"],
  ["POST /v3/session/{sessionId}/signatures/{nodeId}/validate/", "signatures[].confirmation.channel", "now-null"],
];

describe("spec sync classification of real upstream changes", () => {
  it("reads the pinned fixtures", () => {
    for (const [name, sha256] of Object.entries(PINNED)) {
      const digest = createHash("sha256")
        .update(fixture(name as keyof typeof PINNED))
        .digest("hex");
      expect(digest, name).toBe(sha256);
    }
  });

  it("2026-11-04: an API change is feat(spec), with exactly its changes that can break typed code", () => {
    const result = syncPair("2026-11-04-before", "2026-11-04-after");
    expect(result.type).toBe("feat");
    expect(syncTitle(result.type, DATE)).toBe("feat(spec): sync API spec 2026-11-07");
    expect(result.breaking.map((b) => [b.operation, b.field, b.kind])).toEqual(
      EXPECTED_2026_11_04,
    );
    expect(result.breaking.every((b) => b.in === "response")).toBe(true);
    // The body opens with the list, one line per change.
    const lines = result.summary.split("\n");
    expect(lines[0]).toBe("## Breaking changes");
    expect(lines.slice(1, 15)).toEqual(result.breaking.map((b) => `- ${b.text}`));
    expect(lines[15]).toBe("");
    expect(lines).toContain(
      "- `GET /v3/session/{sessionId}/decision/` response field `registry_checks[].company.registry_data` can now be null",
    );
    expect(lines).toContain(
      "- `POST /v3/email/risk/` response field `email.enrichment.reason_codes[]` changed type from string to object",
    );
  });

  it("2026-11-06: a documentation-only change is chore(spec), with none detected", () => {
    const result = syncPair("2026-11-06-before", "2026-11-06-after");
    expect(result.changed).toBe(true);
    expect(result.type).toBe("chore");
    expect(result.breaking).toEqual([]);
    expect(result.summary).toMatch(/^## Breaking changes\nNone detected\.\n/);
    expect(result.summary).toContain("## Changed operations (1)\n- `POST /v3/poa/`: descriptions");
    expect(releaseSection(result.type, result.breaking, DATE)).toBe("");
  });

  it("never writes a major version marker", () => {
    const result = syncPair("2026-11-04-before", "2026-11-04-after");
    const release = releaseSection(result.type, result.breaking, DATE);
    for (const text of [result.summary, release, syncTitle(result.type, DATE)]) {
      expect(text).not.toMatch(/BREAKING[ -]CHANGE/);
      expect(text).not.toMatch(/^[a-z-]+(\([^)]*\))?!:/m);
    }
  });
});
