// Crossmath core model: whole-number cells on an n×n grid.
//
// A board is a square of number cells. Each cell holds one complete number
// (1-9 on easy/medium, up to 16 on hard). Operators are fixed between
// adjacent number cells, and every row and column runs into a prefilled
// result:
//
//   [a] + [b] - [c] = [r1]
//    +       *       -
//   [d] * [e] + [f] = [r2]
//    -       +       +
//   [g] + [h] * [i] = [r3]
//    =       =       =
//   [c1]    [c2]    [c3]
//
// Chains evaluate with the standard order of operations (× and ÷ before
// + and -, left to right within the same level). Division must be exact:
// a ÷ b only holds when b divides a with no remainder.

export type Op = "+" | "-" | "*" | "/";
export const OPS: readonly Op[] = ["+", "-", "*", "/"];

export type Difficulty = "easy" | "medium" | "hard";

export interface GivenCell {
  r: number;
  c: number;
  value: number;
}

export interface Puzzle {
  id: string;
  difficulty: Difficulty;
  /** The number grid is size × size. */
  size: number;
  /** Largest value a number cell may hold. */
  maxNumber: number;
  /** rowOps[r][k] sits between solution[r][k] and solution[r][k+1]. */
  rowOps: Op[][];
  /** colOps[k][c] sits between solution[k][c] and solution[k+1][c]. */
  colOps: Op[][];
  /** Prefilled row results, one per row. */
  rowResults: number[];
  /** Prefilled column results, one per column. */
  colResults: number[];
  /** Prefilled number cells. Everything else is blank. */
  givens: GivenCell[];
  /** The full solved number grid. */
  solution: number[][];
}

/**
 * Evaluate a chain of numbers joined by operators using the standard order
 * of operations. Returns null when a division step is inexact (or divides
 * by zero), so inexact lines simply never validate.
 */
export function evaluateChain(nums: number[], ops: Op[]): number | null {
  if (nums.length === 0 || ops.length !== nums.length - 1) return null;
  const values = [...nums];
  const operators = [...ops];
  for (let i = 0; i < operators.length; i++) {
    const op = operators[i]!;
    if (op === "*" || op === "/") {
      const a = values[i]!;
      const b = values[i + 1]!;
      if (op === "*") {
        values.splice(i, 2, a * b);
      } else {
        if (b === 0 || a % b !== 0) return null;
        values.splice(i, 2, a / b);
      }
      operators.splice(i, 1);
      i--;
    }
  }
  let total = values[0]!;
  for (let i = 0; i < operators.length; i++) {
    total = operators[i] === "+" ? total + values[i + 1]! : total - values[i + 1]!;
  }
  return total;
}

/** Check one full line: the chain must evaluate exactly to the result. */
export function checkLine(nums: number[], ops: Op[], result: number): boolean {
  return evaluateChain(nums, ops) === result;
}

export function rowNumbers(solution: number[][], r: number): number[] {
  return solution[r]!;
}

export function colNumbers(solution: number[][], c: number): number[] {
  return solution.map((row) => row[c]!);
}

/** Verify a complete number grid against every row and column. */
export function verifySolution(puzzle: Puzzle, grid: number[][]): boolean {
  const n = puzzle.size;
  if (grid.length !== n || grid.some((row) => row.length !== n)) return false;
  for (const row of grid) {
    for (const v of row) {
      if (!Number.isInteger(v) || v < 1 || v > puzzle.maxNumber) return false;
    }
  }
  for (const { r, c, value } of puzzle.givens) {
    if (grid[r]![c]! !== value) return false;
  }
  for (let r = 0; r < n; r++) {
    if (!checkLine(grid[r]!, puzzle.rowOps[r]!, puzzle.rowResults[r]!)) return false;
  }
  for (let c = 0; c < n; c++) {
    if (
      !checkLine(
        colNumbers(grid, c),
        puzzle.colOps.map((row) => row[c]!),
        puzzle.colResults[c]!
      )
    ) {
      return false;
    }
  }
  return true;
}

function givenMap(puzzle: Puzzle): Map<string, number> {
  const map = new Map<string, number>();
  for (const g of puzzle.givens) map.set(`${g.r},${g.c}`, g.value);
  return map;
}

function blankCells(puzzle: Puzzle): { r: number; c: number }[] {
  const givens = givenMap(puzzle);
  const blanks: { r: number; c: number }[] = [];
  for (let r = 0; r < puzzle.size; r++) {
    for (let c = 0; c < puzzle.size; c++) {
      if (!givens.has(`${r},${c}`)) blanks.push({ r, c });
    }
  }
  return blanks;
}

/**
 * Count solutions (up to `cap`) for the puzzle's blank cells, searching
 * values 1..maxNumber. Row by row: enumerate each row's completions that
 * hit its result, then combine rows and keep combinations whose columns
 * also hit. Returns the count found (capped), for uniqueness checks.
 *
 * The search carries a node budget: boards too ambiguous to settle within
 * it return `cap` (treated as "not proven unique"). Generation relies on
 * this to reject slow boards instead of hanging on them.
 */
export function countSolutions(puzzle: Puzzle, cap = 2, budget = 300_000): number {
  const n = puzzle.size;
  const givens = givenMap(puzzle);
  const blanks = blankCells(puzzle);
  if (blanks.length === 0) return verifySolution(puzzle, puzzle.solution) ? 1 : 0;
  let nodes = 0;
  let exhausted = false;
  const overBudget = () => {
    nodes++;
    if (nodes > budget) exhausted = true;
    return exhausted;
  };

  // Per-row candidates: every way to fill this row's blanks so the row hits.
  const rowCandidates: number[][][][] = [];
  for (let r = 0; r < n; r++) {
    const rowBlanks = blanks.filter((b) => b.r === r).map((b) => b.c);
    const candidates: number[][][] = [];
    const fill = (i: number, grid: number[][]) => {
      if (overBudget()) return;
      if (i === rowBlanks.length) {
        if (checkLine(grid[r]!, puzzle.rowOps[r]!, puzzle.rowResults[r]!)) {
          candidates.push(grid.map((row) => [...row]));
        }
        return;
      }
      const c = rowBlanks[i]!;
      for (let v = 1; v <= puzzle.maxNumber; v++) {
        grid[r]![c] = v;
        fill(i + 1, grid);
      }
    };
    const grid = puzzle.solution.map((row) => [...row]);
    for (let c = 0; c < n; c++) {
      const g = givens.get(`${r},${c}`);
      grid[r]![c] = g ?? 0;
    }
    fill(0, grid);
    if (candidates.length === 0) return 0;
    rowCandidates.push(candidates);
  }

  // Combine rows; columns are verified once the grid is complete.
  let found = 0;
  const grid: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0));
  const combine = (r: number): boolean => {
    if (overBudget()) {
      exhausted = true;
      return true;
    }
    if (found >= cap) return true;
    if (r === n) {
      for (let c = 0; c < n; c++) {
        if (
          !checkLine(
            colNumbers(grid, c),
            puzzle.colOps.map((row) => row[c]!),
            puzzle.colResults[c]!
          )
        ) {
          return false;
        }
      }
      found++;
      return found >= cap;
    }
    for (const candidate of rowCandidates[r]!) {
      grid[r] = [...candidate[r]!];
      if (combine(r + 1)) return true;
    }
    return false;
  };
  combine(0);
  // An exhausted search proves nothing: report cap so callers treat the
  // board as not-unique rather than shipping (or trusting) it.
  return exhausted ? cap : found;
}
