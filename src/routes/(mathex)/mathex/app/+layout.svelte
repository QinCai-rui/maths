<script lang="ts">
  import { page } from "$app/state";
  import DisclaimerDialog from "$lib/components/DisclaimerDialog.svelte";
  import SiteFooter from "$lib/components/SiteFooter.svelte";
  import SiteNav from "$lib/components/SiteNav.svelte";
  import { Toaster } from "$lib/components/ui/sonner";
  import ThemeToggle from "$lib/components/ui/theme-toggle/theme-toggle.svelte";
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
  <div class="flex min-h-screen flex-col bg-background text-foreground">
    <SiteNav />
    <main class="flex-1">{@render children?.()}</main>
    <SiteFooter />
  </div>
{:else}
  <div class="min-h-screen w-full bg-background text-foreground">
    {@render children?.()}
  </div>
  <div class="fixed bottom-4 right-4 z-50">
    <ThemeToggle />
  </div>
{/if}
