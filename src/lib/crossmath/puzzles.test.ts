import { describe, expect, test } from "bun:test";
import puzzles from "./puzzles.json";
import { countSolutions, verifySolution, type Puzzle } from "./model";

const entries = puzzles as unknown as Puzzle[];

describe("puzzles.json", () => {
  test("every puzzle's solution satisfies every line and its givens", () => {
    expect(entries.length).toBe(80);
    for (const p of entries) {
      expect(verifySolution(p, p.solution)).toBe(true);
      for (const g of p.givens) {
        expect(p.solution[g.r]![g.c]).toBe(g.value);
      }
      // Whole-number cells: values inside the advertised range.
      for (const row of p.solution) {
        for (const v of row) {
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(1);
          expect(v).toBeLessThanOrEqual(p.maxNumber);
        }
      }
    }
  });

  // One test per difficulty: hard boards search the largest space, and
  // bun caps each test at five seconds.
  for (const difficulty of ["easy", "medium", "hard"] as const) {
    test(`${difficulty} puzzles re-solve to exactly one solution`, () => {
      for (const p of entries.filter((e) => e.difficulty === difficulty)) {
        expect(countSolutions(p, 2)).toBe(1);
      }
    });
  }

  test("pool covers all difficulties", () => {
    const counts = new Map<string, number>();
    for (const p of entries) counts.set(p.difficulty, (counts.get(p.difficulty) ?? 0) + 1);
    expect(counts.get("easy")).toBe(30);
    expect(counts.get("medium")).toBe(30);
    expect(counts.get("hard")).toBe(20);
  });
});
