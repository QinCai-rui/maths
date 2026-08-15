import type { z } from "zod";
import type { Question, QuestionSet } from "./schemas";
import { parseStoredMath, renderMath } from "./content";
import { expressionToLatex } from "./expression";

type Set = z.infer<typeof QuestionSet>;
type Item = z.infer<typeof Question>;
type PdfNode = Record<string, unknown>;

const PT_PER_MM = 72 / 25.4;
const PAGE_WIDTH = 210 * PT_PER_MM;
let mathDocument: Promise<{
  convert(tex: string, options: { display: boolean }): unknown;
  outerHTML(node: unknown): string;
}> | null = null;

async function loadPdfMake() {
  const [{ default: pdfMake }, { default: fonts }] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts")
  ]);
  pdfMake.addVirtualFileSystem(fonts);
  return pdfMake;
}

async function texToSvg(tex: string) {
  mathDocument ??= (async () => {
    const [{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }, { AllPackages }] =
      await Promise.all([
        import("mathjax-full/js/mathjax.js"),
        import("mathjax-full/js/input/tex.js"),
        import("mathjax-full/js/output/svg.js"),
        import("mathjax-full/js/adaptors/liteAdaptor.js"),
        import("mathjax-full/js/handlers/html.js"),
        import("mathjax-full/js/input/tex/AllPackages.js")
      ]);
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const document = mathjax.document("", {
      InputJax: new TeX({ packages: AllPackages }),
      OutputJax: new SVG({ fontCache: "none" })
    });
    return {
      convert: (value: string, options: { display: boolean }) => document.convert(value, options),
      outerHTML: (node: unknown) => adaptor.outerHTML(node as never)
    };
  })();
  const document = await mathDocument;
  const wrapper = document.outerHTML(document.convert(tex, { display: false }));
  const start = wrapper.indexOf("<svg");
  const end = wrapper.lastIndexOf("</svg>");
  if (start < 0 || end < 0) throw new Error(`Could not render equation: ${tex}`);
  return wrapper.slice(start, end + 6);
}

function escapeFilename(name: string, suffix: string) {
  const base =
    name
      .trim()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "") || "mathex-set";
  return `${base}-${suffix}.pdf`;
}

async function pdfImage(source: string) {
  if (/^data:image\/(png|jpe?g);/i.test(source)) return source;
  const image = new Image();
  image.src = source;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not convert an image for the PDF");
  context.drawImage(image, 0, 0);
  return canvas.toDataURL("image/png");
}

type InlineToken =
  | { type: "text"; value: string; style: Record<string, unknown> }
  | { type: "math"; value: string; style: Record<string, unknown> };

function inlineTokens(node: Node, inheritedStyle: Record<string, unknown> = {}): InlineToken[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.textContent || "";
    if (!value) return [];
    const tokens: InlineToken[] = [];
    let offset = 0;
    for (const match of value.matchAll(/\$\$([\s\S]+?)\$\$/g)) {
      const index = match.index || 0;
      if (index > offset) tokens.push({ type: "text", value: value.slice(offset, index), style: inheritedStyle });
      tokens.push({ type: "math", value: match[1], style: inheritedStyle });
      offset = index + match[0].length;
    }
    if (offset < value.length) tokens.push({ type: "text", value: value.slice(offset), style: inheritedStyle });
    return tokens;
  }
  if (!(node instanceof HTMLElement) || node instanceof HTMLImageElement) return [];
  if (node.matches("br")) return [{ type: "text", value: "\n", style: inheritedStyle }];

  const style = { ...inheritedStyle };
  if (node.matches("strong, b")) style.bold = true;
  if (node.matches("em, i")) style.italics = true;
  if (node.matches("u")) style.decoration = "underline";
  if (node.matches("s, strike")) style.decoration = "lineThrough";
  if (node instanceof HTMLAnchorElement) {
    style.link = node.href;
    style.color = "#1155cc";
    style.decoration = "underline";
  }
  return [...node.childNodes].flatMap((child) => inlineTokens(child, style));
}

