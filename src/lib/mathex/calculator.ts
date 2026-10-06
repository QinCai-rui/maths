import { math } from "./math";

export type AngleMode = "deg" | "rad";

export interface CalculatorOptions {
  angleMode: AngleMode;
  showFraction: boolean;
}

export interface CalculatorSuccess {
  ok: true;
  value: number;
  /** Decimal rendering, rounded to 12 significant figures. */
  display: string;
  /** Exact fraction rendering (e.g. "1/3") when one exists and is clean. */
  fraction?: string;
}

export interface CalculatorFailure {
  ok: false;
  error: string;
}

export type CalculatorEvaluation = CalculatorSuccess | CalculatorFailure;

type Scope = Record<string, (...args: number[]) => number>;

// Fractions with a denominator larger than this are almost certainly the
// continued-fraction approximation of an irrational (π, √2, …), so we only
// surface fractions we are confident a student means.
const FRACTION_DENOMINATOR_LIMIT = 10_000;

const SIGNIFICANT_FIGURES = 12;

// Degrees that differ from an integer by less than this are trig residue
// (sin(180°) ≈ 1.2e-16) and are snapped clean. Applied only to trig outputs.
const ANGLE_SNAP_EPSILON = 1e-9;

// Names that are functions, so implicit multiplication can tell `2sin(30)`
// (a call) apart from `2pi` / `2e3` (multiplication). Longest-first matching.
const FUNCTION_NAMES = [
  "atan2",
  "nthRoot",
  "factorial",
  "combinations",
  "permutations",
  "variance",
  "sinh",
  "cosh",
  "tanh",
  "asin",
  "acos",
  "atan",
  "log10",
  "log2",
  "hypot",
  "random",
  "median",
  "sec",
  "csc",
  "cot",
  "sqrt",
  "cbrt",
  "root",
  "sign",
  "floor",
  "ceil",
  "round",
  "log",
  "exp",
  "sin",
  "cos",
  "tan",
  "abs",
  "mod",
  "pow",
  "gcd",
  "lcm",
  "nCr",
  "nPr",
  "min",
  "max",
  "sum",
  "mean",
  "std",
  "prod",
  "ln"
].sort((a, b) => b.length - a.length);

const FUNCTION_SET = new Set(FUNCTION_NAMES);

type TokenType = "number" | "name" | "paren" | "comma" | "op";

interface Token {
  type: TokenType;
  value: string;
}

function isNameChar(char: string): boolean {
  return /[A-Za-z]/.test(char);
}

function isDigit(char: string): boolean {
  return /[0-9]/.test(char);
}

/**
 * Splits an expression into numbers (no exponent notation — `e` is Euler's
 * number here), identifiers, brackets, commas and operators. Known function
 * names are matched longest-first so `log10` and `nthRoot` stay intact.
 */
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (char === " " || char === "\t") {
      index++;
      continue;
    }
    if (isDigit(char) || (char === "." && isDigit(input[index + 1] ?? ""))) {
      let end = index;
      while (end < input.length && (isDigit(input[end]) || input[end] === ".")) end++;
      tokens.push({ type: "number", value: input.slice(index, end) });
      index = end;
      continue;
    }
    if (isNameChar(char)) {
      const rest = input.slice(index);
      const known = FUNCTION_NAMES.find((name) => rest.startsWith(name) && !isNameChar(rest[name.length] ?? ""));
      if (known) {
        tokens.push({ type: "name", value: known });
        index += known.length;
        continue;
      }
      let end = index;
      while (end < input.length && isNameChar(input[end])) end++;
      tokens.push({ type: "name", value: input.slice(index, end) });
      index = end;
      continue;
    }
    if (char === "(" || char === ")") {
      tokens.push({ type: "paren", value: char });
      index++;
      continue;
    }
    if (char === ",") {
      tokens.push({ type: "comma", value: char });
      index++;
      continue;
    }
    tokens.push({ type: "op", value: char });
    index++;
  }
  return tokens;
}

function canEndValue(token: Token): boolean {
  if (token.type === "number") return true;
  if (token.type === "name") return !FUNCTION_SET.has(token.value);
  if (token.type === "paren") return token.value === ")";
  if (token.type === "op") return token.value === "!" || token.value === "%";
  return false;
}

function canStartValue(token: Token): boolean {
  if (token.type === "number" || token.type === "name") return true;
  if (token.type === "paren") return token.value === "(";
  return false;
}

/**
 * Rewrites implicit multiplication as explicit `*` so constant-first forms
 * like `π2`, `e2` and `2e3` work. mathjs only multiplies implicitly when the
 * left operand is a number, and reads `2e3` as scientific notation.
 */
function applyImplicitMultiplication(tokens: Token[]): string {
  let output = "";
  for (let index = 0; index < tokens.length; index++) {
    const current = tokens[index];
    output += current.value;
    const next = tokens[index + 1];
    if (!next) continue;
    const functionCall =
      current.type === "name" && FUNCTION_SET.has(current.value) && next.type === "paren" && next.value === "(";
    if (!functionCall && canEndValue(current) && canStartValue(next)) output += "*";
  }
  return output;
}

