<script lang="ts">
  import { Input } from "$lib/components/ui/input";
  import { create, all } from "mathjs";
  import { renderToString } from "katex";

  const math = create(all);

  interface Props {
    answer: any;
  }

  let { answer = $bindable() }: Props = $props();
  let preview = $state("");
  let error = $state("");

  function updatePreview() {
    const val = String(answer || "");
    if (!val.trim()) {
      preview = "";
      error = "";
      return;
    }
    try {
      const parsed = math.parse(val);
      preview = renderToString(parsed.toTex(), { output: "mathml", throwOnError: false });
      error = "";
    } catch (e: any) {
      preview = "";
      error = "Cannot parse expression";
    }
  }
</script>

<div class="flex flex-col gap-2">
  <Input type="text" bind:value={answer} oninput={updatePreview} placeholder="Type a math expression" class="text-lg" />
  {#if preview}
    <div class="rounded border border-border/40 bg-muted/30 p-2 text-center text-sm">
      {@html preview}
    </div>
  {/if}
  {#if error}
    <p class="text-xs text-muted-foreground">{error}</p>
  {/if}
</div>
