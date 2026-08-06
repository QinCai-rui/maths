<script lang="ts">
  import { Header } from "$lib/components/ui/header/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Confetti } from "svelte-confetti";
  import { Info, RefreshCw } from "@lucide/svelte/icons";

  type ColourOfCell = "grey" | "yellow" | "green" | "empty";

  type Cell =
    | {
        type: "empty";
        content: null;
      }
    | {
        type: Exclude<ColourOfCell, "empty">;
        content: string;
      };

  type Board = Cell[][];

  let guess = $state("");
  let guesses = $state(0);
  let won = $state(false);
  let lost = $state(false);
  let showConfetti = $state(false);

  let board: Board = $state(
    Array(6)
      .fill(null)
      .map(() =>
        Array(5)
          .fill(null)
          .map(() => ({ type: "empty", content: null }))
      )
  );

  const target = Math.floor(Math.random() * 100000)
    .toString()
    .padStart(5, "0");

  const wordToMap = (word: string) => {
    let map: { [letter: string]: number } = {};
    for (const letter of word.trim()) {
      map[letter] = (map?.[letter] || 0) + 1;
    }
    return map;
  };

  const submit = () => {
    if (guess.length !== 5 || won || lost) return;
    board[guesses] = board[guesses].map((_, i) => {
      let type: "grey" | "yellow" | "green" = "grey";
      if (guess[i] === target[i]) {
        type = "green";
      } else {
        let targetMap = wordToMap(target);
        let noLetters = targetMap[guess[i]] || 0;
        if (noLetters > 0) {
          for (let a = 0; a < i; a++) {
            if (target[a] === guess[a] && guess[a] === guess[i]) noLetters--;
          }
          if (noLetters > 0) type = "yellow";
        }
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

  const reset = () => location.reload();

  const keys = [["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]];
</script>

{#if showConfetti}
  <div class="fixed top-[-50px] left-0 h-screen w-screen flex justify-center overflow-hidden pointer-events-none">
    <Confetti x={[-5, 5]} y={[0, 0.1]} delay={[500, 2000]} infinite duration={4000} amount={400} fallDistance="100vh" />
  </div>
{/if}

<div class="py-12">
  <div class="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8">
    <div class="text-center">
      <Header size="h1">Digitle</Header>
      <p class="mt-2 text-lg text-muted-foreground">Inspired by Hooda Math</p>
    </div>

    <div class="mt-8 rounded-xl border border-border/60 bg-card p-6 shadow-sm">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <Info class="h-4 w-4" />
          Guess the 5-digit number in 6 tries
        </div>
        <Button variant="ghost" size="sm" class="gap-1" onclick={reset}>
          <RefreshCw class="h-4 w-4" />
          Reset
        </Button>
      </div>

      <div class="mt-6 flex flex-col items-center">
        <div class="flex flex-col gap-2">
          {#each board as row, i}
            <div class="flex flex-row gap-2">
              {#each row as cell, j}
                <div
                  class={`flex h-14 w-14 items-center justify-center rounded-lg text-lg font-bold transition-all duration-300 ${cell.type === "green" ? "bg-emerald-500 text-white scale-105" : cell.type === "yellow" ? "bg-amber-400 text-white" : cell.type === "grey" ? "bg-slate-400 text-white" : "border-2 border-dashed border-border text-transparent"} ${i < guesses ? "animate-pop" : ""}`}
                >
                  {cell.content ?? ""}
                </div>
              {/each}
            </div>
          {/each}
        </div>

        <div class="mt-6 flex w-full max-w-sm items-center gap-2">
          <Input
            type="text"
            inputmode="numeric"
            maxlength={5}
            value={guess}
            disabled={won || lost}
            onkeydown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key.length === 1 && !/\d/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault();
            }}
            oninput={(e) => {
              guess = (e.currentTarget as HTMLInputElement).value.replace(/\D/g, "").slice(0, 5);
            }}
            class="text-center text-lg tracking-widest"
            placeholder="_____"
          />
          <Button onclick={submit} disabled={won || lost || guess.length !== 5}>Guess</Button>
        </div>

        <div class="mt-6 grid w-full max-w-sm grid-cols-5 gap-2">
          {#each keys[0] as key}
            <button
              onclick={() => {
                if (won || lost || guess.length >= 5) return;
                guess += key;
              }}
              disabled={won || lost}
              class="flex h-12 items-center justify-center rounded-lg border border-border bg-background text-lg font-medium transition-colors hover:bg-accent disabled:opacity-50"
            >
              {key}
            </button>
          {/each}
        </div>

        {#if won}
          <div class="mt-6 rounded-lg bg-emerald-50 p-4 text-center dark:bg-emerald-950/30">
            <p class="text-lg font-semibold text-emerald-700 dark:text-emerald-400">You won in {guesses} attempts!</p>
            <Button onclick={reset} class="mt-3 gap-2">
              <RefreshCw class="h-4 w-4" />
              Play Again
            </Button>
          </div>
        {:else if lost}
          <div class="mt-6 rounded-lg bg-red-50 p-4 text-center dark:bg-red-950/30">
            <p class="text-lg font-semibold text-red-700 dark:text-red-400">You lost! The answer was {target}</p>
            <Button onclick={reset} class="mt-3 gap-2">
              <RefreshCw class="h-4 w-4" />
              Try Again
            </Button>
          </div>
        {/if}
      </div>
    </div>

    <div class="mt-10 rounded-xl border border-border/60 bg-card p-6 shadow-sm">
      <Header size="h3">How to play</Header>
      <div class="mt-4 space-y-3 text-sm text-muted-foreground">
        <p>
          This game is similar to the popular word game Wordle. In this game, rather than using the alphabet to
          construct words, you use the digits 0-9 to find the missing number.
        </p>
        <p>First, you have to place a guess and submit it. Then, a row of digits will appear.</p>
        <ul class="list-inside list-disc space-y-1">
          <li>
            If a digit is <span class="font-semibold text-emerald-600 dark:text-emerald-400">green</span>, the target
            number has a digit in the same place with the same value.
          </li>
          <li>
            If a digit is <span class="font-semibold text-amber-600 dark:text-amber-400">yellow</span>, then the target
            number has a digit with the same value, but in a different place.
          </li>
          <li>Otherwise, the digit does not appear in the target number.</li>
        </ul>
        <p>If you have any suggestions, you can give us feedback on our GitHub repository by creating an issue.</p>
      </div>
    </div>
  </div>
</div>

<style>
  @keyframes pop {
    0% {
      transform: scale(0.8);
      opacity: 0.5;
    }
    50% {
      transform: scale(1.05);
    }
    100% {
      transform: scale(1);
      opacity: 1;
    }
  }
  .animate-pop {
    animation: pop 0.3s ease-out forwards;
  }
</style>
