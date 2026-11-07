# workerd configuration for tests/smoke/workerd.mjs (Cloudflare Workers runtime).
# Run from the repository root after `pnpm build`:
#   npx workerd serve tests/smoke/workerd.capnp --experimental
using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [(name = "main", worker = .smoke)],
  sockets = [(name = "http", address = "127.0.0.1:8787", http = (), service = "main")],
);

const smoke :Workerd.Worker = (
  modules = [
    (name = "workerd.mjs", esModule = embed "workerd.mjs"),
    (name = "checks.mjs", esModule = embed "checks.mjs"),
    (name = "sdk.js", esModule = embed "../../dist/index.js"),
    (name = "webhook-vectors.json", json = embed "../../openapi/webhook-vectors.json"),
  ],
  compatibilityDate = "2025-09-01",
);
