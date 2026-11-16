import { create, all } from "mathjs";

const math = create(all);

// Expression solutions are stored as MathJS-compatible ASCII, while MathLive
// and the print renderers expect LaTex to display roots, fractions, and powers.
// The editor converts LaTeX -> ASCII -> LaTeX on every keystroke, and MathLive's ASCII
// wraps fraction parts in brackets ("(3)/(28)"). Keeping those brackets in the LaTeX would
// add another pair each round trip, so drop brackets that do not change the meaning.
export function expressionToLatex(value: string): string {
  // math.js parses an empty string to a node whose LaTeX is the word "undefined".
  if (!value.trim()) return "";
  try {
    return math.parse(value).toTex({ parenthesis: "auto" });
  } catch {
    return value;
  }
}
