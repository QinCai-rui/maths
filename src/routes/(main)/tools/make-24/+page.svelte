<script lang="ts">
  import { onMount, tick } from "svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Confetti } from "svelte-confetti";
  import { toast } from "svelte-sonner";
  import { Delete, Flag, Info, RefreshCw, Trophy, X } from "@lucide/svelte/icons";
  import { todayKey, mulberry32, pickDaily } from "#lib/random.js";
  import { parse, collectLeaves, evaluate, validate } from "#lib/make24/expression.js";
  import puzzles from "#lib/make24/puzzles.json";

  interface PuzzleEntry {
    cards: number[];
    solutionCount: number;
    needsFractions: boolean;
    difficulty: "easy" | "medium" | "hard";
    sample: string;
  }

  interface Stats {
    played: number;
    won: number;
    streak: number;
    maxStreak: number;
  }

  interface SprintResult {
    cards: number[];
    difficulty: "easy" | "medium" | "hard";
    solved: boolean;
    secondsLeft: number;
    points: number;
    detail: string;
  }

  type Status = "playing" | "won" | "lost";

  const PUZZLES = puzzles as unknown as PuzzleEntry[];
  const STATS_KEY = "make24.stats.v1";
  const SEEN_KEY = "make24.seen.v1";
  const BEST_KEY = "make24.best.v1";
  const dailyKey = (day: string) => `make24.daily.v1.${day}`;
  const SPRINT_SIZE = 5;
  const PUZZLE_SECONDS = 90;
  const BASE_POINTS: Record<PuzzleEntry["difficulty"], number> = { easy: 100, medium: 200, hard: 300 };

  const emptyStats = (): Stats => ({ played: 0, won: 0, streak: 0, maxStreak: 0 });

  // Initialise to today's daily puzzle up front so the first paint already
  // shows the right cards. onMount then restores any saved progress on top.
  const initialDay = todayKey();
  let mode = $state<"daily" | "sprint">("daily");
  let day = $state(initialDay);
  let entry = $state<PuzzleEntry>(pickDaily(PUZZLES, initialDay, "make24"));
  let text = $state("");
  let attempts = $state<string[]>([]);
  let status = $state<Status>("playing");
  let stats = $state<Stats>(emptyStats());
  let best = $state(0);
  let showHelp = $state(false);
  let showResult = $state(false);
  let showConfetti = $state(false);
  let shaking = $state(false);
  let now = $state(Date.now());
  let helpDialog = $state<HTMLDivElement>();
  let resultDialog = $state<HTMLDivElement>();
  let timers: ReturnType<typeof setTimeout>[] = [];

  // Sprint state
  let sprintPuzzles = $state<PuzzleEntry[]>([]);
  let sprintIndex = $state(0);
  let sprintResults = $state<SprintResult[]>([]);
  let sprintStreak = $state(0);
  let timeLeft = $state(PUZZLE_SECONDS);
  let clock: ReturnType<typeof setInterval> | undefined;

  const cards = $derived(entry.cards);
  const sprintScore = $derived(sprintResults.reduce((sum, r) => sum + r.points, 0));
  const sprintDone = $derived(mode === "sprint" && sprintResults.length >= SPRINT_SIZE && status !== "playing");
  const lastResult = $derived(sprintResults.length > 0 ? sprintResults[sprintResults.length - 1] : null);

  function prefersReducedMotion(): boolean {
    return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function schedule(callback: () => void, delay: number) {
    const id = setTimeout(() => {
      timers = timers.filter((timer) => timer !== id);
      callback();
    }, delay);
    timers.push(id);
  }

  function clearTimers() {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
  }

  function stopClock() {
    if (clock !== undefined) {
      clearInterval(clock);
      clock = undefined;
    }
  }

  const countdown = $derived.by(() => {
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    const diff = Math.max(0, midnight.getTime() - now);
    const hours = Math.floor(diff / 3_600_000);
    const minutes = Math.floor((diff % 3_600_000) / 60_000);
    const seconds = Math.floor((diff % 60_000) / 1000);
    const pad = (value: number) => `${value}`.padStart(2, "0");
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  });

  const timeDisplay = $derived.by(() => {
    const pad = (value: number) => `${value}`.padStart(2, "0");
    return `${pad(Math.floor(Math.max(0, timeLeft) / 60))}:${pad(Math.max(0, timeLeft) % 60)}`;
  });

  function readStats(): Stats {
    try {
      const raw = localStorage.getItem(STATS_KEY);
      if (!raw) return emptyStats();
      const parsed = JSON.parse(raw) as Partial<Stats>;
      return {
        played: parsed.played || 0,
        won: parsed.won || 0,
        streak: parsed.streak || 0,
        maxStreak: parsed.maxStreak || 0
      };
    } catch {
      return emptyStats();
    }
  }

  function persistStats() {
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch {
      // Private browsing etc. Play still works, stats just do not persist.
    }
  }

  function readBest(): number {
    try {
      return Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch {
      return 0;
    }
  }

  function persistBest() {
    try {
      localStorage.setItem(BEST_KEY, String(best));
    } catch {
      // Ignore storage failures; the round still works in memory.
    }
  }

  function persistDaily() {
    if (mode !== "daily") return;
    try {
      localStorage.setItem(dailyKey(day), JSON.stringify({ cards, attempts, status }));
    } catch {
      // Ignore storage failures; the round still works in memory.
    }
  }

  function focusDialog(dialog: HTMLDivElement | undefined) {
    tick().then(() => {
      const focusable = dialog?.querySelector<HTMLElement>(
        "button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
      );
      (focusable ?? dialog)?.focus();
    });
  }

  function trapFocus(event: KeyboardEvent, dialog: HTMLDivElement | undefined) {
    if (event.key !== "Tab" || !dialog) return;
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        "button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
      )
    ).filter((element) => element.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function sameCards(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  function startDaily(restore: boolean) {
    stopClock();
    clearTimers();
    mode = "daily";
    day = todayKey();
    entry = pickDaily(PUZZLES, day, "make24");
    text = "";
    showConfetti = false;
    shaking = false;
    if (restore) {
      try {
        const raw = localStorage.getItem(dailyKey(day));
        if (raw) {
          const parsed = JSON.parse(raw) as { cards?: number[]; attempts?: string[]; status?: Status };
          if (parsed.cards && sameCards(parsed.cards, entry.cards)) {
            attempts = (parsed.attempts || []).filter((a) => typeof a === "string").slice(0, 50);
            status = parsed.status === "won" || parsed.status === "lost" ? parsed.status : "playing";
            showResult = false;
            return;
          }
        }
      } catch {
        // Corrupt save: fall through to a fresh round.
      }
    }
    attempts = [];
    status = "playing";
    showResult = false;
  }

  function sampleSprint(): PuzzleEntry[] {
    const random = mulberry32((Math.random() * 0xffffffff) >>> 0);
    const draw = (difficulty: PuzzleEntry["difficulty"], n: number): PuzzleEntry[] => {
      const pool = PUZZLES.filter((p) => p.difficulty === difficulty);
      const copy = [...pool];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      }
      return copy.slice(0, n);
    };
    const picked = [...draw("easy", 1), ...draw("medium", 2), ...draw("hard", 2)];
    for (let i = picked.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [picked[i], picked[j]] = [picked[i]!, picked[j]!];
    }
    return picked;
  }

  function loadSprintPuzzle() {
    entry = sprintPuzzles[sprintIndex]!;
    text = "";
    attempts = [];
    status = "playing";
    shaking = false;
    showConfetti = false;
    timeLeft = PUZZLE_SECONDS;
  }

  function startSprint() {
    stopClock();
    clearTimers();
    mode = "sprint";
    sprintPuzzles = sampleSprint();
    sprintIndex = 0;
    sprintResults = [];
    sprintStreak = 0;
    showResult = false;
    loadSprintPuzzle();
    clock = setInterval(() => {
      now = Date.now();
      if (mode !== "sprint" || status !== "playing") return;
      timeLeft -= 1;
      if (timeLeft <= 0) {
        timeLeft = 0;
        timeUp();
      }
    }, 1000);
  }

  function recordDailyResult(won: boolean) {
    stats.played++;
    if (won) {
      stats.won++;
      stats.streak++;
      stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
    } else {
      stats.streak = 0;
    }
    persistStats();
  }

  function celebrate() {
    if (prefersReducedMotion()) return;
    showConfetti = true;
    schedule(() => (showConfetti = false), 4500);
  }

  function fail(message: string) {
    shaking = true;
    schedule(() => (shaking = false), 550);
    toast.error(message);
  }

  function submit() {
    if (status !== "playing" || showHelp || showResult) return;
    const candidate = text.trim();
    if (candidate === "") {
      fail("Type an expression first");
      attempts = [...attempts];
      return;
    }
    const result = validate(candidate, cards);
    if (!result.ok) {
      attempts = [...attempts, candidate];
      if (mode === "daily") persistDaily();
      fail(result.reason);
      return;
    }
    status = "won";
    if (mode === "daily") {
      recordDailyResult(true);
      persistDaily();
      celebrate();
      showResult = true;
    } else {
      const secondsLeft = Math.max(0, timeLeft);
      sprintStreak += 1;
      const base = BASE_POINTS[entry.difficulty];
      const timeBonus = 5 * secondsLeft;
      const streakBonus = 50 * sprintStreak;
      const points = base + timeBonus + streakBonus;
      sprintResults = [
        ...sprintResults,
        {
          cards: [...cards],
          difficulty: entry.difficulty,
          solved: true,
          secondsLeft,
          points,
          detail: `${base} base + ${timeBonus} time + ${streakBonus} streak`
        }
      ];
      const total = sprintResults.reduce((s, r) => s + r.points, 0);
      if (total > best) {
        best = total;
        persistBest();
      }
      celebrate();
      showResult = true;
    }
  }

  function giveUp() {
    if (status !== "playing" || showHelp || showResult) return;
    status = "lost";
    if (mode === "daily") {
      recordDailyResult(false);
      persistDaily();
    } else {
      sprintStreak = 0;
      sprintResults = [
        ...sprintResults,
        {
          cards: [...cards],
          difficulty: entry.difficulty,
          solved: false,
          secondsLeft: Math.max(0, timeLeft),
          points: 0,
          detail: "Unsolved"
        }
      ];
    }
    showResult = true;
  }

  function timeUp() {
    if (mode !== "sprint" || status !== "playing") return;
    status = "lost";
    sprintStreak = 0;
    sprintResults = [
      ...sprintResults,
      {
        cards: [...cards],
        difficulty: entry.difficulty,
        solved: false,
        secondsLeft: 0,
        points: 0,
        detail: "Time ran out"
      }
    ];
    toast.error("Time ran out — the answer is in the results");
    showResult = true;
  }

  function nextSprintPuzzle() {
    showResult = false;
    if (sprintIndex + 1 >= SPRINT_SIZE) return;
    sprintIndex += 1;
    loadSprintPuzzle();
  }

  function press(key: string) {
    if (key === "Escape") {
      if (showResult) showResult = false;
      else if (showHelp) closeHelp();
      return;
    }
    if (status !== "playing" || showHelp || showResult) return;
    const normalized = key.replaceAll("×", "*").replaceAll("÷", "/").replaceAll("−", "-");
    if (/^[0-9+\-*/()]$/.test(normalized)) {
      if (text.length < 60) text += normalized;
    } else if (key === "Enter") {
      submit();
    } else if (key === "Backspace") {
      text = text.slice(0, -1);
    }
  }

  function describeCardUse(leaves: number[], expected: number[]): string | null {
    const tally = (nums: number[]) => {
      const counts = new Map<number, number>();
      for (const n of nums) counts.set(n, (counts.get(n) ?? 0) + 1);
      return counts;
    };
    const found = tally(leaves);
    const wanted = tally(expected);
    const missing: number[] = [];
    const smuggled: number[] = [];
    for (const [value, count] of wanted) {
      for (let i = found.get(value) ?? 0; i < count; i++) missing.push(value);
    }
    for (const [value, count] of found) {
      for (let i = wanted.get(value) ?? 0; i < count; i++) smuggled.push(value);
    }
    if (missing.length === 0 && smuggled.length === 0) return null;
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`Missing ${missing.join(", ")}`);
    if (smuggled.length > 0) parts.push(`Smuggled ${smuggled.join(", ")} (not on the cards)`);
    return parts.join(" · ");
  }

  const preview = $derived.by(() => {
    const source = text.trim();
    if (source === "") return { kind: "empty" as const };
    let leaves: number[];
    try {
      leaves = collectLeaves(parse(source));
    } catch (err) {
      return { kind: "error" as const, message: err instanceof Error ? err.message : String(err) };
    }
    let valueText: string | null = null;
    try {
      const value = evaluate(parse(source));
      valueText = value.d === 1 ? `${value.n}` : `${value.n}/${value.d}`;
    } catch (err) {
      return { kind: "error" as const, message: err instanceof Error ? err.message : String(err) };
    }
    const cardNote = leaves.length === 0 ? "No numbers yet" : describeCardUse(leaves, cards);
    return { kind: "ok" as const, valueText, cardNote };
  });

  function attemptSummary(expr: string): string {
    try {
      const value = evaluate(parse(expr));
      return value.d === 1 ? `= ${value.n}` : `= ${value.n}/${value.d}`;
    } catch (err) {
      return err instanceof Error ? err.message : "Invalid expression";
    }
  }

  function closeHelp() {
    showHelp = false;
    try {
      localStorage.setItem(SEEN_KEY, "true");
    } catch {
      // Ignore storage failures.
    }
  }

  onMount(() => {
    stats = readStats();
    best = readBest();
    try {
      if (!localStorage.getItem(SEEN_KEY)) showHelp = true;
    } catch {
      showHelp = true;
    }
    startDaily(true);
    const id = setInterval(() => {
      now = Date.now();
      if (mode === "daily" && todayKey() !== day) startDaily(false);
    }, 1000);
    return () => {
      clearInterval(id);
      stopClock();
      clearTimers();
    };
  });

  // Move focus into whichever dialog is open, trap Tab, and restore on close.
  $effect(() => {
    if (!showHelp) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusDialog(helpDialog);
    return () => previous?.focus();
  });

  $effect(() => {
    if (!showResult) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusDialog(resultDialog);
    return () => previous?.focus();
  });

  // Lock background scrolling while a dialog is open.
  $effect(() => {
    if (!showHelp && !showResult) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  });
</script>

<svelte:head>
  <title>Make 24 — combine four numbers to make 24</title>
  <meta
    name="description"
    content="Combine four numbers with + − × ÷ and parentheses to make 24. A daily puzzle plus a timed five-round sprint."
  />
</svelte:head>

<svelte:window
  onkeydown={(event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape") {
      press("Escape");
      return;
    }
    const target = event.target as HTMLElement | null;
    // Let the expression field handle its own typing; the pad and window share press() everywhere else.
    if (target?.closest("input, textarea, select, [contenteditable]")) return;
    if (target?.closest("button, a") && (event.key === "Enter" || event.key === " ")) {
      return;
    }
    if (/^[0-9+\-*/().×÷−]$/.test(event.key) || event.key === "Enter" || event.key === "Backspace") {
      event.preventDefault();
      press(event.key);
    }
  }}
