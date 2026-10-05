import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { Database } from "bun:sqlite";
import { io, type Socket } from "socket.io-client";
import { createWSServer } from "./index.server";
import { DEFAULT_ROOM_SETTINGS, type RoomSettings } from "../lib/mathex/schemas";
import { RoomStore } from "../lib/mathex/rooms.server";

const question = {
  contents: "2 + 2",
  solutions: [{ type: "number", value: 4, group: 0 }],
  allowEquivalent: true,
  answerComment: "",
  requireAllSolutionGroups: false,
  solutionOrderMatters: false,
  skippable: true
};
const sockets: Socket[] = [];
let server: Server;
let realtime: ReturnType<typeof createWSServer>;
let base: string;
let databasePath: string;
const previousDatabase = process.env.MATHEX_DB_PATH;

function event<T = any>(socket: Socket, name: string, timeout = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(name, listener);
      reject(new Error(`Timed out waiting for ${name}`));
    }, timeout);
    const listener = (value: T) => {
      clearTimeout(timer);
      resolve(value);
    };
    socket.once(name, listener);
  });
}
function eventWhere<T>(socket: Socket, name: string, predicate: (value: T) => boolean, timeout = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(name, listener);
      reject(new Error(`Timed out waiting for matching ${name}`));
    }, timeout);
    const listener = (value: T) => {
      if (!predicate(value)) return;
      clearTimeout(timer);
      socket.off(name, listener);
      resolve(value);
    };
    socket.on(name, listener);
  });
}
async function connect(namespace: string, query = {}) {
  const socket = io(base + namespace, { autoConnect: false, forceNew: true, transports: ["websocket"], query });
  sockets.push(socket);
  const connected = event(socket, "connect");
  socket.connect();
  await connected;
  return socket;
}
async function createRoom(settings: Partial<RoomSettings> = {}, questions = [question, question, question]) {
  const creator = await connect("/rooms");
  const destination = event<string>(creator, "goto");
  creator.emit("newRoom", "Test room", questions, 1000, false, {
    ...DEFAULT_ROOM_SETTINGS,
    ...settings
  });
  const url = new URL(await destination, base);
  const id = url.searchParams.get("id")!;
  const host = io(base + `/manage-${id}`, {
    autoConnect: false,
    forceNew: true,
    transports: ["websocket"],
    query: { runToken: url.searchParams.get("runToken")! }
  });
  sockets.push(host);
  const ready = event(host, "roomSettings");
  host.connect();
  await ready;
  return { host, id };
}
async function join(id: string, name = "Alice", playerId = "alice") {
  const player = await connect(`/room-${id}`);
  const joined = event(player, "joined");
  player.emit("join", name, playerId);
  await joined;
  return player;
}
async function start(host: Socket, player: Socket) {
  const begun = event(player, "gameStart");
  const firstQuestion = event(player, "newQuestion");
  host.emit("start");
  await begun;
  await firstQuestion;
}
async function change(host: Socket, value: Partial<RoomSettings>) {
  const updated = event<RoomSettings>(host, "roomSettings");
  host.emit("updateSettings", value);
  return await updated;
}

