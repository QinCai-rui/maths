<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { renderToString } from "katex";
  import "quill/dist/quill.core.css";
  import { toast } from "svelte-sonner";
  import MathInput from "./MathInput.svelte";
  import {
    Bold,
    Italic,
    Underline,
    Strikethrough,
    List,
    ListOrdered,
    Quote,
    Link2,
    ImagePlus,
    RemoveFormatting,
    Sigma
  } from "@lucide/svelte/icons";

  interface Props {
    html?: string;
    disabled?: boolean;
    placeholder?: string;
    /** Accessible name for the editable area. */
    label?: string;
  }

  type MathScale = "0.5" | "0.75" | "1" | "1.25" | "1.5" | "1.75" | "2.5";
  type Format = "bold" | "italic" | "underline" | "strike" | "blockquote";

  let { html = $bindable(""), disabled = false, placeholder = "Write here…", label = "Text" }: Props = $props();

  let host: HTMLDivElement;
  let wrapper: HTMLDivElement;
  let quill: any = null;
  let QuillClass: any = null;
  let ready = $state(false);
  let disposed = false;
  let active = $state<Record<string, unknown>>({});
  let mathOpen = $state(false);
  let mathLatex = $state("");
  let mathScale = $state<MathScale>("1");
  let mathIndex = $state<number | null>(null);
  let linkOpen = $state(false);
  let linkUrl = $state("");
  let savedRange: { index: number; length: number } | null = null;

  const scales: { value: MathScale; label: string }[] = [
    { value: "0.75", label: "S" },
    { value: "1", label: "M" },
    { value: "1.5", label: "L" },
    { value: "2.5", label: "XL" }
  ];

  function serialize() {
    const clone = quill.root.cloneNode(true) as HTMLElement;
    for (const equation of clone.querySelectorAll<HTMLElement>(".mathex-equation")) {
      const previous = equation.previousSibling?.textContent || "";
      const next = equation.nextSibling?.textContent || "";
      const before = previous && !/\s$/.test(previous) ? " " : "";
      const after = next && !/^\s/.test(next) ? " " : "";
      const scale = equation.dataset.scale && equation.dataset.scale !== "1" ? `[scale=${equation.dataset.scale}]` : "";
      equation.replaceWith(document.createTextNode(`${before}$$${scale}${equation.dataset.latex || ""}$$${after}`));
    }
    const result = clone.innerHTML;
    return result === "<p><br></p>" ? "" : result;
  }

  // Stored content keeps maths as `$$latex$$` text. Turn it into placeholder spans that the
  // clipboard matcher below converts into equation embeds.
  function prepare(source: string) {
    const container = document.createElement("div");
    container.innerHTML = source;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const node of nodes) {
      const matches = [...node.data.matchAll(/\$\$([\s\S]+?)\$\$/g)];
      if (!matches.length) continue;
      const fragment = document.createDocumentFragment();
      let offset = 0;
      for (const match of matches) {
        fragment.append(document.createTextNode(node.data.slice(offset, match.index)));
        const span = document.createElement("span");
        const parsed = /^\[scale=(0\.5|0\.75|1|1\.25|1\.5|1\.75|2\.5)\]([\s\S]*)$/.exec(match[1]);
        span.dataset.mathexEquation = parsed ? parsed[2] : match[1];
        span.dataset.mathexScale = parsed?.[1] || "1";
        fragment.append(span);
        offset = (match.index || 0) + match[0].length;
      }
      fragment.append(document.createTextNode(node.data.slice(offset)));
      node.replaceWith(fragment);
    }
    return container.innerHTML;
  }

  function load(source: string) {
    quill.setContents([], "silent");
    if (source) quill.clipboard.dangerouslyPasteHTML(0, prepare(source), "silent");
    quill.history.clear();
  }

  function refreshActive() {
    if (!quill) return;
    const range = quill.getSelection();
    active = range ? quill.getFormat(range) : {};
  }

  function toggle(format: Format) {
    if (!quill || disabled) return;
    quill.focus();
    quill.format(format, !active[format], "user");
    refreshActive();
  }

  function toggleList(kind: "bullet" | "ordered") {
    if (!quill || disabled) return;
    quill.focus();
    quill.format("list", active.list === kind ? false : kind, "user");
    refreshActive();
  }

  function clearFormatting() {
    if (!quill || disabled) return;
    const range = quill.getSelection(true);
    if (range.length) quill.removeFormat(range.index, range.length, "user");
    else quill.format("list", false, "user");
    refreshActive();
  }

  async function openLink() {
    if (!quill || disabled) return;
    savedRange = quill.getSelection(true);
    linkUrl = typeof active.link === "string" ? active.link : "";
    mathOpen = false;
    linkOpen = true;
    await tick();
    wrapper.querySelector<HTMLInputElement>(".mx-link input")?.focus();
  }

  function applyLink() {
    if (!quill || !savedRange) return;
    quill.setSelection(savedRange.index, savedRange.length, "silent");
    const url = linkUrl.trim();
    if (!url) quill.format("link", false, "user");
    else if (savedRange.length) quill.format("link", /^[a-z]+:/i.test(url) ? url : `https://${url}`, "user");
    else {
      const href = /^[a-z]+:/i.test(url) ? url : `https://${url}`;
      quill.insertText(savedRange.index, url, { link: href }, "user");
      quill.setSelection(savedRange.index + url.length, 0, "silent");
    }
    linkOpen = false;
    refreshActive();
  }

  function openMath(index: number | null = null, latex = "", scale: MathScale = "1") {
    if (disabled || !quill) return;
    savedRange = quill.getSelection() || { index: quill.getLength() - 1, length: 0 };
    mathIndex = index;
    mathLatex = latex;
    mathScale = scale;
    linkOpen = false;
    mathOpen = true;
  }

  function closeMath() {
    mathOpen = false;
    mathIndex = null;
    mathLatex = "";
    if (savedRange) quill?.setSelection(savedRange.index, savedRange.length, "silent");
  }

  function saveMath() {
    if (!quill || disabled) return;
    const latex = mathLatex.trim();
    if (!latex) return closeMath();
    const index = mathIndex ?? savedRange?.index ?? quill.getLength() - 1;
    if (mathIndex !== null) quill.deleteText(mathIndex, 1, "user");
    else if (savedRange?.length) quill.deleteText(savedRange.index, savedRange.length, "user");
    quill.insertEmbed(index, "mathexMath", { latex, scale: mathScale }, "user");
    if (mathIndex === null) quill.insertText(index + 1, " ", "user");
    savedRange = { index: index + (mathIndex === null ? 2 : 1), length: 0 };
    mathOpen = false;
    mathIndex = null;
    mathLatex = "";
    quill.focus();
    quill.setSelection(savedRange.index, 0, "silent");
  }

  function deleteMath() {
    if (!quill || mathIndex === null) return;
    quill.deleteText(mathIndex, 1, "user");
    savedRange = { index: mathIndex, length: 0 };
    closeMath();
  }

  function insertImage() {
    if (disabled || !quill) return;
    const range = quill.getSelection(true);
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) return toast.error("Images must be 5 MB or smaller");
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      quill.insertEmbed(range.index, "image", image, "user");
      quill.setSelection(range.index + 1, 0);
    };
    input.click();
  }

  onMount(async () => {
    QuillClass = (await import("quill")).default;
    if (disposed) return;
    const Embed = QuillClass.import("blots/embed") as any;
    // Quill's base class is available only after its browser-only dynamic import.
    // svelte-ignore perf_avoid_nested_class
    class MathBlot extends Embed {
      static blotName = "mathexMath";
      static tagName = "span";
      static className = "mathex-equation";
      static create(value: string | { latex: string; scale?: string }) {
        const element = super.create() as HTMLElement;
        const latex = typeof value === "string" ? value : value.latex;
        const scale = typeof value === "string" ? "1" : value.scale || "1";
        element.dataset.latex = latex;
        element.dataset.scale = scale;
        element.style.fontSize = `${scale}em`;
        element.innerHTML = renderToString(latex, { throwOnError: false, output: "mathml" });
        element.setAttribute("title", "Edit equation");
        element.setAttribute("role", "button");
        element.setAttribute("tabindex", "0");
        return element;
      }
      static value(element: HTMLElement) {
        return { latex: element.dataset.latex || "", scale: element.dataset.scale || "1" };
      }
    }
    QuillClass.register(MathBlot, true);

    quill = new QuillClass(host, {
      readOnly: disabled,
      placeholder,
      modules: {
        keyboard: {
          bindings: {
            equation: { key: "m", shortKey: true, handler: () => (openMath(), false) },
            link: { key: "k", shortKey: true, handler: () => (openLink(), false) }
          }
        }
      }
    });
    quill.root.setAttribute("aria-label", label);
    quill.root.setAttribute("aria-multiline", "true");
    quill.root.setAttribute("role", "textbox");
    const Delta = QuillClass.import("delta") as any;
    quill.clipboard.addMatcher("span[data-mathex-equation]", (element: HTMLElement) =>
      new Delta().insert({
        mathexMath: { latex: element.dataset.mathexEquation || "", scale: element.dataset.mathexScale || "1" }
      })
    );
    load(html);
    quill.on("text-change", () => {
      const next = serialize();
      if (next !== html) html = next;
    });
    quill.on("editor-change", refreshActive);

    const activateEquation = (event: Event) => {
      const equation = (event.target as HTMLElement).closest<HTMLElement>(".mathex-equation");
      if (!equation || disabled) return;
      event.preventDefault();
      const blot = QuillClass.find(equation);
      openMath(quill.getIndex(blot), equation.dataset.latex || "", (equation.dataset.scale as MathScale) || "1");
    };
    quill.root.addEventListener("click", activateEquation);
    quill.root.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") activateEquation(event);
    });
    ready = true;
  });

  onDestroy(() => {
    disposed = true;
    quill = null;
  });

  // Apply outside changes (a collaborator's edit, undo, import) without clobbering the cursor
  // for changes that originated here.
  $effect(() => {
    const next = html;
    if (!ready || !quill) return;
    if (next === serialize()) return;
    const range = quill.getSelection();
    load(next);
    if (range) quill.setSelection(Math.min(range.index, quill.getLength() - 1), 0, "silent");
  });

  $effect(() => {
    const isDisabled = disabled;
    if (!ready || !quill) return;
    quill.enable(!isDisabled);
    quill.root.contentEditable = isDisabled ? "false" : "true";
    for (const equation of quill.root.querySelectorAll(".mathex-equation") as NodeListOf<HTMLElement>) {
      equation.tabIndex = isDisabled ? -1 : 0;
    }
    if (isDisabled) {
      mathOpen = false;
      linkOpen = false;
      quill.blur();
    }
  });

  function onWindowPointer(event: PointerEvent) {
    if (!mathOpen && !linkOpen) return;
    const target = event.target as HTMLElement;
    if (target.closest?.(".ML__keyboard, .ML__virtual-keyboard-toggle, .ML__menu")) return;
    if (wrapper.contains(target)) return;
    mathOpen = false;
    linkOpen = false;
  }
