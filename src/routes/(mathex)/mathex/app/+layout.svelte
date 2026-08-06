<script lang="ts">
  import { Toaster } from "$lib/components/ui/sonner";
  import "../../../../app.css";
  import "quill/dist/quill.snow.css";
  interface Props {
    children?: import("svelte").Snippet;
  }

  let { children }: Props = $props();
</script>

<svelte:head>
  <title>Mathex - Devarsh's Maths, revived</title>
</svelte:head>
<Toaster />
<div class="min-h-screen w-full bg-background text-foreground">
  {@render children?.()}
</div>
