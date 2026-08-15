<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { renderToString } from "katex";
  import MathField from "$lib/components/MathField.svelte";

  interface Props {
    html?: string;
    resetKey?: number;
    disabled?: boolean;
  }

  type MathScale = "0.5" | "0.75" | "1" | "1.25" | "1.5" | "1.75" | "2.5";

  let { html = $bindable(""), resetKey = 0, disabled = false }: Props = $props();
  let node: HTMLDivElement;
  let quill: any = null;
  let mathPopoverOpen = $state(false);
  let mathInput = $state("");
  let quillReady = $state(false);
  let editingMathIndex = $state<number | null>(null);
  let mathScale = $state<MathScale>("1");
  let mathButtonEl: HTMLButtonElement | undefined;
  let removeEquationClick: (() => void) | undefined;
  let appliedResetKey: number | undefined;

  function serializeEditor() {
    const clone = quill.root.cloneNode(true) as HTMLElement;
    for (const equation of clone.querySelectorAll<HTMLElement>(".mathex-equation")) {
      const previous = equation.previousSibling?.textContent || "";
      const next = equation.nextSibling?.textContent || "";
      const before = previous && !/\s$/.test(previous) ? " " : "";
      const after = next && !/^\s/.test(next) ? " " : "";
      const scale = equation.dataset.scale && equation.dataset.scale !== "1" ? `[scale=${equation.dataset.scale}]` : "";
      equation.replaceWith(document.createTextNode(`${before}$$${scale}${equation.dataset.latex || ""}$$${after}`));
    }
    return clone.innerHTML;
  }

  function prepareMathHtml(sourceHtml: string) {
    const container = document.createElement("div");
    container.innerHTML = sourceHtml;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
    for (const textNode of textNodes) {
      const text = textNode.data;
      const matches = [...text.matchAll(/\$\$([\s\S]+?)\$\$/g)];
      if (!matches.length) continue;
      const fragment = document.createDocumentFragment();
      let offset = 0;
      for (const match of matches) {
        fragment.append(document.createTextNode(text.slice(offset, match.index)));
        const equation = document.createElement("span");
        const parsed = /^\[scale=(0\.5|0\.75|1|1\.25|1\.5|1\.75|2\.5)\]([\s\S]*)$/.exec(match[1]);
        equation.dataset.mathexEquation = parsed ? parsed[2] : match[1];
        equation.dataset.mathexScale = parsed?.[1] || "1";
        fragment.append(equation);
        offset = (match.index || 0) + match[0].length;
      }
      fragment.append(document.createTextNode(text.slice(offset)));
      textNode.replaceWith(fragment);
    }
    return container.innerHTML;
  }

  function pasteHtml(sourceHtml: string) {
    quill.clipboard.dangerouslyPasteHTML(prepareMathHtml(sourceHtml));
  }

  function openMathEditor(index: number | null, latex = "", scale: MathScale = "1") {
    if (disabled) return;
    editingMathIndex = index;
    mathInput = latex;
    mathScale = scale;
    mathPopoverOpen = true;
  }

  function saveMath() {
    if (!quill || disabled || !mathInput.trim()) return;
    const index = editingMathIndex ?? quill.getSelection(true).index;
    if (editingMathIndex !== null) quill.deleteText(editingMathIndex, 1, "user");
    quill.insertEmbed(index, "mathexMath", { latex: mathInput.trim(), scale: mathScale }, "user");
    if (editingMathIndex === null) quill.insertText(index + 1, " ", "user");
    quill.setSelection(index + (editingMathIndex === null ? 2 : 1), 0);
    mathPopoverOpen = false;
    editingMathIndex = null;
    mathInput = "";
  }

  function deleteMath() {
    if (disabled) return;
    if (editingMathIndex !== null) {
      quill.deleteText(editingMathIndex, 1, "user");
      quill.setSelection(editingMathIndex, 0);
    }
    mathPopoverOpen = false;
    editingMathIndex = null;
  }

  function insertImage() {
    if (disabled) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        window.alert("Images must be 5 MB or smaller.");
        return;
      }
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const range = quill.getSelection(true);
      quill.insertEmbed(range.index, "image", image, "user");
      quill.setSelection(range.index + 1, 0);
    };
    input.click();
  }

  onMount(async () => {
    const Quill = (await import("quill")).default;
    const Embed = Quill.import("blots/embed") as any;
    const MathexMathBlot = class extends Embed {
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
        element.setAttribute("title", "Click to edit equation");
        element.setAttribute("role", "button");
        element.setAttribute("tabindex", "0");
        return element;
      }

      static value(element: HTMLElement) {
        return { latex: element.dataset.latex || "", scale: element.dataset.scale || "1" };
      }
    };
    Quill.register(MathexMathBlot, true);

    quill = new Quill(node, {
      theme: "snow",
      readOnly: disabled,
      modules: {
        toolbar: {
          container: [
            ["bold", "italic", "underline", "strike"],
            ["blockquote"],
            [{ list: "ordered" }, { list: "bullet" }],
            ["link", "image"],
            ["clean"]
          ],
          handlers: { image: insertImage }
        }
      },
      placeholder: "Enter question text…"
    });
    const Delta = Quill.import("delta") as any;
    quill.clipboard.addMatcher("span[data-mathex-equation]", (element: HTMLElement) =>
      new Delta().insert({
        mathexMath: { latex: element.dataset.mathexEquation || "", scale: element.dataset.mathexScale || "1" }
      })
    );

    if (html) pasteHtml(html);

    quill.on("text-change", () => {
      const nextHtml = serializeEditor();
      if (nextHtml !== html) html = nextHtml;
    });

    const equationClick = (event: Event) => {
      const equation = (event.target as HTMLElement).closest<HTMLElement>(".mathex-equation");
      if (!equation) return;
      event.preventDefault();
      const blot = Quill.find(equation);
      openMathEditor(quill.getIndex(blot), equation.dataset.latex || "", (equation.dataset.scale as MathScale) || "1");
    };
    quill.root.addEventListener("click", equationClick);
    quill.root.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") equationClick(event);
    });
    removeEquationClick = () => quill?.root.removeEventListener("click", equationClick);

    const toolbar = node.parentElement?.querySelector(".ql-toolbar");
    if (toolbar) {
      const mathButton = document.createElement("button");
      mathButton.className = "ql-math";
      mathButton.innerHTML = '<span style="font-style:italic;font-weight:bold">∑</span>';
      mathButton.title = "Insert equation";
      mathButton.addEventListener("click", (event) => {
        event.stopPropagation();
        openMathEditor(null);
      });
      const group = document.createElement("span");
      group.className = "ql-formats";
      group.append(mathButton);
      toolbar.append(group);
      mathButtonEl = mathButton;
    }
    quillReady = true;
  });

  onDestroy(() => {
    removeEquationClick?.();
    quill = null;
  });

  $effect(() => {
    const requestedReset = resetKey;
    const nextHtml = html;
    if (!quill) return;
    const currentHtml = serializeEditor();
    if (requestedReset !== appliedResetKey || nextHtml !== currentHtml) {
      appliedResetKey = requestedReset;
      quill.setText("");
      if (nextHtml) pasteHtml(nextHtml);
    }
  });

  $effect(() => {
    if (!quill || !quillReady) return;
    quill.enable(!disabled);
    // Quill can retain its disabled DOM state when it was mounted read-only.
    // Keep the underlying editable root in sync with the live lock transition.
    quill.root.contentEditable = disabled ? "false" : "true";
    quill.container.classList.toggle("ql-disabled", disabled);
    if (mathButtonEl) mathButtonEl.disabled = disabled;
    for (const control of node.parentElement?.querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
      ".ql-toolbar button, .ql-toolbar select"
    ) || []) {
      control.disabled = disabled;
    }
    for (const equation of quill.root.querySelectorAll(".mathex-equation") as NodeListOf<HTMLElement>) {
      equation.tabIndex = disabled ? -1 : 0;
      equation.setAttribute("aria-disabled", String(disabled));
    }
    if (disabled) {
      mathPopoverOpen = false;
      editingMathIndex = null;
      quill.blur();
    }
  });

  function handleClickOutside(event: MouseEvent) {
    if (!mathPopoverOpen || !mathButtonEl) return;
    if ((event.target as HTMLElement).closest(".ML__keyboard, .ML__virtual-keyboard-toggle")) return;
    const popover = document.getElementById("math-popover");
    if (!mathButtonEl.contains(event.target as Node) && popover && !popover.contains(event.target as Node)) {
      mathPopoverOpen = false;
      editingMathIndex = null;
    }
  }
