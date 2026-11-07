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
import { createRequire } from "node:module";
import type { GitHub } from "release-please";
import { describe, expect, it } from "vitest";

import {
  commitMessage,
  normalized,
  RELEASE_NOTES_HEADING,
  releaseSection,
  sync,
  syncTitle,
  type SyncResult,
} from "../lib/sync.ts";

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
  ["GET /v3/session/{sessionId}/decision/", "registry_checks[].company.registry_data", "can now be null"],
  ["GET /v3/session/{sessionId}/decision/", "registry_checks[].ownership_structure", "can now be null"],
  ["GET /v3/session/{sessionId}/decision/", "signatures[].confirmation.channel", "can now be null"],
  ["POST /v3/email/risk/", "email.email_intelligence.reason_codes[]", "type string -> object"],
  ["POST /v3/email/risk/", "email.enrichment.reason_codes[]", "type string -> object"],
  ["POST /v3/kyb/select/", "kyb_registry.registry_data", "can now be null"],
  ["POST /v3/kyb/shareholders/", "kyb_registry.registry_data", "can now be null"],
  ["POST /v3/kyb/ubo/", "kyb_registry.registry_data", "can now be null"],
  ["POST /v3/phone/risk/", "phone.enrichment.reason_codes[]", "type string -> object"],
  ["POST /v3/phone/risk/", "phone.phone_intelligence.reason_codes[]", "type string -> object"],
  ["POST /v3/session/import-shared/", "registry_checks[].company.registry_data", "can now be null"],
  ["POST /v3/session/import-shared/", "registry_checks[].ownership_structure", "can now be null"],
  ["POST /v3/session/import-shared/", "signatures[].confirmation.channel", "can now be null"],
  [
    "POST /v3/session/{sessionId}/signatures/{nodeId}/validate/",
    "signatures[].confirmation.channel",
    "can now be null",
  ],
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
    expect(result.breaking.map((b) => [b.operation, b.field, b.kind])).toEqual(EXPECTED_2026_11_04);
    expect(result.breaking.every((b) => b.in === "response")).toBe(true);
    expect(normalized(result.breaking[0]!)).toBe(
      "GET /v3/session/{sessionId}/decision/ response registry_checks[].company.registry_data: can now be null",
    );
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

// Release notes ----------------------------------------------------------------

