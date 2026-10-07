export interface Rational {
  n: number;
  d: number;
}

export class DivisionByZero extends Error {
  constructor(message = "Division by zero") {
    super(message);
    this.name = "DivisionByZero";
  }
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a === 0 ? 1 : a;
}

function normalize(n: number, d: number): Rational {
  if (d === 0) throw new DivisionByZero();
  if (!Number.isInteger(n) || !Number.isInteger(d)) {
    throw new Error(`Rational requires integers, got ${n}/${d}`);
  }
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d)) {
    throw new Error(`Rational overflow: ${n}/${d} exceeds safe-integer precision`);
  }
  if (d < 0) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

export function fromInt(n: number): Rational {
  if (!Number.isSafeInteger(n)) throw new Error(`fromInt requires a safe integer, got ${n}`);
  return { n, d: 1 };
}

export function add(a: Rational, b: Rational): Rational {
  return normalize(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function sub(a: Rational, b: Rational): Rational {
  return normalize(a.n * b.d - b.n * a.d, a.d * b.d);
}

export function mul(a: Rational, b: Rational): Rational {
  return normalize(a.n * b.n, a.d * b.d);
}

export function div(a: Rational, b: Rational): Rational {
  if (b.n === 0) throw new DivisionByZero();
  return normalize(a.n * b.d, a.d * b.n);
}

export function equals(a: Rational, b: Rational): boolean {
  return a.n === b.n && a.d === b.d;
}

export function isInteger(r: Rational): boolean {
  return r.d === 1;
}

export function toString(r: Rational): string {
  if (r.d === 1) return `${r.n}`;
  return `${r.n}/${r.d}`;
}

export function toNumber(r: Rational): number {
  return r.n / r.d;
}
