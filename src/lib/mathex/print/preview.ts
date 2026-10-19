// HTML print previews. They open in a popup, use the same fonts and slip geometry as the
// PDF, render maths inline with KaTeX MathML, and shrink overflowing slips the same way.

import { renderMath } from "../content";
import { expressionToLatex } from "../expression";
import { SLIP_GEOMETRY as G } from "./geometry";
import { listMarkers } from "./blocks";
import {
  ACCENT,
  coverLabel,
  FONT_FILES,
  INK,
  MUTED,
  markerNotes,
  partName,
  SANS_FACE,
  SERIF_FACE,
  solutionGroups,
  WARN,
  type QuestionSetValue
} from "./pdf";
import { TYPE } from "./layout";

type Item = QuestionSetValue["questions"][number];

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Sanitized HTML with `$$...$$` maths rendered inline as KaTeX MathML. List items get
 * `data-marker` (the printed bullet or number) and `data-level` (Quill indent) attributes
 * so previews can draw markers that match the PDF.
 */
export function renderSlipHtml(html: string): string {
  const rendered = renderMath(html || "");
  if (!/<li[\s>]/i.test(rendered)) return rendered;
  const doc = new DOMParser().parseFromString(`<body>${rendered}</body>`, "text/html");
  for (const list of doc.body.querySelectorAll("ol, ul")) {
    for (const { item, level, marker } of listMarkers(list)) {
      item.setAttribute("data-marker", marker);
      item.setAttribute("data-level", String(level));
    }
  }
  return doc.body.innerHTML;
}

function fontFaces(origin: string) {
  return FONT_FILES.map(
    ({ file, family, weight, style }) =>
      `@font-face { font-family: "${family}"; src: url("${origin}/fonts/print/${file}") format("truetype"); font-weight: ${weight}; font-style: ${style}; }`
  ).join("\n");
}

const SHARED_STYLES = `
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: ${INK}; background: #e9e9e6; font-family: "${SERIF_FACE}", Georgia, serif; }
.toolbar { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 14px; padding: 10px 18px; background: #fbfbf9; border-bottom: 1px solid #d6d6d0; font: 13px/1.4 "${SANS_FACE}", system-ui, sans-serif; color: #444; }
.toolbar button { padding: 6px 14px; border: 1px solid ${ACCENT}; border-radius: 4px; background: ${ACCENT}; color: #fff; font: 600 13px/1.2 "${SANS_FACE}", system-ui, sans-serif; cursor: pointer; }
.toolbar button:hover { filter: brightness(1.1); }
.toolbar .note { color: #666; }
.toolbar .warn { color: ${WARN}; }
.label { font-family: "${SANS_FACE}", sans-serif; font-weight: 600; text-transform: uppercase; letter-spacing: ${G.label.letterSpacingEm}em; color: ${ACCENT}; white-space: nowrap; }
.katex { font: inherit; }
.katex math { font-size: ${TYPE.mathEm}em; }
.katex-html { display: none; }
@media print {
  body { background: none; }
  .toolbar { display: none; }
}
`;

const FIT_SCRIPT = `
addEventListener("load", async () => {
  const families = ${JSON.stringify(FONT_FILES.map(({ family, weight, style }) => `${style === "italic" ? "italic " : ""}${weight} 12pt "${family}"`))};
  try { await Promise.all(families.map((font) => document.fonts.load(font))); await document.fonts.ready; } catch {}
  await Promise.all([...document.images].map((image) => image.complete ? null : new Promise((resolve) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", resolve, { once: true });
  })));
  const failed = [];
  for (const slip of document.querySelectorAll(".slip")) {
    const content = slip.querySelector(".content");
    if (!content) continue;
    const over = () => content.scrollHeight > content.clientHeight + 0.5;
    let size = Number(slip.dataset.size), image = Number(slip.dataset.imageHeight);
    while (over() && size > 6) { size = Math.max(6, size - 0.5); content.style.fontSize = size + "pt"; }
    while (over() && image > 5) { image = Math.max(5, image - 1); content.style.setProperty("--image-height", image + "mm"); }
    if (over()) { slip.classList.add("overflow"); failed.push(slip.dataset.name); }
  }
  const status = document.querySelector("[data-status]");
  if (status && failed.length) {
    status.textContent = failed.join(", ") + (failed.length === 1 ? " does" : " do") + " not fit even at 6 pt. The PDF export will refuse until it is shortened.";
    status.className = "warn";
  }
});
`;

function openPrintDocument(title: string, body: string, styles: string, script = "") {
  const popup = window.open("", "_blank");
  if (!popup) return false;
  popup.opener = null;
  const origin = window.location.origin;
  popup.document.write(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
      `<style>${fontFaces(origin)}\n${SHARED_STYLES}\n${styles}</style></head><body>${body}` +
      (script ? `<script>${script}<\/script>` : "") +
      `</body></html>`
  );
  popup.document.close();
  return true;
}

function toolbar(note: string) {
  return `<div class="toolbar"><button type="button" onclick="print()">Print</button><span class="note" data-status>${escapeHtml(note)}</span></div>`;
}

