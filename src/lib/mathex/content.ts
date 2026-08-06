import { renderToString } from "katex";
import DOMPurify from "dompurify";

const mathRegex = /\$\$([^$]+)\$\$/g;

function renderKatex(latex: string): string {
  try {
    return renderToString(latex, { output: "mathml", throwOnError: false });
  } catch {
    return `<code class="text-destructive">${latex}</code>`;
  }
}

export function renderMath(html: string): string {
  const clean = DOMPurify.sanitize(html);
  return clean.replace(mathRegex, (_, latex) => renderKatex(latex));
}

export function renderMathNoSanitize(html: string): string {
  return html.replace(mathRegex, (_, latex) => renderKatex(latex));
}

export function stripTags(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent || "";
}
