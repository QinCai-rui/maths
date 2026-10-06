<script lang="ts">
  import type { PageData } from "./$types";
  import { getNumberFacts } from "#lib/number-facts.js";

  interface Props {
    data: PageData;
  }
  let { data }: Props = $props();

  const facts = $derived(getNumberFacts(data.n));
  const properties = $derived([
    { label: "Even or odd", value: facts.isEven ? "Even" : "Odd" },
    { label: "Prime number", value: facts.isPrime ? "Yes" : "No" },
    { label: "Prime factorisation", value: facts.primeFactorisation },
    { label: "Factors", value: facts.factors.join(", ") },
    { label: "Triangular number", value: facts.isTriangular ? "Yes" : "No" },
    { label: "Perfect square", value: facts.isSquare ? "Yes" : "No" },
    { label: "Perfect cube", value: facts.isCube ? "Yes" : "No" },
    { label: "Fibonacci number", value: facts.isFibonacci ? "Yes" : "No" },
    { label: "Perfect number", value: facts.isPerfect ? "Yes" : "No" },
    { label: "Palindrome", value: facts.isPalindrome ? "Yes" : "No" },
    { label: "Happy number", value: facts.isHappy ? "Yes" : "No" },
    { label: "Collatz steps to 1", value: facts.collatzSteps === null ? "More than 1,500" : `${facts.collatzSteps}` }
  ]);
</script>

<svelte:head>
  <title>Facts about {data.n} — Raymont's Maths</title>
</svelte:head>

<main class="site-wrap site-page">
  <p class="site-eyebrow">Number facts</p>
  <h1 class="site-page-title">A closer look at</h1>
  <p class="site-result-number">{data.n}</p>
  <p class="site-page-intro">Here are some patterns and properties this number has.</p>

  <dl class="site-results mt-8">
    {#each properties as property}
      <div class="site-result">
        <dt><h2>{property.label}</h2></dt>
        <dd><p>{property.value}</p></dd>
      </div>
    {/each}
  </dl>
  <p class="mt-6 text-sm text-muted-foreground">
    <a class="underline underline-offset-4" href="/utilities/number">Look up another number</a>
  </p>
</main>
