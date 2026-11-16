import { afterAll, beforeAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server } from "socket.io";
import { io, type Socket } from "socket.io-client";
import { CollaborativeSetStore } from "../lib/mathex/collaborative-set.server";
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
const ownerPin = "482913";
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

test("missing and non-function acknowledgements do not throw or create sessions", async () => {
  const peer = await client();
  const countBefore = (
    database.query("SELECT COUNT(*) AS count FROM mathex_collaborative_sets").get() as { count: number }
  ).count;

  // Socket.IO permits packets without an acknowledgement ID and with arbitrary arguments.
  for (const name of ["createSession", "joinSession", "getQuestion"]) {
    peer.emit(name, {});
    peer.emit(name, {}, { invalidAck: true });
  }
  peer.emit("createSession", { set: draft, ownerPin });
  peer.emit("createSession", { set: draft, ownerPin }, { invalidAck: true });
  peer.emit("getQuestions");
  peer.emit("getQuestions", { invalidAck: true });
  peer.emit("acquireLock", {}, { invalidAck: true });
  peer.emit("updateQuestion", {}, { invalidAck: true });

  // This response follows all packets above, proving the connection and handler still work.
  const result = await call(peer, "getQuestions");
  expect(result).toEqual({ ok: false, error: "Join the collaborative set first" });
  const countAfter = (
    database.query("SELECT COUNT(*) AS count FROM mathex_collaborative_sets").get() as { count: number }
  ).count;
  expect(countAfter).toBe(countBefore);

  const created = await call(peer, "createSession", { set: draft, ownerPin });
  expect(created.ok).toBe(true);
  peer.emit("joinSession", { sessionToken: created.sessionToken, displayName: "Ignored join" });
  peer.emit("joinSession", { sessionToken: created.sessionToken, displayName: "Ignored join" }, { invalidAck: true });
  expect((await call(peer, "getQuestions")).ok).toBe(false);
  expect((await call(peer, "joinSession", { sessionToken: created.sessionToken, displayName: "Ben" })).ok).toBe(true);
  expect((await call(peer, "getQuestions")).questions[0].contents).toBe(question.contents);
});

test("live locks, bulk loading and question undo preserve other authors' work without per-edit disk writes", async () => {
  const host = await client();
  const created = await call(host, "createSession", { set: draft, ownerPin });
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

test("going live needs an owner PIN, and the PIN is stored only as a hash", async () => {
  const peer = await client();
  expect((await call(peer, "createSession", { set: draft })).ok).toBe(false);
  expect((await call(peer, "createSession", { set: draft, ownerPin: "12345" })).ok).toBe(false);
  const created = await call(peer, "createSession", { set: draft, ownerPin });
  expect(created.ok).toBe(true);
  const row = database
    .query("SELECT owner_pin_hash FROM mathex_collaborative_sets WHERE session_token = ?")
    .get(created.sessionToken) as { owner_pin_hash: string };
  expect(row.owner_pin_hash).toStartWith("scrypt:");
  expect(row.owner_pin_hash).not.toContain(ownerPin);
});

test("the owner PIN moves host access to a new browser and away from the old one", async () => {
  const oldHost = await client();
  const created = await call(oldHost, "createSession", { set: draft, ownerPin });
  const joinedOld = await call(oldHost, "joinSession", {
    sessionToken: created.sessionToken,
    hostToken: created.hostToken,
    displayName: "Ana"
  });
  expect(joinedOld.hasOwnerPin).toBe(true);
  const agent = await call(oldHost, "createAgentToken", {
    label: "Old agent",
    level: "host",
    expiresInMs: 15 * 60_000,
    minterKey: "c".repeat(32)
  });
  expect(agent.ok).toBe(true);

  const newBrowser = await client();
  await call(newBrowser, "joinSession", { sessionToken: created.sessionToken, displayName: "Ana again" });
  expect((await call(newBrowser, "addQuestion", {})).ok).toBe(false);
  expect((await call(newBrowser, "claimHost", { pin: "000000" })).error).toBe("Wrong PIN");

  const revoked = new Promise<void>((resolve) => oldHost.once("hostRevoked", resolve));
  const claimed = await call(newBrowser, "claimHost", { pin: ownerPin });
  expect(claimed.ok).toBe(true);
  await revoked;
  expect((await call(newBrowser, "addQuestion", {})).ok).toBe(true);
  expect((await call(oldHost, "addQuestion", {})).ok).toBe(false);
  expect((await call(newBrowser, "listAgentTokens", { minterKey: "c".repeat(32) })).tokens).toHaveLength(0);

  // The old secret is dead; the new one works on a fresh connection.
  const rejoinOld = await client();
  await call(rejoinOld, "joinSession", {
    sessionToken: created.sessionToken,
    hostToken: created.hostToken,
    displayName: "Ana"
  });
  expect((await call(rejoinOld, "addQuestion", {})).ok).toBe(false);
  const rejoinNew = await client();
  await call(rejoinNew, "joinSession", {
    sessionToken: created.sessionToken,
    hostToken: claimed.hostToken,
    displayName: "Ana"
  });
  expect((await call(rejoinNew, "addQuestion", {})).ok).toBe(true);

  // Only the host can change the PIN.
  expect((await call(rejoinOld, "setOwnerPin", { pin: "111111" })).ok).toBe(false);
  expect((await call(rejoinNew, "setOwnerPin", { pin: "222222" })).ok).toBe(true);
  expect((await call(rejoinOld, "claimHost", { pin: ownerPin })).error).toBe("Wrong PIN");
  expect((await call(rejoinOld, "claimHost", { pin: "222222" })).ok).toBe(true);
});

test("wrong owner PINs lock the set for a while, even across connections", async () => {
  const host = await client();
  const created = await call(host, "createSession", { set: draft, ownerPin });
  const guesses: string[] = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    // A new connection each time, like a guesser reconnecting to dodge the limit.
    const guesser = await client();
    await call(guesser, "joinSession", { sessionToken: created.sessionToken, displayName: "Eve" });
    guesses.push((await call(guesser, "claimHost", { pin: `99999${attempt}` })).error);
  }
  expect(guesses).toEqual(Array(5).fill("Wrong PIN"));
  const late = await client();
  await call(late, "joinSession", { sessionToken: created.sessionToken, displayName: "Ana" });
  const blocked = await call(late, "claimHost", { pin: ownerPin });
  expect(blocked.ok).toBe(false);
  expect(blocked.error).toMatch(/^Too many wrong PINs/);
});

test("databases from before owner PINs are migrated and their sets still load", () => {
  const path = join(mkdtempSync(join(tmpdir(), "mathex-legacy-")), "old.sqlite");
  const legacy = new Database(path);
  legacy.run(
    "CREATE TABLE mathex_collaborative_sets (session_token TEXT PRIMARY KEY, host_token TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL)"
  );
  const sessionToken = "s".repeat(43);
  const set = { ...draft, sessionToken, status: "active", questions: [], updatedAt: 1 };
  legacy
    .query("INSERT INTO mathex_collaborative_sets VALUES (?, ?, ?, ?)")
    .run(sessionToken, "h".repeat(43), JSON.stringify(set), 1);
  legacy.close();

  const store = new CollaborativeSetStore(path);
  const loaded = store.load().get(sessionToken);
  expect(loaded?.hostToken).toBe("h".repeat(43));
  expect(loaded?.ownerPinHash).toBeUndefined();
  store.saveNow({ ...loaded!, ownerPinHash: "scrypt:a:b" });
  expect(new CollaborativeSetStore(path).load().get(sessionToken)?.ownerPinHash).toBe("scrypt:a:b");
});
