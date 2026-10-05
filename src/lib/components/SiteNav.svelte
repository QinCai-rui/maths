<script lang="ts">
  import { page } from "$app/state";
  import { Github, Menu, Sigma, X } from "@lucide/svelte/icons";
  import ThemeToggle from "$lib/components/ui/theme-toggle/theme-toggle.svelte";

  const links = [
    { url: "/", text: "Home" },
    { url: "/tools", text: "Tools" },
    { url: "/mathex", text: "Mathex" }
  ];

  let mobileOpen = $state(false);
</script>

<div class="site-topline sticky top-0 z-40">
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
        aria-label="GitHub repository"><Github class="h-5 w-5" /></a
      >
      <button
        class="site-icon-button site-menu-toggle"
        onclick={() => (mobileOpen = !mobileOpen)}
        aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={mobileOpen}
      >
        {#if mobileOpen}<X class="h-6 w-6" />{:else}<Menu class="h-6 w-6" />{/if}
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
