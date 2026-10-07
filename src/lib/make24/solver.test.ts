import { describe, expect, test } from "bun:test";
import { solve, tagDifficulty } from "./solver";
import { validate } from "./expression";

describe("solver", () => {
  test("3,3,8,8 solves and needs fractions", () => {
    const { solutions, needsFractions } = solve([3, 3, 8, 8]);
    expect(solutions.length).toBeGreaterThan(0);
    expect(needsFractions).toBe(true);
    for (const s of solutions) {
      const r = validate(s, [3, 3, 8, 8]);
      expect(r.ok).toBe(true);
    }
  });

  test("1,5,5,5 solves and needs fractions", () => {
    const { solutions, needsFractions } = solve([1, 5, 5, 5]);
    expect(solutions.length).toBeGreaterThan(0);
    expect(needsFractions).toBe(true);
  });

  test("4,4,4,4 solves without fractions", () => {
    const { solutions, needsFractions } = solve([4, 4, 4, 4]);
    expect(solutions.length).toBeGreaterThan(0);
    expect(needsFractions).toBe(false);
  });

  test("1,1,1,1 is unsolvable", () => {
    const { solutions, needsFractions } = solve([1, 1, 1, 1]);
    expect(solutions).toEqual([]);
    expect(needsFractions).toBe(false);
  });

  test("solution counts are deterministic", () => {
    const a = solve([3, 3, 8, 8]).solutions;
    const b = solve([3, 3, 8, 8]).solutions;
    expect(a).toEqual(b);
    const c = solve([6, 6, 6, 6]).solutions;
    expect(c).toEqual([...c].sort());
  });

  test("difficulty tagging rule", () => {
    expect(tagDifficulty(5, true)).toBe("hard");
    expect(tagDifficulty(12, false)).toBe("easy");
    expect(tagDifficulty(11, false)).toBe("medium");
    expect(tagDifficulty(4, false)).toBe("medium");
    expect(tagDifficulty(3, false)).toBe("hard");
  });
});
