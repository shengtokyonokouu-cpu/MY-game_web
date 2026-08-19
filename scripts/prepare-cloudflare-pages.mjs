import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { build as viteBuild } from "vite";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
const client = join(dist, "client");
const server = join(dist, "server");
const pages = join(dist, "pages");
const redirectedWranglerConfig = join(root, ".wrangler", "deploy", "config.json");

for (const required of [client, join(server, "index.js")]) {
  if (!existsSync(required)) throw new Error(`Missing vinext build output: ${required}`);
}

rmSync(pages, { recursive: true, force: true });
mkdirSync(pages, { recursive: true });
cpSync(client, pages, { recursive: true });
rmSync(redirectedWranglerConfig, { force: true });

const workerSource = readFileSync(join(server, "index.js"), "utf8")
  .replace(
    'import * as __viteRscAsyncHooks from "node:async_hooks";',
    'import * as __viteRscAsyncHooks from "./_async_hooks_shim.js";',
  )
  .replace(
    'import { AsyncLocalStorage as AsyncLocalStorage$1 } from "node:async_hooks";',
    'import { AsyncLocalStorage as AsyncLocalStorage$1 } from "./_async_hooks_shim.js";',
  )
  .replaceAll('from"node:async_hooks"', 'from"./_async_hooks_shim.js"')
  .replace('import "node:fs";\nimport "node:path";\n', "");

writeFileSync(join(pages, "_worker.js"), `globalThis.process ??= { env: {}, versions: {} };\n${workerSource}`);
writeFileSync(
  join(pages, "_async_hooks_shim.js"),
  `const NativeAsyncLocalStorage = globalThis.AsyncLocalStorage;
class PortableAsyncLocalStorage {
  constructor() { this.store = undefined; }
  getStore() { return this.store; }
  enterWith(store) { this.store = store; }
  run(store, callback, ...args) {
    const previousStore = this.store;
    this.store = store;
    try {
      const result = callback(...args);
      if (result && typeof result.then === "function") {
        return Promise.resolve(result).finally(() => {
          if (this.store === store) this.store = previousStore;
        });
      }
      this.store = previousStore;
      return result;
    } catch (error) {
      this.store = previousStore;
      throw error;
    }
  }
  exit(callback, ...args) { return this.run(undefined, callback, ...args); }
  disable() { this.store = undefined; }
  static bind(callback) { return callback; }
  static snapshot() { return (callback, ...args) => callback(...args); }
}
export const AsyncLocalStorage = NativeAsyncLocalStorage ?? PortableAsyncLocalStorage;
`,
);

for (const directory of ["_next", "assets", "ssr"]) {
  const source = join(server, directory);
  if (existsSync(source)) cpSync(source, join(pages, directory), { recursive: true, force: true });
}

const ssrEntry = join(pages, "ssr", "index.js");
if (existsSync(ssrEntry)) {
  const ssrSource = readFileSync(ssrEntry, "utf8")
    .replace(
      'import * as __viteRscAsyncHooks from "node:async_hooks";',
      'import * as __viteRscAsyncHooks from "../_async_hooks_shim.js";',
    )
    .replace(
      'import { AsyncLocalStorage as AsyncLocalStorage$1 } from "node:async_hooks";',
      'import { AsyncLocalStorage as AsyncLocalStorage$1 } from "../_async_hooks_shim.js";',
    )
    .replace(/import\((["'`])\.\.\/index\.js\1\)/g, 'import("../_worker.js")');
  writeFileSync(ssrEntry, ssrSource);
}

for (const file of [
  "__vite_rsc_assets_manifest.js",
  "image-config.json",
  "vinext-externals.json",
  "vinext-server.json",
  "vinext-client-assets.js",
  "BUILD_ID",
]) {
  const source = join(server, file);
  if (existsSync(source)) copyFileSync(source, join(pages, file));
}

const workerBundle = join(dist, "pages-worker-bundle");
await viteBuild({
  configFile: false,
  logLevel: "warn",
  build: {
    codeSplitting: false,
    emptyOutDir: true,
    lib: { entry: join(pages, "_worker.js"), formats: ["es"], fileName: () => "_worker.js" },
    minify: false,
    outDir: workerBundle,
    rolldownOptions: { external: ["cloudflare:workers", /^node:/] },
    target: "es2022",
  },
});
cpSync(workerBundle, pages, { recursive: true, force: true });
rmSync(workerBundle, { recursive: true, force: true });

const bundledWorkerPath = join(pages, "_worker.js");
const bundledWorkerSource = readFileSync(bundledWorkerPath, "utf8");
const defaultExportPattern = /export\s*\{\s*([A-Za-z_$][\w$]*)\s+as\s+default\s*\};/;
const defaultExportMatch = bundledWorkerSource.match(defaultExportPattern);
if (!defaultExportMatch) {
  throw new Error("Unable to wrap the generated Pages Worker export.");
}
const workerDefault = defaultExportMatch[1];

writeFileSync(
  bundledWorkerPath,
  bundledWorkerSource.replace(
    defaultExportPattern,
    `const pagesWorker = {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    const isStaticAsset =
      pathname.startsWith("/assets/") ||
      pathname.startsWith("/_next/") ||
      /\\.[a-zA-Z0-9]+$/.test(pathname);
    if (isStaticAsset && env?.ASSETS) {
      const response = await env.ASSETS.fetch(request);
      if (response.status !== 404) return response;
    }
    return ${workerDefault}.fetch(request, env, ctx);
  },
};
export { pagesWorker as default };`,
  ),
);

console.log(`Prepared Cloudflare Pages output at ${pages}`);
