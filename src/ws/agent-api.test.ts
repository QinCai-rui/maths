import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server } from "socket.io";
import { io, type Socket } from "socket.io-client";
import { registerCollaborativeSetServer } from "./collaborative-set.server";
import { serveAgentApi } from "./agent-api.server";

const question = {
  contents: "<p>Solve $$2x+5=17$$.</p>",
  solutions: [{ type: "number", value: 6, group: 0 }],
  allowEquivalent: true,
  answerComment: "",
  requireAllSolutionGroups: false,
  solutionOrderMatters: false,
  skippable: true
};
const draft = {
  name: "Algebra relay",
  instructions: "<p>No calculators.</p>",
  questions: [question, { ...question, contents: "<p>Second</p>" }],
  pdfOptions: { questionTextSize: 11, answerTextSize: 11, imageHeight: 30, slipHeight: 49.5, cutMargin: 50 }
};
const minterKey = "a".repeat(32);
const server = createServer();
const transport = new Server(server);
const sockets: Socket[] = [];
const previousPath = process.env.MATHEX_DB_PATH;
let base: string;
let realtime: ReturnType<typeof registerCollaborativeSetServer>;
let ipCounter = 0;

async function client() {
  const socket = io(`${base}/set-collaboration`, { forceNew: true, transports: ["websocket"] });
  sockets.push(socket);
  await new Promise<void>((resolve) => socket.once("connect", resolve));
  return socket;
}

