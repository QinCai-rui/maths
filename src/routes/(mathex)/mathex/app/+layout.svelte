<script lang="ts">
  import { page } from "$app/state";
  import SiteNav from "#lib/components/SiteNav.svelte";
  import SiteFooter from "#lib/components/SiteFooter.svelte";
  import DisclaimerDialog from "#lib/components/DisclaimerDialog.svelte";
  import { Toaster } from "#lib/components/ui/sonner/index.js";
  import ThemeToggle from "#lib/components/ui/theme-toggle/theme-toggle.svelte";
  import { ModeWatcher } from "mode-watcher";
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
  <div class="public-site mathex-app flex min-h-screen flex-col">
    <SiteNav />
    <div class="flex-1">{@render children?.()}</div>
    <SiteFooter />
  </div>
{:else}
  <div class="mathex-app min-h-screen w-full bg-background text-foreground">
    {@render children?.()}
  </div>
  <div class="fixed bottom-4 right-4 z-50">
    <ThemeToggle />
  </div>
{/if}
