<script lang="ts">
  import { onMount } from "svelte";
  import "mathlive/fonts.css";
  import { expressionToLatex } from "#lib/mathex/expression.js";
  import Keyboard from "@lucide/svelte/icons/keyboard";

  interface Props {
    value?: string;
    /** "ascii-math" stores MathJS-style ASCII, which expression answers use. */
    format?: "latex" | "ascii-math";
    placeholder?: string;
    compact?: boolean;
    disabled?: boolean;
    invalid?: boolean;
    autofocus?: boolean;
    onValueChange?: (value: string) => void;
    onSubmit?: () => void;
  }

  let {
    value = $bindable(""),
    format = "latex",
    placeholder = "Type an equation",
    compact = false,
    disabled = false,
    invalid = false,
    autofocus = false,
    onValueChange,
    onSubmit
  }: Props = $props();

  let container: HTMLDivElement;
  let field = $state.raw<import("mathlive").MathfieldElement | null>(null);

  const templates = [
    { label: "a⁄b", title: "Fraction", value: "\\frac{#0}{#?}" },
    { label: "xⁿ", title: "Power", value: "#0^{#?}" },
    { label: "√", title: "Square root", value: "\\sqrt{#0}" },
    { label: "ⁿ√", title: "n-th root", value: "\\sqrt[#0]{#?}" },
    { label: "±", title: "Plus or minus", value: "\\pm" },
    { label: "×", title: "Times", value: "\\times" },
    { label: "÷", title: "Divide", value: "\\div" },
    { label: "π", title: "Pi", value: "\\pi" },
    { label: "≤", title: "Less than or equal", value: "\\le" },
    { label: "≥", title: "Greater than or equal", value: "\\ge" },
    { label: "≠", title: "Not equal", value: "\\ne" },
    { label: "∠", title: "Angle", value: "\\angle" },
    { label: "°", title: "Degrees", value: "^{\\circ}" }
  ];

  const toLatex = (input: string) => (format === "ascii-math" ? expressionToLatex(input) : input);

  onMount(() => {
    let active = true;
    const syncTheme = () =>
      document.body.setAttribute("theme", document.documentElement.classList.contains("dark") ? "dark" : "light");
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    void import("mathlive").then(({ MathfieldElement }) => {
      if (!active) return;
      const element = new MathfieldElement();
      element.className = "mx-mathfield";
      element.smartFence = true;
      element.mathVirtualKeyboardPolicy = "auto";
      element.setAttribute("aria-label", placeholder);
      // MathLive reads the placeholder as LaTeX, so wrap plain text to keep it upright.
      element.setAttribute("placeholder", `\\text{${placeholder.replace(/[\\{}]/g, "")}}`);
      element.disabled = disabled;
      element.readOnly = disabled;
      element.addEventListener("input", () => {
        value = element.getValue(format);
        onValueChange?.(value);
      });
      element.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey || !compact)) {
          event.preventDefault();
          onSubmit?.();
        }
      });
      container.append(element);
      element.setValue(toLatex(value), { format: "latex" });
      field = element;
      if (autofocus) requestAnimationFrame(() => element.focus());
    });
    return () => {
      active = false;
      observer.disconnect();
      field?.remove();
    };
  });

  $effect(() => {
    if (!field) return;
    if (field.getValue(format) !== value)
      field.setValue(toLatex(value), { format: "latex", silenceNotifications: true });
  });

  $effect(() => {
    if (!field) return;
    field.disabled = disabled;
    field.readOnly = disabled;
    if (disabled) field.blur();
  });

  function insert(template: string) {
    if (!disabled) field?.insert(template, { selectionMode: "placeholder", focus: true });
  }

  function toggleKeyboard() {
    if (disabled || !field) return;
    field.focus();
    const keyboard = window.mathVirtualKeyboard;
    if (keyboard.visible) keyboard.hide();
    else keyboard.show();
  }
</script>

<div class="mx-math" class:compact class:invalid class:disabled>
  <div class="mx-math-field" bind:this={container}></div>
  {#if !compact}
    <div class="mx-math-palette" role="toolbar" aria-label="Equation symbols">
      {#each templates as template}
        <button
          type="button"
          title={template.title}
          aria-label={template.title}
          onmousedown={(event) => event.preventDefault()}
          {disabled}
          onclick={() => insert(template.value)}>{template.label}</button
        >
      {/each}
      <button
        type="button"
        class="ml-auto"
        title="On-screen maths keyboard"
        aria-label="On-screen maths keyboard"
        onmousedown={(event) => event.preventDefault()}
        {disabled}
        onclick={toggleKeyboard}><Keyboard class="size-3.5" /></button
      >
    </div>
  {/if}
</div>

<style>
  .mx-math {
    min-width: 0;
    border: 1px solid var(--mx-line-strong);
    border-radius: var(--mx-radius);
    background: var(--mx-surface);
    transition: border-color 120ms ease;
  }
  .mx-math:focus-within {
    border-color: var(--mx-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--mx-accent) 18%, transparent);
  }
  .mx-math.invalid {
    border-color: var(--mx-danger);
  }
  .mx-math.disabled {
    background: var(--mx-subtle);
  }
  :global(.mx-mathfield) {
    display: block;
    width: 100%;
    min-height: 3rem;
    padding: 0.6rem 0.75rem;
    border: 0;
    border-radius: var(--mx-radius);
    background: transparent;
    color: var(--mx-text);
    font-size: 1.25rem;
    outline: none;
    --caret-color: var(--mx-accent);
    --selection-background-color: color-mix(in srgb, var(--mx-accent) 22%, transparent);
    --contains-highlight-background-color: color-mix(in srgb, var(--mx-accent) 10%, transparent);
  }
  :global(.mx-mathfield::part(menu-toggle)),
  :global(.mx-mathfield::part(virtual-keyboard-toggle)) {
    display: none;
  }
  .compact :global(.mx-mathfield) {
    min-height: 2.3rem;
    padding: 0.35rem 0.65rem;
    font-size: 1.05rem;
  }
  .mx-math-palette {
    display: flex;
    flex-wrap: wrap;
    gap: 0.15rem;
    border-top: 1px solid var(--mx-line);
    border-radius: 0 0 var(--mx-radius) var(--mx-radius);
    padding: 0.25rem;
    background: var(--mx-subtle);
  }
  .mx-math-palette button {
    display: inline-flex;
    min-width: 1.9rem;
    height: 1.75rem;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    padding: 0 0.4rem;
    color: var(--mx-text-soft);
    font-family: "Source Serif 4", Georgia, serif;
    font-size: 0.92rem;
  }
  .mx-math-palette button:hover:not(:disabled) {
    background: var(--mx-surface);
    color: var(--mx-text);
  }
  .mx-math-palette button:disabled {
    opacity: 0.4;
  }
</style>
