import { expect, test } from "bun:test";
import { create, all } from "mathjs";
import { expressionToLatex } from "./expression";

// MathLive reads navigator.language, which Bun leaves undefined.
if (!navigator.language) Object.defineProperty(navigator, "language", { value: "en", configurable: true });
const { convertLatexToAsciiMath } = await import("mathlive");
const math = create(all);

// The answer editor stores ASCII, shows LaTeX, and reads ASCII back on every keystroke.
// Each round trip must settle instead of wrapping fraction parts in another pair of brackets.
test.each(["3/28", "2(x+1)", "(x+1)^2", "sqrt(x)/2", "(a+b)/(c-d)", "x^(2y)", "-(x-1)", "1/(2x)", "x^2/3"])(
  "%s survives repeated editor round trips",
  (start) => {
    let value: string = start;
    const steps = [value];
    for (let round = 0; round < 4; round++) {
      value = convertLatexToAsciiMath(expressionToLatex(value));
      steps.push(value);
    }
    expect(steps[4]).toBe(steps[1]);
    expect(expressionToLatex(value)).not.toContain("\\left(\\left(");
    const scope = { x: 1.7, y: 0.3, a: 2, b: 5, c: 7, d: 3 };
    expect(math.evaluate(value, scope)).toBeCloseTo(math.evaluate(start, scope));
  }
);

test("an empty expression stays empty", () => {
  expect(expressionToLatex("")).toBe("");
  expect(expressionToLatex("  ")).toBe("");
});

test("fractions render without extra brackets", () => {
  expect(expressionToLatex("(3)/(28)")).toBe("\\frac{3}{28}");
});
