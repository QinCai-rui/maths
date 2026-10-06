import { describe, expect, test } from "bun:test";
import {
  evaluateExpression,
  formatChainLiteral,
  formatFraction,
  formatNumber,
  normalizeExpression,
  type CalculatorOptions
} from "./calculator";

const deg: CalculatorOptions = { angleMode: "deg", showFraction: true };
const rad: CalculatorOptions = { angleMode: "rad", showFraction: true };

function value(expression: string, options: CalculatorOptions = rad): number {
  const result = evaluateExpression(expression, options);
  if (!result.ok) throw new Error(`expected ${expression} to evaluate, got ${result.error}`);
  return result.value;
}

describe("normalizeExpression", () => {
  test("rewrites the pretty symbols the keypad emits", () => {
    expect(normalizeExpression("3×4÷2")).toBe("3*4/2");
    expect(normalizeExpression("−5")).toBe("-5");
    expect(normalizeExpression("2²+3³")).toBe("2^2+3^3");
  });
  test("makes implicit multiplication explicit", () => {
    expect(normalizeExpression("2π")).toBe("2*pi");
    expect(normalizeExpression("3(4+1)")).toBe("3*(4+1)");
    expect(normalizeExpression("2sin(30)")).toBe("2*sin(30)");
    expect(normalizeExpression("(2)3")).toBe("(2)*3");
    expect(normalizeExpression("2e3")).toBe("2*e*3");
    expect(normalizeExpression("2ln(3)")).toBe("2*ln(3)");
  });
});

describe("implicit multiplication", () => {
  test("handles constants, brackets, and function calls", () => {
    expect(value("2pi")).toBeCloseTo(Math.PI * 2, 12);
    expect(value("3(4+1)")).toBe(15);
    expect(value("2(3)(4)")).toBe(24);
    expect(value("2sin(30)", deg)).toBeCloseTo(1, 12);
  });
  test("supports constant-first forms and never reads e as an exponent", () => {
    expect(value("2π")).toBeCloseTo(Math.PI * 2, 12);
    expect(value("π2")).toBeCloseTo(Math.PI * 2, 12);
    expect(value("π(2)")).toBeCloseTo(Math.PI * 2, 12);
    expect(value("e2")).toBeCloseTo(Math.E * 2, 12);
    expect(value("2e3")).toBeCloseTo(Math.E * 6, 12);
    expect(value("(2)3")).toBe(6);
  });
});

describe("angle mode", () => {
  test("degrees and radians give different, correct answers", () => {
    expect(value("sin(30)", deg)).toBeCloseTo(0.5, 12);
    expect(value("sin(30)", rad)).toBeCloseTo(Math.sin(30), 12);
    expect(value("asin(0.5)", deg)).toBeCloseTo(30, 12);
    expect(value("cos(60)", deg)).toBeCloseTo(0.5, 12);
  });
  test("snaps degree-mode floating point residue to clean values", () => {
    expect(value("sin(180)", deg)).toBe(0);
    expect(value("cos(90)", deg)).toBe(0);
    expect(value("sin(360)", deg)).toBe(0);
    expect(value("atan2(1,1)", deg)).toBeCloseTo(45, 12);
    expect(value("sec(60)", deg)).toBeCloseTo(2, 12);
  });
  test("only snaps trig output, not every near-integer degree result", () => {
    expect(value("5.0000000001", deg)).toBeCloseTo(5.0000000001, 12);
  });
  test("tan at an asymptote is undefined rather than huge", () => {
    const result = evaluateExpression("tan(90)", deg);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toBe("Undefined");
  });
});

describe("extra functions", () => {
  test("evaluates factorials, combinations, permutations and roots", () => {
    expect(value("5!")).toBe(120);
    expect(value("nCr(5,2)")).toBe(10);
    expect(value("nPr(5,2)")).toBe(20);
    expect(value("abs(-3)")).toBe(3);
    expect(value("root(27,3)")).toBeCloseTo(3, 12);
    expect(value("cbrt(27)")).toBeCloseTo(3, 12);
    expect(value("log(8,2)")).toBeCloseTo(3, 12);
    expect(value("log(1000)")).toBeCloseTo(Math.log(1000), 12);
    expect(value("ln(1000)")).toBeCloseTo(Math.log(1000), 12);
  });
});

describe("fraction display", () => {
  test("shows clean rationals", () => {
    const third = evaluateExpression("1/3", deg);
    expect(third.ok && third.display).toBe("0.333333333333");
    expect(third.ok && third.fraction).toBe("1/3");
    expect(formatFraction(0.5)).toBe("1/2");
    expect(formatFraction(1 / 3 + 1 / 6)).toBe("1/2");
    expect(formatFraction(2.5)).toBe("5/2");
    expect(formatFraction(-1 / 3)).toBe("-1/3");
    expect(formatFraction(-0.5)).toBe("-1/2");
  });
  test("does not invent fractions for irrationals or integers", () => {
    expect(formatFraction(Math.PI)).toBeUndefined();
    expect(formatFraction(Math.SQRT2)).toBeUndefined();
    expect(formatFraction(4)).toBeUndefined();
  });
  test("applies the denominator limit at the boundary", () => {
    expect(formatFraction(1 / 10_000)).toBe("1/10000");
    expect(formatFraction(1 / 10_001)).toBeUndefined();
  });
  test("respects the showFraction setting", () => {
    const hidden = evaluateExpression("1/3", { angleMode: "deg", showFraction: false });
    expect(hidden.ok && hidden.fraction).toBeUndefined();
  });
});

describe("errors", () => {
  test("reports distinct, useful messages", () => {
    expect(evaluateExpression("", rad).ok).toBe(false);
    expect(evaluateExpression("2 +", rad)).toEqual({ ok: false, error: "Error" });
    expect(evaluateExpression("sqrt(-1)", rad)).toEqual({ ok: false, error: "Not a real number" });
    expect(evaluateExpression("0/0", rad)).toEqual({ ok: false, error: "Undefined" });
    expect(evaluateExpression("1/0", rad)).toEqual({ ok: false, error: "Out of range" });
  });
});

describe("formatNumber", () => {
  test("rounds to twelve significant figures", () => {
    expect(formatNumber(1 / 3)).toBe("0.333333333333");
    expect(formatNumber(10)).toBe("10");
    expect(formatNumber(-0)).toBe("0");
  });
});

describe("formatChainLiteral", () => {
  test("expands exponent notation so `e` is never reread as Euler's number", () => {
    const tiny = formatChainLiteral(2 ** -20);
    expect(tiny).not.toContain("e");
    expect(Number(tiny)).toBe(2 ** -20);
    const huge = formatChainLiteral(1e21);
    expect(huge).not.toContain("e");
    expect(Number(huge)).toBe(1e21);
  });
  test("leaves plain numbers untouched", () => {
    expect(formatChainLiteral(10)).toBe("10");
    expect(formatChainLiteral(-0.5)).toBe("-0.5");
    expect(formatChainLiteral(Math.PI)).toBe("3.141592653589793");
  });
});
