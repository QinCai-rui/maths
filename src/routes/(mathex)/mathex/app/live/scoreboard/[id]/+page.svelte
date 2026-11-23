<script lang="ts">
  import { page } from "$app/state";
  import type {
    PhysicalScoreboardClientToServerEvents,
    PhysicalScoreboardServerToClientEvents,
    PhysicalScoreboardSnapshot
  } from "#lib/mathex/physical.schemas.js";
  import { ChevronLeft, ChevronRight, Maximize, Minimize, Moon, Sun } from "@lucide/svelte/icons";
  import { toggleMode } from "mode-watcher";
  import type { Socket } from "socket.io-client";
  import { io } from "#lib/mathex/connection.js";
  import { msToMinutesAndSeconds } from "#lib/utils.js";
  import { flip } from "svelte/animate";
  import { liveMotionDuration } from "../../motion.js";
  import { roundLabels, spacedCode, standingsGroups, teamProgress, wrongAttempts } from "../../standings.js";
  import QuestionTrack from "../../QuestionTrack.svelte";

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

  const lobby = $derived.by(() => snapshot?.state === "lobby");
  const grouped = $derived(groups.length > 1 || shown?.name !== "Ungrouped");
  const overtime = $derived(remainingMs !== null && remainingMs < 0);
  const labelWidth = $derived.by(() => {
    const digits = String(snapshot?.questionCount ?? 0).length;
    return snapshot?.state === "finished" ? 10 + digits : 5 + 2 * digits;
  });
</script>

<svelte:head><title>{snapshot?.name || "Mathex Live"} - Scoreboard</title></svelte:head>

