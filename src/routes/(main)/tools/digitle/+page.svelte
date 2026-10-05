<script lang="ts">
  import { onMount } from "svelte";
  import { Button } from "$lib/components/ui/button";
  import { Confetti } from "svelte-confetti";
  import { toast } from "svelte-sonner";
  import { Delete, Info, RefreshCw, Share2, Trophy, X } from "@lucide/svelte/icons";

  type Mark = "correct" | "present" | "absent";
  type Status = "playing" | "won" | "lost";

  const ATTEMPTS = 6;
  const LENGTH = 5;
  const STATS_KEY = "digitle.stats.v1";
  const SEEN_KEY = "digitle.seen.v1";
  const dailyKey = (day: string) => `digitle.daily.v1.${day}`;

  interface Stats {
    played: number;
    won: number;
    streak: number;
    maxStreak: number;
    distribution: number[];
  }

  const emptyStats = (): Stats => ({ played: 0, won: 0, streak: 0, maxStreak: 0, distribution: [0, 0, 0, 0, 0, 0] });

  function todayKey(date = new Date()): string {
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function hashSeed(text: string): number {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed: number): () => number {
    let state = seed;
    return () => {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
      mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
  }

  function dailyTarget(day: string): string {
    const random = mulberry32(hashSeed(`digitle-${day}`));
    let digits = "";
    for (let i = 0; i < LENGTH; i++) digits += Math.floor(random() * 10);
    return digits;
  }

  function randomTarget(): string {
    let digits = "";
    for (let i = 0; i < LENGTH; i++) digits += Math.floor(Math.random() * 10);
    return digits;
  }

  function evaluate(guess: string, answer: string): Mark[] {
    const marks: Mark[] = Array.from({ length: LENGTH }, () => "absent" as Mark);
    const remaining: Record<string, number> = {};
    for (const digit of answer) remaining[digit] = (remaining[digit] || 0) + 1;
    for (let i = 0; i < LENGTH; i++) {
      if (guess[i] === answer[i]) {
        marks[i] = "correct";
        remaining[guess[i]]--;
      }
    }
    for (let i = 0; i < LENGTH; i++) {
      if (marks[i] === "correct") continue;
      if ((remaining[guess[i]] || 0) > 0) {
        marks[i] = "present";
        remaining[guess[i]]--;
      }
    }
    return marks;
  }

  const WIN_MESSAGES = ["Genius", "Magnificent", "Impressive", "Splendid", "Great", "Phew"];

  let mode = $state<"daily" | "practice">("daily");
  let day = $state(todayKey());
  let target = $state("00000");
  let rows = $state<string[]>([]);
  let status = $state<Status>("playing");
  let current = $state("");
  let stats = $state<Stats>(emptyStats());
  let lockInput = $state(false);
  const winDelay =
    typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 2400;
  let showHelp = $state(false);
  let showResult = $state(false);
  let showConfetti = $state(false);
  let shaking = $state(false);
  let now = $state(Date.now());

  const marks = $derived(rows.map((row) => evaluate(row, target)));
  const done = $derived(status !== "playing");
  const winRow = $derived(status === "won" ? rows.length - 1 : -1);

  function keyStatus(digit: string): Mark | "empty" {
    let found: Mark | "empty" = "empty";
    for (let r = 0; r < rows.length; r++) {
      for (let i = 0; i < LENGTH; i++) {
        if (rows[r][i] !== digit) continue;
        if (marks[r][i] === "correct") return "correct";
        if (marks[r][i] === "present") found = "present";
        else if (found === "empty") found = "absent";
      }
    }
    return found;
  }

  const winRate = $derived(stats.played === 0 ? 0 : Math.round((stats.won / stats.played) * 100));
  const maxDistribution = $derived(Math.max(1, ...stats.distribution));

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

  function readStats(): Stats {
    try {
      const raw = localStorage.getItem(STATS_KEY);
      if (!raw) return emptyStats();
      const parsed = JSON.parse(raw) as Partial<Stats>;
      return {
        played: parsed.played || 0,
        won: parsed.won || 0,
        streak: parsed.streak || 0,
        maxStreak: parsed.maxStreak || 0,
        distribution: Array.from({ length: ATTEMPTS }, (_, i) => parsed.distribution?.[i] || 0)
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

  function persistDaily() {
    if (mode !== "daily") return;
    try {
      localStorage.setItem(dailyKey(day), JSON.stringify({ rows, status }));
    } catch {
      // Ignore storage failures; the round still works in memory.
    }
  }

  function startDaily(restore: boolean) {
    mode = "daily";
    day = todayKey();
    target = dailyTarget(day);
    current = "";
    showConfetti = false;
    if (restore) {
      try {
        const raw = localStorage.getItem(dailyKey(day));
        if (raw) {
          const parsed = JSON.parse(raw) as { rows?: string[]; status?: Status };
          const savedRows = (parsed.rows || []).filter((row) => /^\d{5}$/.test(row)).slice(0, ATTEMPTS);
          rows = savedRows;
          status = parsed.status === "won" || parsed.status === "lost" ? parsed.status : "playing";
          if (status === "won" && (rows.length === 0 || rows[rows.length - 1] !== target)) {
            rows = [];
            status = "playing";
          }
          showResult = false;
          return;
        }
      } catch {
        // Corrupt save: fall through to a fresh round.
      }
    }
    rows = [];
    status = "playing";
    showResult = false;
  }

  function startPractice() {
    mode = "practice";
    target = randomTarget();
    rows = [];
    current = "";
    status = "playing";
    showConfetti = false;
    showResult = false;
  }

  function recordResult() {
    if (mode !== "daily") return;
    stats.played++;
    if (status === "won") {
      stats.won++;
      stats.streak++;
      stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
      stats.distribution[rows.length - 1]++;
    } else {
      stats.streak = 0;
    }
    persistStats();
  }

  function submit() {
    if (status !== "playing" || showHelp || showResult || lockInput) return;
    if (current.length !== LENGTH) {
      shaking = true;
      setTimeout(() => (shaking = false), 550);
      toast.info("Not enough digits");
      return;
    }
    rows = [...rows, current];
    current = "";
    if (rows[rows.length - 1] === target) {
      // Hold the win feedback until the last tile finishes revealing.
      lockInput = true;
      setTimeout(() => {
        status = "won";
        recordResult();
        persistDaily();
        showConfetti = true;
        setTimeout(() => (showConfetti = false), 5000);
        setTimeout(() => (showResult = true), 1000);
      }, winDelay);
    } else if (rows.length >= ATTEMPTS) {
      status = "lost";
      recordResult();
      persistDaily();
      setTimeout(() => (showResult = true), 2600);
    } else {
      persistDaily();
    }
  }

  function press(key: string) {
    if (key === "Escape") {
      if (showResult) showResult = false;
      else if (showHelp) closeHelp();
      return;
    }
    if (status !== "playing" || showHelp || showResult || lockInput) return;
    if (/^\d$/.test(key)) {
      if (current.length < LENGTH) current += key;
    } else if (key === "Enter") {
      submit();
    } else if (key === "Backspace") {
      current = current.slice(0, -1);
    }
  }

  function resultText(): string {
    const score = status === "won" ? `${rows.length}` : "X";
    const head = mode === "daily" ? `Digitle ${day} — ${score}/${ATTEMPTS}` : `Digitle practice — ${score}/${ATTEMPTS}`;
    const grid = rows
      .map((row) =>
        evaluate(row, target)
          .map((mark) => (mark === "correct" ? "🟩" : mark === "present" ? "🟨" : "⬛"))
          .join("")
      )
      .join("\n");
    return `${head}\n${grid}`;
  }

  async function share() {
    const text = resultText();
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Result copied — paste it anywhere");
    } catch {
      toast.error("Copy failed in this browser");
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
    try {
      if (!localStorage.getItem(SEEN_KEY)) showHelp = true;
    } catch {
      showHelp = true;
    }
    startDaily(true);
    const id = setInterval(() => {
      now = Date.now();
      if (mode === "daily" && todayKey() !== day && status === "playing") startDaily(false);
    }, 1000);
    return () => clearInterval(id);
  });
</script>

<svelte:head>
  <title>Digitle — guess the five-digit number</title>
  <meta name="description" content="Guess the five-digit number in six tries. A daily number puzzle." />
</svelte:head>

<svelte:window
  onkeydown={(event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Enter" || event.key === "Backspace" || event.key === "Escape" || /^\d$/.test(event.key)) {
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

<div class="site-wrap digitle">
  <header class="digitle-head">
    <div>
      <h1 class="site-page-title">Digitle</h1>
      <p class="site-page-intro">Guess the five-digit number in six tries. Digits can repeat.</p>
    </div>
    <Button variant="outline" size="sm" class="gap-1.5" onclick={() => (showHelp = true)}>
      <Info class="h-4 w-4" /> How to play
    </Button>
  </header>

  <div class="digitle-modes" role="tablist" aria-label="Game mode">
    <button
      role="tab"
      aria-selected={mode === "daily"}
      class:active={mode === "daily"}
      onclick={() => startDaily(true)}
    >
      Daily · {day}
    </button>
    <button role="tab" aria-selected={mode === "practice"} class:active={mode === "practice"} onclick={startPractice}>
      Practice
    </button>
  </div>

  <p class="digitle-attempt" aria-live="polite">
    {#if status === "playing"}
      Attempt {Math.min(rows.length + 1, ATTEMPTS)} of {ATTEMPTS}
    {:else if status === "won"}
      Solved in {rows.length} {rows.length === 1 ? "try" : "tries"}
    {:else}
      The number was {target}
    {/if}
  </p>

  <div class="digitle-board" role="grid" aria-label="Guesses">
    {#each Array.from({ length: ATTEMPTS }, (_, r) => r) as r}
      {@const submitted = rows[r]}
      {@const active = !submitted && r === rows.length && status === "playing"}
      {@const letters = submitted ?? (active ? current : "")}
      {@const rowMarks = submitted ? marks[r] : null}
      <div class="digitle-row" class:digitle-shake={shaking && active} role="row">
        {#each Array.from({ length: LENGTH }, (_, i) => i) as i}
          {@const digit = letters[i] ?? ""}
          {@const mark = rowMarks?.[i]}
          {@const isWinRow = r === winRow}
          <div
            role="gridcell"
            class="digitle-tile"
            class:reveal={mark !== undefined}
            class:win={isWinRow}
            style={mark
              ? isWinRow
                ? `animation-delay:${i * 0.3}s, ${2.4 + i * 0.12}s`
                : `animation-delay:${i * 0.3}s`
              : ""}
          >
            <span class="tile-face tile-front" class:filled={digit !== "" && !mark}>{digit}</span>
            <span
              class="tile-face tile-back"
              class:correct={mark === "correct"}
              class:present={mark === "present"}
              class:absent={mark === "absent"}
              aria-hidden="true">{digit}</span
            >
          </div>
        {/each}
      </div>
    {/each}
  </div>

  <div class="digitle-keys" aria-label="Digit keyboard">
    {#each ["12345", "67890"] as row}
      <div class="digitle-keyrow">
        {#each row as key}
          {@const state = keyStatus(key)}
          <button
            class="digitle-key"
            class:key-correct={state === "correct"}
            class:key-present={state === "present"}
            class:key-absent={state === "absent"}
            disabled={status !== "playing"}
            onclick={() => press(key)}
            aria-label={`Digit ${key}`}
          >
            {key}
          </button>
        {/each}
      </div>
    {/each}
    <div class="digitle-keyrow">
      <button class="digitle-key digitle-key-wide" disabled={status !== "playing"} onclick={() => press("Enter")}>
        Enter
      </button>
      <button
        class="digitle-key digitle-key-wide"
        disabled={status !== "playing"}
        onclick={() => press("Backspace")}
        aria-label="Delete last digit"
      >
        <Delete class="h-5 w-5" />
      </button>
    </div>
  </div>

  {#if status !== "playing" && !showResult}
    <div class="digitle-actions">
      <Button onclick={() => (showResult = true)} class="gap-1.5"><Trophy class="h-4 w-4" /> See results</Button>
      {#if mode === "daily"}
        <Button variant="outline" onclick={startPractice} class="gap-1.5"><RefreshCw class="h-4 w-4" /> Practice</Button
        >
      {:else}
        <Button variant="outline" onclick={startPractice} class="gap-1.5"
          ><RefreshCw class="h-4 w-4" /> New number</Button
        >
      {/if}
    </div>
  {/if}
</div>

{#snippet demoTile(digit: string, mark: "" | Mark)}
  {#if mark}
    <div class="digitle-tile settled">
      <span class="tile-face tile-front"></span>
      <span
        class="tile-face tile-back"
        class:correct={mark === "correct"}
        class:present={mark === "present"}
        class:absent={mark === "absent"}
        aria-hidden="true">{digit}</span
      >
    </div>
  {:else}
    <div class="digitle-tile">
      <span class="tile-face tile-front filled">{digit}</span>
      <span class="tile-face tile-back" aria-hidden="true"></span>
    </div>
  {/if}
{/snippet}

{#if showHelp}
  <div
    class="digitle-overlay"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) closeHelp();
    }}
    onkeydown={(event) => {
      if (event.key === "Escape") closeHelp();
    }}
  >
    <div class="digitle-dialog" role="dialog" tabindex="-1" aria-modal="true" aria-label="How to play">
      <div class="digitle-dialog-head">
        <h2>How to play</h2>
        <button class="digitle-icon-button" onclick={() => closeHelp()} aria-label="Close help"
          ><X class="h-4 w-4" /></button
        >
      </div>
      <p>Guess the five-digit number in six tries. Type with your keyboard or tap the keys. Digits can repeat.</p>
      <div class="digitle-example">
        {@render demoTile("4", "correct")}
        {@render demoTile("1", "")}
        {@render demoTile("7", "")}
        {@render demoTile("7", "")}
        {@render demoTile("0", "")}
      </div>
      <p><strong>4</strong> is in the number and in the right spot.</p>
      <div class="digitle-example">
        {@render demoTile("2", "")}
        {@render demoTile("8", "present")}
        {@render demoTile("0", "")}
        {@render demoTile("8", "")}
        {@render demoTile("3", "")}
      </div>
      <p><strong>8</strong> is in the number but in the wrong spot.</p>
      <div class="digitle-example">
        {@render demoTile("9", "")}
        {@render demoTile("9", "")}
        {@render demoTile("5", "absent")}
        {@render demoTile("9", "")}
        {@render demoTile("9", "")}
      </div>
      <p><strong>5</strong> is not in the number at all.</p>
      <Button class="mt-5 w-full" onclick={() => closeHelp()}>Play</Button>
    </div>
  </div>
{/if}

{#if showResult}
  <div
    class="digitle-overlay"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) showResult = false;
    }}
    onkeydown={(event) => {
      if (event.key === "Escape") showResult = false;
    }}
  >
    <div class="digitle-dialog" role="dialog" tabindex="-1" aria-modal="true" aria-label="Results">
      <div class="digitle-dialog-head">
        <h2>{status === "won" ? WIN_MESSAGES[Math.min(rows.length - 1, 5)] : "Out of tries"}</h2>
        <button class="digitle-icon-button" onclick={() => (showResult = false)} aria-label="Close results">
          <X class="h-4 w-4" />
        </button>
      </div>
      {#if status === "won"}
        <p>
          Solved in {rows.length}
          {rows.length === 1 ? "try" : "tries"}{mode === "daily" ? ` · streak ${stats.streak}` : ""}.
        </p>
      {:else}
        <p>The number was <strong class="digitle-answer">{target}</strong>.</p>
      {/if}
      {#if mode === "daily"}
        <dl class="digitle-stats">
          <div>
            <dt>Played</dt>
            <dd>{stats.played}</dd>
          </div>
          <div>
            <dt>Won</dt>
            <dd>{winRate}%</dd>
          </div>
          <div>
            <dt>Streak</dt>
            <dd>{stats.streak}</dd>
          </div>
          <div>
            <dt>Best</dt>
            <dd>{stats.maxStreak}</dd>
          </div>
        </dl>
        <h3>Guess distribution</h3>
        <div class="digitle-distribution">
          {#each stats.distribution as count, i}
            <div class="digitle-dist-row">
              <span>{i + 1}</span>
              <span
                class="digitle-dist-bar"
                class:highlight={status === "won" && rows.length === i + 1}
                style={`width:${Math.max(7, (count / maxDistribution) * 100)}%`}>{count}</span
              >
            </div>
          {/each}
        </div>
        <p class="digitle-countdown">Next number in {countdown}</p>
        <p class="digitle-local-note">Personal stats, stored only on this device.</p>
      {/if}
      <div class="digitle-dialog-actions">
        <Button onclick={share} class="gap-1.5"><Share2 class="h-4 w-4" /> Share</Button>
        {#if mode === "daily"}
          <Button
            variant="outline"
            onclick={() => {
              showResult = false;
              startPractice();
            }}>Practice round</Button
          >
        {:else}
          <Button variant="outline" onclick={startPractice} class="gap-1.5"
            ><RefreshCw class="h-4 w-4" /> New number</Button
          >
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .digitle {
    max-width: 30rem;
    padding-bottom: 3rem;
  }
  .digitle-head {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 1rem;
    padding-top: 0.5rem;
  }
  .digitle-modes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    margin-top: 1.5rem;
    border: 1px solid var(--border);
    border-radius: 3px;
    overflow: hidden;
  }
  .digitle-modes button {
    padding: 0.55rem 0.5rem;
    background: transparent;
    color: var(--muted-foreground);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    border: 0;
  }
  .digitle-modes button.active {
    background: var(--viridian);
    color: var(--primary-foreground);
  }
  .digitle-attempt {
    margin: 1.1rem 0 0.7rem;
    text-align: center;
    font-size: 0.9rem;
    color: var(--muted-foreground);
    min-height: 1.4rem;
  }
  .digitle-board {
    display: grid;
    gap: 0.35rem;
  }
  .digitle-row {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0.35rem;
  }
  .digitle-tile {
    position: relative;
    aspect-ratio: 1;
    transform-style: preserve-3d;
    font-size: 1.9rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    user-select: none;
  }
  .tile-face {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    border: 2px solid var(--border);
    border-radius: 3px;
    background: var(--card);
    color: transparent;
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
  }
  .tile-front.filled {
    border-color: var(--line-strong);
    color: var(--foreground);
    animation: digitle-pop 0.12s ease-out;
  }
  .tile-back {
    transform: rotateX(180deg);
  }
  .tile-back.correct,
  .tile-back.present,
  .tile-back.absent {
    border-color: transparent;
  }
  .tile-back.correct {
    background: var(--viridian);
    color: var(--primary-foreground);
  }
  .tile-back.present {
    background: var(--saffron);
    color: #221a03;
  }
  .tile-back.absent {
    background: var(--ink-soft);
    color: var(--background);
    opacity: 0.75;
  }
  .digitle-tile.reveal {
    animation: digitle-flip 1s ease forwards;
  }
  .digitle-tile.win {
    animation:
      digitle-flip 1s ease forwards,
      digitle-win 0.65s ease forwards;
  }
  .digitle-tile.settled {
    transform: rotateX(180deg);
  }
  .digitle-row.digitle-shake {
    animation: digitle-shake 0.5s ease;
  }
  .digitle-keys {
    display: grid;
    gap: 0.4rem;
    margin-top: 1.25rem;
  }
  .digitle-keyrow {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0.4rem;
  }
  .digitle-key {
    min-height: 3.2rem;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--card);
    color: var(--foreground);
    font-size: 1.15rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }
  .digitle-key:hover:not(:disabled) {
    border-color: var(--viridian);
  }
  .digitle-key:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
  .digitle-key-wide {
    grid-column: span 2;
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 2.9rem;
  }
  .digitle-key-wide:last-child {
    grid-column: span 3;
  }
  .digitle-key.key-correct {
    background: var(--viridian);
    border-color: transparent;
    color: var(--primary-foreground);
  }
  .digitle-key.key-present {
    background: var(--saffron);
    border-color: transparent;
    color: #221a03;
  }
  .digitle-key.key-absent {
    background: var(--muted);
    border-color: transparent;
    color: var(--muted-foreground);
  }
  .digitle-actions {
    display: flex;
    gap: 0.6rem;
    justify-content: center;
    margin-top: 1.4rem;
  }
  .digitle-overlay {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: rgb(25 28 22 / 45%);
  }
  .digitle-dialog {
    width: min(26rem, 100%);
    max-height: min(90vh, 44rem);
    overflow-y: auto;
    background: var(--card);
    color: var(--foreground);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 1.4rem;
  }
  .digitle-dialog h2 {
    margin: 0;
    font-family: "Fraunces", Georgia, serif;
    font-size: 1.5rem;
    font-weight: 600;
  }
  .digitle-dialog h3 {
    margin: 1.1rem 0 0.4rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--muted-foreground);
  }
  .digitle-dialog p {
    margin: 0.7rem 0 0;
    font-size: 0.92rem;
    line-height: 1.55;
  }
  .digitle-dialog-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .digitle-icon-button {
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
  .digitle-example {
    display: grid;
    grid-template-columns: repeat(5, 2.6rem);
    gap: 0.25rem;
    margin-top: 0.8rem;
  }
  .digitle-example .digitle-tile {
    font-size: 1.4rem;
  }
  .digitle-example .tile-face {
    border-width: 2px;
  }
  .digitle-answer {
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.2em;
  }
  .digitle-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    margin: 1.1rem 0 0;
    text-align: center;
  }
  .digitle-stats dt {
    font-size: 0.68rem;
    color: var(--muted-foreground);
  }
  .digitle-stats dd {
    margin: 0.15rem 0 0;
    font-size: 1.6rem;
    font-weight: 700;
  }
  .digitle-distribution {
    display: grid;
    gap: 0.25rem;
    margin-top: 0.4rem;
  }
  .digitle-dist-row {
    display: grid;
    grid-template-columns: 1rem 1fr;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.8rem;
    font-weight: 600;
  }
  .digitle-dist-bar {
    min-width: 1.4rem;
    padding: 0.1rem 0.4rem;
    text-align: right;
    background: var(--muted);
    color: var(--muted-foreground);
    border-radius: 2px;
    font-variant-numeric: tabular-nums;
  }
  .digitle-dist-bar.highlight {
    background: var(--viridian);
    color: var(--primary-foreground);
  }
  .digitle-countdown {
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .digitle-local-note {
    margin-top: 0.2rem;
    text-align: center;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .digitle-dialog-actions {
    display: flex;
    gap: 0.6rem;
    margin-top: 1.2rem;
  }
  .digitle-dialog-actions > :global(*) {
    flex: 1;
  }
  @keyframes digitle-pop {
    from {
      transform: scale(0.85);
    }
    to {
      transform: scale(1);
    }
  }
  @keyframes digitle-flip {
    from {
      transform: perspective(36rem) rotateX(0);
    }
    to {
      transform: perspective(36rem) rotateX(180deg);
    }
  }
  @keyframes digitle-win {
    0%,
    100% {
      transform: perspective(36rem) rotateX(180deg) translateY(0);
    }
    30% {
      transform: perspective(36rem) rotateX(180deg) translateY(-0.9rem);
    }
    60% {
      transform: perspective(36rem) rotateX(180deg) translateY(0.25rem);
    }
  }
  @keyframes digitle-shake {
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
    .digitle-tile.reveal,
    .digitle-tile.win {
      animation: none;
      transform: rotateX(180deg);
    }
    .tile-front.filled,
    .digitle-row.digitle-shake {
      animation: none;
    }
  }
</style>
