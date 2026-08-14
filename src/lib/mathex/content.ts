import { renderToString } from "katex";
import DOMPurify from "dompurify";

const mathRegex = /\$\$([^$]+)\$\$/g;

export function parseStoredMath(value: string) {
  const match = /^\[scale=(0\.5|0\.75|1|1\.25|1\.5|1\.75|2\.5)\]([\s\S]*)$/.exec(value);
  return { latex: match ? match[2] : value, scale: match ? Number(match[1]) : 1 };
}

function renderKatex(value: string): string {
  const { latex, scale } = parseStoredMath(value);
  try {
    const math = renderToString(latex, { output: "mathml", throwOnError: false });
    return scale === 1 ? math : `<span style="font-size:${scale}em">${math}</span>`;
  } catch {
    return `<code class="text-destructive">${latex}</code>`;
  }
}

export function renderMath(html: string): string {
  const clean = DOMPurify.sanitize(html);
  return clean.replace(mathRegex, (_, value) => renderKatex(value));
}

export function renderMathNoSanitize(html: string): string {
  return html.replace(mathRegex, (_, value) => renderKatex(value));
}

export function stripTags(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent || "";
}
