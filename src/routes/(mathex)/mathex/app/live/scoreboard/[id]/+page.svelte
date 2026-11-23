<script lang="ts">
  import { page } from "$app/state";
  import type {
    PhysicalScoreboardClientToServerEvents,
    PhysicalScoreboardServerToClientEvents,
    PhysicalScoreboardSnapshot
  } from "#lib/mathex/physical.schemas.js";
  import { ChevronLeft, ChevronRight, Maximize, Minimize } from "@lucide/svelte/icons";
  import type { Socket } from "socket.io-client";
  import { io } from "#lib/mathex/connection.js";
  import { msToMinutesAndSeconds } from "#lib/utils.js";
  import { flip } from "svelte/animate";
  import { liveMotionDuration } from "../../motion.js";
  import { roundLabels, standingsGroups, teamProgress } from "../../standings.js";

  const socket: Socket<PhysicalScoreboardServerToClientEvents, PhysicalScoreboardClientToServerEvents> = io(
    `/physical-scoreboard-${page.params.id}`,
    { forceNew: true }
  );
  let snapshot: PhysicalScoreboardSnapshot | null = $state(null);
  let receivedAt = $state(Date.now());
  let now = $state(Date.now());
  let synced = $state(false);
  let loadError = $state(false);
  let board: HTMLDivElement;
  let full = $state(false);
  let fullscreenAvailable = $state(false);
  let fullscreenError = $state(false);
  let selectedPage = $state<{ name: string; index: number } | null>(null);
  const rowsPerPage = 8;

  socket.on("disconnect", () => (synced = false));
  socket.on("connect_error", () => {
    synced = false;
    loadError = true;
  });
  socket.on("snapshot", (next) => {
    snapshot = next;
    receivedAt = Date.now();
    now = receivedAt;
    synced = true;
    loadError = false;
  });

  $effect(() => {
    fullscreenAvailable = document.fullscreenEnabled;
    const timer = setInterval(() => {
      if (synced) now = Date.now();
    }, 250);
    const fallback = setTimeout(() => {
      if (!snapshot) loadError = true;
    }, 8000);
    function syncFullscreen() {
      full = document.fullscreenElement === board;
    }
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => {
      clearInterval(timer);
      clearTimeout(fallback);
      document.removeEventListener("fullscreenchange", syncFullscreen);
      socket.disconnect();
    };
  });

  async function toggleFullscreen() {
    fullscreenError = false;
    try {
      if (document.fullscreenElement === board) await document.exitFullscreen();
      else await board.requestFullscreen();
    } catch {
      fullscreenError = true;
    }
  }

  const elapsedDelta = $derived.by(() => (snapshot?.state === "running" ? Math.max(0, now - receivedAt) : 0));
  const remainingMs = $derived.by(() =>
    snapshot?.countdownRemainingMs == null ? null : snapshot.countdownRemainingMs - elapsedDelta
  );
  const clock = $derived.by(() => msToMinutesAndSeconds(remainingMs ?? (snapshot?.elapsedMs ?? 0) + elapsedDelta));
  const clockLabel = $derived(remainingMs === null ? "Elapsed time" : remainingMs < 0 ? "Overtime" : "Time remaining");
  const groups = $derived.by(() => standingsGroups(snapshot?.teams ?? []));
  const pages = $derived(
    groups.flatMap(({ name, teams }) => {
      const count = Math.ceil(teams.length / rowsPerPage);
      return Array.from({ length: count }, (_, i) => ({
        name,
        count,
        i,
        teams: teams.slice(i * rowsPerPage, (i + 1) * rowsPerPage)
      }));
    })
  );
  const currentIndex = $derived.by(() => {
    if (!selectedPage) return 0;
    const { name, index } = selectedPage;
    return Math.max(
      0,
      pages.findIndex((page) => page.name === name && page.i === Math.min(index, page.count - 1))
    );
  });
  const shown = $derived(pages[currentIndex]);

  function goToPage(index: number) {
    const next = pages[index];
    if (next) selectedPage = { name: next.name, index: next.i };
  }

  function wrongAttemptLabel(count: number) {
    return `${count} wrong ${count === 1 ? "attempt" : "attempts"}`;
  }
