<script lang="ts">
  import { Input } from "$lib/components/ui/input";
  interface Props {
    answer: any;
    id?: string;
  }

  let { answer = $bindable(), id }: Props = $props();
</script>

<Input {id} type="text" bind:value={answer} placeholder="Type your answer" class="text-lg" />
