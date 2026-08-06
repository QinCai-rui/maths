<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { renderToString } from "katex";

  interface Props {
    html?: string;
  }

  let { html = $bindable("") }: Props = $props();

  let node: HTMLDivElement;
  let quill: any = null;
  let mathPopoverOpen = $state(false);
  let mathInput = $state("");
  let mathPreview = $state("");
  let quillReady = $state(false);
  let mathButtonEl: HTMLButtonElement | undefined = $state();

  function renderMathPreview() {
    if (!mathInput.trim()) {
      mathPreview = "";
      return;
    }
    try {
      mathPreview = renderToString(mathInput, { output: "mathml", throwOnError: false });
    } catch {
      mathPreview = '<span class="text-destructive">Invalid LaTeX</span>';
    }
  }

  function insertMath() {
    if (!quill || !mathInput.trim()) return;
    const range = quill.getSelection(true);
    const delta = { insert: `$$${mathInput}$$` };
    quill.updateContents(
      new (quill.constructor.import("delta"))().retain(range.index).insert(`$$${mathInput}$$`),
      "user"
    );
    quill.setSelection(range.index + mathInput.length + 4, 0);
    mathInput = "";
    mathPreview = "";
    mathPopoverOpen = false;
  }

  function handleMathKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      insertMath();
    } else if (e.key === "Escape") {
      mathPopoverOpen = false;
    }
  }

  onMount(async () => {
    const Quill = (await import("quill")).default;

    const toolbarOptions = [
      ["bold", "italic", "underline", "strike"],
      ["blockquote"],
      [{ list: "ordered" }, { list: "bullet" }],
      ["link"],
      ["clean"]
    ];

    quill = new Quill(node, {
      theme: "snow",
      modules: {
        toolbar: toolbarOptions
      },
      placeholder: "Enter question text…"
    });

    if (html) {
      quill.clipboard.dangerouslyPasteHTML(html);
    }

    quill.on("text-change", () => {
      const newHtml = quill.getSemanticHTML();
      if (newHtml !== html) html = newHtml;
    });

    quillReady = true;

    // Inject custom math button after toolbar
    const toolbar = node.querySelector(".ql-toolbar");
    if (toolbar) {
      const mathBtn = document.createElement("button");
      mathBtn.className = "ql-math";
      mathBtn.innerHTML = '<span style="font-style:italic;font-weight:bold">∑</span>';
      mathBtn.title = "Insert math ($$...$$)";
      mathBtn.style.cssText =
        "display:flex;align-items:center;justify-content:center;width:28px;height:24px;border:1px solid #ccc;border-radius:4px;background:#fff;cursor:pointer;font-size:14px;";
      mathBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        mathPopoverOpen = !mathPopoverOpen;
        mathInput = "";
        mathPreview = "";
      });
      toolbar.querySelector(".ql-formats")?.after(mathBtn);
      mathButtonEl = mathBtn;
    }
  });

  onDestroy(() => {
    if (quill) {
      quill = null;
    }
  });

  // Handle click outside to close popover
  function handleClickOutside(e: MouseEvent) {
    if (mathPopoverOpen && mathButtonEl && !mathButtonEl.contains(e.target as Node)) {
      const popover = document.getElementById("math-popover");
      if (popover && !popover.contains(e.target as Node)) {
        mathPopoverOpen = false;
      }
    }
  }
</script>

<svelte:window onclick={handleClickOutside} />

<div class="quill-wrapper relative">
  {#if quillReady && mathPopoverOpen}
    <div
      id="math-popover"
      class="absolute z-50 mt-1 w-72 rounded-lg border border-border bg-popover p-3 shadow-md"
      style="top: 260px; left: 50%; transform: translateX(-50%);"
    >
      <label class="mb-1 block text-xs font-medium text-muted-foreground" for="math-latex-input">LaTeX math</label>
      <input
        id="math-latex-input"
        type="text"
        bind:value={mathInput}
        oninput={renderMathPreview}
        onkeydown={handleMathKeydown}
        class="mb-2 w-full rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring"
        placeholder="e.g. x^2 + y^2 = r^2"
      />
      {#if mathPreview}
        <div class="mb-2 rounded border border-border/40 bg-muted/30 p-2 text-center text-sm">
          {@html mathPreview}
        </div>
      {/if}
      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
          onclick={() => {
            mathPopoverOpen = false;
          }}>Cancel</button
        >
        <button
          type="button"
          class="rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90"
          onclick={insertMath}>Insert</button
        >
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
    min-height: 4rem;
    padding: 0.75rem 1rem;
  }
  .quill-wrapper :global(.ql-editor.ql-blank::before) {
    color: var(--muted-foreground, #a1a1aa);
    font-style: normal;
  }
</style>
