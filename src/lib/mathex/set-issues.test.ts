import { describe, expect, test } from "bun:test";
import { pdfOptionIssues, plainQuestionText, questionIssues } from "./set-issues";
import type { DraftQuestionValue } from "./collaborative-set.schemas";

const question = (overrides: Partial<DraftQuestionValue> = {}): DraftQuestionValue => ({
  contents: "<p>What is 2+2?</p>",
  solutions: [{ type: "number", value: 4, group: 0 }],
  allowEquivalent: true,
  answerComment: "",
  requireAllSolutionGroups: false,
  solutionOrderMatters: false,
  skippable: true,
  ...overrides
});

describe("plainQuestionText", () => {
  test("keeps math source instead of dropping it", () => {
    expect(plainQuestionText("<p>Solve $$x^2=4$$ now</p>")).toBe("Solve x^2=4 now");
  });

  test("drops the stored scale prefix", () => {
    expect(plainQuestionText("$$[scale=1.5]x+1$$")).toBe("x+1");
  });

  test("keeps comparison operators and math containing <", () => {
    expect(plainQuestionText("<p>Find x where x < 2 and y > 1</p>")).toBe("Find x where x < 2 and y > 1");
    expect(plainQuestionText("<p>Show $$a<b>c$$ holds</p>")).toBe("Show a<b>c holds");
  });

  test("decodes entities once, including numeric spaces", () => {
    expect(plainQuestionText("<p>&#160;</p>")).toBe("");
    expect(plainQuestionText("a &amp;lt; b &quot;c&quot;")).toBe('a &lt; b "c"');
  });
});

describe("questionIssues", () => {
  test("accepts a complete question", () => {
    expect(questionIssues(question())).toEqual({ errors: [], warnings: [] });
  });

  test("warns about empty text and missing solutions", () => {
    expect(questionIssues(question({ contents: "<p>&#160;</p>", solutions: [] }))).toEqual({
      errors: [],
      warnings: ["Question text is empty", "No solutions"]
    });
  });

  test("an image-only question is not empty", () => {
    expect(questionIssues(question({ contents: '<p><img src="x.png"></p>' })).warnings).toEqual([]);
  });

  test("flags export-blocking number and group problems as errors", () => {
    const { errors } = questionIssues(
      question({
        solutions: [
          { type: "number", value: "" as unknown as number, group: 0 },
          { type: "number", value: Number.NaN, group: 0 },
          { type: "text", value: "ok", group: 100 }
        ]
      })
    );
    expect(errors).toEqual([
      "Solution 1 needs a number",
      "Solution 2 needs a number",
      "Solution 3 has an invalid answer group"
    ]);
  });

  test("flags overlong notes as an error", () => {
    expect(questionIssues(question({ answerComment: "x".repeat(2001) })).errors).toEqual([
      "Notes are longer than 2000 characters"
    ]);
  });

  test("warns about blank text and bad expressions", () => {
    const { errors, warnings } = questionIssues(
      question({
        solutions: [
          { type: "expression", value: "2 +* x", group: 0 },
          { type: "text", value: "  ", group: 0 }
        ]
      })
    );
    expect(errors).toEqual([]);
    expect(warnings).toEqual(["Solution 1 is not a valid expression", "Solution 2 is empty"]);
  });
});

describe("pdfOptionIssues", () => {
  const valid = { questionTextSize: 11, answerTextSize: 11, imageHeight: 30, slipHeight: 49.5, cutMargin: 50 };

  test("accepts defaults", () => {
    expect(pdfOptionIssues(valid)).toEqual([]);
  });

  test("reports out of range and cleared values", () => {
    expect(pdfOptionIssues({ ...valid, imageHeight: 99 }).length).toBe(1);
    expect(pdfOptionIssues({ ...valid, cutMargin: null }).length).toBe(1);
  });
});
