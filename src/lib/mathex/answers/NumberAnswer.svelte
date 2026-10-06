<script lang="ts">
  import { Input } from "$lib/components/ui/input";
  interface Props {
    answer: any;
    id?: string;
  }

  let { answer = $bindable(), id }: Props = $props();
</script>

<Input {id} type="text" inputmode="decimal" bind:value={answer} placeholder="Type your number" class="text-lg" />
