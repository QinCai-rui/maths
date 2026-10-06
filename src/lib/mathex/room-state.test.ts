import { describe, expect, test } from "bun:test";
import { DEFAULT_ROOM_SETTINGS, type Room, type RoomSocketData } from "./schemas";
import { buildLeaderboard, exportableResults, restorePlayerCounts, sanitizeRoomSettings } from "./room-state";

function player(change: Partial<RoomSocketData> = {}): RoomSocketData {
  return {
    playerId: "a",
    name: "Alice",
    currentQuestion: 3,
    totalQuestions: 5,
    startingTime: 1000,
    finishingTime: null,
    isRunning: false,
    runningUntil: null,
    awaySince: null,
    visibilityFlags: 0,
    skips: 0,
    correctCount: 2,
    questionsCompleted: 2,
    correctReachedAtMs: 2000,
    chatMuted: false,
    ...change
  };
}
function room(players: RoomSocketData[]): Room {
  return {
    id: "123456",
    name: "Test",
    questions: Array.from({ length: 5 }, () => ({
      contents: "",
      solutions: [],
      allowEquivalent: true,
      answerComment: "",
      requireAllSolutionGroups: false,
      solutionOrderMatters: false,
      skippable: true
    })),
    runToken: "test",
    state: "started",
    runningTimeMs: 1000,
    visibilityTracking: false,
    players: new Map(players.map((value) => [value.playerId!, value])),
    logs: [],
    settings: { ...DEFAULT_ROOM_SETTINGS },
    endsAt: null,
    startedAt: 1000,
    chat: []
  };
}

describe("online room state", () => {
  test("finishing cannot award the unanswered current question", () => {
    const alice = player();
    const game = room([alice]);
    expect(buildLeaderboard(game)[0].correctCount).toBe(2);
    alice.finishingTime = 5000;
    expect(buildLeaderboard(game)[0]).toMatchObject({ correctCount: 2, questionsCompleted: 2 });
  });
  test("scores outrank completion and skips never count as correct", () => {
    const alice = player({ skips: 2, questionsCompleted: 4, finishingTime: 3000 });
    const bob = player({ playerId: "b", name: "Bob", correctCount: 3, questionsCompleted: 3 });
    expect(buildLeaderboard(room([alice, bob])).map((entry) => entry.name)).toEqual(["Bob", "Alice"]);
  });
  test("earlier scorer wins equal scores, finished or not", () => {
    const alice = player({ finishingTime: 5000, correctReachedAtMs: 4000 });
    const bob = player({ playerId: "b", name: "Bob", correctReachedAtMs: 3000 });
    expect(buildLeaderboard(room([alice, bob]))[0].playerId).toBe("b");
  });
  test("no correct answers sorts by name", () => {
    const alice = player({ correctCount: 0, questionsCompleted: 0, correctReachedAtMs: null });
    const bob = player({
      playerId: "b",
      name: "Bob",
      correctCount: 0,
      questionsCompleted: 0,
      correctReachedAtMs: null
    });
    expect(buildLeaderboard(room([bob, alice])).map((entry) => entry.playerId)).toEqual(["a", "b"]);
  });
  test("historical host finish does not imply completion", () => {
    const alice = player({ finishingTime: 5000 });
    delete (alice as Partial<RoomSocketData>).correctCount;
    delete (alice as Partial<RoomSocketData>).questionsCompleted;
    delete (alice as Partial<RoomSocketData>).correctReachedAtMs;
    const game = room([alice]);
    game.logs = [
      { timestamp: 1000, playerName: "Alice", type: "correct", questionNumber: 1 },
      { timestamp: 1500, playerName: "Alice", type: "correct", questionNumber: 2 },
      { timestamp: 2000, playerName: "Alice", type: "finished", questionNumber: 3 }
    ];
    restorePlayerCounts(alice, game);
    expect(alice.correctCount).toBe(2);
    expect(alice.questionsCompleted).toBe(2);
    expect(alice.correctReachedAtMs).toBe(1500);
  });
  test("settings accept booleans only and clamp finite timers", () => {
    expect(sanitizeRoomSettings({ allowChat: "true", gameTimerMs: Infinity })).toEqual(DEFAULT_ROOM_SETTINGS);
    expect(sanitizeRoomSettings({ gameTimerMs: 1 }).gameTimerMs).toBe(30000);
    expect(sanitizeRoomSettings({ gameTimerMs: 1e10 }).gameTimerMs).toBe(8 * 3600000);
    expect(DEFAULT_ROOM_SETTINGS).toMatchObject({
      showLeaderboard: true,
      allowCalculator: true,
      allowChat: false,
      allowSketch: false
    });
  });
  test("result exports omit the credential used to reconnect", () => {
    const result = exportableResults(buildLeaderboard(room([player()])))[0];
    expect(result.name).toBe("Alice");
    expect(result).not.toHaveProperty("playerId");
  });
  test("restore matches id-tagged logs, not same-name strangers", () => {
    const oldAlice = player({ playerId: "old-id", finishingTime: 5000 });
    for (const key of ["correctCount", "questionsCompleted", "correctReachedAtMs"] as const) {
      delete (oldAlice as Partial<RoomSocketData>)[key];
    }
    const newAlice = player({ playerId: "new-id" });
    delete (newAlice as Partial<RoomSocketData>).correctCount;
    delete (newAlice as Partial<RoomSocketData>).questionsCompleted;
    delete (newAlice as Partial<RoomSocketData>).correctReachedAtMs;
    const game = room([oldAlice, newAlice]);
    game.logs = [{ timestamp: 1000, playerName: "Alice", playerId: "old-id", type: "correct", questionNumber: 1 }];
    restorePlayerCounts(oldAlice, game);
    restorePlayerCounts(newAlice, game);
    expect(oldAlice.correctCount).toBe(1);
    expect(oldAlice.correctReachedAtMs).toBe(1000);
    expect(newAlice.correctCount).toBe(0);
    expect(newAlice.correctReachedAtMs).toBe(null);
  });
  test("untagged legacy logs still match by display name", () => {
    const alice = player();
    delete (alice as Partial<RoomSocketData>).correctCount;
    delete (alice as Partial<RoomSocketData>).questionsCompleted;
    delete (alice as Partial<RoomSocketData>).correctReachedAtMs;
    const game = room([alice]);
    game.logs = [{ timestamp: 1000, playerName: "Alice", type: "correct", questionNumber: 1 }];
    restorePlayerCounts(alice, game);
    expect(alice.correctCount).toBe(1);
    expect(alice.correctReachedAtMs).toBe(1000);
  });
});
