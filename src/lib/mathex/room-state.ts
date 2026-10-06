import {
  DEFAULT_ROOM_SETTINGS,
  type Room,
  type RoomSettings,
  type RoomSocketData,
  type LeaderboardEntry
} from "./schemas";

export function sanitizeRoomSettings(value: unknown): RoomSettings {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const settings = { ...DEFAULT_ROOM_SETTINGS };
  for (const key of [
    "allowLateJoin",
    "showLeaderboard",
    "allowCalculator",
    "allowChat",
    "allowSketch",
    "endOnPerfectScore"
  ] as const) {
    if (typeof source[key] === "boolean") settings[key] = source[key];
  }
  const time = source.gameTimerMs;
  settings.gameTimerMs =
    typeof time === "number" && Number.isFinite(time) && time > 0
      ? Math.min(Math.max(Math.round(time), 30000), 8 * 3600000)
      : null;
  return settings;
}

// Historical games did not store counts. Entries written since id-tagged logs
// match by reconnect id; older entries fall back to display-name matching.
export function restorePlayerCounts(player: RoomSocketData, room: Pick<Room, "logs" | "questions">) {
  const mine = (log: (typeof room.logs)[number]) =>
    log.playerId !== undefined ? log.playerId === player.playerId : log.playerName === player.name;
  const correctLogs = room.logs.filter((log) => mine(log) && log.type === "correct");
  const skippedLogs = room.logs.filter((log) => mine(log) && log.type === "skipped");
  const correctQuestions = new Set(correctLogs.map((log) => log.questionNumber));
  const skippedQuestions = new Set(skippedLogs.map((log) => log.questionNumber));
  player.correctCount ??= correctQuestions.size;
  player.skips ??= skippedQuestions.size;
  player.correctReachedAtMs ??= correctLogs.length > 0 ? Math.max(...correctLogs.map((log) => log.timestamp)) : null;
  player.questionsCompleted ??= Math.min(room.questions.length, player.correctCount + player.skips);
  player.chatMuted ??= false;
}

export function elapsedOf(player: RoomSocketData, now = Date.now()): number {
  return player.startingTime !== null ? (player.finishingTime ?? now) - player.startingTime : Infinity;
}

export function sortedPlayers(room: Room): RoomSocketData[] {
  return [...room.players.values()].sort((a, b) => {
    const score = b.correctCount - a.correctCount;
    if (score) return score;
    // First to reach the score ranks higher. No correct answers sorts last.
    if (a.correctReachedAtMs === null && b.correctReachedAtMs === null)
      return (a.name ?? "").localeCompare(b.name ?? "");
    if (a.correctReachedAtMs === null) return 1;
    if (b.correctReachedAtMs === null) return -1;
    const pace = a.correctReachedAtMs - b.correctReachedAtMs;
    if (pace !== 0) return pace;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });
}

export function buildLeaderboard(room: Room): LeaderboardEntry[] {
  return sortedPlayers(room).map((player, index) => ({
    rank: index + 1,
    playerId: player.playerId!,
    name: player.name || "Unknown",
    totalMs:
      player.finishingTime !== null && player.startingTime !== null ? player.finishingTime - player.startingTime : null,
    questionsCompleted: player.questionsCompleted,
    correctCount: player.correctCount,
    totalQuestions: room.questions.length,
    visibilityFlags: player.visibilityFlags,
    skips: player.skips
  }));
}

export function exportableResults(entries: LeaderboardEntry[]) {
  return entries.map(
    ({ rank, name, totalMs, questionsCompleted, totalQuestions, visibilityFlags, skips, correctCount }) => ({
      rank,
      name,
      totalMs,
      questionsCompleted,
      totalQuestions,
      visibilityFlags,
      skips,
      correctCount
    })
  );
}
