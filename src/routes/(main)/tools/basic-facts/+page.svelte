<script lang="ts">
  import { Button } from "#lib/components/ui/button/index.js";
  import { Progress } from "#lib/components/ui/progress/index.js";
  import { RefreshCw, Timer, Zap, Maximize, Settings, X } from "@lucide/svelte/icons";
  import { Checkbox } from "#lib/components/ui/checkbox/index.js";
  import { onDestroy, onMount, tick } from "svelte";

  type Question = { text: string; answer: number; level: number; pointsMultiplier: number; label: string };

  const makeQuestionForLevel = (level: number): Question => {
    if (level === 1) {
      const left = Math.floor(Math.random() * 12) + 1;
      const right = Math.floor(Math.random() * 12) + 1;
      const addition = Math.random() > 0.5;
      const [first, second] = addition ? [left, right] : [Math.max(left, right), Math.min(left, right)];
      return {
        text: `${first} ${addition ? "+" : "-"} ${second}`,
        answer: addition ? first + second : first - second,
        level: 1,
        pointsMultiplier: 1,
        label: "Arithmetic"
      };
    }
    if (level === 2) {
      const left = Math.floor(Math.random() * 10) + 2;
      const right = Math.floor(Math.random() * 10) + 2;
      if (Math.random() > 0.5)
        return {
          text: `${left} x ${right}`,
          answer: left * right,
          level: 2,
          pointsMultiplier: 2,
          label: "Multiplication and division"
        };
      return {
        text: `${left * right} ÷ ${right}`,
        answer: left,
        level: 2,
        pointsMultiplier: 2,
        label: "Multiplication and division"
      };
    }
    if (level === 3) {
      if (Math.random() > 0.5) {
        const base = Math.floor(Math.random() * 9) + 2;
        const exponent = Math.random() > 0.5 ? 2 : 3;
        return {
          text: `${base}${exponent === 2 ? "²" : "³"}`,
          answer: base ** exponent,
          level: 3,
          pointsMultiplier: 3,
          label: "Powers"
        };
      }
      const root = Math.floor(Math.random() * 11) + 2;
      return { text: `√${root * root}`, answer: root, level: 3, pointsMultiplier: 2.75, label: "Roots" };
    }
    const left = Math.floor(Math.random() * 12) + 2;
    const right = Math.floor(Math.random() * 12) + 2;
    const multiplier = Math.floor(Math.random() * 6) + 2;
    return {
      text: `(${left} + ${right}) x ${multiplier}`,
      answer: (left + right) * multiplier,
      level: 4,
      pointsMultiplier: 6,
      label: "Brackets"
    };
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
  let focus = $state(false);
  let showSettings = $state(false);
  let a11y = $state({ reduceMotion: false, highContrast: false, largeText: false });
  let a11yLoaded = $state(false);
  const A11Y_KEY = "basicfacts.a11y.v1";
  let interval: ReturnType<typeof setInterval> | undefined;
  let answerInput = $state<HTMLInputElement>();

  const focusAnswer = () => void tick().then(() => answerInput?.focus());

  const enterFocus = () => {
    focus = true;
    focusAnswer();
  };

  const exitFocus = () => {
    focus = false;
    focusAnswer();
  };

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
      const speedPoints = Math.max(1, Math.round(20 / (1 + timeTaken)));
      const streakMultiplier = 1 + Math.min(1, Math.floor(streak / 5) * 0.1);
      score += Math.round(speedPoints * question.pointsMultiplier * streakMultiplier);
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

  onDestroy(() => {
    if (interval) clearInterval(interval);
    if (typeof document !== "undefined") document.body.style.overflow = "";
  });

  onMount(() => {
    try {
      const raw = localStorage.getItem(A11Y_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<typeof a11y>;
        a11y = {
          reduceMotion: !!parsed.reduceMotion,
          highContrast: !!parsed.highContrast,
          largeText: !!parsed.largeText
        };
      } else if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        a11y.reduceMotion = true;
      }
    } catch {
      // Storage unavailable; defaults stand.
    }
    a11yLoaded = true;
  });

  $effect(() => {
    if (!a11yLoaded || typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(A11Y_KEY, JSON.stringify(a11y));
    } catch {
      // Ignore storage failures.
    }
  });

  $effect(() => {
    if (typeof document !== "undefined") document.body.style.overflow = focus ? "hidden" : "";
  });
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === "Escape" && showSettings) {
      showSettings = false;
      return;
    }
    if (event.key === "Escape" && focus) {
      exitFocus();
      return;
    }
    if (event.key === "Enter") submit();
  }}
