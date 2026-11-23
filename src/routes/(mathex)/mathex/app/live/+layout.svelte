<script lang="ts">
  import { page } from "$app/state";
  import type { Snippet } from "svelte";
  import "./live.css";

  let { children }: { children?: Snippet } = $props();
</script>

<div class="mathex-live" class:is-screen={page.url.pathname !== "/mathex/app/live"}>
  {@render children?.()}
</div>
