import express from "express";
import { createServer } from "http";
import { verifyConnection } from "./src/lib/mathex/verification.server";
import { createWSServer } from "./src/ws/index.server";
// @ts-ignore
import { handler } from "./build/handler.js";

const port = Number(process.env.PORT) || 5185;
const app = express();
const server = createServer(app);
const realtime = createWSServer(server);

// Read-only status probe for failed handshakes. Never redirects to challenge HTML.
app.get("/mathex/connection-check", async (request, response) => {
  const status = await verifyConnection(request);
  response
    .set("Cache-Control", "no-store")
    .status(status)
    .json({
      code: status === 403 ? "VERIFICATION_REQUIRED" : status === 503 ? "UNAVAILABLE" : "OK"
    });
});

// SvelteKit should handle everything else using Express middleware
app.use(handler);

server.listen(port, process.env.HOST || "0.0.0.0");

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  realtime.dispose();
  realtime.flush();
  realtime.io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
