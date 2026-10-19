import { afterAll, beforeAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server } from "socket.io";
import { io, type Socket } from "socket.io-client";
import { registerCollaborativeSetServer } from "./collaborative-set.server";

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
  questions: [question],
  pdfOptions: { questionTextSize: 11, answerTextSize: 11, imageHeight: 30, slipHeight: 49.5, cutMargin: 50 }
};
const server = createServer();
const transport = new Server(server);
const sockets: Socket[] = [];
const previousPath = process.env.MATHEX_DB_PATH;
let base: string;
let database: Database;
let realtime: ReturnType<typeof registerCollaborativeSetServer>;

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

beforeAll(async () => {
  const path = join(mkdtempSync(join(tmpdir(), "mathex-collaboration-")), "test.sqlite");
  process.env.MATHEX_DB_PATH = path;
  realtime = registerCollaborativeSetServer(transport);
  database = new Database(path);
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
  database.close();
  if (previousPath === undefined) delete process.env.MATHEX_DB_PATH;
  else process.env.MATHEX_DB_PATH = previousPath;
});

test("live locks, bulk loading and question undo preserve other authors' work without per-edit disk writes", async () => {
  const host = await client();
  const created = await call(host, "createSession", { set: draft });
  expect(created.ok).toBe(true);
  const hostState = await call(host, "joinSession", {
    sessionToken: created.sessionToken,
    hostToken: created.hostToken,
    displayName: "Ana"
  });
  const peer = await client();
  await call(peer, "joinSession", { sessionToken: created.sessionToken, displayName: "Ben" });
  const loaded = await call(host, "getQuestions");
  expect(loaded.questions[0].contents).toBe(question.contents);
  const before = { ...hostState.state.set, questions: loaded.questions };
  const questionId = loaded.questions[0].id;

  expect((await call(host, "acquireLock", { questionId })).ok).toBe(true);
  expect((await call(peer, "acquireLock", { questionId })).ok).toBe(false);
  expect((await call(peer, "addQuestion", {})).ok).toBe(false);

  let heartbeatBroadcasts = 0;
  peer.on("lockChanged", () => heartbeatBroadcasts++);
  expect((await call(host, "refreshLock", { questionId })).ok).toBe(true);
  const changed = { ...question, contents: "<p>Solve $$2x+5=17$$. Show your working.</p>" };
  expect((await call(host, "updateQuestion", { questionId, question: changed })).ok).toBe(true);
  expect(heartbeatBroadcasts).toBe(0);

  const storedBeforeFlush = JSON.parse(
    (
      database
        .query("SELECT data FROM mathex_collaborative_sets WHERE session_token = ?")
        .get(created.sessionToken) as { data: string }
    ).data
  );
  expect(storedBeforeFlush.questions[0].contents).toBe(question.contents);
  realtime.flush();
  const storedAfterFlush = JSON.parse(
    (
      database
        .query("SELECT data FROM mathex_collaborative_sets WHERE session_token = ?")
        .get(created.sessionToken) as { data: string }
    ).data
  );
  expect(storedAfterFlush.questions[0].contents).toBe(changed.contents);

  await call(host, "releaseLock", { questionId });
  const after = { ...before, questions: [{ id: questionId, ...changed }] };
  let peerUndoText = "";
  peer.on("questionUpdated", (value) => (peerUndoText = value.contents));
  const undone = await call(host, "applyClientHistory", {
    target: { type: "question", questionId },
    expected: after,
    desired: before
  });
  expect(undone.ok).toBe(true);
  // A round trip after the broadcast makes its delivery deterministic.
  await call(peer, "getQuestions");
  expect(peerUndoText).toBe(question.contents);

  // A stale undo must never overwrite a co-author's newer edit.
  await call(peer, "acquireLock", { questionId });
  await call(peer, "updateQuestion", { questionId, question: { ...question, contents: "Ben's new question" } });
  await call(peer, "releaseLock", { questionId });
  const stale = await call(host, "applyClientHistory", {
    target: { type: "question", questionId },
    expected: before,
    desired: after
  });
  expect(stale.ok).toBe(false);
  expect((await call(host, "getQuestions")).questions[0].contents).toBe("Ben's new question");
});
