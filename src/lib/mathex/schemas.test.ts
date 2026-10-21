import { describe, expect, test } from "bun:test";
import { Question } from "./schemas";

describe("legacy question migration", () => {
  test("rejects null data instead of throwing", () => {
    expect(() => Question.safeParse({ type: "x", data: null })).not.toThrow();
    expect(Question.safeParse({ type: "x", data: null }).success).toBe(false);
  });

  test("rejects array and primitive data", () => {
    expect(Question.safeParse({ type: "x", data: [] }).success).toBe(false);
    expect(Question.safeParse({ type: "x", data: "text" }).success).toBe(false);
  });

  test("still migrates the documented legacy shape", () => {
    const parsed = Question.safeParse({
      type: "x",
      data: {
        contents: "<p>Hello</p>",
        solutions: [{ type: "number", value: 4 }]
      }
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.contents).toBe("<p>Hello</p>");
      expect(parsed.data.solutions).toEqual([{ type: "number", value: 4, group: 0 }]);
    }
  });

  test("keeps the old defaults for null optional fields", () => {
    const parsed = Question.safeParse({
      type: "x",
      data: { contents: null, solutions: null, answerComment: null }
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.contents).toBe("");
      expect(parsed.data.solutions).toEqual([]);
      expect(parsed.data.answerComment).toBe("");
    }
  });
});