export function previewQuestionSet(set: QuestionSetValue) {
  const options = set.pdfOptions;
  const pad = G.contentPaddingMm;
  const title = set.name.trim() || "Untitled set";
  const perPage = Math.max(1, Math.floor(G.pageHeightMm / options.slipHeight));
  const showFooter = options.cutMargin >= 16 && options.slipHeight >= 14;
  const total = set.questions.length;
  const slips = [
    {
      name: "The cover",
      label: coverLabel(set),
      html: `<h1 class="title">${escapeHtml(title)}</h1><div class="content-body">${renderSlipHtml(set.instructions)}</div>`,
      footer: "Cover"
    },
    ...set.questions.map((question, index) => ({
      name: `Question ${index + 1}`,
      label: `Question ${index + 1}`,
      html: `<div class="content-body">${renderSlipHtml(question.contents)}</div>`,
      footer: `${index + 1} / ${total}`
    }))
  ].map(
    (slip) =>
      `<section class="slip" data-name="${escapeHtml(slip.name)}" data-size="${options.questionTextSize}" data-image-height="${options.imageHeight}">` +
      `<div class="frame"><div class="label">${escapeHtml(slip.label)}</div>` +
      `<div class="content" style="font-size:${options.questionTextSize}pt">${slip.html}</div></div>` +
      (showFooter
        ? `<div class="strip"><div>${escapeHtml(title)}</div><div>${escapeHtml(slip.footer)}</div></div>`
        : "") +
      (options.cutMargin > 0 ? `<div class="cut"></div>` : "") +
      `</section>`
  );
  const pages: string[] = [];
  for (let start = 0; start < slips.length; start += perPage)
    pages.push(`<div class="page">${slips.slice(start, start + perPage).join("")}</div>`);

  const styles = `
@page { size: A4 portrait; margin: 0; }
.pages { padding: 18px 0 40px; }
.page { width: ${G.pageWidthMm}mm; height: ${G.pageHeightMm}mm; margin: 0 auto 18px; background: #fff; box-shadow: 0 1px 3px rgb(0 0 0 / 18%); overflow: hidden; break-after: page; }
.page:last-child { break-after: auto; }
.slip { position: relative; width: ${G.pageWidthMm}mm; height: ${options.slipHeight}mm; overflow: hidden; }
.slip::before { content: ""; position: absolute; top: 0; bottom: 0; left: ${G.bindingMm}mm; border-left: 0.5pt solid #bdbdbd; }
.slip::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; border-bottom: 0.6pt dashed #8f8f8f; }
.slip .cut { position: absolute; top: 0; bottom: 0; right: ${options.cutMargin}mm; border-left: 0.6pt dashed #8f8f8f; }
.frame { position: absolute; top: ${pad.top}mm; bottom: ${pad.bottom}mm; left: ${pad.left}mm; right: ${options.cutMargin + pad.right}mm; display: flex; flex-direction: column; }
.frame > .label { flex: none; font-size: ${G.label.sizePt}pt; line-height: ${TYPE.sansNaturalHeight}; margin-bottom: ${G.label.gapMm}mm; }
.content { --image-height: ${options.imageHeight}mm; flex: 1; min-height: 0; overflow: hidden; line-height: ${TYPE.lineHeight}; overflow-wrap: anywhere; }
.title { margin: 0 0 ${G.titleGapMm}mm; font-size: ${G.titleSizePt}pt; font-weight: 600; line-height: ${TYPE.lineHeight}; }
.content-body > * { margin: 0; }
.content-body :is(h1, h2, h3, h4, h5, h6) { font-size: inherit; font-weight: 600; line-height: inherit; }
.content-body > * + * { margin-top: ${G.paragraphGapMm}mm; }
.content p:empty::after { content: "\\200b"; }
.content-body > p:last-child:is(:empty, :has(> br:only-child)) { display: none; }
.content strong, .content b { font-weight: 600; }
.content a { color: #1155cc; text-decoration: underline; }
.content ol, .content ul { list-style: none; padding: 0; }
.content li { position: relative; padding-left: ${G.listIndentMm}mm; }
${[1, 2, 3, 4, 5, 6, 7, 8].map((level) => `.content li[data-level="${level}"] { padding-left: ${G.listIndentMm * (level + 1)}mm; }`).join("\n")}
.content li::before { content: attr(data-marker); position: absolute; left: 0; width: ${G.listIndentMm - G.listMarkerGapMm}mm; text-align: right; }
${[1, 2, 3, 4, 5, 6, 7, 8].map((level) => `.content li[data-level="${level}"]::before { width: ${G.listIndentMm * (level + 1) - G.listMarkerGapMm}mm; }`).join("\n")}
.content blockquote { padding-left: ${G.quotePaddingMm}mm; border-left: ${G.quoteRulePt}pt solid #a3a3a3; }
.content img { display: block; max-width: 100%; max-height: var(--image-height); width: auto; height: auto; object-fit: contain; margin: ${G.paragraphGapMm}mm 0; }
.content p > img:first-child { margin-top: 0; }
.content p > img:last-child { margin-bottom: 0; }
.strip { position: absolute; left: calc(${G.pageWidthMm - options.cutMargin}mm + 4mm); width: ${Math.max(0, options.cutMargin - 8)}mm; bottom: ${pad.bottom}mm; font: 6.5pt/${TYPE.sansNaturalHeight} "${SANS_FACE}", sans-serif; color: ${MUTED}; }
.strip div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.slip.overflow .content { box-shadow: inset 0 -12px 10px -8px rgb(176 71 46 / 45%); }
@media print { .pages { padding: 0; } .page { height: ${G.pageHeightMm - 0.5}mm; margin: 0; box-shadow: none; } .slip.overflow .content { box-shadow: none; } }
`;
  return openPrintDocument(
    `${title} — questions`,
    `${toolbar(`${slips.length} slips on ${pages.length} A4 page${pages.length === 1 ? "" : "s"}. Print at 100% scale with no margins.`)}<main class="pages">${pages.join("")}</main>`,
    styles,
    FIT_SCRIPT
  );
}

