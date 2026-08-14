<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Confetti } from "svelte-confetti";
  import { Delete, Info, RefreshCw, Target, Trophy } from "@lucide/svelte/icons";

  type ColourOfCell = "grey" | "yellow" | "green" | "empty";

  type Cell = { type: "empty"; content: null } | { type: Exclude<ColourOfCell, "empty">; content: string };

  type Board = Cell[][];

  const createBoard = (): Board =>
    Array.from({ length: 6 }, () => Array.from({ length: 5 }, () => ({ type: "empty", content: null })));
  const createTarget = () =>
    Math.floor(Math.random() * 100000)
      .toString()
      .padStart(5, "0");

  let guess = $state("");
  let guesses = $state(0);
  let won = $state(false);
  let lost = $state(false);
  let showConfetti = $state(false);
  let board: Board = $state(createBoard());
  let target = $state(createTarget());

  const wordToMap = (word: string) => {
    const map: Record<string, number> = {};
    for (const letter of word.trim()) map[letter] = (map[letter] || 0) + 1;
    return map;
  };

  const submit = () => {
    if (guess.length !== 5 || won || lost) return;

    board[guesses] = board[guesses].map((_, i) => {
      let type: Exclude<ColourOfCell, "empty"> = "grey";
      if (guess[i] === target[i]) {
        type = "green";
      } else {
        let remaining = wordToMap(target)[guess[i]] || 0;
        for (let a = 0; a < i; a++) {
          if (target[a] === guess[a] && guess[a] === guess[i]) remaining--;
        }
        if (remaining > 0) type = "yellow";
      }
      return { content: guess[i], type };
    });

    guesses++;
    if (guess === target) {
      won = true;
      showConfetti = true;
      setTimeout(() => (showConfetti = false), 5000);
    } else if (guesses >= 6) {
      lost = true;
    }
    guess = "";
  };

  const reset = () => {
    guess = "";
    guesses = 0;
    won = false;
    lost = false;
    showConfetti = false;
    board = createBoard();
    target = createTarget();
  };

  const addDigit = (digit: string) => {
    if (!won && !lost && guess.length < 5) guess += digit;
  };

  const keyStatus = (digit: string): ColourOfCell => {
    let status: ColourOfCell = "empty";
    for (const row of board) {
      for (const cell of row) {
        if (cell.content !== digit) continue;
        if (cell.type === "green") return "green";
        if (cell.type === "yellow") status = "yellow";
        else if (cell.type === "grey" && status === "empty") status = "grey";
      }
    }
    return status;
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
</script>

{#if showConfetti}
  <div class="pointer-events-none fixed left-0 top-[-50px] z-50 flex h-screen w-screen justify-center overflow-hidden">
    <Confetti x={[-5, 5]} y={[0, 0.1]} delay={[500, 2000]} infinite duration={4000} amount={400} fallDistance="100vh" />
  </div>
{/if}

<div class="mathex-shell relative isolate min-h-full overflow-hidden py-8 sm:py-12">
  <div class="mathex-grid pointer-events-none absolute inset-x-0 top-0 h-[32rem] opacity-65"></div>
  <div class="pointer-events-none absolute -left-24 top-40 h-72 w-72 rounded-full bg-primary/10 blur-3xl"></div>

  <div class="relative mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
    <header class="mx-auto max-w-xl text-center">
      <div
        class="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/75 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-primary backdrop-blur-sm"
      >
        <Target class="h-3.5 w-3.5" /> Daily number puzzle
      </div>
      <h1 class="mt-5 text-5xl font-bold tracking-[-0.06em] sm:text-6xl">Digitle<span class="text-primary">.</span></h1>
      <p class="mt-3 text-base text-muted-foreground sm:text-lg">Find the five-digit number in six moves.</p>
    </header>

    <div class="mx-auto mt-8 grid max-w-4xl gap-5 lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-start">
      <section class="mathex-panel rounded-3xl p-4 sm:p-6" aria-label="Digitle game board">
        <div class="flex items-center justify-between border-b border-border/70 pb-4">
          <div>
            <p class="mathex-kicker">Current round</p>
            <p class="mt-1 text-sm font-medium">Attempt {Math.min(guesses + 1, 6)} of 6</p>
          </div>
          <Button variant="ghost" size="sm" class="gap-1.5 text-muted-foreground" onclick={reset}>
            <RefreshCw class="h-3.5 w-3.5" /> New number
          </Button>
        </div>

        <div class="mx-auto mt-6 flex max-w-[25rem] flex-col gap-2 sm:gap-2.5">
          {#each board as row, i}
            <div class="grid grid-cols-5 gap-2 sm:gap-2.5">
              {#each row as cell}
                <div
                  class={`flex aspect-square items-center justify-center rounded-xl text-xl font-bold tabular-nums transition-all duration-300 sm:text-2xl ${cell.type === "green" ? "scale-[1.03] bg-emerald-500 text-white shadow-md shadow-emerald-500/20" : cell.type === "yellow" ? "bg-amber-400 text-white shadow-md shadow-amber-400/20" : cell.type === "grey" ? "bg-muted-foreground/70 text-white" : i === guesses && !won && !lost ? "border-2 border-primary/40 bg-primary/5 text-foreground" : "border border-border/70 bg-background/45 text-transparent"} ${i < guesses ? "animate-pop" : ""}`}
                >
                  {cell.content ?? ""}
                </div>
              {/each}
            </div>
          {/each}
        </div>

        {#if won || lost}
          <div
            class={`mt-6 rounded-2xl border p-4 text-center ${won ? "border-emerald-500/25 bg-emerald-500/10" : "border-destructive/25 bg-destructive/10"}`}
          >
            {#if won}
              <Trophy class="mx-auto h-6 w-6 text-emerald-600 dark:text-emerald-400" />
              <p class="mt-2 text-lg font-semibold text-emerald-700 dark:text-emerald-400">
                Solved in {guesses}
                {guesses === 1 ? "move" : "moves"}.
              </p>
            {:else}
              <p class="text-sm font-medium text-destructive">The number was</p>
              <p class="mt-1 font-mono text-2xl font-bold tracking-[0.2em] text-foreground">{target}</p>
            {/if}
            <Button onclick={reset} size="sm" class="mt-3 gap-1.5"><RefreshCw class="h-3.5 w-3.5" /> Play again</Button>
          </div>
        {/if}
      </section>

      <aside class="space-y-5">
        <section class="mathex-panel rounded-3xl p-5">
          <p class="mathex-kicker">Make your guess</p>
          <div class="mt-4 flex gap-2">
            <Input
              aria-label="Five-digit guess"
              type="text"
              inputmode="numeric"
              maxlength={5}
              value={guess}
              disabled={won || lost}
              onkeydown={(event) => {
                if (event.key === "Enter") submit();
                if (
                  event.key.length === 1 &&
                  !/\d/.test(event.key) &&
                  !event.ctrlKey &&
                  !event.metaKey &&
                  !event.altKey
                )
                  event.preventDefault();
              }}
              oninput={(event) =>
                (guess = (event.currentTarget as HTMLInputElement).value.replace(/\D/g, "").slice(0, 5))}
              class="h-11 text-center font-mono text-lg font-bold tracking-[0.28em]"
              placeholder="00000"
            />
            <Button onclick={submit} disabled={won || lost || guess.length !== 5} class="h-11 px-4">Go</Button>
          </div>
          <div class="mt-3 flex justify-between text-xs text-muted-foreground">
            <span>Five digits only</span><span>{guess.length}/5</span>
          </div>

          <div class="mt-5 grid grid-cols-5 gap-2">
            {#each keys as key}
              {@const status = keyStatus(key)}
              <button
                onclick={() => addDigit(key)}
                disabled={won || lost}
                class={`flex h-10 items-center justify-center rounded-lg border text-sm font-bold tabular-nums transition-all hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 ${status === "green" ? "border-emerald-500 bg-emerald-500 text-white" : status === "yellow" ? "border-amber-400 bg-amber-400 text-white" : status === "grey" ? "border-muted-foreground/60 bg-muted-foreground/70 text-white" : "border-border bg-background hover:border-primary/40 hover:bg-primary/5"}`}
                >{key}</button
              >
            {/each}
          </div>
          <button
            onclick={() => (guess = guess.slice(0, -1))}
            disabled={won || lost || !guess}
            class="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <Delete class="h-3.5 w-3.5" /> Remove last digit
          </button>
        </section>

        <section class="rounded-3xl border border-border/70 bg-card/60 p-5 text-sm backdrop-blur-sm">
          <div class="flex items-center gap-2 font-semibold"><Info class="h-4 w-4 text-primary" /> Read the board</div>
          <div class="mt-4 space-y-3 text-muted-foreground">
            <p class="flex gap-2">
              <span class="mt-0.5 h-3 w-3 shrink-0 rounded bg-emerald-500"></span>Right digit, right position.
            </p>
            <p class="flex gap-2">
              <span class="mt-0.5 h-3 w-3 shrink-0 rounded bg-amber-400"></span>Right digit, wrong position.
            </p>
            <p class="flex gap-2">
              <span class="mt-0.5 h-3 w-3 shrink-0 rounded bg-muted-foreground/70"></span>That digit is not present.
            </p>
          </div>
        </section>
      </aside>
    </div>
  </div>
</div>

<style>
  @keyframes pop {
    0% {
      transform: scale(0.82);
      opacity: 0.35;
    }
    60% {
      transform: scale(1.06);
    }
    100% {
      transform: scale(1);
      opacity: 1;
    }
  }

  .animate-pop {
    animation: pop 0.32s ease-out forwards;
  }
</style>
