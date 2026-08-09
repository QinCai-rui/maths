<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { ArrowRight, Brain, RefreshCw } from "@lucide/svelte/icons";

  type Sequence = { values: number[]; answer: number; formula: string; choices: number[]; tier: string };
  type Pattern = Omit<Sequence, "choices"> & { gap: number };

  const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
  const pick = <T>(items: T[]) => items[randomInt(0, items.length - 1)];

  const alternatingDifferences = (): Pattern => {
    const start = randomInt(2, 13), firstStep = randomInt(2, 8), secondStep = randomInt(2, 8);
    const values = [start];
    for (let i = 1; i < 4; i++) values.push(values[i - 1] + (i % 2 ? firstStep : secondStep));
    return { values, answer: values[3] + secondStep, formula: `Add ${firstStep}, then ${secondStep}, alternately`, tier: "Alternating differences", gap: Math.abs(secondStep - firstStep) + firstStep };
  };

  const multiplyAndAdd = (): Pattern => {
    const start = randomInt(2, 13), multiplier = pick([2, 3]), addition = randomInt(1, 6), values = [start];
    while (values.length < 4) values.push(values[values.length - 1] * multiplier + addition);
    return { values, answer: values[3] * multiplier + addition, formula: `aₙ = ${multiplier}aₙ₋₁ + ${addition}`, tier: "Multiply-and-add patterns", gap: Math.max(addition + multiplier, 4) };
  };

  const geometric = (): Pattern => {
    const start = randomInt(2, 10), multiplier = pick([2, 3, 4]), values = Array.from({ length: 4 }, (_, i) => start * multiplier ** i);
    return { values, answer: start * multiplier ** 4, formula: `aₙ = ${start} × ${multiplier}ⁿ⁻¹`, tier: "Geometric patterns", gap: start * multiplier };
  };

  const recursive = (): Pattern => {
    const values = [randomInt(1, 8), randomInt(2, 9)];
    while (values.length < 4) values.push(values[values.length - 1] + values[values.length - 2]);
    return { values, answer: values[2] + values[3], formula: "aₙ = aₙ₋₁ + aₙ₋₂", tier: "Recursive patterns", gap: Math.max(values[0], values[1]) };
  };

  const quadratic = (advanced = false): Pattern => {
    const coefficient = randomInt(1, advanced ? 4 : 3), linear = randomInt(1, advanced ? 7 : 5), offset = randomInt(1, 15);
    const valueAt = (n: number) => coefficient * n ** 2 + linear * n + offset;
    return { values: Array.from({ length: 4 }, (_, i) => valueAt(i + 1)), answer: valueAt(5), formula: `aₙ = ${coefficient}n² + ${linear}n + ${offset}`, tier: advanced ? "Advanced quadratic patterns" : "Quadratic patterns", gap: coefficient * 9 + linear };
  };

  const triangular = (): Pattern => {
    const offset = randomInt(1, 15), valueAt = (n: number) => (n * (n + 1)) / 2 + offset;
    return { values: Array.from({ length: 4 }, (_, i) => valueAt(i + 1)), answer: valueAt(5), formula: `aₙ = n(n + 1) / 2 + ${offset}`, tier: "Triangular patterns", gap: 5 };
  };

  const patternTiers: (() => Pattern)[][] = [
    [alternatingDifferences, multiplyAndAdd],
    [geometric, recursive],
    [quadratic, triangular],
    [() => quadratic(true), triangular]
  ];

  const makeSequence = (solved: number): Sequence => {
    const tier = solved < 3 ? 0 : solved < 6 ? 1 : solved < 10 ? 2 : 3;
    const { gap, ...pattern } = pick(patternTiers[tier])();
    return { ...pattern, choices: [pattern.answer, pattern.answer + gap, Math.max(1, pattern.answer - gap), pattern.answer + gap * 2].sort(() => Math.random() - 0.5) };
  };

  let sequence = $state(makeSequence(0));
  let score = $state(0);
  let selected = $state<number | null>(null);
  let outcome = $state<"correct" | "incorrect" | null>(null);

  const choose = (value: number) => {
    if (outcome) return;
    selected = value;
    if (value === sequence.answer) {
      score++;
      outcome = "correct";
    } else outcome = "incorrect";
  };
  const next = () => { sequence = makeSequence(score); selected = null; outcome = null; };
</script>

<div class="mathex-shell min-h-full py-8 sm:py-12">
  <div class="mx-auto max-w-3xl px-4 sm:px-6">
    <header class="text-center">
      <div class="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/75 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-primary"><Brain class="h-3.5 w-3.5" /> Pattern practice</div>
      <h1 class="mt-5 text-5xl font-bold tracking-[-0.06em] sm:text-6xl">Sequencing<span class="text-primary">.</span></h1>
      <p class="mt-3 text-muted-foreground sm:text-lg">Spot the pattern and find the next number.</p>
    </header>

    <main class="mathex-panel mx-auto mt-8 max-w-xl rounded-3xl p-5 sm:p-8">
      <div class="flex items-center justify-between"><div><p class="mathex-kicker">Solved</p><p class="mt-1 text-2xl font-bold tabular-nums">{score}</p></div><Button variant="ghost" size="sm" class="gap-1.5" onclick={next}><RefreshCw class="h-3.5 w-3.5" /> New sequence</Button></div>
      <p class="mt-6 text-center text-sm font-semibold text-primary">{sequence.tier}</p>
      <div class="mt-10 flex items-center justify-center gap-2 text-xl font-bold tabular-nums sm:gap-4 sm:text-3xl">
        {#each sequence.values as value}<span class="rounded-xl bg-primary/8 px-3 py-2 text-primary sm:px-4">{value}</span><ArrowRight class="h-4 w-4 text-muted-foreground" />{/each}<span class="rounded-xl border-2 border-dashed border-primary/40 px-3 py-2 sm:px-4">?</span>
      </div>
      <div class="mt-10 grid grid-cols-2 gap-3">
        {#each sequence.choices as choice}
          <button onclick={() => choose(choice)} disabled={outcome !== null} class={`rounded-xl border p-4 text-xl font-bold tabular-nums transition-colors disabled:cursor-not-allowed ${choice === selected ? choice === sequence.answer ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "border-destructive bg-destructive/10 text-destructive" : "border-border bg-background hover:border-primary/50 hover:bg-primary/5"}`}>{choice}</button>
        {/each}
      </div>
      {#if outcome === "correct"}
        <div class="mt-6 rounded-2xl bg-emerald-500/10 p-4 text-center"><p class="font-semibold text-emerald-700 dark:text-emerald-400">Exactly right.</p><p class="mt-2 font-mono text-sm font-semibold text-foreground">{sequence.formula}</p><Button onclick={next} size="sm" class="mt-3">Next sequence</Button></div>
      {:else if outcome === "incorrect"}
        <div class="mt-6 rounded-2xl bg-destructive/10 p-4 text-center"><p class="font-semibold text-destructive">Not this time.</p><p class="mt-2 text-sm font-medium text-foreground">The next number is {sequence.answer}.</p><p class="mt-1 font-mono text-sm font-semibold text-foreground">{sequence.formula}</p><Button onclick={next} size="sm" variant="outline" class="mt-3">Try a new sequence</Button></div>
      {:else}
        <p class="mt-5 text-center text-sm text-muted-foreground">One answer per sequence. Correct answers unlock harder patterns.</p>
      {/if}
    </main>
  </div>
</div>
