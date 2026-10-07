import { describe, expect, test } from "bun:test";
import { generate, TEMPLATES, type Template } from "./generator";
import { countSolutions, verifySolution } from "./model";

function rng(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

describe("generate", () => {
  for (const template of TEMPLATES) {
    test(`${template.id} produces a valid unique puzzle`, () => {
      const puzzle = generate(template, rng(template.size * 999 + 7), `gen-${template.id}`);
      expect(puzzle).not.toBeNull();
      const p = puzzle!;
      expect(verifySolution(p, p.solution)).toBe(true);
      expect(countSolutions(p, 2)).toBe(1);
      const blanks = p.size * p.size - p.givens.length;
      expect(blanks).toBeGreaterThan(0);
      // Every line holds under the order of operations with exact division.
      for (let r = 0; r < p.size; r++) {
        expect(p.rowResults[r]).toBeGreaterThanOrEqual(0);
        expect(p.rowResults[r]).toBeLessThanOrEqual(template.maxResult);
      }
      // Givens match the solution.
      for (const g of p.givens) {
        expect(p.solution[g.r]![g.c]).toBe(g.value);
      }
    });
  }

  test("easy boards use only + and -", () => {
    const template = TEMPLATES.find((t) => t.difficulty === "easy")!;
    const puzzle = generate(template, rng(42), "gen-easy-ops")!;
    const ops = [...puzzle.rowOps.flat(), ...puzzle.colOps.flat()];
    expect(ops.every((op) => op === "+" || op === "-")).toBe(true);
  });

  test("hard boards stay solvable quickly", () => {
    const template: Template = { ...TEMPLATES.find((t) => t.difficulty === "hard")!, blanks: 9 };
    const started = Date.now();
    const puzzle = generate(template, rng(1234), "gen-hard-perf")!;
    expect(countSolutions(puzzle, 2)).toBe(1);
    expect(Date.now() - started).toBeLessThan(30_000);
  });
});
