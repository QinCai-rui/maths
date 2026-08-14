<script lang="ts">
  import { Label } from "$lib/components/ui/label";
  import { Button } from "$lib/components/ui/button";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Textarea } from "$lib/components/ui/textarea";
  import Quill from "$lib/components/Quill.svelte";
  import SolutionsEditor from "./SolutionsEditor.svelte";

  import type { DraftQuestionValue } from "../collaborative-set.schemas";

  interface Props {
    question: DraftQuestionValue;
    disabled?: boolean;
  }

  let { question = $bindable(), disabled = false }: Props = $props();

  const SKIPPABLE_MARKER = "[Skippable]";
  const NOT_SKIPPABLE_MARKER = "[Not skippable]";

  let previousSkippable: boolean = $state(question.skippable);

  function syncSkippableMarker() {
    const trimmed = question.answerComment.trim();
    const isAutoSkippable = trimmed === SKIPPABLE_MARKER;
    const isAutoNotSkippable = trimmed === NOT_SKIPPABLE_MARKER;

    if (!question.skippable && (isAutoSkippable || trimmed === "")) {
      question.answerComment = NOT_SKIPPABLE_MARKER;
    } else if (question.skippable && isAutoNotSkippable) {
      question.answerComment = "";
    }
    previousSkippable = question.skippable;
  }

  $effect(() => {
    const current = question.skippable;
    if (current !== previousSkippable) {
      syncSkippableMarker();
    }
  });
</script>

<div class="grid w-full gap-1.5">
  <Label>Question text</Label>
  {#key disabled}
    <Quill bind:html={question.contents} {disabled} />
  {/key}
</div>
<div class="mt-4">
  <SolutionsEditor bind:solutions={question.solutions} grouped={question.requireAllSolutionGroups} {disabled} />
</div>
<div class="mt-4 rounded-lg border border-border/60 bg-muted/20 p-3">
  <div class="flex items-center space-x-2">
    <Checkbox id="require-all-solutions" bind:checked={question.requireAllSolutionGroups} {disabled} />
    <Label for="require-all-solutions" class="cursor-pointer text-sm font-medium">Require every answer group</Label>
  </div>
  <p class="mt-1 pl-6 text-xs text-muted-foreground">
    Solutions in the same answer group are alternatives. Every group must be answered.
  </p>
  {#if question.requireAllSolutionGroups}
    <div class="mt-3 flex items-center gap-2 pl-6">
      <span class="text-xs text-muted-foreground">Answer order</span>
      <Button
        variant="outline"
        size="sm"
        onclick={() => (question.solutionOrderMatters = !question.solutionOrderMatters)}
        {disabled}
      >
        {question.solutionOrderMatters ? "Must match group order" : "Any order allowed"}
      </Button>
    </div>
  {/if}
</div>
<div class="flex items-center space-x-2 mt-3">
  <Checkbox id="allowEquiv" bind:checked={question.allowEquivalent} {disabled} />
  <Label for="allowEquiv" class="text-sm font-medium leading-none cursor-pointer">Allow equivalent expressions</Label>
</div>
<div class="flex items-center space-x-2 mt-3">
  <Checkbox
    id="unskippable"
    checked={!question.skippable}
    onCheckedChange={(checked) => (question.skippable = !checked)}
    {disabled}
  />
  <Label for="unskippable" class="text-sm font-medium leading-none cursor-pointer">Unskippable question</Label>
</div>
<div class="mt-4 grid gap-1.5">
  <Label for="answer-comment">Marker comments</Label>
  <Textarea
    id="answer-comment"
    bind:value={question.answerComment}
    placeholder="Private notes for the answer key"
    {disabled}
  />
</div>
