<script lang="ts">
  import { page } from "$app/state";
  import DisclaimerDialog from "$lib/components/DisclaimerDialog.svelte";
  import { Toaster } from "$lib/components/ui/sonner";
  import ThemeToggle from "$lib/components/ui/theme-toggle/theme-toggle.svelte";
  import { ModeWatcher } from "mode-watcher";
  import { Sigma } from "@lucide/svelte/icons";
  import "../../../../app.css";
  import "quill/dist/quill.snow.css";
  interface Props {
    children?: import("svelte").Snippet;
  }

  let { children }: Props = $props();

  const siteShellRoutes = ["/mathex/app", "/mathex/app/create", "/mathex/app/play", "/mathex/app/live"];
  const usesSiteShell = $derived(siteShellRoutes.includes(page.url.pathname));
</script>

<svelte:head>
  <title>Mathex - Raymont's Maths</title>
</svelte:head>
<Toaster />
<ModeWatcher defaultMode="light" />
<DisclaimerDialog />
{#if usesSiteShell}
  <div class="mathex-app flex min-h-screen flex-col bg-background text-foreground">
    <div class="mathex-topbar">
      <div class="mathex-topbar-inner">
        <a class="mathex-brand" href="/mathex/app" aria-label="Mathex home">
          <span class="mathex-brand-mark"><Sigma class="h-4 w-4" /></span>
          <span>Mathex</span>
        </a>
        <nav class="mathex-navigation" aria-label="Mathex navigation">
          <a href="/mathex/app/play">Join</a>
          <a href="/mathex/app/create">Host a room</a>
          <a href="/mathex/app/live">Live event</a>
        </nav>
        <a class="mathex-back-link" href="/mathex">Raymont's Maths</a>
      </div>
    </div>
    <main class="flex-1">{@render children?.()}</main>
    <footer class="mathex-footer">
      <div class="mathex-footer-inner">
        <span>Mathex competition tools</span>
        <a href="/mathex">Back to Raymont's Maths</a>
      </div>
    </footer>
  </div>
{:else}
  <div class="mathex-app min-h-screen w-full bg-background text-foreground">
    {@render children?.()}
  </div>
  <div class="fixed bottom-4 right-4 z-50">
    <ThemeToggle />
  </div>
{/if}
