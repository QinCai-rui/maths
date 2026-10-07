import { DivisionByZero, add, div, equals, fromInt, mul, sub, type Rational } from "./rational.js";

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

export type BinOp = "+" | "-" | "*" | "/";
export type Ast = { kind: "num"; value: number } | { kind: "bin"; op: BinOp; left: Ast; right: Ast };

type Token = { kind: "num"; value: number } | { kind: "op"; op: BinOp } | { kind: "lparen" } | { kind: "rparen" };

function normalizeGlyphs(text: string): string {
  return text.replaceAll("×", "*").replaceAll("÷", "/").replaceAll("−", "-");
}

function tokenize(text: string): Token[] {
  const src = normalizeGlyphs(text);
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch >= "0" && ch <= "9") {
      let j = i;
      while (j < src.length && src[j]! >= "0" && src[j]! <= "9") j++;
      // Reject floats: digit run followed by . or digit run preceded... only '.' matters here
      if (src[j] === ".") {
        throw new ParseError(`Decimals are not allowed near "${src.slice(i, j + 1)}"`);
      }
      tokens.push({ kind: "num", value: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ kind: "op", op: ch });
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i++;
      continue;
    }
    if (ch === ".") {
      throw new ParseError(`Decimals are not allowed`);
    }
    throw new ParseError(`Unexpected character "${ch}"`);
  }
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  parseAll(): Ast {
    if (this.tokens.length === 0) throw new ParseError("Empty expression");
    const node = this.parseExpr();
    const rest = this.peek();
    if (rest !== undefined) {
      if (rest.kind === "rparen") throw new ParseError(`Unmatched ")"`);
      throw new ParseError(`Unexpected token after expression`);
    }
    return node;
  }

  private parseExpr(): Ast {
    let left = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (t?.kind === "op" && (t.op === "+" || t.op === "-")) {
        this.pos++;
        const right = this.parseTerm();
        left = { kind: "bin", op: t.op, left, right };
      } else {
        return left;
      }
    }
  }

  private parseTerm(): Ast {
    let left = this.parseFactor();
    for (;;) {
      const t = this.peek();
      if (t?.kind === "op" && (t.op === "*" || t.op === "/")) {
        this.pos++;
        const right = this.parseFactor();
        left = { kind: "bin", op: t.op, left, right };
      } else {
        return left;
      }
    }
  }

  private parseFactor(): Ast {
    const t = this.peek();
    if (t === undefined) throw new ParseError("Unexpected end of expression");
    if (t.kind === "num") {
      this.pos++;
      return { kind: "num", value: t.value };
    }
    if (t.kind === "lparen") {
      this.pos++;
      const inner = this.parseExpr();
      const close = this.peek();
      if (close?.kind !== "rparen") throw new ParseError(`Missing closing ")"`);
      this.pos++;
      return inner;
    }
    if (t.kind === "rparen") throw new ParseError(`Unmatched ")"`);
    // Any operator where a value is expected: covers leading/unary minus,
    // doubled operators ("2++2"), and missing operands ("2+").
    throw new ParseError(`Expected a number or "(" but found "${t.op}"`);
  }
}

export function parse(text: string): Ast {
  const tokens = tokenize(text);
  // Reject implicit multiplication: "2(3)", "(2)(3)", "2 3", "(2)3".
  for (let i = 0; i + 1 < tokens.length; i++) {
    const a = tokens[i]!;
    const b = tokens[i + 1]!;
    const aIsValue = a.kind === "num" || a.kind === "rparen";
    const bIsValueStart = b.kind === "num" || b.kind === "lparen";
    if (aIsValue && bIsValueStart) {
      throw new ParseError("Implicit multiplication is not allowed; use * explicitly");
    }
  }
  return new Parser(tokens).parseAll();
}

export function collectLeaves(ast: Ast): number[] {
  if (ast.kind === "num") return [ast.value];
  return [...collectLeaves(ast.left), ...collectLeaves(ast.right)];
}

export function evaluate(ast: Ast): Rational {
  if (ast.kind === "num") return fromInt(ast.value);
  const l = evaluate(ast.left);
  const r = evaluate(ast.right);
  switch (ast.op) {
    case "+":
      return add(l, r);
    case "-":
      return sub(l, r);
    case "*":
      return mul(l, r);
    case "/":
      return div(l, r);
  }
}

function sorted(nums: number[]): number[] {
  return [...nums].sort((a, b) => a - b);
}

/** Human-readable leaf comparison; null when the multisets match. */
export function describeLeaves(found: number[], expected: number[]): string | null {
  const f = sorted(found);
  const e = sorted(expected);
  if (f.length === e.length && f.every((v, i) => v === e[i])) return null;
  return `Use each card exactly once: expected [${e.join(", ")}] but found [${f.join(", ")}]`;
}

export type ValidationResult = { ok: true; value: Rational } | { ok: false; reason: string; leaves?: number[] };

export function validate(text: string, cards: number[]): ValidationResult {
  let ast: Ast;
  try {
    ast = parse(text);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  const leaves = collectLeaves(ast);
  const mismatch = describeLeaves(leaves, cards);
  if (mismatch !== null) return { ok: false, reason: mismatch, leaves };
  let value: Rational;
  try {
    value = evaluate(ast);
  } catch (err) {
    if (err instanceof DivisionByZero) {
      return { ok: false, reason: "Division by zero", leaves };
    }
    return { ok: false, reason: err instanceof Error ? err.message : String(err), leaves };
  }
  if (!equals(value, fromInt(24))) {
    return {
      ok: false,
      reason: `Expression equals ${value.d === 1 ? value.n : `${value.n}/${value.d}`} instead of 24`,
      leaves
    };
  }
  return { ok: true, value };
}
