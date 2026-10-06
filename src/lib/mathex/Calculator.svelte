<script lang="ts">
  import { Settings, X } from "@lucide/svelte/icons";
  import { tick } from "svelte";
  import {
    evaluateExpression,
    formatChainLiteral,
    normalizeExpression,
    type AngleMode,
    type CalculatorEvaluation
  } from "./calculator";
  import { renderExpression, renderFraction, renderNumber } from "./calculator-latex";

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  interface Key {
    label: string;
    insert?: string;
    action?: "clear" | "backspace" | "equals";
    tone?: "operator" | "danger";
    /** Caret offset within the inserted text (defaults to the end). */
    caret?: number;
    title?: string;
  }

  interface HistoryEntry {
    id: number;
    expression: string;
    expressionHtml: string | null;
    value: number;
    display: string;
    resultHtml: string;
    fraction?: string;
    fractionHtml?: string;
    angleMode: AngleMode;
  }

  let expression = $state("");
  let result = $state<CalculatorEvaluation | null>(null);
  let angleMode = $state<AngleMode>("deg");
  let showFraction = $state(true);
  let showScientific = $state(false);
  let settingsOpen = $state(false);
  let tab = $state<"keypad" | "history">("keypad");
  let history = $state<HistoryEntry[]>([]);
  let historyId = 0;
  let panel = $state<HTMLDivElement>();
  let inputEl = $state<HTMLInputElement>();
  let position = $state<{ x: number; y: number } | null>(null);
  let drag: { x: number; y: number } | null = null;
  let previousFocus: HTMLElement | null = null;

  let live = $derived(evaluateExpression(expression, { angleMode, showFraction }));
  let resultHtml = $derived(result?.ok ? renderNumber(result.display) : "");
  let fractionHtml = $derived(result?.ok && result.fraction ? renderFraction(result.fraction) : "");

  const basicKeys: Key[] = [
    { label: "C", action: "clear", tone: "danger" },
    { label: "(", insert: "(" },
    { label: ")", insert: ")" },
    { label: "⌫", action: "backspace", tone: "danger" },
    { label: "7", insert: "7" },
    { label: "8", insert: "8" },
    { label: "9", insert: "9" },
    { label: "÷", insert: "÷", tone: "operator" },
    { label: "4", insert: "4" },
    { label: "5", insert: "5" },
    { label: "6", insert: "6" },
    { label: "×", insert: "×", tone: "operator" },
    { label: "1", insert: "1" },
    { label: "2", insert: "2" },
    { label: "3", insert: "3" },
    { label: "−", insert: "−", tone: "operator" },
    { label: "0", insert: "0" },
    { label: ".", insert: "." },
    { label: "π", insert: "π" },
    { label: "+", insert: "+", tone: "operator" },
    { label: "=", action: "equals" }
  ];

  const scientificKeys: Key[] = [
    { label: "sin", insert: "sin()", caret: 4 },
    { label: "cos", insert: "cos()", caret: 4 },
    { label: "tan", insert: "tan()", caret: 4 },
    { label: "xʸ", insert: "^" },
    { label: "ln", insert: "ln()", caret: 3, title: "Natural logarithm" },
    { label: "log", insert: "log10()", caret: 6, title: "Base-10 logarithm" },
    { label: "logₐ", insert: "log()", caret: 4, title: "Logarithm with a chosen base: log(value, base)" },
    { label: "√", insert: "sqrt()", caret: 5, title: "Square root" },
    { label: "x²", insert: "^2" },
    { label: "ⁿ√", insert: "root()", caret: 5, title: "n-th root: root(value, n)" },
    { label: "x!", insert: "!" },
    { label: "|x|", insert: "abs()", caret: 4, title: "Absolute value" },
    { label: "nCr", insert: "nCr()", caret: 4, title: "Combinations: nCr(n, r)" },
    { label: "nPr", insert: "nPr()", caret: 4, title: "Permutations: nPr(n, r)" },
    { label: "e", insert: "e", title: "Euler's number" },
    { label: "π", insert: "π", title: "Pi" }
  ];

  function clamp(x: number, y: number) {
    if (!panel) return;
    position = {
      x: Math.max(0, Math.min(x, window.innerWidth - panel.offsetWidth)),
      y: Math.max(0, Math.min(y, window.innerHeight - panel.offsetHeight))
    };
  }

  $effect(() => {
    if (!open) return;
    const resize = () => {
      if (position) clamp(position.x, position.y);
    };
    window.addEventListener("resize", resize);
    const frame = requestAnimationFrame(() => {
      if (open) resize();
    });
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(frame);
    };
  });

  // Move focus into the dialog when it opens, and back to the trigger on close.
  $effect(() => {
    if (!open) return;
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => {
      if (open) inputEl?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      settingsOpen = false;
      previousFocus?.focus({ preventScroll: true });
      previousFocus = null;
    };
  });

  // Dismiss the settings dropdown on an outside pointer press.
  $effect(() => {
    if (!settingsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("#calc-settings") || target?.closest("[data-settings-toggle]")) return;
      settingsOpen = false;
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  });

  function focusAt(caret: number) {
    tick().then(() => {
      if (!inputEl) return;
      inputEl.focus({ preventScroll: true });
      inputEl.setSelectionRange(caret, caret);
    });
  }

  function insert(text: string, caret = text.length) {
    const maxLength = 400;
    const element = inputEl;
    if (element) {
      // Clamp the (possibly stale) DOM selection to the current expression,
      // e.g. right after a committed result cleared it.
      const start = Math.max(0, Math.min(element.selectionStart ?? expression.length, expression.length));
      const end = Math.max(start, Math.min(element.selectionEnd ?? start, expression.length));
      const next = expression.slice(0, start) + text + expression.slice(end);
      if (next.length > maxLength) return;
      expression = next;
      result = null;
      focusAt(start + caret);
    } else {
      if (expression.length + text.length > maxLength) return;
      expression += text;
      result = null;
    }
  }

  function clear() {
    expression = "";
    result = null;
    inputEl?.focus({ preventScroll: true });
  }

  function backspace() {
    const element = inputEl;
    if (element) {
      const start = element.selectionStart ?? expression.length;
      const end = element.selectionEnd ?? start;
      if (start !== end) {
        expression = expression.slice(0, start) + expression.slice(end);
        result = null;
        focusAt(start);
        return;
      }
      if (start === 0) return;
      expression = expression.slice(0, start - 1) + expression.slice(start);
      result = null;
      focusAt(start - 1);
      return;
    }
    expression = expression.slice(0, -1);
    result = null;
  }

  function calculate() {
    if (!expression.trim()) return;
    const evaluation = evaluateExpression(expression, { angleMode, showFraction });
    result = evaluation;
    if (evaluation.ok) {
      history = [
        {
          id: ++historyId,
          expression: expression.trim(),
          expressionHtml: renderExpression(expression),
          value: evaluation.value,
          display: evaluation.display,
          resultHtml: renderNumber(evaluation.display),
          fraction: evaluation.fraction,
          fractionHtml: evaluation.fraction ? renderFraction(evaluation.fraction) : undefined,
          angleMode
        },
        ...history
      ].slice(0, 50);
    }
  }

  function toggleAngle() {
    angleMode = angleMode === "deg" ? "rad" : "deg";
    result = null;
  }

  /**
   * Builds the leading literal for chaining off a result. Prefers the exact
   * fraction (so 1/3 × 3 = 1) and otherwise keeps full precision, expanded out
   * of exponent notation so the tokenizer never reads `e` as Euler's number.
   */
  function resultLiteral(evaluation: { value: number; fraction?: string }): string {
    if (evaluation.fraction) return `(${evaluation.fraction})`;
    const text = formatChainLiteral(evaluation.value);
    return text.startsWith("-") || text.includes(".") ? `(${text})` : text;
  }

  function press(key: Key) {
    if (key.action === "clear") return clear();
    if (key.action === "backspace") return backspace();
    if (key.action === "equals") return calculate();
    if (!key.insert) return;

    const continuesFromResult = /^[+\-*/^!]/.test(normalizeExpression(key.insert));
    if (result?.ok && continuesFromResult) {
      expression = resultLiteral(result) + key.insert;
      result = null;
      focusAt(expression.length);
      return;
    }
    // Only a *successful* result is replaced; a failed one stays editable.
    if (result?.ok) {
      expression = "";
      result = null;
    }
    insert(key.insert, key.caret ?? key.insert.length);
  }

  function reuse(entry: HistoryEntry) {
    expression = entry.expression;
    angleMode = entry.angleMode;
    result = {
      ok: true,
      value: entry.value,
      display: entry.display,
      fraction: showFraction ? entry.fraction : undefined
    };
    tab = "keypad";
    focusAt(expression.length);
  }

  function movePanel(event: KeyboardEvent) {
    if (!panel) return;
    if (event.key === " " || event.key === "Enter" || event.key === "Spacebar") {
      // The handle is not an activator; keep Space from scrolling the page.
      event.preventDefault();
      return;
    }
    const keys: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1]
    };
    const delta = keys[event.key];
    if (!delta) return;
    event.preventDefault();
    const box = panel.getBoundingClientRect();
    const step = event.shiftKey ? 10 : 1;
    clamp(box.left + delta[0] * step, box.top + delta[1] * step);
  }

  const TAB_ORDER = ["keypad", "history"] as const;

  function handleTabKeys(event: KeyboardEvent) {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const index = TAB_ORDER.indexOf(tab);
    tab = TAB_ORDER[(index + delta + TAB_ORDER.length) % TAB_ORDER.length];
    tick().then(() => {
      document.getElementById(tab === "keypad" ? "calc-tab-keypad" : "calc-tab-history")?.focus();
    });
  }
