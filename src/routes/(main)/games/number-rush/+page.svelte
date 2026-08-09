<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Progress } from "$lib/components/ui/progress";
  import { RefreshCw, Timer, Zap } from "@lucide/svelte/icons";
  import { onDestroy, tick } from "svelte";

  type Question = { text: string; answer: number; level: number; label: string };

  const makeQuestionForLevel = (level: number): Question => {
    if (level === 1) {
      const left = Math.floor(Math.random() * 12) + 1;
      const right = Math.floor(Math.random() * 12) + 1;
      const addition = Math.random() > 0.5;
      const [first, second] = addition ? [left, right] : [Math.max(left, right), Math.min(left, right)];
      return { text: `${first} ${addition ? "+" : "-"} ${second}`, answer: addition ? first + second : first - second, level: 1, label: "Arithmetic" };
    }
    if (level === 2) {
      const left = Math.floor(Math.random() * 10) + 2;
      const right = Math.floor(Math.random() * 10) + 2;
      if (Math.random() > 0.5) return { text: `${left} x ${right}`, answer: left * right, level: 2, label: "Multiplication and division" };
      return { text: `${left * right} ÷ ${right}`, answer: left, level: 2, label: "Multiplication and division" };
    }
    if (level === 3) {
      if (Math.random() > 0.5) {
        const base = Math.floor(Math.random() * 9) + 2;
        const exponent = Math.random() > 0.5 ? 2 : 3;
        return { text: `${base}${exponent === 2 ? "²" : "³"}`, answer: base ** exponent, level: 3, label: "Powers and roots" };
      }
      const root = Math.floor(Math.random() * 11) + 2;
      return { text: `√${root * root}`, answer: root, level: 3, label: "Powers and roots" };
    }
    const left = Math.floor(Math.random() * 12) + 2;
    const right = Math.floor(Math.random() * 12) + 2;
    const multiplier = Math.floor(Math.random() * 6) + 2;
    return { text: `(${left} + ${right}) x ${multiplier}`, answer: (left + right) * multiplier, level: 4, label: "Brackets" };
  };

  const makeQuestion = (level: number): Question => {
    // Include occasional earlier questions to keep all learned facts active.
    const questionLevel = level > 1 && Math.random() < 0.12 ? Math.floor(Math.random() * (level - 1)) + 1 : level;
    return makeQuestionForLevel(questionLevel);
  };

  let question = $state(makeQuestion(1));
  let input = $state("");
  let score = $state(0);
  let streak = $state(0);
  let questionsAnswered = $state(0);
  let level = $state(1);
  let correctAtLevel = $state(0);
  let seconds = $state(60);
  let questionElapsed = $state(0);
  let questionStartedAt = $state(0);
  let playing = $state(false);
  let result = $state<"correct" | "wrong" | null>(null);
  let interval: ReturnType<typeof setInterval> | undefined;
  let answerInput: HTMLInputElement | undefined;

  const stop = () => {
    playing = false;
    if (interval) clearInterval(interval);
  };

  const start = () => {
    if (interval) clearInterval(interval);
    question = makeQuestion(1);
    input = "";
    score = 0;
    streak = 0;
    questionsAnswered = 0;
    level = 1;
    correctAtLevel = 0;
    seconds = 60;
    questionElapsed = 0;
    questionStartedAt = performance.now();
    result = null;
    playing = true;
    void tick().then(() => answerInput?.focus());
    interval = setInterval(() => {
      if (seconds <= 1) {
        seconds = 0;
        stop();
      } else {
        seconds--;
        questionElapsed++;
      }
    }, 1000);
  };

  const submit = () => {
    if (!playing || !input) return;
    const timeTaken = (performance.now() - questionStartedAt) / 1000;
    if (Number(input) === question.answer) {
      streak++;
      score += Math.max(1, Math.round(20 / (1 + timeTaken))) * question.level;
      correctAtLevel++;
      if (correctAtLevel >= 10 && level < 4) {
        level++;
        correctAtLevel = 0;
      }
      result = "correct";
    } else {
      streak = 0;
      level = Math.max(1, level - 1);
      correctAtLevel = 0;
      result = "wrong";
    }
    questionsAnswered++;
    question = makeQuestion(level);
    input = "";
    questionElapsed = 0;
    questionStartedAt = performance.now();
    setTimeout(() => (result = null), 350);
  };

  onDestroy(() => interval && clearInterval(interval));
