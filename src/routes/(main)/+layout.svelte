<script lang="ts">
  import "../../app.css";
  import SiteNav from "#lib/components/SiteNav.svelte";
  import SiteFooter from "#lib/components/SiteFooter.svelte";
  import DisclaimerDialog from "#lib/components/DisclaimerDialog.svelte";
  import { Toaster } from "#lib/components/ui/sonner/index.js";
  import { ModeWatcher } from "mode-watcher";

  interface Props {
    children?: import("svelte").Snippet;
  }
  let { children }: Props = $props();
</script>

<svelte:head>
  <title>Raymont's Maths</title>
  <meta name="description" content="Raymont's Maths" />
</svelte:head>

<Toaster />
<ModeWatcher defaultMode="light" />
<DisclaimerDialog />

<div class="public-site flex min-h-screen flex-col">
  <a class="skip-link" href="#main-content">Skip to content</a>
  <SiteNav />

  <main id="main-content" tabindex="-1" class="flex-1">
    {@render children?.()}
  </main>

  <SiteFooter />
</div>