</script>

<div
  bind:this={panel}
  hidden={!open}
  class="calc-panel fixed bottom-20 right-4 z-50 w-[min(21rem,calc(100vw-2rem))]"
  style={position ? `left:${position.x}px;top:${position.y}px;bottom:auto;right:auto` : ""}
  role="dialog"
  aria-label="Calculator"
>
  <div
    class="calc-header"
    role="group"
    aria-label="Calculator window"
    onpointerdown={(event) => {
      if (!panel || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
      const box = panel.getBoundingClientRect();
      drag = { x: event.clientX - box.left, y: event.clientY - box.top };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onpointermove={(event) => {
      if (drag) clamp(event.clientX - drag.x, event.clientY - drag.y);
    }}
    onpointerup={() => (drag = null)}
    onpointercancel={() => (drag = null)}
    onlostpointercapture={() => (drag = null)}
  >
    <!-- The handle is a drag affordance, not a button; arrow keys nudge the window. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <span
      class="calc-drag"
      tabindex={0}
      aria-label="Move calculator with arrow keys"
      aria-roledescription="Window drag handle"
      title="Arrow keys move the calculator"
      onkeydown={movePanel}>Calculator</span
    >
    <div class="calc-header-actions">
      <button
        type="button"
        class="calc-icon"
        data-settings-toggle
        aria-label="Calculator settings"
        aria-haspopup="true"
        aria-expanded={settingsOpen}
        aria-controls="calc-settings"
        title="Settings"
        onclick={() => (settingsOpen = !settingsOpen)}><Settings class="h-4 w-4" /></button
      >
      <button type="button" class="calc-icon" aria-label="Close calculator" title="Close" onclick={onclose}
        ><X class="h-4 w-4" /></button
      >
    </div>
  </div>

  <div class="calc-settings" id="calc-settings" hidden={!settingsOpen}>
    <div class="calc-setting">
      <span class="calc-setting-label">Angle</span>
      <div class="calc-segmented">
        <button
          type="button"
          aria-pressed={angleMode === "deg"}
          onclick={() => {
            angleMode = "deg";
            result = null;
          }}>Degrees</button
        >
        <button
          type="button"
          aria-pressed={angleMode === "rad"}
          onclick={() => {
            angleMode = "rad";
            result = null;
          }}>Radians</button
        >
      </div>
    </div>
    <div class="calc-setting">
      <span class="calc-setting-label" id="calc-fraction-label">Fraction result</span>
      <button
        type="button"
        class="calc-switch"
        role="switch"
        aria-checked={showFraction}
        aria-labelledby="calc-fraction-label"
        onclick={() => {
          showFraction = !showFraction;
          result = null;
        }}
      ></button>
    </div>
  </div>

  <div class="calc-display">
    <div class="calc-display-top">
      <button
        type="button"
        class="calc-mode"
        title={angleMode === "deg" ? "Degrees — click to switch" : "Radians — click to switch"}
        aria-label={angleMode === "deg"
          ? "Angle mode: degrees, switch to radians"
          : "Angle mode: radians, switch to degrees"}
        onclick={toggleAngle}>{angleMode === "deg" ? "D" : "R"}</button
      >
      <span class="calc-mode-hint">{angleMode === "deg" ? "degrees" : "radians"}</span>
    </div>
    <label class="sr-only" for="calculator-expression">Expression</label>
    <input
      id="calculator-expression"
      bind:this={inputEl}
      class="calc-expression"
      maxlength={400}
      bind:value={expression}
      autocomplete="off"
      spellcheck={false}
      oninput={() => (result = null)}
      onkeydown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          calculate();
        }
        if (event.key === "Escape") {
          if (settingsOpen) settingsOpen = false;
          else onclose();
        }
      }}
    />
    <div class="calc-hint" aria-hidden="true">
      {#if expression.trim() && !result}{live.ok ? live.display : live.error === "Error" ? "--" : live.error}{/if}
    </div>
    <div class="calc-result" aria-live="polite">
      {#if result?.ok}
        <div class="calc-result-value" aria-hidden="true">{@html resultHtml}</div>
        <span class="sr-only">{result.display}</span>
        {#if result.fraction}
          <div class="calc-fraction" aria-hidden="true">= {@html fractionHtml}</div>
          <span class="sr-only">equals {result.fraction}</span>
        {/if}
      {:else if result}
        <div class="calc-result-error">{result.error}</div>
      {/if}
    </div>
  </div>

  <div class="calc-tabs" role="tablist" aria-label="Calculator views">
    <button
      type="button"
      role="tab"
      id="calc-tab-keypad"
      class="calc-tab"
      aria-selected={tab === "keypad"}
      aria-controls="calc-panel-keypad"
      tabindex={tab === "keypad" ? 0 : -1}
      onkeydown={handleTabKeys}
      onclick={() => (tab = "keypad")}>Keypad</button
    >
    <button
      type="button"
      role="tab"
      id="calc-tab-history"
      class="calc-tab"
      aria-selected={tab === "history"}
      aria-controls="calc-panel-history"
      tabindex={tab === "history" ? 0 : -1}
      onkeydown={handleTabKeys}
      onclick={() => (tab = "history")}>History</button
    >
  </div>

  <div
    class="calc-keypad"
    id="calc-panel-keypad"
    role="tabpanel"
    aria-labelledby="calc-tab-keypad"
    hidden={tab !== "keypad"}
  >
    <div class="calc-keypad-bar">
      <span class="calc-keypad-label">{showScientific ? "Scientific" : "Basic"}</span>
      <button
        type="button"
        class="calc-sci-toggle"
        aria-pressed={showScientific}
        onclick={() => (showScientific = !showScientific)}>{showScientific ? "Hide functions" : "Scientific"}</button
      >
    </div>
    <div class="calc-grid">
      {#each basicKeys as key (key.label)}
        <button
          type="button"
          class="calc-key {key.action === 'equals' ? 'calc-key-equals' : ''}"
          data-tone={key.tone ?? undefined}
          aria-label={key.label === "⌫" ? "Backspace" : key.label}
          title={key.title ?? undefined}
          onclick={() => press(key)}>{key.label}</button
        >
      {/each}
    </div>
    {#if showScientific}
      <div class="calc-sci-grid">
        {#each scientificKeys as key (`sci-${key.label}-${key.insert}`)}
          <button
            type="button"
            class="calc-key"
            aria-label={key.label}
            title={key.title ?? undefined}
            onclick={() => press(key)}>{key.label}</button
          >
        {/each}
      </div>
    {/if}
  </div>
  <div
    class="calc-history"
    id="calc-panel-history"
    role="tabpanel"
    aria-labelledby="calc-tab-history"
    hidden={tab !== "history"}
  >
    {#if history.length === 0}
      <p class="calc-history-empty">No calculations yet. Results you evaluate will appear here.</p>
    {:else}
      {#each history as entry (entry.id)}
        <button
          type="button"
          class="calc-history-row"
          title="Reuse this expression"
          aria-label={`${entry.expression} equals ${entry.display}${
            entry.fraction ? ` (${entry.fraction})` : ""
          }, ${entry.angleMode === "deg" ? "degrees" : "radians"}`}
          onclick={() => reuse(entry)}
        >
          <span class="calc-history-head">
            <span
              class="calc-history-mode"
              title={entry.angleMode === "deg" ? "Evaluated in degrees" : "Evaluated in radians"}
              aria-hidden="true">{entry.angleMode === "deg" ? "D" : "R"}</span
            >
            <span class="calc-history-expr">
              {#if entry.expressionHtml}
                <span aria-hidden="true">{@html entry.expressionHtml}</span>
              {:else}
                {entry.expression}
              {/if}
            </span>
          </span>
          <span class="calc-history-result" aria-hidden="true"
            >{@html entry.resultHtml}{#if entry.fractionHtml}<em>= {@html entry.fractionHtml}</em>{/if}</span
          >
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .calc-panel {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    max-height: calc(100vh - 6rem);
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--card);
    box-shadow:
      0 18px 40px -20px rgb(25 28 22 / 45%),
      0 2px 6px rgb(25 28 22 / 8%);
  }
  .calc-panel[hidden] {
    display: none;
  }
  /* Author `display` on these would otherwise beat the UA [hidden] rule. */
  .calc-settings[hidden],
  .calc-keypad[hidden],
  .calc-history[hidden] {
    display: none;
  }
  .calc-panel button {
    cursor: pointer;
  }
  .calc-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.45rem 0.5rem 0.45rem 0.75rem;
    border-bottom: 1px solid var(--border);
    background: linear-gradient(180deg, var(--competition-raised, var(--muted)), var(--card));
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .calc-header:active {
    cursor: grabbing;
  }
  .calc-drag {
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--foreground);
  }
  .calc-header-actions {
    display: flex;
    gap: 0.15rem;
  }
  .calc-icon {
    display: grid;
    place-items: center;
    width: 1.8rem;
    height: 1.8rem;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: var(--muted-foreground);
    cursor: pointer;
    transition:
      background 0.12s ease,
      color 0.12s ease;
  }
  .calc-icon:hover {
    background: var(--accent);
    color: var(--accent-foreground);
  }
  .calc-icon[aria-expanded="true"] {
    border-color: var(--border);
    background: var(--accent);
    color: var(--accent-foreground);
  }
  .calc-settings {
    position: absolute;
    top: 2.65rem;
    right: 0.45rem;
    z-index: 5;
    display: grid;
    gap: 0.55rem;
    min-width: 13rem;
    padding: 0.65rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--card);
    box-shadow:
      0 14px 30px -16px rgb(25 28 22 / 55%),
      0 2px 6px rgb(25 28 22 / 10%);
  }
  .calc-setting {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .calc-setting-label {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--muted-foreground);
  }
  .calc-segmented {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--card);
  }
  .calc-segmented button {
    padding: 0.22rem 0.6rem;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--muted-foreground);
    font-size: 0.75rem;
    font-weight: 600;
  }
  .calc-segmented button[aria-pressed="true"] {
    background: var(--primary);
    color: var(--primary-foreground);
  }
  .calc-switch {
    position: relative;
    width: 2.4rem;
    height: 1.35rem;
    border: 1px solid var(--border);
    border-radius: 9999px;
    background: var(--muted);
    transition: background 0.15s ease;
  }
  .calc-switch::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 2px;
    width: 1rem;
    height: 1rem;
    border-radius: 9999px;
    background: var(--card);
    box-shadow: 0 1px 2px rgb(0 0 0 / 25%);
    transform: translateY(-50%);
    transition: left 0.15s ease;
  }
  .calc-switch[aria-checked="true"] {
    border-color: var(--primary);
    background: var(--primary);
  }
  .calc-switch[aria-checked="true"]::after {
    left: calc(100% - 1rem - 2px);
    background: var(--primary-foreground);
  }
  .calc-display {
    padding: 0.6rem 0.75rem 0.7rem;
  }
  .calc-display-top {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.4rem;
  }
  .calc-mode {
    display: grid;
    place-items: center;
    width: 1.5rem;
    height: 1.5rem;
    border: 0;
    border-radius: 4px;
    background: var(--competition-viridian, var(--primary));
    color: var(--primary-foreground);
    font-size: 0.72rem;
    font-weight: 800;
  }
  .calc-mode-hint {
    font-size: 0.66rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted-foreground);
  }
  .calc-expression {
    width: 100%;
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: color-mix(in srgb, var(--muted) 55%, var(--card));
    color: var(--foreground);
    text-align: right;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.9rem;
  }
  .calc-hint {
    min-height: 1.1rem;
    padding-top: 0.2rem;
    color: var(--muted-foreground);
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.78rem;
    opacity: 0.85;
    text-align: right;
  }
  .calc-result {
    min-height: 2.4rem;
    padding-top: 0.2rem;
    text-align: right;
  }
  .calc-result-value {
    overflow-x: auto;
    color: var(--foreground);
    font-size: 1.35rem;
    font-weight: 700;
    white-space: nowrap;
  }
  .calc-fraction {
    color: var(--competition-viridian-deep, var(--primary));
    font-size: 1rem;
    font-weight: 600;
  }
  .calc-result-error {
    color: var(--destructive);
    font-size: 0.85rem;
    font-weight: 600;
  }
  .calc-tabs {
    display: flex;
    gap: 0.25rem;
    padding: 0.35rem 0.5rem 0;
    border-bottom: 1px solid var(--border);
  }
  .calc-tab {
    flex: 1;
    padding: 0.4rem;
    border: 0;
    border-bottom: 2px solid transparent;
    border-radius: 4px 4px 0 0;
    background: transparent;
    color: var(--muted-foreground);
    font-size: 0.78rem;
    font-weight: 600;
  }
  .calc-tab[aria-selected="true"] {
    border-bottom-color: var(--competition-viridian, var(--primary));
    color: var(--competition-viridian-deep, var(--primary));
  }
  .calc-keypad {
    display: grid;
    gap: 0.5rem;
    min-height: 0;
    overflow-y: auto;
    padding: 0.55rem;
  }
  .calc-keypad-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .calc-keypad-label {
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--muted-foreground);
  }
  .calc-sci-toggle {
    padding: 0.22rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--card);
    color: var(--foreground);
    font-size: 0.72rem;
    font-weight: 600;
  }
  .calc-sci-toggle[aria-pressed="true"] {
    border-color: transparent;
    background: var(--accent);
    color: var(--accent-foreground);
  }
  .calc-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.35rem;
  }
  .calc-key {
    display: grid;
    place-items: center;
    height: 2.4rem;
    border: 1px solid var(--border);
    border-bottom-color: color-mix(in srgb, var(--border) 55%, var(--foreground));
    border-radius: 4px;
    background: var(--card);
    color: var(--foreground);
    font-size: 0.95rem;
    font-weight: 600;
    box-shadow: 0 1px 0 rgb(25 28 22 / 6%);
    transition:
      background 0.1s ease,
      transform 0.05s ease,
      box-shadow 0.1s ease;
  }
  .calc-key:hover {
    background: var(--accent);
  }
  .calc-key:active {
    box-shadow: none;
    transform: translateY(1px);
  }
  .calc-key[data-tone="operator"] {
    background: color-mix(in srgb, var(--competition-viridian, var(--primary)) 8%, var(--card));
    color: var(--competition-viridian-deep, var(--primary));
  }
  .calc-key[data-tone="danger"] {
    color: var(--destructive);
  }
  .calc-key-equals {
    grid-column: 1 / -1;
    height: 2.6rem;
    border-color: var(--primary);
    background: var(--primary);
    color: var(--primary-foreground);
    font-size: 1.05rem;
  }
  .calc-key-equals:hover {
    background: color-mix(in srgb, var(--primary) 88%, black);
  }
  .calc-sci-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.35rem;
    margin-top: 0.1rem;
    padding-top: 0.5rem;
    border-top: 1px dashed var(--border);
  }
  .calc-sci-grid .calc-key {
    height: 2.15rem;
    color: var(--muted-foreground);
    font-size: 0.82rem;
  }
  .calc-sci-grid .calc-key:hover {
    color: var(--accent-foreground);
  }
  .calc-history {
    display: grid;
    gap: 0.3rem;
    min-height: 0;
    max-height: 15rem;
    overflow-y: auto;
    padding: 0.45rem;
  }
  .calc-history::-webkit-scrollbar {
    width: 8px;
  }
  .calc-history::-webkit-scrollbar-thumb {
    border-radius: 9999px;
    background: var(--border);
  }
  .calc-history-empty {
    padding: 1.5rem 1rem;
    color: var(--muted-foreground);
    font-size: 0.8rem;
    text-align: center;
  }
  .calc-history-row {
    display: grid;
    gap: 0.15rem;
    padding: 0.45rem 0.55rem;
    border: 1px solid transparent;
    border-radius: 4px;
    background: color-mix(in srgb, var(--muted) 45%, var(--card));
    text-align: right;
  }
  .calc-history-row:hover {
    border-color: var(--border);
    background: var(--accent);
  }
  .calc-history-head {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.35rem;
    min-width: 0;
  }
  .calc-history-mode {
    flex: none;
    display: grid;
    place-items: center;
    width: 0.95rem;
    height: 0.95rem;
    border-radius: 4px;
    background: color-mix(in srgb, var(--competition-viridian, var(--primary)) 14%, transparent);
    color: var(--competition-viridian-deep, var(--primary));
    font-size: 0.6rem;
    font-weight: 800;
  }
  .calc-history-expr {
    overflow: hidden;
    min-width: 0;
    color: var(--muted-foreground);
    font-size: 0.85rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .calc-history-result {
    color: var(--foreground);
    font-size: 1.05rem;
    font-weight: 700;
  }
  .calc-history-result em {
    margin-left: 0.35rem;
    color: var(--competition-viridian-deep, var(--primary));
    font-size: 0.9rem;
    font-style: normal;
  }
</style>
