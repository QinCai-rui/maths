import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { type ViteDevServer, defineConfig } from "vite";

function resolveCommitHash() {
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT.slice(0, 7);

  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const buildCommit = resolveCommitHash();
const buildTime = process.env.BUILD_TIME ?? new Date().toISOString();

const webSocketServer = {
  name: "webSocketServer",
  async configureServer(server: ViteDevServer) {
    if (!server.httpServer) return;
    // The specifier is built at runtime so config bundlers (rolldown) cannot
    // follow it into Bun-only modules like bun:sqlite. Plain Node loading
    // vite.config.ts (e.g. `svelte-kit sync` in CI) therefore never touches
    // them; only `vite dev` under Bun executes this import. Resolved from the
    // Vite project root (not the launch directory) and converted to a file
    // URL so it works across platforms.
    const wsEntry = pathToFileURL(`${server.config.root}/src/ws/index.server.ts`).href;
    const { createWSServer } = (await import(wsEntry)) as typeof import("./src/ws/index.server.js");
    const realtime = createWSServer(server.httpServer);
    server.httpServer.once("close", () => {
      realtime.dispose();
      realtime.flush();
    });
  }
};

export default defineConfig({
  plugins: [
    sveltekit({
      // Consult https://kit.svelte.dev/docs/integrations#preprocessors
      // for more information about preprocessors
      preprocess: vitePreprocess(),

      // If your environment is not supported, or you settled on a specific environment, switch out the adapter.
      // See https://kit.svelte.dev/docs/adapters for more information about adapters.
      adapter: adapter()
    }),
    tailwindcss(),
    webSocketServer
  ],
  define: {
    __BUILD_COMMIT__: JSON.stringify(buildCommit),
    __BUILD_TIME__: JSON.stringify(buildTime)
  }
});
