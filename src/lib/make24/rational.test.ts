import { describe, expect, test } from "bun:test";
import { DivisionByZero, add, div, equals, fromInt, isInteger, mul, sub, toNumber, toString } from "./rational";

describe("rational", () => {
  test("reduction keeps denominator positive", () => {
    expect(toString(add(fromInt(1), fromInt(1)))).toBe("2");
    expect(equals(div(fromInt(6), fromInt(8)), { n: 3, d: 4 })).toBe(true);
  });

  test("arithmetic", () => {
    expect(add(fromInt(1), div(fromInt(1), fromInt(2)))).toEqual({ n: 3, d: 2 });
    expect(sub(fromInt(1), div(fromInt(1), fromInt(2)))).toEqual({ n: 1, d: 2 });
    expect(mul(div(fromInt(2), fromInt(3)), div(fromInt(3), fromInt(4)))).toEqual({
      n: 1,
      d: 2
    });
    expect(div(fromInt(8), div(fromInt(3), fromInt(1)))).toEqual({ n: 8, d: 3 });
  });

  test("division by zero throws typed error", () => {
    expect(() => div(fromInt(1), fromInt(0))).toThrow(DivisionByZero);
    expect(() => div(fromInt(1), { n: 0, d: 5 })).toThrow(DivisionByZero);
  });

  test("rejects values past safe-integer precision", () => {
    expect(() => fromInt(Number.MAX_SAFE_INTEGER + 1)).toThrow(/safe integer/);
    expect(() => mul(fromInt(Number.MAX_SAFE_INTEGER), fromInt(2))).toThrow(/precision/);
    expect(() => add(fromInt(Number.MAX_SAFE_INTEGER), fromInt(2))).toThrow(/precision/);
  });

  test("helpers", () => {
    expect(isInteger(fromInt(5))).toBe(true);
    expect(isInteger(div(fromInt(1), fromInt(2)))).toBe(false);
    expect(toString(fromInt(-7))).toBe("-7");
    expect(toString(div(fromInt(-6), fromInt(8)))).toBe("-3/4");
    expect(toNumber(div(fromInt(1), fromInt(2)))).toBe(0.5);
    expect(equals(fromInt(2), { n: 4, d: 2 })).toBe(false); // unreduced input is not equal
  });
});
