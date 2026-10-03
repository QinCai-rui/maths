export interface NumberFacts {
  isEven: boolean;
  isPrime: boolean;
  primeFactorisation: string;
  factors: number[];
  isTriangular: boolean;
  isSquare: boolean;
  isCube: boolean;
  isFibonacci: boolean;
  isPerfect: boolean;
  isPalindrome: boolean;
  isHappy: boolean;
  collatzSteps: number | null;
}

export function getNumberFacts(n: number): NumberFacts {
  const factors: number[] = [];
  const primeFactors: string[] = [];
  let remainder = n;
  let isPrime = n > 1;

  for (let divisor = 1; divisor <= Math.sqrt(n); divisor++) {
    if (n % divisor === 0) {
      factors.push(divisor);
      if (divisor !== n / divisor) factors.push(n / divisor);
    }
  }
  factors.sort((a, b) => a - b);

  for (let divisor = 2; divisor * divisor <= remainder; divisor++) {
    if (remainder % divisor !== 0) continue;
    isPrime = false;
    let power = 0;
    while (remainder % divisor === 0) {
      remainder /= divisor;
      power++;
    }
    primeFactors.push(power > 1 ? `${divisor}^${power}` : `${divisor}`);
  }
  if (remainder > 1) primeFactors.push(`${remainder}`);

  const squareRoot = Math.sqrt(n);
  const cubeRoot = Math.round(Math.cbrt(n));
  const triangularRoot = (Math.sqrt(8 * n + 1) - 1) / 2;
  const fibonacciA = Math.sqrt(5 * n * n + 4);
  const fibonacciB = Math.sqrt(5 * n * n - 4);
  const properDivisorSum = factors.reduce((sum, factor) => sum + (factor === n ? 0 : factor), 0);

  let current = n;
  const seen = new Set<number>();
  while (current !== 1 && !seen.has(current)) {
    seen.add(current);
    current = current
      .toString()
      .split("")
      .reduce((sum, digit) => sum + Number(digit) ** 2, 0);
  }

  let collatzValue = n;
  let collatzSteps = 0;
  while (collatzValue !== 1 && collatzSteps < 1500) {
    collatzValue = collatzValue % 2 === 0 ? collatzValue / 2 : 3 * collatzValue + 1;
    collatzSteps++;
  }

  return {
    isEven: n % 2 === 0,
    isPrime,
    primeFactorisation: n === 1 ? "1" : primeFactors.join(" × ") || `${n}`,
    factors,
    isTriangular: Number.isInteger(triangularRoot),
    isSquare: Number.isInteger(squareRoot),
    isCube: cubeRoot ** 3 === n,
    isFibonacci: Number.isInteger(fibonacciA) || Number.isInteger(fibonacciB),
    isPerfect: properDivisorSum === n && n > 1,
    isPalindrome: n.toString() === n.toString().split("").reverse().join(""),
    isHappy: current === 1,
    collatzSteps: collatzValue === 1 ? collatzSteps : null
  };
}

export function getNumberOfTheDay(date = new Date()): number {
  const utcDate = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const day = Math.floor(utcDate / 86_400_000);
  return 2 + (day % 9_999);
}
