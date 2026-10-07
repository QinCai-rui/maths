import { DivisionByZero, div, equals, fromInt, type Rational } from "./rational.js";
import { add, mul, sub } from "./rational.js";

export type Difficulty = "easy" | "medium" | "hard";

interface Item {
  v: Rational;
  s: string;
}

const TARGET = fromInt(24);

function canonical(op: string, l: string, r: string): string {
  if (op === "+" || op === "*") {
    const [a, b] = l <= r ? [l, r] : [r, l];
    return `(${a}${op}${b})`;
  }
  return `(${l}${op}${r})`;
}

function solveInternal(cards: number[], integersOnly: boolean): Set<string> {
  const out = new Set<string>();
  const start: Item[] = cards.map((c) => ({ v: fromInt(c), s: `${c}` }));

  function recurse(items: Item[]): void {
    if (items.length === 1) {
      if (equals(items[0]!.v, TARGET)) out.add(items[0]!.s);
      return;
    }
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!;
        const b = items[j]!;
        const rest = items.filter((_, k) => k !== i && k !== j);
        const candidates: Item[] = [];
        const push = (v: Rational, s: string) => {
          if (integersOnly && v.d !== 1) return;
          candidates.push({ v, s });
        };
        push(add(a.v, b.v), canonical("+", a.s, b.s));
        push(mul(a.v, b.v), canonical("*", a.s, b.s));
        push(sub(a.v, b.v), canonical("-", a.s, b.s));
        push(sub(b.v, a.v), canonical("-", b.s, a.s));
        if (b.v.n !== 0) {
          try {
            push(div(a.v, b.v), canonical("/", a.s, b.s));
          } catch (err) {
            if (!(err instanceof DivisionByZero)) throw err;
          }
        }
        if (a.v.n !== 0) {
          try {
            push(div(b.v, a.v), canonical("/", b.s, a.s));
          } catch (err) {
            if (!(err instanceof DivisionByZero)) throw err;
          }
        }
        for (const c of candidates) recurse([...rest, c]);
      }
    }
  }

  recurse(start);
  return out;
}

function stripOuterParens(s: string): string {
  if (s.length >= 2 && s.startsWith("(") && s.endsWith(")")) {
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "(") depth++;
      else if (s[i] === ")") depth--;
      if (depth === 0 && i < s.length - 1) return s;
    }
    return s.slice(1, -1);
  }
  return s;
}

export function tagDifficulty(solutionCount: number, needsFractions: boolean): Difficulty {
  if (needsFractions) return "hard";
  if (solutionCount >= 12) return "easy";
  if (solutionCount >= 4) return "medium";
  return "hard";
}

/** Alias kept for convenience; same rule as tagDifficulty. */
export const countDifficulty = tagDifficulty;

export function solve(cards: number[]): { solutions: string[]; needsFractions: boolean } {
  const rational = solveInternal(cards, false);
  const solutions = [...rational].map(stripOuterParens).sort();
  // Deterministic dedupe already handled by canonical ordering + Set + sort.
  let needsFractions = false;
  if (rational.size > 0) {
    const integerOnly = solveInternal(cards, true);
    needsFractions = integerOnly.size === 0;
  }
  return { solutions, needsFractions };
}