beforeAll(async () => {
  databasePath = `${mkdtempSync("/tmp/opencode/maths-room-tests-")}/rooms.sqlite`;
  process.env.MATHEX_DB_PATH = databasePath;
  server = createServer();
  realtime = createWSServer(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  realtime.dispose();
  realtime.flush();
  await new Promise<void>((resolve) => realtime.io.close(() => resolve()));
  if (previousDatabase === undefined) delete process.env.MATHEX_DB_PATH;
  else process.env.MATHEX_DB_PATH = previousDatabase;
});

describe("online rooms through real sockets", () => {
  test("late joining is denied but a saved player can reconnect", async () => {
    const { host, id } = await createRoom({ allowLateJoin: false });
    const alice = await join(id);
    await start(host, alice);
    alice.disconnect();
    const returning = await connect(`/room-${id}`);
    const resumed = event(returning, "gameStart");
    returning.emit("join", "Alice", "alice");
    await resumed;
    const late = await connect(`/room-${id}`);
    const denied = event<string>(late, "joinDenied");
    late.emit("join", "Bob", "bob");
    expect(await denied).toContain("Late joining");
  });
  test("denied and unjoined sockets receive neither room chat nor standings", async () => {
    const { host, id } = await createRoom({ allowLateJoin: false, allowChat: true });
    const alice = await join(id);
    await start(host, alice);
    const denied = await connect(`/room-${id}`);
    const rejected = event<string>(denied, "joinDenied");
    denied.emit("join", "Late player", "late-player");
    expect(await rejected).toContain("Late joining");
    let privateEvents = 0;
    denied.on("chatMessage", () => privateEvents++);
    denied.on("leaderboard", () => privateEvents++);
    const chat = event(alice, "chatMessage");
    alice.emit("sendChat", "members only");
    await chat;
    const snapshot = event(host, "roomSettings");
    host.emit("updateSettings", { showLeaderboard: true });
    await snapshot;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(privateEvents).toBe(0);
  });
  test("unjoined sockets do not receive room broadcasts", async () => {
    const { host, id } = await createRoom({ allowChat: true });
    const alice = await join(id);
    const outsider = await connect(`/room-${id}`);
    let privateEvents = 0;
    outsider.on("alert", () => privateEvents++);
    outsider.on("chatMessage", () => privateEvents++);
    outsider.on("chatHistory", () => privateEvents++);
    outsider.on("leaderboard", () => privateEvents++);
    const chat = event(alice, "chatMessage");
    alice.emit("sendChat", "only members");
    await chat;
    const snapshot = event(host, "roomSettings");
    host.emit("alertAll", "info", "member notice");
    host.emit("updateSettings", { showLeaderboard: true });
    await snapshot;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(privateEvents).toBe(0);
  });
  test("multiple tabs receive the same question and pending-answer transitions", async () => {
    const questions = [
      { ...question, contents: "Question one", solutions: [{ type: "number" as const, value: 1, group: 0 }] },
      { ...question, contents: "Question two", solutions: [{ type: "number" as const, value: 2, group: 0 }] },
      { ...question, contents: "Question three", solutions: [{ type: "number" as const, value: 3, group: 0 }] }
    ];
    const { host, id } = await createRoom({}, questions);
    const firstTab = await join(id);
    const secondTab = await join(id);
    const secondStarted = event(secondTab, "gameStart");
    const secondFirstQuestion = event<string>(secondTab, "newQuestion");
    await start(host, firstTab);
    await secondStarted;
    expect(await secondFirstQuestion).toBe("Question one");
    const nextQuestion = event<string>(secondTab, "newQuestion");
    firstTab.emit("skip");
    expect(await nextQuestion).toBe("Question two");
    const firstRunning = event(firstTab, "running");
    const secondRunning = event(secondTab, "running");
    const secondSettled = event(secondTab, "stopRunning");
    secondTab.emit("answer", 2);
    await Promise.all([firstRunning, secondRunning, secondSettled]);
    const stored = new RoomStore(databasePath).loadRooms().get(id)!;
    expect(stored.players.get("alice")).toMatchObject({ currentQuestion: 3, skips: 1, correctCount: 1 });
  }, 10000);
  test("host updates stay inside their room", async () => {
    const first = await createRoom();
    const second = await createRoom();
    let leaked = false;
    second.host.on("playerData", () => (leaked = true));
    await join(first.id);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(leaked).toBe(false);
  });
  test("stopping a round invalidates pending answers without awarding points", async () => {
    const { host, id } = await createRoom();
    const alice = await join(id);
    await start(host, alice);
    const running = event(alice, "running");
    alice.emit("answer", 4);
    await running;
    const finished = event(alice, "gameFinish");
    const standings = event<any[]>(host, "leaderboard");
    host.emit("finish");
    await finished;
    expect((await standings)[0]).toMatchObject({ correctCount: 0, questionsCompleted: 0 });
    await new Promise((resolve) => setTimeout(resolve, 2050));
    const stored = new RoomStore(databasePath).loadRooms().get(id)!;
    expect(stored.players.get("alice")!.correctCount).toBe(0);
    expect(stored.logs.some((log) => log.type === "correct")).toBe(false);
  });
  test("removal disconnects the identity and allows a fresh entry", async () => {
    const { host, id } = await createRoom();
    const alice = await join(id);
    await start(host, alice);
    const running = event(alice, "running");
    alice.emit("answer", 4);
    await running;
    const removed = event(alice, "kicked"),
      disconnected = event(alice, "disconnect");
    host.emit("kick", "alice");
    await removed;
    await disconnected;
    const rejoined = await join(id, "Alice", "new-alice");
    expect(rejoined.connected).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 2050));
    const stored = new RoomStore(databasePath).loadRooms().get(id)!;
    expect(stored.players.has("alice")).toBe(false);
    expect(stored.players.get("new-alice")!.correctCount).toBe(0);
    expect(stored.logs.some((log) => log.type === "correct")).toBe(false);
  });
  test("a removed identity can rejoin only when late joining is open", async () => {
    const { host, id } = await createRoom({ allowLateJoin: false });
    const alice = await join(id);
    await start(host, alice);
    const removed = event(alice, "kicked");
    host.emit("kick", "alice");
    await removed;
    const deniedSocket = await connect(`/room-${id}`);
    const denied = event<string>(deniedSocket, "joinDenied");
    deniedSocket.emit("join", "Alice", "fresh-identity");
    expect(await denied).toContain("Late joining");
    const settings = event<RoomSettings>(host, "roomSettings");
    host.emit("updateSettings", { allowLateJoin: true });
    await settings;
    const resumed = await connect(`/room-${id}`);
    const started = event(resumed, "gameStart");
    resumed.emit("join", "Alice", "fresh-identity");
    await started;
    expect(resumed.connected).toBe(true);
  });
  test("the host can replace and remove a live deadline", async () => {
    const { host, id } = await createRoom({ gameTimerMs: 30000 });
    const alice = await join(id);
    const initialDeadline = event<number>(alice, "gameEndsAt");
    await start(host, alice);
    const initial = await initialDeadline;
    const replaced = eventWhere<number>(alice, "gameEndsAt", (value) => value !== initial);
    host.emit("setGameTimer", 0.5);
    const replacementDeadline = await replaced;
    expect(replacementDeadline).toBeGreaterThan(Date.now());
    const removed = eventWhere<null | number>(alice, "gameEndsAt", (value) => value === null);
    host.emit("setGameTimer", null);
    expect(await removed).toBe(null);
    expect(new RoomStore(databasePath).loadRooms().get(id)!.endsAt).toBe(null);
  });
  test("chat is rate-limited, deletable, and muteable", async () => {
    const { host, id } = await createRoom({ allowChat: true });
    const alice = await join(id);
    const message = event<any>(host, "chatMessage");
    alice.emit("sendChat", "hello");
    const sent = await message;
    const deleted = event<string>(alice, "chatDeleted");
    host.emit("deleteChat", sent.id);
    expect(await deleted).toBe(sent.id);
    const muted = event<boolean>(alice, "chatMuted");
    host.emit("muteChat", "alice", true);
    expect(await muted).toBe(true);
    alice.emit("sendChat", "blocked");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(new RoomStore(databasePath).loadRooms().get(id)!.chat).toHaveLength(0);
    const unmuted = event<boolean>(alice, "chatMuted");
    host.emit("muteChat", "alice", false);
    await unmuted;
    const warning = event<any>(alice, "alert");
    for (let i = 0; i < 5; i++) alice.emit("sendChat", String(i));
    await warning;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(new RoomStore(databasePath).loadRooms().get(id)!.chat).toHaveLength(4);
  });
  test("hidden live standings are not broadcast and enabling them sends a snapshot", async () => {
    const { host, id } = await createRoom({ showLeaderboard: false });
    const alice = await join(id);
    let received = 0;
    alice.on("leaderboard", () => received++);
    await start(host, alice);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toBe(0);
    const snapshot = event<any[]>(alice, "leaderboard");
    await change(host, { showLeaderboard: true });
    expect(await snapshot).toHaveLength(1);
  });
  test("completing all answers automatically ends the room", async () => {
    const { host, id } = await createRoom({ endOnPerfectScore: true });
    const alice = await join(id);
    await start(host, alice);
    const wrong = event(alice, "stopRunning");
    alice.emit("answer", 5);
    await wrong;
    for (let i = 0; i < 2; i++) {
      const next = event(alice, "newQuestion");
      const settled = event(alice, "stopRunning");
      alice.emit("answer", 4);
      await next;
      await settled;
    }
    const finished = event(alice, "gameFinish");
    const standings = event<any[]>(alice, "leaderboard");
    alice.emit("answer", 4);
    await finished;
    expect((await standings)[0]).toMatchObject({ correctCount: 3, questionsCompleted: 3 });
  }, 15000);
  test("skipping prevents a perfect-score finish", async () => {
    const { host, id } = await createRoom({ endOnPerfectScore: true });
    const alice = await join(id);
    await start(host, alice);
    const skipped = event(alice, "newQuestion");
    alice.emit("skip");
    await skipped;
    for (let i = 0; i < 2; i++) {
      const settled = event(alice, "stopRunning");
      alice.emit("answer", 4);
      await settled;
    }
    const stored = new RoomStore(databasePath).loadRooms().get(id)!;
    expect(stored.state).toBe("started");
    expect(stored.players.get("alice")).toMatchObject({ correctCount: 2, questionsCompleted: 3, skips: 1 });
  }, 10000);
  test("player-visible identities cannot be used to reconnect as another player", async () => {
    const { host, id } = await createRoom({ allowChat: true });
    const alice = await connect(`/room-${id}`);
    const identity = event<string>(alice, "playerIdentity");
    const snapshot = event<any[]>(alice, "leaderboard");
    alice.emit("join", "Alice", "private-alice");
    const publicId = await identity;
    expect(publicId).not.toBe("private-alice");
    expect((await snapshot)[0].playerId).toBe(publicId);
    const message = event<any>(alice, "chatMessage");
    alice.emit("sendChat", "hello");
    expect((await message).playerId).toBe(publicId);
    const impostor = await connect(`/room-${id}`);
    const denied = event<string>(impostor, "joinDenied");
    impostor.emit("join", "Alice", publicId);
    expect(await denied).toContain("not valid for a new player");
  });
  test("a public standings id cannot seed a fresh player entry", async () => {
    const { host, id } = await createRoom({ allowChat: true });
    const alice = await connect(`/room-${id}`);
    const identity = event<string>(alice, "playerIdentity");
    alice.emit("join", "Alice", "private-alice");
    const publicId = await identity;
    expect(publicId).toMatch(/^[0-9a-f]{64}$/);
    const impostor = await connect(`/room-${id}`);
    const denied = event<string>(impostor, "joinDenied");
    impostor.emit("join", "Eve", publicId);
    expect(await denied).toContain("not valid for a new player");
    expect(new RoomStore(databasePath).loadRooms().get(id)!.players.has(publicId)).toBe(false);
    void host;
  });
  test("stored deadlines survive reload and expired games finish on startup", async () => {
    const { host, id } = await createRoom({ gameTimerMs: 30000 });
    const alice = await join(id);
    await start(host, alice);
    const deadline = new RoomStore(databasePath).loadRooms().get(id)!.endsAt;
    expect(deadline).toBeGreaterThan(Date.now());
    const db = new Database(databasePath);
    const row = db.query<{ data: string }, [string]>("SELECT data FROM mathex_rooms WHERE id = ?").get(id)!;
    const stored = JSON.parse(row.data);
    stored.endsAt = Date.now() - 1;
    db.query("UPDATE mathex_rooms SET data = ? WHERE id = ?").run(JSON.stringify(stored), id);
    db.close();
    const secondServer = createServer();
    const restored = createWSServer(secondServer);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(new RoomStore(databasePath).loadRooms().get(id)!.state).toBe("finished");
    restored.dispose();
    restored.flush();
    restored.io.close();
  });
});
