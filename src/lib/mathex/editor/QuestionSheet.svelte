<script lang="ts">
  import type { DraftQuestionValue } from "#lib/mathex/collaborative-set.schemas.js";
  import RichText from "./RichText.svelte";
  import AnswerEditor from "./AnswerEditor.svelte";

  interface Props {
    question: DraftQuestionValue;
    disabled?: boolean;
  }

  let { question = $bindable(), disabled = false }: Props = $props();
  let notesLength = $derived(question.answerComment.length);
</script>

<section class="mx-sheet-section" aria-labelledby="mx-q-prompt">
  <h2 class="sr-only" id="mx-q-prompt">Question text</h2>
  <RichText
    bind:html={question.contents}
    {disabled}
    label="Question text"
    placeholder="Write the question. Ctrl+M inserts maths."
  />
</section>

<section class="mx-sheet-section" aria-labelledby="mx-q-answer">
  <h2 class="mx-section-head" id="mx-q-answer">Answers</h2>
  <AnswerEditor bind:question {disabled} />
</section>

<section class="mx-sheet-section" aria-labelledby="mx-q-marking">
  <h2 class="mx-section-head" id="mx-q-marking">Marking</h2>
  <label class="mx-toggle-row">
    <span>Students can skip</span>
    <input type="checkbox" class="mx-switch" bind:checked={question.skippable} {disabled} />
  </label>
  <label class="mx-notes">
    <span class="mx-notes-label">Answer key notes</span>
    <textarea
      bind:value={question.answerComment}
      maxlength="2000"
      rows="2"
      placeholder="e.g. Accept a mixed number."
      {disabled}></textarea>
    {#if notesLength > 1600}<small class="mx-count">{notesLength}/2000</small>{/if}
  </label>
</section>

<style>
  .mx-sheet-section + .mx-sheet-section {
    margin-top: 1.25rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--mx-line);
  }
  .mx-section-head {
    margin-bottom: 0.6rem;
    color: var(--mx-text);
    font-size: 0.82rem;
    font-weight: 600;
  }
  .mx-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    min-height: 2.25rem;
    padding: 0 0.75rem;
    margin-bottom: 0.75rem;
    border: 1px solid var(--mx-line);
    border-radius: var(--mx-radius);
    font-size: 0.85rem;
    cursor: pointer;
  }
  .mx-toggle-row:hover {
    background: var(--mx-subtle);
  }
  .mx-notes {
    display: grid;
    gap: 0.3rem;
    position: relative;
  }
  .mx-notes-label {
    color: var(--mx-text-soft);
    font-size: 0.78rem;
    font-weight: 500;
  }
  .mx-notes textarea {
    width: 100%;
    min-height: 3.25rem;
    resize: vertical;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--mx-line-strong);
    border-radius: var(--mx-radius);
    background: var(--mx-surface);
    color: var(--mx-text);
    font-size: 0.88rem;
    line-height: 1.45;
  }
  .mx-notes textarea:focus {
    outline: none;
    border-color: var(--mx-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--mx-accent) 18%, transparent);
  }
  .mx-notes textarea:disabled {
    background: var(--mx-subtle);
    color: var(--mx-text-soft);
  }
  .mx-switch {
    position: relative;
    width: 2.1rem;
    height: 1.2rem;
    flex: none;
    appearance: none;
    border-radius: 999px;
    background: var(--mx-line-strong);
    cursor: pointer;
    transition: background-color 140ms ease;
  }
  .mx-switch::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: calc(1.2rem - 4px);
    height: calc(1.2rem - 4px);
    border-radius: 999px;
    background: #fff;
    box-shadow: 0 1px 2px rgb(0 0 0 / 20%);
    transition: transform 140ms ease;
  }
  .mx-switch:checked {
    background: var(--mx-accent);
  }
  .mx-switch:checked::after {
    transform: translateX(0.9rem);
  }
  .mx-switch:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .mx-count {
    justify-self: end;
    color: var(--mx-muted);
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
  }
  @media (prefers-reduced-motion: reduce) {
    .mx-switch,
    .mx-switch::after {
      transition: none;
    }
  }
</style>
