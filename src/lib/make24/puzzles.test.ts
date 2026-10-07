import { describe, expect, test } from "bun:test";
import puzzles from "./puzzles.json";
import { validate } from "./expression";
import { solve, tagDifficulty } from "./solver";

interface Puzzle {
  cards: number[];
  solutionCount: number;
  needsFractions: boolean;
  difficulty: "easy" | "medium" | "hard";
  sample: string;
}

const entries = puzzles as Puzzle[];

describe("puzzles.json", () => {
  test("every sample validates to 24 and counts match solver", () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const p of entries) {
      expect(p.solutionCount).toBeGreaterThanOrEqual(1);
      const r = validate(p.sample, p.cards);
      expect(r.ok).toBe(true);
      expect(p.difficulty).toBe(tagDifficulty(p.solutionCount, p.needsFractions));
    }
  });

  test("known hard cases present", () => {
    const has = (cards: number[]) => entries.some((p) => [...p.cards].sort().join(",") === [...cards].sort().join(","));
    expect(has([3, 3, 8, 8])).toBe(true);
    expect(has([1, 5, 5, 5])).toBe(true);
    const hard3388 = entries.find((p) => p.cards.join(",") === "3,3,8,8");
    expect(hard3388?.needsFractions).toBe(true);
    expect(hard3388?.difficulty).toBe("hard");
  });

  test("spot-check solution counts against solver", () => {
    for (const cards of [
      [4, 4, 4, 4],
      [3, 3, 8, 8],
      [6, 6, 6, 6]
    ]) {
      const entry = entries.find((p) => p.cards.join(",") === cards.join(","));
      if (!entry) continue;
      const { solutions, needsFractions } = solve(cards);
      expect(entry.solutionCount).toBe(solutions.length);
      expect(entry.needsFractions).toBe(needsFractions);
    }
  });
});
