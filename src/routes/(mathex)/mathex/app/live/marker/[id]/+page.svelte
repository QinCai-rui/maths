<script lang="ts">
  import { page } from "$app/state";
  import { Button } from "$lib/components/ui/button";
  import { Header } from "$lib/components/ui/header";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import type {
    PhysicalMarkerClientToServerEvents,
    PhysicalMarkerServerToClientEvents,
    PhysicalMarkerSnapshot,
    PhysicalOperationResult
  } from "$lib/mathex/physical.schemas";
  import { ArrowLeft, Check, CircleMinus, LayoutGrid, RotateCcw, ShieldCheck, Target, X } from "@lucide/svelte/icons";
  import { io, type Socket } from "socket.io-client";
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";

  const id = page.params.id;
  const sessionKey = `mathex-live-marker-${id}`;
  const socket: Socket<PhysicalMarkerServerToClientEvents, PhysicalMarkerClientToServerEvents> = io(
    `/physical-marker-${id}`,
    { autoConnect: false, forceNew: true }
  );

  let snapshot: PhysicalMarkerSnapshot | null = $state(null);
  let pin = $state(typeof sessionStorage === "undefined" ? "" : sessionStorage.getItem(sessionKey) || "");
  let authenticated = $state(false);
  let connected = $state(false);
  let checkingPin = $state(false);
  let group = $state("all");
  let focusedTeamId = $state<string | null>(null);
  let busyTeams = $state(new Set<string>());

  const groups = $derived.by(() =>
    [...new Set((snapshot?.teams || []).map((team) => team.group).filter(Boolean))].sort()
  );
  const visibleTeams = $derived.by(() =>
    (snapshot?.teams || []).filter((team) => group === "all" || team.group === group)
  );
  const focusedTeam = $derived.by(() => snapshot?.teams.find((team) => team.id === focusedTeamId) || null);

  socket.on("connect", () => {
    authenticated = true;
    connected = true;
    checkingPin = false;
    sessionStorage.setItem(sessionKey, pin);
  });
  socket.on("connect_error", (error) => {
    connected = false;
    authenticated = false;
    checkingPin = false;
    if (error.message === "Unauthorized") {
      sessionStorage.removeItem(sessionKey);
      toast.error("Incorrect marker PIN");
    } else {
      toast.error("Could not connect to the marker desk");
    }
  });
  socket.on("disconnect", () => (connected = false));
  socket.on("error", (message) => toast.error(message));
  socket.on("snapshot", (next) => (snapshot = next));

  function unlock() {
    if (!/^(?:[A-Z0-9]{8}|\d{4,12})$/.test(pin)) return;
    checkingPin = true;
    socket.auth = { code: id, pin };
    socket.connect();
  }

  function mark(teamId: string, action: "correct" | "wrong" | "skip") {
    const team = snapshot?.teams.find((candidate) => candidate.id === teamId);
    if (!team || !beginAction(teamId)) return;
    socket.emit(
      "mark",
      { teamId, action, expectedQuestion: team.currentQuestion, expectedLastActionId: team.lastActionId },
      (result) => finishAction(teamId, result)
    );
  }

  function undo(teamId: string) {
    const team = snapshot?.teams.find((candidate) => candidate.id === teamId);
    if (!team?.lastActionId || !beginAction(teamId)) return;
    socket.emit("undo", { teamId, actionId: team.lastActionId }, (result) => finishAction(teamId, result));
  }

  function beginAction(teamId: string) {
    if (busyTeams.has(teamId)) return false;
    busyTeams = new Set([...busyTeams, teamId]);
    return true;
  }

  function finishAction(teamId: string, result: PhysicalOperationResult) {
    const next = new Set(busyTeams);
    next.delete(teamId);
    busyTeams = next;
    if (!result.ok) toast.error(result.error);
  }

  onMount(() => {
    if (pin) unlock();
  });
</script>

