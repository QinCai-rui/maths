<script lang="ts">
  import { math } from "#lib/mathex/math.js";
  import type { DraftQuestionValue } from "#lib/mathex/collaborative-set.schemas.js";
  import MathInput from "./MathInput.svelte";
  import { Plus, X, Hash, Type, SquareFunction } from "@lucide/svelte/icons";

  interface Props {
    question: DraftQuestionValue;
    disabled?: boolean;
  }

  type Solution = DraftQuestionValue["solutions"][number];
  type Kind = Solution["type"];

  let { question = $bindable(), disabled = false }: Props = $props();

  const kinds: { value: Kind; label: string; icon: typeof Hash }[] = [
    { value: "number", label: "Number", icon: Hash },
    { value: "text", label: "Text", icon: Type },
    { value: "expression", label: "Expression", icon: SquareFunction }
  ];
  const partLetter = (index: number) =>
    String.fromCharCode(65 + (index % 26)) + (index >= 26 ? Math.floor(index / 26) : "");

  let multiPart = $derived(question.requireAllSolutionGroups);
  let parts = $derived.by(() => {
    if (!multiPart) return [{ group: 0, items: question.solutions.map((solution, index) => ({ solution, index })) }];
    const groups = new Map<number, { solution: Solution; index: number }[]>();
    question.solutions.forEach((solution, index) => {
      const group = solution.group ?? 0;
      groups.set(group, [...(groups.get(group) || []), { solution, index }]);
    });
    return [...groups.entries()].sort(([a], [b]) => a - b).map(([group, items]) => ({ group, items }));
  });
  let hasExpression = $derived(question.solutions.some((solution) => solution.type === "expression"));

  function expressionError(value: string) {
    if (!value.trim()) return null;
    try {
      math.parse(value);
      return null;
    } catch {
      return "Not a valid expression";
    }
  }

  function setMode(next: boolean) {
    if (disabled || next === multiPart) return;
    question.requireAllSolutionGroups = next;
    if (next) {
      // Start multi-part with each existing answer as its own part when they were all alternatives.
      const distinct = new Set(question.solutions.map((solution) => solution.group ?? 0));
      if (distinct.size <= 1 && question.solutions.length > 1)
        question.solutions = question.solutions.map((solution, group) => ({ ...solution, group }));
      if (question.solutions.length === 0) question.solutions = [{ type: "number", value: "", group: 0 }];
    }
  }

  function renumber(solutions: Solution[]) {
    const order = [...new Set(solutions.map((solution) => solution.group ?? 0))].sort((a, b) => a - b);
    const map = new Map(order.map((group, index) => [group, index]));
    return solutions.map((solution) => ({ ...solution, group: map.get(solution.group ?? 0) ?? 0 }));
  }

  function add(group: number) {
    const last = question.solutions.findLast((solution) => solution.group === group);
    const type: Kind = last?.type || "number";
    const solution: Solution = type === "number" ? { type, value: "", group } : { type, value: "", group };
    const at = question.solutions.findLastIndex((item) => item.group === group);
    question.solutions = at < 0 ? [...question.solutions, solution] : question.solutions.toSpliced(at + 1, 0, solution);
  }

  function addPart() {
    const group = Math.max(-1, ...question.solutions.map((solution) => solution.group ?? 0)) + 1;
    question.solutions = [...question.solutions, { type: "number", value: "", group }];
  }

  function remove(index: number) {
    question.solutions = renumber(question.solutions.toSpliced(index, 1));
  }

  function removePart(group: number) {
    question.solutions = renumber(question.solutions.filter((solution) => solution.group !== group));
  }

  function setKind(index: number, type: Kind) {
    const current = question.solutions[index];
    if (current.type === type) return;
    const raw = String(current.value ?? "");
    const value = type === "number" ? (raw.trim() && Number.isFinite(Number(raw)) ? Number(raw) : "") : raw;
    question.solutions[index] = { ...current, type, value } as Solution;
  }

  function setNumber(index: number, raw: string) {
    const current = question.solutions[index];
    question.solutions[index] = { ...current, type: "number", value: raw.trim() === "" ? "" : Number(raw) } as Solution;
  }

  function setText(index: number, value: string) {
    question.solutions[index] = { ...question.solutions[index], value } as Solution;
  }
</script>

