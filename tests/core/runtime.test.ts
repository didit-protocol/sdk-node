import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function fresh() {
  vi.resetModules();
  return import("../../src/core/runtime.js");
}

describe("runtime", () => {
  it("reads and trims environment variables", async () => {
    const { readEnv } = await fresh();
    vi.stubEnv("DIDIT_TEST_VALUE", "  x  ");
    expect(readEnv("DIDIT_TEST_VALUE")).toBe("x");
    vi.stubEnv("DIDIT_TEST_VALUE", "   ");
    expect(readEnv("DIDIT_TEST_VALUE")).toBeUndefined();
  });

  it("reads Deno's environment and treats a denied permission as unset", async () => {
    const { readEnv } = await fresh();
    vi.stubGlobal("process", undefined);
    vi.stubGlobal("Deno", { env: { get: (name: string) => (name === "A" ? "deno" : undefined) } });
    expect(readEnv("A")).toBe("deno");
    vi.stubGlobal("Deno", {
      env: {
        get: () => {
          throw new Error("PermissionDenied");
        },
      },
    });
    expect(readEnv("A")).toBeUndefined();
  });

  it("names Node.js in the User-Agent", async () => {
    const { userAgent, clientHeader } = await fresh();
    expect(userAgent()).toMatch(/^didit-node\/\d+\.\d+\.\d+ \(node \d+\.\d+\.\d+; \w+\)$/);
    expect(clientHeader()).toMatch(/^node\/\d+\.\d+\.\d+$/);
  });

  it.each([
    ["Bun", () => vi.stubGlobal("process", { versions: { bun: "1.2.3", node: "22.0.0" }, platform: "darwin" }), "bun 1.2.3; darwin"],
    [
      "Deno",
      () => {
        vi.stubGlobal("process", undefined);
        vi.stubGlobal("Deno", { version: { deno: "2.1.0" }, build: { os: "linux" } });
      },
      "deno 2.1.0; linux",
    ],
    [
      "Cloudflare Workers",
      () => {
        vi.stubGlobal("process", undefined);
        vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
      },
      "workerd unknown; unknown",
    ],
    [
      "Vercel Edge",
      () => {
        vi.stubGlobal("process", undefined);
        vi.stubGlobal("EdgeRuntime", "edge-runtime");
      },
      "edge-runtime unknown; unknown",
    ],
    [
      "an unknown runtime",
      () => {
        vi.stubGlobal("process", undefined);
        vi.stubGlobal("navigator", undefined);
      },
      "unknown unknown; unknown",
    ],
  ])("names %s in the User-Agent", async (_name, stub, expected) => {
    const runtime = await fresh();
    stub();
    expect(runtime.userAgent()).toContain(`(${expected})`);
  });

  it("uses the global Web Crypto, or node:crypto on Node.js 18", async () => {
    const globalCrypto = globalThis.crypto;
    let runtime = await fresh();
    expect(await runtime.webCrypto()).toBe(globalCrypto);
    vi.stubGlobal("crypto", undefined);
    runtime = await fresh();
    const loaded = await runtime.webCrypto();
    expect(typeof loaded.subtle.digest).toBe("function");
    expect(await runtime.webCrypto()).toBe(loaded);
  });
});
