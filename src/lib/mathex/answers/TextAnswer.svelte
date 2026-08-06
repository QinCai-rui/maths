<script lang="ts">
  import { Input } from "$lib/components/ui/input";
  interface Props {
    answer: any;
  }

  let { answer = $bindable() }: Props = $props();
</script>

<Input
  type="text"
  bind:value={answer}
  placeholder="Type your answer"
  class="text-lg"
  onkeydown={(e) => {
    if (e.key === "Enter") {
      e.currentTarget.closest("form")?.requestSubmit();
    }
  }}
/>
