// Sync openapi/ with the published API contract (docs/DESIGN.md section 3.1).
//
//   node codegen/spec-sync.ts [--summary FILE] [--from-dir DIR]
//
// Downloads https://docs.didit.me/openapi-25.json and openapi-auth.json and,
// when either changed, updates openapi/ (see codegen/lib/sync.ts). Writes
// changed=true|false and breaking=true|false to $GITHUB_OUTPUT when set. The
// generator, not this script, regenerates the code.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SpecSyncError, sync, UPSTREAM } from "./lib/sync.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OPENAPI = join(ROOT, "openapi");
const LOCAL = ["SOURCE.json", "overlay.json", "deprecated-operations.json", ...Object.keys(UPSTREAM)];

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: { "User-Agent": "didit-sdk-node spec-sync" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new SpecSyncError(`${url}: HTTP ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
  return pkg.version;
}

async function main(): Promise<void> {
  const fromDir = argument("--from-dir");
  const summaryPath = argument("--summary");
  const downloads = new Map<string, Uint8Array>();
  try {
    for (const [name, url] of Object.entries(UPSTREAM)) {
      downloads.set(name, fromDir ? new Uint8Array(readFileSync(join(fromDir, name))) : await download(url));
    }
  } catch (error) {
    console.error(`spec sync could not download the documents, nothing was written: ${(error as Error).message}`);
    process.exit(1);
  }
  const files = new Map<string, Uint8Array | undefined>();
  for (const name of LOCAL) {
    const path = join(OPENAPI, name);
    files.set(name, existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined);
  }
  const now = new Date();
  let result: ReturnType<typeof sync>;
  try {
    result = sync({ files, downloads, now, version: packageVersion() });
  } catch (error) {
    if (error instanceof SpecSyncError) {
      console.error(`spec sync refused the download, nothing was written: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
  for (const [name, data] of result.writes) writeFileSync(join(OPENAPI, name), data);
  if (summaryPath) writeFileSync(summaryPath, result.summary);
  console.log(result.summary);
  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    appendFileSync(
      output,
      `changed=${String(result.changed)}\nbreaking=${String(result.breaking)}\ndate=${now.toISOString().slice(0, 10)}\n`,
    );
  }
}

await main();
