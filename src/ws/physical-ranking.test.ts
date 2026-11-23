import { expect, test } from "bun:test";
import type { PhysicalAction, PhysicalCompetition } from "../lib/mathex/physical.schemas";
import { buildSnapshot } from "./physical.server";

function rankings(
  finalTimes: [number | null, number | null],
  finalActions: ["skip" | "correct", "skip" | "correct"] = ["skip", "skip"]
) {
  const teams = new Map(["A", "B"].map((id) => [id, { id, name: id, group: "" }]));
  const actions: PhysicalAction[] = [];
  for (const [index, teamId] of [...teams.keys()].entries()) {
    function mark(questionNumber: number, action: PhysicalAction["action"], elapsedMs: number) {
      const sequence = actions.length + 1;
      actions.push({ id: String(sequence), sequence, teamId, questionNumber, action, elapsedMs, timestamp: elapsedMs });
    }
    const scoreTime = index === 0 ? 600_000 : 660_000;
    for (let q = 1; q <= 22; q++) mark(q, q < 3 ? "skip" : "correct", (q * scoreTime) / 22);
    const finishTime = finalTimes[index];
    if (finishTime !== null) mark(23, finalActions[index], finishTime);
  }
  const competition: PhysicalCompetition = {
    code: "123456",
    name: "Test round",
    hostToken: "",
    markerPinHash: "",
    questionCount: 23,
    countdownDurationMs: null,
    autoFinishWhenComplete: false,
    state: "finished",
    startedAt: 0,
    runningSince: null,
    elapsedBeforeRunMs: 900_000,
    teams,
    actions,
    nextActionSequence: actions.length + 1
  };
  return buildSnapshot(competition).teams;
}

test("an earlier final skip wins a score tie even if the other team scored sooner", () => {
  const teams = rankings([840_000, 670_000]);
  expect(teams.map(({ name, rank, correct, finishTimeMs }) => [name, rank, correct, finishTimeMs])).toEqual([
    ["B", 1, 20, 670_000],
    ["A", 2, 20, 840_000]
  ]);
});

test("a finisher beats an unfinished team only when their scores are equal", () => {
  expect(rankings([null, 670_000]).map(({ name }) => name)).toEqual(["B", "A"]);
  expect(rankings([840_000, 670_000], ["correct", "skip"]).map(({ name }) => name)).toEqual(["A", "B"]);
});

test("missing or identical finish times fall back to the time each team reached its score", () => {
  expect(rankings([null, null]).map(({ name }) => name)).toEqual(["A", "B"]);
  expect(rankings([840_000, 840_000]).map(({ name }) => name)).toEqual(["A", "B"]);
});