const ROOT = new URL("../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, ROOT), "utf8");
const released = (JSON.parse(read(".release-please-manifest.json")) as Record<string, string>)[
  "."
]!;
const RELEASE_SHA = "c".repeat(40);
const SYNC_SHA = "a".repeat(40);

interface PullRequest {
  sha: string;
  number: number;
  baseBranchName: string;
  headBranchName: string;
  title: string;
  body: string;
  labels: string[];
  files: string[];
}

interface Commit {
  sha: string;
  message: string;
  files: string[];
  pullRequest?: PullRequest;
}

async function* each<T>(items: readonly T[]): AsyncGenerator<T> {
  for (const item of items) yield await Promise.resolve(item);
}

/**
 * The part of the GitHub API release-please reads to build its release pull
 * request: this repository's files, the latest release and the commits since.
 */
function stubGitHub(commits: Commit[]): GitHub {
  const releaseCommit: Commit = {
    sha: RELEASE_SHA,
    message: `chore(main): release ${released}`,
    files: [],
    pullRequest: {
      sha: RELEASE_SHA,
      number: 22,
      baseBranchName: "main",
      headBranchName: "release-please--branches--main--components--sdk-node",
      title: `chore(main): release ${released}`,
      body: "",
      labels: ["autorelease: tagged"],
      files: [],
    },
  };
  const stub = {
    repository: { owner: "didit-protocol", repo: "sdk-node", defaultBranch: "main" },
    getFileJson: (path: string): Promise<unknown> => Promise.resolve(JSON.parse(read(path))),
    getFileContentsOnBranch: (path: string) => {
      const text = read(path);
      return Promise.resolve({
        sha: "f".repeat(40),
        content: Buffer.from(text).toString("base64"),
        parsedContent: text,
        mode: "100644",
      });
    },
    releaseIterator: () =>
      each([{ name: `v${released}`, tagName: `v${released}`, sha: RELEASE_SHA, notes: "" }]),
    mergeCommitIterator: () => each([...commits, releaseCommit]),
  };
  return stub as unknown as GitHub;
}

/** The pull request the spec sync workflow opens: summary, checks, then the release section. */
function syncPullRequest(result: SyncResult): PullRequest {
  const title = syncTitle(result.type, DATE);
  const body = [
    result.summary,
    "## Checks\n\n- [x] vitest\n",
    releaseSection(result.type, result.breaking, DATE),
  ].join("\n");
  return {
    sha: SYNC_SHA,
    number: 24,
    baseBranchName: "main",
    headBranchName: "chore/spec-sync",
    title,
    body,
    labels: [],
    files: [],
  };
}

/**
 * Squash and merge: one commit, with the pull request title, or with `message` (the
 * sync commit's) as its message.
 */
function squashed(pr: PullRequest, message?: string): Commit[] {
  const text = message
    ? message.replace(/\n/, ` (#${pr.number})\n`)
    : `${pr.title} (#${pr.number})`;
  return [{ sha: pr.sha, message: text, files: [], pullRequest: pr }];
}

/** Create a merge commit: GitHub associates the pull request with both commits. */
function merged(pr: PullRequest): Commit[] {
  const merge = "b".repeat(40);
  return [
    {
      sha: merge,
      message: `Merge pull request #${pr.number} from didit-protocol/chore/spec-sync`,
      files: [],
      pullRequest: { ...pr, sha: merge },
    },
    { sha: pr.sha, message: pr.title, files: [], pullRequest: pr },
  ];
}

/** release-please's next release from these commits, or null when it proposes none. */
async function nextRelease(commits: Commit[]): Promise<{ version: string; notes: string } | null> {
  // release-please needs Node.js 20 or later; required only here, not on Node.js 18.
  const { Manifest, setLogger } = createRequire(import.meta.url)(
    "release-please",
  ) as typeof import("release-please");
  const quiet = (): void => undefined;
  setLogger({ error: quiet, warn: quiet, info: quiet, debug: quiet, trace: quiet });
  const manifest = await Manifest.fromManifest(
    stubGitHub(commits),
    "main",
    "release-please-config.json",
    ".release-please-manifest.json",
  );
  const pulls = await manifest.buildPullRequests();
  expect(pulls.length).toBeLessThanOrEqual(1);
  const pull = pulls[0];
  return pull ? { version: pull.version!.toString(), notes: pull.body.toString() } : null;
}

const NODE_MAJOR = Number(process.versions.node.split(".")[0]);

describe.skipIf(NODE_MAJOR < 20)("release-please with release-please-config.json", () => {
  const minor = released.replace(/^(\d+)\.(\d+)\.\d+$/, (_, major: string, m: string) =>
    [major, Number(m) + 1, 0].join("."),
  );

  it("releases the 2026-11-04 API change as a minor version that lists what can break typed code", async () => {
    const result = syncPair("2026-11-04-before", "2026-11-04-after");
    const pr = syncPullRequest(result);
    for (const commits of [squashed(pr), merged(pr)]) {
      const release = await nextRelease(commits);
      expect(release?.version).toBe(minor);
      expect(release?.notes).not.toContain("BREAKING");
    }
    const release = await nextRelease(squashed(pr));
    const notes = release!.notes;
    expect(notes).toContain("### Features\n\n* **spec:** sync API spec 2026-11-07 (");
    const section = notes.slice(notes.indexOf(`### ${RELEASE_NOTES_HEADING}\n`));
    expect(section).not.toBe(notes);
    const listed = section
      .split("\n")
      .filter((line) => line.startsWith("* **spec:** "))
      .map((line) => line.slice("* **spec:** ".length).replace(/ \(\[a{7}\]\(.*\)\)$/, ""));
    // release-please orders the lines of a section itself.
    expect([...listed].sort()).toEqual(result.breaking.map((b) => b.text).sort());
    expect(listed).toHaveLength(EXPECTED_2026_11_04.length);
  });

  it("lists every change from the sync commit's message when the block does not fit the description", async () => {
    const result = syncPair("2026-11-04-before", "2026-11-04-after");
    const pr = syncPullRequest(result);
    // What the workflow writes for a sync with too many changes to fit: no override block.
    pr.body = pr.body.replace(
      /\n## Release\n[\s\S]*$/,
      releaseSection(result.type, result.breaking, DATE, 100),
    );
    expect(pr.body).not.toContain("BEGIN_COMMIT_OVERRIDE");
    const release = await nextRelease(squashed(pr, commitMessage(result.type, result.breaking, DATE)));
    expect(release?.version).toBe(minor);
    const notes = release!.notes;
    expect(notes).not.toContain("BREAKING");
    expect(notes).toContain("### Features\n\n* **spec:** sync API spec 2026-11-07 (");
    const section = notes.slice(notes.indexOf(`### ${RELEASE_NOTES_HEADING}\n`));
    const listed = section
      .split("\n")
      .filter((line) => line.startsWith("* **spec:** "))
      .map((line) => line.slice("* **spec:** ".length).replace(/ \(\[a{7}\]\(.*\)\)$/, ""));
    expect([...listed].sort()).toEqual(result.breaking.map((b) => b.text).sort());
  });

  it("releases nothing for the 2026-11-06 documentation-only change", async () => {
    const pr = syncPullRequest(syncPair("2026-11-06-before", "2026-11-06-after"));
    expect(await nextRelease(squashed(pr))).toBeNull();
    expect(await nextRelease(merged(pr))).toBeNull();
  });

  it("would have released a major version with the old feat(spec)! override", async () => {
    // The control: the rule this repository followed until 2026-11-06 made 2.0.0.
    const pr = syncPullRequest(syncPair("2026-11-04-before", "2026-11-04-after"));
    pr.body = pr.body.replace(
      /BEGIN_COMMIT_OVERRIDE[\s\S]*END_COMMIT_OVERRIDE/,
      "BEGIN_COMMIT_OVERRIDE\nfeat(spec)!: sync API spec 2026-11-07\n\nBREAKING CHANGE: the API contract changed.\nEND_COMMIT_OVERRIDE",
    );
    const release = await nextRelease(squashed(pr));
    expect(release?.version).toBe(`${Number(released.split(".")[0]) + 1}.0.0`);
  });
});