function answerHtml(question: Item) {
  const groups = solutionGroups(question);
  const labelled = question.requireAllSolutionGroups && groups.length > 1;
  const parts = groups.map((group, index) => {
    const values = group.length
      ? group
          .map((solution) =>
            solution.type === "expression"
              ? renderMath(`$$${expressionToLatex(String(solution.value))}$$`)
              : escapeHtml(String(solution.value))
          )
          .join(' <span class="or">or</span> ')
      : '<span class="none">—</span>';
    return `<div class="part">${labelled ? `<div class="label small">${partName(index)}</div>` : ""}<div class="values">${values}</div></div>`;
  });
  if (labelled && question.solutionOrderMatters)
    parts.push('<div class="label small order">Parts must be in order</div>');
  return parts.join("");
}

function notesHtml(question: Item) {
  const parts: string[] = [];
  if (!question.skippable) parts.push('<div class="label small warn">Not skippable</div>');
  const comment = markerNotes(question);
  if (comment) parts.push(`<div class="comment">${escapeHtml(comment).replace(/\n/g, "<br>")}</div>`);
  return parts.join("");
}

export function previewAnswerSet(set: QuestionSetValue) {
  const size = set.pdfOptions.answerTextSize;
  const title = set.name.trim() || "Untitled set";
  const count = set.questions.length;
  const rows = set.questions
    .map(
      (question, index) =>
        `<tr><td class="number">${index + 1}</td><td class="answer">${answerHtml(question)}</td><td class="notes">${notesHtml(question)}</td></tr>`
    )
    .join("");
  const styles = `
@page { size: A4 portrait; margin: 18mm; }
.sheet { width: ${G.pageWidthMm}mm; min-height: ${G.pageHeightMm}mm; margin: 18px auto 40px; padding: 18mm; background: #fff; box-shadow: 0 1px 3px rgb(0 0 0 / 18%); font-size: ${size}pt; line-height: ${TYPE.lineHeight}; }
.kicker { font-size: 8pt; margin-bottom: 4pt; }
h1 { margin: 0 0 3pt; font-size: 20pt; font-weight: 600; line-height: 1.1; }
.count { margin-bottom: 16pt; font: 9pt/1.3 "${SANS_FACE}", sans-serif; color: #666; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
th { padding: 0 8pt 4pt; text-align: left; font-size: 7pt; border-bottom: 0.8pt solid #2a2a2a; }
th.label { color: #555; }
td { padding: 6pt 8pt; vertical-align: top; border-bottom: 0.4pt solid #d4d4d4; }
tr:last-child td { border-bottom: 0.8pt solid #2a2a2a; }
th:first-child, td:first-child { padding-left: 0; padding-right: 6pt; width: ${Math.max(20, size * 2.2) + 6}pt; }
th:last-child, td:last-child { padding-right: 0; width: 32%; }
tr { break-inside: avoid; page-break-inside: avoid; }
.number { font-family: "${SANS_FACE}", sans-serif; font-weight: 600; }
.label.small { font-size: ${Math.max(5.5, size * 0.68)}pt; line-height: 1.5; }
.part + .part { margin-top: ${size * 0.45}pt; }
.values { overflow-wrap: anywhere; }
.or { font-style: italic; color: #7a7a7a; }
.none { color: ${MUTED}; }
.order { margin-top: 4pt; color: #6b5a1f; }
.warn { color: ${WARN}; }
.comment { font-size: 0.92em; color: #3a3a3a; }
@media print { .sheet { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; } }
`;
  return openPrintDocument(
    `${title} — answer key`,
    `${toolbar("Answer key. The header repeats on every printed page.")}<main class="sheet"><div class="label kicker">Answer key</div><h1>${escapeHtml(title)}</h1><div class="count">${count} question${count === 1 ? "" : "s"}</div>` +
      `<table><thead><tr><th class="label">No.</th><th class="label">Answer</th><th class="label">Marking notes</th></tr></thead><tbody>${rows}</tbody></table></main>`,
    styles
  );
}
