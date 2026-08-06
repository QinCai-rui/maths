<script lang="ts">
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Button } from "$lib/components/ui/button";
  import * as Select from "$lib/components/ui/select";
  import Plus from "@lucide/svelte/icons/plus";
  import Minus from "@lucide/svelte/icons/minus";
  import { renderToString } from "katex";
  import { create, all } from "mathjs";

  const math = create(all);

  type SolutionType = "number" | "text" | "expression";

  interface SolutionItem {
    type: SolutionType;
    value: string | number;
  }

  interface Props {
    solutions: SolutionItem[];
  }

  let { solutions = $bindable() }: Props = $props();
  let errors: (string | null)[] = $state(solutions.map(() => null));
  let previews: string[] = $state([]);

  function validateAll() {
    errors = solutions.map((s) => {
      if (s.type === "expression" && String(s.value).trim()) {
        try {
          math.parse(String(s.value));
          return null;
        } catch (e: any) {
          return e.message?.slice(0, 60) || "Invalid expression";
        }
      }
      return null;
    });
  }

  function updatePreview(i: number) {
    const s = solutions[i];
    if (s.type !== "expression" || !String(s.value).trim()) {
      previews[i] = "";
      return;
    }
    try {
      previews[i] = renderToString(String(s.value), { output: "mathml", throwOnError: false });
    } catch {
      previews[i] = "";
    }
  }

  function onInput(i: number) {
    const s = solutions[i];
    if (s.type === "number") {
      solutions[i] = { ...s, value: s.value === "" ? "" : Number(s.value) };
    }
    if (s.type === "expression") {
      validateAll();
      updatePreview(i);
    }
  }

  function onTypeChange(i: number, newType: SolutionType) {
    const s = solutions[i];
    let newValue: string | number;
    if (newType === "number") {
      newValue = Number(s.value) || 0;
    } else {
      newValue = String(s.value);
    }
    solutions[i] = { type: newType, value: newValue };
    errors[i] = null;
    previews[i] = "";
    if (newType === "expression") {
      validateAll();
      updatePreview(i);
    }
  }

  function addSolution() {
    solutions = [...solutions, { type: "number", value: 0 }];
    errors = [...errors, null];
    previews = [...previews, ""];
  }

  function removeSolution(i: number) {
    solutions = solutions.toSpliced(i, 1);
    errors = errors.toSpliced(i, 1);
    previews = previews.toSpliced(i, 1);
    validateAll();
  }
</script>

<div class="mt-4 grid gap-1.5">
  <Label class="text-sm font-medium">Solutions</Label>
  <p class="text-xs text-muted-foreground">
    Add solutions of any type. Each solution is checked against the player's answer.
  </p>
  <div class="flex flex-col gap-2">
    {#each solutions as _, i}
      <div class="flex flex-col gap-1">
        <div class="flex gap-2 items-start">
          <Select.Root
            type="single"
            value={solutions[i].type}
            onValueChange={(v) => v && onTypeChange(i, v as SolutionType)}
          >
            <Select.Trigger class="w-[110px] shrink-0 h-9 text-xs">
              {solutions[i].type}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="number">Number</Select.Item>
              <Select.Item value="text">Text</Select.Item>
              <Select.Item value="expression">Expression</Select.Item>
            </Select.Content>
          </Select.Root>
          <div class="flex-1">
            <Input
              type={solutions[i].type === "number" ? "number" : "text"}
              bind:value={solutions[i].value}
              oninput={() => onInput(i)}
              placeholder={solutions[i].type === "number"
                ? "e.g. 42"
                : solutions[i].type === "expression"
                  ? "e.g. x^2 + 1"
                  : "e.g. hello"}
              class={errors[i] ? "border-destructive focus-visible:border-destructive" : ""}
            />
          </div>
          <Button variant="destructive" size="sm" class="shrink-0 h-9 w-9 p-0" onclick={() => removeSolution(i)}>
            <Minus class="h-4 w-4" />
          </Button>
        </div>
        {#if solutions[i].type === "expression" && previews[i]}
          <div class="ml-[118px] rounded border border-border/40 bg-muted/30 p-1.5 text-center text-xs">
            {@html previews[i]}
          </div>
        {/if}
        {#if errors[i]}
          <p class="ml-[118px] text-xs text-destructive">{errors[i]}</p>
        {/if}
      </div>
    {/each}
  </div>
  <div class="flex gap-2 mt-1">
    <Button onclick={addSolution} variant="outline" size="sm" class="gap-1">
      <Plus class="h-3 w-3" /> Add solution
    </Button>
  </div>
  {#if solutions.length === 0}
    <p class="text-xs text-muted-foreground italic">No solutions added yet. At least one is required.</p>
  {/if}
</div>
