<script lang="ts">
  import { Header } from "$lib/components/ui/header";
  import { Gamepad2 } from "@lucide/svelte/icons";

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
      url: "/games/digitle",
      colour:
        "bg-blue-500/10 text-blue-600 border-blue-200 hover:border-blue-400 dark:bg-blue-500/20 dark:text-blue-400 dark:border-blue-800",
      icon: Gamepad2
    }
  ];
</script>

<div class="py-12">
  <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
    <div class="mx-auto max-w-2xl lg:mx-0">
      <Header size="h1">Games</Header>
      <p class="mt-2 text-lg text-muted-foreground">Sharpen your math skills with interactive games.</p>
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
    </div>
  </div>
</div>