async function inlineContent(tokens: InlineToken[], mathHeight: number, contentWidth: number): Promise<PdfNode[]> {
  if (!tokens.some((token) => token.type === "math")) {
    const text = tokens.map((token) => ({ text: token.value, ...token.style }));
    return [{ text: text.length ? text : " ", margin: [0, 0, 0, 3] }];
  }

  const columns: PdfNode[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type === "text") {
      const previous = tokens[index - 1];
      const next = tokens[index + 1];
      let value = token.value;
      if (previous?.type === "math") value = value.replace(/^\s+/, "");
      if (next?.type === "math") value = value.replace(/\s+$/, "");
      if (value) columns.push({ text: value, width: "auto", ...token.style });
      continue;
    }
    const previous = tokens[index - 1];
    const next = tokens[index + 1];
    const math = parseStoredMath(token.value);
    columns.push({
      svg: await texToSvg(math.latex),
      fit: [Math.min(160, contentWidth), mathHeight * 1.15 * math.scale],
      width: "auto",
      _mathexScale: math.scale,
      margin: [
        previous?.type === "text" && /\s$/.test(previous.value) ? mathHeight * 0.3 : 0,
        0,
        next?.type === "text" && /^\s/.test(next.value) ? mathHeight * 0.3 : 0,
        0
      ]
    });
  }
  return [{ columns, columnGap: 0, margin: [0, 0, 0, 3] }];
}

async function paragraphNodes(
  element: HTMLElement,
  imageHeight: number,
  mathHeight: number,
  contentWidth: number
): Promise<PdfNode[]> {
  const pieces: PdfNode[] = [];
  let textBuffer: InlineToken[] = [];
  const flushText = async () => {
    if (textBuffer.length) pieces.push(...(await inlineContent(textBuffer, mathHeight, contentWidth)));
    textBuffer = [];
  };
  for (const child of element.childNodes) {
    if (child instanceof HTMLImageElement) {
      await flushText();
      pieces.push({
        image: await pdfImage(child.src),
        fit: [contentWidth, imageHeight * PT_PER_MM],
        alignment: "left",
        margin: [0, 4, 0, 5]
      });
    } else {
      textBuffer.push(...inlineTokens(child));
    }
  }
  await flushText();
  if (!pieces.length) pieces.push({ text: " ", margin: [0, 0, 0, 3] });
  return pieces;
}

async function htmlToPdf(
  html: string,
  imageHeight: number,
  mathHeight: number,
  contentWidth: number
): Promise<PdfNode[]> {
  const source = new DOMParser().parseFromString(html || "", "text/html");
  const output: PdfNode[] = [];
  for (const node of source.body.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent?.trim()) output.push(...(await inlineContent(inlineTokens(node), mathHeight, contentWidth)));
      continue;
    }
    if (!(node instanceof HTMLElement)) continue;
    if (node instanceof HTMLImageElement) {
      output.push({
        image: await pdfImage(node.src),
        fit: [contentWidth, imageHeight * PT_PER_MM],
        alignment: "left",
        margin: [0, 4, 0, 5]
      });
      continue;
    }
    if (node.matches("ol, ul")) {
      const items = await Promise.all(
        [...node.children].map(async (item) => ({
          stack: await paragraphNodes(item as HTMLElement, imageHeight, mathHeight, contentWidth)
        }))
      );
      output.push({ [node.tagName === "OL" ? "ol" : "ul"]: items, margin: [8, 0, 0, 3] });
      continue;
    }
    if (node.matches("blockquote")) {
      output.push({
        table: {
          widths: [2, "*"],
          body: [
            [
              { text: "", fillColor: "#777777" },
              { stack: await paragraphNodes(node, imageHeight, mathHeight, contentWidth), margin: [5, 0, 0, 0] }
            ]
          ]
        },
        layout: "noBorders",
        margin: [0, 1, 0, 3]
      });
      continue;
    }
    output.push(...(await paragraphNodes(node, imageHeight, mathHeight, contentWidth)));
  }

  return output;
}

