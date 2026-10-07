<script lang="ts">
  import { onMount, tick } from "svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Confetti } from "svelte-confetti";
  import { toast } from "svelte-sonner";
  import { Check, Delete, Eraser, Flag, Info, RefreshCw, Trophy, X } from "@lucide/svelte/icons";
  import puzzlesData from "#lib/crossmath/puzzles.json";
  import { hashSeed, mulberry32, pickDaily, todayKey } from "#lib/random.js";
  import { checkLine, type Difficulty, type Op, type Puzzle } from "#lib/crossmath/model.js";

  const allPuzzles = puzzlesData as unknown as Puzzle[];

  type Status = "playing" | "won" | "revealed";
  type LineState = "incomplete" | "correct" | "wrong";

  const STATS_KEY = "crossmath.stats.v1";
  const SEEN_KEY = "crossmath.seen.v1";
  const MODE_KEY = "crossmath.mode.v1";
  const PRACTICE_KEY = "crossmath.practice.v1";
  const dailyKey = (day: string) => `crossmath.daily.v1.${day}`;

  interface Stats {
    played: number;
    won: number;
    streak: number;
    maxStreak: number;
    mistakesTotal: number;
    /** Local day string of the last completed daily, to detect skipped days. */
    lastDay: string;
  }

  const emptyStats = (): Stats => ({
    played: 0,
    won: 0,
    streak: 0,
    maxStreak: 0,
    mistakesTotal: 0,
    lastDay: ""
  });

  function yesterdayKey(date = new Date()): string {
    const d = new Date(date);
    d.setDate(d.getDate() - 1);
    return todayKey(d);
  }

  function cellKey(r: number, c: number): string {
    return `${r},${c}`;
  }

  function parseKey(k: string): { r: number; c: number } {
    const [r, c] = k.split(",").map(Number);
    return { r: r!, c: c! };
  }

  function cellId(k: string): string {
    return `cm-cell-${k.replace(",", "-")}`;
  }

  function displayGlyph(glyph: string): string {
    if (glyph === "*") return "×";
    if (glyph === "/") return "÷";
    if (glyph === "-") return "−";
    return glyph;
  }

  /** Track sizes: number/result tracks are full squares, operator and
   * equals tracks are narrow gutters so the grid reads as one matrix. */
  function trackSize(i: number): string {
    const n = puzzle.size;
    if (i === 2 * n) return "3rem";
    if (i < 2 * n - 1 && i % 2 === 0) return "3rem";
    return "1.2rem";
  }
  const gridTracks = $derived.by(() => {
    const list = Array.from({ length: puzzle.size * 2 + 1 }, (_, i) => trackSize(i));
    return `grid-template-columns: ${list.join(" ")}; grid-template-rows: ${list.join(" ")};`;
  });

  // Initialise to today's daily puzzle up front so the first paint already
  // shows the right grid. onMount then restores any saved progress on top.
  const initialDay = todayKey();
  let mode = $state<"daily" | "practice">("daily");
  let day = $state(initialDay);
  let practiceDifficulty = $state<Difficulty>("easy");
  let puzzle = $state<Puzzle>(pickDaily(allPuzzles, initialDay, "crossmath"));
  /** placements maps a blank cell key to the id of the bank tile sitting in it. */
  let placements = $state<Record<string, number>>({});
  let mistakes = $state(0);
  let status = $state<Status>("playing");
  let finished = $state(false);
  let selected = $state<string | null>(null);
  let selectedTile = $state<number | null>(null);
  /** Typed digits narrow the bank to a matching tile. */
  let tileFilter = $state("");
  let filterTimer: ReturnType<typeof setTimeout> | undefined;
  let stats = $state<Stats>(emptyStats());
  let showHelp = $state(false);
  let showResult = $state(false);
  let showConfetti = $state(false);
  let shakingCells = $state<string[]>([]);
  let shakingLines = $state<string[]>([]);
  let lastLineSnapshot = $state("");
  let now = $state(Date.now());
  let helpDialog = $state<HTMLDivElement>();
  let resultDialog = $state<HTMLDivElement>();
  let timers: ReturnType<typeof setTimeout>[] = [];

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

  function clearFilterTimer() {
    if (filterTimer !== undefined) {
      clearTimeout(filterTimer);
      filterTimer = undefined;
    }
  }

  const givenMap = $derived(new Map(puzzle.givens.map((g) => [cellKey(g.r, g.c), g.value])));
  const blankKeys = $derived(
    Array.from({ length: puzzle.size }, (_, r) => Array.from({ length: puzzle.size }, (_, c) => cellKey(r, c)))
      .flat()
      .filter((k) => !givenMap.has(k))
  );

  /** The tile bank: one tile per blank cell, holding that cell's solution
   * value. Shuffled deterministically per puzzle so save files (which store
   * tile ids) stay valid across reloads. */
  interface Tile {
    id: number;
    value: number;
  }
  const tiles = $derived.by<Tile[]>(() => {
    const rng = mulberry32(hashSeed(`crossmath-bank-${puzzle.id}`));
    const list: Tile[] = blankKeys.map((k, i) => {
      const { r, c } = parseKey(k);
      return { id: i, value: puzzle.solution[r]![c]! };
    });
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [list[i], list[j]] = [list[j]!, list[i]!];
    }
    return list;
  });
  const tileById = $derived(new Map(tiles.map((t) => [t.id, t])));
  const placedTileIds = $derived(new Set(Object.values(placements)));
  const remainingTiles = $derived(tiles.filter((t) => !placedTileIds.has(t.id)));

  /** Entered numbers: givens plus placed tiles. */
  const numbers = $derived.by<Map<string, number>>(() => {
    const map = new Map<string, number>();
    for (const [k, v] of givenMap) map.set(k, v);
    for (const [k, tileId] of Object.entries(placements)) {
      const tile = tileById.get(tileId);
      if (tile !== undefined) map.set(k, tile.value);
    }
    return map;
  });

  interface EvaluatedLine {
    id: string;
    state: LineState;
  }

  function evalRow(r: number): EvaluatedLine {
    const nums: number[] = [];
    for (let c = 0; c < puzzle.size; c++) {
      const v = numbers.get(cellKey(r, c));
      if (v === undefined) return { id: `row-${r}`, state: "incomplete" };
      nums.push(v);
    }
    const ok = checkLine(nums, puzzle.rowOps[r]!, puzzle.rowResults[r]!);
    return { id: `row-${r}`, state: ok ? "correct" : "wrong" };
  }

  function evalCol(c: number): EvaluatedLine {
    const nums: number[] = [];
    for (let r = 0; r < puzzle.size; r++) {
      const v = numbers.get(cellKey(r, c));
      if (v === undefined) return { id: `col-${c}`, state: "incomplete" };
      nums.push(v);
    }
    const ops = puzzle.colOps.map((row) => row[c]!) as Op[];
    const ok = checkLine(nums, ops, puzzle.colResults[c]!);
    return { id: `col-${c}`, state: ok ? "correct" : "wrong" };
  }

  const lineStates = $derived<EvaluatedLine[]>([
    ...Array.from({ length: puzzle.size }, (_, r) => evalRow(r)),
    ...Array.from({ length: puzzle.size }, (_, c) => evalCol(c))
  ]);
  const lineStateMap = $derived(new Map(lineStates.map((s) => [s.id, s.state])));

  function lineIdsForCell(k: string): string[] {
    const { r, c } = parseKey(k);
    return [`row-${r}`, `col-${c}`];
  }

  function cellFeedback(k: string): LineState | "neutral" {
    let found: LineState | "neutral" = "neutral";
    for (const id of lineIdsForCell(k)) {
      const state = lineStateMap.get(id);
      if (state === "wrong") return "wrong";
      if (state === "correct") found = "correct";
    }
    return found;
  }

  const winRate = $derived(stats.played === 0 ? 0 : Math.round((stats.won / stats.played) * 100));

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
        mistakesTotal: parsed.mistakesTotal || 0,
        lastDay: parsed.lastDay || ""
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
      localStorage.setItem(dailyKey(day), JSON.stringify({ puzzleId: puzzle.id, placements, mistakes, status }));
    } catch {
      // Ignore storage failures; the round still works in memory.
    }
  }

  function persistMode() {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // Ignore storage failures.
    }
  }

  function persistPractice() {
    if (mode !== "practice") return;
    try {
      localStorage.setItem(
        PRACTICE_KEY,
        JSON.stringify({ difficulty: practiceDifficulty, puzzleId: puzzle.id, placements, mistakes, status })
      );
    } catch {
      // Ignore storage failures; the round still works in memory.
    }
  }

  /** Keep only placements that reference real blank cells and real tiles. */
  function cleanPlacements(raw: Record<string, number> | undefined): Record<string, number> {
    const clean: Record<string, number> = {};
    const seen = new Set<number>();
    for (const k of blankKeys) {
      const id = raw?.[k];
      if (typeof id !== "number" || seen.has(id)) continue;
      if (!tileById.has(id)) continue;
      seen.add(id);
      clean[k] = id;
    }
    return clean;
  }

  function cleanMistakes(value: unknown): number {
    return typeof value === "number" && value >= 0 ? Math.floor(value) : 0;
  }

  function applyFinishedStatus(value: unknown) {
    if (value === "won" || value === "revealed") {
      status = value;
      finished = true;
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

  function resetRound(next: Puzzle) {
    clearTimers();
    clearFilterTimer();
    puzzle = next;
    placements = {};
    mistakes = 0;
    status = "playing";
    finished = false;
    selected = null;
    selectedTile = null;
    tileFilter = "";
    showConfetti = false;
    showResult = false;
    shakingCells = [];
    shakingLines = [];
    lastLineSnapshot = "";
  }

  function startDaily(restore: boolean) {
    mode = "daily";
    persistMode();
    day = todayKey();
    resetRound(pickDaily(allPuzzles, day, "crossmath"));
    if (!restore) return;
    try {
      const raw = localStorage.getItem(dailyKey(day));
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        puzzleId?: string;
        placements?: Record<string, number>;
        mistakes?: number;
        status?: Status;
      };
      if (parsed.puzzleId !== puzzle.id) return;
      placements = cleanPlacements(parsed.placements);
      mistakes = cleanMistakes(parsed.mistakes);
      applyFinishedStatus(parsed.status);
    } catch {
      // Corrupt save: fall through with a fresh round.
    }
  }

  function startPractice(difficulty: Difficulty = practiceDifficulty) {
    practiceDifficulty = difficulty;
    mode = "practice";
    persistMode();
    const pool = allPuzzles.filter((p) => p.difficulty === difficulty);
    const source = pool.length > 0 ? pool : allPuzzles;
    let next = source[Math.floor(Math.random() * source.length)]!;
    if (source.length > 1) {
      while (next.id === puzzle.id) next = source[Math.floor(Math.random() * source.length)]!;
    }
    resetRound(next);
    persistPractice();
  }

  function restorePractice(): boolean {
    try {
      const raw = localStorage.getItem(PRACTICE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as {
        difficulty?: Difficulty;
        puzzleId?: string;
        placements?: Record<string, number>;
        mistakes?: number;
        status?: Status;
      };
      const difficulty: Difficulty =
        parsed.difficulty === "medium" || parsed.difficulty === "hard" ? parsed.difficulty : "easy";
      const pool = allPuzzles.filter((p) => p.difficulty === difficulty);
      const saved = (pool.length > 0 ? pool : allPuzzles).find((p) => p.id === parsed.puzzleId);
      if (!saved) return false;
      practiceDifficulty = difficulty;
      mode = "practice";
      resetRound(saved);
      placements = cleanPlacements(parsed.placements);
      mistakes = cleanMistakes(parsed.mistakes);
      applyFinishedStatus(parsed.status);
      return true;
    } catch {
      return false;
    }
  }

  function recordWin() {
    if (finished || mode !== "daily") return;
    finished = true;
    stats.played++;
    stats.won++;
    // A streak only continues from yesterday; a skipped day restarts it.
    stats.streak = stats.lastDay === yesterdayKey() ? stats.streak + 1 : 1;
    stats.lastDay = day;
    stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
    stats.mistakesTotal += mistakes;
    persistStats();
  }

  function recordLoss() {
    if (finished || mode !== "daily") return;
    finished = true;
    stats.played++;
    stats.streak = 0;
    stats.lastDay = day;
    stats.mistakesTotal += mistakes;
    persistStats();
  }

  function win() {
    if (status !== "playing") return;
    status = "won";
    recordWin();
    persistDaily();
    persistPractice();
    if (!prefersReducedMotion()) {
      showConfetti = true;
      schedule(() => (showConfetti = false), 5000);
      schedule(() => (showResult = true), 700);
    } else {
      showResult = true;
    }
  }

  function firstEmpty(): string | null {
    return blankKeys.find((k) => !numbers.has(k)) ?? blankKeys[0] ?? null;
  }

  function nextBlank(k: string): string | null {
    if (blankKeys.length === 0) return null;
    const i = blankKeys.indexOf(k);
    if (i === -1) return blankKeys[0]!;
    return blankKeys[(i + 1) % blankKeys.length]!;
  }

  function focusCell(k: string | null) {
    if (!k) return;
    selected = k;
    document.getElementById(cellId(k))?.focus();
  }

  function save() {
    persistDaily();
    persistPractice();
  }

  function checkWin() {
    if (status === "playing" && lineStates.every((s) => s.state === "correct")) win();
  }

  /** Put a tile into a cell, returning any tile already there to the bank. */
  function placeTile(tileId: number, k: string) {
    if (status !== "playing" || showHelp || showResult) return;
    if (!blankKeys.includes(k)) return;
    const tile = tileById.get(tileId);
    if (!tile || placedTileIds.has(tileId)) return;
    placements = { ...placements, [k]: tileId };
    selected = k;
    selectedTile = null;
    tileFilter = "";
    clearFilterTimer();
    save();
    checkWin();
  }

  /** Lift the tile out of a cell back into the bank. */
  function removeTile(k: string) {
    if (status !== "playing" || showHelp || showResult) return;
    if (placements[k] === undefined) return;
    const next = { ...placements };
    delete next[k];
    placements = next;
    selected = k;
    save();
  }

  function onCellTap(k: string) {
    if (status !== "playing") return;
    if (selectedTile !== null) {
      if (placements[k] === selectedTile) {
        selectedTile = null;
        selected = k;
      } else {
        placeTile(selectedTile, k);
        focusCell(k);
      }
      return;
    }
    if (placements[k] !== undefined) {
      removeTile(k);
      focusCell(k);
      return;
    }
    selected = k;
    focusCell(k);
  }

  function onTileTap(tileId: number) {
    if (status !== "playing" || showHelp || showResult) return;
    if (placedTileIds.has(tileId)) {
      const cell = blankKeys.find((k) => placements[k] === tileId);
      if (cell !== undefined) {
        removeTile(cell);
        focusCell(cell);
      }
      selectedTile = null;
      return;
    }
    if (selectedTile === tileId) {
      selectedTile = null;
      return;
    }
    selectedTile = tileId;
    tileFilter = "";
    clearFilterTimer();
    // Fast path: a cell is already selected, so drop the tile straight in.
    // Otherwise the tile stays selected until a cell is tapped.
    const target = selected && blankKeys.includes(selected) ? selected : null;
    if (target && placements[target] === undefined) {
      placeTile(tileId, target);
      focusCell(nextBlank(target));
    }
  }

  function moveSelection(from: string, dr: number, dc: number) {
    const origin = parseKey(from);
    let best: string | null = null;
    let bestScore = Infinity;
    for (const k of blankKeys) {
      if (k === from) continue;
      const p = parseKey(k);
      const vr = p.r - origin.r;
      const vc = p.c - origin.c;
      if (dr !== 0 && (Math.sign(vr) !== dr || vc !== 0)) continue;
      if (dc !== 0 && (Math.sign(vc) !== dc || vr !== 0)) continue;
      const score = Math.abs(vr) + Math.abs(vc);
      if (score < bestScore) {
        bestScore = score;
        best = k;
      }
    }
    focusCell(best ?? nextBlank(from));
  }

  function press(key: string) {
    if (key === "Escape") {
      if (showResult) showResult = false;
      else if (showHelp) closeHelp();
      else {
        selected = null;
        selectedTile = null;
        tileFilter = "";
        clearFilterTimer();
      }
      return;
    }
    if (status !== "playing" || showHelp || showResult) return;
    if (/^\d$/.test(key)) {
      // Typing narrows the remaining bank to a matching tile.
      tileFilter += key;
      clearFilterTimer();
      filterTimer = setTimeout(() => {
        tileFilter = "";
      }, 1200);
      let candidates = remainingTiles.filter((t) => String(t.value).startsWith(tileFilter));
      if (candidates.length === 0) {
        tileFilter = key;
        candidates = remainingTiles.filter((t) => String(t.value).startsWith(tileFilter));
      }
      if (candidates.length === 0) {
        tileFilter = "";
        toast.info("No tiles start with that number");
        return;
      }
      const exact = candidates.filter((t) => String(t.value) === tileFilter);
      const pick = (exact.length > 0 ? exact : candidates)[0]!;
      selectedTile = pick.id;
      const target = selected && blankKeys.includes(selected) ? selected : firstEmpty();
      // Drop the tile straight in only when nothing longer shares the typed
      // prefix; otherwise keep it selected so the next digit can narrow it
      // (e.g. typing "1" must still reach tile "12" while tile "1" remains).
      const onlyExact = candidates.every((t) => String(t.value) === tileFilter);
      if (onlyExact) {
        if (target) {
          placeTile(pick.id, target);
          focusCell(nextBlank(target));
        }
      } else if (target) {
        selected = target;
      }
    } else if (key === "Backspace") {
      const target = selected && blankKeys.includes(selected) ? selected : firstEmpty();
      if (!target) return;
      if (placements[target] !== undefined) {
        removeTile(target);
        focusCell(target);
      } else if (selectedTile !== null || tileFilter !== "") {
        selectedTile = null;
        tileFilter = "";
        clearFilterTimer();
      } else {
        const keys = blankKeys;
        const i = keys.indexOf(target);
        const prev = keys[(i - 1 + keys.length) % keys.length]!;
        removeTile(prev);
        focusCell(prev);
      }
    } else if (key === "Enter") {
      if (selectedTile !== null) {
        const target = selected && blankKeys.includes(selected) ? selected : firstEmpty();
        if (target) {
          placeTile(selectedTile, target);
          focusCell(nextBlank(target));
        }
      } else {
        check();
      }
    }
  }

  function cellSolution(k: string): number {
    const { r, c } = parseKey(k);
    return puzzle.solution[r]![c]!;
  }

  function check() {
    if (status !== "playing" || showHelp || showResult) return;
    const empty = blankKeys.filter((k) => !numbers.has(k));
    if (empty.length > 0) {
      shakingCells = empty;
      schedule(() => (shakingCells = []), 550);
      toast.info(
        remainingTiles.length > 0 ? `Place the remaining ${remainingTiles.length} tiles first` : "Fill every blank first"
      );
      focusCell(empty[0]!);
      return;
    }
    const wrong = blankKeys.filter((k) => numbers.get(k) !== cellSolution(k));
    if (wrong.length === 0) {
      win();
      return;
    }
    mistakes += wrong.length;
    save();
    shakingCells = wrong;
    schedule(() => (shakingCells = []), 550);
    focusCell(wrong[0]!);
    toast.error(wrong.length === 1 ? "1 tile is in the wrong cell" : `${wrong.length} tiles are in the wrong cells`);
  }

  function clearAll() {
    if (status !== "playing") return;
    placements = {};
    selectedTile = null;
    tileFilter = "";
    clearFilterTimer();
    save();
    focusCell(firstEmpty());
  }

  function reveal() {
    if (status !== "playing") return;
    const filled: Record<string, number> = {};
    for (const tile of tiles) {
      const cell = blankKeys.find((k) => cellSolution(k) === tile.value && filled[k] === undefined);
      if (cell !== undefined) filled[cell] = tile.id;
    }
    placements = filled;
    status = "revealed";
    recordLoss();
    save();
    schedule(() => (showResult = true), prefersReducedMotion() ? 0 : 400);
  }

  function closeHelp() {
    showHelp = false;
    try {
      localStorage.setItem(SEEN_KEY, "true");
    } catch {
      // Ignore storage failures.
    }
  }

  function onCellKeydown(k: string, event: KeyboardEvent) {
    // These keys are handled here; stop them bubbling to the window handler
    // so a focused cell does not process the same keypress twice.
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      moveSelection(k, -1, 0);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      moveSelection(k, 1, 0);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      moveSelection(k, 0, -1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      moveSelection(k, 0, 1);
    } else if (event.key === "Backspace" || event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      selected = k;
      press(event.key);
    } else if (/^\d$/.test(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      selected = k;
      press(event.key);
    } else if (event.key === "Tab") {
      // Let Tab move naturally, but track the new cell.
      schedule(() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && active.dataset.cell) selected = active.dataset.cell;
      }, 0);
    }
  }

  function onDropToCell(k: string, event: DragEvent) {
    event.preventDefault();
    const id = Number(event.dataTransfer?.getData("text/crossmath-tile"));
    if (Number.isInteger(id)) {
      selected = k;
      placeTile(id, k);
      focusCell(k);
    }
  }

  onMount(() => {
    stats = readStats();
    try {
      if (!localStorage.getItem(SEEN_KEY)) showHelp = true;
    } catch {
      showHelp = true;
    }
    let savedMode = "daily";
    try {
      savedMode = localStorage.getItem(MODE_KEY) ?? "daily";
    } catch {
      savedMode = "daily";
    }
    if (savedMode === "practice" && restorePractice()) {
      // Practice round (with its difficulty) restored above.
    } else {
      startDaily(true);
    }
    const id = setInterval(() => {
      if (mode !== "daily") return;
      now = Date.now();
      if (todayKey() !== day) startDaily(false);
    }, 1000);
    return () => {
      clearInterval(id);
      clearTimers();
      clearFilterTimer();
    };
  });

  // Shake any line the moment it becomes fully filled but wrong.
  $effect(() => {
    const current: Record<string, LineState> = {};
    for (const s of lineStates) current[s.id] = s.state;
    const previous = lastLineSnapshot ? (JSON.parse(lastLineSnapshot) as Record<string, LineState>) : {};
    lastLineSnapshot = JSON.stringify(current);
    if (status !== "playing" || prefersReducedMotion()) return;
    const newlyWrong = Object.keys(current).filter((id) => current[id] === "wrong" && previous[id] !== "wrong");
    if (newlyWrong.length === 0) return;
    shakingLines = [...new Set([...shakingLines, ...newlyWrong])];
    schedule(() => {
      shakingLines = shakingLines.filter((id) => !newlyWrong.includes(id));
    }, 550);
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
  <title>Crossmath — the arithmetic crossword</title>
  <meta
    name="description"
    content="Fill the arithmetic crossword so every row and column hits its result. A daily crossmath puzzle plus practice rounds."
  />
</svelte:head>

<svelte:window
  onkeydown={(event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (
      target?.closest("button, a, textarea, select, [contenteditable]") &&
      (event.key === "Enter" || event.key === " ")
    ) {
      return;
    }
    if (
      event.key === "Enter" ||
      event.key === "Backspace" ||
      event.key === "Escape" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      /^\d$/.test(event.key)
    ) {
      event.preventDefault();
      if (event.key.startsWith("Arrow")) {
        const from = selected && blankKeys.includes(selected) ? selected : firstEmpty();
        if (!from) return;
        const dir =
          event.key === "ArrowUp"
            ? [-1, 0]
            : event.key === "ArrowDown"
              ? [1, 0]
              : event.key === "ArrowLeft"
                ? [0, -1]
                : [0, 1];
        moveSelection(from, dir[0]!, dir[1]!);
        return;
      }
      press(event.key);
    }
  }}
/>

{#if showConfetti}
  <div class="pointer-events-none fixed left-0 top-[-50px] z-50 flex h-screen w-screen justify-center overflow-hidden">
    <Confetti x={[-5, 5]} y={[0, 0.1]} delay={[500, 2000]} infinite duration={4000} amount={400} fallDistance="100vh" />
  </div>
{/if}

<div class="site-wrap crossmath">
  <header class="crossmath-head">
    <div>
      <h1 class="site-page-title">Crossmath</h1>
      <p class="site-page-intro">
        Fill the blanks so every row and column hits its result. <span class="crossmath-badge">{puzzle.difficulty}</span
        >
      </p>
    </div>
    <Button variant="outline" size="sm" class="gap-1.5" onclick={() => (showHelp = true)}>
      <Info class="h-4 w-4" /> How to play
    </Button>
  </header>

  <div class="crossmath-modes" role="group" aria-label="Game mode">
    <button aria-pressed={mode === "daily"} class:active={mode === "daily"} onclick={() => startDaily(true)}>
      Daily · {day}
    </button>
    <button aria-pressed={mode === "practice"} class:active={mode === "practice"} onclick={() => startPractice()}>
      Practice
    </button>
  </div>

  {#if mode === "practice"}
    <div class="crossmath-difficulties" role="group" aria-label="Practice difficulty">
      {#each ["easy", "medium", "hard"] as level}
        <button
          aria-pressed={practiceDifficulty === level}
          class:active={practiceDifficulty === level}
          onclick={() => startPractice(level as Difficulty)}
        >
          {level}
        </button>
      {/each}
      <button class="crossmath-new" onclick={() => startPractice()} aria-label="New practice puzzle">
        <RefreshCw class="h-4 w-4" /> New puzzle
      </button>
    </div>
  {/if}

  <p class="crossmath-status" aria-live="polite">
    {#if status === "playing"}
      {remainingTiles.length} of {tiles.length} tiles left · mistakes {mistakes}
    {:else if status === "won"}
      Solved with {mistakes} {mistakes === 1 ? "mistake" : "mistakes"}
    {:else}
      Solution revealed
    {/if}
  </p>

  <div class="crossmath-grid" role="grid" aria-label="Crossmath puzzle" style={gridTracks}>
    {#each Array.from({ length: puzzle.size * 2 + 1 }, (_, gr) => gr) as gr}
      {#each Array.from({ length: puzzle.size * 2 + 1 }, (_, gc) => gc) as gc}
        {@const n = puzzle.size}
        {#if gr < 2 * n - 1 && gr % 2 === 0}
          {@const r = gr / 2}
          {#if gc < 2 * n - 1 && gc % 2 === 0}
            {@const c = gc / 2}
            {@const k = cellKey(r, c)}
            {@const given = givenMap.get(k)}
            {@const feedback = cellFeedback(k)}
            {@const inShakingLine = lineIdsForCell(k).some((id) => shakingLines.includes(id))}
            {#if given !== undefined}
              <div
                role="gridcell"
                aria-label={`Row ${r + 1} column ${c + 1}, given ${given}`}
                class="crossmath-cell crossmath-given"
              >
                {given}
              </div>
            {:else}
              {@const placedId = placements[k]}
              {@const placedValue = placedId !== undefined ? tileById.get(placedId)?.value : undefined}
              <button
                type="button"
                id={cellId(k)}
                data-cell={k}
                aria-label={placedValue !== undefined
                  ? `Row ${r + 1} column ${c + 1}, tile ${placedValue}. Activate to return it to the bank.`
                  : `Row ${r + 1} column ${c + 1}, empty. Activate to place the selected tile.`}
                class="crossmath-cell crossmath-blank"
                class:cell-correct={feedback === "correct"}
                class:cell-wrong={feedback === "wrong"}
                class:cell-shake={shakingCells.includes(k) || inShakingLine}
                class:cell-selected={selected === k}
                class:cell-filled={placedValue !== undefined}
                disabled={status !== "playing"}
                onclick={() => onCellTap(k)}
                onkeydown={(event) => onCellKeydown(k, event)}
                onfocus={() => (selected = k)}
                ondragover={(event) => {
                  if (status === "playing") event.preventDefault();
                }}
                ondrop={(event) => onDropToCell(k, event)}
              >
                {placedValue ?? ""}
              </button>
            {/if}
          {:else if gc < 2 * n - 1}
            <div role="presentation" class="crossmath-cell crossmath-op" aria-hidden="true">
              {displayGlyph(puzzle.rowOps[r]![(gc - 1) / 2]!)}
            </div>
          {:else if gc === 2 * n - 1}
            <div role="presentation" class="crossmath-cell crossmath-eq" aria-hidden="true">=</div>
          {:else}
            <div
              role="gridcell"
              aria-label={`Row ${r + 1} result ${puzzle.rowResults[r]}`}
              class="crossmath-cell crossmath-result"
            >
              {puzzle.rowResults[r]}
            </div>
          {/if}
        {:else if gr < 2 * n - 1}
          {@const k = (gr - 1) / 2}
          {#if gc <= 2 * n - 2 && gc % 2 === 0}
            <div role="presentation" class="crossmath-cell crossmath-op" aria-hidden="true">
              {displayGlyph(puzzle.colOps[k]![gc / 2]!)}
            </div>
          {:else}
            <div role="presentation" class="crossmath-cell crossmath-void" aria-hidden="true"></div>
          {/if}
        {:else if gr === 2 * n - 1}
          {#if gc <= 2 * n - 2 && gc % 2 === 0}
            <div role="presentation" class="crossmath-cell crossmath-eq" aria-hidden="true">=</div>
          {:else}
            <div role="presentation" class="crossmath-cell crossmath-void" aria-hidden="true"></div>
          {/if}
        {:else}
          {@const c = gc / 2}
          {#if gc % 2 === 0 && c < n}
            <div
              role="gridcell"
              aria-label={`Column ${c + 1} result ${puzzle.colResults[c]}`}
              class="crossmath-cell crossmath-result"
            >
              {puzzle.colResults[c]}
            </div>
          {:else}
            <div role="presentation" class="crossmath-cell crossmath-void" aria-hidden="true"></div>
          {/if}
        {/if}
      {/each}
    {/each}
  </div>

  <div
    class="crossmath-bank"
    role="group"
    aria-label={`Number tiles, ${remainingTiles.length} of ${tiles.length} left`}
    ondragover={(event) => {
      if (status === "playing") event.preventDefault();
    }}
    ondrop={(event) => {
      event.preventDefault();
      const id = Number(event.dataTransfer?.getData("text/crossmath-tile"));
      if (!Number.isInteger(id)) return;
      const cell = blankKeys.find((k) => placements[k] === id);
      if (cell !== undefined) {
        removeTile(cell);
        focusCell(cell);
      }
    }}
  >
    {#each tiles as tile (tile.id)}
      {@const placed = placedTileIds.has(tile.id)}
      <button
        type="button"
        class="crossmath-tile"
        class:tile-selected={selectedTile === tile.id}
        class:tile-placed={placed}
        disabled={status !== "playing"}
        draggable={!placed && status === "playing" ? "true" : undefined}
        ondragstart={(event) => {
          event.dataTransfer?.setData("text/crossmath-tile", String(tile.id));
        }}
        onclick={() => onTileTap(tile.id)}
        aria-label={placed ? `Tile ${tile.value}, placed. Activate to return it.` : `Tile ${tile.value}`}
        aria-pressed={selectedTile === tile.id}
      >
        {tile.value}
      </button>
    {/each}
  </div>

  <div class="crossmath-pad" aria-label="Digit keyboard">
    <div class="crossmath-pad-row">
      {#each ["1", "2", "3", "4", "5"] as digit}
        <button
          class="crossmath-key"
          disabled={status !== "playing"}
          onclick={() => press(digit)}
          aria-label={`Digit ${digit}`}
        >
          {digit}
        </button>
      {/each}
    </div>
    <div class="crossmath-pad-row">
      {#each ["6", "7", "8", "9", "0"] as digit}
        <button
          class="crossmath-key"
          disabled={status !== "playing"}
          onclick={() => press(digit)}
          aria-label={`Digit ${digit}`}
        >
          {digit}
        </button>
      {/each}
    </div>
    <div class="crossmath-pad-row">
      <button
        class="crossmath-key crossmath-key-action"
        disabled={status !== "playing"}
        onclick={() => press("Backspace")}
        aria-label="Delete digit"
      >
        <Delete class="h-5 w-5" />
      </button>
      <button
        class="crossmath-key crossmath-key-action"
        disabled={status !== "playing"}
        onclick={clearAll}
        aria-label="Clear all blanks"
      >
        <Eraser class="h-5 w-5" />
      </button>
      <button
        class="crossmath-key crossmath-key-check"
        disabled={status !== "playing"}
        onclick={check}
        aria-label="Check solution"
      >
        <Check class="h-5 w-5" /> Check
      </button>
    </div>
  </div>

  <div class="crossmath-actions">
    {#if status === "playing"}
      <Button variant="outline" onclick={reveal} class="gap-1.5"><Flag class="h-4 w-4" /> Give up</Button>
    {:else}
      <Button onclick={() => (showResult = true)} class="gap-1.5"><Trophy class="h-4 w-4" /> See results</Button>
      {#if mode === "daily"}
        <Button variant="outline" onclick={() => startPractice()} class="gap-1.5"
          ><RefreshCw class="h-4 w-4" /> Practice</Button
        >
      {:else}
        <Button variant="outline" onclick={() => startPractice()} class="gap-1.5"
          ><RefreshCw class="h-4 w-4" /> New puzzle</Button
        >
      {/if}
    {/if}
  </div>
</div>

{#if showHelp}
  <div
    class="crossmath-overlay"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) closeHelp();
    }}
    onkeydown={(event) => {
      if (event.key === "Escape") closeHelp();
    }}
  >
    <div
      class="crossmath-dialog"
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-label="How to play"
      bind:this={helpDialog}
      onkeydown={(event) => trapFocus(event, helpDialog)}
    >
      <div class="crossmath-dialog-head">
        <h2>How to play</h2>
        <button class="crossmath-icon-button" onclick={() => closeHelp()} aria-label="Close help"
          ><X class="h-4 w-4" /></button
        >
      </div>
      <p>
        Place every tile from the bank into the blanks so each row and column hits its result, like
        <strong>12 + 3 = 15</strong>. Drag a tile into any blank, or tap a tile and then tap a cell. Tapping a placed
        tile returns it to the bank. You can also type: digits pick the matching tile, arrow keys move between blanks,
        Backspace lifts a tile out.
      </p>
      <p>
        Lines use the standard order of operations: × and ÷ first, then + and −. Division must come out exact, with no
        remainder. Lines light up <strong class="crossmath-good">green</strong> when they are fully correct and
        <strong class="crossmath-bad">red</strong> when every cell is filled but the math does not hold. Press Check when
        every tile is placed — each tile in the wrong cell counts as a mistake.
      </p>
      <Button class="mt-5 w-full" onclick={() => closeHelp()}>Play</Button>
    </div>
  </div>
{/if}

{#if showResult}
  <div
    class="crossmath-overlay"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) showResult = false;
    }}
    onkeydown={(event) => {
      if (event.key === "Escape") showResult = false;
    }}
  >
    <div
      class="crossmath-dialog"
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-label="Results"
      bind:this={resultDialog}
      onkeydown={(event) => trapFocus(event, resultDialog)}
    >
      <div class="crossmath-dialog-head">
        <h2>{status === "won" ? "Solved" : "Solution revealed"}</h2>
        <button class="crossmath-icon-button" onclick={() => (showResult = false)} aria-label="Close results">
          <X class="h-4 w-4" />
        </button>
      </div>
      <p>
        {mistakes}
        {mistakes === 1 ? "mistake" : "mistakes"} this round{mode === "daily" ? ` · streak ${stats.streak}` : ""}.
      </p>
      {#if mode === "daily"}
        <dl class="crossmath-stats">
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
        <p class="crossmath-countdown">Next puzzle in {countdown}</p>
        <p class="crossmath-local-note">Personal stats, stored only on this device.</p>
      {/if}
      <div class="crossmath-dialog-actions">
        {#if mode === "daily"}
          <Button
            variant="outline"
            onclick={() => {
              showResult = false;
              startPractice();
            }}>Practice round</Button
          >
        {:else}
          <Button
            variant="outline"
            onclick={() => {
              showResult = false;
              startDaily(true);
            }}>Daily puzzle</Button
          >
          <Button variant="outline" onclick={() => startPractice()} class="gap-1.5"
            ><RefreshCw class="h-4 w-4" /> New puzzle</Button
          >
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .crossmath {
    max-width: 34rem;
    padding-bottom: 3rem;
  }
  .crossmath-head {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 1rem;
    padding-top: 0.5rem;
  }
  .crossmath-badge {
    display: inline-block;
    padding: 0.05rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: capitalize;
    color: var(--muted-foreground);
  }
  .crossmath-modes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    margin-top: 1.5rem;
    border: 1px solid var(--border);
    border-radius: 3px;
    overflow: hidden;
  }
  .crossmath-modes button {
    padding: 0.55rem 0.5rem;
    background: transparent;
    color: var(--muted-foreground);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    border: 0;
  }
  .crossmath-modes button.active {
    background: var(--viridian);
    color: var(--primary-foreground);
  }
  .crossmath-difficulties {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr auto;
    gap: 0.4rem;
    margin-top: 0.7rem;
  }
  .crossmath-difficulties button {
    padding: 0.45rem 0.5rem;
    background: transparent;
    color: var(--muted-foreground);
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: capitalize;
    cursor: pointer;
    border: 1px solid var(--border);
    border-radius: 3px;
  }
  .crossmath-difficulties button.active {
    background: var(--viridian);
    border-color: transparent;
    color: var(--primary-foreground);
  }
  .crossmath-difficulties .crossmath-new {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .crossmath-status {
    margin: 1.1rem 0 0.7rem;
    text-align: center;
    font-size: 0.9rem;
    color: var(--muted-foreground);
    min-height: 1.4rem;
  }
  .crossmath-grid {
    display: grid;
    gap: 0.15rem;
    justify-content: center;
    align-items: center;
  }
  .crossmath-cell {
    width: 100%;
    height: 100%;
    min-height: 1.4rem;
    display: grid;
    place-items: center;
    font-size: 1.35rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    border-radius: 3px;
    user-select: none;
    padding: 0;
  }
  .crossmath-op {
    color: var(--muted-foreground);
    font-size: 1.05rem;
    font-weight: 600;
  }
  .crossmath-eq {
    color: var(--muted-foreground);
    font-size: 1.05rem;
    font-weight: 600;
  }
  .crossmath-result {
    width: 3rem;
    height: 3rem;
    background: var(--muted);
    color: var(--foreground);
    border: 2px solid var(--border);
  }
  .crossmath-given {
    width: 3rem;
    height: 3rem;
    background: var(--muted);
    color: var(--foreground);
    border: 2px solid var(--border);
  }
  .crossmath-blank {
    width: 3rem;
    height: 3rem;
    background: var(--card);
    color: var(--foreground);
    border: 2px solid var(--border);
    outline: none;
    text-align: center;
    cursor: pointer;
    font-family: inherit;
  }
  .crossmath-blank:focus,
  .crossmath-blank.cell-selected {
    border-color: var(--viridian);
  }
  .crossmath-blank.cell-filled {
    border-color: var(--line-strong);
  }
  .crossmath-blank.cell-correct {
    border-color: var(--viridian);
    background: color-mix(in srgb, var(--viridian) 12%, var(--card));
  }
  .crossmath-blank.cell-wrong {
    border-color: #c0392b;
    background: color-mix(in srgb, #c0392b 12%, var(--card));
  }
  .crossmath-blank:disabled {
    opacity: 0.85;
    cursor: default;
  }
  .crossmath-blank.cell-shake {
    animation: crossmath-shake 0.5s ease;
  }
  .crossmath-void {
    background: transparent;
  }
  .crossmath-bank {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    justify-content: center;
    margin-top: 1.25rem;
    padding: 0.7rem;
    border: 1px dashed var(--border);
    border-radius: 3px;
    min-height: 4.4rem;
  }
  .crossmath-tile {
    width: 3rem;
    height: 3rem;
    display: grid;
    place-items: center;
    font-size: 1.35rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    border: 2px solid var(--viridian);
    border-radius: 3px;
    background: var(--card);
    color: var(--foreground);
    cursor: grab;
    user-select: none;
    font-family: inherit;
  }
  .crossmath-tile:hover:not(:disabled) {
    background: color-mix(in srgb, var(--viridian) 12%, var(--card));
  }
  .crossmath-tile.tile-selected {
    background: var(--viridian);
    color: var(--primary-foreground);
  }
  .crossmath-tile.tile-placed {
    border-color: var(--border);
    background: var(--muted);
    color: var(--muted-foreground);
    cursor: pointer;
    opacity: 0.55;
  }
  .crossmath-tile:disabled {
    cursor: not-allowed;
  }
  .crossmath-pad {
    display: grid;
    gap: 0.4rem;
    margin-top: 1.25rem;
  }
  .crossmath-pad-row {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0.4rem;
  }
  .crossmath-pad-row:last-child {
    grid-template-columns: 1fr 1fr 3fr;
  }
  .crossmath-key {
    min-height: 3.2rem;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--card);
    color: var(--foreground);
    font-size: 1.15rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
  }
  .crossmath-key:hover:not(:disabled) {
    border-color: var(--viridian);
  }
  .crossmath-key:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
  .crossmath-key-action {
    min-height: 2.9rem;
  }
  .crossmath-key-check {
    min-height: 2.9rem;
    font-size: 0.95rem;
    background: var(--viridian);
    border-color: transparent;
    color: var(--primary-foreground);
  }
  .crossmath-actions {
    display: flex;
    gap: 0.6rem;
    justify-content: center;
    margin-top: 1.4rem;
  }
  .crossmath-overlay {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: rgb(25 28 22 / 45%);
  }
  .crossmath-dialog {
    width: min(26rem, 100%);
    max-height: min(90vh, 44rem);
    overflow-y: auto;
    background: var(--card);
    color: var(--foreground);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 1.4rem;
  }
  .crossmath-dialog h2 {
    margin: 0;
    font-family: "Fraunces", Georgia, serif;
    font-size: 1.5rem;
    font-weight: 600;
  }
  .crossmath-dialog p {
    margin: 0.7rem 0 0;
    font-size: 0.92rem;
    line-height: 1.55;
  }
  .crossmath-dialog-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .crossmath-icon-button {
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
  .crossmath-good {
    color: var(--viridian);
  }
  .crossmath-bad {
    color: #c0392b;
  }
  .crossmath-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    margin: 1.1rem 0 0;
    text-align: center;
  }
  .crossmath-stats dt {
    font-size: 0.68rem;
    color: var(--muted-foreground);
  }
  .crossmath-stats dd {
    margin: 0.15rem 0 0;
    font-size: 1.6rem;
    font-weight: 700;
  }
  .crossmath-countdown {
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .crossmath-local-note {
    margin-top: 0.2rem;
    text-align: center;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .crossmath-dialog-actions {
    display: flex;
    gap: 0.6rem;
    margin-top: 1.2rem;
  }
  .crossmath-dialog-actions > :global(*) {
    flex: 1;
  }
  @keyframes crossmath-shake {
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
    .crossmath-blank.cell-shake {
      animation: none;
    }
  }
</style>