</script>

<svelte:window onpointerdown={onWindowPointer} />

<div
  class="mx-rich"
  class:disabled
  bind:this={wrapper}
  role="presentation"
  onkeydown={(event) => {
    if (event.key === "Escape" && (mathOpen || linkOpen)) {
      event.stopPropagation();
      event.preventDefault();
      if (mathOpen) closeMath();
      linkOpen = false;
    }
  }}
>
  <div class="mx-rich-toolbar" role="toolbar" aria-label="{label} formatting">
    <div class="group">
      <button
        type="button"
        class:on={active.bold}
        onclick={() => toggle("bold")}
        {disabled}
        title="Bold (Ctrl+B)"
        aria-label="Bold"
        aria-pressed={!!active.bold}><Bold /></button
      >
      <button
        type="button"
        class:on={active.italic}
        onclick={() => toggle("italic")}
        {disabled}
        title="Italic (Ctrl+I)"
        aria-label="Italic"
        aria-pressed={!!active.italic}><Italic /></button
      >
      <button
        type="button"
        class:on={active.underline}
        onclick={() => toggle("underline")}
        {disabled}
        title="Underline (Ctrl+U)"
        aria-label="Underline"
        aria-pressed={!!active.underline}><Underline /></button
      >
      <button
        type="button"
        class:on={active.strike}
        onclick={() => toggle("strike")}
        {disabled}
        title="Strikethrough"
        aria-label="Strikethrough"
        aria-pressed={!!active.strike}><Strikethrough /></button
      >
    </div>
    <div class="group">
      <button
        type="button"
        class:on={active.list === "bullet"}
        onclick={() => toggleList("bullet")}
        {disabled}
        title="Bulleted list"
        aria-label="Bulleted list"><List /></button
      >
      <button
        type="button"
        class:on={active.list === "ordered"}
        onclick={() => toggleList("ordered")}
        {disabled}
        title="Numbered list"
        aria-label="Numbered list"><ListOrdered /></button
      >
      <button
        type="button"
        class:on={active.blockquote}
        onclick={() => toggle("blockquote")}
        {disabled}
        title="Quote"
        aria-label="Quote"><Quote /></button
      >
    </div>
    <div class="group">
      <button
        type="button"
        class:on={!!active.link}
        onclick={openLink}
        {disabled}
        title="Link (Ctrl+K)"
        aria-label="Link"><Link2 /></button
      >
      <button type="button" onclick={insertImage} {disabled} title="Image" aria-label="Insert image"
        ><ImagePlus /></button
      >
      <button type="button" onclick={clearFormatting} {disabled} title="Clear formatting" aria-label="Clear formatting"
        ><RemoveFormatting /></button
      >
    </div>
    <button
      type="button"
      class="equation"
      class:on={mathOpen}
      onclick={() => (mathOpen ? closeMath() : openMath())}
      {disabled}
      title="Insert equation (Ctrl+M)"
    >
      <Sigma /><span>Equation</span>
    </button>
  </div>

  {#if linkOpen}
    <form class="mx-pop mx-link" onsubmit={(event) => (event.preventDefault(), applyLink())}>
      <input
        bind:value={linkUrl}
        placeholder="https://example.com"
        aria-label="Link address"
        onkeydown={(event) => event.key === "Escape" && (linkOpen = false)}
      />
      <button type="submit" class="primary">{linkUrl.trim() ? "Apply" : "Remove"}</button>
    </form>
  {/if}

  {#if mathOpen}
    <div class="mx-pop mx-equation" role="dialog" aria-label={mathIndex === null ? "Insert equation" : "Edit equation"}>
      <div class="mx-pop-head">
        <span class="kicker">{mathIndex === null ? "Insert equation" : "Edit equation"}</span>
        <div class="scale" role="radiogroup" aria-label="Equation size">
          {#each scales as scale}
            <button
              type="button"
              role="radio"
              aria-checked={mathScale === scale.value}
              class:on={mathScale === scale.value}
              onclick={() => (mathScale = scale.value)}>{scale.label}</button
            >
          {/each}
        </div>
      </div>
      <MathInput
        bind:value={mathLatex}
        autofocus
        onSubmit={saveMath}
        placeholder="Type maths, or use the symbols below"
      />
      {#if mathLatex.trim()}
        <div class="preview" aria-label="Preview" style:font-size="{Number(mathScale)}em">
          {@html renderToString(mathLatex, { throwOnError: false, output: "mathml" })}
        </div>
      {/if}
      <div class="mx-pop-actions">
        {#if mathIndex !== null}<button type="button" class="danger" onclick={deleteMath}>Delete</button>{/if}
        <span class="hint">Enter to {mathIndex === null ? "insert" : "update"} · Esc to cancel</span>
        <button type="button" onclick={closeMath}>Cancel</button>
        <button type="button" class="primary" onclick={saveMath} disabled={!mathLatex.trim()}
          >{mathIndex === null ? "Insert" : "Update"}</button
        >
      </div>
    </div>
  {/if}

  <div
    class="mx-rich-body"
    bind:this={host}
    onkeydown={(event) => event.key === "Escape" && mathOpen && closeMath()}
    role="presentation"
  ></div>
</div>

<style>
  .mx-rich {
    position: relative;
    min-width: 0;
    border: 1px solid var(--mx-line-strong);
    border-radius: var(--mx-radius);
    background: var(--mx-surface);
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease;
  }
  .mx-rich:focus-within {
    border-color: var(--mx-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--mx-accent) 15%, transparent);
  }
  .mx-rich.disabled {
    background: var(--mx-subtle);
  }
  .mx-rich-toolbar {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.2rem;
    padding: 0.25rem 0.3rem;
    border-bottom: 1px solid var(--mx-line);
    border-radius: var(--mx-radius) var(--mx-radius) 0 0;
    background: var(--mx-subtle);
  }
  .group {
    display: flex;
    gap: 1px;
    padding-right: 0.25rem;
    margin-right: 0.1rem;
    border-right: 1px solid var(--mx-line);
  }
  .mx-rich-toolbar button {
    display: inline-flex;
    height: 1.85rem;
    min-width: 1.85rem;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    border-radius: 4px;
    color: var(--mx-text-soft);
  }
  .mx-rich-toolbar button :global(svg) {
    width: 0.95rem;
    height: 0.95rem;
  }
  .mx-rich-toolbar button:hover:not(:disabled) {
    background: var(--mx-surface);
    color: var(--mx-text);
  }
  .mx-rich-toolbar button.on {
    background: var(--mx-accent-soft);
    color: var(--mx-accent-text);
  }
  .mx-rich-toolbar button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .mx-rich-toolbar .equation {
    margin-left: auto;
    padding: 0 0.6rem;
    border: 1px solid var(--mx-line-strong);
    background: var(--mx-surface);
    color: var(--mx-text);
    font-size: 0.78rem;
    font-weight: 600;
  }
  .mx-rich-toolbar .equation.on {
    border-color: var(--mx-accent);
  }
  .mx-rich-body :global(.ql-container) {
    border: 0;
    font: inherit;
  }
  .mx-rich-body :global(.ql-editor) {
    min-height: var(--mx-rich-min, 6rem);
    padding: 0.75rem 0.9rem;
    overflow-wrap: anywhere;
    font-family: "Source Serif 4", Georgia, serif;
    font-size: var(--mx-rich-size, 1.08rem);
    line-height: 1.55;
    color: var(--mx-text);
  }
  .mx-rich-body :global(.ql-editor p) {
    margin-bottom: 0.4em;
  }
  .mx-rich-body :global(.ql-editor.ql-blank::before) {
    left: 0.9rem;
    right: 0.9rem;
    color: var(--mx-muted);
    font-style: normal;
  }
  .mx-rich-body :global(.ql-editor blockquote) {
    margin: 0.4em 0;
    padding-left: 0.9em;
    border-left: 2px solid var(--mx-line-strong);
    color: var(--mx-text-soft);
  }
  .mx-rich-body :global(.ql-editor a) {
    color: var(--mx-accent-text);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .mx-rich-body :global(.ql-editor img) {
    max-height: 18rem;
    margin: 0.4em 0;
    border: 1px solid var(--mx-line);
    border-radius: 4px;
  }
  .mx-rich-body :global(.mathex-equation) {
    display: inline-flex;
    align-items: center;
    margin-inline: 0;
    padding: 0.05em 0.1em;
    border-radius: 3px;
    vertical-align: middle;
    cursor: pointer;
    transition: background-color 120ms ease;
  }
  .mx-rich-body :global(.mathex-equation:hover),
  .mx-rich-body :global(.mathex-equation:focus-visible) {
    background: color-mix(in srgb, var(--mx-accent) 12%, transparent);
    outline: 1px solid color-mix(in srgb, var(--mx-accent) 45%, transparent);
    outline-offset: 0;
  }
  .disabled .mx-rich-body :global(.mathex-equation) {
    cursor: default;
  }
  .disabled .mx-rich-body :global(.mathex-equation:hover) {
    background: transparent;
    outline: none;
  }
  .mx-pop {
    position: absolute;
    top: 2.6rem;
    left: 0.3rem;
    z-index: 20;
    border: 1px solid var(--mx-line);
    border-radius: 8px;
    background: var(--mx-surface);
    box-shadow: var(--mx-shadow-pop);
  }
  .mx-link {
    display: flex;
    gap: 0.4rem;
    padding: 0.4rem;
    width: min(26rem, calc(100% - 0.6rem));
  }
  .mx-link input {
    flex: 1;
    min-width: 0;
    height: 2rem;
    padding: 0 0.55rem;
    border: 1px solid var(--mx-line-strong);
    border-radius: var(--mx-radius);
    background: var(--mx-surface);
    font-size: 0.85rem;
  }
  .mx-link input:focus {
    outline: none;
    border-color: var(--mx-accent);
  }
  .mx-equation {
    width: min(36rem, calc(100% - 0.6rem));
    padding: 0.75rem;
  }
  .mx-pop-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.55rem;
  }
  .kicker {
    color: var(--mx-text);
    font-size: 0.8rem;
    font-weight: 600;
  }
  .scale {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--mx-radius);
    background: var(--mx-subtle);
  }
  .scale button {
    min-width: 2rem;
    height: 1.5rem;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--mx-muted);
  }
  .scale button:hover:not(.on) {
    color: var(--mx-text);
  }
  .scale button.on {
    background: var(--mx-surface);
    color: var(--mx-text);
    box-shadow: var(--mx-shadow);
  }
  .preview {
    margin-top: 0.55rem;
    padding: 0.55rem 0.8rem;
    overflow-x: auto;
    border-radius: var(--mx-radius);
    background: var(--mx-subtle);
    font-family: "Source Serif 4", Georgia, serif;
    text-align: center;
  }
  .mx-pop-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.65rem;
  }
  .hint {
    margin-right: auto;
    color: var(--mx-muted);
    font-size: 0.7rem;
  }
  .mx-pop-actions button,
  .mx-link button {
    height: 2rem;
    padding: 0 0.75rem;
    border-radius: var(--mx-radius);
    font-size: 0.8rem;
    font-weight: 600;
  }
  .mx-pop-actions button:hover:not(:disabled) {
    background: var(--mx-subtle);
  }
  .mx-pop-actions .danger {
    color: var(--mx-danger);
  }
  .mx-pop-actions .danger:hover {
    background: color-mix(in srgb, var(--mx-danger) 10%, transparent);
  }
  .primary {
    background: var(--mx-accent);
    color: var(--mx-accent-fg);
  }
  .mx-pop-actions .primary:hover:not(:disabled),
  .mx-link .primary:hover {
    background: var(--mx-accent-hover);
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  @media (max-width: 520px) {
    .hint {
      display: none;
    }
    .mx-pop-actions .danger {
      margin-right: auto;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .mx-rich,
    .mx-rich-body :global(.mathex-equation) {
      transition: none;
    }
  }
</style>