function estimateHeight(nodes: PdfNode[], fontSize: number, contentWidth: number) {
  let height = 0;
  for (const node of nodes) {
    const nodeFontSize = Number(node.fontSize || fontSize);
    const margin = (node.margin as number[] | undefined) || [0, 0, 0, 0];
    let nodeHeight: number;
    if ("image" in node) nodeHeight = (node.fit as number[])?.[1] || 50;
    else if ("svg" in node) {
      const scale = Number(node._mathexScale);
      nodeHeight = Number.isFinite(scale) ? fontSize * 1.15 * scale : (node.fit as number[])?.[1] || 42;
    } else if (Array.isArray(node.columns)) {
      nodeHeight = Math.max(
        ...(node.columns as PdfNode[]).map((column) => estimateHeight([column], nodeFontSize, contentWidth))
      );
    } else if (Array.isArray(node.stack)) {
      nodeHeight = estimateHeight(node.stack as PdfNode[], nodeFontSize, contentWidth);
    } else if (Array.isArray(node.ol)) {
      nodeHeight = estimateHeight(node.ol as PdfNode[], nodeFontSize, contentWidth - 25) + nodeFontSize * 0.3;
    } else if (Array.isArray(node.ul)) {
      nodeHeight = estimateHeight(node.ul as PdfNode[], nodeFontSize, contentWidth - 25) + nodeFontSize * 0.3;
    } else if ("table" in node) {
      const rows = (node.table as { body?: PdfNode[][] }).body || [];
      nodeHeight = rows.reduce(
        (total, row) =>
          total +
          Math.max(...row.map((cell) => estimateHeight([cell], nodeFontSize, contentWidth - 7)), nodeFontSize * 1.25),
        0
      );
    } else {
      const text = Array.isArray(node.text)
        ? (node.text as Array<Record<string, unknown>>).map((part) => String(part.text || "")).join("")
        : String(node.text || "");
      const charactersPerLine = Math.max(1, Math.floor(contentWidth / (nodeFontSize * 0.6)));
      nodeHeight = Math.max(nodeFontSize * 1.25, Math.ceil(text.length / charactersPerLine) * nodeFontSize * 1.25);
    }
    height += nodeHeight + margin[1] + margin[3];
  }
  return height;
}

function resizeImages(nodes: PdfNode[], height: number) {
  for (const node of nodes) {
    if ("image" in node) node.fit = [(node.fit as number[])?.[0] || 440, height * PT_PER_MM];
    for (const property of ["stack", "ol", "ul"] as const) {
      if (Array.isArray(node[property])) resizeImages(node[property] as PdfNode[], height);
    }
    if ("table" in node) {
      const rows = (node.table as { body?: PdfNode[][] }).body || [];
      for (const row of rows) for (const cell of row) resizeImages([cell], height);
    }
  }
}

function resizeMath(nodes: PdfNode[], fontSize: number) {
  for (const node of nodes) {
    const scale = Number(node._mathexScale);
    if ("svg" in node && Number.isFinite(scale))
      node.fit = [(node.fit as number[])?.[0] || 160, fontSize * 1.15 * scale];
    for (const property of ["stack", "ol", "ul", "columns"] as const) {
      if (Array.isArray(node[property])) resizeMath(node[property] as PdfNode[], fontSize);
    }
    if ("table" in node) {
      const rows = (node.table as { body?: PdfNode[][] }).body || [];
      for (const row of rows) for (const cell of row) resizeMath([cell], fontSize);
    }
  }
}

async function fittedSlip(
  html: string,
  label: string,
  configuredSize: number,
  imageHeight: number,
  availableHeight: number,
  slipHeight: number,
  contentWidth: number,
  prefix: PdfNode[] = []
) {
  let currentImageHeight = imageHeight;
  const nodes = [...prefix, ...(await htmlToPdf(html, currentImageHeight, configuredSize, contentWidth))];
  let size = configuredSize;
  while (estimateHeight(nodes, size, contentWidth) > availableHeight && size > 6) size -= 0.5;
  while (estimateHeight(nodes, size, contentWidth) > availableHeight && currentImageHeight > 5) {
    currentImageHeight--;
    resizeImages(nodes, currentImageHeight);
  }
  if (estimateHeight(nodes, size, contentWidth) > availableHeight) {
    throw new Error(`${label} does not fit the ${slipHeight} mm slip. Reduce its content or configured sizes.`);
  }
  resizeMath(nodes, size);
  return { nodes, size };
}

