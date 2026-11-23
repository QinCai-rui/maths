<script lang="ts">
  import { Moon, Sun } from "@lucide/svelte/icons";
  import { toggleMode } from "mode-watcher";
  import type { Snippet } from "svelte";
  import { spacedCode } from "./standings.js";

  let { role, code = "", children }: { role: string; code?: string; children?: Snippet } = $props();
</script>

<header class="lv-bar">
  <p class="mathex-kicker">Mathex Live · {role}</p>
  <div class="lv-bar-end">
    {@render children?.()}
    {#if code}
      <p class="lv-bar-code">Event code <strong class="lv-code">{spacedCode(code)}</strong></p>
    {/if}
    <button type="button" class="lv-theme" onclick={toggleMode}>
      <Sun class="sun" /><Moon class="moon" /><span class="sr-only">Toggle theme</span>
    </button>
  </div>
</header>
