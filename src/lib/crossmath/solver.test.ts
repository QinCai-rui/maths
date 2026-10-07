import { describe, expect, test } from "bun:test";
import { checkLine, countSolutions, evaluateChain, verifySolution, type Puzzle } from "./model";

// Hand-verified board. Rows: 8+3-1=10, 2+4+6=12, 5+2+9=16.
// Columns: 8+2+5=15, 3+4-2=5, 1-6+9=4.
const puzzle: Puzzle = {
  id: "test-board",
  difficulty: "easy",
  size: 3,
  maxNumber: 9,
  rowOps: [
    ["+", "-"],
    ["+", "+"],
    ["+", "+"]
  ],
  colOps: [
    ["+", "+", "-"],
    ["+", "-", "+"]
  ],
  rowResults: [10, 12, 16],
  colResults: [15, 5, 4],
  givens: [
    { r: 0, c: 0, value: 8 },
    { r: 0, c: 1, value: 3 },
    { r: 1, c: 1, value: 4 }
  ],
  solution: [
    [8, 3, 1],
    [2, 4, 6],
    [5, 2, 9]
  ]
};

describe("evaluateChain", () => {
  test("follows the order of operations, not left to right", () => {
    expect(evaluateChain([2, 3, 4], ["+", "*"])).toBe(14);
    expect(evaluateChain([3, 8, 6], ["*", "-"])).toBe(18);
    expect(evaluateChain([10, 2, 3], ["-", "+"])).toBe(11);
  });
  test("rejects inexact division and division by zero", () => {
    expect(evaluateChain([7, 2], ["/"])).toBeNull();
    expect(evaluateChain([8, 2], ["/"])).toBe(4);
    expect(evaluateChain([5, 0], ["/"])).toBeNull();
  });
});

describe("verifySolution", () => {
  test("accepts the solved grid", () => {
    expect(verifySolution(puzzle, puzzle.solution)).toBe(true);
  });
  test("rejects a grid with a wrong cell", () => {
    const wrong = puzzle.solution.map((row) => [...row]);
    wrong[0]![0] = 1;
    expect(verifySolution(puzzle, wrong)).toBe(false);
  });
  test("rejects a grid that drops a given", () => {
    const dropped = puzzle.solution.map((row) => [...row]);
    dropped[1]![1] = 5;
    expect(verifySolution(puzzle, dropped)).toBe(false);
  });
});

describe("countSolutions", () => {
  test("finds exactly one solution for the test board", () => {
    expect(countSolutions(puzzle, 2)).toBe(1);
  });
  test("finds multiple solutions when too much is erased", () => {
    const open: Puzzle = {
      id: "open",
      difficulty: "easy",
      size: 2,
      maxNumber: 9,
      rowOps: [["+"], ["+"]],
      colOps: [["+", "+"]],
      rowResults: [3, 7],
      colResults: [4, 6],
      givens: [],
      solution: [
        [1, 2],
        [3, 4]
      ]
    };
    expect(verifySolution(open, open.solution)).toBe(true);
    expect(countSolutions(open, 3)).toBeGreaterThan(1);
  });
  test("checkLine works on whole-number cells", () => {
    expect(checkLine([12, 3], ["+"], 15)).toBe(true);
    expect(checkLine([12, 3], ["+"], 14)).toBe(false);
  });
});
