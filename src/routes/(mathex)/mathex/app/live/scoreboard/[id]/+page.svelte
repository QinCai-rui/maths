<script lang="ts">
  import { page } from "$app/state";
  import type {
    PhysicalScoreboardClientToServerEvents,
    PhysicalScoreboardServerToClientEvents,
    PhysicalScoreboardSnapshot
  } from "$lib/mathex/physical.schemas";
  import { Check, CircleMinus, Clock3, Radio, X } from "@lucide/svelte/icons";
  import { io, type Socket } from "socket.io-client";

  const id = page.params.id;
  const socket: Socket<PhysicalScoreboardServerToClientEvents, PhysicalScoreboardClientToServerEvents> = io(
    `/physical-scoreboard-${id}`,
    { forceNew: true }
  );
  let snapshot: PhysicalScoreboardSnapshot | null = $state(null);
  let receivedAt = $state(Date.now());
  let now = $state(Date.now());
  let connected = $state(false);

  socket.on("connect", () => (connected = true));
  socket.on("disconnect", () => (connected = false));
  socket.on("snapshot", (next) => {
    snapshot = next;
    receivedAt = Date.now();
  });

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(timer);
  });

  const remainingMs = $derived.by(() => {
    if (!snapshot || snapshot.countdownRemainingMs === null) return null;
    return snapshot.countdownRemainingMs - (snapshot.state === "running" ? now - receivedAt : 0);
  });
  const clock = $derived.by(() => {
    if (remainingMs === null) return null;
    const sign = remainingMs < 0 ? "−" : "";
    const totalSeconds = Math.floor(Math.abs(remainingMs) / 1000);
    return `${sign}${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
  });
  const ranked = $derived.by(() => snapshot?.teams || []);
  const groups = $derived.by(() => {
    const names = [...new Set(ranked.map((team) => team.group || "All teams"))];
    return names.map((name) => ({ name, teams: ranked.filter((team) => (team.group || "All teams") === name) }));
  });
</script>

<svelte:head><title>{snapshot?.name || "Mathex Live"} - Scoreboard</title></svelte:head>

<div class="min-h-screen bg-slate-950 px-3 py-4 text-slate-50 sm:px-7 sm:py-6">
  <main class="mx-auto max-w-[100rem]">
    <header class="flex flex-wrap items-end justify-between gap-4 border-b border-white/15 pb-5">
      <div>
        <p class="text-xs font-bold uppercase tracking-[0.2em] text-blue-400">Mathex live</p>
        <h1 class="mt-1 text-3xl font-black tracking-tight sm:text-5xl">{snapshot?.name || "Connecting..."}</h1>
      </div>
      <div class="flex items-center gap-5">
        <span
          class="flex items-center gap-2 text-xs font-bold uppercase tracking-wider {connected
            ? 'text-emerald-400'
            : 'text-amber-400'}"><Radio class="h-4 w-4" />{connected ? snapshot?.state || "Live" : "Reconnecting"}</span
        >
        {#if clock !== null}<div
            class="flex items-center gap-3 rounded-2xl border px-4 py-2 {remainingMs !== null && remainingMs < 0
              ? 'border-red-400/60 bg-red-500/15 text-red-300'
              : 'border-white/15 bg-white/5'}"
          >
            <Clock3 class="h-5 w-5" /><span class="text-3xl font-black tabular-nums sm:text-5xl">{clock}</span>
          </div>{/if}
      </div>
    </header>

    {#if snapshot}
      <div class="mt-5 grid gap-6 {groups.length > 1 ? 'xl:grid-cols-2' : ''}">
        {#each groups as group}
          <section>
            {#if groups.length > 1}<h2 class="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-blue-300">
                {group.name}
              </h2>{/if}
            <div class="space-y-2">
              {#each group.teams as team}
                <article
                  class="grid grid-cols-[3.25rem_1fr_auto] items-center gap-3 rounded-xl border border-white/10 bg-white/[0.055] px-3 py-3 sm:grid-cols-[4rem_1fr_9rem_auto] sm:px-5"
                >
                  <span class="text-center text-2xl font-black tabular-nums text-slate-400 sm:text-3xl"
                    >{team.rank}</span
                  >
                  <div class="min-w-0">
                    <h3 class="truncate text-lg font-bold sm:text-2xl">{team.name}</h3>
                    {#if team.group}<p class="truncate text-xs text-slate-400 sm:hidden">{team.group}</p>{/if}
                  </div>
                  <div class="hidden text-center sm:block">
                    <p class="text-xs font-bold uppercase tracking-wider text-slate-400">Question</p>
                    <p class="text-2xl font-black tabular-nums">
                      {Math.min(team.currentQuestion, snapshot.questionCount)}<span class="text-sm text-slate-500"
                        >/{snapshot.questionCount}</span
                      >
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <span
                      class="flex items-center gap-1 rounded-lg bg-emerald-400/12 px-2 py-1 text-sm font-bold text-emerald-300"
                      ><Check class="h-4 w-4" />{team.correct}</span
                    >
                    <span
                      class="flex items-center gap-1 rounded-lg bg-red-400/12 px-2 py-1 text-sm font-bold text-red-300"
                      ><X class="h-4 w-4" />{team.incorrect}</span
                    >
                    <span
                      class="hidden items-center gap-1 rounded-lg bg-amber-400/12 px-2 py-1 text-sm font-bold text-amber-300 sm:flex"
                      ><CircleMinus class="h-4 w-4" />{team.skipped}</span
                    >
                  </div>
                  <div class="col-span-3 flex items-center justify-between border-t border-white/10 pt-2 sm:col-span-4">
                    <span
                      class="text-xs font-bold uppercase tracking-wider {team.lastResult === 'correct'
                        ? 'text-emerald-300'
                        : team.lastResult === 'skip'
                          ? 'text-amber-300'
                          : 'text-blue-300'}"
                    >
                      {team.currentQuestion > snapshot.questionCount
                        ? team.correct === snapshot.questionCount
                          ? "Solved every question"
                          : `Finished · ${team.skipped} skipped`
                        : team.lastResult === "correct"
                          ? `Solved Q${Math.max(1, team.currentQuestion - 1)}`
                          : team.lastResult === "skip"
                            ? `Skipped Q${Math.max(1, team.currentQuestion - 1)}`
                            : `Working on Q${team.currentQuestion}`}
                    </span>
                    <span class="text-xs text-slate-500 sm:hidden"
                      >Q {Math.min(team.currentQuestion, snapshot.questionCount)}/{snapshot.questionCount}</span
                    >
                  </div>
                  <div
                    class="col-span-3 flex h-1.5 gap-0.5 overflow-hidden rounded-full sm:col-span-4"
                    aria-label="{team.name} question progress"
                  >
                    {#each team.questions as question}
                      <span
                        title="Q{question.questionNumber}: {question.outcome}{question.incorrect
                          ? `, ${question.incorrect} wrong`
                          : ''}"
                        class="min-w-0 flex-1 {question.outcome === 'correct'
                          ? 'bg-emerald-400'
                          : question.outcome === 'skipped'
                            ? 'bg-amber-400'
                            : question.questionNumber === team.currentQuestion
                              ? 'bg-blue-400'
                              : 'bg-white/10'}"
                      ></span>
                    {/each}
                  </div>
                </article>
              {/each}
            </div>
          </section>
        {/each}
      </div>
    {:else}
      <div class="grid min-h-[60vh] place-items-center text-slate-400">Waiting for competition data...</div>
    {/if}
  </main>
</div>
