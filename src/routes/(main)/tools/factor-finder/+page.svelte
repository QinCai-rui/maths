<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Check, CircleDot, RefreshCw } from "@lucide/svelte/icons";

  const targets = [12, 18, 20, 24, 30, 36, 40, 42, 48, 54, 56, 60, 72, 84, 90];
  const newTarget = () => targets[Math.floor(Math.random() * targets.length)];
  const optionsFor = (target: number) => Array.from({ length: 12 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);

  const initialTarget = newTarget();
  let target = $state(initialTarget);
  let options = $state(optionsFor(initialTarget));
  let chosen = $state<number[]>([]);
  let score = $state(0);
  let complete = $state(false);
  let message = $state("");
  let totalFactors = $derived(options.filter((value) => target % value === 0).length);

  const toggle = (value: number) => {
    if (complete) return;
    chosen = chosen.includes(value) ? chosen.filter((item) => item !== value) : [...chosen, value];
    message = "";
  };
  const check = () => {
    const correct = options.filter((value) => target % value === 0);
    if (chosen.length === correct.length && correct.every((value) => chosen.includes(value))) { score++; complete = true; message = "All factors found!"; }
    else message = "Not quite. A factor divides the target with no remainder.";
  };
  const next = () => { target = newTarget(); options = optionsFor(target); chosen = []; complete = false; message = ""; };
</script>

<div class="mathex-shell min-h-full py-8 sm:py-12">
  <div class="mx-auto max-w-3xl px-4 sm:px-6">
    <header class="text-center">
      <div class="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/75 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-primary"><CircleDot class="h-3.5 w-3.5" /> Divisibility game</div>
      <h1 class="mt-5 text-5xl font-bold tracking-[-0.06em] sm:text-6xl">Factor Finder<span class="text-primary">.</span></h1>
      <p class="mt-3 text-muted-foreground sm:text-lg">Select every number from 1 to 12 that divides the target.</p>
    </header>

    <main class="mathex-panel mx-auto mt-8 max-w-xl rounded-3xl p-5 sm:p-8">
      <div class="flex items-center justify-between"><div><p class="mathex-kicker">Rounds cleared</p><p class="mt-1 text-2xl font-bold tabular-nums">{score}</p></div><Button variant="ghost" size="sm" class="gap-1.5" onclick={next}><RefreshCw class="h-3.5 w-3.5" /> New target</Button></div>
      <div class="mt-8 rounded-2xl bg-primary/8 py-6 text-center"><p class="mathex-kicker">Find factors of</p><p class="mt-1 text-6xl font-bold tabular-nums text-primary">{target}</p></div>
      <div class="mt-7 grid grid-cols-4 gap-3 sm:grid-cols-6">
        {#each options as value}<button onclick={() => toggle(value)} disabled={complete} class={`aspect-square rounded-xl border text-lg font-bold tabular-nums transition-all ${chosen.includes(value) ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border bg-background hover:border-primary/50 hover:bg-primary/5"}`}>{value}</button>{/each}
      </div>
      <div class="mt-7 text-center"><Button onclick={check} disabled={complete || chosen.length === 0} class="gap-2"><Check class="h-4 w-4" /> Check factors</Button><p class={`mt-3 min-h-5 text-sm font-medium ${complete ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>{message}</p>{#if complete}<p class="text-xs text-muted-foreground">There were {totalFactors} factors in the grid.</p><Button onclick={next} size="sm" variant="outline" class="mt-4">Next target</Button>{/if}</div>
    </main>
  </div>
</div>
