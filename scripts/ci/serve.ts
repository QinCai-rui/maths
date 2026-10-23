import { mkdtempSync, mkdirSync, createWriteStream } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(".ci-data");
mkdirSync(root, { recursive: true });
mkdirSync("test-results", { recursive: true });
const directory = mkdtempSync(join(root, "browser-"));
const log = createWriteStream("test-results/server.log", { flags: "a" });
const child = Bun.spawn(["bun", "server.ts"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: "5199",
    ORIGIN: "http://127.0.0.1:5199",
    MATHEX_DB_PATH: join(directory, "mathex.sqlite"),
    MATHEX_COLLAB_PERSIST_DELAY_MS: "100",
    TZ: "Pacific/Auckland"
  },
  stdout: "pipe",
  stderr: "pipe"
});

async function forward(stream: ReadableStream<Uint8Array>, output: NodeJS.WriteStream) {
  for await (const chunk of stream) {
    log.write(chunk);
    output.write(chunk);
  }
}

process.once("SIGTERM", () => child.kill("SIGTERM"));
process.once("SIGINT", () => child.kill("SIGINT"));
await Promise.all([forward(child.stdout, process.stdout), forward(child.stderr, process.stderr)]);
const code = await child.exited;
log.end();
process.exitCode = code;
