// Turns stored Quill HTML into printable blocks: paragraphs (with list and quote context)
// made of styled words and inline maths, and images on their own line.

import { parseStoredMath } from "../content";
import type { Atom, TextStyle } from "./layout";

export type Block =
  | { kind: "text"; atoms: Atom[]; indent: number; marker?: string; quote?: boolean; gapAfter: number }
  | { kind: "image"; src: string; gapAfter: number };

type Token = Atom | { type: "image"; src: string };

export const BASE_STYLE: TextStyle = { family: "serif" };
export const LINK_COLOR = "#1155cc";

const BLOCK_TAGS = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "PRE", "BLOCKQUOTE", "OL", "UL", "IMG", "LI"]);
const ROMAN: [number, string][] = [
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"]
];

function roman(value: number) {
  let result = "";
  for (const [amount, letters] of ROMAN) {
    while (value >= amount) {
      result += letters;
      value -= amount;
    }
  }
  return result;
}

function alpha(value: number) {
  let result = "";
  while (value > 0) {
    result = String.fromCharCode(97 + ((value - 1) % 26)) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

/** Quill numbers nested lists 1., a., i., then repeats. */
export function listMarker(kind: "ordered" | "bullet", level: number, count: number) {
  if (kind === "bullet") return "•";
  const style = level % 3;
  return `${style === 0 ? count : style === 1 ? alpha(count) : roman(count)}.`;
}

/** List context for one `<li>`: Quill 2 writes every list as `<ol>` and puts the kind in `data-list`. */
export function listItemInfo(item: Element) {
  const kind: "ordered" | "bullet" =
    item.getAttribute("data-list") === "ordered" ||
    (!item.hasAttribute("data-list") && item.parentElement?.tagName === "OL")
      ? "ordered"
      : "bullet";
  const indent = /(?:^|\s)ql-indent-(\d+)/.exec(item.className)?.[1];
  return { kind, level: indent ? Math.min(8, Number(indent)) : 0 };
}

/** Walks a list and returns each item's marker text, numbering like Quill does. */
export function listMarkers(list: Element) {
  const counters: number[] = [];
  return [...list.children].map((item) => {
    const { kind, level } = listItemInfo(item);
    counters.length = level + 1;
    if (kind === "ordered") counters[level] = (counters[level] || 0) + 1;
    else counters[level] = 0;
    return { item, level, marker: listMarker(kind, level, counters[level] || 1) };
  });
}

function textTokens(value: string, style: TextStyle): Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  for (const match of value.matchAll(/\$\$([\s\S]+?)\$\$/g)) {
    const index = match.index || 0;
    if (index > offset) tokens.push({ type: "text", text: value.slice(offset, index), style });
    const { latex, scale } = parseStoredMath(match[1]);
    if (latex.trim()) tokens.push({ type: "math", latex, scale, style });
    offset = index + match[0].length;
  }
  if (offset < value.length) tokens.push({ type: "text", text: value.slice(offset), style });
  return tokens;
}

function inlineTokens(node: Node, style: TextStyle): Token[] {
  if (node.nodeType === Node.TEXT_NODE) return textTokens(node.textContent || "", style);
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const element = node as Element;
  if (element.classList.contains("ql-ui")) return [];
  const tag = element.tagName;
  if (tag === "IMG") {
    const src = element.getAttribute("src");
    return src ? [{ type: "image", src }] : [];
  }
  if (tag === "BR") return [{ type: "break" }];
  const next = { ...style };
  if (tag === "STRONG" || tag === "B" || /^H\d$/.test(tag)) next.bold = true;
  if (tag === "EM" || tag === "I") next.italics = true;
  if (tag === "U") next.underline = true;
  if (tag === "S" || tag === "STRIKE" || tag === "DEL") next.strike = true;
  if (tag === "A") {
    const href = element.getAttribute("href");
    if (href && /^(https?:|mailto:)/i.test(href)) next.link = href;
    next.color = LINK_COLOR;
    next.underline = true;
  }
  return [...element.childNodes].flatMap((child) => inlineTokens(child, next));
}

function hasContent(atoms: Atom[]) {
  return atoms.some((atom) => atom.type === "math" || (atom.type === "text" && atom.text.trim()));
}

export function parseBlocks(html: string): Block[] {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  const blocks: Block[] = [];

  const pushTokens = (
    tokens: Token[],
    context: { indent: number; marker?: string; quote?: boolean; gapAfter: number },
    keepEmpty: boolean
  ) => {
    let atoms: Atom[] = [];
    let marker = context.marker;
    let produced = false;
    const flush = (force: boolean) => {
      if (hasContent(atoms) || (force && !produced)) {
        blocks.push({ kind: "text", atoms, indent: context.indent, marker, quote: context.quote, gapAfter: context.gapAfter });
        marker = undefined;
        produced = true;
      }
      atoms = [];
    };
    for (const token of tokens) {
      if (token.type === "image") {
        flush(false);
        blocks.push({ kind: "image", src: token.src, gapAfter: context.gapAfter });
        produced = true;
      } else atoms.push(token);
    }
    flush(keepEmpty);
  };

  let inline: Node[] = [];
  const flushInline = () => {
    const tokens = inline.flatMap((node) => inlineTokens(node, BASE_STYLE));
    if (tokens.some((token) => token.type !== "text" || token.text.trim()))
      pushTokens(tokens, { indent: 0, gapAfter: 1 }, false);
    inline = [];
  };

  for (const node of doc.body.childNodes) {
    if (node.nodeType !== Node.ELEMENT_NODE || !BLOCK_TAGS.has((node as Element).tagName)) {
      inline.push(node);
      continue;
    }
    flushInline();
    const element = node as Element;
    if (element.tagName === "OL" || element.tagName === "UL") {
      const items = listMarkers(element);
      items.forEach(({ item, level, marker }, index) =>
        pushTokens(
          inlineTokens(item, BASE_STYLE),
          { indent: level + 1, marker, gapAfter: index === items.length - 1 ? 1 : 0 },
          true
        )
      );
    } else if (element.tagName === "BLOCKQUOTE") {
      pushTokens(inlineTokens(element, BASE_STYLE), { indent: 0, quote: true, gapAfter: 1 }, true);
    } else {
      pushTokens(inlineTokens(element, BASE_STYLE), { indent: 0, gapAfter: 1 }, true);
    }
  }
  flushInline();
  // Quill leaves an empty paragraph at the end of most documents; it prints as nothing.
  while (blocks.length) {
    const last = blocks[blocks.length - 1];
    if (last.kind !== "text" || hasContent(last.atoms) || last.marker) break;
    blocks.pop();
  }
  return blocks;
}

export function mathAtoms(blocks: Block[]) {
  return blocks.flatMap((block) =>
    block.kind === "text" ? block.atoms.filter((atom): atom is Extract<Atom, { type: "math" }> => atom.type === "math") : []
  );
}
