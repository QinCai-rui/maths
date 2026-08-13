import { renderMath } from "./content";
import type { z } from "zod";
import type { Question, QuestionSet } from "./schemas";

type Set = z.infer<typeof QuestionSet>;
type Item = z.infer<typeof Question>;
type Pdf = InstanceType<(typeof import("jspdf"))["jsPDF"]>;
type CanvasRenderer = (typeof import("html2canvas"))["default"];

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

function createFrame(styles: string) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;";
  document.body.append(frame);
  const doc = frame.contentDocument;
  if (!doc) throw new Error("Could not create the isolated PDF renderer");
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>${styles}</style></head><body></body></html>`);
  doc.close();
  return { frame, doc };
}

async function waitForAssets(root: HTMLElement) {
  await Promise.all(
    [...root.querySelectorAll("img")].map((image) => {
      if (image.complete) return Promise.resolve();
      return new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      });
    })
  );
  await root.ownerDocument.fonts?.ready;
}

async function addPage(pdf: Pdf, root: HTMLElement, pageNumber: number, html2canvas: CanvasRenderer) {
  await waitForAssets(root);
  const canvas = await html2canvas(root, {
    backgroundColor: "#ffffff",
    scale: 2,
    useCORS: true,
    windowWidth: root.scrollWidth,
    windowHeight: root.scrollHeight
  });
  if (pageNumber) pdf.addPage();
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, 210, 297);
}

const baseStyles = `
  html, body { margin: 0; width: 210mm; min-height: 297mm; background: #fff; color: #111; font-family: Arial, sans-serif; }
  * { box-sizing: border-box; }
  .page { width: 210mm; height: 297mm; overflow: hidden; background: #fff; }
  p { margin: 0 0 2mm; }
  blockquote { margin: 2mm 0; padding-left: 3mm; border-left: 2px solid #777; }
`;

function fitSlips(page: HTMLElement) {
  for (const slip of page.querySelectorAll<HTMLElement>(".slip")) {
    const content = slip.querySelector<HTMLElement>(".slip-content");
    if (!content) continue;
    let size = Number(slip.dataset.size);
    let imageHeight = Number(slip.dataset.imageHeight);
    while (content.scrollHeight > content.clientHeight && size > 6) {
      size = Math.max(6, size - 0.5);
      content.style.fontSize = `${size}pt`;
    }
    while (content.scrollHeight > content.clientHeight && imageHeight > 5) {
      imageHeight = Math.max(5, imageHeight - 1);
      for (const image of content.querySelectorAll<HTMLElement>("img")) image.style.maxHeight = `${imageHeight}mm`;
    }
    if (content.scrollHeight > content.clientHeight) {
      throw new Error(`${slip.dataset.label} does not fit a 5 cm slip. Reduce its image or text size.`);
    }
  }
}

export async function downloadQuestionSet(set: Set) {
  const { html2canvas, jsPDF } = await loadRenderers();
  const options = set.pdfOptions;
  const styles = `${baseStyles}
    .slip { height: 50mm; padding: 5mm 8mm 4mm 18mm; border-bottom: 1px dashed #777; position: relative; overflow: hidden; }
    .slip::before { content: ""; position: absolute; inset: 0 auto 0 10mm; border-left: 1px solid #aaa; }
    .slip-content { height: 33mm; overflow: hidden; line-height: 1.2; }
    .slip-content img { max-width: 100%; max-height: ${options.imageHeight}mm; object-fit: contain; display: block; }
    .number { font-size: 8pt; font-weight: bold; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 2mm; }
    .cover h1 { margin: 0 0 2mm; font-size: 18pt; }
    .cover .slip-content { height: 40mm; }
  `;
  const { frame, doc } = createFrame(styles);
  try {
    const slips = [
      `<section class="slip cover" data-label="The cover" data-size="${options.questionTextSize}" data-image-height="${options.imageHeight}"><div class="slip-content" style="font-size:${options.questionTextSize}pt"><h1>${escapeHtml(set.name || "Untitled set")}</h1>${renderMath(set.instructions || "<p>No instructions provided.</p>")}</div></section>`,
      ...set.questions.map(
        (question, index) =>
          `<section class="slip" data-label="Question ${index + 1}" data-size="${options.questionTextSize}" data-image-height="${options.imageHeight}"><div class="number">Question ${index + 1}</div><div class="slip-content" style="font-size:${options.questionTextSize}pt">${renderMath(question.contents)}</div></section>`
      )
    ];
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    for (let start = 0, pageNumber = 0; start < slips.length; start += 5, pageNumber++) {
      doc.body.innerHTML = `<main class="page">${slips.slice(start, start + 5).join("")}</main>`;
      const page = doc.querySelector<HTMLElement>(".page");
      if (!page) throw new Error("Could not lay out the question PDF");
      await waitForAssets(page);
      fitSlips(page);
      await addPage(pdf, page, pageNumber, html2canvas);
    }
    pdf.save(filename(set.name, "questions"));
  } finally {
    frame.remove();
  }
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
  const styles = `${baseStyles}
    .page { padding: 15mm; font-size: ${set.pdfOptions.answerTextSize}pt; }
    h1 { margin: 0; font-size: 20pt; } h2 { margin: 2mm 0 7mm; font-size: 12pt; font-weight: normal; }
    table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #333; padding: 3mm; text-align: left; vertical-align: top; }
    th { background: #eee; } th:first-child, td:first-child { width: 14%; } th:nth-child(2), td:nth-child(2) { width: 30%; }
  `;
  const { frame, doc } = createFrame(styles);
  try {
    const rows = set.questions.map(
      (question, index) =>
        `<tr><td>${index + 1}</td><td>${answer(question)}</td><td>${escapeHtml(question.answerComment).replace(/\n/g, "<br>")}</td></tr>`
    );
    const pages: string[][] = [[]];
    for (const row of rows) {
      pages.at(-1)!.push(row);
      doc.body.innerHTML = answerPage(set.name, pages.at(-1)!.join(""));
      const page = doc.querySelector<HTMLElement>(".page");
      if (!page) throw new Error("Could not lay out the answer PDF");
      if (page.scrollHeight > page.clientHeight && pages.at(-1)!.length > 1) {
        pages.at(-1)!.pop();
        pages.push([row]);
      }
    }
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    for (let pageNumber = 0; pageNumber < pages.length; pageNumber++) {
      doc.body.innerHTML = answerPage(set.name, pages[pageNumber].join(""));
      const page = doc.querySelector<HTMLElement>(".page");
      if (!page) throw new Error("Could not lay out the answer PDF");
      if (page.scrollHeight > page.clientHeight) throw new Error("An answer row is too tall for one page. Reduce the answer text size.");
      await addPage(pdf, page, pageNumber, html2canvas);
    }
    pdf.save(filename(set.name, "answers"));
  } finally {
    frame.remove();
  }
}

function answerPage(name: string, rows: string) {
  return `<main class="page"><h1>${escapeHtml(name || "Untitled set")}</h1><h2>Answer key</h2><table><thead><tr><th>Question</th><th>Answer</th><th>Marker comments</th></tr></thead><tbody>${rows}</tbody></table></main>`;
}
