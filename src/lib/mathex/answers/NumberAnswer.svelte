<script lang="ts">
  import { Input } from "$lib/components/ui/input";
  interface Props {
    answer: any;
  }

  let { answer = $bindable() }: Props = $props();
</script>

<Input type="text" inputmode="decimal" bind:value={answer} placeholder="Type your number" class="text-lg" />
