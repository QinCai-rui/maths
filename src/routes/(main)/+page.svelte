<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Header } from "$lib/components/ui/header";
  import { Calculator, Gamepad2, Hash } from "@lucide/svelte/icons";
</script>

<section class="relative overflow-hidden">
  <div
    class="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,theme(colors.primary/10%),transparent_50%)]"
  ></div>
  <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
    <div class="py-20 sm:py-28 lg:py-36">
      <div class="mx-auto max-w-2xl text-center">
        <h1 class="text-4xl font-bold tracking-tight text-foreground sm:text-6xl lg:leading-[1.1]">
          Devarsh's Maths, revived
        </h1>
        <p class="mt-6 text-lg leading-8 text-muted-foreground sm:text-xl">
          Learn and have fun with activities related to mathematics. Explore number properties, play math games, and
          compete in live quizzes.
        </p>
        <div class="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Button href="/utilities/number" class="gap-2">
            <Hash class="h-4 w-4" />
            Explore Numbers
          </Button>
          <Button href="/games" variant="outline" class="gap-2">
            <Gamepad2 class="h-4 w-4" />
            Play Games
          </Button>
          <Button href="/mathex" variant="ghost" class="gap-2">
            <Calculator class="h-4 w-4" />
            Join Mathex
          </Button>
        </div>
      </div>

      <div class="mt-20 grid grid-cols-1 gap-6 sm:grid-cols-3">
        <a
          href="/utilities/number"
          class="group relative rounded-xl border border-border/60 bg-card p-6 shadow-sm transition-all hover:shadow-md hover:border-primary/20"
        >
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Hash class="h-5 w-5" />
          </div>
          <h3 class="mt-4 text-lg font-semibold text-foreground group-hover:text-primary transition-colors">
            Number Explorer
          </h3>
          <p class="mt-2 text-sm text-muted-foreground">
            Discover fascinating properties of any number — prime factors, patterns, and more.
          </p>
        </a>
        <a
          href="/games"
          class="group relative rounded-xl border border-border/60 bg-card p-6 shadow-sm transition-all hover:shadow-md hover:border-primary/20"
        >
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Gamepad2 class="h-5 w-5" />
          </div>
          <h3 class="mt-4 text-lg font-semibold text-foreground group-hover:text-primary transition-colors">
            Math Games
          </h3>
          <p class="mt-2 text-sm text-muted-foreground">
            Challenge yourself with Digitle — a number-guessing game inspired by Hooda Math.
          </p>
        </a>
        <a
          href="/mathex"
          class="group relative rounded-xl border border-border/60 bg-card p-6 shadow-sm transition-all hover:shadow-md hover:border-primary/20"
        >
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Calculator class="h-5 w-5" />
          </div>
          <h3 class="mt-4 text-lg font-semibold text-foreground group-hover:text-primary transition-colors">
            Live Mathex
          </h3>
          <p class="mt-2 text-sm text-muted-foreground">
            Create or join real-time quiz rooms and compete with friends.
          </p>
        </a>
      </div>
    </div>
  </div>
</section>
