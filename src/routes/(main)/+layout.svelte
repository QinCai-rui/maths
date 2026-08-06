<script lang="ts">
  import "../../app.css";

  import { page } from "$app/state";
  import { Toaster } from "$lib/components/ui/sonner";

  import { Menu, X, Github } from "@lucide/svelte/icons";

  interface Props {
    children?: import("svelte").Snippet;
  }

  let { children }: Props = $props();

  interface LinkBarItem {
    url: string;
    text: String;
  }

  const links: LinkBarItem[] = [
    {
      url: "/utilities/number",
      text: "Numbers"
    },
    {
      url: "/games",
      text: "Games"
    },
    {
      url: "/mathex",
      text: "Mathex"
    }
  ];

  let mobileOpen = $state(false);
</script>

<svelte:head>
  <title>Devarsh's Maths, revived</title>
</svelte:head>

<Toaster />

<div class="min-h-screen flex flex-col">
  <nav
    class="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
  >
    <div class="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
      <a href="/" class="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <span
          class="bg-primary text-primary-foreground flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold"
          >M</span
        >
        Devarsh's Maths, revived
      </a>

      <div class="hidden md:flex md:items-center md:gap-1">
        {#each links as link}
          <a
            href={link.url}
            aria-current={page.url.pathname.startsWith(link.url) ? "page" : undefined}
            class={`rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground ${page.url.pathname.startsWith(link.url) ? "text-primary bg-accent" : "text-muted-foreground"}`}
            >{link.text}</a
          >
        {/each}
        <a
          href="https://github.com/QinCai-rui/maths"
          target="_blank"
          class="ml-2 rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label="GitHub repository"
        >
          <Github class="h-5 w-5" />
        </a>
      </div>

      <button
        class="md:hidden rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        onclick={() => (mobileOpen = !mobileOpen)}
        aria-label="Toggle navigation menu"
        aria-expanded={mobileOpen}
      >
        {#if mobileOpen}
          <X class="h-6 w-6" />
        {:else}
          <Menu class="h-6 w-6" />
        {/if}
      </button>
    </div>

    {#if mobileOpen}
      <div class="md:hidden border-t border-border/40 bg-background/95 backdrop-blur">
        <div class="space-y-1 px-4 pb-3 pt-2">
          {#each links as link}
            <a
              href={link.url}
              aria-current={page.url.pathname.startsWith(link.url) ? "page" : undefined}
              class={`block rounded-md px-3 py-2 text-base font-medium transition-colors ${page.url.pathname.startsWith(link.url) ? "text-primary bg-accent" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}
              onclick={() => (mobileOpen = false)}>{link.text}</a
            >
          {/each}
          <a
            href="https://github.com/QinCai-rui/maths"
            target="_blank"
            class="flex items-center gap-2 rounded-md px-3 py-2 text-base font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Github class="h-5 w-5" />
            GitHub
          </a>
        </div>
      </div>
    {/if}
  </nav>

  <main class="flex-1">
    {@render children?.()}
  </main>

  <footer class="border-t border-border/40 bg-muted/30">
    <div class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div class="flex flex-col items-center justify-between gap-4 sm:flex-row">
        <div class="flex flex-col items-center gap-1 sm:items-start">
          <p class="text-sm font-medium text-foreground">Devarsh's Maths, revived</p>
          <p class="text-sm text-muted-foreground">Learn and have fun with mathematics.</p>
        </div>
        <div class="flex items-center gap-4">
          <a
            href="https://github.com/QinCai-rui/maths"
            target="_blank"
            class="text-muted-foreground transition-colors hover:text-foreground"
            aria-label="GitHub"
          >
            <Github class="h-5 w-5" />
          </a>
        </div>
      </div>
      <div class="mt-6 border-t border-border/40 pt-6 text-center">
        <p class="text-xs text-muted-foreground">Built with SvelteKit, Tailwind CSS, and Bun.</p>
      </div>
    </div>
  </footer>
</div>
