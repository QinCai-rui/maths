import { describe, expect, test } from "bun:test";
import { expressionToLatex, fractionToLatex, renderExpression, renderFraction, renderNumber } from "./calculator-latex";

describe("expressionToLatex", () => {
  test("typesets fractions, roots and constants", () => {
    expect(expressionToLatex("1/3")).toBe("\\frac{1}{3}");
    expect(expressionToLatex("sqrt(2)")).toBe("\\sqrt{2}");
    expect(expressionToLatex("π")).toBe("\\pi");
    expect(expressionToLatex("3^2")).toBe("{3}^{2}");
    expect(expressionToLatex("2π")).toContain("\\pi");
  });
  test("renders n-th roots as textbook radicals", () => {
    expect(expressionToLatex("root(27,3)")).toBe("\\sqrt[3]{27}");
  });
  test("does not mis-render a root with extra arguments", () => {
    expect(expressionToLatex("root(1,2,3)")).not.toContain("\\sqrt");
  });
  test("tidies the ln alias", () => {
    expect(expressionToLatex("ln(2)")).toContain("\\ln");
  });
  test("returns null for incomplete or empty input", () => {
    expect(expressionToLatex("")).toBeNull();
    expect(expressionToLatex("2+")).toBeNull();
  });
});

describe("fractionToLatex", () => {
  test("builds stacked fractions with the sign outside", () => {
    expect(fractionToLatex("1/3")).toBe("\\frac{1}{3}");
    expect(fractionToLatex("5/2")).toBe("\\frac{5}{2}");
    expect(fractionToLatex("-1/3")).toBe("-\\frac{1}{3}");
    expect(fractionToLatex("nonsense")).toBe("nonsense");
  });
});

describe("rendering helpers", () => {
  test("produce KaTeX MathML markup", () => {
    expect(renderExpression("1/3")).toContain("<math");
    expect(renderExpression("2+")).toBeNull();
    expect(renderNumber("0.5")).toContain("<math");
    expect(renderFraction("1/3")).toContain("mfrac");
  });
});
