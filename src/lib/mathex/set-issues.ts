import { create, all } from "mathjs";
import { parseStoredMath } from "./content";
import { QuestionSet } from "./schemas";
import type { DraftQuestionValue } from "./collaborative-set.schemas";

const math = create(all);

const namedEntities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " "
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (match, dec, hex, name) => {
    if (name) return namedEntities[name.toLowerCase()] ?? match;
    const code = dec ? Number(dec) : parseInt(hex, 16);
    if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return match;
    return code === 160 ? " " : String.fromCodePoint(code);
  });
}

export function plainQuestionText(html: string): string {
  const withoutTags = html
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(withoutTags.replace(/\$\$([\s\S]+?)\$\$/g, (_, value: string) => ` ${parseStoredMath(value).latex.trim()} `))
    .replace(/\s+/g, " ")
    .trim();
}

export interface QuestionIssues {
  /** Problems that make PDF export or room creation fail. */
  errors: string[];
  /** Problems that export accepts but that are probably mistakes. */
  warnings: string[];
}

export function questionIssues(question: DraftQuestionValue): QuestionIssues {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!plainQuestionText(question.contents) && !/<img\b/i.test(question.contents)) warnings.push("Question text is empty");
  if (question.solutions.length === 0) warnings.push("No solutions");
  if ((question.answerComment ?? "").length > 2000) errors.push("Notes are longer than 2000 characters");
  for (const [index, solution] of question.solutions.entries()) {
    const label = `Solution ${index + 1}`;
    const value = solution.value as string | number | null | undefined;
    const group = solution.group as number | undefined;
    if (group !== undefined && (!Number.isInteger(group) || group < 0 || group > 99))
      errors.push(`${label} has an invalid answer group`);
    if (solution.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) errors.push(`${label} needs a number`);
    } else if (typeof value !== "string") {
      errors.push(`${label} needs text`);
    } else if (!value.trim()) {
      warnings.push(`${label} is empty`);
    } else if (solution.type === "expression") {
      try {
        math.parse(value);
      } catch {
        warnings.push(`${label} is not a valid expression`);
      }
    }
  }
  return { errors, warnings };
}

export function pdfOptionIssues(pdfOptions: unknown): string[] {
  const result = QuestionSet.shape.pdfOptions.safeParse(pdfOptions);
  if (result.success) return [];
  return result.error.issues.map((issue) => `Print setting ${issue.path.join(".") || ""}: ${issue.message}`.trim());
}