/** Rewrites the pretty symbols the keypad emits into mathjs-friendly ASCII. */
export function normalizeExpression(input: string): string {
  const glyphs = input
    .replace(/[πΠ]/g, "pi")
    .replace(/[×✕✖⋅·]/g, "*")
    .replace(/[÷∕]/g, "/")
    .replace(/[−–—]/g, "-")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3");
  return applyImplicitMultiplication(tokenize(glyphs));
}

/** Snaps trig residue that sits a hair away from a clean integer. */
function snapAngle(value: number): number {
  const nearest = Math.round(value);
  return Math.abs(value - nearest) < ANGLE_SNAP_EPSILON ? (nearest === 0 ? 0 : nearest) : value;
}

/**
 * Trigonometric functions honour the selected angle mode. We override the
 * mathjs trig functions in the evaluation scope so a stale mode can never
 * silently poison a result.
 */
function angleScope(angleMode: AngleMode): Scope {
  if (angleMode !== "deg") return {};
  const toRadians = (x: number) => (x * Math.PI) / 180;
  const toDegrees = (x: number) => (x * 180) / Math.PI;
  return {
    sin: (x) => snapAngle(Math.sin(toRadians(x))),
    cos: (x) => snapAngle(Math.cos(toRadians(x))),
    tan: (x) => {
      const radians = toRadians(x);
      // tan(90°) and friends are undefined, not 1.6e16.
      return Math.abs(Math.cos(radians)) < 1e-12 ? NaN : snapAngle(Math.tan(radians));
    },
    asin: (x) => snapAngle(toDegrees(Math.asin(x))),
    acos: (x) => snapAngle(toDegrees(Math.acos(x))),
    atan: (x) => snapAngle(toDegrees(Math.atan(x))),
    atan2: (y, x) => snapAngle(toDegrees(Math.atan2(y, x))),
    sec: (x) => 1 / Math.cos(toRadians(x)),
    csc: (x) => 1 / Math.sin(toRadians(x)),
    cot: (x) => {
      const tangent = Math.tan(toRadians(x));
      return Math.abs(tangent) < 1e-12 ? NaN : 1 / tangent;
    }
  };
}

/** Readable aliases for the functions the extra keypad keys insert. */
function functionScope(): Scope {
  return {
    nCr: (n, r) => Number(math.combinations(n, r)),
    nPr: (n, r) => Number(math.permutations(n, r)),
    root: (x, n) => Number(math.nthRoot(x, n)),
    ln: (x) => Math.log(x)
  };
}

export function formatNumber(value: number): string {
  return String(Number(value.toPrecision(SIGNIFICANT_FIGURES)));
}

export function formatFraction(value: number): string | undefined {
  const rounded = Number(value.toPrecision(SIGNIFICANT_FIGURES));
  if (!Number.isFinite(rounded) || Number.isInteger(rounded)) return undefined;
  let fraction: ReturnType<typeof math.fraction>;
  try {
    fraction = math.fraction(rounded);
  } catch {
    return undefined;
  }
  const denominator = Number(fraction.d);
  if (!Number.isFinite(denominator) || denominator === 1 || denominator > FRACTION_DENOMINATOR_LIMIT) {
    return undefined;
  }
  return fraction.toFraction();
}

/** Expands "9.5e-7" / "1e+21" into plain decimal so `e` is never reread as Euler. */
function expandExponential(text: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(text);
  if (!match) return text;
  const [, sign, integer, fraction = "", exponentText] = match;
  const exponent = Number(exponentText);
  const digits = integer + fraction;
  const point = integer.length + exponent;
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${"0".repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/**
 * A literal for chaining off a result. Exponent notation is expanded because
 * the tokenizer reads `e` as Euler's number, which would corrupt the value.
 */
export function formatChainLiteral(value: number): string {
  const text = String(value);
  return /[eE]/.test(text) ? expandExponential(text) : text;
}

export function evaluateExpression(raw: string, options: CalculatorOptions): CalculatorEvaluation {
  const expression = normalizeExpression(raw).trim();
  if (!expression) return { ok: false, error: "Error" };
  try {
    const scope: Scope = { ...functionScope(), ...angleScope(options.angleMode) };
    const value = math.evaluate(expression, scope);
    if (typeof value !== "number") return { ok: false, error: "Not a real number" };
    if (Number.isNaN(value)) return { ok: false, error: "Undefined" };
    if (!Number.isFinite(value)) return { ok: false, error: "Out of range" };
    return {
      ok: true,
      value,
      display: formatNumber(value),
      fraction: options.showFraction ? formatFraction(value) : undefined
    };
  } catch {
    return { ok: false, error: "Error" };
  }
}
