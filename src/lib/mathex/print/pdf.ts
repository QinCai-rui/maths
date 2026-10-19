// PDF export. Text is measured with the same fonts that are embedded in the PDF, lines are
// broken here rather than by pdfmake, and each line becomes a row of fixed-width columns
// whose top margins put every word and formula on one shared baseline.

import type { z } from "zod";
import type { Question, QuestionSet } from "../schemas";
import { expressionToLatex } from "../expression";
import { SLIP_GEOMETRY as G } from "./geometry";
import { mathAtoms, parseBlocks, type Block } from "./blocks";
import {
  layoutLines,
  linesHeight,
  TYPE,
  type Atom,
  type Line,
  type MathAtom,
  type MathMetrics,
  type Measure,
  type TextStyle
} from "./layout";

export type QuestionSetValue = z.infer<typeof QuestionSet>;
type Item = z.infer<typeof Question>;
type PdfNode = Record<string, unknown>;

export const PT_PER_MM = 72 / 25.4;
const mm = (value: number) => value * PT_PER_MM;

export const INK = "#141414";
export const ACCENT = G.label.color;
export const MUTED = "#8c8c8c";
export const WARN = "#9a3412";
export const SERIF_FACE = "Mathex Print Serif";
export const SANS_FACE = "Mathex Print Sans";

export const FONT_FILES = [
  { file: "SourceSerif4-Regular.ttf", family: SERIF_FACE, weight: "400", style: "normal" },
  { file: "SourceSerif4-Italic.ttf", family: SERIF_FACE, weight: "400", style: "italic" },
  { file: "SourceSerif4-Semibold.ttf", family: SERIF_FACE, weight: "600", style: "normal" },
  { file: "SourceSerif4-SemiboldItalic.ttf", family: SERIF_FACE, weight: "600", style: "italic" },
  { file: "HankenGrotesk-Regular.ttf", family: SANS_FACE, weight: "400", style: "normal" },
  { file: "HankenGrotesk-Semibold.ttf", family: SANS_FACE, weight: "600", style: "normal" }
] as const;

const PDF_FONTS = {
  Serif: {
    normal: "SourceSerif4-Regular.ttf",
    bold: "SourceSerif4-Semibold.ttf",
    italics: "SourceSerif4-Italic.ttf",
    bolditalics: "SourceSerif4-SemiboldItalic.ttf"
  },
  Sans: {
    normal: "HankenGrotesk-Regular.ttf",
    bold: "HankenGrotesk-Semibold.ttf",
    italics: "HankenGrotesk-Regular.ttf",
    bolditalics: "HankenGrotesk-Semibold.ttf"
  }
};

/** pdfmake lineHeight factors that make a text node exactly `TYPE.lineHeight` ems tall. */
const SERIF_LINE = TYPE.lineHeight / TYPE.serifNaturalHeight;
const LABEL_HEIGHT = G.label.sizePt * TYPE.sansNaturalHeight;

// ---------------------------------------------------------------------------------------------
// Fonts and measuring

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

let fontsPromise: Promise<Record<string, string>> | null = null;

/** Fetches the print fonts once, registers them for canvas measuring, and returns them as base64. */
function loadFonts() {
  fontsPromise ??= (async () => {
    const vfs: Record<string, string> = {};
    await Promise.all(
      FONT_FILES.map(async ({ file, family, weight, style }) => {
        const response = await fetch(`/fonts/print/${file}`);
        if (!response.ok)
          throw new Error(`Could not load the print font ${file}. Check your connection and try again.`);
        const buffer = await response.arrayBuffer();
        vfs[file] = toBase64(buffer);
        const face = new FontFace(family, buffer.slice(0), { weight, style });
        await face.load();
        document.fonts.add(face);
      })
    );
    return vfs;
  })().catch((error) => {
    fontsPromise = null;
    throw error;
  });
  return fontsPromise;
}

async function loadPdfMake() {
  const [{ default: pdfMake }, vfs] = await Promise.all([import("pdfmake/build/pdfmake"), loadFonts()]);
  pdfMake.addVirtualFileSystem(vfs);
  pdfMake.addFonts(PDF_FONTS);
  return pdfMake;
}