/>

<div
  class="mathex-shell min-h-full py-8 sm:py-12"
  class:a11y-reduce-motion={a11y.reduceMotion}
  class:a11y-high-contrast={a11y.highContrast}
  class:a11y-large-text={a11y.largeText}
>
  <div class="mx-auto max-w-3xl px-4 sm:px-6">
    <header class="text-center">
      <div
        class="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/75 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-primary"
      >
        <Zap class="h-3.5 w-3.5" /> Timed arithmetic
      </div>
      <h1 class="mt-5 text-5xl font-bold tracking-[-0.06em] sm:text-6xl">
        Basic Facts<span class="text-primary">.</span>
      </h1>
      <p class="mt-3 text-muted-foreground sm:text-lg">
        Race through essential number facts before the clock runs out.
      </p>
    </header>

    <main class="mathex-panel mx-auto mt-8 max-w-xl rounded-3xl p-5 sm:p-8">
      <div class="grid grid-cols-3 gap-3 text-center">
        <div>
          <p class="mathex-kicker">Time</p>
          <p class="mt-1 text-2xl font-bold tabular-nums">{seconds}s</p>
        </div>
        <div>
          <p class="mathex-kicker">Score</p>
          <p class="mt-1 text-2xl font-bold tabular-nums">{score}</p>
        </div>
        <div>
          <p class="mathex-kicker">Streak</p>
          <p class="mt-1 text-2xl font-bold tabular-nums">{streak}</p>
        </div>
      </div>
      <div
        class="mt-5 flex items-center justify-between gap-4 border-t border-border/60 pt-4 text-xs"
        aria-label={`Level ${level}: ${question.label}. ${correctAtLevel} of 10 correct answers toward the next level.`}
      >
        <p class="font-semibold text-muted-foreground">
          Level {level} <span class="font-normal">· {question.label}</span>
        </p>
        <div class="flex items-center gap-2">
          <Progress value={correctAtLevel} max={10} class="h-1 w-16" /><span class="tabular-nums text-muted-foreground"
            >{correctAtLevel}/10</span
          >
          <Button variant="ghost" size="icon" onclick={enterFocus} aria-label="Enter focus mode"
            ><Maximize class="h-4 w-4" /></Button
          >
          <Button variant="ghost" size="icon" onclick={() => (showSettings = true)} aria-label="Accessibility settings"
            ><Settings class="h-4 w-4" /></Button
          >
        </div>
      </div>

      {#if playing}
        <div class="mt-10 text-center" aria-live="polite">
          <p class="mathex-kicker">Level {level} · {question.label} · {correctAtLevel}/10 to advance</p>
          <p class="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">{question.text} = ?</p>
          <form
            class="mx-auto mt-8 flex max-w-sm gap-2"
            onsubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <input
              bind:this={answerInput}
              bind:value={input}
              inputmode="numeric"
              aria-label="Your answer"
              onkeydown={(event) => {
                if (event.key.length === 1 && !/[\d+\-., ]/.test(event.key) && !event.ctrlKey && !event.metaKey)
                  event.preventDefault();
              }}
              oninput={(event) => (input = (event.currentTarget as HTMLInputElement).value.replace(/[^\d+\-., ]/g, ""))}
              class="h-12 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-center text-xl font-bold tabular-nums outline-none focus:ring-2 focus:ring-ring"
            />
            <Button type="submit" class="h-12">Answer</Button>
          </form>
          <p class="mt-4 h-5 text-sm font-semibold text-destructive">
            {result === "wrong" ? "Try the next one." : ""}
          </p>
        </div>
      {:else}
        <div class="mt-10 text-center">
          <Timer class="mx-auto h-10 w-10 text-primary" />
          <p class="mt-4 text-lg font-semibold">
            {seconds === 0 ? `Time! You scored ${score} points.` : "Ready to race?"}
          </p>
          <p class="mt-2 text-sm text-muted-foreground">
            Speed and difficulty determine points. Every five correct answers in a streak adds 10%, up to a 100% bonus.
          </p>
          <Button onclick={start} class="mt-6 gap-2"
            ><RefreshCw class="h-4 w-4" /> {seconds === 60 ? "Start round" : "Play again"}</Button
          >
        </div>
      {/if}
    </main>

    {#if focus}
      <div class="basic-focus" role="dialog" tabindex="-1" aria-modal="true" aria-label="Basic facts focus mode">
        {#key questionsAnswered}
          <div class="basic-focus-wash" class:wash-wrong={result === "wrong"}></div>
        {/key}
        <button class="basic-focus-exit" onclick={exitFocus} aria-label="Exit focus mode"><X class="h-5 w-5" /></button>
        <button class="basic-focus-settings" onclick={() => (showSettings = true)} aria-label="Accessibility settings">
          <Settings class="h-5 w-5" />
        </button>
        <div class="basic-focus-stats">
          <p><span class="mathex-kicker">Time</span><strong class="tabular-nums">{seconds}s</strong></p>
          <p><span class="mathex-kicker">Level</span><strong class="tabular-nums">{level}</strong></p>
          <p><span class="mathex-kicker">Score</span><strong class="tabular-nums">{score}</strong></p>
        </div>
        {#if playing}
          <p class="basic-focus-question" aria-live="polite">{question.text} = ?</p>
          <form
            class="basic-focus-form"
            onsubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <input
              bind:this={answerInput}
              bind:value={input}
              inputmode="numeric"
              aria-label="Your answer"
              onkeydown={(event) => {
                if (event.key.length === 1 && !/[\d+\-., ]/.test(event.key) && !event.ctrlKey && !event.metaKey)
                  event.preventDefault();
              }}
              oninput={(event) => (input = (event.currentTarget as HTMLInputElement).value.replace(/[^\d+\-., ]/g, ""))}
              class="basic-focus-input"
            />
            <Button type="submit" class="h-14 px-6 text-lg">Answer</Button>
          </form>
        {:else}
          <p class="basic-focus-question tabular-nums">{score}</p>
          <Button onclick={start} class="h-14 px-8 text-lg">{seconds === 0 ? "Play again" : "Start"}</Button>
        {/if}
        <p class="basic-focus-hint">Esc to exit</p>
      </div>
    {/if}
    {#if showSettings}
      <div
        class="basic-settings-overlay"
        role="presentation"
        onclick={(event) => {
          if (event.target === event.currentTarget) showSettings = false;
        }}
        onkeydown={(event) => {
          if (event.key === "Escape") showSettings = false;
        }}
      >
        <div
          class="basic-settings-dialog"
          role="dialog"
          tabindex="-1"
          aria-modal="true"
          aria-label="Accessibility settings"
        >
          <h2>Accessibility</h2>
          <label>
            <Checkbox bind:checked={a11y.reduceMotion} />
            <span><strong>Reduce motion</strong><small>Turns off the answer flash.</small></span>
          </label>
          <label>
            <Checkbox bind:checked={a11y.highContrast} />
            <span><strong>High contrast</strong><small>Stronger text and input borders.</small></span>
          </label>
          <label>
            <Checkbox bind:checked={a11y.largeText} />
            <span><strong>Large text</strong><small>Bigger question and answer field.</small></span>
          </label>
          <Button class="mt-2 w-full" onclick={() => (showSettings = false)}>Done</Button>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .basic-focus {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2rem;
    padding: 1.5rem;
    background: var(--background);
    color: var(--foreground);
  }
  .basic-focus-exit {
    position: absolute;
    top: 1rem;
    right: 1rem;
    width: 2.5rem;
    height: 2.5rem;
    display: grid;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: transparent;
    color: var(--muted-foreground);
    cursor: pointer;
  }
  .basic-focus-exit:hover {
    color: var(--foreground);
    border-color: var(--foreground);
  }
  .basic-focus-settings {
    position: absolute;
    top: 1rem;
    right: 4rem;
    width: 2.5rem;
    height: 2.5rem;
    display: grid;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: transparent;
    color: var(--muted-foreground);
    cursor: pointer;
  }
  .basic-focus-settings:hover {
    color: var(--foreground);
    border-color: var(--foreground);
  }
  .basic-focus-stats {
    display: flex;
    gap: 3rem;
    text-align: center;
  }
  .basic-focus-stats p {
    display: grid;
    gap: 0.25rem;
  }
  .basic-focus-stats strong {
    font-size: 1.75rem;
    font-weight: 700;
  }
  .basic-focus-question {
    margin: 0;
    font-size: clamp(3rem, 12vw, 5.5rem);
    font-weight: 800;
    letter-spacing: -0.03em;
    text-align: center;
  }
  .basic-focus-form {
    display: flex;
    gap: 0.6rem;
    width: min(22rem, 100%);
  }
  .basic-focus-input {
    height: 3.5rem;
    min-width: 0;
    flex: 1;
    border: 2px solid var(--border);
    border-radius: 3px;
    background: var(--card);
    color: var(--foreground);
    text-align: center;
    font-size: 1.75rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    outline: none;
  }
  .basic-focus-input:focus {
    border-color: var(--viridian, var(--primary));
  }
  .basic-focus-wash {
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0;
  }
  .basic-focus-wash.wash-wrong {
    background: color-mix(in srgb, var(--destructive) 11%, transparent);
    animation: wash-fade 0.6s ease-out;
  }
  @keyframes wash-fade {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }
  .basic-settings-overlay {
    position: fixed;
    inset: 0;
    z-index: 70;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: rgb(25 28 22 / 45%);
  }
  .basic-settings-dialog {
    width: min(22rem, 100%);
    background: var(--card);
    color: var(--foreground);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 1.4rem;
  }
  .basic-settings-dialog h2 {
    margin: 0 0 0.6rem;
    font-family: "Fraunces", Georgia, serif;
    font-size: 1.4rem;
    font-weight: 600;
  }
  .basic-settings-dialog label {
    display: flex;
    gap: 0.7rem;
    align-items: flex-start;
    padding: 0.6rem 0;
    cursor: pointer;
  }
  .basic-settings-dialog label span {
    display: grid;
    gap: 0.1rem;
  }
  .basic-settings-dialog label strong {
    font-size: 0.92rem;
  }
  .basic-settings-dialog label small {
    color: var(--muted-foreground);
    font-size: 0.78rem;
  }
  .a11y-high-contrast .basic-focus-input {
    border-width: 3px;
    border-color: var(--foreground);
  }
  .a11y-high-contrast .basic-focus-hint,
  .a11y-high-contrast .basic-focus-stats .mathex-kicker {
    color: var(--foreground);
  }
  .a11y-large-text .basic-focus-question {
    font-size: clamp(4rem, 16vw, 7.5rem);
  }
  .a11y-large-text .basic-focus-input {
    height: 4.25rem;
    font-size: 2.25rem;
  }
  .a11y-reduce-motion .basic-focus-wash {
    animation: none;
    opacity: 0;
  }
  @media (prefers-reduced-motion: reduce) {
    .basic-focus-wash {
      animation: none;
      opacity: 0;
    }
  }
  .basic-focus-hint {
    margin: 0;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
</style>
