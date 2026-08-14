<script lang="ts">
  import { onMount } from "svelte";
  import "mathlive/fonts.css";
  import { expressionToLatex } from "$lib/mathex/expression";

  interface Props {
    value?: string;
    inputFormat?: "latex" | "ascii-math";
    outputFormat?: "latex" | "ascii-math";
    placeholder?: string;
    compact?: boolean;
    disabled?: boolean;
    onValueChange?: (value: string) => void;
  }

  let {
    value = $bindable(""),
    inputFormat = "latex",
    outputFormat = "latex",
    placeholder = "Type an equation",
    compact = false,
    disabled = false,
    onValueChange
  }: Props = $props();

  let container: HTMLDivElement;
  let mathfield = $state.raw<import("mathlive").MathfieldElement | null>(null);
  let themeObserver: MutationObserver | null = null;

  const templates = [
    { label: "Fraction", value: "\\frac{#0}{#?}" },
    { label: "Power", value: "#0^{#?}" },
    { label: "Root", value: "\\sqrt{#0}" },
    { label: "n-th root", value: "\\sqrt[#0]{#?}" },
    { label: "±", value: "\\pm" },
    { label: "×", value: "\\times" },
    { label: "÷", value: "\\div" },
    { label: "π", value: "\\pi" },
    { label: "≤", value: "\\le" },
    { label: "≥", value: "\\ge" },
    { label: "≠", value: "\\ne" },
    { label: "Angle", value: "\\angle" }
  ];

  function initialValue() {
    return inputFormat === "ascii-math" ? expressionToLatex(value) : value;
  }

  function initialFormat() {
    return inputFormat === "ascii-math" ? "latex" : inputFormat;
  }

  onMount(() => {
    let active = true;
    const syncTheme = () => {
      document.body.setAttribute("theme", document.documentElement.classList.contains("dark") ? "dark" : "light");
    };
    syncTheme();
    themeObserver = new MutationObserver(syncTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    void import("mathlive").then(({ MathfieldElement }) => {
      if (!active) return;
      const field = new MathfieldElement();
      field.className = "mathex-mathfield";
      field.smartFence = true;
      field.mathVirtualKeyboardPolicy = "auto";
      field.setAttribute("aria-label", placeholder);
      field.setAttribute("placeholder", placeholder);
      field.disabled = disabled;
      field.readOnly = disabled;
      field.addEventListener("input", () => {
        value = field.getValue(outputFormat);
        onValueChange?.(value);
      });
      container.append(field);
      field.setValue(initialValue(), { format: initialFormat() });
      mathfield = field;
    });
    return () => {
      active = false;
      themeObserver?.disconnect();
      mathfield?.remove();
    };
  });

  $effect(() => {
    if (!mathfield) return;
    const current = mathfield.getValue(outputFormat);
    if (current !== value) mathfield.setValue(initialValue(), { format: initialFormat(), silenceNotifications: true });
  });

  $effect(() => {
    if (!mathfield) return;
    mathfield.disabled = disabled;
    mathfield.readOnly = disabled;
    if (disabled) mathfield.blur();
  });

  function insertTemplate(template: string) {
    if (disabled) return;
    mathfield?.insert(template, { selectionMode: "placeholder", focus: true });
  }
</script>

<div class="math-field-shell {compact ? 'compact' : ''}">
  <div bind:this={container}></div>
  <div class="math-palette" aria-label="Equation symbols">
    {#each templates as template}
      <button
        type="button"
        title={template.label}
        onmousedown={(event) => event.preventDefault()}
        {disabled}
        onclick={() => insertTemplate(template.value)}>{template.label}</button
      >
    {/each}
  </div>
</div>

<style>
  .math-field-shell {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--background);
  }

  :global(.mathex-mathfield) {
    display: block;
    width: 100%;
    min-height: 3.5rem;
    padding: 0.75rem;
    border: 0;
    background: transparent;
    color: var(--foreground);
    font-size: 1.25rem;
    outline: none;
  }

  .compact :global(.mathex-mathfield) {
    min-height: 2.5rem;
    padding: 0.5rem 0.75rem;
    font-size: 1rem;
  }

  .math-palette {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    border-top: 1px solid var(--border);
    padding: 0.4rem;
    background: color-mix(in oklab, var(--muted) 55%, transparent);
  }

  .math-palette button {
    border-radius: 0.3rem;
    padding: 0.25rem 0.45rem;
    color: var(--muted-foreground);
    font-size: 0.7rem;
    font-weight: 600;
  }

  .math-palette button:hover {
    background: var(--accent);
    color: var(--accent-foreground);
  }
</style>