<div class="mx-answers">
  <div class="mode" role="radiogroup" aria-label="How answers are marked">
    <button
      type="button"
      role="radio"
      aria-checked={!multiPart}
      class:on={!multiPart}
      onclick={() => setMode(false)}
      {disabled}
    >
      <strong>One answer</strong><span>Any listed answer is correct</span>
    </button>
    <button
      type="button"
      role="radio"
      aria-checked={multiPart}
      class:on={multiPart}
      onclick={() => setMode(true)}
      {disabled}
    >
      <strong>Several parts</strong><span>Every part must be answered</span>
    </button>
  </div>

  {#each parts as part, partIndex (part.group)}
    <div class="part" class:multi={multiPart}>
      {#if multiPart}
        <div class="part-head">
          <span class="part-label">Part {partLetter(partIndex)}</span>
          {#if parts.length > 1}
            <button
              type="button"
              class="ghost"
              onclick={() => removePart(part.group)}
              {disabled}
              aria-label="Remove part {partLetter(partIndex)}"
              title="Remove part"><X /></button
            >
          {/if}
        </div>
      {/if}
      {#each part.items as { solution, index }, itemIndex (index)}
        {@const error = solution.type === "expression" ? expressionError(String(solution.value)) : null}
        {#if itemIndex > 0}<div class="or" aria-hidden="true"><span>or</span></div>{/if}
        <div class="row">
          <div class="kind" role="radiogroup" aria-label="Answer type">
            {#each kinds as kind}
              {@const Icon = kind.icon}
              <button
                type="button"
                role="radio"
                aria-checked={solution.type === kind.value}
                class:on={solution.type === kind.value}
                title={kind.label}
                aria-label={kind.label}
                onclick={() => setKind(index, kind.value)}
                {disabled}
                ><Icon />{#if solution.type === kind.value}<span class="kind-label">{kind.label}</span>{/if}</button
              >
            {/each}
          </div>
          <div class="value">
            {#if solution.type === "expression"}
              <MathInput
                value={String(solution.value)}
                format="ascii-math"
                compact
                invalid={!!error}
                placeholder="Expression, e.g. 2x+1"
                {disabled}
                onValueChange={(value) => setText(index, value)}
              />
            {:else if solution.type === "number"}
              <input
                class="field numeric"
                type="number"
                step="any"
                value={solution.value === "" ? "" : String(solution.value)}
                oninput={(event) => setNumber(index, event.currentTarget.value)}
                placeholder="e.g. 42"
                aria-label="Number answer"
                {disabled}
              />
            {:else}
              <input
                class="field"
                type="text"
                value={String(solution.value)}
                oninput={(event) => setText(index, event.currentTarget.value)}
                placeholder="e.g. isosceles"
                aria-label="Text answer"
                {disabled}
              />
            {/if}
            {#if error}<p class="error">{error}</p>{/if}
          </div>
          <button
            type="button"
            class="remove"
            onclick={() => remove(index)}
            {disabled}
            aria-label="Remove answer"
            title="Remove answer"><X /></button
          >
        </div>
      {/each}
      <button type="button" class="add" onclick={() => add(part.group)} {disabled}>
        <Plus />
        {part.items.length ? "Add alternative" : "Add answer"}
      </button>
    </div>
  {/each}

  {#if multiPart}
    <div class="part-actions">
      <button type="button" class="add strong" onclick={addPart} {disabled}><Plus /> Add part</button>
      <label class="switch">
        <input type="checkbox" bind:checked={question.solutionOrderMatters} {disabled} />
        <span class="track" aria-hidden="true"></span>
        Parts must be answered in order
      </label>
    </div>
  {/if}

  {#if hasExpression}
    <label class="switch standalone">
      <input type="checkbox" bind:checked={question.allowEquivalent} {disabled} />
      <span class="track" aria-hidden="true"></span>
      Accept equivalent expressions <small>2(x+1) = 2x+2</small>
    </label>
  {/if}
</div>

<style>
  .mx-answers {
    display: grid;
    gap: 0.75rem;
  }
  .mode {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px;
    padding: 3px;
    border-radius: 8px;
    background: var(--mx-subtle);
  }
  .mode button {
    display: grid;
    gap: 0.05rem;
    padding: 0.4rem 0.7rem;
    border-radius: 6px;
    text-align: left;
  }
  .mode strong {
    color: var(--mx-text-soft);
    font-size: 0.82rem;
    font-weight: 500;
  }
  .mode span {
    color: var(--mx-muted);
    font-size: 0.72rem;
  }
  .mode button:hover:not(.on):not(:disabled) strong {
    color: var(--mx-text);
  }
  .mode button.on {
    background: var(--mx-surface);
    box-shadow:
      var(--mx-shadow),
      0 0 0 1px var(--mx-line);
  }
  .mode button.on strong {
    color: var(--mx-text);
    font-weight: 600;
  }
  .mode button:disabled {
    cursor: not-allowed;
  }
  .mode button:disabled:not(.on) {
    opacity: 0.6;
  }
  .part {
    display: grid;
    gap: 0.4rem;
  }
  .part.multi {
    padding: 0.6rem 0.7rem 0.65rem;
    border: 1px solid var(--mx-line);
    border-radius: 8px;
    background: var(--mx-subtle);
  }
  .part-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 1.6rem;
  }
  .part-label {
    display: inline-flex;
    align-items: center;
    height: 1.35rem;
    padding: 0 0.5rem;
    border-radius: 4px;
    background: var(--mx-accent-soft);
    color: var(--mx-accent-text);
    font-size: 0.72rem;
    font-weight: 600;
  }
  .row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: start;
    gap: 0.4rem;
  }
  .kind {
    display: flex;
    gap: 2px;
    height: 2.4rem;
    padding: 3px;
    border-radius: var(--mx-radius);
    background: var(--mx-subtle);
  }
  .part.multi .kind {
    background: var(--mx-bg);
  }
  .kind button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    min-width: 1.9rem;
    padding: 0 0.4rem;
    border-radius: 4px;
    color: var(--mx-muted);
    font-size: 0.75rem;
    font-weight: 600;
  }
  .kind button :global(svg) {
    width: 0.9rem;
    height: 0.9rem;
  }
  .kind button.on {
    background: var(--mx-surface);
    color: var(--mx-accent-text);
    box-shadow: var(--mx-shadow);
  }
  .kind button:hover:not(.on):not(:disabled) {
    color: var(--mx-text);
  }
  .kind button:disabled {
    cursor: not-allowed;
  }
  .value {
    min-width: 0;
  }
  .field {
    width: 100%;
    height: 2.4rem;
    padding: 0 0.7rem;
    border: 1px solid var(--mx-line-strong);
    border-radius: var(--mx-radius);
    background: var(--mx-surface);
    color: var(--mx-text);
    font-size: 0.95rem;
  }
  .field.numeric {
    font-variant-numeric: tabular-nums;
  }
  .field:focus {
    outline: none;
    border-color: var(--mx-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--mx-accent) 18%, transparent);
  }
  .field:disabled {
    background: var(--mx-subtle);
    color: var(--mx-text-soft);
  }
  .error {
    margin-top: 0.25rem;
    color: var(--mx-danger);
    font-size: 0.72rem;
  }
  .remove,
  .ghost {
    display: grid;
    place-items: center;
    border-radius: var(--mx-radius);
    color: var(--mx-muted);
  }
  .remove {
    width: 2.4rem;
    height: 2.4rem;
  }
  .ghost {
    width: 1.6rem;
    height: 1.6rem;
  }
  .remove:hover:not(:disabled),
  .ghost:hover:not(:disabled) {
    background: color-mix(in srgb, var(--mx-danger) 10%, transparent);
    color: var(--mx-danger);
  }
  .remove :global(svg) {
    width: 1rem;
    height: 1rem;
  }
  .ghost :global(svg) {
    width: 0.85rem;
    height: 0.85rem;
  }
  .remove:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .or {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--mx-muted);
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .or::before,
  .or::after {
    content: "";
    flex: 1;
    border-top: 1px solid var(--mx-line);
  }
  .or::before {
    flex: 0 0 1rem;
  }
  .add {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    height: 1.85rem;
    padding: 0 0.55rem;
    border-radius: var(--mx-radius);
    color: var(--mx-accent-text);
    font-size: 0.8rem;
    font-weight: 600;
  }
  .add :global(svg) {
    width: 0.85rem;
    height: 0.85rem;
  }
  .add:hover:not(:disabled) {
    background: var(--mx-accent-soft);
  }
  .add.strong {
    border: 1px solid var(--mx-line-strong);
    background: var(--mx-surface);
    color: var(--mx-text);
    box-shadow: var(--mx-shadow);
  }
  .add.strong:hover:not(:disabled) {
    background: var(--mx-subtle);
  }
  .add:disabled,
  .ghost:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .part-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
  }
  .switch {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    color: var(--mx-text-soft);
    font-size: 0.82rem;
    cursor: pointer;
  }
  .switch small {
    color: var(--mx-muted);
    font-size: 0.72rem;
  }
  .switch input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }
  .track {
    position: relative;
    width: 2rem;
    height: 1.15rem;
    flex: none;
    border-radius: 999px;
    background: var(--mx-line-strong);
    transition: background-color 140ms ease;
  }
  .track::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: calc(1.15rem - 4px);
    height: calc(1.15rem - 4px);
    border-radius: 999px;
    background: #fff;
    box-shadow: 0 1px 2px rgb(0 0 0 / 20%);
    transition: transform 140ms ease;
  }
  .switch input:checked + .track {
    background: var(--mx-accent);
  }
  .switch input:checked + .track::after {
    transform: translateX(0.85rem);
  }
  .switch input:focus-visible + .track {
    outline: 2px solid var(--mx-accent);
    outline-offset: 2px;
  }
  .switch input:disabled + .track {
    opacity: 0.5;
  }
  @media (max-width: 520px) {
    .mode {
      grid-template-columns: 1fr;
    }
    .row {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .kind {
      grid-column: 1 / -1;
      justify-self: start;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .track,
    .track::after {
      transition: none;
    }
  }
</style>
