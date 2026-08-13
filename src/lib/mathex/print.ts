import { renderMath } from "./content";
import type { z } from "zod";
import type { Question, QuestionSet } from "./schemas";

type Set = z.infer<typeof QuestionSet>;
type Item = z.infer<typeof Question>;

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function printDocument(title: string, body: string, styles: string) {
  const popup = window.open("", "_blank");
  if (!popup) return false;
  popup.opener = null;
  popup.onload = () => popup.print();
  popup.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${styles}</style></head><body>${body}</body></html>`
  );
  popup.document.close();
  return true;
}

export function printQuestionSet(set: Set) {
  const slips = [
    `<section class="slip cover"><h1>${escapeHtml(set.name || "Untitled set")}</h1><div class="instructions">${renderMath(set.instructions || "<p>No instructions provided.</p>")}</div></section>`,
    ...set.questions.map(
      (question, index) =>
        `<section class="slip"><div class="number">Question ${index + 1}</div><div class="content">${renderMath(question.contents)}</div></section>`
    )
  ].join("");
  return printDocument(
    `${set.name || "Mathex set"} questions`,
    `<main>${slips}</main>`,
    `@page { size: A4 portrait; margin: 12mm 12mm 10mm 54mm; } * { box-sizing: border-box; } body { margin: 0; color: #111; font-family: Arial, sans-serif; font-size: 11pt; } .slip { height: 50mm; padding: 6mm 5mm 5mm 10mm; border-bottom: 1px dashed #777; position: relative; break-inside: avoid; overflow: hidden; } .slip::before { content: ""; position: absolute; top: 0; bottom: 0; left: 4mm; border-left: 1px solid #bbb; } .number { font-size: 9pt; font-weight: bold; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 3mm; } .cover h1 { margin: 0 0 3mm; font-size: 20pt; } p { margin: 0 0 2mm; } img { max-width: 100%; max-height: 30mm; display: block; } blockquote { margin: 2mm 0; padding-left: 3mm; border-left: 2px solid #777; }`
  );
}

function answer(question: Item) {
  return question.solutions
    .map((solution) =>
      solution.type === "expression"
        ? renderMath(`$$${escapeHtml(String(solution.value))}$$`)
        : escapeHtml(String(solution.value))
    )
    .join("<br><em>OR</em><br>");
}

export function printAnswerSet(set: Set) {
  const rows = set.questions
    .map(
      (question, index) =>
        `<tr><td>${index + 1}</td><td>${answer(question)}</td><td>${escapeHtml(question.answerComment).replace(/\n/g, "<br>")}</td></tr>`
    )
    .join("");
  return printDocument(
    `${set.name || "Mathex set"} answers`,
    `<h1>${escapeHtml(set.name || "Untitled set")}</h1><h2>Answer key</h2><table><thead><tr><th>Question</th><th>Answer</th><th>Marker comments</th></tr></thead><tbody>${rows}</tbody></table>`,
    `@page { size: A4 portrait; margin: 15mm; } * { box-sizing: border-box; } body { color: #111; font-family: Arial, sans-serif; font-size: 10pt; } h1 { margin: 0; font-size: 20pt; } h2 { margin: 2mm 0 7mm; font-size: 12pt; font-weight: normal; } table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #333; padding: 3mm; text-align: left; vertical-align: top; } th { background: #eee; } th:first-child, td:first-child { width: 14%; } th:nth-child(2), td:nth-child(2) { width: 30%; } tr { break-inside: avoid; }`
  );
}
