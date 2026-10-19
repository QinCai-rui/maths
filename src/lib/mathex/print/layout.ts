// Line breaking and baseline maths for printed slips and answer keys. Everything here is
// pure: callers pass a `measure` function backed by the embedded print fonts, so the same
// code runs in tests with fake widths.

export interface TextStyle {
  family: "serif" | "sans";
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  strike?: boolean;
  link?: string;
  color?: string;
}

/** Size of a typeset formula in ems of the math font, measured from its SVG viewBox. */
export interface MathMetrics {
  width: number;
  ascent: number;
  descent: number;
}

export type Atom =
  | { type: "text"; text: string; style: TextStyle }
  | { type: "math"; latex: string; scale: number; style: TextStyle; box?: MathMetrics & { svg: string } }
  | { type: "break" };

export type MathAtom = Extract<Atom, { type: "math" }>;

/** Width in points of `text` set in `style` at `size` points. */
export type Measure = (text: string, style: TextStyle, size: number) => number;

export const TYPE = {
  /** Source Serif 4 ascender, in ems. pdfmake puts the baseline this far below a text node's top. */
  serifAscent: 1.036,
  /** Source Serif 4 line height used by pdfmake at lineHeight 1 (ascender plus descender). */
  serifNaturalHeight: 1.371,
  /** Hanken Grotesk ascender and natural line height, in ems. */
  sansAscent: 1,
  sansNaturalHeight: 1.303,
  /** Baseline-to-baseline distance for body text, in ems. Matches CSS line-height in previews. */
  lineHeight: 1.3,
  /** MathJax's TeX fonts have a smaller x-height than Source Serif, so maths is set slightly larger. */
  mathEm: 1.06,
  /** Clearance kept above and below maths that is taller or deeper than the text. */
  mathPadAbove: 0.1,
  mathPadBelow: 0.06
} as const;

export type Placed =
  | { type: "text"; text: string; style: TextStyle; x: number; width: number }
  | { type: "math"; atom: MathAtom; x: number; width: number; height: number; ascent: number; descent: number };

export interface Line {
  items: Placed[];
  width: number;
  /** Distance from the top of the line box to the baseline. */
  ascent: number;
  /** Distance from the baseline to the bottom of the line box. */
  descent: number;
}

type Fragment =
  | { kind: "text"; text: string; style: TextStyle; width: number }
  | {
      kind: "math";
      atom: MathAtom;
      width: number;
      ascent: number;
      descent: number;
    };
type Glue = { style: TextStyle; width: number };
interface Word {
  fragments: Fragment[];
  glue: Glue | null;
  breaks: number;
  width: number;
}

export function sameStyle(a: TextStyle, b: TextStyle) {
  return (
    a.family === b.family &&
    !!a.bold === !!b.bold &&
    !!a.italics === !!b.italics &&
    !!a.underline === !!b.underline &&
    !!a.strike === !!b.strike &&
    a.link === b.link &&
    a.color === b.color
  );
}

function words(atoms: Atom[], size: number, measure: Measure) {
  const result: Word[] = [];
  let current: Word | null = null;
  let glue: Glue | null = null;
  let breaks = 0;
  const push = (fragment: Fragment) => {
    if (!current) {
      current = { fragments: [], glue, breaks, width: 0 };
      result.push(current);
      glue = null;
      breaks = 0;
    }
    current.fragments.push(fragment);
    current.width += fragment.width;
  };
  for (const atom of atoms) {
    if (atom.type === "break") {
      current = null;
      glue = null;
      breaks++;
    } else if (atom.type === "math") {
      if (!atom.box) throw new Error(`Equation was not typeset: ${atom.latex}`);
      const em = size * TYPE.mathEm * atom.scale;
      push({
        kind: "math",
        atom,
        width: atom.box.width * em,
        ascent: atom.box.ascent * em,
        descent: atom.box.descent * em
      });
    } else {
      // Only collapsible HTML whitespace breaks lines; a non-breaking space stays inside the word.
      for (const part of atom.text.split(/([ \t\n\r\f]+)/)) {
        if (!part) continue;
        if (/^[ \t\n\r\f]+$/.test(part)) {
          current = null;
          if (!glue && (result.length || breaks)) glue = { style: atom.style, width: measure(" ", atom.style, size) };
        } else {
          push({ kind: "text", text: part, style: atom.style, width: measure(part, atom.style, size) });
        }
      }
    }
  }
  return { words: result, trailingBreaks: breaks };
}