</script>

<svelte:head><title>{snapshot?.name || "Mathex Live"} - Scoreboard</title></svelte:head>

<div bind:this={board} class="mathex-scoreboard min-h-dvh overflow-auto text-foreground">
  <main class="mx-auto">
    <header class="board-header">
      <div class="min-w-0">
        {#if snapshot}
          <p class="round-status" class:running={snapshot.state === "running"}>{roundLabels[snapshot.state]}</p>
        {/if}
        <h1 class="board-title" title={snapshot?.name}>{snapshot?.name || "Live scoreboard"}</h1>
        {#if snapshot && !synced}
          <p class="mt-2 font-bold text-destructive" role="status">Connection lost. Showing last update.</p>
        {/if}
      </div>
      {#if snapshot && snapshot.state !== "lobby"}
        <div class="board-clock" class:overtime={remainingMs !== null && remainingMs < 0}>
          <span>{clockLabel}</span><strong>{clock}</strong>
        </div>
      {/if}
    </header>

    {#if snapshot && shown}
      <div class="board-toolbar">
        <h2>
          {snapshot.state === "lobby"
            ? "Teams"
            : "Standings"}{#if groups.length > 1 || shown.name !== "Ungrouped"}{" "}<span
              class="font-normal text-muted-foreground"
            >
              / {shown.name}</span
            >{/if}
          {#if shown.count > 1}<span class="font-normal text-muted-foreground">
              ({shown.i + 1}/{shown.count})</span
            >{/if}
        </h2>
        <div class="board-controls">
          {#if pages.length > 1}
            <nav class="flex items-center gap-2" aria-label="Standings pages">
              <button
                class="board-button"
                aria-label="Previous standings page"
                disabled={currentIndex === 0}
                onclick={() => goToPage(currentIndex - 1)}><ChevronLeft size={20} /></button
              >
              <span class="page-count">{currentIndex + 1}/{pages.length}</span>
              <button
                class="board-button"
                aria-label="Next standings page"
                disabled={currentIndex === pages.length - 1}
                onclick={() => goToPage(currentIndex + 1)}><ChevronRight size={20} /></button
              >
            </nav>
          {/if}
          {#if fullscreenAvailable}
            <button class="board-button gap-2" onclick={toggleFullscreen}>
              {#if full}<Minimize size={17} /> Exit full screen{:else}<Maximize size={17} /> Full screen{/if}
            </button>
          {/if}
        </div>
      </div>
      {#if fullscreenError}<p class="mb-2 text-sm text-destructive" role="status">
          Full screen isn’t available here. Try your browser’s full-screen control.
        </p>{/if}
      <table class="projector-table" class:lobby={snapshot.state === "lobby"}>
        <thead>
          <tr>
            {#if snapshot.state !== "lobby"}<th class="rank" scope="col">Rank</th>{/if}
            <th scope="col">Team</th>
            {#if snapshot.state !== "lobby"}
              <th class="score" scope="col">Correct</th>
              <th class="progress" scope="col">Progress</th>
              <th class="attempt wrong-attempts" scope="col">Wrong attempts</th>
              <th class="attempt" scope="col">Skipped</th>
              <th class="finish" scope="col">Finish time</th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#each shown.teams as team (team.id)}
            <tr
              animate:flip={{ duration: liveMotionDuration(300) }}
              class:leader={snapshot.state !== "lobby" && team.rank === 1}
            >
              {#if snapshot.state !== "lobby"}<td class="rank">{team.rank}</td>{/if}
              <th scope="row" class="team-name" title={team.name}>
                <span class="team-label">{team.name}</span>
              </th>
              {#if snapshot.state !== "lobby"}
                {@const finish = team.finishTimeMs === null ? null : msToMinutesAndSeconds(team.finishTimeMs)}
                <td class="score"
                  >{#key team.correct}<span class="score-value">{team.correct}</span>{/key}</td
                >
                <td class="progress">
                  <span>{teamProgress(team, snapshot.questionCount, snapshot.state)}</span>
                  <div class="question-track" aria-hidden="true">
                    {#each team.questions as question (question.questionNumber)}
                      <span
                        class:solved={question.outcome === "correct"}
                        class:skipped={question.outcome === "skipped"}
                        class:current={snapshot.state !== "finished" &&
                          question.questionNumber === team.currentQuestion}
                        title={`Q${question.questionNumber}: ${question.outcome}${question.incorrect ? `, ${wrongAttemptLabel(question.incorrect)}` : ""}`}
                      ></span>
                    {/each}
                  </div>
                  <span class="compact-stats"
                    >{wrongAttemptLabel(team.incorrect)} · {team.skipped} skipped{finish
                      ? ` · Finish ${finish}`
                      : ""}</span
                  >
                </td>
                <td class="attempt">{team.incorrect}</td>
                <td class="attempt">{team.skipped}</td>
                <td class="finish">{finish ?? "—"}</td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    {:else if loadError}
      <p class="py-12 font-semibold" role="alert">
        Couldn’t reach this event. Check the link or ask the host for a new one.
      </p>
    {:else}
      <p class="py-12 text-muted-foreground" role="status">Waiting for competition data…</p>
    {/if}
  </main>
</div>

<style>
  .mathex-scoreboard {
    padding: clamp(0.75rem, 2.2vh, 1.75rem) clamp(0.75rem, 3vw, 3.5rem);
    font-family: "Hanken Grotesk", "Trebuchet MS", sans-serif;
  }
  .board-header {
    display: flex;
    align-items: end;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.65rem 1.5rem;
    padding: 0.25rem 0 clamp(0.75rem, 2vh, 1.5rem);
    border-bottom: 2px solid var(--foreground);
  }
  @media (min-width: 48rem) {
    .board-header {
      flex-wrap: nowrap;
    }
    .board-clock {
      flex-shrink: 0;
    }
  }
  .round-status {
    display: flex;
    align-items: center;
    gap: 0.45em;
    margin-bottom: 0.25rem;
    color: var(--muted-foreground);
    font-size: clamp(0.875rem, 1.35vw, 1.25rem);
    font-weight: 700;
  }
  .round-status.running {
    color: var(--primary);
  }
  .round-status.running::before {
    content: "";
    width: 0.5em;
    height: 0.5em;
    border-radius: 50%;
    background: currentColor;
  }
  .board-title {
    font-size: clamp(1.85rem, min(4vw, 6.5vh), 4.25rem);
    font-weight: 700;
    line-height: 1.04;
    letter-spacing: -0.035em;
    overflow-wrap: anywhere;
  }
  .board-clock {
    display: grid;
    text-align: left;
    color: var(--muted-foreground);
    font-size: clamp(0.8rem, 1.25vw, 1.125rem);
    font-weight: 600;
  }
  @media (min-width: 48rem) {
    .board-clock {
      border-inline-start: 1px solid var(--border);
      padding-inline-start: 1.25rem;
      text-align: right;
    }
  }
  .board-clock strong {
    color: var(--foreground);
    font-size: clamp(1.9rem, min(4.8vw, 7vh), 4.75rem);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.025em;
    line-height: 1;
  }
  .overtime,
  .overtime strong {
    color: var(--destructive);
  }
  .board-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding-block: 0.5rem;
  }
  .board-toolbar h2 {
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .board-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.75rem;
  }
  .page-count {
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
  }
  .board-button {
    display: inline-flex;
    align-items: center;
    min-height: 2rem;
    padding: 0.2rem 0.45rem;
    border-radius: 0.25rem;
    color: var(--muted-foreground);
    font-size: 0.875rem;
    font-weight: 600;
  }
  .board-button:hover:not(:disabled) {
    color: var(--foreground);
    background: var(--muted);
  }
  .board-button:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .board-button:disabled {
    opacity: 0.45;
  }
  .projector-table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    table-layout: fixed;
    font-variant-numeric: tabular-nums;
  }
  .projector-table :is(th, td) {
    padding: clamp(0.38rem, 1.1vh, 0.85rem) clamp(0.3rem, 1vw, 1.1rem);
    border-bottom: 1px solid var(--border);
  }
  .projector-table thead {
    color: var(--muted-foreground);
    font-size: clamp(0.75rem, 1.25vw, 1.2rem);
    white-space: nowrap;
  }
  .projector-table thead th {
    border-top: 1px solid var(--border);
    font-weight: 600;
  }
  .projector-table tbody {
    font-size: clamp(1rem, min(2.55vw, 4.2vh), 2.65rem);
    line-height: 1.12;
  }
  .projector-table .rank {
    width: clamp(2.75rem, 6vw, 6rem);
    padding-inline: 0.25rem;
    color: var(--muted-foreground);
    text-align: center;
    white-space: nowrap;
  }
  .projector-table .score {
    width: clamp(3.45rem, 8vw, 8rem);
    text-align: right;
    white-space: nowrap;
  }
  .projector-table tbody .score {
    font-size: 1.18em;
    font-weight: 700;
  }
  .projector-table .progress {
    width: clamp(6.5rem, 21vw, 20rem);
  }
  .projector-table tbody .progress {
    font-size: 0.7em;
    color: var(--muted-foreground);
  }
  .projector-table .attempt {
    width: clamp(4rem, 7vw, 7rem);
    text-align: right;
  }
  .projector-table thead .wrong-attempts {
    width: 8.5em;
  }
  .projector-table .finish {
    width: clamp(5rem, 10vw, 10rem);
    text-align: right;
    white-space: nowrap;
  }
  .projector-table tbody :is(.attempt, .finish) {
    color: var(--muted-foreground);
    font-size: 0.84em;
  }
  .question-track {
    display: flex;
    gap: min(2px, 0.25%);
    height: clamp(0.25rem, 0.7vh, 0.45rem);
    margin-top: 0.2rem;
  }
  .question-track span {
    flex: 1;
    min-width: 0;
    background: var(--border);
  }
  .question-track .solved {
    background: var(--primary);
  }
  .question-track .skipped {
    background: #ad7926;
  }
  .question-track .current {
    outline: 1px solid var(--primary);
    outline-offset: -1px;
  }
  .compact-stats {
    display: none;
  }
  @media (width < 48rem) {
    .projector-table .attempt,
    .projector-table .finish {
      display: none;
    }
    .compact-stats {
      display: block;
      margin-top: 0.25rem;
      font-size: 0.7rem;
    }
  }
  .team-name {
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  @media (min-width: 48rem) {
    .team-label {
      display: block;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
  }
  @media (min-width: 48rem) and (max-height: 42rem) {
    .board-title {
      font-size: clamp(1.65rem, 5.5vh, 3rem);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .projector-table tbody {
      font-size: clamp(1rem, min(2.2vw, 3.3vh), 2rem);
    }
  }
  .projector-table .leader {
    background: var(--accent);
    color: var(--accent-foreground);
  }
  .projector-table .leader .rank {
    box-shadow: inset 3px 0 var(--primary);
    color: var(--accent-foreground);
    font-weight: 700;
  }
  .projector-table .leader :is(th, td) {
    padding-block: clamp(0.55rem, 1.45vh, 1.1rem);
  }
  .projector-table .leader .score {
    font-size: 1.28em;
  }
  .projector-table.lobby .team-name {
    font-weight: 600;
  }
  @media (prefers-reduced-motion: no-preference) {
    .projector-table tbody tr {
      transition:
        background-color 250ms cubic-bezier(0.2, 0.7, 0.3, 1),
        color 250ms cubic-bezier(0.2, 0.7, 0.3, 1);
    }
    .question-track span {
      transition: background-color 200ms cubic-bezier(0.2, 0.7, 0.3, 1);
    }
    .score-value {
      display: inline-block;
      animation: score-change 260ms cubic-bezier(0.2, 0.7, 0.3, 1);
    }
    @keyframes score-change {
      from {
        transform: translateY(0.15em);
        opacity: 0.65;
      }
    }
  }
</style>
