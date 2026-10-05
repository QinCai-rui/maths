<script lang="ts">
  import { evaluate } from "mathjs";
  import { Button } from "$lib/components/ui/button";
  import { X } from "@lucide/svelte/icons";
  import { tick, untrack } from "svelte";
  let { open, onclose }: { open: boolean; onclose: () => void } = $props();
  let expression = $state("");
  let result = $state<string | null>(null);
  let degrees = $state(true);
  let panel = $state<HTMLDivElement>();
  let position = $state<{ x: number; y: number } | null>(null);
  let drag: { x: number; y: number } | null = null;
  const tokens = [
    "C",
    "(",
    ")",
    "⌫",
    "÷",
    "sin",
    "7",
    "8",
    "9",
    "×",
    "cos",
    "4",
    "5",
    "6",
    "−",
    "tan",
    "1",
    "2",
    "3",
    "+",
    "ln",
    "log",
    "√",
    "^",
    "=",
    "mode",
    "π",
    "e",
    "0",
    "."
  ];
  function clamp(x: number, y: number) {
    if (!panel) return;
    position = {
      x: Math.max(0, Math.min(x, window.innerWidth - panel.offsetWidth)),
      y: Math.max(0, Math.min(y, window.innerHeight - panel.offsetHeight))
    };
  }
  $effect(() => {
    if (!open) return;
    const resize = () => {
      if (position) clamp(position.x, position.y);
    };
    window.addEventListener("resize", resize);
    tick().then(() => untrack(resize));
    return () => window.removeEventListener("resize", resize);
  });
  function calculate() {
    if (!expression.trim()) return;
    try {
      const scope = degrees
        ? {
            sin: (x: number) => Math.sin((x * Math.PI) / 180),
            cos: (x: number) => Math.cos((x * Math.PI) / 180),
            tan: (x: number) => Math.tan((x * Math.PI) / 180),
            asin: (x: number) => (Math.asin(x) * 180) / Math.PI,
            acos: (x: number) => (Math.acos(x) * 180) / Math.PI,
            atan: (x: number) => (Math.atan(x) * 180) / Math.PI
          }
        : {};
      const value = evaluate(expression, scope);
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Not a real number");
      result = String(Number(value.toPrecision(12)));
    } catch {
      result = "Error";
    }
  }
  function press(key: string) {
    if (key === "C") {
      expression = "";
      result = null;
      return;
    }
    if (key === "⌫") {
      expression = expression.slice(0, -1);
      result = null;
      return;
    }
    if (key === "mode") {
      degrees = !degrees;
      result = null;
      return;
    }
    if (key === "=") {
      calculate();
      return;
    }
    const token =
      (
        {
          "÷": "/",
          "×": "*",
          "−": "-",
          sin: "sin(",
          cos: "cos(",
          tan: "tan(",
          ln: "log(",
          log: "log10(",
          "√": "sqrt(",
          π: "pi"
        } as Record<string, string>
      )[key] ?? key;
    if (result !== null) expression = result !== "Error" && /^[+*/^\-]$/.test(token) ? result + token : token;
    else expression += token;
    result = null;
  }
</script>

<div
  bind:this={panel}
  hidden={!open}
  class="fixed bottom-20 right-4 z-50 w-64 max-w-[calc(100vw-2rem)] border border-border bg-card shadow-lg"
  style={position ? `left:${position.x}px;top:${position.y}px;bottom:auto;right:auto` : ""}
  role="dialog"
  aria-label="Scientific calculator"
>
  <div
    class="flex touch-none items-center justify-between bg-muted px-3 py-2"
    role="toolbar"
    tabindex={0}
    aria-label="Move calculator with arrow keys"
    onpointerdown={(event) => {
      if (!panel || (event.target as HTMLElement).closest("button")) return;
      const box = panel.getBoundingClientRect();
      drag = { x: event.clientX - box.left, y: event.clientY - box.top };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onpointermove={(event) => {
      if (drag) clamp(event.clientX - drag.x, event.clientY - drag.y);
    }}
    onpointerup={() => (drag = null)}
    onpointercancel={() => (drag = null)}
    onkeydown={(event) => {
      if (!panel) return;
      const keys: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1]
      };
      if (event.key === "Escape") onclose();
      const delta = keys[event.key];
      if (!delta) return;
      event.preventDefault();
      const box = panel.getBoundingClientRect();
      const step = event.shiftKey ? 10 : 1;
      clamp(box.left + delta[0] * step, box.top + delta[1] * step);
    }}
  >
    <span class="text-sm font-semibold">Calculator</span><Button
      size="icon"
      variant="ghost"
      onclick={onclose}
      aria-label="Close calculator"><X class="h-4 w-4" /></Button
    >
  </div>
  <div class="p-3">
    <label class="sr-only" for="calculator-expression">Expression</label>
    <input
      id="calculator-expression"
      class="w-full border border-border bg-background p-2 text-right"
      maxlength={200}
      bind:value={expression}
      oninput={() => (result = null)}
      onkeydown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          calculate();
        }
        if (event.key === "Escape") onclose();
      }}
    />
    <output class="block min-h-8 overflow-x-auto py-1 text-right font-semibold" aria-live="polite"
      >{result ?? ""}</output
    >
    <div class="grid grid-cols-5 gap-1">
      {#each tokens as token}<Button
          type="button"
          size="sm"
          variant={token === "=" ? "default" : "outline"}
          class="px-0"
          onclick={() => press(token)}
          aria-label={token === "⌫" ? "Backspace" : token === "mode" ? "Change angle mode" : token}
          >{token === "mode" ? (degrees ? "DEG" : "RAD") : token}</Button
        >{/each}
    </div>
  </div>
</div>
