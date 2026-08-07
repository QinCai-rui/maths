<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { ArrowUpRight, Calculator, Gamepad2, Hash, Sigma, Sparkles } from "@lucide/svelte/icons";
</script>

<section class="mathex-shell relative isolate overflow-hidden">
  <div class="mathex-grid pointer-events-none absolute inset-x-0 top-0 h-[38rem] opacity-70"></div>
  <div class="pointer-events-none absolute -right-32 top-24 h-80 w-80 rounded-full bg-primary/15 blur-3xl"></div>

  <div class="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8 lg:py-16">
    <div class="grid gap-8 lg:grid-cols-[1.12fr_0.88fr] lg:items-end lg:gap-12">
      <div class="pb-2 lg:pb-8">
        <div class="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          <span class="h-px w-8 bg-primary"></span>
          A place to think in numbers
        </div>
        <h1
          class="mt-6 max-w-3xl text-5xl font-bold leading-[0.91] tracking-[-0.065em] text-foreground sm:text-7xl lg:text-8xl"
        >
          Maths that<br />doesn&apos;t sit still.
        </h1>
        <p class="mt-7 max-w-xl text-lg leading-8 text-muted-foreground sm:text-xl">
          Explore curious number facts, make a game of patterns, and put your quick thinking to the test in a live
          Mathex round.
        </p>
        <div class="mt-9 flex flex-col gap-3 sm:flex-row">
          <Button href="/utilities/number" size="lg" class="gap-2.5 shadow-lg shadow-primary/20">
            Start exploring
            <ArrowUpRight class="h-4 w-4" />
          </Button>
          <Button href="/mathex" size="lg" variant="outline" class="gap-2.5 bg-card/65">
            <Calculator class="h-4 w-4" />
            Open Mathex
          </Button>
        </div>
      </div>

      <div class="mathex-panel relative overflow-hidden rounded-[2rem] p-5 sm:p-7">
        <div class="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary/15 blur-2xl"></div>
        <div class="relative flex items-start justify-between">
          <div>
            <p class="mathex-kicker">Today&apos;s invitation</p>
            <p class="mt-2 text-sm text-muted-foreground">No worksheet required.</p>
          </div>
          <span
            class="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25"
          >
            <Sigma class="h-5 w-5" />
          </span>
        </div>
        <div class="relative mt-10 flex items-end justify-between gap-4">
          <div class="font-mono text-7xl font-medium leading-none tracking-[-0.1em] text-foreground sm:text-8xl">π</div>
          <div class="mb-1 text-right">
            <p class="text-2xl font-semibold tracking-tight">3.14159...</p>
            <p class="mt-1 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Always more to find
            </p>
          </div>
        </div>
        <div class="relative mt-9 border-t border-border/70 pt-4">
          <div class="flex items-center justify-between text-sm">
            <span class="text-muted-foreground">Pick a path below</span>
            <Sparkles class="h-4 w-4 text-primary" />
          </div>
        </div>
      </div>
    </div>

    <div class="mt-12 grid gap-4 md:grid-cols-3 lg:mt-16">
      <a
        href="/utilities/number"
        class="mathex-panel group relative overflow-hidden rounded-2xl p-5 transition-transform hover:-translate-y-1 sm:p-6"
      >
        <div
          class="absolute -right-7 -top-7 h-28 w-28 rounded-full bg-primary/10 transition-transform group-hover:scale-125"
        ></div>
        <div class="relative flex items-start justify-between">
          <span class="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"
            ><Hash class="h-5 w-5" /></span
          >
          <span class="font-mono text-xs text-muted-foreground">01 / 03</span>
        </div>
        <h2 class="relative mt-9 text-2xl font-semibold tracking-tight">Number explorer</h2>
        <p class="relative mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
          Pull apart any number to see its factors, patterns, and surprising properties.
        </p>
        <span class="relative mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
          >Investigate <ArrowUpRight class="h-4 w-4" /></span
        >
      </a>

      <a
        href="/games"
        class="mathex-panel group relative overflow-hidden rounded-2xl p-5 transition-transform hover:-translate-y-1 sm:p-6"
      >
        <div class="relative flex items-start justify-between">
          <span class="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"
            ><Gamepad2 class="h-5 w-5" /></span
          >
          <span class="font-mono text-xs text-muted-foreground">02 / 03</span>
        </div>
        <h2 class="relative mt-9 text-2xl font-semibold tracking-tight">Games with bite</h2>
        <p class="relative mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
          Try Digitle, a number-guessing challenge where every clue narrows the field.
        </p>
        <span class="relative mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
          >Play a round <ArrowUpRight class="h-4 w-4" /></span
        >
      </a>

      <a
        href="/mathex"
        class="group relative overflow-hidden rounded-2xl bg-primary p-5 text-primary-foreground shadow-xl shadow-primary/20 transition-transform hover:-translate-y-1 sm:p-6"
      >
        <div
          class="absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,rgb(255_255_255_/_0.2),transparent_38%)]"
        ></div>
        <div class="relative flex items-start justify-between">
          <span class="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15"
            ><Calculator class="h-5 w-5" /></span
          >
          <span class="font-mono text-xs text-primary-foreground/65">03 / 03</span>
        </div>
        <h2 class="relative mt-9 text-2xl font-semibold tracking-tight">Live Mathex</h2>
        <p class="relative mt-2 max-w-sm text-sm leading-6 text-primary-foreground/80">
          Host a room or race your friends through a real-time mathematics competition.
        </p>
        <span class="relative mt-6 inline-flex items-center gap-1.5 text-sm font-semibold"
          >Join the action <ArrowUpRight class="h-4 w-4" /></span
        >
      </a>
    </div>
  </div>
</section>
