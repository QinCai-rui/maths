<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { renderToString } from "katex";
  import MathField from "$lib/components/MathField.svelte";

  interface Props {
    html?: string;
    resetKey?: number;
  }

  let { html = $bindable(""), resetKey = 0 }: Props = $props();
  let node: HTMLDivElement;
  let quill: any = null;
  let mathPopoverOpen = $state(false);
  let mathInput = $state("");
  let quillReady = $state(false);
  let editingMathIndex = $state<number | null>(null);
  let mathButtonEl: HTMLButtonElement | undefined;
  let removeEquationClick: (() => void) | undefined;

  function serializeEditor() {
    const clone = quill.root.cloneNode(true) as HTMLElement;
    for (const equation of clone.querySelectorAll<HTMLElement>(".mathex-equation")) {
      equation.replaceWith(document.createTextNode(`$$${equation.dataset.latex || ""}$$`));
    }
    return clone.innerHTML;
  }

  function hydrateMathTokens() {
    const text = quill.getText() as string;
    const matches = [...text.matchAll(/\$\$([^$]+)\$\$/g)];
    for (const match of matches.reverse()) {
      const index = match.index!;
      quill.deleteText(index, match[0].length, "silent");
      quill.insertEmbed(index, "mathexMath", match[1], "silent");
    }
  }

  function openMathEditor(index: number | null, latex = "") {
    editingMathIndex = index;
    mathInput = latex;
    mathPopoverOpen = true;
  }

  function saveMath() {
    if (!quill || !mathInput.trim()) return;
    const index = editingMathIndex ?? quill.getSelection(true).index;
    if (editingMathIndex !== null) quill.deleteText(editingMathIndex, 1, "user");
    quill.insertEmbed(index, "mathexMath", mathInput.trim(), "user");
    quill.setSelection(index + 1, 0);
    mathPopoverOpen = false;
    editingMathIndex = null;
    mathInput = "";
  }

  function deleteMath() {
    if (editingMathIndex !== null) {
      quill.deleteText(editingMathIndex, 1, "user");
      quill.setSelection(editingMathIndex, 0);
    }
    mathPopoverOpen = false;
    editingMathIndex = null;
  }

  function insertImage() {
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

      static create(value: string) {
        const element = super.create() as HTMLElement;
        element.dataset.latex = value;
        element.innerHTML = renderToString(value, { throwOnError: false, output: "htmlAndMathml" });
        element.setAttribute("title", "Click to edit equation");
        element.setAttribute("role", "button");
        element.setAttribute("tabindex", "0");
        return element;
      }

      static value(element: HTMLElement) {
        return element.dataset.latex || "";
      }
    };
    Quill.register(MathexMathBlot, true);

    quill = new Quill(node, {
      theme: "snow",
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

    if (html) {
      quill.clipboard.dangerouslyPasteHTML(html);
      hydrateMathTokens();
    }

    quill.on("text-change", () => {
      const nextHtml = serializeEditor();
      if (nextHtml !== html) html = nextHtml;
    });

    const equationClick = (event: Event) => {
      const equation = (event.target as HTMLElement).closest<HTMLElement>(".mathex-equation");
      if (!equation) return;
      event.preventDefault();
      const blot = Quill.find(equation);
      openMathEditor(quill.getIndex(blot), equation.dataset.latex || "");
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
      toolbar.append(mathButton);
      mathButtonEl = mathButton;
    }
    quillReady = true;
  });

  onDestroy(() => {
    removeEquationClick?.();
    quill = null;
  });

  $effect(() => {
    resetKey;
    if (!quill) return;
    quill.setText("");
    if (html) {
      quill.clipboard.dangerouslyPasteHTML(html);
      hydrateMathTokens();
    }
  });

  function handleClickOutside(event: MouseEvent) {
    if (!mathPopoverOpen || !mathButtonEl) return;
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
    border-radius: 0 0 0.375rem 0.375rem;
    font-family: inherit;
    font-size: inherit;
  }
  .quill-wrapper :global(.ql-editor) {
    min-height: 2.5rem;
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
    vertical-align: middle;
  }
  .quill-wrapper :global(.mathex-equation:hover),
  .quill-wrapper :global(.mathex-equation:focus) {
    background: color-mix(in oklab, var(--primary) 12%, transparent);
    outline: 1px solid color-mix(in oklab, var(--primary) 35%, transparent);
  }
</style>