/** Splits a word that cannot fit on any line: shrinks wide maths and cuts long text by characters. */
function splitWide(word: Word, maxWidth: number, size: number, measure: Measure): Word[] {
  const pieces: Word[] = [];
  const add = (fragment: Fragment) =>
    pieces.push({
      fragments: [fragment],
      glue: pieces.length ? null : word.glue,
      breaks: pieces.length ? 0 : word.breaks,
      width: fragment.width
    });
  for (const fragment of word.fragments) {
    if (fragment.width <= maxWidth) add(fragment);
    else if (fragment.kind === "math") {
      const factor = maxWidth / fragment.width;
      add({ ...fragment, width: maxWidth, ascent: fragment.ascent * factor, descent: fragment.descent * factor });
    } else {
      let chunk = "";
      for (const character of fragment.text) {
        if (chunk && measure(chunk + character, fragment.style, size) > maxWidth) {
          add({ ...fragment, text: chunk, width: measure(chunk, fragment.style, size) });
          chunk = "";
        }
        chunk += character;
      }
      if (chunk) add({ ...fragment, text: chunk, width: measure(chunk, fragment.style, size) });
    }
  }
  return pieces;
}

function finishLine(entries: Word[], size: number): Line {
  const items: Placed[] = [];
  let x = 0;
  let run: Extract<Placed, { type: "text" }> | null = null;
  let spaced = false;
  let ascent = size * TYPE.serifAscent;
  let descent = size * (TYPE.lineHeight - TYPE.serifAscent);
  entries.forEach((word, index) => {
    if (index > 0 && word.glue) {
      x += word.glue.width;
      spaced = run !== null && sameStyle(run.style, word.glue.style);
      if (!spaced) run = null;
    } else spaced = false;
    for (const fragment of word.fragments) {
      if (fragment.kind === "text") {
        if (run && sameStyle(run.style, fragment.style)) {
          run.text += (spaced ? " " : "") + fragment.text;
          run.width = x + fragment.width - run.x;
        } else {
          run = { type: "text", text: fragment.text, style: fragment.style, x, width: fragment.width };
          items.push(run);
        }
      } else {
        run = null;
        items.push({
          type: "math",
          atom: fragment.atom,
          x,
          width: fragment.width,
          height: fragment.ascent + fragment.descent,
          ascent: fragment.ascent,
          descent: fragment.descent
        });
        ascent = Math.max(ascent, fragment.ascent + size * TYPE.mathPadAbove);
        descent = Math.max(descent, fragment.descent + size * TYPE.mathPadBelow);
      }
      spaced = false;
      x += fragment.width;
    }
  });
  return { items, width: x, ascent, descent };
}

/** Breaks atoms into lines no wider than `maxWidth` points. Always returns at least one line. */
export function layoutLines(atoms: Atom[], maxWidth: number, size: number, measure: Measure): Line[] {
  const { words: list, trailingBreaks } = words(atoms, size, measure);
  const lines: Line[] = [];
  let entries: Word[] = [];
  let width = 0;
  const flush = () => {
    lines.push(finishLine(entries, size));
    entries = [];
    width = 0;
  };
  for (const original of list) {
    for (const word of original.width > maxWidth ? splitWide(original, maxWidth, size, measure) : [original]) {
      if (word.breaks > 0) {
        // Like HTML: n breaks after text start n - 1 empty lines; at the start they add n.
        const empty = entries.length ? word.breaks - 1 : word.breaks;
        if (entries.length) flush();
        for (let index = 0; index < empty; index++) flush();
      } else if (entries.length && width + (word.glue?.width || 0) + word.width > maxWidth + 0.01) {
        flush();
      }
      width += (entries.length ? word.glue?.width || 0 : 0) + word.width;
      entries.push(word);
    }
  }
  if (entries.length) flush();
  for (let index = 1; index < trailingBreaks; index++) flush();
  if (!lines.length) flush();
  return lines;
}

export function linesHeight(lines: Line[]) {
  return lines.reduce((total, line) => total + line.ascent + line.descent, 0);
}
