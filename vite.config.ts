import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { execFileSync } from "node:child_process";
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
    // Imported lazily so `svelte-kit sync` (which runs under plain Node in CI)
    // can load this config without touching Bun-only modules like bun:sqlite.
    const { createWSServer } = await import("./src/ws/index.server.js");
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