</script>

<svelte:window onkeydown={(event) => event.key === "Enter" && submit()} />

<div class="mathex-shell min-h-full py-8 sm:py-12">
  <div class="mx-auto max-w-3xl px-4 sm:px-6">
    <header class="text-center">
      <div class="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/75 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-primary"><Zap class="h-3.5 w-3.5" /> Timed arithmetic</div>
      <h1 class="mt-5 text-5xl font-bold tracking-[-0.06em] sm:text-6xl">Basic Facts<span class="text-primary">.</span></h1>
      <p class="mt-3 text-muted-foreground sm:text-lg">Race through essential number facts before the clock runs out.</p>
    </header>

    <main class="mathex-panel mx-auto mt-8 max-w-xl rounded-3xl p-5 sm:p-8">
      <div class="grid grid-cols-3 gap-3 text-center">
        <div><p class="mathex-kicker">Time</p><p class="mt-1 text-2xl font-bold tabular-nums">{seconds}s</p></div>
        <div><p class="mathex-kicker">Score</p><p class="mt-1 text-2xl font-bold tabular-nums">{score}</p></div>
        <div><p class="mathex-kicker">Streak</p><p class="mt-1 text-2xl font-bold tabular-nums">{streak}</p></div>
      </div>
      <div class="mt-5 flex items-center justify-between gap-4 border-t border-border/60 pt-4 text-xs" aria-label={`Level ${level}: ${question.label}. ${correctAtLevel} of 10 correct answers toward the next level.`}>
        <p class="font-semibold text-muted-foreground">Level {level} <span class="font-normal">· {question.label}</span></p>
        <div class="flex items-center gap-2"><Progress value={correctAtLevel} max={10} class="h-1 w-16" /><span class="tabular-nums text-muted-foreground">{correctAtLevel}/10</span></div>
      </div>

      {#if playing}
        <div class="mt-10 text-center" aria-live="polite">
          <p class="mathex-kicker">Level {level} · {question.label} · {correctAtLevel}/10 to advance</p>
          <p class="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">{question.text} = ?</p>
          <form class="mx-auto mt-8 flex max-w-sm gap-2" onsubmit={(event) => { event.preventDefault(); submit(); }}>
            <input bind:this={answerInput} bind:value={input} inputmode="numeric" aria-label="Your answer" class="h-12 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-center text-xl font-bold tabular-nums outline-none focus:ring-2 focus:ring-ring" />
            <Button type="submit" class="h-12">Answer</Button>
          </form>
          <p class={`mt-4 h-5 text-sm font-semibold ${result === "correct" ? "text-emerald-600" : "text-destructive"}`}>{result === "correct" ? "Correct!" : result === "wrong" ? "Try the next one." : ""}</p>
        </div>
      {:else}
        <div class="mt-10 text-center">
          <Timer class="mx-auto h-10 w-10 text-primary" />
          <p class="mt-4 text-lg font-semibold">{seconds === 0 ? `Time! You scored ${score} points.` : "Ready to race?"}</p>
          <p class="mt-2 text-sm text-muted-foreground">Speed is everything: points drop sharply as each question takes longer, then scale with difficulty.</p>
          <Button onclick={start} class="mt-6 gap-2"><RefreshCw class="h-4 w-4" /> {seconds === 60 ? "Start round" : "Play again"}</Button>
        </div>
      {/if}
    </main>
  </div>
</div>
