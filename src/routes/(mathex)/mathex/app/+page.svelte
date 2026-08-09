<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Header } from "$lib/components/ui/header";
  import { ArrowUpRight, Calculator, CirclePlay, FileQuestion, ShieldCheck, Timer } from "@lucide/svelte/icons";
</script>

<div class="mathex-shell relative min-h-full overflow-hidden px-4 py-5 sm:px-8 sm:py-8">
  <div class="mathex-grid pointer-events-none absolute inset-0 opacity-70"></div>
  <main class="relative mx-auto max-w-6xl">
    <section class="grid items-center gap-10 py-16 lg:grid-cols-[1.15fr_0.85fr] lg:py-20">
      <div>
        <p class="mathex-kicker">Fast. Focused. Fair.</p>
        <Header size="h1" class="mt-3 max-w-3xl text-5xl leading-[0.95] tracking-[-0.055em] sm:text-7xl">
          Maths competition,<br /><span class="text-primary">in real time.</span>
        </Header>
        <p class="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
          Run a polished Mathex round from one host console, or join a live room and race through every question.
        </p>
        <div class="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button href="/mathex/app/play" size="lg" class="gap-2.5 shadow-lg shadow-primary/20">
            <CirclePlay class="h-5 w-5" />
            Join a competition
          </Button>
          <Button href="/mathex/app/create" size="lg" variant="outline" class="gap-2.5 bg-card/60">
            Host a room
            <ArrowUpRight class="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div class="mathex-panel relative overflow-hidden rounded-3xl p-5 sm:p-7">
        <div class="absolute right-0 top-0 h-32 w-32 rounded-full bg-primary/15 blur-3xl"></div>
        <div class="relative flex items-start justify-between">
          <div>
            <p class="mathex-kicker">Built for the round</p>
            <h2 class="mt-1 text-xl font-semibold">Everything stays in sync.</h2>
          </div>
          <span class="rounded-xl bg-primary/10 p-2.5 text-primary"><Calculator class="h-5 w-5" /></span>
        </div>
        <div class="mt-7 space-y-3">
          <div class="flex gap-3 rounded-2xl border border-border/70 bg-background/50 p-4">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
              ><FileQuestion class="h-4 w-4" /></span
            >
            <div>
              <p class="text-sm font-semibold">One question at a time</p>
              <p class="mt-0.5 text-sm leading-5 text-muted-foreground">
                Players focus on the next problem while the host sees progress as it happens.
              </p>
            </div>
          </div>
          <div class="flex gap-3 rounded-2xl border border-border/70 bg-background/50 p-4">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
              ><Timer class="h-4 w-4" /></span
            >
            <div>
              <p class="text-sm font-semibold">A pace you control</p>
              <p class="mt-0.5 text-sm leading-5 text-muted-foreground">
                Set the time between submissions to match your format.
              </p>
            </div>
          </div>
          <div class="flex gap-3 rounded-2xl border border-border/70 bg-background/50 p-4">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
              ><ShieldCheck class="h-4 w-4" /></span
            >
            <div>
              <p class="text-sm font-semibold">Fair play signals</p>
              <p class="mt-0.5 text-sm leading-5 text-muted-foreground">
                Optionally record when a player leaves the competition tab.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  </main>
</div>