/>

{#if showConfetti}
  <div class="pointer-events-none fixed left-0 top-[-50px] z-50 flex h-screen w-screen justify-center overflow-hidden">
    <Confetti x={[-5, 5]} y={[0, 0.1]} delay={[500, 2000]} infinite duration={4000} amount={400} fallDistance="100vh" />
  </div>
{/if}

<div class="site-wrap make24">
  <header class="make24-head">
    <div>
      <h1 class="site-page-title">Make 24</h1>
      <p class="site-page-intro">Combine the four numbers with + − × ÷ and parentheses to make 24.</p>
    </div>
    <Button variant="outline" size="sm" class="gap-1.5" onclick={() => (showHelp = true)}>
      <Info class="h-4 w-4" /> How to play
    </Button>
  </header>

  <div class="make24-modes" role="group" aria-label="Game mode">
    <button aria-pressed={mode === "daily"} class:active={mode === "daily"} onclick={() => startDaily(true)}>
      Daily · {day}
    </button>
    <button aria-pressed={mode === "sprint"} class:active={mode === "sprint"} onclick={startSprint}>
      Sprint · 5 × 90s
    </button>
  </div>

  {#if mode === "sprint"}
    <div class="make24-sprintbar" aria-live="polite">
      <span>Puzzle {Math.min(sprintIndex + 1, SPRINT_SIZE)} of {SPRINT_SIZE}</span>
      <span class="make24-timer" class:low={timeLeft <= 15 && status === "playing"}>
        {timeDisplay} left
      </span>
      <span>Score {sprintScore}</span>
    </div>
  {/if}

  <p class="make24-status" aria-live="polite">
    {#if status === "playing"}
      Use each card exactly once
    {:else if status === "won"}
      Solved — nice work
    {:else}
      Round over — the answer is in the results
    {/if}
  </p>

  <div class="make24-cards" aria-label="Cards">
    {#each cards as card}
      <div class="make24-card">{card}</div>
    {/each}
    <span class="make24-difficulty">{entry.difficulty}</span>
  </div>

  <label class="make24-field" class:make24-shake={shaking}>
    <span class="make24-label">Your expression</span>
    <input
      class="make24-input"
      type="text"
      inputmode="text"
      autocomplete="off"
      spellcheck={false}
      placeholder="(6 − 1) × (5 − 1)"
      bind:value={text}
      disabled={status !== "playing"}
      onkeydown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submit();
        }
      }}
    />
  </label>

  <p class="make24-preview" aria-live="polite">
    {#if preview.kind === "empty"}
      Type or tap an expression — the exact value shows here.
    {:else if preview.kind === "error"}
      <span class="make24-error">{preview.message}</span>
    {:else if preview.cardNote}
      <span>= {preview.valueText}</span>
      <span class="make24-leafwarn">{preview.cardNote}</span>
    {:else}
      <span>= {preview.valueText}</span>
      <span class="make24-leafok">Uses each card exactly once</span>
    {/if}
  </p>

  <div class="make24-pad" aria-label="Expression keyboard">
    <div class="make24-keyrow">
      {#each ["1", "2", "3", "4", "5"] as key}
        <button
          class="make24-key"
          disabled={status !== "playing"}
          onclick={() => press(key)}
          aria-label={`Digit ${key}`}
        >
          {key}
        </button>
      {/each}
    </div>
    <div class="make24-keyrow">
      {#each ["6", "7", "8", "9", "0"] as key}
        <button
          class="make24-key"
          disabled={status !== "playing"}
          onclick={() => press(key)}
          aria-label={`Digit ${key}`}
        >
          {key}
        </button>
      {/each}
    </div>
    <div class="make24-keyrow">
      {#each ["+", "-", "*", "/"] as key}
        <button
          class="make24-key make24-key-op"
          disabled={status !== "playing"}
          onclick={() => press(key)}
          aria-label={`Operator ${key}`}
        >
          {key}
        </button>
      {/each}
      {#each ["(", ")"] as key}
        <button
          class="make24-key make24-key-op"
          disabled={status !== "playing"}
          onclick={() => press(key)}
          aria-label={`Parenthesis ${key}`}
        >
          {key}
        </button>
      {/each}
    </div>
    <div class="make24-keyrow">
      <button
        class="make24-key make24-key-wide"
        disabled={status !== "playing"}
        onclick={() => press("Backspace")}
        aria-label="Delete last character"
      >
        <Delete class="h-5 w-5" />
      </button>
      <button class="make24-key make24-key-wide" disabled={status !== "playing"} onclick={() => (text = "")}>
        Clear
      </button>
      <button class="make24-key make24-key-enter" disabled={status !== "playing"} onclick={() => press("Enter")}>
        Enter
      </button>
    </div>
  </div>

  <div class="make24-actions">
    <Button onclick={submit} disabled={status !== "playing"}>Check expression</Button>
    <Button variant="outline" onclick={giveUp} disabled={status !== "playing"} class="gap-1.5">
      <Flag class="h-4 w-4" /> Give up
    </Button>
  </div>

  {#if attempts.length > 0}
    <section aria-label="Tried expressions">
      <h2 class="make24-subhead">Tried ({attempts.length})</h2>
      <ol class="make24-attempts">
        {#each attempts as attempt, i}
          <li>
            <span class="make24-attempt-index">{i + 1}.</span> <code>{attempt}</code>
            <span class="make24-attempt-value">{attemptSummary(attempt)}</span>
          </li>
        {/each}
      </ol>
    </section>
  {/if}

  {#if status !== "playing" && !showResult}
    <div class="make24-actions">
      <Button onclick={() => (showResult = true)} class="gap-1.5"><Trophy class="h-4 w-4" /> See results</Button>
      {#if mode === "daily"}
        <Button variant="outline" onclick={startSprint} class="gap-1.5"><RefreshCw class="h-4 w-4" /> Sprint</Button>
      {:else if !sprintDone}
        <Button variant="outline" onclick={nextSprintPuzzle} class="gap-1.5">Next puzzle</Button>
      {:else}
        <Button variant="outline" onclick={startSprint} class="gap-1.5"><RefreshCw class="h-4 w-4" /> New sprint</Button
        >
      {/if}
    </div>
  {/if}
</div>

{#if showHelp}
  <div
    class="make24-overlay"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) closeHelp();
    }}
    onkeydown={(event) => {
      if (event.key === "Escape") closeHelp();
    }}
  >
    <div
      class="make24-dialog"
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-label="How to play"
      bind:this={helpDialog}
      onkeydown={(event) => trapFocus(event, helpDialog)}
    >
      <div class="make24-dialog-head">
        <h2>How to play</h2>
        <button class="make24-icon-button" onclick={() => closeHelp()} aria-label="Close help"
          ><X class="h-4 w-4" /></button
        >
      </div>
      <p>Use all four cards exactly once, with <strong>+ − × ÷</strong> and parentheses, to make exactly 24.</p>
      <p>Each card is one whole number — use it once and only once. No extra numbers, no decimals.</p>
      <p>For example, with 6, 1, 5, 1: <code>(6 − 1) × (5 − 1) = 24</code>. Type it as <code>(6-1)*(5-1)</code>.</p>
      <p>
        Daily gives one puzzle a day. Sprint deals five puzzles — one easy, two medium, two hard — with 90 seconds each.
        Sprint scoring: 100 / 200 / 300 base by difficulty, plus 5 points per second left, plus 50 per solve in your
        current streak.
      </p>
      <Button class="mt-5 w-full" onclick={() => closeHelp()}>Play</Button>
    </div>
  </div>
{/if}

{#if showResult}
  <div
    class="make24-overlay"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) showResult = false;
    }}
    onkeydown={(event) => {
      if (event.key === "Escape") showResult = false;
    }}
  >
    <div
      class="make24-dialog"
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-label="Results"
      bind:this={resultDialog}
      onkeydown={(event) => trapFocus(event, resultDialog)}
    >
      <div class="make24-dialog-head">
        <h2>
          {#if mode === "daily"}
            {status === "won" ? "You made 24" : "Out of luck"}
          {:else if sprintDone}
            Sprint finished
          {:else}
            {status === "won" ? "Solved" : "Round over"}
          {/if}
        </h2>
        <button class="make24-icon-button" onclick={() => (showResult = false)} aria-label="Close results">
          <X class="h-4 w-4" />
        </button>
      </div>
      {#if status === "won" && mode === "daily"}
        <p>Your solution: <code>{text.trim() || attempts[attempts.length - 1]}</code></p>
      {:else if status === "won" && mode === "sprint" && lastResult}
        <p>Solved for <strong>{lastResult.points}</strong> points ({lastResult.detail}).</p>
      {/if}
      {#if status === "lost"}
        <p>One way to do it: <code>{entry.sample}</code> = 24. Losing teaches — try it with the cards.</p>
      {/if}
      {#if mode === "sprint"}
        <h3>Sprint score · {sprintScore}</h3>
        <ol class="make24-breakdown">
          {#each sprintResults as result, i}
            <li>
              <span>#{i + 1} [{result.cards.join(", ")}] · {result.difficulty}</span>
              <span>{result.solved ? `+${result.points} (${result.detail})` : `missed (${result.detail})`}</span>
            </li>
          {/each}
        </ol>
        <p class="make24-local-note">Best sprint on this device: {best}.</p>
      {:else}
        <dl class="make24-stats">
          <div>
            <dt>Played</dt>
            <dd>{stats.played}</dd>
          </div>
          <div>
            <dt>Won</dt>
            <dd>{stats.won}</dd>
          </div>
          <div>
            <dt>Streak</dt>
            <dd>{stats.streak}</dd>
          </div>
          <div>
            <dt>Best sprint</dt>
            <dd>{best}</dd>
          </div>
        </dl>
        <p class="make24-countdown">Next puzzle in {countdown}</p>
        <p class="make24-local-note">Personal stats, stored only on this device.</p>
      {/if}
      <div class="make24-dialog-actions">
        {#if mode === "sprint" && !sprintDone}
          <Button onclick={nextSprintPuzzle}>Next puzzle</Button>
        {:else if mode === "sprint"}
          <Button onclick={startSprint} class="gap-1.5"><RefreshCw class="h-4 w-4" /> New sprint</Button>
          <Button
            variant="outline"
            onclick={() => {
              showResult = false;
              startDaily(true);
            }}>Daily puzzle</Button
          >
        {:else}
          <Button onclick={() => (showResult = false)}>Keep trying</Button>
          <Button variant="outline" onclick={startSprint} class="gap-1.5"><RefreshCw class="h-4 w-4" /> Sprint</Button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .make24 {
    max-width: 30rem;
    padding-bottom: 3rem;
  }
  .make24-head {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 1rem;
    padding-top: 0.5rem;
  }
  .make24-modes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    margin-top: 1.5rem;
    border: 1px solid var(--border);
    border-radius: 3px;
    overflow: hidden;
  }
  .make24-modes button {
    padding: 0.55rem 0.5rem;
    background: transparent;
    color: var(--muted-foreground);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    border: 0;
  }
  .make24-modes button.active {
    background: var(--viridian);
    color: var(--primary-foreground);
  }
  .make24-sprintbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    margin-top: 1rem;
    font-size: 0.85rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .make24-timer {
    padding: 0.2rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--card);
  }
  .make24-timer.low {
    border-color: var(--saffron);
    color: inherit;
  }
  .make24-status {
    margin: 1.1rem 0 0.7rem;
    text-align: center;
    font-size: 0.9rem;
    color: var(--muted-foreground);
    min-height: 1.4rem;
  }
  .make24-cards {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }
  .make24-card {
    width: 3.4rem;
    height: 4.4rem;
    display: grid;
    place-items: center;
    font-size: 1.6rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    background: var(--card);
    border: 2px solid var(--line-strong);
    border-radius: 3px;
    user-select: none;
  }
  .make24-difficulty {
    margin-left: 0.4rem;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted-foreground);
  }
  .make24-field {
    display: block;
    margin-top: 1.2rem;
  }
  .make24-label {
    display: block;
    margin-bottom: 0.35rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--muted-foreground);
  }
  .make24-input {
    width: 100%;
    padding: 0.65rem 0.8rem;
    font-size: 1.15rem;
    font-family: ui-monospace, monospace;
    background: var(--card);
    color: var(--foreground);
    border: 2px solid var(--border);
    border-radius: 3px;
  }
  .make24-input:focus {
    outline: none;
    border-color: var(--viridian);
  }
  .make24-input:disabled {
    opacity: 0.6;
  }
  .make24-preview {
    margin: 0.6rem 0 0;
    min-height: 1.6rem;
    font-size: 0.92rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.7rem;
    align-items: baseline;
  }
  .make24-error {
    color: #b3261e;
  }
  .make24-leafwarn {
    color: var(--muted-foreground);
    font-size: 0.82rem;
  }
  .make24-leafok {
    color: var(--viridian);
    font-size: 0.82rem;
    font-weight: 600;
  }
  .make24-pad {
    display: grid;
    gap: 0.4rem;
    margin-top: 1rem;
  }
  .make24-keyrow {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0.4rem;
  }
  .make24-key {
    min-height: 3rem;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--card);
    color: var(--foreground);
    font-size: 1.15rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }
  .make24-key:hover:not(:disabled) {
    border-color: var(--viridian);
  }
  .make24-key:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
  .make24-key-op {
    background: var(--muted);
  }
  .make24-key-wide {
    grid-column: span 2;
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 2.9rem;
  }
  .make24-key-wide:last-child {
    grid-column: span 1;
  }
  .make24-key-enter {
    grid-column: span 1;
    font-size: 0.85rem;
  }
  .make24-actions {
    display: flex;
    gap: 0.6rem;
    justify-content: center;
    margin-top: 1.2rem;
  }
  .make24-subhead {
    margin: 1.4rem 0 0.4rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--muted-foreground);
  }
  .make24-attempts {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.3rem;
    font-size: 0.88rem;
  }
  .make24-attempts li {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--card);
  }
  .make24-attempts code {
    font-family: ui-monospace, monospace;
  }
  .make24-attempt-index {
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
  }
  .make24-attempt-value {
    margin-left: auto;
    color: var(--muted-foreground);
    white-space: nowrap;
  }
  .make24-overlay {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: rgb(25 28 22 / 45%);
  }
  .make24-dialog {
    width: min(26rem, 100%);
    max-height: min(90vh, 44rem);
    overflow-y: auto;
    background: var(--card);
    color: var(--foreground);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 1.4rem;
  }
  .make24-dialog h2 {
    margin: 0;
    font-family: "Fraunces", Georgia, serif;
    font-size: 1.5rem;
    font-weight: 600;
  }
  .make24-dialog h3 {
    margin: 1.1rem 0 0.4rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--muted-foreground);
  }
  .make24-dialog p {
    margin: 0.7rem 0 0;
    font-size: 0.92rem;
    line-height: 1.55;
  }
  .make24-dialog code {
    font-family: ui-monospace, monospace;
    font-size: 0.85em;
  }
  .make24-dialog-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .make24-icon-button {
    width: 2.1rem;
    height: 2.1rem;
    display: grid;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: transparent;
    color: var(--muted-foreground);
    cursor: pointer;
  }
  .make24-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    margin: 1.1rem 0 0;
    text-align: center;
  }
  .make24-stats dt {
    font-size: 0.68rem;
    color: var(--muted-foreground);
  }
  .make24-stats dd {
    margin: 0.15rem 0 0;
    font-size: 1.6rem;
    font-weight: 700;
  }
  .make24-breakdown {
    margin: 0.4rem 0 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.3rem;
    font-size: 0.82rem;
  }
  .make24-breakdown li {
    display: flex;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 3px;
    font-variant-numeric: tabular-nums;
  }
  .make24-countdown {
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .make24-local-note {
    margin-top: 0.2rem;
    text-align: center;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .make24-dialog-actions {
    display: flex;
    gap: 0.6rem;
    margin-top: 1.2rem;
  }
  .make24-dialog-actions > :global(*) {
    flex: 1;
  }
  .make24-shake {
    animation: make24-shake 0.5s ease;
  }
  @keyframes make24-shake {
    0%,
    100% {
      transform: translateX(0);
    }
    20%,
    60% {
      transform: translateX(-0.45rem);
    }
    40%,
    80% {
      transform: translateX(0.45rem);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .make24-shake {
      animation: none;
    }
  }
</style>
