import { renderToString } from "katex";
import { normalizeExpression } from "./calculator";
import { math } from "./math";

/**
 * Converts the calculator's ASCII/pretty expression into LaTeX, ready for
 * KaTeX. Returns null when the expression is incomplete or unparseable so the
 * caller can fall back to the raw text.
 */
export function expressionToLatex(raw: string): string | null {
  const normalized = normalizeExpression(raw).trim();
  if (!normalized) return null;
  try {
    return polishLatex(math.parse(normalized).toTex());
  } catch {
    return null;
  }
}

/**
 * mathjs renders the keypad's `root(x, n)` alias as `\mathrm{root}\left(x,n\right)`.
 * Render the common simple case as textbook n-th-root notation instead, and
 * tidy the `ln` alias (which mathjs does not know natively).
 */
function polishLatex(latex: string): string {
  return latex
    .replace(
      /\\mathrm\{root\}\\left\(([^{}(),]+),([^{}(),]+)\\right\)/g,
      (_match, radicand: string, index: string) => `\\sqrt[${index}]{${radicand}}`
    )
    .replace(/\\mathrm\{ln\}/g, "\\ln");
}

/** Turns a plain "n/d" (or "-n/d") fraction string into a stacked LaTeX fraction. */
export function fractionToLatex(fraction: string): string {
  const match = /^(-?)(\d+)\/(\d+)$/.exec(fraction.trim());
  if (!match) return fraction;
  const [, sign, numerator, denominator] = match;
  return `${sign ? "-" : ""}\\frac{${numerator}}{${denominator}}`;
}

/**
 * Renders LaTeX to KaTeX MathML. With `throwOnError: false` KaTeX emits error
 * markup rather than throwing, so this only guards against unexpected errors.
 */
export function renderLatex(latex: string): string {
  try {
    return renderToString(latex, { output: "mathml", throwOnError: false });
  } catch {
    return "";
  }
}

/** Typeset markup for an expression, or null when it cannot be parsed yet. */
export function renderExpression(raw: string): string | null {
  const latex = expressionToLatex(raw);
  if (!latex) return null;
  const html = renderLatex(latex);
  return html || null;
}

/** Typeset markup for a plain decimal result such as "-0.5". */
export function renderNumber(value: string): string {
  return renderLatex(value);
}

/** Typeset markup for an exact fraction result such as "-1/3". */
export function renderFraction(fraction: string): string {
  return renderLatex(fractionToLatex(fraction));
}
