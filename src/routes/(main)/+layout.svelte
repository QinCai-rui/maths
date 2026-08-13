<script lang="ts">
  import "../../app.css";

  import { page } from "$app/state";
  import DisclaimerDialog from "$lib/components/DisclaimerDialog.svelte";
  import { Toaster } from "$lib/components/ui/sonner";

  import { Menu, X, Github, Sigma } from "@lucide/svelte/icons";
  import ThemeToggle from "$lib/components/ui/theme-toggle/theme-toggle.svelte";
  import { ModeWatcher } from "mode-watcher";

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

  const buildCommit = __BUILD_COMMIT__;
  const buildTime = __BUILD_TIME__;

  let mobileOpen = $state(false);
</script>

<svelte:head>
  <title>Raymont's Maths</title>
</svelte:head>

<Toaster />
<ModeWatcher />
<DisclaimerDialog />

<div class="min-h-screen flex flex-col">
  <nav
    class="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75"
  >
    <div class="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
      <a href="/" class="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <span
          class="flex h-8 w-8 items-center justify-center border border-primary bg-primary text-primary-foreground text-base font-bold leading-none"
          ><Sigma class="h-4 w-4" /></span
        >
        Raymont's Maths
      </a>

      <div class="hidden md:flex md:items-center md:gap-1">
        {#each links as link}
          <a
            href={link.url}
            aria-current={page.url.pathname.startsWith(link.url) ? "page" : undefined}
            class={`border-b-2 px-3 py-2 text-sm font-medium transition-colors hover:text-foreground ${page.url.pathname.startsWith(link.url) ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
            >{link.text}</a
          >
        {/each}
        <ThemeToggle />
        <a
          href="https://github.com/QinCai-rui/maths"
          target="_blank"
          class="ml-1 rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
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
          <div class="flex items-center gap-2 pt-2">
            <ThemeToggle />
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
      </div>
    {/if}
  </nav>

  <main class="flex-1">
    {@render children?.()}
  </main>

  <footer class="border-t border-border bg-muted/40">
    <div class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div class="flex flex-col items-center justify-between gap-4 sm:flex-row">
        <div class="flex flex-col items-center gap-1 sm:items-start">
          <p class="text-sm font-medium text-foreground">Made with ♥ by <a href="https://qincai.xyz" class="underline-offset-4 hover:underline">Raymont</a> to celebrate Maths Week.</p>
          <p class="text-sm text-muted-foreground">Originally made by <a href="https://devarsh.me" class="font-medium underline-offset-4 hover:underline">Devarsh</a> as a side project in Room 22 @ BBI.</p>
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
        <p class="mt-2 text-xs text-muted-foreground">
          <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.7rem] text-foreground/80"
            >git:{buildCommit} · build:{buildTime}</code
          >
        </p>
      </div>
    </div>
  </footer>
</div>
