<script lang="ts">
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Button } from "$lib/components/ui/button";
  import * as Select from "$lib/components/ui/select";
  import Plus from "@lucide/svelte/icons/plus";
  import Minus from "@lucide/svelte/icons/minus";
  import { create, all } from "mathjs";
  import MathField from "$lib/components/MathField.svelte";

  const math = create(all);

  type SolutionType = "number" | "text" | "expression";

  interface SolutionItem {
    type: SolutionType;
    value: string | number;
    group: number;
  }

  interface Props {
    solutions: SolutionItem[];
    disabled?: boolean;
    grouped?: boolean;
  }

  let { solutions = $bindable(), disabled = false, grouped = false }: Props = $props();
  let errors: (string | null)[] = $state(solutions.map(() => null));

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

  function onInput(i: number) {
    const s = solutions[i];
    if (s.type === "number") {
      solutions[i] = { ...s, value: s.value === "" ? "" : Number(s.value) };
    }
    if (s.type === "expression") {
      validateAll();
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
    solutions[i] = { ...s, type: newType, value: newValue };
    errors[i] = null;
    if (newType === "expression") {
      validateAll();
    }
  }

  function addSolution() {
    solutions = [...solutions, { type: "number", value: 0, group: solutions.at(-1)?.group ?? 0 }];
    errors = [...errors, null];
  }

  function addGroup() {
    const group = Math.max(-1, ...solutions.map((solution) => solution.group ?? 0)) + 1;
    solutions = [...solutions, { type: "number", value: 0, group }];
    errors = [...errors, null];
  }

  function solutionGroups() {
    return [...new Set(solutions.map((solution) => solution.group ?? 0))].sort((a, b) => a - b);
  }

  function changeGroup(index: number, group: string | null) {
    if (group === null) return;
    solutions[index] = { ...solutions[index], group: Number(group) };
  }

  function removeSolution(i: number) {
    solutions = solutions.toSpliced(i, 1);
    const groupMap = new Map(solutionGroups().map((group, index) => [group, index]));
    solutions = solutions.map((solution) => ({ ...solution, group: groupMap.get(solution.group) ?? 0 }));
    errors = errors.toSpliced(i, 1);
    validateAll();
  }
</script>

<div class="mt-4 grid gap-1.5">
  <Label class="text-sm font-medium">Solutions</Label>
  <p class="text-xs text-muted-foreground">
    {grouped
      ? "Every answer group is required. Any solution within a group is accepted."
      : "Any one listed solution is accepted."}
  </p>
  <div class="flex flex-col gap-2">
    {#each solutions as _, i}
      <div class="flex flex-col gap-1">
        <div class="flex gap-2 items-start">
          <Select.Root
            type="single"
            value={solutions[i].type}
            onValueChange={(v) => v && onTypeChange(i, v as SolutionType)}
            {disabled}
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
          {#if grouped}
            <Select.Root
              type="single"
              value={String(solutions[i].group ?? 0)}
              onValueChange={(value) => changeGroup(i, value)}
              {disabled}
            >
              <Select.Trigger class="w-[92px] shrink-0 h-9 text-xs">Answer {solutions[i].group + 1}</Select.Trigger>
              <Select.Content>
                {#each solutionGroups() as group}
                  <Select.Item value={String(group)}>Answer {group + 1}</Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          {/if}
          <div class="flex-1">
            {#if solutions[i].type === "expression"}
              <MathField
                value={String(solutions[i].value)}
                inputFormat="ascii-math"
                outputFormat="ascii-math"
                placeholder="Enter an equivalent expression"
                compact
                {disabled}
                onValueChange={(value) => {
                  solutions[i] = { ...solutions[i], value };
                  validateAll();
                }}
              />
            {:else}
              <Input
                type={solutions[i].type === "number" ? "number" : "text"}
                bind:value={solutions[i].value}
                oninput={() => onInput(i)}
                placeholder={solutions[i].type === "number" ? "e.g. 42" : "e.g. hello"}
                class={errors[i] ? "border-destructive focus-visible:border-destructive" : ""}
                {disabled}
              />
            {/if}
          </div>
          <Button
            variant="destructive"
            size="sm"
            class="shrink-0 h-9 w-9 p-0"
            onclick={() => removeSolution(i)}
            {disabled}
          >
            <Minus class="h-4 w-4" />
          </Button>
        </div>
        {#if errors[i]}
          <p class="ml-[118px] text-xs text-destructive">{errors[i]}</p>
        {/if}
      </div>
    {/each}
  </div>
  <div class="flex gap-2 mt-1">
    <Button onclick={addSolution} variant="outline" size="sm" class="gap-1" {disabled}>
      <Plus class="h-3 w-3" /> Add solution
    </Button>
    {#if grouped}
      <Button onclick={addGroup} variant="outline" size="sm" class="gap-1" {disabled}>
        <Plus class="h-3 w-3" /> Add required answer
      </Button>
    {/if}
  </div>
  {#if solutions.length === 0}
    <p class="text-xs text-muted-foreground italic">No solutions added yet. At least one is required.</p>
  {/if}
</div>
