import { afterAll, afterEach, expect, test } from "bun:test";
import type { IncomingMessage } from "node:http";
import { verifyConnection } from "./verification.server";

const previous = process.env.ANUBIS_CHECK_URL;
const server = Bun.serve({
  port: 0,
  fetch: (request) => {
    const path = new URL(request.url, "http://localhost").pathname;
    if (
      path === "/ok" &&
      request.headers.get("cookie") === "pass=valid" &&
      request.headers.get("user-agent") === "test-browser" &&
      request.headers.get("cf-connecting-ip") === "203.0.113.1"
    )
      return new Response(null);
    return new Response(null, { status: path === "/down" ? 503 : 401 });
  }
});
const request = {
  headers: {
    cookie: "pass=valid",
    "user-agent": "test-browser",
    "cf-connecting-ip": "203.0.113.1",
    host: "maths.qincai.xyz"
  }
} as Pick<IncomingMessage, "headers">;
afterEach(() => {
  if (previous === undefined) delete process.env.ANUBIS_CHECK_URL;
  else process.env.ANUBIS_CHECK_URL = previous;
});
afterAll(() => server.stop(true));
test("development works without a configured validator", async () => {
  delete process.env.ANUBIS_CHECK_URL;
  expect(await verifyConnection(request)).toBe(200);
});
test("forwards the pass and browser identity to the validator", async () => {
  process.env.ANUBIS_CHECK_URL = `${server.url}ok`;
  expect(await verifyConnection(request)).toBe(200);
});
test("missing passes and unavailable validation fail closed", async () => {
  process.env.ANUBIS_CHECK_URL = `${server.url}ok`;
  expect(await verifyConnection({ headers: {} } as Pick<IncomingMessage, "headers">)).toBe(403);
  process.env.ANUBIS_CHECK_URL = `${server.url}down`;
  expect(await verifyConnection(request)).toBe(503);
  process.env.ANUBIS_CHECK_URL = "http://127.0.0.1:1/check";
  expect(await verifyConnection(request)).toBe(503);
});
