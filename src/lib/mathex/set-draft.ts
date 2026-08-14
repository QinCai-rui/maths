import { QuestionSet, type Question } from "./schemas";
import type { z } from "zod";

export const MATHEX_DRAFT_KEY = "mathex-draft";

function migrateSolutions(solutions: unknown[]): z.infer<typeof Question>["solutions"] {
  return solutions.map((solution) => {
    if (solution && typeof solution === "object" && "type" in solution && "value" in solution) return solution as any;
    if (typeof solution === "number") return { type: "number", value: solution };
    return { type: "text", value: String(solution) };
  });
}

function migrateQuestion(value: any): z.infer<typeof Question> {
  const source = value?.type && value?.data ? value.data : value?.data || value || {};
  return {
    contents: source.contents || "",
    solutions: Array.isArray(source.solutions) ? migrateSolutions(source.solutions) : [],
    allowEquivalent: source.allowEquivalent ?? true,
    answerComment: source.answerComment || "",
    requireAllSolutionGroups: source.requireAllSolutionGroups ?? false,
    solutionOrderMatters: source.solutionOrderMatters ?? false
  };
}

export function parseQuestionSet(value: unknown) {
  const parsed = Array.isArray(value) ? { questions: value } : (value as any) || {};
  return QuestionSet.safeParse({
    name: parsed.name || "",
    instructions: parsed.instructions || "",
    questions: Array.isArray(parsed.questions) ? parsed.questions.map(migrateQuestion) : [],
    pdfOptions: parsed.pdfOptions
  });
}

export function questionSetDifferences(
  local: z.infer<typeof QuestionSet>,
  shared: z.infer<typeof QuestionSet>
): string[] {
  const differences: string[] = [];
  if (local.name !== shared.name) differences.push("Set name");
  if (local.instructions !== shared.instructions) differences.push("Cover instructions");
  for (const key of Object.keys(shared.pdfOptions) as (keyof typeof shared.pdfOptions)[]) {
    if (local.pdfOptions[key] !== shared.pdfOptions[key]) differences.push(`Print setting: ${key}`);
  }
  if (local.questions.length !== shared.questions.length) {
    differences.push(`Question count (${local.questions.length} local, ${shared.questions.length} shared)`);
  }
  const count = Math.max(local.questions.length, shared.questions.length);
  for (let index = 0; index < count; index++) {
    const localQuestion = local.questions[index];
    const sharedQuestion = shared.questions[index];
    if (!localQuestion) {
      differences.push(`Question ${index + 1}: missing locally`);
      continue;
    }
    if (!sharedQuestion) {
      differences.push(`Question ${index + 1}: only exists locally`);
      continue;
    }
    if (localQuestion.contents !== sharedQuestion.contents) differences.push(`Question ${index + 1}: question text`);
    if (JSON.stringify(localQuestion.solutions) !== JSON.stringify(sharedQuestion.solutions)) {
      differences.push(`Question ${index + 1}: solutions`);
    }
    if (localQuestion.allowEquivalent !== sharedQuestion.allowEquivalent) {
      differences.push(`Question ${index + 1}: equivalent-expression setting`);
    }
    if (localQuestion.answerComment !== sharedQuestion.answerComment) {
      differences.push(`Question ${index + 1}: marker comments`);
    }
    if (localQuestion.requireAllSolutionGroups !== sharedQuestion.requireAllSolutionGroups) {
      differences.push(`Question ${index + 1}: required-answer setting`);
    }
    if (localQuestion.solutionOrderMatters !== sharedQuestion.solutionOrderMatters) {
      differences.push(`Question ${index + 1}: answer-order setting`);
    }
  }
  return differences;
}

export function downloadSetJson(value: unknown, filename = "mathex-set-backup.json") {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
