import { describe, expect, test } from "bun:test";
import type { z } from "zod";
import { checkSolution } from "./answer-matching";
import type { Question } from "./schemas";

type QuestionValue = z.infer<typeof Question>;

function question(overrides: Partial<QuestionValue> = {}): QuestionValue {
  return {
    contents: "",
    solutions: [{ type: "number", value: 0, group: 0 }],
    allowEquivalent: true,
    answerComment: "",
    requireAllSolutionGroups: false,
    solutionOrderMatters: false,
    skippable: true,
    ...overrides
  };
}

describe("numeric answers", () => {
  test("rejects blank and whitespace-only strings for zero", () => {
    const q = question();
    expect(checkSolution("", q)).toBe(false);
    expect(checkSolution("   ", q)).toBe(false);
    expect(checkSolution(0, q)).toBe(true);
    expect(checkSolution("0", q)).toBe(true);
  });
});

describe("expression answers", () => {
  const solution = [{ type: "expression" as const, value: "2*x", group: 0 }];

  test("uses symbolic equality when equivalents are allowed", () => {
    expect(checkSolution("x*2", question({ solutions: solution, allowEquivalent: true }))).toBe(true);
  });

  test("requires an exact string when equivalents are disabled", () => {
    expect(checkSolution("x*2", question({ solutions: solution, allowEquivalent: false }))).toBe(false);
  });
});

describe("grouped answers", () => {
  test("accepts a complete unordered assignment", () => {
    const q = question({
      requireAllSolutionGroups: true,
      solutions: [
        { type: "text", value: "a", group: 0 },
        { type: "text", value: "b", group: 0 },
        { type: "text", value: "b", group: 1 },
        { type: "text", value: "c", group: 1 }
      ]
    });
    expect(checkSolution(["b", "c"], q)).toBe(true);
  });

  test("uses an augmenting path when a greedy assignment would fail", () => {
    const q = question({
      requireAllSolutionGroups: true,
      solutions: [
        { type: "text", value: "a", group: 0 },
        { type: "text", value: "b", group: 0 },
        { type: "text", value: "b", group: 1 }
      ]
    });
    expect(checkSolution(["b", "a"], q)).toBe(true);
  });

  test("accepts non-contiguous group numbers and repeated answers", () => {
    const q = question({
      requireAllSolutionGroups: true,
      solutions: [
        { type: "text", value: "x", group: 5 },
        { type: "text", value: "x", group: 9 }
      ]
    });
    expect(checkSolution(["x", "x"], q)).toBe(true);
  });

  test("rejects a partial unordered assignment", () => {
    const q = question({
      requireAllSolutionGroups: true,
      solutions: [
        { type: "text", value: "a", group: 0 },
        { type: "text", value: "b", group: 1 }
      ]
    });
    expect(checkSolution(["a", "a"], q)).toBe(false);
  });

  test("rejects blank answers in grouped mode", () => {
    const q = question({
      requireAllSolutionGroups: true,
      solutions: [
        { type: "text", value: "a", group: 0 },
        { type: "text", value: "b", group: 1 }
      ]
    });
    expect(checkSolution(["", "b"], q)).toBe(false);
    expect(checkSolution(["a", "   "], q)).toBe(false);
  });

  test("honours answer order when requested", () => {
    const q = question({
      requireAllSolutionGroups: true,
      solutionOrderMatters: true,
      solutions: [
        { type: "text", value: "a", group: 0 },
        { type: "text", value: "b", group: 1 }
      ]
    });
    expect(checkSolution(["a", "b"], q)).toBe(true);
    expect(checkSolution(["b", "a"], q)).toBe(false);
  });

  test("fails quickly when one group has no matching answer", () => {
    const solutions = Array.from({ length: 13 }, (_, index) => ({
      type: "text" as const,
      value: index === 12 ? "1" : "0",
      group: index
    }));
    const q = question({ requireAllSolutionGroups: true, solutions });
    const started = performance.now();
    expect(checkSolution(Array(13).fill("0"), q)).toBe(false);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
