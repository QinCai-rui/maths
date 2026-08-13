<script lang="ts">
  import { Label } from "$lib/components/ui/label";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Textarea } from "$lib/components/ui/textarea";
  import Quill from "$lib/components/Quill.svelte";
  import SolutionsEditor from "./SolutionsEditor.svelte";

  import { z } from "zod";
  import type { Question } from "../schemas";

  interface Props {
    question: z.infer<typeof Question>;
  }

  let { question = $bindable() }: Props = $props();
</script>

<div class="grid w-full gap-1.5">
  <Label>Question text</Label>
  <Quill bind:html={question.contents} />
</div>
<div class="mt-4"><SolutionsEditor bind:solutions={question.solutions} /></div>
<div class="flex items-center space-x-2 mt-3">
  <Checkbox id="allowEquiv" bind:checked={question.allowEquivalent} />
  <Label for="allowEquiv" class="text-sm font-medium leading-none cursor-pointer">Allow equivalent expressions</Label>
</div>
<div class="mt-4 grid gap-1.5">
  <Label for="answer-comment">Marker comments</Label>
  <Textarea id="answer-comment" bind:value={question.answerComment} placeholder="Private notes for the answer key" />
</div>
