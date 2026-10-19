import { describe, expect, test } from "bun:test";
import { layoutLines, linesHeight, TYPE, type Atom, type Measure } from "./print/layout";

// Every character is half the font size wide, so widths are easy to reason about.
const measure: Measure = (text, _style, size) => text.length * size * 0.5;
const serif = { family: "serif" } as const;
const text = (value: string): Atom => ({ type: "text", text: value, style: serif });
const math = (width: number, ascent: number, descent: number): Atom => ({
  type: "math",
  latex: "x",
  scale: 1,
  style: serif,
  box: { width, ascent, descent, svg: "<svg/>" }
});

describe("layoutLines", () => {
  test("keeps inline maths on the same line as the surrounding words", () => {
    const lines = layoutLines([text("Solve for "), math(1, 0.7, 0.2), text(": done")], 200, 10, measure);
    expect(lines).toHaveLength(1);
    expect(lines[0].items.map((item) => item.type)).toEqual(["text", "math", "text"]);
    const [, formula, after] = lines[0].items;
    expect(formula.x).toBe(50);
    // The colon is glued to the formula: no space between them.
    expect(after.x).toBe(50 + 10.6);
  });

  test("wraps at spaces and merges words of one style into a run", () => {
    const lines = layoutLines([text("aaaa bbbb cccc")], 50, 10, measure);
    expect(lines.map((line) => line.items.map((item) => (item.type === "text" ? item.text : "")))).toEqual([
      ["aaaa bbbb"],
      ["cccc"]
    ]);
  });

  test("grows the line box for tall maths and keeps plain lines at the body line height", () => {
    const [plain] = layoutLines([text("abc")], 100, 10, measure);
    expect(plain.ascent + plain.descent).toBeCloseTo(10 * TYPE.lineHeight);
    const [tall] = layoutLines([text("a "), math(2, 1.5, 0.9)], 100, 10, measure);
    expect(tall.ascent).toBeCloseTo(1.5 * 10 * TYPE.mathEm + 10 * TYPE.mathPadAbove);
    expect(tall.descent).toBeCloseTo(0.9 * 10 * TYPE.mathEm + 10 * TYPE.mathPadBelow);
  });

  test("honours line breaks, including an empty line", () => {
    const lines = layoutLines([text("a"), { type: "break" }, { type: "break" }, text("b")], 100, 10, measure);
    expect(lines).toHaveLength(3);
    expect(lines[1].items).toHaveLength(0);
    expect(linesHeight(lines)).toBeCloseTo(3 * 10 * TYPE.lineHeight);
  });

  test("shrinks maths wider than the line instead of overflowing", () => {
    const [line] = layoutLines([math(20, 1, 0.5)], 100, 10, measure);
    expect(line.items[0].width).toBeCloseTo(100);
  });
});
