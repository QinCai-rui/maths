<script lang="ts">
  import { page } from "$app/state";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Label } from "#lib/components/ui/label/index.js";
  import type {
    PhysicalMarkerActionType,
    PhysicalMarkerClientToServerEvents,
    PhysicalMarkerServerToClientEvents,
    PhysicalMarkerSnapshot,
    PhysicalOperationResult,
    PhysicalTeamSnapshot
  } from "#lib/mathex/physical.schemas.js";
  import { Check, CircleMinus, RotateCcw, X } from "@lucide/svelte/icons";
  import type { Socket } from "socket.io-client";
  import { io } from "#lib/mathex/connection.js";
  import { onMount } from "svelte";
  import LiveStandings from "../../LiveStandings.svelte";
  import { roundLabels, teamProgress } from "../../standings.js";

  const id = page.params.id ?? "";
  const sessionKey = `mathex-live-marker-${id}`;
  const pinsKey = `${sessionKey}-pinned`;
  const validCode = /^\d{6}$/.test(id);
  const validPin = /^(?:[A-Z0-9]{8}|\d{4,12})$/;
  const socket: Socket<PhysicalMarkerServerToClientEvents, PhysicalMarkerClientToServerEvents> = io(
    `/physical-marker-${id}`,
    { autoConnect: false, forceNew: true }
  );

  let snapshot: PhysicalMarkerSnapshot | null = $state(null);
  let pin = $state("");
  let authenticated = $state(false);
  let synced = $state(false);
  let checkingPin = $state(false);
  let accessError = $state("");
  let pinned = $state<string[]>([]);
  let chosen = $state("");
  let allTeams = $state(false);
  let recordDialog = $state<HTMLDialogElement>();
  let recordTeamId = $state("");
  let busy = $state<Set<string>>(new Set());
  let feedback = $state<Record<string, { text: string; error: boolean }>>({});

  const roster = $derived.by(() => [...(snapshot?.teams ?? [])].sort((a, b) => a.name.localeCompare(b.name)));
  const displayed = $derived(allTeams ? roster : pinned.flatMap((id) => roster.find((team) => team.id === id) ?? []));
  const recordTeam = $derived(roster.find((team) => team.id === recordTeamId));

  socket.on("connect", () => {
    authenticated = true;
    checkingPin = false;
    accessError = "";
    sessionStorage.setItem(sessionKey, pin);
  });
  socket.on("connect_error", (error) => {
    synced = false;
    checkingPin = false;
    if (error.message === "Unauthorized") {
      authenticated = false;
      sessionStorage.removeItem(sessionKey);
      accessError = "Incorrect marker PIN. Check with the host and try again.";
    } else {
      accessError = "Couldn’t connect to the marker desk. Try again.";
    }
  });
  socket.on("disconnect", (reason) => {
    synced = false;
    if (reason === "io server disconnect") {
      authenticated = false;
      snapshot = null;
      pin = "";
      sessionStorage.removeItem(sessionKey);
      accessError = "Marker access ended. Ask the host for the current PIN.";
    }
  });
  socket.on("snapshot", (next) => {
    snapshot = next;
    synced = true;
    accessError = "";
    const remaining = pinned.filter((id) => next.teams.some((team) => team.id === id));
    if (remaining.length !== pinned.length) setPins(remaining);
  });

  function unlock() {
    if (checkingPin || !validPin.test(pin)) return;
    checkingPin = true;
    accessError = "";
    socket.auth = { code: id, pin };
    socket.connect();
  }

  function setPins(ids: string[]) {
    pinned = ids;
    localStorage.setItem(pinsKey, JSON.stringify(ids));
  }

  function pinTeam(teamId: string) {
    if (pinned.includes(teamId) || pinned.length === 2 || !roster.some((team) => team.id === teamId)) return;
    setPins([...pinned, teamId]);
    chosen = "";
  }

  function mark(team: PhysicalTeamSnapshot, action: PhysicalMarkerActionType | "undo") {
    if (!snapshot || !synced || busy.has(team.id)) return;
    if (
      action === "undo"
        ? !team.lastActionId || !["running", "paused"].includes(snapshot.state)
        : snapshot.state !== "running" || team.currentQuestion > snapshot.questionCount
    )
      return;
    busy = new Set([...busy, team.id]);
    const question = team.currentQuestion;
    const questionCount = snapshot.questionCount;
    const report = (error: Error | null, result?: PhysicalOperationResult) => {
      const remaining = new Set(busy);
      remaining.delete(team.id);
      busy = remaining;
      if (error || !result) {
        feedback[team.id] = {
          text: "Couldn’t confirm the mark. Check the team record before trying again.",
          error: true
        };
      } else if (!result.ok) {
        feedback[team.id] = { text: result.error, error: true };
      } else {
        const next = question < questionCount ? `Next is Q${question + 1}` : "All questions done";
        const text =
          action === "wrong"
            ? `Q${question} marked wrong. Still on Q${question}.`
            : action === "correct"
              ? `Q${question} correct. ${next}.`
              : action === "skip"
                ? `Q${question} skipped, no point. ${next}.`
                : "Last mark undone.";
        feedback[team.id] = { text, error: false };
      }
    };
    if (action === "undo") socket.timeout(4000).emit("undo", { teamId: team.id, actionId: team.lastActionId }, report);
    else
      socket
        .timeout(4000)
        .emit(
          "mark",
          { teamId: team.id, action, expectedQuestion: question, expectedLastActionId: team.lastActionId },
          report
        );
  }

  onMount(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(pinsKey) ?? "[]");
      if (Array.isArray(saved))
        pinned = [...new Set(saved.filter((id): id is string => typeof id === "string"))].slice(0, 2);
    } catch {
      /* An invalid saved selection shouldn't block marking. */
    }
    if (validCode) {
      pin = sessionStorage.getItem(sessionKey) ?? "";
      if (pin) unlock();
    }
    return () => {
      socket.disconnect();
    };
  });
