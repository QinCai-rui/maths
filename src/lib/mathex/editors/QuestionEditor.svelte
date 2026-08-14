<script lang="ts">
  import { Label } from "$lib/components/ui/label";
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
</script>

<div class="grid w-full gap-1.5">
  <Label>Question text</Label>
  <Quill bind:html={question.contents} {disabled} />
</div>
<div class="mt-4"><SolutionsEditor bind:solutions={question.solutions} {disabled} /></div>
<div class="flex items-center space-x-2 mt-3">
  <Checkbox id="allowEquiv" bind:checked={question.allowEquivalent} {disabled} />
  <Label for="allowEquiv" class="text-sm font-medium leading-none cursor-pointer">Allow equivalent expressions</Label>
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
