import { all, create } from "mathjs";
import type { z } from "zod";
import type { Question } from "./schemas";

const math = create(all);

type QuestionValue = z.infer<typeof Question>;
type Solution = QuestionValue["solutions"][number];

export function matchesSolution(guess: string | number, solution: Solution, question: QuestionValue) {
  if (solution.type === "number") {
    // Number("") and Number("   ") are 0, which would award a blank answer.
    if (typeof guess === "string" && guess.trim() === "") return false;
    return Number(guess) === solution.value;
  }
  if (solution.type === "text") return String(guess).trim().toLowerCase() === solution.value.trim().toLowerCase();
  if (!question.allowEquivalent) return String(guess).trim() === solution.value;
  try {
    return math.symbolicEqual(math.parse(solution.value), math.parse(String(guess)));
  } catch {
    return false;
  }
}

/**
 * Finds a complete answer-to-group assignment with augmenting paths.
 *
 * The previous backtracking search enumerated every permutation, so a valid
 * question could block the server with factorial work. Each answer only checks
 * each group once here, which keeps the worst case polynomial.
 */
function hasCompleteMatching(answers: (string | number)[], groups: Solution[][], question: QuestionValue) {
  const candidates = answers.map((answer) => {
    const matches: number[] = [];
    groups.forEach((solutions, index) => {
      if (solutions.some((solution) => matchesSolution(answer, solution, question))) matches.push(index);
    });
    return matches;
  });
  if (candidates.some((matches) => matches.length === 0)) return false;

  const groupAnswer = new Array<number>(groups.length).fill(-1);
  const assign = (answerIndex: number, seen: boolean[]): boolean => {
    for (const groupIndex of candidates[answerIndex]) {
      if (seen[groupIndex]) continue;
      seen[groupIndex] = true;
      if (groupAnswer[groupIndex] === -1 || assign(groupAnswer[groupIndex], seen)) {
        groupAnswer[groupIndex] = answerIndex;
        return true;
      }
    }
    return false;
  };

  for (let answerIndex = 0; answerIndex < answers.length; answerIndex++) {
    if (!assign(answerIndex, new Array<boolean>(groups.length).fill(false))) return false;
  }
  return true;
}

export function checkSolution(guess: string | number | (string | number)[], question: QuestionValue) {
  if (!question.requireAllSolutionGroups) {
    const answer = Array.isArray(guess) ? guess[0] : guess;
    return question.solutions.some((solution) => matchesSolution(answer, solution, question));
  }

  const grouped = new Map<number, Solution[]>();
  for (const solution of question.solutions) {
    const group = solution.group ?? 0;
    grouped.set(group, [...(grouped.get(group) || []), solution]);
  }
  const groups = [...grouped.entries()].sort(([a], [b]) => a - b).map(([, solutions]) => solutions);
  const answers = Array.isArray(guess) ? guess : [guess];
  if (answers.length !== groups.length || answers.some((answer) => String(answer).trim() === "")) return false;
  if (question.solutionOrderMatters) {
    return groups.every((solutions, index) =>
      solutions.some((solution) => matchesSolution(answers[index], solution, question))
    );
  }

  return hasCompleteMatching(answers, groups, question);
}
