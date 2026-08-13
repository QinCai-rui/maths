import { renderMath } from "./content";
import type { z } from "zod";
import type { Question, QuestionSet } from "./schemas";

type Set = z.infer<typeof QuestionSet>;
type Item = z.infer<typeof Question>;
type Pdf = InstanceType<(typeof import("jspdf"))["jsPDF"]>;

async function loadRenderers() {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  return { html2canvas, jsPDF };
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function filename(name: string, suffix: string) {
  const base = name.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "mathex-set";
  return `${base}-${suffix}.pdf`;
}

async function waitForImages(page: HTMLElement) {
  await Promise.all(
    [...page.querySelectorAll("img")].map((image) => {
      if (image.complete) return Promise.resolve();
      return new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      });
    })
  );
}

async function imagePage(
  pdf: Pdf,
  page: HTMLElement,
  addPage: boolean,
  html2canvas: (element: HTMLElement, options: { backgroundColor: string; scale: number; useCORS: boolean }) => Promise<HTMLCanvasElement>
) {
  document.body.append(page);
  try {
    await waitForImages(page);
    const canvas = await html2canvas(page, { backgroundColor: "#ffffff", scale: 2, useCORS: true });
    if (addPage) pdf.addPage();
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, 210, 297);
  } finally {
    page.remove();
  }
}

function pageElement(body: string, extraClass = "") {
  const page = document.createElement("section");
  page.className = `mathex-pdf-page ${extraClass}`;
  page.innerHTML = body;
  return page;
}

const commonCss = `
  position: fixed; left: -9999px; top: 0; width: 210mm; min-height: 297mm; background: white; color: #111;
  font-family: Arial, sans-serif; box-sizing: border-box;
`;

function addStyles(page: HTMLElement, styles: string) {
  const style = document.createElement("style");
  style.textContent = `.mathex-pdf-page { ${commonCss} } .mathex-pdf-page * { box-sizing: border-box; } .mathex-pdf-page p { margin: 0 0 2mm; } .mathex-pdf-page img { max-width: 100%; max-height: 30mm; display: block; } .mathex-pdf-page blockquote { margin: 2mm 0; padding-left: 3mm; border-left: 2px solid #777; } ${styles}`;
  page.prepend(style);
}

export async function downloadQuestionSet(set: Set) {
  const { html2canvas, jsPDF } = await loadRenderers();
  const slips = [
    `<section class="slip cover"><h1>${escapeHtml(set.name || "Untitled set")}</h1><div>${renderMath(set.instructions || "<p>No instructions provided.</p>")}</div></section>`,
    ...set.questions.map(
      (question, index) =>
        `<section class="slip"><div class="number">Question ${index + 1}</div><div>${renderMath(question.contents)}</div></section>`
    )
  ];
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  for (let start = 0; start < slips.length; start += 5) {
    const page = pageElement(slips.slice(start, start + 5).join(""));
    addStyles(
      page,
      `.slip { height: 50mm; padding: 6mm 8mm 5mm 18mm; border-bottom: 1px dashed #777; position: relative; overflow: hidden; font-size: 11pt; } .slip::before { content: ""; position: absolute; top: 0; bottom: 0; left: 10mm; border-left: 1px solid #aaa; } .number { font-size: 9pt; font-weight: bold; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 3mm; } .cover h1 { margin: 0 0 3mm; font-size: 20pt; }`
    );
    await imagePage(pdf, page, start > 0, html2canvas);
  }
  pdf.save(filename(set.name, "questions"));
}

function answer(question: Item) {
  return question.solutions
    .map((solution) =>
      solution.type === "expression" ? renderMath(`$$${escapeHtml(String(solution.value))}$$`) : escapeHtml(String(solution.value))
    )
    .join("<br><em>OR</em><br>");
}

export async function downloadAnswerSet(set: Set) {
  const { html2canvas, jsPDF } = await loadRenderers();
  const rows = set.questions
    .map(
      (question, index) =>
        `<tr><td>${index + 1}</td><td>${answer(question)}</td><td>${escapeHtml(question.answerComment).replace(/\n/g, "<br>")}</td></tr>`
    )
    .join("");
  const page = pageElement(
    `<h1>${escapeHtml(set.name || "Untitled set")}</h1><h2>Answer key</h2><table><thead><tr><th>Question</th><th>Answer</th><th>Marker comments</th></tr></thead><tbody>${rows}</tbody></table>`,
    "answer-key"
  );
  addStyles(
    page,
    `.answer-key { padding: 15mm; font-size: 10pt; } h1 { margin: 0; font-size: 20pt; } h2 { margin: 2mm 0 7mm; font-size: 12pt; font-weight: normal; } table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #333; padding: 3mm; text-align: left; vertical-align: top; } th { background: #eee; } th:first-child, td:first-child { width: 14%; } th:nth-child(2), td:nth-child(2) { width: 30%; }`
  );
  document.body.append(page);
  try {
    await waitForImages(page);
    const canvas = await html2canvas(page, { backgroundColor: "#ffffff", scale: 2, useCORS: true });
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageHeight = Math.floor((canvas.width * 297) / 210);
    for (let y = 0, pageNumber = 0; y < canvas.height; y += pageHeight, pageNumber++) {
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = Math.min(pageHeight, canvas.height - y);
      slice.getContext("2d")?.drawImage(canvas, 0, y, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
      if (pageNumber) pdf.addPage();
      pdf.addImage(slice.toDataURL("image/png"), "PNG", 0, 0, 210, (slice.height * 210) / canvas.width);
    }
    pdf.save(filename(set.name, "answers"));
  } finally {
    page.remove();
  }
}