function createMeasure(): Measure {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) throw new Error("This browser cannot measure text for the PDF.");
  const cache = new Map<string, number>();
  return (text, style, size) => {
    const font = `${style.italics && style.family === "serif" ? "italic " : ""}${style.bold ? 600 : 400} 100px "${
      style.family === "sans" ? SANS_FACE : SERIF_FACE
    }"`;
    const key = `${font}\u0000${text}`;
    let width = cache.get(key);
    if (width === undefined) {
      context.font = font;
      width = context.measureText(text).width;
      cache.set(key, width);
    }
    return (width * size) / 100;
  };
}

/** Shortens `text` with an ellipsis until it fits `width` points. */
function fitText(text: string, style: TextStyle, size: number, width: number, measure: Measure) {
  if (measure(text, style, size) <= width) return text;
  let value = text;
  while (value.length > 1 && measure(`${value}…`, style, size) > width) value = value.slice(0, -1);
  return `${value.trimEnd()}…`;
}

// ---------------------------------------------------------------------------------------------
// Maths

type MathBox = MathMetrics & { svg: string };
let mathDocument: Promise<(tex: string) => string> | null = null;
const mathCache = new Map<string, Promise<MathBox>>();

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
    return (value: string) => adaptor.outerHTML(document.convert(value, { display: false }) as never);
  })().catch((error) => {
    mathDocument = null;
    throw error;
  });
  const wrapper = (await mathDocument)(tex);
  if (/data-mjx-error|data-mml-node="merror"/.test(wrapper)) {
    const reason = /data-mjx-error="([^"]*)"/.exec(wrapper)?.[1];
    throw new Error(`the equation "${tex}" could not be typeset${reason ? ` (${reason})` : ""}`);
  }
  const start = wrapper.indexOf("<svg");
  const end = wrapper.lastIndexOf("</svg>");
  if (start < 0 || end < 0) throw new Error(`the equation "${tex}" could not be typeset`);
  return wrapper.slice(start, end + 6);
}

/** Typesets TeX and reads its size, in ems of the maths font, from the SVG viewBox. */
function typeset(tex: string) {
  let box = mathCache.get(tex);
  if (!box) {
    box = texToSvg(tex).then((svg) => {
      const viewBox = /viewBox="([^"]+)"/
        .exec(svg)?.[1]
        .split(/[\s,]+/)
        .map(Number);
      if (!viewBox || viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value)))
        throw new Error(`the equation "${tex}" could not be measured`);
      const [, minY, width, height] = viewBox;
      return {
        svg: svg.replace(/^<svg([^>]*?)\sstyle="[^"]*"/, "<svg$1").replace(/currentColor/g, INK),
        width: width / 1000,
        ascent: -minY / 1000,
        descent: (height + minY) / 1000
      };
    });
    box.catch(() => mathCache.delete(tex));
    mathCache.set(tex, box);
  }
  return box;
}

