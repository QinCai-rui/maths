<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { ArrowRight, Calculator, Gamepad2, Hash, Sigma } from "@lucide/svelte/icons";
</script>

<section class="mathex-shell relative isolate overflow-hidden">
  <div class="mathex-grid pointer-events-none absolute inset-x-0 top-0 h-[38rem] opacity-70"></div>
  <div class="relative mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
    <div class="grid border-y border-border lg:grid-cols-[1.15fr_0.85fr]">
      <div class="py-8 pr-0 lg:py-14 lg:pr-14">
        <p class="mathex-kicker">Devarsh's Maths, revived</p>
        <h1
          class="display-type mt-5 max-w-3xl text-5xl font-bold leading-[0.98] tracking-[-0.045em] text-foreground sm:text-7xl"
        >
          Mathematics,<br />worth lingering over.
        </h1>
        <p class="mt-6 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg">
          Explore interesting number facts, play a game of Wordle (but with numbers), and put your quick thinking and accuracy to the test in a live Mathex round.
        </p>
        <div class="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button href="/utilities/number" size="lg" class="gap-2">
            Explore numbers
            <ArrowRight class="h-4 w-4" />
          </Button>
          <Button href="/mathex" size="lg" variant="outline" class="gap-2.5 bg-card/65">
            <Calculator class="h-4 w-4" />
            Open Mathex
          </Button>
        </div>
      </div>

      <aside class="border-t border-border py-8 lg:border-l lg:border-t-0 lg:py-14 lg:pl-10">
        <div class="flex items-start justify-between">
          <div>
            <p class="mathex-kicker">A number for today</p>
            <p class="mt-2 text-sm text-muted-foreground">An irrational beginning.</p>
          </div>
          <span
            class="flex h-10 w-10 items-center justify-center border border-primary bg-primary text-primary-foreground"
          >
            <Sigma class="h-5 w-5" />
          </span>
        </div>
        <div class="mt-12 border-b border-border pb-5">
          <div class="display-type text-8xl leading-none text-foreground">π</div>
          <p class="mt-4 font-mono text-xl font-medium tracking-tight">3.14159...</p>
        </div>
        <p class="mt-4 max-w-xs text-sm leading-6 text-muted-foreground">
          The ratio of a circle&apos;s circumference to its diameter, with no last digit in sight.
        </p>
      </aside>
    </div>

    <div class="mt-12 grid border-l border-t border-border md:grid-cols-3 lg:mt-16">
      <a
        href="/utilities/number"
        class="group border-b border-r border-border p-6 transition-colors hover:bg-muted/50 sm:p-7"
      >
        <div class="flex items-start justify-between">
          <span class="flex h-10 w-10 items-center justify-center border border-primary/30 bg-primary/5 text-primary"
            ><Hash class="h-5 w-5" /></span
          >
          <span class="font-mono text-xs text-muted-foreground">01</span>
        </div>
        <h2 class="display-type mt-8 text-2xl font-bold">Number explorer</h2>
        <p class="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
          Pull apart any number to see its factors, patterns, and surprising properties.
        </p>
        <span class="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
          >Investigate <ArrowRight class="h-4 w-4 transition-transform group-hover:translate-x-1" /></span
        >
      </a>

      <a href="/games" class="group border-b border-r border-border p-6 transition-colors hover:bg-muted/50 sm:p-7">
        <div class="relative flex items-start justify-between">
          <span class="flex h-10 w-10 items-center justify-center border border-primary/30 bg-primary/5 text-primary"
            ><Gamepad2 class="h-5 w-5" /></span
          >
          <span class="font-mono text-xs text-muted-foreground">02</span>
        </div>
        <h2 class="display-type mt-8 text-2xl font-bold">Games with bite</h2>
        <p class="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
          Play games that reward pattern-spotting, quick thinking, and a little persistence.
        </p>
        <span class="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
          >Play a round <ArrowRight class="h-4 w-4 transition-transform group-hover:translate-x-1" /></span
        >
      </a>

      <a
        href="/mathex"
        class="group border-b border-r border-border bg-foreground p-6 text-background transition-colors hover:bg-primary sm:p-7"
      >
        <div class="flex items-start justify-between">
          <span class="flex h-10 w-10 items-center justify-center border border-background/30 bg-background/10"
            ><Calculator class="h-5 w-5" /></span
          >
          <span class="font-mono text-xs text-background/65">03</span>
        </div>
        <h2 class="display-type mt-8 text-2xl font-bold">Live Mathex</h2>
        <p class="mt-2 max-w-sm text-sm leading-6 text-background/75">
          Host a room or race your friends through a real-time mathematics competition.
        </p>
        <span class="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold"
          >Join the action <ArrowRight class="h-4 w-4 transition-transform group-hover:translate-x-1" /></span
        >
      </a>
    </div>
  </div>
</section>
