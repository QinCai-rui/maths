<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Pen, Eraser, Type, MousePointer2, Undo2, Redo2, Trash2, X } from "@lucide/svelte/icons";
  let { open, onclose, storageKey }: { open: boolean; onclose: () => void; storageKey: string } = $props();
  type Point = { x: number; y: number };
  type Stroke = { id: string; points: Point[]; color: string; width: number };
  type Box = {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
    color: string;
    size: number;
  };
  type Drawing = { strokes: Stroke[]; boxes: Box[] };
  let drawing = $state<Drawing>({ strokes: [], boxes: [] });
  let undoStack: string[] = [];
  let redoStack: string[] = [];
  let historyVersion = $state(0);
  let canvas = $state<HTMLCanvasElement>();
  let tool = $state<"pen" | "eraser" | "text" | "interact">("pen");
  let color = $state("#191c16");
  let width = $state(4);
  let selected = $state<string | null>(null);
  let hovered = $state<string | null>(null);
  let eraser = $state<Point | null>(null);
  let gesture: { kind: "stroke" | "move" | "resize" | "erase"; id?: string; last: Point } | null = null;
  let frame = 0;
  let strokeFrame = 0;
  let fullRedrawPending = false;
  let paintedPoints = 0;
  let loaded = false;
  let scrollY = $state(0);
  let observer: ResizeObserver;
  let inkTouched = false;
  const selectedBox = $derived(drawing.boxes.find((box) => box.id === selected));
  function setColor() {
    inkTouched = true;
    if (selectedBox) {
      checkpoint();
      selectedBox.color = color;
      save();
    }
  }
  function setSize() {
    if (selectedBox) {
      checkpoint();
      selectedBox.size = 14 + width * 2;
      save();
    }
  }
  function save() {
    if (!loaded) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(drawing));
    } catch {
      /* Drawing remains usable when storage is full. */
    }
  }
  function checkpoint() {
    undoStack = [...undoStack.slice(-49), JSON.stringify(drawing)];
    redoStack = [];
    historyVersion++;
  }
  function undo() {
    const value = undoStack.pop();
    if (!value) return;
    redoStack.push(JSON.stringify(drawing));
    drawing = JSON.parse(value);
    selected = null;
    historyVersion++;
    redraw();
    save();
  }
  function redo() {
    const value = redoStack.pop();
    if (!value) return;
    undoStack.push(JSON.stringify(drawing));
    drawing = JSON.parse(value);
    selected = null;
    historyVersion++;
    redraw();
    save();
  }
  const canUndo = $derived(historyVersion >= 0 && undoStack.length > 0);
  const canRedo = $derived(historyVersion >= 0 && redoStack.length > 0);
  onMount(() => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (value && Array.isArray(value.strokes) && Array.isArray(value.boxes)) {
        drawing = {
          strokes: value.strokes
            .slice(-2000)
            .filter(
              (stroke: Stroke) =>
                stroke &&
                typeof stroke.id === "string" &&
                Array.isArray(stroke.points) &&
                stroke.points.length <= 10000 &&
                stroke.points.every((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y)) &&
                typeof stroke.color === "string" &&
                Number.isFinite(stroke.width) &&
                stroke.width > 0
            ),
          boxes: value.boxes
            .slice(-200)
            .filter(
              (box: Box) =>
                box &&
                typeof box.id === "string" &&
                typeof box.text === "string" &&
                box.text.length <= 500 &&
                typeof box.color === "string" &&
                Number.isFinite(box.x) &&
                Number.isFinite(box.y) &&
                Number.isFinite(box.width) &&
                Number.isFinite(box.height) &&
                Number.isFinite(box.size) &&
                box.width > 0 &&
                box.height > 0 &&
                box.size > 0
            )
        };
      }
    } catch {
      /* Ignore invalid saved drawings. */
    }
    loaded = true;
    const syncInk = () => {
      if (!inkTouched) color = document.documentElement.classList.contains("dark") ? "#edf0e8" : "#191c16";
    };
    syncInk();
    const themeObserver = new MutationObserver(syncInk);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const scroll = () => {
      scrollY = window.scrollY;
      redraw();
    };
    scroll();
    window.addEventListener("scroll", scroll, { passive: true });
    observer = new ResizeObserver(sizeCanvas);
    if (canvas) observer.observe(canvas);
    return () => {
      save();
      observer.disconnect();
      themeObserver.disconnect();
      window.removeEventListener("scroll", scroll);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(strokeFrame);
    };
  });
  function sizeCanvas() {
    if (!canvas || !open || !canvas.clientWidth) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * ratio);
    canvas.height = Math.round(canvas.clientHeight * ratio);
    canvas.getContext("2d")?.setTransform(ratio, 0, 0, ratio, 0, 0);
    redraw();
  }
  $effect(() => {
    if (open) {
      tick().then(sizeCanvas);
    } else {
      gesture = null;
      untrack(save);
    }
  });
  function paint() {
    fullRedrawPending = false;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    context.save();
    context.translate(0, -scrollY);
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const stroke of drawing.strokes) {
      if (!stroke.points.length) continue;
      context.strokeStyle = stroke.color;
      context.fillStyle = stroke.color;
      context.lineWidth = stroke.width;
      context.beginPath();
      if (stroke.points.length === 1) {
        context.arc(stroke.points[0].x, stroke.points[0].y, stroke.width / 2, 0, Math.PI * 2);
        context.fill();
      } else {
        context.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y);
        context.stroke();
      }
    }
    context.restore();
    const current = drawing.strokes.find((stroke) => stroke.id === gesture?.id);
    paintedPoints = current?.points.length ?? 0;
  }
  function redraw() {
    fullRedrawPending = true;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(paint);
  }
  function paintNewPoints() {
    strokeFrame = 0;
    if (fullRedrawPending || !canvas) return;
    const stroke = drawing.strokes.find((item) => item.id === gesture?.id);
    const context = canvas.getContext("2d");
    if (!stroke || !context || stroke.points.length <= paintedPoints) return;
    context.save();
    context.translate(0, -scrollY);
    context.strokeStyle = stroke.color;
    context.lineWidth = stroke.width;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    const first = stroke.points[Math.max(0, paintedPoints - 1)];
    context.moveTo(first.x, first.y);
    for (let i = Math.max(1, paintedPoints); i < stroke.points.length; i++)
      context.lineTo(stroke.points[i].x, stroke.points[i].y);
    context.stroke();
    context.restore();
    paintedPoints = stroke.points.length;
  }
  function point(event: PointerEvent): Point {
    const bounds = canvas!.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top + scrollY };
  }
  function distance(p: Point, a: Point, b: Point) {
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  }
  function erase(p: Point) {
    drawing.strokes = drawing.strokes.filter(
      (stroke) =>
        !stroke.points.some(
          (q, i) => distance(p, q, stroke.points[Math.max(0, i - 1)]) <= width * 1.5 + stroke.width / 2
        )
    );
    drawing.boxes = drawing.boxes.filter(
      (box) => !(p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height)
    );
    redraw();
  }
  function down(event: PointerEvent) {
    if (!canvas || event.button !== 0 || tool === "interact") return;
    checkpoint();
    selected = null;
    const p = point(event);
    event.currentTarget instanceof Element && event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "text") {
      if (drawing.boxes.length >= 200) return;
      const id = crypto.randomUUID();
      drawing.boxes.push({
        id,
        x: p.x,
        y: p.y,
        width: Math.min(220, Math.max(80, canvas.clientWidth - p.x)),
        height: 80,
        text: "",
        color,
        size: 14 + width * 2
      });
      selected = id;
      tick().then(() => document.getElementById(`sketch-${id}`)?.focus());
      save();
      return;
    }
    if (tool === "eraser") {
      gesture = { kind: "erase", last: p };
      erase(p);
      eraser = p;
      return;
    }
    const id = crypto.randomUUID();
    if (drawing.strokes.length >= 2000) return;
    drawing.strokes.push({ id, points: [p], color, width });
    gesture = { kind: "stroke", id, last: p };
    redraw();
  }
  function move(event: PointerEvent) {
    if (!canvas) return;
    const p = point(event);
    if (tool === "eraser") eraser = p;
    if (!gesture && tool === "text") {
      hovered =
        [...drawing.boxes]
          .reverse()
          .find((box) => p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height)?.id ??
        null;
    }
    if (!gesture) return;
    if (gesture.kind === "stroke") {
      const stroke = drawing.strokes.find((item) => item.id === gesture?.id);
      if (stroke && stroke.points.length < 10000) stroke.points.push(p);
      if (!strokeFrame) strokeFrame = requestAnimationFrame(paintNewPoints);
    } else if (gesture.kind === "erase") erase(p);
    else {
      const box = drawing.boxes.find((item) => item.id === gesture?.id);
      if (box) {
        if (gesture.kind === "move") {
          box.x = Math.max(0, Math.min(canvas.clientWidth - 40, box.x + p.x - gesture.last.x));
          box.y = Math.max(0, box.y + p.y - gesture.last.y);
        } else {
          box.width = Math.max(80, box.width + p.x - gesture.last.x);
          box.height = Math.max(50, box.height + p.y - gesture.last.y);
        }
      }
    }
    gesture.last = p;
  }
  function up() {
    cancelAnimationFrame(strokeFrame);
    strokeFrame = 0;
    if (gesture?.kind === "stroke") paintNewPoints();
    gesture = null;
    save();
  }
  function startBox(event: PointerEvent, box: Box, kind: "move" | "resize") {
    event.preventDefault();
    event.stopPropagation();
    checkpoint();
    selected = box.id;
    gesture = { kind, id: box.id, last: point(event) };
    event.currentTarget instanceof Element && event.currentTarget.setPointerCapture(event.pointerId);
  }
  function close() {
    up();
    onclose();
  }
  function switchTool(next: typeof tool) {
    up();
    tool = tool === next && next === "interact" ? "pen" : next;
    if (tool !== "text") selected = null;
    hovered = null;
  }
  function interactDown(event: PointerEvent) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if ((event.target as HTMLElement | null)?.closest?.('[role="toolbar"]')) return;
    const p = { x: event.clientX, y: event.clientY + window.scrollY };
    const hit = [...drawing.boxes]
      .reverse()
      .find((box) => p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height);
    if (!hit) return;
    event.preventDefault();
    event.stopPropagation();
    tool = "text";
    selected = hit.id;
    hovered = null;
    tick().then(() => document.getElementById(`sketch-${hit.id}`)?.focus());
  }
  function interactMove(event: PointerEvent) {
    if (event.buttons !== 0 || (event.target as HTMLElement | null)?.closest?.('[role="toolbar"]')) {
      hovered = null;
      return;
    }
    const p = { x: event.clientX, y: event.clientY + window.scrollY };
    hovered =
      [...drawing.boxes]
        .reverse()
        .find((box) => p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height)?.id ??
      null;
  }
  $effect(() => {
    if (!open || tool !== "interact") return;
    window.addEventListener("pointerdown", interactDown, true);
    window.addEventListener("pointermove", interactMove, true);
    return () => {
      window.removeEventListener("pointerdown", interactDown, true);
      window.removeEventListener("pointermove", interactMove, true);
    };
  });