async function prepareMath(atoms: MathAtom[], label: string) {
  try {
    await Promise.all(
      atoms.map(async (atom) => {
        atom.box = await typeset(atom.latex);
      })
    );
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : "an equation could not be typeset"}.`);
  }
}

// ---------------------------------------------------------------------------------------------
// Images

interface PrintImage {
  src: string;
  /** Natural size in points (CSS pixels at 96 dpi), as an unscaled image would show in the preview. */
  width: number;
  height: number;
}

async function loadImage(source: string, label: string): Promise<PrintImage> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = source;
  try {
    await image.decode();
  } catch {
    throw new Error(`${label} has an image that could not be loaded.`);
  }
  const width = (image.naturalWidth || 300) * 0.75;
  const height = (image.naturalHeight || 150) * 0.75;
  if (/^data:image\/(png|jpe?g);/i.test(source)) return { src: source, width, height };
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || 300;
  canvas.height = image.naturalHeight || 150;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(`${label} has an image that could not be converted for the PDF.`);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  try {
    return { src: canvas.toDataURL("image/png"), width, height };
  } catch {
    throw new Error(`${label} has an image from another website that cannot be copied into the PDF.`);
  }
}

async function loadImages(blocks: Block[], label: string) {
  const images = new Map<string, PrintImage>();
  for (const block of blocks) {
    if (block.kind === "image" && !images.has(block.src)) images.set(block.src, await loadImage(block.src, label));
  }
  return images;
}

function imageSize(image: PrintImage, maxWidth: number, maxHeight: number) {
  let width = Math.min(image.width, maxWidth);
  let height = (width * image.height) / image.width;
  if (height > maxHeight) {
    height = maxHeight;
    width = (height * image.width) / image.height;
  }
  return { width, height };
}

// ---------------------------------------------------------------------------------------------
// Lines and blocks

function textProps(style: TextStyle): PdfNode {
  const props: PdfNode = { font: style.family === "sans" ? "Sans" : "Serif" };
  if (style.bold) props.bold = true;
  if (style.italics) props.italics = true;
  const decoration = [style.underline && "underline", style.strike && "lineThrough"].filter(Boolean);
  if (decoration.length) props.decoration = decoration.length === 1 ? decoration[0] : decoration;
  if (style.link) props.link = style.link;
  if (style.color) props.color = style.color;
  return props;
}

/** One laid-out line as fixed-width columns. Each column's margins put its baseline at `line.ascent`. */
function lineNode(line: Line, size: number): PdfNode {
  const total = line.ascent + line.descent;
  if (!line.items.length)
    return {
      text: " ",
      font: "Serif",
      fontSize: size,
      lineHeight: SERIF_LINE,
      margin: [0, 0, 0, total - size * TYPE.lineHeight]
    };
  const columns = line.items.map((item, index) => {
    const next = line.items[index + 1];
    const width = next ? next.x - item.x : item.width + 4;
    if (item.type === "text") {
      const ascent = item.style.family === "sans" ? TYPE.sansAscent : TYPE.serifAscent;
      const natural = item.style.family === "sans" ? TYPE.sansNaturalHeight : TYPE.serifNaturalHeight;
      const top = line.ascent - size * ascent;
      const height = size * TYPE.lineHeight;
      return {
        width,
        text: item.text,
        noWrap: true,
        fontSize: size,
        lineHeight: TYPE.lineHeight / natural,
        ...textProps(item.style),
        margin: [0, top, 0, Math.max(0, total - top - height)]
      };
    }
    const top = line.ascent - item.ascent;
    return {
      width,
      stack: [
        {
          svg: item.atom.box!.svg,
          width: item.width,
          height: item.height,
          font: "Serif",
          margin: [0, top, 0, Math.max(0, total - top - item.height)]
        }
      ]
    };
  });
  return { columns, columnGap: 0 };
}

interface BlockOptions {
  size: number;
  width: number;
  /** Maximum image height in points. */
  imageHeight: number;
  images: Map<string, PrintImage>;
  measure: Measure;
}

/** Lays out parsed HTML blocks. Returns pdfmake nodes and their exact total height. */
function blockNodes(blocks: Block[], options: BlockOptions) {
  const gap = mm(G.paragraphGapMm);
  const nodes: PdfNode[] = [];
  let height = 0;
  blocks.forEach((block, index) => {
    const after = index < blocks.length - 1 && block.gapAfter ? gap : 0;
    let node: PdfNode;
    let blockHeight: number;
    if (block.kind === "image") {
      const image = options.images.get(block.src)!;
      const size = imageSize(image, options.width, options.imageHeight);
      node = { image: image.src, width: size.width, height: size.height };
      blockHeight = size.height;
    } else {
      const indent = block.indent * mm(G.listIndentMm);
      const quote = block.quote ? G.quoteRulePt + mm(G.quotePaddingMm) : 0;
      const textWidth = options.width - indent - quote;
      const lines = layoutLines(block.atoms, textWidth, options.size, options.measure);
      blockHeight = linesHeight(lines);
      const stack = lines.map((line) => lineNode(line, options.size));
      if (!indent && !quote) node = { stack };
      else {
        const lead: PdfNode = block.marker
          ? {
              width: indent,
              text: block.marker,
              noWrap: true,
              alignment: "right",
              font: "Serif",
              fontSize: options.size,
              lineHeight: SERIF_LINE,
              margin: [0, lines[0].ascent - options.size * TYPE.serifAscent, mm(G.listMarkerGapMm), 0]
            }
          : quote
            ? {
                width: quote,
                canvas: [
                  {
                    type: "line",
                    x1: G.quoteRulePt / 2,
                    y1: 0,
                    x2: G.quoteRulePt / 2,
                    y2: blockHeight,
                    lineWidth: G.quoteRulePt,
                    lineColor: "#a3a3a3"
                  }
                ]
              }
            : { width: indent, text: "" };
        node = { columns: [lead, { width: textWidth, stack }], columnGap: 0 };
      }
    }
    node.margin = [0, 0, 0, after];
    nodes.push(node);
    height += blockHeight + after;
  });
  return { nodes, height };
}

/**
 * Shrinks text by 0.5 pt steps down to 6 pt, then images by 1 mm steps down to 5 mm,
 * until `build` fits in `available` points.
 */
function shrinkToFit(
  build: (size: number, imageHeightMm: number) => { nodes: PdfNode[]; height: number },
  size: number,
  imageHeightMm: number,
  available: number,
  fail: () => string
) {
  let result = build(size, imageHeightMm);
  while (result.height > available && size > 6) {
    size = Math.max(6, size - 0.5);
    result = build(size, imageHeightMm);
  }
  while (result.height > available && imageHeightMm > 5) {
    imageHeightMm = Math.max(5, imageHeightMm - 1);
    result = build(size, imageHeightMm);
  }
  if (result.height > available + 0.01) throw new Error(fail());
  return { ...result, size, imageHeightMm };
}

function filename(name: string, suffix: string) {
  const base =
    name
      .trim()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "") || "mathex-set";
  return `${base}-${suffix}.pdf`;
}

function labelNode(
  text: string,
  size: number = G.label.sizePt,
  color: string = ACCENT,
  margin = [0, 0, 0, 0]
): PdfNode {
  return {
    text: text.toUpperCase(),
    font: "Sans",
    bold: true,
    fontSize: size,
    characterSpacing: size * G.label.letterSpacingEm,
    color,
    noWrap: true,
    margin
  };
}

// ---------------------------------------------------------------------------------------------
// Question slips

export function coverLabel(set: QuestionSetValue) {
  const count = set.questions.length;
  return `Cover · ${count} question${count === 1 ? "" : "s"}`;
}

export async function downloadQuestionSet(set: QuestionSetValue) {
  const options = set.pdfOptions;
  if (options.slipHeight > G.pageHeightMm) throw new Error("Slip height cannot exceed an A4 page (297 mm).");
  const pad = G.contentPaddingMm;
  const contentX = mm(pad.left);
  const cutX = mm(G.pageWidthMm - options.cutMargin);
  const contentWidth = cutX - mm(pad.right) - contentX;
  if (contentWidth < 60)
    throw new Error("The cut margin leaves too little room for the questions. Reduce it in the PDF settings.");
  const pdfMake = await loadPdfMake();
  const measure = createMeasure();
  const slipHeight = mm(options.slipHeight);
  const available = slipHeight - mm(pad.top) - mm(pad.bottom) - LABEL_HEIGHT - mm(G.label.gapMm);
  const title = set.name.trim() || "Untitled set";

  const sources = [
    { label: coverLabel(set), name: "The cover", html: set.instructions, title },
    ...set.questions.map((question, index) => ({
      label: `Question ${index + 1}`,
      name: `Question ${index + 1}`,
      html: question.contents,
      title: undefined as string | undefined
    }))
  ];
  const slips: Array<(typeof sources)[number] & { nodes: PdfNode[] }> = [];
  for (const source of sources) {
    const blocks = parseBlocks(source.html);
    await prepareMath(mathAtoms(blocks), source.name);
    const images = await loadImages(blocks, source.name);
    const titleLines = source.title
      ? layoutLines(
          [{ type: "text", text: source.title, style: { family: "serif", bold: true } }],
          contentWidth,
          G.titleSizePt,
          measure
        )
      : [];
    const titleHeight = titleLines.length ? linesHeight(titleLines) + mm(G.titleGapMm) : 0;
    const titleNodes = titleLines.length
      ? [{ stack: titleLines.map((line) => lineNode(line, G.titleSizePt)), margin: [0, 0, 0, mm(G.titleGapMm)] }]
      : [];
    const fitted = shrinkToFit(
      (size, imageHeightMm) => {
        const body = blockNodes(blocks, { size, width: contentWidth, imageHeight: mm(imageHeightMm), images, measure });
        return { nodes: [...titleNodes, ...body.nodes], height: titleHeight + body.height };
      },
      options.questionTextSize,
      options.imageHeight,
      available,
      () =>
        `${source.name} does not fit on a ${options.slipHeight} mm slip, even with 6 pt text and 5 mm images. Shorten it, or increase the slip height in the PDF settings.`
    );
    slips.push({ ...source, nodes: fitted.nodes });
  }

  const perPage = Math.max(1, Math.floor(G.pageHeightMm / options.slipHeight));
  const questionCount = set.questions.length;
  const footerSize = 6.5;
  const footerStyle: TextStyle = { family: "sans" };
  const showFooter = options.cutMargin >= 16 && options.slipHeight >= 14;
  const footerWidth = mm(options.cutMargin) - mm(8);
  const content: PdfNode[] = [];
  slips.forEach((slip, index) => {
    const row = index % perPage;
    if (row === 0) content.push({ text: "", pageBreak: index ? "before" : undefined });
    const top = row * slipHeight;
    content.push({
      absolutePosition: { x: contentX, y: top + mm(pad.top) },
      stack: [labelNode(slip.label, G.label.sizePt, ACCENT, [0, 0, 0, mm(G.label.gapMm)]), ...slip.nodes]
    });
    if (showFooter) {
      content.push({
        absolutePosition: {
          x: cutX + mm(4),
          y: top + slipHeight - mm(pad.bottom) - 2 * footerSize * TYPE.sansNaturalHeight
        },
        stack: [
          fitText(title, footerStyle, footerSize, footerWidth, measure),
          index === 0 ? "Cover" : `${index} / ${questionCount}`
        ],
        font: "Sans",
        fontSize: footerSize,
        color: MUTED
      });
    }
  });

  const dashed = { lineWidth: 0.6, lineColor: "#8f8f8f", dash: { length: 4, space: 3 } };
  await pdfMake
    .createPdf({
      pageSize: "A4",
      pageMargins: [0, 0, 0, 0],
      info: { title: `${title} — questions`, creator: "Mathex" },
      defaultStyle: { font: "Serif", color: INK },
      background: (currentPage: number) => {
        const first = (currentPage - 1) * perPage;
        const rows = Math.max(0, Math.min(perPage, slips.length - first));
        const canvas: PdfNode[] = [];
        for (let row = 0; row < rows; row++) {
          const top = row * slipHeight;
          const bottom = top + slipHeight;
          const binding = mm(G.bindingMm);
          canvas.push(
            { type: "line", x1: binding, y1: top, x2: binding, y2: bottom, lineWidth: 0.5, lineColor: "#bdbdbd" },
            { type: "line", x1: 0, y1: bottom, x2: mm(G.pageWidthMm), y2: bottom, ...dashed }
          );
          if (options.cutMargin > 0) canvas.push({ type: "line", x1: cutX, y1: top, x2: cutX, y2: bottom, ...dashed });
        }
        return { canvas };
      },
      content
    })
    .download(filename(set.name, "questions"));
}

// ---------------------------------------------------------------------------------------------
// Answer key

export function solutionGroups(question: Item) {
  if (!question.requireAllSolutionGroups) return [question.solutions];
  const groups = new Map<number, Item["solutions"]>();
  for (const solution of question.solutions) {
    const group = solution.group ?? 0;
    groups.set(group, [...(groups.get(group) || []), solution]);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([, solutions]) => solutions);
}

export function partName(index: number) {
  let name = "";
  let value = index + 1;
  while (value > 0) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
    value = Math.floor((value - 1) / 26);
  }
  return `Part ${name}`;
}

export function markerNotes(question: Item) {
  const notes = question.answerComment.trim();
  // The retired editor generated these notes from the skip setting itself.
  if ((!question.skippable && notes === "[Not skippable]") || (question.skippable && notes === "[Skippable]"))
    return "";
  return notes;
}

const OR_STYLE: TextStyle = { family: "serif", italics: true, color: "#7a7a7a" };

function solutionAtoms(group: Item["solutions"]): Atom[] {
  if (!group.length) return [{ type: "text", text: "—", style: { family: "serif", color: MUTED } }];
  return group.flatMap((solution, index): Atom[] => {
    const value: Atom =
      solution.type === "expression"
        ? { type: "math", latex: expressionToLatex(String(solution.value)), scale: 1, style: { family: "serif" } }
        : { type: "text", text: String(solution.value), style: { family: "serif" } };
    return index ? [{ type: "text", text: " or ", style: OR_STYLE }, value] : [value];
  });
}

export async function downloadAnswerSet(set: QuestionSetValue) {
  const pdfMake = await loadPdfMake();
  const measure = createMeasure();
  const size = set.pdfOptions.answerTextSize;
  const margin = mm(18);
  const contentWidth = mm(G.pageWidthMm) - 2 * margin;
  const paddings = { left: [0, 8, 8], right: [6, 10, 0] };
  const numberWidth = Math.max(20, size * 2.2);
  const notesWidth = contentWidth * 0.32;
  const answerWidth = contentWidth - numberWidth - notesWidth - 32;
  const smallSize = Math.max(5.5, size * 0.68);
  const title = set.name.trim() || "Untitled set";

  const header = ["No.", "Answer", "Marking notes"].map((text) => labelNode(text, 7, "#555555"));
  const rows: PdfNode[][] = [header];
  for (let index = 0; index < set.questions.length; index++) {
    const question = set.questions[index];
    const groups = solutionGroups(question);
    const labelled = question.requireAllSolutionGroups && groups.length > 1;
    const answer: PdfNode[] = [];
    let firstAscent = size * TYPE.serifAscent;
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const atoms = solutionAtoms(groups[groupIndex]);
      await prepareMath(
        atoms.filter((atom): atom is MathAtom => atom.type === "math"),
        `The answer to question ${index + 1}`
      );
      const lines = layoutLines(atoms, answerWidth, size, measure);
      if (groupIndex === 0) firstAscent = lines[0].ascent;
      if (labelled) answer.push(labelNode(partName(groupIndex), smallSize, ACCENT, [0, groupIndex ? 0 : 1, 0, 1]));
      answer.push({
        stack: lines.map((line) => lineNode(line, size)),
        margin: [0, 0, 0, groupIndex < groups.length - 1 ? size * 0.45 : 0]
      });
    }
    if (labelled && question.solutionOrderMatters)
      answer.push(labelNode("Parts must be in order", smallSize, "#6b5a1f", [0, 4, 0, 0]));

    const notes: PdfNode[] = [];
    if (!question.skippable) notes.push(labelNode("Not skippable", smallSize, WARN, [0, 1, 0, 2]));
    const comment = markerNotes(question);
    if (comment) notes.push({ text: comment, fontSize: size * 0.92, lineHeight: SERIF_LINE, color: "#3a3a3a" });
    if (!notes.length) notes.push({ text: "" });

    rows.push([
      {
        text: String(index + 1),
        font: "Sans",
        bold: true,
        fontSize: size,
        lineHeight: TYPE.lineHeight / TYPE.sansNaturalHeight,
        margin: [0, labelled ? 0 : Math.max(0, firstAscent - size * TYPE.sansAscent), 0, 0]
      },
      { stack: answer },
      { stack: notes }
    ]);
  }

  await pdfMake
    .createPdf({
      pageSize: "A4",
      pageMargins: [margin, margin, margin, margin + 6],
      info: { title: `${title} — answer key`, creator: "Mathex" },
      defaultStyle: { font: "Serif", fontSize: size, color: INK },
      footer: (currentPage: number, pageCount: number) => ({
        columns: [
          { text: `${fitText(title, { family: "sans" }, 7.5, contentWidth * 0.7, measure)} · Answer key`, width: "*" },
          { text: `${currentPage} / ${pageCount}`, width: "auto" }
        ],
        font: "Sans",
        fontSize: 7.5,
        color: MUTED,
        margin: [margin, 20, margin, 0]
      }),
      content: [
        labelNode("Answer key", 8, ACCENT, [0, 0, 0, 4]),
        { text: title, bold: true, fontSize: 20, lineHeight: 1, margin: [0, 0, 0, 3] },
        {
          text: `${set.questions.length} question${set.questions.length === 1 ? "" : "s"}`,
          font: "Sans",
          fontSize: 9,
          color: "#666666",
          margin: [0, 0, 0, 16]
        },
        {
          table: { headerRows: 1, dontBreakRows: true, widths: [numberWidth, answerWidth, notesWidth], body: rows },
          layout: {
            hLineWidth: (line: number, node: { table: { body: unknown[] } }) =>
              line === 0 ? 0 : line === 1 || line === node.table.body.length ? 0.8 : 0.4,
            hLineColor: (line: number, node: { table: { body: unknown[] } }) =>
              line === 1 || line === node.table.body.length ? "#2a2a2a" : "#d4d4d4",
            vLineWidth: () => 0,
            paddingLeft: (column: number) => paddings.left[column],
            paddingRight: (column: number) => paddings.right[column],
            paddingTop: (row: number) => (row === 0 ? 0 : 6),
            paddingBottom: (row: number) => (row === 0 ? 4 : 6)
          }
        }
      ]
    })
    .download(filename(set.name, "answers"));
}
