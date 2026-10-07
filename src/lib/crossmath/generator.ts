// Crossmath generator: random solved grids, erased to a unique puzzle.
//
// Process per puzzle: roll a full number grid plus fixed operators, compute
// the row/column results, reject boards that break the difficulty's rules,
// then erase number cells greedily while the board keeps exactly one
// solution. Results are always prefilled; givens are the cells left filled.

import { countSolutions, evaluateChain, type Difficulty, type Op, type Puzzle } from "./model";

export interface Template {
  id: string;
  difficulty: Difficulty;
  size: number;
  maxNumber: number;
  allowedOps: Op[];
  /** Target blanks; erasing stops early if uniqueness would break. */
  blanks: number;
  /** Minimum givens to leave filled (besides the results). */
  minGivens: number;
  /** Largest value any result may take (keeps cells tidy). */
  maxResult: number;
}

export const TEMPLATES: Template[] = [
  {
    id: "small-add",
    difficulty: "easy",
    size: 3,
    maxNumber: 9,
    allowedOps: ["+", "-"],
    blanks: 5,
    minGivens: 3,
    maxResult: 20
  },
  {
    id: "small-mul",
    difficulty: "medium",
    size: 3,
    maxNumber: 9,
    allowedOps: ["+", "-", "*"],
    blanks: 6,
    minGivens: 2,
    maxResult: 99
  },
  {
    id: "large-mix",
    difficulty: "hard",
    size: 4,
    maxNumber: 12,
    allowedOps: ["+", "-", "*", "/"],
    blanks: 9,
    minGivens: 4,
    maxResult: 99
  }
];

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

/**
 * Roll a full solved board, or null when the results break the template's
 * range rules. Operators are conditioned on the numbers (division is only
 * ever placed where it divides exactly), so rolling succeeds often and
 * division is exact by construction rather than by rejection.
 */
function rollSolved(template: Template, rng: () => number): Omit<Puzzle, "id" | "givens"> | null {
  const n = template.size;
  const solution: number[][] = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => randInt(rng, 1, template.maxNumber))
  );
  const fits = (a: number, op: Op, b: number): boolean => {
    if (op === "/") return b !== 0 && a % b === 0;
    return true;
  };
  const rollOps = (pairs: [number, number][], rows: number, perRow: number): Op[][] => {
    const out: Op[][] = [];
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      const row: Op[] = [];
      for (let k = 0; k < perRow; k++) {
        const [a, b] = pairs[idx++]!;
        const workable = template.allowedOps.filter((op) => fits(a, op, b));
        row.push(workable.length > 0 ? pick(rng, workable) : template.allowedOps[0]!);
      }
      out.push(row);
    }
    return out;
  };
  const rowPairs: [number, number][] = [];
  for (let r = 0; r < n; r++) for (let k = 0; k < n - 1; k++) rowPairs.push([solution[r]![k]!, solution[r]![k + 1]!]);
  const colPairs: [number, number][] = [];
  for (let k = 0; k < n - 1; k++) for (let c = 0; c < n; c++) colPairs.push([solution[k]![c]!, solution[k + 1]![c]!]);
  const rowOps = rollOps(rowPairs, n, n - 1);
  const colOps = rollOps(colPairs, n - 1, n);
  const rowResults: number[] = [];
  const colResults: number[] = [];
  for (let r = 0; r < n; r++) {
    const v = evaluateChain(solution[r]!, rowOps[r]!);
    if (v === null || v < 0 || v > template.maxResult) return null;
    rowResults.push(v);
  }
  for (let c = 0; c < n; c++) {
    const nums = solution.map((row) => row[c]!);
    const ops = colOps.map((row) => row[c]!);
    const v = evaluateChain(nums, ops);
    if (v === null || v < 0 || v > template.maxResult) return null;
    colResults.push(v);
  }
  // Easy boards stay friendly: no zero results.
  if (template.difficulty === "easy") {
    if ([...rowResults, ...colResults].some((v) => v === 0)) return null;
  }
  return {
    difficulty: template.difficulty,
    size: n,
    maxNumber: template.maxNumber,
    rowOps,
    colOps,
    rowResults,
    colResults,
    solution
  };
}

/** Erase cells greedily while the puzzle keeps exactly one solution. */
export function generate(template: Template, rng: () => number, id: string): Puzzle | null {
  for (let attempt = 0; attempt < 300; attempt++) {
    const board = rollSolved(template, rng);
    if (!board) continue;
    const n = template.size;
    const cells: { r: number; c: number }[] = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) cells.push({ r, c });
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [cells[i], cells[j]] = [cells[j]!, cells[i]!];
    }
    const erased = new Set<string>();
    const givensOf = () =>
      cells
        .filter((cell) => !erased.has(`${cell.r},${cell.c}`))
        .map((cell) => ({ ...cell, value: board.solution[cell.r]![cell.c]! }));
    for (const cell of cells) {
      if (erased.size >= template.blanks) break;
      if (cells.length - erased.size - 1 < template.minGivens) break;
      erased.add(`${cell.r},${cell.c}`);
      const trial: Puzzle = { ...board, id, givens: givensOf() };
      if (countSolutions(trial, 2) !== 1) erased.delete(`${cell.r},${cell.c}`);
    }
    if (erased.size === 0) continue;
    const puzzle: Puzzle = { ...board, id, givens: givensOf() };
    if (countSolutions(puzzle, 2) === 1) return puzzle;
  }
  return null;
}
