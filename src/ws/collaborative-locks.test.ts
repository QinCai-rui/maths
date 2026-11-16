import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server } from "socket.io";
import { io, type Socket } from "socket.io-client";
import { registerCollaborativeSetServer } from "./collaborative-set.server";

const question = {
  contents: "<p>One</p>",
  solutions: [],
  allowEquivalent: true,
  answerComment: "",
  requireAllSolutionGroups: false,
  solutionOrderMatters: false,
  skippable: true
};
const draft = {
  name: "Locks",
  instructions: "",
  questions: [question],
  pdfOptions: { questionTextSize: 11, answerTextSize: 11, imageHeight: 30, slipHeight: 49.5, cutMargin: 50 }
};
const server = createServer();
const transport = new Server(server);
const sockets: Socket[] = [];
const previous = {
  path: process.env.MATHEX_DB_PATH
};
let base: string;
let realtime: ReturnType<typeof registerCollaborativeSetServer>;

async function client() {
  const socket = io(`${base}/set-collaboration`, { forceNew: true, transports: ["websocket"] });
  sockets.push(socket);
  await new Promise<void>((resolve) => socket.once("connect", resolve));
  return socket;
}

function call(socket: Socket, name: string, ...args: unknown[]): Promise<any> {
  return socket.timeout(3000).emitWithAck(name, ...args);
}

async function setWithEditor() {
  const host = await client();
  const created = await call(host, "createSession", { set: draft, ownerPin: "123456" });
  await call(host, "joinSession", { sessionToken: created.sessionToken, displayName: "Ana" });
  const watcher = await client();
  await call(watcher, "joinSession", { sessionToken: created.sessionToken, displayName: "Ben" });
  const questionId = (await call(host, "getQuestions")).questions[0].id as string;
  expect((await call(host, "acquireLock", { questionId })).ok).toBe(true);
  return { host, watcher, questionId };
}

function released(socket: Socket, questionId: string) {
  const started = Date.now();
  return new Promise<{ reason: string | undefined; after: number }>((resolve) => {
    socket.on("lockChanged", (id: string, lock: unknown, reason?: string) => {
      if (id === questionId && lock === null) resolve({ reason, after: Date.now() - started });
    });
  });
}

beforeAll(async () => {
  process.env.MATHEX_DB_PATH = join(mkdtempSync(join(tmpdir(), "mathex-locks-")), "test.sqlite");
  // Shortened timings, so the expiry rules can be tested in seconds.
  realtime = registerCollaborativeSetServer(transport, { lockTtlMs: 5000, lockIdleMs: 10_000 });
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
  if (previous.path === undefined) delete process.env.MATHEX_DB_PATH;
  else process.env.MATHEX_DB_PATH = previous.path;
});

test("a lock ends soon after the last keepalive", async () => {
  const { watcher, questionId } = await setWithEditor();
  const result = await released(watcher, questionId);
  expect(result.reason).toBe("expired");
  expect(result.after).toBeGreaterThanOrEqual(4500);
  expect(result.after).toBeLessThan(6500);
}, 10_000);

test("keepalives alone do not hold a lock past the idle limit, but edits do", async () => {
  const { host, watcher, questionId } = await setWithEditor();
  const end = released(watcher, questionId);
  const keepalive = setInterval(() => host.emit("refreshLock", { questionId }), 1000);
  try {
    // An edit 4 s in restarts the idle clock, so the lock should last about 14 s in total.
    await Bun.sleep(4000);
    const edit = { ...question, contents: "<p>Edited</p>" };
    expect((await call(host, "updateQuestion", { questionId, question: edit })).ok).toBe(true);
    // Saving unchanged content is not an edit.
    await Bun.sleep(2000);
    expect((await call(host, "updateQuestion", { questionId, question: edit })).ok).toBe(true);
    const result = await end;
    expect(result.reason).toBe("idle");
    expect(result.after).toBeGreaterThanOrEqual(13_500);
    expect(result.after).toBeLessThan(15_500);
    expect((await call(host, "updateQuestion", { questionId, question })).ok).toBe(false);
    expect((await call(watcher, "acquireLock", { questionId })).ok).toBe(true);
  } finally {
    clearInterval(keepalive);
  }
}, 20_000);
