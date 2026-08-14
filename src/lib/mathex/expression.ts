import { create, all } from "mathjs";

const math = create(all);

// Expression solutions are stored as MathJS-compatible ASCII, while MathLive
// and the print renderers expect LaTex to display roots, fractions, and powers.
export function expressionToLatex(value: string): string {
  try {
    return math.parse(value).toTex();
  } catch {
    return value;
  }
}
