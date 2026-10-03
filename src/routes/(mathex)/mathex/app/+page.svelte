<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { ArrowRight, CirclePlay, FileQuestion, Radio, UsersRound } from "@lucide/svelte/icons";
</script>

<svelte:head>
  <title>Mathex competitions — Raymont's Maths</title>
</svelte:head>

<main class="mx-auto w-full max-w-6xl px-4 py-10 sm:px-7 sm:py-14">
  <section
    class="grid items-start gap-10 border-b border-border pb-10 md:grid-cols-[1.15fr_0.85fr] md:items-center md:pb-14"
  >
    <div>
      <p class="mathex-kicker">Online and in-person competitions</p>
      <h1 class="mt-3 max-w-2xl text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
        Run a Mathex competition.
      </h1>
      <p class="mt-5 max-w-xl text-lg leading-7 text-muted-foreground">
        Join a hosted round, create a room for players, or set up scorekeeping for an in-person event.
      </p>
      <div class="mt-7 flex flex-col gap-3 sm:flex-row">
        <Button href="/mathex/app/play" size="lg" class="gap-2"><CirclePlay /> Join a competition</Button>
        <Button href="/mathex/app/create" size="lg" variant="outline">Host an online room</Button>
      </div>
    </div>
    <section aria-label="Choose a Mathex task" class="grid gap-0 border-l border-t border-border sm:grid-cols-2">
      <a href="/mathex/app/create" class="group border-b border-r border-border p-5 hover:bg-card">
        <UsersRound class="h-5 w-5 text-primary" />
        <h2 class="mt-5 text-lg font-semibold">Host online</h2>
        <p class="mt-1 text-sm text-muted-foreground">Choose questions, set the pace and share the room code.</p>
        <span class="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary"
          >Create a room <ArrowRight class="h-4 w-4" /></span
        >
      </a>
      <a href="/mathex/app/live" class="group border-b border-r border-border p-5 hover:bg-card">
        <Radio class="h-5 w-5 text-primary" />
        <h2 class="mt-5 text-lg font-semibold">Run an in-person event</h2>
        <p class="mt-1 text-sm text-muted-foreground">Track teams, mark answers and show live standings.</p>
        <span class="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary"
          >Set up live scoring <ArrowRight class="h-4 w-4" /></span
        >
      </a>
      <a href="/mathex/app/create/editor" class="group border-b border-r border-border p-5 hover:bg-card sm:col-span-2">
        <FileQuestion class="h-5 w-5 text-primary" />
        <h2 class="mt-5 text-lg font-semibold">Create a question set</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Write questions and answers, then use the set in a competition.
        </p>
        <span class="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary"
          >Open the set editor <ArrowRight class="h-4 w-4" /></span
        >
      </a>
    </section>
  </section>
</main>