<svelte:head><title>{snapshot?.name || "Mathex Live"} - Marker</title></svelte:head>

<div class="mathex-shell min-h-screen p-4 sm:p-6">
  {#if !authenticated}
    <main class="mx-auto grid min-h-[80vh] max-w-md place-items-center">
      <form
        class="mathex-panel w-full rounded-3xl p-6 sm:p-8"
        onsubmit={(event) => {
          event.preventDefault();
          unlock();
        }}
      >
        <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"
          ><ShieldCheck class="h-6 w-6" /></span
        >
        <p class="mathex-kicker mt-6">Marker access</p>
        <Header size="h1" class="mt-1 text-3xl">Enter the desk PIN</Header>
        <p class="mt-3 text-sm leading-6 text-muted-foreground">
          The host can provide the marker PIN for this competition.
        </p>
        <div class="mt-6">
          <Label for="marker-pin">PIN</Label><Input
            id="marker-pin"
            class="mt-2 h-12 text-center font-mono text-xl tracking-[0.35em]"
            type="password"
            autocapitalize="characters"
            pattern={"(?:[A-Z0-9]{8}|[0-9]{4,12})"}
            maxlength={12}
            bind:value={pin}
            oninput={() =>
              (pin = pin
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, "")
                .slice(0, 12))}
            autofocus
          />
        </div>
        <Button type="submit" class="mt-4 h-11 w-full" disabled={checkingPin || !/^(?:[A-Z0-9]{8}|\d{4,12})$/.test(pin)}
          >{checkingPin ? "Checking..." : "Open marker desk"}</Button
        >
      </form>
    </main>
  {:else if snapshot}
    <main class="mx-auto max-w-7xl">
      <header class="flex flex-col justify-between gap-4 py-2 sm:flex-row sm:items-end">
        <div>
          <p class="mathex-kicker">Marker desk</p>
          <Header size="h1" class="mt-1 text-3xl tracking-[-0.04em]">{snapshot.name}</Header>
        </div>
        <div class="flex items-center gap-2">
          {#if focusedTeamId}<Button variant="outline" onclick={() => (focusedTeamId = null)}
              ><LayoutGrid /> All teams</Button
            >{/if}
          <span class="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-primary"
            >{connected ? snapshot.state : "reconnecting"}</span
          >
        </div>
      </header>

      {#if focusedTeam}
        <section class="mt-4 grid gap-4 lg:grid-cols-[1fr_0.55fr]">
          <div class="mathex-panel rounded-3xl p-6 sm:p-9">
            <button
              type="button"
              class="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              onclick={() => (focusedTeamId = null)}><ArrowLeft class="h-4 w-4" /> Back to all teams</button
            >
            <div class="mt-10 text-center">
              <p class="text-sm font-bold uppercase tracking-[0.18em] text-muted-foreground">
                {focusedTeam.group || "Ungrouped"}
              </p>
              <h2 class="mt-2 text-3xl font-black sm:text-5xl">{focusedTeam.name}</h2>
              {#if focusedTeam.currentQuestion > snapshot.questionCount}
                <p class="mt-10 text-2xl font-bold text-emerald-600 dark:text-emerald-400">All questions complete</p>
              {:else}
                <div class="mt-9">
                  <p class="mathex-kicker">Next question</p>
                  <p class="mt-1 text-7xl font-black tabular-nums text-primary sm:text-9xl">
                    {focusedTeam.currentQuestion}
                  </p>
                  <p class="text-sm text-muted-foreground">of {snapshot.questionCount}</p>
                </div>
              {/if}
            </div>
            <div class="mt-10 grid grid-cols-3 gap-2 sm:gap-4">
              <Button
                class="h-16 gap-1 bg-emerald-600 text-base hover:bg-emerald-700 sm:h-20 sm:text-lg"
                onclick={() => mark(focusedTeam.id, "correct")}
                disabled={!connected ||
                  busyTeams.has(focusedTeam.id) ||
                  snapshot.state !== "running" ||
                  focusedTeam.currentQuestion > snapshot.questionCount}><Check class="h-5 w-5" /> Correct</Button
              >
              <Button
                variant="destructive"
                class="h-16 gap-1 text-base sm:h-20 sm:text-lg"
                onclick={() => mark(focusedTeam.id, "wrong")}
                disabled={!connected ||
                  busyTeams.has(focusedTeam.id) ||
                  snapshot.state !== "running" ||
                  focusedTeam.currentQuestion > snapshot.questionCount}><X class="h-5 w-5" /> Wrong</Button
              >
              <Button
                class="h-16 gap-1 bg-amber-500 text-base text-slate-950 hover:bg-amber-400 sm:h-20 sm:text-lg"
                onclick={() => mark(focusedTeam.id, "skip")}
                disabled={!connected ||
                  busyTeams.has(focusedTeam.id) ||
                  snapshot.state !== "running" ||
                  focusedTeam.currentQuestion > snapshot.questionCount}><CircleMinus class="h-5 w-5" /> Skip</Button
              >
            </div>
          </div>
          <aside class="mathex-panel rounded-3xl p-5 sm:p-7">
            <p class="mathex-kicker">Team record</p>
            <div class="mt-5 grid grid-cols-3 gap-2 text-center">
              <div class="rounded-xl bg-emerald-500/10 p-3">
                <p class="text-2xl font-black text-emerald-600 dark:text-emerald-400">{focusedTeam.correct}</p>
                <p class="text-xs text-muted-foreground">Correct</p>
              </div>
              <div class="rounded-xl bg-red-500/10 p-3">
                <p class="text-2xl font-black text-red-600 dark:text-red-400">{focusedTeam.incorrect}</p>
                <p class="text-xs text-muted-foreground">Wrong</p>
              </div>
              <div class="rounded-xl bg-amber-500/10 p-3">
                <p class="text-2xl font-black text-amber-600 dark:text-amber-400">{focusedTeam.skipped}</p>
                <p class="text-xs text-muted-foreground">Skipped</p>
              </div>
            </div>
            <div class="mt-5 flex flex-wrap gap-1.5" aria-label="Question results">
              {#each focusedTeam.questions as question}
                <span
                  title="Question {question.questionNumber}{question.incorrect ? `, ${question.incorrect} wrong` : ''}"
                  class="flex h-8 min-w-8 items-center justify-center rounded-md border px-1 text-xs font-bold {question.outcome ===
                  'correct'
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : question.outcome === 'skipped'
                      ? 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                      : question.questionNumber === focusedTeam.currentQuestion
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground'}">{question.questionNumber}</span
                >
              {/each}
            </div>
            <Button
              variant="outline"
              class="mt-5 w-full gap-2"
              onclick={() => undo(focusedTeam.id)}
              disabled={!connected ||
                busyTeams.has(focusedTeam.id) ||
                !focusedTeam.canUndo ||
                (snapshot.state !== "running" && snapshot.state !== "paused")}><RotateCcw /> Undo last mark</Button
            >
          </aside>
        </section>
      {:else}
        <section class="mt-4">
          <div class="mathex-panel flex flex-col justify-between gap-4 rounded-2xl p-4 sm:flex-row sm:items-center">
            <div>
              <p class="font-bold">All teams</p>
              <p class="text-sm text-muted-foreground">Tap a team for a focused marking view, or mark directly here.</p>
            </div>
            {#if groups.length > 0}<label class="flex items-center gap-2 text-sm font-medium"
                >Group <select
                  bind:value={group}
                  class="h-10 rounded-md border border-input bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
                  ><option value="all">All groups</option>{#each groups as groupName}<option value={groupName}
                      >{groupName}</option
                    >{/each}</select
                ></label
              >{/if}
          </div>
          <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {#each visibleTeams as team}
              <article class="mathex-panel rounded-2xl p-4">
                <button
                  type="button"
                  class="flex w-full items-center justify-between gap-3 text-left"
                  onclick={() => (focusedTeamId = team.id)}
                >
                  <div class="min-w-0">
                    <p class="truncate text-lg font-bold">{team.name}</p>
                    <p class="text-xs text-muted-foreground">{team.group || "Ungrouped"}</p>
                  </div>
                  <div class="shrink-0 text-right">
                    <p class="text-xs font-bold uppercase tracking-wider text-muted-foreground">Next</p>
                    <p class="text-2xl font-black tabular-nums text-primary">
                      {team.currentQuestion > snapshot.questionCount ? "Done" : `Q${team.currentQuestion}`}
                    </p>
                  </div>
                </button>
                <div class="mt-3 flex flex-wrap gap-1" aria-label="{team.name} question results">
                  {#each team.questions as question}
                    <span
                      title="Question {question.questionNumber}{question.incorrect
                        ? `, ${question.incorrect} wrong`
                        : ''}"
                      class="flex h-6 min-w-6 items-center justify-center rounded border px-0.5 text-[10px] font-bold {question.outcome ===
                      'correct'
                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : question.outcome === 'skipped'
                          ? 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                          : question.questionNumber === team.currentQuestion
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground/70'}">{question.questionNumber}</span
                    >
                  {/each}
                </div>
                <div class="mt-4 grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5 border-t border-border/70 pt-3">
                  <Button
                    size="sm"
                    class="bg-emerald-600 px-2 hover:bg-emerald-700"
                    aria-label="Mark {team.name} correct"
                    onclick={() => mark(team.id, "correct")}
                    disabled={!connected ||
                      busyTeams.has(team.id) ||
                      snapshot.state !== "running" ||
                      team.currentQuestion > snapshot.questionCount}
                    ><Check /> <span class="hidden sm:inline">Correct</span></Button
                  >
                  <Button
                    size="sm"
                    variant="destructive"
                    class="px-2"
                    aria-label="Mark {team.name} wrong"
                    onclick={() => mark(team.id, "wrong")}
                    disabled={!connected ||
                      busyTeams.has(team.id) ||
                      snapshot.state !== "running" ||
                      team.currentQuestion > snapshot.questionCount}
                    ><X /> <span class="hidden sm:inline">Wrong</span></Button
                  >
                  <Button
                    size="sm"
                    class="bg-amber-500 px-2 text-slate-950 hover:bg-amber-400"
                    aria-label="Skip for {team.name}"
                    onclick={() => mark(team.id, "skip")}
                    disabled={!connected ||
                      busyTeams.has(team.id) ||
                      snapshot.state !== "running" ||
                      team.currentQuestion > snapshot.questionCount}
                    ><CircleMinus /> <span class="hidden sm:inline">Skip</span></Button
                  >
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Undo last mark for {team.name}"
                    onclick={() => undo(team.id)}
                    disabled={!connected ||
                      busyTeams.has(team.id) ||
                      !team.canUndo ||
                      (snapshot.state !== "running" && snapshot.state !== "paused")}><RotateCcw /></Button
                  >
                </div>
                <div class="mt-3 flex gap-3 text-xs font-semibold">
                  <span class="text-emerald-600 dark:text-emerald-400">{team.correct} correct</span><span
                    class="text-red-600 dark:text-red-400">{team.incorrect} wrong</span
                  ><span class="text-amber-600 dark:text-amber-400">{team.skipped} skipped</span>
                </div>
              </article>
            {/each}
          </div>
        </section>
      {/if}
    </main>
  {:else}
    <main class="grid min-h-[80vh] place-items-center">
      <div class="text-center">
        <Target class="mx-auto h-8 w-8 animate-pulse text-primary" />
        <p class="mt-3 text-muted-foreground">Loading marker desk...</p>
      </div>
    </main>
  {/if}
</div>