export async function downloadQuestionSet(set: Set) {
  const pdfMake = await loadPdfMake();
  const slipHeight = set.pdfOptions.slipHeight * PT_PER_MM;
  const cutMargin = set.pdfOptions.cutMargin * PT_PER_MM;
  if (set.pdfOptions.slipHeight > 297) throw new Error("Slip height cannot exceed an A4 page.");
  const slipCellWidth = PAGE_WIDTH - cutMargin - 28;
  const contentWidth = slipCellWidth - 32;
  if (contentWidth <= 0) throw new Error("Cut margin leaves no room for question content.");
  const slipsPerPage = Math.max(1, Math.floor(297 / set.pdfOptions.slipHeight));
  const slips: Array<{ stack: PdfNode[]; size: number }> = [];
  const cover = await fittedSlip(
    set.instructions,
    "The cover",
    set.pdfOptions.questionTextSize,
    set.pdfOptions.imageHeight,
    slipHeight - 30,
    set.pdfOptions.slipHeight,
    contentWidth,
    [{ text: set.name || "Untitled set", bold: true, fontSize: 18, margin: [0, 0, 0, 5] }]
  );
  slips.push({ stack: cover.nodes, size: cover.size });
  for (let index = 0; index < set.questions.length; index++) {
    const fitted = await fittedSlip(
      set.questions[index].contents,
      `Question ${index + 1}`,
      set.pdfOptions.questionTextSize,
      set.pdfOptions.imageHeight,
      slipHeight - 20,
      set.pdfOptions.slipHeight,
      contentWidth,
      [{ text: `Question ${index + 1}`, bold: true, fontSize: 8, characterSpacing: 0.5, margin: [0, 0, 0, 2] }]
    );
    slips.push({ stack: fitted.nodes, size: fitted.size });
  }

  const guides: PdfNode[] = [];
  const cutX = PAGE_WIDTH - cutMargin;
  for (let row = 0; row < slipsPerPage; row++) {
    const top = row * slipHeight;
    const bottom = top + slipHeight;
    guides.push(
      { type: "line", x1: 28, y1: top, x2: 28, y2: bottom, lineWidth: 0.5, lineColor: "#aaaaaa" },
      {
        type: "line",
        x1: 0,
        y1: bottom,
        x2: PAGE_WIDTH,
        y2: bottom,
        lineWidth: 0.5,
        lineColor: "#777777",
        dash: { length: 3, space: 3 }
      }
    );
    if (cutMargin > 0) {
      guides.push({
        type: "line",
        x1: cutX,
        y1: top,
        x2: cutX,
        y2: bottom,
        lineWidth: 0.5,
        lineColor: "#777777",
        dash: { length: 3, space: 3 }
      });
    }
  }

  const content: PdfNode[] = [];
  for (let pageStart = 0; pageStart < slips.length; pageStart += slipsPerPage) {
    const pageSlips = slips.slice(pageStart, pageStart + slipsPerPage);
    content.push({ text: "", fontSize: 0.1, pageBreak: pageStart > 0 ? "before" : undefined });
    for (let row = 0; row < pageSlips.length; row++) {
      const slip = pageSlips[row];
      content.push({
        absolutePosition: { x: 28, y: row * slipHeight },
        table: {
          widths: [slipCellWidth],
          heights: [slipHeight],
          dontBreakRows: true,
          body: [
            [
              {
                stack: slip.stack,
                fontSize: slip.size,
                lineHeight: 1.1,
                margin: [18, 5, 14, 4]
              }
            ]
          ]
        },
        layout: {
          hLineWidth: () => 0,
          vLineWidth: () => 0,
          paddingLeft: () => 0,
          paddingRight: () => 0,
          paddingTop: () => 0,
          paddingBottom: () => 0
        }
      });
    }
  }

  await pdfMake
    .createPdf({
      pageSize: "A4",
      pageMargins: [0, 0, 0, 0],
      background: () => ({ canvas: guides }),
      defaultStyle: { font: "Roboto", color: "#111111" },
      content
    })
    .download(escapeFilename(set.name, "questions"));
}

async function answerCell(question: Item, fontSize: number) {
  const stack: PdfNode[] = [];
  const groups = solutionGroups(question);
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex];
    const groupStack: PdfNode[] = [];
    if (question.requireAllSolutionGroups) {
      groupStack.push({
        text: `Required answer ${groupIndex + 1}`,
        bold: true,
        fontSize: fontSize * 0.85,
        margin: [0, 0, 0, 2]
      });
    }
    for (let index = 0; index < group.length; index++) {
      const solution = group[index];
      const isAlternative = index < group.length - 1;
      if (solution.type === "expression") {
        groupStack.push({
          columns: [
            { svg: await texToSvg(expressionToLatex(String(solution.value))), fit: [120, fontSize * 1.15] },
            ...(isAlternative ? [{ text: "OR", italics: true, width: "auto" }] : [])
          ],
          columnGap: 4
        });
      } else {
        groupStack.push({ text: `${String(solution.value)}${isAlternative ? " OR" : ""}` });
      }
    }
    stack.push({ stack: groupStack, margin: [0, 0, 0, groupIndex < groups.length - 1 ? fontSize : 0] });
  }
  if (question.requireAllSolutionGroups && question.solutionOrderMatters) {
    stack.push({
      text: "Answer groups must be in order.",
      italics: true,
      fontSize: fontSize * 0.8,
      margin: [0, 4, 0, 0]
    });
  }
  return stack;
}

