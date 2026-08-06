<script lang="ts">
  import { Label } from "$lib/components/ui/label";
  import Quill from "$lib/components/Quill.svelte";
  import SolutionsEditor from "./SolutionsEditor.svelte";

  import { z } from "zod";
  import type { NumberQuestion } from "../schemas";

  interface Props {
    question: z.infer<typeof NumberQuestion> | null;
  }

  let { question = $bindable() }: Props = $props();
  if (question === null)
    question = {
      contents: "",
      solutions: []
    };
</script>

<div class="grid w-full gap-1.5">
  <Label>Question text</Label>
  <Quill bind:html={question.contents} />
</div>
<SolutionsEditor bind:solutions={question.solutions} />
