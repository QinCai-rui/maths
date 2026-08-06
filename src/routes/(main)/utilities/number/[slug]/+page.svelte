<script lang="ts">
  import type { PageData } from "./$types";
  import latex from "$lib/latex";

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  interface Property {
    header: string;
    fn: (n: number) => string;
  }

  const properties: Property[] = [
    {
      header: "Is it even/odd?",
      fn(n) {
        return n % 2 === 0 ? "Even" : "Odd";
      }
    },
    {
      header: "Is it prime?",
      fn(n) {
        for (let i = 2, s = Math.sqrt(n); i <= s; i++) {
          if (n % i === 0) return "No";
        }
        return n > 1 ? "Yes" : "No";
      }
    },
    {
      header: "What is its prime factorisation?",
      fn(n) {
        let a = n;
        const factors: number[] = [];
        while (a >= 2) {
          for (let i = 2; i <= a; i++) {
            if (a % i === 0) {
              a = a / i;
              factors.push(i);
              break;
            }
          }
        }
        let str = "";
        let currentFactor = factors[0];
        let currentFactorTimes = 1;
        for (let i = 1; i <= factors.length; i++) {
          if (factors[i] === currentFactor) {
            currentFactorTimes++;
          } else {
            if (currentFactorTimes === 1) {
              str += `{${currentFactor}} \\times`;
            } else {
              str += `{${currentFactor}}^{${currentFactorTimes}} \\times`;
            }
            currentFactor = factors[i];
            currentFactorTimes = 1;
          }
        }
        if (currentFactor && currentFactorTimes === 1) {
          str += `${currentFactor}`;
        } else if (currentFactor && currentFactorTimes > 1) {
          str += `${currentFactor}^${currentFactorTimes}`;
        }

        let toReturn = str.trim();
        if (toReturn.endsWith("\\times")) toReturn = toReturn.substring(0, toReturn.length - 6);
        return latex(toReturn);
      }
    },
    {
      header: "What are its factors?",
      fn(n) {
        const factors: number[] = [];
        for (let i = 1; i <= n; i++) {
          if (n % i === 0) factors.push(i);
        }
        return factors.join(", ");
      }
    },
    {
      header: "Is it triangular?",
      fn(n) {
        return Math.sqrt(8 * n + 1) % 1 === 0 ? "Yes" : "No";
      }
    },
    {
      header: "Is it a perfect square?",
      fn(n) {
        return Math.sqrt(n) % 1 === 0 ? "Yes" : "No";
      }
    },
    {
      header: "Is it a perfect cube?",
      fn(n) {
        return Math.cbrt(n) % 1 === 0 ? "Yes" : "No";
      }
    },
    {
      header: "Is it a Fibonacci number?",
      fn(n) {
        return Math.sqrt(5 * n * n + 4) % 1 === 0 || Math.sqrt(5 * n * n - 4) % 1 === 0 ? "Yes" : "No";
      }
    },
    {
      header: "Is it a perfect number?",
      fn(n) {
        let factorSum = 0;
        for (let i = 1; i < n; i++) {
          if (n % i === 0) factorSum += i;
        }
        return factorSum === n ? "Yes" : "No";
      }
    },
    {
      header: "Is it palindromic?",
      fn(n) {
        return n.toString().split("").reverse().join("") === n.toString() ? "Yes" : "No";
      }
    },
    {
      header: "Is it a happy number?",
      fn(n) {
        function squareDigits(inp: number) {
          return inp
            .toString()
            .split("")
            .map(Number)
            .map((x) => x * x)
            .reduce((a, b) => a + b);
        }
        let previous = new Set();
        let currentValue = n;
        while (true) {
          currentValue = squareDigits(currentValue);
          if (currentValue === 1) return "Yes";
          if (previous.has(currentValue)) return "No";
          previous.add(currentValue);
        }
      }
    },
    {
      header: `What is its Collatz Conjecture (${latex("3n+1")}) number?`,
      fn(n) {
        let current = n;
        let steps = 0;
        while (true) {
          if (current === 1) return steps.toString();
          if (current % 2 === 0) current = current / 2;
          else current = 3 * current + 1;

          steps++;
          if (steps > 1500) return "Steps greater than 1500";
        }
      }
    }
  ];
</script>

<div class="py-12">
  <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
    <div class="text-center">
      <div
        class="mx-auto flex h-20 w-fit min-w-20 items-center justify-center rounded-2xl bg-primary/10 px-4 text-primary"
      >
        <span class="text-3xl font-bold tabular-nums">{data.n}</span>
      </div>
      <p class="mt-4 text-sm text-muted-foreground">Number properties</p>
    </div>

    <div class="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each properties as property}
        <div class="rounded-xl border border-border/60 bg-card p-5 shadow-sm transition-all hover:shadow-md">
          <span class="text-sm font-medium text-primary">{@html property.header}</span>
          <p class="mt-2 text-sm text-muted-foreground">{@html property.fn(data.n)}</p>
        </div>
      {/each}
    </div>
  </div>
</div>