function solutionGroups(question: Item) {
  if (!question.requireAllSolutionGroups) return [question.solutions];
  const groups = new Map<number, Item["solutions"]>();
  for (const solution of question.solutions) {
    const group = solution.group ?? 0;
    groups.set(group, [...(groups.get(group) || []), solution]);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([, solutions]) => solutions);
}

function markerCommentText(question: Item): string {
  const parts: string[] = [];
  if (!question.skippable) parts.push("Not skippable");
  if (question.answerComment) parts.push(question.answerComment);
  return parts.join("\n");
}

function markerCommentHtml(question: Item): string {
  const parts: string[] = [];
  if (!question.skippable) parts.push("<strong>Not skippable</strong>");
  if (question.answerComment) {
    parts.push(
      question.answerComment.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")
    );
  }
  return parts.join("<br>");
}

function previewAnswerLogic(question: Item) {
  const groups = solutionGroups(question);
  const html = groups
    .map((group) => {
      const alternatives = group
        .map((solution, index) => {
          const value =
            solution.type === "expression"
              ? renderMath(`$$${expressionToLatex(String(solution.value))}$$`)
              : String(solution.value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          return `<div class="answer-line">${value}${index < group.length - 1 ? ' <em class="answer-or">OR</em>' : ""}</div>`;
        })
        .join("");
      const contents = alternatives;
      return question.requireAllSolutionGroups
        ? `<div class="answer-group"><strong>Required answer ${groups.indexOf(group) + 1}</strong><div>${contents}</div></div>`
        : contents;
    })
    .join("");
  return question.requireAllSolutionGroups && question.solutionOrderMatters
    ? `${html}<br><small><em>Answer groups must be in order.</em></small>`
    : html;
}

export async function downloadAnswerSet(set: Set) {
  const pdfMake = await loadPdfMake();
  const rows: PdfNode[][] = [
    [
      { text: "Question", bold: true, fillColor: "#eeeeee" },
      { text: "Answer", bold: true, fillColor: "#eeeeee" },
      { text: "Marker comments", bold: true, fillColor: "#eeeeee" }
    ]
  ];
  for (let index = 0; index < set.questions.length; index++) {
    rows.push([
      { text: String(index + 1) },
      { stack: await answerCell(set.questions[index], set.pdfOptions.answerTextSize) },
      { text: markerCommentText(set.questions[index]) }
    ]);
  }
  await pdfMake
    .createPdf({
      pageSize: "A4",
      pageMargins: [42, 42, 42, 42],
      defaultStyle: { font: "Roboto", fontSize: set.pdfOptions.answerTextSize, color: "#111111" },
      content: [
        { text: set.name || "Untitled set", bold: true, fontSize: 20, margin: [0, 0, 0, 3] },
        { text: "Answer key", fontSize: 12, margin: [0, 0, 0, 14] },
        { table: { headerRows: 1, widths: [55, 145, "*"], dontBreakRows: true, body: rows } }
      ]
    })
    .download(escapeFilename(set.name, "answers"));
}

function openPrintDocument(title: string, body: string, styles: string, fitSlips = false) {
  const popup = window.open("", "_blank");
  if (!popup) return false;
  popup.opener = null;
  popup.document
    .write(`<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/[<>&]/g, "")}</title><style>${styles}</style></head><body>${body}<script>
    const fit = ${fitSlips};
    addEventListener('load', async () => {
      await document.fonts?.ready;
      await Promise.all([...document.images].map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      })));
      if (fit) for (const slip of document.querySelectorAll('.slip')) {
        const content = slip.querySelector('.slip-content');
        let size = Number(slip.dataset.size), image = Number(slip.dataset.imageHeight);
        while (content.scrollHeight > content.clientHeight && size > 6) { size -= .5; content.style.fontSize = size + 'pt'; }
        while (content.scrollHeight > content.clientHeight && image > 5) { image--; for (const img of content.querySelectorAll('img')) img.style.maxHeight = image + 'mm'; }
      }
    });
  <\/script></body></html>`);
  popup.document.close();
  return true;
}

export function previewQuestionSet(set: Set) {
  const options = set.pdfOptions;
  const slips = [
    `<section class="slip cover" data-size="${options.questionTextSize}" data-image-height="${options.imageHeight}"><div class="slip-content" style="font-size:${options.questionTextSize}pt"><h1>${set.name.replace(/[<>&]/g, "") || "Untitled set"}</h1>${renderMath(set.instructions || "<p>No instructions provided.</p>")}</div></section>`,
    ...set.questions.map(
      (question, index) =>
        `<section class="slip" data-size="${options.questionTextSize}" data-image-height="${options.imageHeight}"><div class="number">Question ${index + 1}</div><div class="slip-content" style="font-size:${options.questionTextSize}pt">${renderMath(question.contents)}</div></section>`
    )
  ].join("");
  return openPrintDocument(
    `${set.name || "Mathex set"} questions`,
    `<main>${slips}</main>`,
    `@page { size: A4 portrait; margin: 0; } * { box-sizing: border-box; } body { margin: 0; color: #111; background: #fff; font-family: Arial, sans-serif; } .slip { display: flex; flex-direction: column; width: 210mm; height: ${options.slipHeight}mm; padding: 1.76mm ${options.cutMargin + 4.94}mm 1.41mm 16.35mm; border-bottom: 0.5pt dashed #777; position: relative; overflow: hidden; break-inside: avoid; } .slip::before { content: ""; position: absolute; inset: 0 auto 0 10mm; border-left: 0.5pt solid #aaa; } .slip::after { content: ""; position: absolute; top: 0; bottom: 0; right: ${options.cutMargin}mm; border-left: 0.5pt dashed #777; } .slip-content { flex: 1; min-height: 0; overflow: hidden; line-height: 1.1; overflow-wrap: anywhere; word-break: break-word; white-space: normal; } .slip-content p, .slip-content li { overflow-wrap: anywhere; word-break: break-word; } .slip-content math { font-size: 1em !important; vertical-align: middle; } .slip-content img { position: static !important; float: none !important; clear: both; max-width: 100%; max-height: ${options.imageHeight}mm; object-fit: contain; display: block; margin: 1.41mm 0 1.76mm; } .number { flex: none; font-size: 8pt; font-weight: bold; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 0.71mm; } .cover h1 { margin: 0 0 1.76mm; font-size: 18pt; } p { margin: 0 0 1.41mm; } blockquote { margin: 1.41mm 0; padding-left: 2.12mm; border-left: 2pt solid #777; }`,
    true
  );
}

export function previewAnswerSet(set: Set) {
  const rows = set.questions
    .map((question, index) => {
      const answers = previewAnswerLogic(question);
      return `<tr><td>${index + 1}</td><td>${answers}</td><td>${markerCommentHtml(question)}</td></tr>`;
    })
    .join("");
  return openPrintDocument(
    `${set.name || "Mathex set"} answers`,
    `<main class="answer-preview"><h1>${set.name.replace(/[<>&]/g, "") || "Untitled set"}</h1><h2>Answer key</h2><table><thead><tr><th>Question</th><th>Answer</th><th>Marker comments</th></tr></thead><tbody>${rows}</tbody></table></main>`,
    `@page { size: A4 portrait; margin: 14.82mm; } * { box-sizing: border-box; } body { color: #111; background: #fff; font-family: Arial, sans-serif; font-size: ${set.pdfOptions.answerTextSize}pt; } math { font-size: 1em !important; vertical-align: middle; } .answer-preview { width: 100%; } h1 { margin: 0 0 1.06mm; font-size: 20pt; } h2 { margin: 0 0 4.94mm; font-size: 12pt; font-weight: normal; } table { width: 100%; border-collapse: collapse; } thead { display: table-header-group; } tbody { display: table-row-group; } th, td { border: 1px solid #333; padding: 3mm; text-align: left; vertical-align: top; } th { background: #eee; } th:first-child, td:first-child { width: 10.75%; } th:nth-child(2), td:nth-child(2) { width: 28.36%; } .answer-group { margin-bottom: 1em; } .answer-group strong { display: block; margin-bottom: 1mm; font-size: .85em; } .answer-line { overflow-wrap: anywhere; word-break: break-word; } .answer-or { margin-left: .35em; } tr { break-inside: avoid; page-break-inside: avoid; } @media print { .answer-preview { width: auto; } }`
  );
}
