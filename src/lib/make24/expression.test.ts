import { describe, expect, test } from "bun:test";
import { collectLeaves, evaluate, parse, validate } from "./expression";
import { ParseError } from "./expression";

describe("expression parse", () => {
  test("parses valid expressions", () => {
    expect(collectLeaves(parse("8/(3-8/3)"))).toEqual([8, 3, 8, 3]);
    expect(collectLeaves(parse("4*4+4+4"))).toEqual([4, 4, 4, 4]);
    expect(collectLeaves(parse("8÷(3−8÷3)"))).toEqual([8, 3, 8, 3]);
    expect(collectLeaves(parse("6×(1+5÷5)"))).toEqual([6, 1, 5, 5]);
  });

  test("rejects invalid input", () => {
    expect(() => parse("")).toThrow(ParseError);
    expect(() => parse("-5+2")).toThrow(ParseError);
    expect(() => parse("2.5+3")).toThrow(ParseError);
    expect(() => parse("sqrt(4)+1")).toThrow(ParseError);
    expect(() => parse("2^3+1")).toThrow(ParseError);
    expect(() => parse("2(3)+4")).toThrow(ParseError);
    expect(() => parse("2 3+4")).toThrow(ParseError);
    expect(() => parse("(2+3")).toThrow(ParseError);
    expect(() => parse("2+")).toThrow(ParseError);
    expect(() => parse("2++2")).toThrow(ParseError);
    expect(() => parse("-(2+3)")).toThrow(ParseError);
  });
});

describe("expression evaluate/validate", () => {
  test("exact 8/(3-8/3) == 24", () => {
    expect(evaluate(parse("8/(3-8/3)")).n).toBe(24);
    expect(evaluate(parse("8/(3-8/3)")).d).toBe(1);
  });

  test("division by zero invalidates", () => {
    const r = validate("8/(3-3)+8", [3, 3, 8, 8]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.toLowerCase()).toContain("zero");
  });

  test("leaf multiset check rejects smuggled/dropped numbers", () => {
    const r = validate("8/(3-8/3)", [3, 3, 8, 8]);
    expect(r.ok).toBe(true);
    const bad = validate("8/(2-8/3)", [3, 3, 8, 8]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.reason).toContain("2");
      expect(bad.reason).toContain("expected");
    }
    const wrongCount = validate("8+8+8", [3, 3, 8, 8]);
    expect(wrongCount.ok).toBe(false);
  });

  test("non-24 result rejected", () => {
    const r = validate("1+2+3+4", [1, 2, 3, 4]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("24");
  });
});