</script>

<svelte:window onclick={handleClickOutside} />

<div class="quill-wrapper relative">
  {#if quillReady && mathPopoverOpen}
    <div
      id="math-popover"
      class="absolute left-1/2 top-11 z-50 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-border bg-popover p-4 shadow-xl"
    >
      <div class="mb-3">
        <p class="text-sm font-semibold">{editingMathIndex === null ? "Insert equation" : "Edit equation"}</p>
        <p class="text-xs text-muted-foreground">
          Type naturally, use the symbol buttons, or open the on-screen math keyboard.
        </p>
      </div>
      <label class="mb-3 flex items-center justify-between gap-3 text-xs font-medium text-muted-foreground">
        Equation size
        <select class="h-8 rounded border border-input bg-background px-2 text-foreground" bind:value={mathScale}>
          <option value="0.5">Small</option>
          <option value="1">Normal</option>
          <option value="1.75">Large</option>
          <option value="2.5">Extra large</option>
        </select>
      </label>
      <MathField bind:value={mathInput} />
      <div class="mt-3 flex justify-between gap-2">
        <div>
          {#if editingMathIndex !== null}<button
              type="button"
              class="rounded px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
              onclick={deleteMath}>Delete equation</button
            >{/if}
        </div>
        <div class="flex gap-2">
          <button
            type="button"
            class="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
            onclick={() => (mathPopoverOpen = false)}>Cancel</button
          >
          <button
            type="button"
            class="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
            onclick={saveMath}>{editingMathIndex === null ? "Insert" : "Update"}</button
          >
        </div>
      </div>
    </div>
  {/if}
  <div bind:this={node}></div>
</div>

<style>
  .quill-wrapper :global(.ql-toolbar) {
    border-radius: 0.375rem 0.375rem 0 0;
    font-family: inherit;
  }
  .quill-wrapper :global(.ql-container) {
    height: auto;
    min-width: 0;
    border-radius: 0 0 0.375rem 0.375rem;
    font-family: inherit;
    font-size: inherit;
  }
  .quill-wrapper :global(.ql-editor) {
    height: auto;
    min-height: 2.5rem;
    overflow-wrap: anywhere;
    padding: 0.75rem 1rem;
  }
  .quill-wrapper :global(.ql-editor.ql-blank::before) {
    color: var(--muted-foreground, #a1a1aa);
    font-style: normal;
  }
  .quill-wrapper :global(.mathex-equation) {
    display: inline-flex;
    cursor: pointer;
    align-items: center;
    border-radius: 0.3rem;
    padding: 0.08rem 0.2rem;
    margin-inline: 0.12em;
    vertical-align: middle;
  }
  .quill-wrapper :global(.mathex-equation:hover),
  .quill-wrapper :global(.mathex-equation:focus) {
    background: color-mix(in oklab, var(--primary) 12%, transparent);
    outline: 1px solid color-mix(in oklab, var(--primary) 35%, transparent);
  }
  .quill-wrapper :global(.ql-math) {
    display: inline-flex !important;
    align-items: center;
    justify-content: center;
    width: 28px !important;
    height: 24px !important;
    padding: 3px 5px !important;
    vertical-align: middle;
  }
</style>