</script>

<div hidden={!open} class="fixed inset-0 z-50 pointer-events-none" role="region" aria-label="Sketch pad">
  <canvas
    bind:this={canvas}
    class="absolute inset-0 h-full w-full touch-none"
    class:pointer-events-auto={tool !== "interact"}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onlostpointercapture={up}
    onpointerleave={() => {
      if (!gesture) eraser = null;
    }}
  ></canvas>
  {#each drawing.boxes as box (box.id)}
    {#if hovered === box.id && selected !== box.id && (tool === "text" || tool === "interact")}
      <div
        class="pointer-events-none absolute border-2 border-dashed border-primary/50"
        style={`left:${box.x}px;top:${box.y - scrollY}px;width:${box.width}px;height:${box.height}px`}
      ></div>
    {/if}
    <div
      class="absolute border"
      class:border-primary={selected === box.id}
      class:border-transparent={selected !== box.id}
      class:pointer-events-auto={tool === "text"}
      style={`left:${box.x}px;top:${box.y - scrollY}px;width:${box.width}px;height:${box.height}px;color:${box.color};font-size:${box.size}px`}
    >
      {#if tool === "text"}
        <button
          type="button"
          class="absolute -top-6 left-0 h-6 border border-border bg-card px-2 text-xs text-foreground touch-none"
          aria-label="Move text box"
          onpointerdown={(event) => startBox(event, box, "move")}
          onpointermove={move}
          onpointerup={up}
          onpointercancel={up}
          onkeydown={(event) => {
            const delta: Record<string, Point> = {
              ArrowLeft: { x: -10, y: 0 },
              ArrowRight: { x: 10, y: 0 },
              ArrowUp: { x: 0, y: -10 },
              ArrowDown: { x: 0, y: 10 }
            };
            const p = delta[event.key];
            if (p) {
              event.preventDefault();
              checkpoint();
              box.x = Math.max(0, box.x + p.x);
              box.y = Math.max(0, box.y + p.y);
              save();
            }
          }}>Move</button
        >
        <textarea
          id="sketch-{box.id}"
          class="h-full w-full resize-none bg-card/90 p-1 leading-tight"
          aria-label="Sketch text box"
          maxlength={500}
          bind:value={box.text}
          onfocus={() => {
            checkpoint();
            selected = box.id;
          }}
          onblur={save}
          onkeydown={(event) => {
            if (event.key === "Escape") {
              event.currentTarget.blur();
              selected = null;
            }
          }}
        ></textarea>
        <button
          type="button"
          class="absolute -bottom-2 -right-2 h-5 w-5 bg-primary touch-none"
          aria-label="Resize text box"
          onpointerdown={(event) => startBox(event, box, "resize")}
          onpointermove={move}
          onpointerup={up}
          onpointercancel={up}
          onkeydown={(event) => {
            if (
              event.key === "ArrowRight" ||
              event.key === "ArrowDown" ||
              event.key === "ArrowLeft" ||
              event.key === "ArrowUp"
            ) {
              event.preventDefault();
              checkpoint();
              if (event.key === "ArrowRight") box.width += 10;
              if (event.key === "ArrowLeft") box.width = Math.max(80, box.width - 10);
              if (event.key === "ArrowDown") box.height += 10;
              if (event.key === "ArrowUp") box.height = Math.max(50, box.height - 10);
              save();
            }
          }}
        ></button>
      {:else}<div class="whitespace-pre-wrap break-words p-1 leading-tight">{box.text}</div>{/if}
    </div>
  {/each}
  {#if tool === "eraser" && eraser}<div
      class="absolute rounded-full border-2 border-dashed border-foreground"
      style={`left:${eraser.x - width * 1.5}px;top:${eraser.y - scrollY - width * 1.5}px;width:${width * 3}px;height:${width * 3}px`}
    ></div>{/if}
  <div
    class="absolute bottom-4 left-1/2 flex w-max max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap justify-center gap-2 border border-border bg-card p-2 pointer-events-auto"
    role="toolbar"
    aria-label="Sketch tools"
  >
    <input type="color" aria-label="Ink colour" bind:value={color} oninput={setColor} class="h-8 w-8" />
    <input
      type="range"
      min={2}
      max={16}
      step={1}
      bind:value={width}
      oninput={setSize}
      aria-label="Pen, eraser and text size"
      class="w-16"
    />
    <Button
      size="sm"
      variant={tool === "pen" ? "default" : "outline"}
      onclick={() => switchTool("pen")}
      aria-pressed={tool === "pen"}><Pen class="h-4 w-4" />Pen</Button
    >
    <Button
      size="sm"
      variant={tool === "eraser" ? "default" : "outline"}
      onclick={() => switchTool("eraser")}
      aria-pressed={tool === "eraser"}><Eraser class="h-4 w-4" />Eraser</Button
    >
    <Button
      size="sm"
      variant={tool === "text" ? "default" : "outline"}
      onclick={() => switchTool("text")}
      aria-pressed={tool === "text"}><Type class="h-4 w-4" />Text</Button
    >
    <Button
      size="sm"
      variant={tool === "interact" ? "default" : "outline"}
      onclick={() => switchTool("interact")}
      aria-pressed={tool === "interact"}
      aria-label={tool === "interact" ? "Exit interact mode" : "Interact with the page"}
      title="Use the page beneath the drawing"
      ><MousePointer2 class="h-4 w-4" />{tool === "interact" ? "Exit interact" : "Interact"}</Button
    >
    <Button size="sm" variant="outline" disabled={!canUndo} onclick={undo} aria-label="Undo drawing"
      ><Undo2 class="h-4 w-4" /></Button
    >
    <Button size="sm" variant="outline" disabled={!canRedo} onclick={redo} aria-label="Redo drawing"
      ><Redo2 class="h-4 w-4" /></Button
    >
    {#if selectedBox}<Button
        size="sm"
        variant="outline"
        onclick={() => {
          checkpoint();
          drawing.boxes = drawing.boxes.filter((box) => box.id !== selected);
          selected = null;
          save();
        }}>Delete text</Button
      >{/if}
    <Button
      size="sm"
      variant="outline"
      onclick={() => {
        checkpoint();
        drawing = { strokes: [], boxes: [] };
        redraw();
        save();
      }}><Trash2 class="h-4 w-4" />Clear</Button
    >
    <Button size="sm" onclick={close}><X class="h-4 w-4" />Done</Button>
  </div>
</div>
