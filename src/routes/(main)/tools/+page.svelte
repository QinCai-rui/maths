<script lang="ts">
  import { Header } from "$lib/components/ui/header";
  import { Brain, CircleDot, Gamepad2, Pencil, Radio, Zap } from "@lucide/svelte/icons";

  interface Game {
    name: string;
    description: string;
    url: string;
    colour: string;
    icon: typeof Gamepad2;
  }

  const games: Game[] = [
    {
      name: "Digitle",
      description: "A game where you guess a 5-digit number with a limited number of attempts.",
      url: "/tools/digitle",
      colour:
        "bg-blue-500/10 text-blue-600 border-blue-200 hover:border-blue-400 dark:bg-blue-500/20 dark:text-blue-400 dark:border-blue-800",
      icon: Gamepad2
    },
    {
      name: "Basic Facts",
      description: "Beat the clock with arithmetic, multiplication, powers, and square roots.",
      url: "/tools/basic-facts",
      colour:
        "bg-amber-500/10 text-amber-600 border-amber-200 hover:border-amber-400 dark:bg-amber-500/20 dark:text-amber-400 dark:border-amber-800",
      icon: Zap
    },
    {
      name: "Sequencing",
      description: "Read increasingly challenging number patterns and choose the next value.",
      url: "/tools/sequencing",
      colour:
        "bg-violet-500/10 text-violet-600 border-violet-200 hover:border-violet-400 dark:bg-violet-500/20 dark:text-violet-400 dark:border-violet-800",
      icon: Brain
    },
    {
      name: "Factor Finder",
      description: "Test your divisibility skills by finding every factor of a target number.",
      url: "/tools/factor-finder",
      colour:
        "bg-emerald-500/10 text-emerald-600 border-emerald-200 hover:border-emerald-400 dark:bg-emerald-500/20 dark:text-emerald-400 dark:border-emerald-800",
      icon: CircleDot
    }
  ];
</script>

<div class="py-12">
  <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
    <div class="mx-auto max-w-2xl lg:mx-0">
      <Header size="h1">Tools</Header>
      <p class="mt-2 text-lg text-muted-foreground">Play games and build Mathex question sets.</p>
    </div>
    <div class="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {#each games as game}
        <a
          href={game.url}
          class="group relative rounded-xl border border-border/60 bg-card p-6 shadow-sm transition-all hover:shadow-md hover:border-primary/20"
        >
          <div class="flex items-center gap-3">
            <div class="flex h-10 w-10 items-center justify-center rounded-lg {game.colour}">
              <game.icon class="h-5 w-5" />
            </div>
            <h3 class="text-lg font-semibold text-foreground group-hover:text-primary transition-colors">
              {game.name}
            </h3>
          </div>
          <p class="mt-3 text-sm text-muted-foreground">{game.description}</p>
          <div
            class="mt-4 flex items-center text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100"
          >
            Play now
            <svg class="ml-1 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </a>
      {/each}
      <a
        href="/mathex/app/create/editor"
        class="group relative rounded-xl border border-border/60 bg-card p-6 shadow-sm transition-all hover:shadow-md hover:border-primary/20"
      >
        <div class="flex items-center gap-3">
          <div
            class="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 border-rose-200 dark:bg-rose-500/20 dark:text-rose-400 dark:border-rose-800"
          >
            <Pencil class="h-5 w-5" />
          </div>
          <h3 class="text-lg font-semibold text-foreground group-hover:text-primary transition-colors">
            Mathex Set Editor
          </h3>
        </div>
        <p class="mt-3 text-sm text-muted-foreground">Create and edit question sets for a Mathex round.</p>
        <div
          class="mt-4 flex items-center text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100"
        >
          Open editor
          <svg class="ml-1 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </a>
      <a
        href="/mathex/app/live"
        class="group relative rounded-xl border border-border/60 bg-card p-6 shadow-sm transition-all hover:border-primary/20 hover:shadow-md"
      >
        <div class="flex items-center gap-3">
          <div
            class="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-200 bg-cyan-500/10 text-cyan-600 dark:border-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-400"
          >
            <Radio class="h-5 w-5" />
          </div>
          <h3 class="text-lg font-semibold text-foreground transition-colors group-hover:text-primary">
            Mathex Live Dashboard
          </h3>
        </div>
        <p class="mt-3 text-sm text-muted-foreground">Score and project a physical Mathex competition in real time.</p>
        <div
          class="mt-4 flex items-center text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100"
        >
          Set up dashboard
          <svg class="ml-1 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"
            ><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg
          >
        </div>
      </a>
    </div>
  </div>
</div>