</script>

<svelte:head><title>{snapshot?.name || "Mathex Live"} - Marker</title></svelte:head>

<div class="mathex-shell min-h-dvh px-3 py-4 sm:px-6">
  {#if !validCode}
    <main class="mx-auto grid min-h-[80vh] max-w-md place-items-center">
      <section class="mathex-panel w-full p-6 text-center">
        <h1 class="text-2xl font-bold">This event code is not valid</h1>
        <p class="mt-2 text-sm text-muted-foreground">Live codes are six digits.</p>
        <Button href="/mathex/app/live/marker" class="mt-5">Enter a different code</Button>
      </section>
    </main>
  {:else if !authenticated}
    <main class="mx-auto grid min-h-[80vh] max-w-md place-items-center">
      <form
        class="mathex-panel w-full p-6 sm:p-8"
        onsubmit={(event) => {
          event.preventDefault();
          unlock();
        }}
      >
        <p class="mathex-kicker">Marker’s desk</p>
        <h1 class="mt-1 text-3xl font-bold">Enter the desk PIN</h1>
        <p class="mt-2 text-sm text-muted-foreground">Ask the host for the PIN for event {id}.</p>
        <Label for="marker-pin" class="mt-5">PIN</Label>
        <Input
          id="marker-pin"
          class="mt-2 h-12 font-mono text-xl"
          type="text"
          autocapitalize="characters"
          autocomplete="one-time-code"
          maxlength={12}
          bind:value={pin}
          oninput={() => (pin = pin.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          aria-describedby="pin-hint"
        />
        <p id="pin-hint" class="mt-2 text-xs text-muted-foreground">8 letters or digits, or 4 to 12 digits.</p>
        {#if accessError}<p class="mt-3 text-sm font-semibold text-destructive" role="alert">{accessError}</p>{/if}
        <Button type="submit" class="mt-4 h-11 w-full" disabled={checkingPin || !validPin.test(pin)}
          >{checkingPin ? "Checking…" : "Open marker desk"}</Button
        >
      </form>
    </main>
  {:else if snapshot}
    <main class="mx-auto max-w-7xl">
      <header class="flex flex-wrap items-end justify-between gap-2 border-b border-border pb-3">
        <div>
          <p class="mathex-kicker">Marker’s desk</p>
          <h1 class="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{snapshot.name}</h1>
        </div>
        <p class="text-sm font-bold {synced ? 'text-primary' : 'text-destructive'}" role="status">
          {synced ? roundLabels[snapshot.state] : "Connection lost. Scoring is unavailable."}
        </p>
      </header>

      <div class="mt-4 grid items-start gap-4 md:grid-cols-[minmax(0,1.65fr)_minmax(16rem,1fr)]">
        <section class="min-w-0 space-y-3" aria-label="Mark teams">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-lg font-bold">{allTeams ? "All teams" : "My teams"}</h2>
            <Button size="sm" variant="outline" onclick={() => (allTeams = !allTeams)}
              >{allTeams ? "Back to my teams" : "Browse all teams"}</Button
            >
          </div>
          {#if !allTeams && pinned.length < 2}
            <div class="flex flex-wrap items-end gap-2">
              <label class="grid min-w-0 flex-1 gap-1 text-sm font-medium" for="pin-team"
                >{pinned.length ? "Choose a second team" : "Choose the teams you score"}
                <select id="pin-team" class="h-9 min-w-0 rounded border border-input bg-card px-2" bind:value={chosen}>
                  <option value="">Select team</option>
                  {#each roster.filter((team) => !pinned.includes(team.id)) as team (team.id)}
                    <option value={team.id}>{team.name}{team.group ? ` (${team.group})` : ""}</option>
                  {/each}
                </select>
              </label>
              <Button variant="outline" disabled={!chosen} onclick={() => pinTeam(chosen)}>Pin team</Button>
            </div>
          {/if}
          {#if !allTeams && pinned.length === 0}<p class="text-sm text-muted-foreground">
              Pin one or two teams to keep their marking controls here. Your choices are saved on this device.
            </p>{/if}
          <div class="grid items-start gap-3 min-[1160px]:grid-cols-2">
            {#each displayed as team (team.id)}
              {@const blocked =
                !synced ||
                busy.has(team.id) ||
                snapshot.state !== "running" ||
                team.currentQuestion > snapshot.questionCount}
              <article class="mathex-panel min-w-0 overflow-hidden">
                <div class="border-b border-border bg-muted/40 p-3 sm:p-4">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <h3 class="text-lg font-bold leading-tight [overflow-wrap:anywhere]">{team.name}</h3>
                      {#if team.group}<p class="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                          {team.group}
                        </p>{/if}
                    </div>
                    {#if pinned.includes(team.id)}
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Unpin {team.name}"
                        onclick={() => setPins(pinned.filter((id) => id !== team.id))}>Unpin</Button
                      >
                    {:else if allTeams && pinned.length < 2}
                      <Button variant="outline" size="sm" aria-label="Pin {team.name}" onclick={() => pinTeam(team.id)}
                        >Pin</Button
                      >
                    {/if}
                  </div>
                  <p class="mt-3 text-xs font-semibold text-muted-foreground">
                    {snapshot.state === "running" && team.currentQuestion <= snapshot.questionCount
                      ? "Marking now"
                      : "Progress"}
                  </p>
                  <p class="text-2xl font-black leading-tight text-primary tabular-nums">
                    {#key team.currentQuestion}<span class="question-change"
                        >{teamProgress(team, snapshot.questionCount, snapshot.state)}</span
                      >{/key}
                  </p>
                </div>
                <div class="space-y-2 p-3 sm:p-4">
                  <div class="grid grid-cols-2 gap-2">
                    <Button
                      class="h-12"
                      aria-label="Mark {team.name} correct"
                      disabled={blocked}
                      onclick={() => mark(team, "correct")}><Check /> Correct</Button
                    >
                    <Button
                      variant="outline"
                      class="h-12 text-destructive"
                      aria-label="Mark {team.name} wrong"
                      disabled={blocked}
                      onclick={() => mark(team, "wrong")}><X /> Wrong</Button
                    >
                    <Button
                      variant="outline"
                      class="col-span-2 h-10"
                      aria-label="Skip question for {team.name}"
                      disabled={blocked}
                      onclick={() => mark(team, "skip")}><CircleMinus /> Skip question</Button
                    >
                  </div>
                  <div class="flex min-h-12 flex-wrap items-center justify-between gap-1">
                    <p
                      role="status"
                      class="min-w-0 flex-1 text-sm {feedback[team.id]?.error
                        ? 'font-semibold text-destructive'
                        : 'text-muted-foreground'}"
                    >
                      {busy.has(team.id)
                        ? "Saving…"
                        : (feedback[team.id]?.text ??
                          (snapshot.state === "lobby" ? "Waiting for the host to start." : ""))}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Undo last mark for {team.name}"
                      disabled={!synced ||
                        busy.has(team.id) ||
                        !team.canUndo ||
                        !["running", "paused"].includes(snapshot.state)}
                      onclick={() => mark(team, "undo")}><RotateCcw /> Undo</Button
                    >
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Team record for {team.name}"
                    onclick={() => {
                      recordTeamId = team.id;
                      recordDialog?.showModal();
                    }}>Team record</Button
                  >
                </div>
              </article>
            {/each}
          </div>
        </section>
        <aside class="mathex-panel min-w-0 md:sticky md:top-4" aria-labelledby="marker-standings">
          <h2 id="marker-standings" class="border-b border-border px-4 py-3 font-bold">Live standings</h2>
          <div class="max-h-[calc(100dvh-10rem)] overflow-auto"><LiveStandings {snapshot} {pinned} /></div>
        </aside>
      </div>
      <dialog
        bind:this={recordDialog}
        class="mathex-panel m-auto max-h-[85dvh] w-[min(32rem,94vw)] overflow-auto p-5 text-foreground backdrop:bg-black/50"
        aria-labelledby="team-record-heading"
      >
        <div class="flex flex-wrap items-start justify-between gap-2">
          <h2 id="team-record-heading" class="min-w-0 text-lg font-bold [overflow-wrap:anywhere]">
            {recordTeam ? `${recordTeam.name} team record` : "Team record"}
          </h2>
          <form method="dialog"><Button type="submit" variant="outline" size="sm">Close</Button></form>
        </div>
        {#if recordTeam}
          <p class="mt-2 text-sm text-muted-foreground">
            {recordTeam.correct} correct · {recordTeam.incorrect} wrong {recordTeam.incorrect === 1
              ? "attempt"
              : "attempts"} · {recordTeam.skipped} skipped
          </p>
          <ul class="mt-3 grid gap-1 text-sm sm:grid-cols-2" aria-label="Question results">
            {#each recordTeam.questions as question (question.questionNumber)}
              <li class="border-b border-border py-1">
                <strong>Q{question.questionNumber}</strong>
                {question.outcome}{question.incorrect ? ` · ${question.incorrect} wrong` : ""}
              </li>
            {/each}
          </ul>
        {:else}<p class="mt-2 text-sm text-muted-foreground">This team is no longer on the roster.</p>{/if}
      </dialog>
    </main>
  {:else}
    <main class="mx-auto max-w-md py-12 text-center" role="status">{accessError || "Loading marker desk…"}</main>
  {/if}
</div>

<style>
  @media (prefers-reduced-motion: no-preference) {
    .question-change {
      display: inline-block;
      animation: question-change 210ms ease-out;
    }
    @keyframes question-change {
      from {
        opacity: 0.6;
        transform: translateY(0.12em);
      }
    }
  }
</style>