<div bind:this={board} class="mathex-scoreboard">
  <main>
    <header class="board-header">
      <div class="board-heading">
        {#if snapshot}
          <p class="board-status">
            <span
              class="lv-plate"
              class:is-signal={snapshot.state === "running"}
              class:is-line={snapshot.state === "lobby" || snapshot.state === "paused"}
              >{roundLabels[snapshot.state]}</span
            >
            {#if !synced}
              <span class="lv-plate is-stop" role="status">Connection lost. Showing last update.</span>
            {/if}
          </p>
        {/if}
        <h1 class="board-title lv-title" title={snapshot?.name}>{snapshot?.name || "Live scoreboard"}</h1>
      </div>
      {#if snapshot && lobby}
        <div class="board-clock">
          <span>Event code</span><strong>{spacedCode(snapshot.code)}</strong>
        </div>
      {:else if snapshot}
        <div class="board-clock" class:overtime>
          <span>{clockLabel}</span><strong>{clock}</strong>
        </div>
      {/if}
    </header>

    {#if snapshot && shown}
      <div class="board-toolbar">
        <h2>
          {lobby ? "Teams" : "Standings"}{#if grouped}{" "}<span class="board-part">/ {shown.name}</span
            >{/if}{#if shown.count > 1}{" "}<span class="board-part">({shown.i + 1}/{shown.count})</span>{/if}
        </h2>
        <div class="board-controls">
          {#if pages.length > 1}
            <nav class="board-pager" aria-label="Standings pages">
              <button
                class="board-button"
                aria-label="Previous standings page"
                disabled={currentIndex === 0}
                onclick={() => goToPage(currentIndex - 1)}><ChevronLeft size={20} /></button
              >
              <span class="page-count">Page {currentIndex + 1} of {pages.length}</span>
              <button
                class="board-button"
                aria-label="Next standings page"
                disabled={currentIndex === pages.length - 1}
                onclick={() => goToPage(currentIndex + 1)}><ChevronRight size={20} /></button
              >
            </nav>
          {/if}
          {#if fullscreenAvailable}
            <button class="board-button" onclick={toggleFullscreen}>
              {#if full}<Minimize size={17} /> Exit full screen{:else}<Maximize size={17} /> Full screen{/if}
            </button>
          {/if}
          <button class="board-button" onclick={toggleMode}>
            <Sun size={17} class="sun" /><Moon size={17} class="moon" /><span class="sr-only">Toggle theme</span>
          </button>
        </div>
      </div>
      {#if fullscreenError}<p class="board-note lv-alert" role="status">
          Full screen isn’t available here. Try your browser’s full-screen control.
        </p>{/if}
      <div
        class="projector-table"
        class:lobby
        role="table"
        aria-label={lobby ? "Teams" : "Standings"}
        style:--qw="{labelWidth}ch"
      >
        <div class="board-rows" role="rowgroup">
          <div class="board-head" role="row">
            {#if !lobby}<span class="rank" role="columnheader">Rank</span>{/if}
            <span class="team" role="columnheader">Team</span>
            {#if !lobby}
              <span class="score" role="columnheader">Correct</span>
              <span class="progress" role="columnheader">Progress</span>
              <span class="board-tally-head" role="columnheader">Attempts and finish time</span>
              <span class="attempt wrong-attempts" role="columnheader">Wrong attempts</span>
              <span class="attempt" role="columnheader">Skipped</span>
              <span class="finish" role="columnheader">Finish time</span>
            {/if}
          </div>
        </div>
        <div class="board-rows board-body" role="rowgroup">
          {#each shown.teams as team (team.id)}
            <div
              class="board-row"
              role="row"
              animate:flip={{ duration: liveMotionDuration(300) }}
              class:leader={!lobby && team.rank === 1}
            >
              {#if !lobby}<span class="rank" role="cell">{team.rank}</span>{/if}
              <span class="team team-name" role="rowheader" title={team.name}>
                <span class="team-label">{team.name}</span>
              </span>
              {#if !lobby}
                {@const finish = team.finishTimeMs === null ? null : msToMinutesAndSeconds(team.finishTimeMs)}
                <span class="score" role="cell"
                  >{#key team.correct}<span class="score-value">{team.correct}</span>{/key}</span
                >
                <span class="progress" role="cell">
                  <QuestionTrack {team} round={snapshot.state} />
                  <span class="progress-label">{teamProgress(team, snapshot.questionCount, snapshot.state)}</span>
                </span>
                <span class="board-tally" role="cell"
                  >{wrongAttempts(team.incorrect)} · {team.skipped} skipped{finish ? ` · Finish ${finish}` : ""}</span
                >
                <div class="board-stats">
                  <span class="attempt" role="cell" data-label="Wrong attempts">{team.incorrect}</span>
                  <span class="attempt" role="cell" data-label="Skipped">{team.skipped}</span>
                  <span class="finish" class:unfinished={!finish} role="cell" data-label="Finish time"
                    >{finish ?? "—"}</span
                  >
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {:else if loadError}
      <div class="board-message" role="alert">
        <p class="lv-title">Couldn’t reach this event.</p>
        <p>Check the link or ask the host for a new one.</p>
        <a class="lbtn lbtn-line" href="/mathex/app/live/scoreboard">Enter a different code</a>
      </div>
    {:else}
      <p class="board-message lv-soft" role="status">Waiting for competition data…</p>
    {/if}
  </main>
</div>

<style>
  .mathex-scoreboard {
    min-height: 100dvh;
    overflow: auto;
    padding: clamp(0.75rem, 2.4vh, 2rem) clamp(0.75rem, 3vw, 3.5rem);
    background: var(--lv-field);
    color: var(--lv-ink);
  }
  .board-header {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    justify-content: space-between;
    gap: 0.5rem 2rem;
    padding-bottom: clamp(0.6rem, 1.8vh, 1.25rem);
    border-bottom: 2px solid var(--lv-ink);
  }
  .board-heading {
    min-width: 0;
  }
  .board-status {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: clamp(0.3rem, 1vh, 0.7rem);
    font-size: clamp(0.875rem, 1.35vw, 1.375rem);
  }
  .board-status :global(.lv-plate) {
    font-size: 1em;
  }
  .board-title {
    font-size: clamp(1.85rem, min(4vw, 6.5vh), 4.25rem);
  }
  .board-clock {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    color: var(--lv-ink-soft);
    font-size: clamp(0.875rem, 1.3vw, 1.25rem);
    font-weight: 600;
    white-space: nowrap;
  }
  .board-clock strong {
    color: var(--lv-ink);
    font-size: clamp(2.25rem, min(5.4vw, 8.5vh), 5.5rem);
    font-weight: 700;
    letter-spacing: -0.025em;
    line-height: 0.95;
  }
  .board-clock.overtime,
  .board-clock.overtime strong {
    color: var(--lv-stop);
  }
  @media (min-width: 48rem) {
    .board-header {
      flex-wrap: nowrap;
    }
    .board-clock {
      flex: none;
      flex-direction: column;
      align-items: end;
      gap: 0.35rem;
    }
  }
  .board-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.25rem 1rem;
    padding-block: clamp(0.3rem, 1vh, 0.6rem);
  }
  .board-toolbar h2 {
    font-size: clamp(1rem, 1.5vw, 1.5rem);
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .board-part {
    color: var(--lv-ink-soft);
    font-weight: 500;
  }
  .board-controls,
  .board-pager {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.5rem;
  }
  .page-count {
    color: var(--lv-ink-soft);
    font-size: 0.875rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .board-button {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 2.25rem;
    min-width: 2.25rem;
    justify-content: center;
    padding: 0.2rem 0.5rem;
    border-radius: 3px;
    color: var(--lv-ink-soft);
    font-size: 0.875rem;
    font-weight: 600;
  }
  .board-button:hover:not(:disabled) {
    background: var(--lv-line-soft);
    color: var(--lv-ink);
  }
  .board-button:disabled {
    opacity: 0.4;
  }
  .board-button :global(.moon),
  :global(.dark) .board-button :global(.sun) {
    display: none;
  }
  :global(.dark) .board-button :global(.moon) {
    display: block;
  }
  .board-note {
    margin-bottom: 0.5rem;
    font-size: 0.875rem;
  }
  .board-message {
    display: grid;
    justify-items: start;
    gap: 0.75rem;
    padding-block: clamp(2rem, 8vh, 5rem);
    font-size: 1.125rem;
  }
  .board-message .lv-title {
    font-size: clamp(1.75rem, 4vw, 3rem);
  }

  /* The board is an ARIA table laid out on one shared grid, so every lane
     lines up and no column can wrap its label. */
  .projector-table {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr) max-content;
    column-gap: 0.75rem;
    font-size: 1.1875rem;
  }
  .board-rows,
  .board-head,
  .board-row {
    display: grid;
    grid-template-columns: subgrid;
    grid-column: 1 / -1;
  }
  .board-head,
  .board-row {
    padding-inline: clamp(0.4rem, 1vw, 1.1rem);
  }
  .board-head {
    align-items: end;
    padding-block: 0.3rem;
    border-bottom: 1px solid var(--lv-line);
    color: var(--lv-ink-soft);
    font-size: max(0.8125rem, 0.44em);
    font-weight: 600;
    white-space: nowrap;
  }
  .board-row {
    align-items: center;
    row-gap: 0.3rem;
    padding-block: 0.6rem;
    border-bottom: 1px solid var(--lv-line);
    line-height: 1.08;
  }
  .rank {
    min-width: 1.6em;
    text-align: center;
  }
  .board-row .rank {
    color: var(--lv-ink-soft);
    font-weight: 700;
  }
  .team-name {
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .score {
    text-align: right;
  }
  .board-row .score {
    min-width: 2ch;
    font-size: 1.25em;
    font-weight: 700;
  }
  .board-row .progress {
    display: flex;
    align-items: center;
    gap: 0.6em;
    --track-h: 0.5rem;
  }
  .board-row .progress :global(.question-track) {
    flex: 1;
  }
  .progress-label {
    min-width: var(--qw);
    color: var(--lv-ink-soft);
    font-size: 0.8125rem;
    font-weight: 600;
    text-align: right;
    white-space: nowrap;
  }
  .board-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.1rem 1.1rem;
    color: var(--lv-ink-soft);
    font-size: 0.8125rem;
  }
  .board-stats [role="cell"] {
    color: var(--lv-ink);
    font-weight: 700;
    white-space: nowrap;
  }
  .board-stats [role="cell"]::before {
    content: attr(data-label) " ";
    color: var(--lv-ink-soft);
    font-weight: 500;
  }
  .projector-table.lobby {
    grid-template-columns: minmax(0, 1fr);
  }
  .projector-table.lobby .team-name {
    font-size: 1.15em;
  }

  .leader {
    background: var(--accent);
    box-shadow: inset 4px 0 var(--primary);
    --track-rest: color-mix(in srgb, var(--primary) 22%, transparent);
  }
  .leader :is(.rank, .team-name, .score) {
    color: var(--lv-strong);
  }

  @media (width < 48rem) {
    .board-head :is(.attempt, .finish) {
      display: none;
    }
    .board-head :is(.progress, .board-tally-head) {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    .board-row .rank {
      grid-row: 1;
      grid-column: 1;
    }
    .board-row .team {
      grid-row: 1;
      grid-column: 2;
    }
    .board-row .score {
      grid-row: 1;
      grid-column: 3;
    }
    .board-row .progress {
      grid-row: 2;
      grid-column: 2 / 4;
    }
    .board-tally {
      grid-row: 3;
      grid-column: 2 / 4;
      color: var(--lv-ink-soft);
      font-size: 0.8125rem;
    }
    .board-stats {
      display: none;
    }
    .projector-table.lobby .board-row .team {
      grid-column: 1;
    }
  }

  @media (min-width: 48rem) {
    .projector-table {
      grid-template-columns:
        max-content minmax(0, 1fr) max-content minmax(8rem, 1fr)
        max-content max-content max-content;
      column-gap: clamp(0.7rem, 1.7vw, 2.25rem);
      font-size: clamp(1.125rem, min(2.5vw, 4.3vh), 2.9rem);
    }
    .board-row {
      padding-block: clamp(0.28rem, 1.25vh, 1rem);
    }
    .board-head :is(.attempt, .finish),
    .board-row :is(.attempt, .finish) {
      text-align: right;
    }
    .team-label {
      display: block;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .board-row .progress {
      --track-h: 0.4em;
    }
    .progress-label {
      font-size: 0.62em;
    }
    .board-tally,
    .board-tally-head {
      display: none;
    }
    .board-stats {
      display: contents;
      font-size: 1em;
    }
    .board-stats [role="cell"] {
      font-size: 0.8em;
      font-weight: 500;
    }
    .board-stats [role="cell"]::before {
      content: none;
    }
    .board-row .finish.unfinished {
      opacity: 0.55;
    }
    .projector-table.lobby .board-body {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      column-gap: clamp(1.5rem, 4vw, 4rem);
    }
    .projector-table.lobby .board-row {
      grid-column: auto;
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (min-width: 48rem) and (max-height: 42rem) {
    .board-title {
      font-size: clamp(1.65rem, 5.6vh, 3rem);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .projector-table {
      font-size: clamp(1.05rem, min(2.3vw, 3.7vh), 2rem);
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    .board-row {
      transition:
        background-color 250ms cubic-bezier(0.2, 0.7, 0.3, 1),
        color 250ms cubic-bezier(0.2, 0.7, 0.3, 1);
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