function call(socket: Socket, name: string, ...args: unknown[]): Promise<any> {
  return new Promise((resolve, reject) => {
    socket.timeout(3000).emit(name, ...args, (error: Error | null, result: unknown) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

/** Each test gets its own fake client IP so the per-IP limits do not leak between tests. */
function api(token: string | null, ip = `10.0.0.${++ipCounter}`) {
  return async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}/mathex/app/api${path}`, {
      method,
      headers: {
        "CF-Connecting-IP": ip,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const type = response.headers.get("content-type") || "";
    return {
      status: response.status,
      headers: response.headers,
      body: type.includes("json") ? await response.json() : await response.text()
    };
  };
}

async function liveSet() {
  const host = await client();
  const created = await call(host, "createSession", { set: draft, ownerPin: "135790" });
  await call(host, "joinSession", {
    sessionToken: created.sessionToken,
    hostToken: created.hostToken,
    displayName: "Ray"
  });
  const editor = await client();
  await call(editor, "joinSession", { sessionToken: created.sessionToken, displayName: "Sam" });
  return { host, editor, sessionToken: created.sessionToken as string };
}

async function mint(socket: Socket, level: "editor" | "host", key = minterKey) {
  const result = await call(socket, "createAgentToken", {
    label: "Ray's agent",
    level,
    expiresInMs: 15 * 60_000,
    minterKey: key
  });
  expect(result.ok).toBe(true);
  return result.token as string;
}

beforeAll(async () => {
  process.env.MATHEX_DB_PATH = join(mkdtempSync(join(tmpdir(), "mathex-agent-")), "test.sqlite");
  realtime = registerCollaborativeSetServer(transport);
  server.prependListener("request", (request, response) => {
    if (request.url?.startsWith("/mathex/app/api")) void serveAgentApi(realtime.handleAgentApi, request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(() => {
  for (const socket of sockets) socket.disconnect();
  realtime.flush();
  transport.close();
  server.close();
  if (previousPath === undefined) delete process.env.MATHEX_DB_PATH;
  else process.env.MATHEX_DB_PATH = previousPath;
});

test("docs are public and everything else needs a token", async () => {
  const anonymous = api(null);
  const docs = await anonymous("GET", "/llms.txt");
  expect(docs.status).toBe(200);
  expect(docs.body).toContain("Authorization: Bearer");
  expect((await anonymous("GET", "/openapi.json")).body.openapi).toBe("3.1.0");
  expect((await anonymous("GET", "/set")).status).toBe(401);
  expect((await api("mxa_wrong")("GET", "/set")).status).toBe(401);
});

test("editor tokens edit questions but cannot change structure", async () => {
  const { editor, host } = await liveSet();
  const agent = api(await mint(editor, "editor"));
  const set = await agent("GET", "/set");
  expect(set.status).toBe(200);
  expect(set.body.questions).toHaveLength(2);
  expect(set.body.token.level).toBe("editor");

  const updates: unknown[] = [];
  host.on("questionUpdated", (value) => updates.push(value));
  const id = set.body.questions[0].id;
  const edited = await agent("PUT", `/questions/${id}`, { ...question, contents: "<p>Changed</p>", solutions: [] });
  expect(edited.status).toBe(200);
  expect(edited.body.issues.warnings).toContain("No solutions");
  await Bun.sleep(50);
  expect(updates).toHaveLength(1);

  expect((await agent("POST", "/questions", {})).status).toBe(403);
  expect((await agent("DELETE", `/questions/${id}`)).status).toBe(403);
  expect((await agent("PATCH", "/set", { name: "x" })).status).toBe(403);
  expect((await agent("POST", "/set/end")).status).toBe(403);
  expect((await agent("PUT", `/questions/${id}`, { contents: 5 })).status).toBe(400);

  const exported = await agent("GET", "/set/export");
  expect(exported.body.questions[0].id).toBeUndefined();
  expect((await agent("GET", "/set/checks")).body.questions[0].warnings).toContain("No solutions");
});

test("editors cannot mint host tokens", async () => {
  const { editor } = await liveSet();
  const result = await call(editor, "createAgentToken", {
    label: "x",
    level: "host",
    expiresInMs: 15 * 60_000,
    minterKey
  });
  expect(result.ok).toBe(false);
});

test("host tokens can do every host action", async () => {
  const { host } = await liveSet();
  const agent = api(await mint(host, "host"));
  const [first, second] = (await agent("GET", "/questions")).body;

  expect(
    (await agent("PATCH", "/set", { name: "Renamed", pdfOptions: { ...draft.pdfOptions, cutMargin: 10 } })).body.name
  ).toBe("Renamed");
  const added = await agent("POST", "/questions", { question, afterQuestionId: null });
  expect(added.status).toBe(201);
  expect(added.body.number).toBe(1);
  const copy = await agent("POST", `/questions/${second.id}/duplicate`, {});
  expect(copy.body.number).toBe(4);
  expect((await agent("POST", `/questions/${first.id}/move`, { toIndex: 3 })).body.number).toBe(4);
  expect((await agent("DELETE", `/questions/${copy.body.id}`)).status).toBe(200);
  expect((await agent("GET", "/questions")).body.map(({ id }: { id: string }) => id)).toEqual([
    added.body.id,
    second.id,
    first.id
  ]);

  const replaced = await agent("PUT", "/set", [question]);
  expect(replaced.body.questions).toHaveLength(1);
  expect(replaced.body.name).toBe("");

  expect((await agent("POST", "/set/end")).status).toBe(200);
  expect((await agent("GET", "/set")).status).toBe(401);
});

test("a person's lock blocks the agent with a clear 409", async () => {
  const { host, editor } = await liveSet();
  const agent = api(await mint(host, "host"));
  const [first] = (await agent("GET", "/questions")).body;
  expect((await call(editor, "acquireLock", { questionId: first.id })).ok).toBe(true);
  const blocked = await agent("PUT", `/questions/${first.id}`, question);
  expect(blocked.status).toBe(409);
  expect(blocked.body.error).toBe("Sam is editing Q1. Try again shortly.");
  expect(blocked.headers.get("retry-after")).toBe("10");
  expect((await agent("DELETE", `/questions/${first.id}`)).status).toBe(409);
});

test("agents appear in presence and tokens can be listed and revoked", async () => {
  const { host, editor } = await liveSet();
  const editorToken = await mint(editor, "editor", "b".repeat(32));
  await mint(host, "host");
  const presence = new Promise<any[]>((resolve) => host.once("presence", resolve));
  await api(editorToken)("GET", "/set");
  const people = await presence;
  expect(people.find((person) => person.isAgent)?.displayName).toBe("Ray's agent");

  const mine = await call(editor, "listAgentTokens", { minterKey: "b".repeat(32) });
  expect(mine.tokens).toHaveLength(1);
  const all = await call(host, "listAgentTokens", { minterKey });
  expect(all.tokens).toHaveLength(2);
  const hostToken = all.tokens.find((token: { mine: boolean }) => token.mine);
  expect((await call(editor, "revokeAgentToken", { id: hostToken.id, minterKey: "b".repeat(32) })).ok).toBe(false);
  expect((await call(editor, "revokeAgentToken", { id: mine.tokens[0].id, minterKey: "b".repeat(32) })).ok).toBe(true);
  expect((await api(editorToken)("GET", "/set")).status).toBe(401);
});

test("agents can revoke their own token", async () => {
  const { host } = await liveSet();
  const agent = api(await mint(host, "editor"));
  expect((await agent("DELETE", "/token")).status).toBe(200);
  expect((await agent("GET", "/set")).status).toBe(401);
});

test("rate limits per token and for failed token checks", async () => {
  const { host } = await liveSet();
  const token = await mint(host, "editor");
  let last = 0;
  // Spread across IPs so only the per-token limit applies.
  for (let index = 0; index < 61; index++) last = (await api(token)("GET", "/set")).status;
  expect(last).toBe(429);

  const guesser = api("mxa_wrong", "10.9.9.9");
  for (let index = 0; index < 10; index++) expect((await guesser("GET", "/set")).status).toBe(401);
  const locked = await guesser("GET", "/set");
  expect(locked.status).toBe(429);
  expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
});

test("rate limits per IP", async () => {
  const anonymous = api(null, "10.8.8.8");
  let last = 0;
  for (let index = 0; index < 121; index++) last = (await anonymous("GET", "/llms.txt")).status;
  expect(last).toBe(429);
});
