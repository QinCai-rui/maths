import type { PhysicalLifecycle, PhysicalTeamSnapshot } from "#lib/mathex/physical.schemas.js";

export const roundLabels: Record<PhysicalLifecycle, string> = {
  lobby: "Waiting to start",
  running: "Round live",
  paused: "Round paused",
  finished: "Final results"
};

export function teamProgress(team: PhysicalTeamSnapshot, questionCount: number, state: PhysicalLifecycle) {
  if (state === "lobby") return "Not started";
  if (team.currentQuestion > questionCount) return "Done";
  if (state === "finished") return `Ended at Q${team.currentQuestion}`;
  return `Q${team.currentQuestion} / ${questionCount}`;
}

export function wrongAttempts(count: number) {
  return `${count} wrong ${count === 1 ? "attempt" : "attempts"}`;
}

export function teamTally(team: PhysicalTeamSnapshot) {
  return `${team.correct} correct · ${wrongAttempts(team.incorrect)} · ${team.skipped} skipped`;
}

export function spacedCode(code: string) {
  return /^\d{6}$/.test(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export function standingsGroups(teams: PhysicalTeamSnapshot[]) {
  // Match the server's rank buckets, including its ungrouped fallback.
  const groups = new Map<string, PhysicalTeamSnapshot[]>();
  for (const team of teams) {
    const name = team.group || "Ungrouped";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push(team);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }) || a.localeCompare(b))
    .map(([name, teams]) => ({ name, teams }));
}
