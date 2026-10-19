<script lang="ts">
  import { renderSlipHtml } from "#lib/mathex/print/preview.js";
  import { SLIP_GEOMETRY } from "#lib/mathex/print/geometry.js";
  import { TYPE } from "#lib/mathex/print/layout.js";

  interface Props {
    /** Question HTML, or cover instructions when `title` is set. */
    html: string;
    label: string;
    title?: string;
    pdfOptions: { questionTextSize: number; imageHeight: number; slipHeight: number; cutMargin: number };
  }

  let { html, label, title, pdfOptions }: Props = $props();

  const PAGE_WIDTH = SLIP_GEOMETRY.pageWidthMm;
  const BINDING = SLIP_GEOMETRY.bindingMm;
  const PADDING = SLIP_GEOMETRY.contentPaddingMm;

  let frame = $state<HTMLDivElement>();
  let content = $state<HTMLDivElement>();
  let frameWidth = $state(0);
  let overflow = $state(false);
  let scale = $derived(frameWidth ? frameWidth / (PAGE_WIDTH * 3.7795) : 0.35);
  let rendered = $derived(renderSlipHtml(html || ""));

  $effect(() => {
    rendered;
    frameWidth;
    pdfOptions.questionTextSize;
    pdfOptions.slipHeight;
    pdfOptions.cutMargin;
    pdfOptions.imageHeight;
    let active = true;
    const measure = () => {
      if (active && content) overflow = content.scrollHeight > content.clientHeight + 1;
    };
    const images = content ? Array.from(content.querySelectorAll("img")) : [];
    for (const image of images) image.addEventListener("load", measure);
    const animationFrame = requestAnimationFrame(measure);
    void document.fonts.ready.then(measure);
    return () => {
      active = false;
      cancelAnimationFrame(animationFrame);
      for (const image of images) image.removeEventListener("load", measure);
    };
  });
</script>

<figure class="mx-proof">
  <div
    class="frame"
    bind:this={frame}
    bind:clientWidth={frameWidth}
    style:height="{pdfOptions.slipHeight * 3.7795 * scale}px"
  >
    <div
      class="slip"
      style:width="{PAGE_WIDTH}mm"
      style:height="{pdfOptions.slipHeight}mm"
      style:transform="scale({scale})"
      style:--binding="{BINDING}mm"
      style:--cut="{pdfOptions.cutMargin}mm"
      style:--math-size="{TYPE.mathEm}em"
      style:padding="{PADDING.top}mm {pdfOptions.cutMargin + PADDING.right}mm {PADDING.bottom}mm {PADDING.left}mm"
    >
      <div
        class="label"
        style:font-size="{SLIP_GEOMETRY.label.sizePt}pt"
        style:margin-bottom="{SLIP_GEOMETRY.label.gapMm}mm"
        style:letter-spacing="{SLIP_GEOMETRY.label.letterSpacingEm}em"
        style:color={SLIP_GEOMETRY.label.color}
      >
        {label}
      </div>
      <div
        class="content"
        bind:this={content}
        style:font-size="{pdfOptions.questionTextSize}pt"
        style:line-height={SLIP_GEOMETRY.lineHeight}
        style:--image-height="{pdfOptions.imageHeight}mm"
      >
        {#if title !== undefined}<h1 class="cover-title">{title || "Untitled set"}</h1>{/if}
        {@html rendered}
      </div>
      {#if overflow}<div class="fade" aria-hidden="true"></div>{/if}
    </div>
  </div>
  <figcaption>
    {#if overflow}
      <span class="warn">Too long for the slip; text will shrink when printed.</span>
    {:else}
      <span>A4 width · {pdfOptions.slipHeight} mm slip · {pdfOptions.questionTextSize} pt</span>
    {/if}
  </figcaption>
</figure>

<style>
  .mx-proof {
    margin: 0;
  }
  .frame {
    position: relative;
    overflow: hidden;
    border: 1px solid var(--mx-line-strong);
    border-radius: 4px;
    background: #fff;
    box-shadow: var(--mx-shadow);
  }
  .slip {
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    transform-origin: top left;
    color: #111;
    background: #fff;
    font-family: "Source Serif 4", Georgia, serif;
  }
  .slip::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 var(--binding);
    border-left: 0.5pt solid #aaa;
  }
  .slip::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    right: var(--cut);
    border-left: 0.75pt dashed #888;
  }
  .label {
    flex: none;
    font-family: "Hanken Grotesk", sans-serif;
    font-weight: 600;
    text-transform: uppercase;
  }
  .content {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .content :global(:is(h1, h2, h3, h4, h5, h6)) {
    font-size: inherit;
    font-weight: 600;
    line-height: inherit;
  }
  .content .cover-title {
    margin: 0 0 1.5mm;
    font-family: "Source Serif 4", Georgia, serif;
    font-size: 17pt;
    font-weight: 600;
    line-height: 1.3;
  }
  .content :global(p) {
    margin: 0 0 1.2mm;
  }
  .content :global(p:last-child) {
    margin-bottom: 0;
  }
  .content :global(ul),
  .content :global(ol) {
    margin: 0 0 1.2mm;
    padding: 0;
    list-style: none;
  }
  .content :global(li) {
    position: relative;
    padding-left: calc(var(--list-level, 1) * 5mm);
  }
  .content :global(li::before) {
    content: attr(data-marker);
    position: absolute;
    left: 0;
    width: calc(var(--list-level, 1) * 5mm - 1.5mm);
    text-align: right;
  }
  .content :global(li[data-level="1"]) {
    --list-level: 2;
  }
  .content :global(li[data-level="2"]) {
    --list-level: 3;
  }
  .content :global(li[data-level="3"]) {
    --list-level: 4;
  }
  .content :global(li[data-level="4"]) {
    --list-level: 5;
  }
  .content :global(li[data-level="5"]) {
    --list-level: 6;
  }
  .content :global(li[data-level="6"]) {
    --list-level: 7;
  }
  .content :global(li[data-level="7"]) {
    --list-level: 8;
  }
  .content :global(li[data-level="8"]) {
    --list-level: 9;
  }
  .content :global(blockquote) {
    margin: 1mm 0;
    padding-left: 2mm;
    border-left: 1.5pt solid #999;
  }
  .content :global(img) {
    display: block;
    max-width: 100%;
    max-height: var(--image-height);
    margin: 1mm 0;
    object-fit: contain;
  }
  .content :global(math) {
    font-size: var(--math-size);
  }
  .fade {
    position: absolute;
    left: 0;
    right: var(--cut);
    bottom: 0;
    height: 30%;
    background: linear-gradient(transparent, rgb(176 71 46 / 18%));
    pointer-events: none;
  }
  figcaption {
    margin-top: 0.4rem;
    color: var(--mx-muted);
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }
  .warn {
    color: var(--mx-danger);
    font-weight: 500;
  }
</style>
