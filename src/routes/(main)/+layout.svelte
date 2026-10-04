<script lang="ts">
  import "../../app.css";
  import { page } from "$app/state";
  import DisclaimerDialog from "$lib/components/DisclaimerDialog.svelte";
  import { Toaster } from "$lib/components/ui/sonner";
  import ThemeToggle from "$lib/components/ui/theme-toggle/theme-toggle.svelte";
  import { ModeWatcher } from "mode-watcher";
  import { Github, Menu, Sigma, X } from "@lucide/svelte/icons";

  interface Props {
    children?: import("svelte").Snippet;
  }
  let { children }: Props = $props();

  const links = [
    { url: "/", text: "Home" },
    { url: "/tools", text: "Tools" },
    { url: "/mathex", text: "Mathex" }
  ];
  const buildCommit = __BUILD_COMMIT__;
  const buildTime = __BUILD_TIME__;
  let mobileOpen = $state(false);
</script>

<svelte:head>
  <title>Raymont's Maths</title>
  <meta name="description" content="Raymont's Maths" />
</svelte:head>

<Toaster />
<ModeWatcher defaultMode="light" />
<DisclaimerDialog />

<div class="public-site flex min-h-screen flex-col">
  <div class="site-topline sticky top-0 z-50">
    <div class="site-wrap site-nav">
      <a href="/" class="site-brand" aria-label="Raymont's Maths home">
        <span class="site-mark"><Sigma class="h-5 w-5" /></span>
        <span class="site-brand-name">Raymont's Maths</span>
      </a>
      <nav class="site-nav-links" aria-label="Main navigation">
        {#each links as link}
          <a
            href={link.url}
            aria-current={(link.url === "/" ? page.url.pathname === "/" : page.url.pathname.startsWith(link.url))
              ? "page"
              : undefined}>{link.text}</a
          >
        {/each}
      </nav>
      <div class="site-nav-tools">
        <ThemeToggle />
        <a
          href="https://github.com/QinCai-rui/maths"
          target="_blank"
          rel="noreferrer"
          class="site-icon-button hidden sm:grid"
          aria-label="GitHub repository"><Github class="h-4 w-4" /></a
        >
        <button
          class="site-icon-button site-menu-toggle"
          onclick={() => (mobileOpen = !mobileOpen)}
          aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={mobileOpen}
        >
          {#if mobileOpen}<X class="h-4 w-4" />{:else}<Menu class="h-4 w-4" />{/if}
        </button>
      </div>
    </div>
    <div class="site-wrap site-mobile-menu" data-open={mobileOpen}>
      {#each links as link}
        <a
          href={link.url}
          aria-current={(link.url === "/" ? page.url.pathname === "/" : page.url.pathname.startsWith(link.url))
            ? "page"
            : undefined}
          onclick={() => (mobileOpen = false)}>{link.text}</a
        >
      {/each}
    </div>
  </div>

  <main class="flex-1">
    {@render children?.()}
  </main>

  <footer class="site-footer">
    <div class="site-wrap site-footer-inner">
      <div>
        <p class="font-medium text-foreground">
          Made with ♥ by <a href="https://qincai.xyz">Raymont</a> to celebrate Maths Week.
        </p>
        <p>
          Originally made by <a href="https://devarsh.me">Devarsh</a> as a side project in Room 22 @ BBI.
        </p>
      </div>
      <p class="site-build">Built with SvelteKit · Tailwind CSS · Bun<br />git:{buildCommit} · build:{buildTime}</p>
    </div>
  </footer>
</div>
