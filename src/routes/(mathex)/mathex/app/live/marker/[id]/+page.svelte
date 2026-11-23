<script lang="ts">
  import { page } from "$app/state";
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
  import { Check, RotateCcw, SkipForward, X } from "@lucide/svelte/icons";
  import type { Socket } from "socket.io-client";
  import { io } from "#lib/mathex/connection.js";
  import { onMount } from "svelte";
  import LiveStandings from "../../LiveStandings.svelte";
  import LiveBar from "../../LiveBar.svelte";
  import QuestionTrack from "../../QuestionTrack.svelte";
  import { roundLabels, spacedCode, teamProgress, teamTally, wrongAttempts } from "../../standings.js";

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

  const idleHints: Partial<Record<PhysicalMarkerSnapshot["state"], string>> = {
    lobby: "Waiting for the host to start.",
    paused: "Round paused. Marking resumes with the round.",
    finished: "Round finished. Marks are locked."
  };
  const idleHint = $derived.by(() => (snapshot && idleHints[snapshot.state]) || "");

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

<LiveBar role="Marker desk" code={validCode ? id : ""}>
  {#if authenticated && snapshot}
    <p role="status">
      <span
        class="lv-plate"
        class:is-signal={synced && snapshot.state === "running"}
        class:is-line={synced && snapshot.state !== "running"}
        class:is-stop={!synced}
        >{synced ? roundLabels[snapshot.state] : "Connection lost. Scoring is unavailable."}</span
      >
    </p>
  {/if}
</LiveBar>

{#if !validCode}
  <main class="gate">
    <h1 class="lv-title">This event code is not valid</h1>
    <p class="lv-soft">Live codes are six digits.</p>
    <a href="/mathex/app/live/marker" class="lbtn lbtn-solid gate-go">Enter a different code</a>
  </main>
{:else if !authenticated}
  <main class="gate">
    <form
      onsubmit={(event) => {
        event.preventDefault();
        unlock();
      }}
    >
      <h1 class="lv-title">Enter the desk PIN</h1>
      <p class="lv-soft">Ask the host for the PIN for event {spacedCode(id)}.</p>
      <Label for="marker-pin" class="lv-label mt-6">PIN</Label>
      <Input
        id="marker-pin"
        class="gate-pin lv-code"
        type="text"
        autocapitalize="characters"
        autocomplete="one-time-code"
        maxlength={12}
        bind:value={pin}
        oninput={() => (pin = pin.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
        aria-describedby="pin-hint"
      />
      <p id="pin-hint" class="lv-hint">8 letters or digits, or 4 to 12 digits.</p>
      {#if accessError}<p class="lv-alert mt-3" role="alert">{accessError}</p>{/if}
      <button type="submit" class="lbtn lbtn-solid gate-go" disabled={checkingPin || !validPin.test(pin)}
        >{checkingPin ? "Checking…" : "Open marker desk"}</button
      >
    </form>
  </main>
{:else if snapshot}
  <main class="desk">
    <h1 class="desk-title lv-title">{snapshot.name}</h1>

    <div class="desk-grid">
      <section class="desk-stations" aria-label="Mark teams">
        <div class="desk-head">
          <h2 class="lv-h2">{allTeams ? "All teams" : "My teams"}</h2>
          <button type="button" class="lbtn lbtn-quiet lbtn-sm" onclick={() => (allTeams = !allTeams)}
            >{allTeams ? "Back to my teams" : "Browse all teams"}</button
          >
        </div>
        <div class="stations" class:all={allTeams}>
          {#each displayed as team (team.id)}
            {@const done = team.currentQuestion > snapshot.questionCount}
            {@const live = snapshot.state === "running" && !done}
            {@const blocked = !synced || busy.has(team.id) || !live}
            {@const stuck = done ? 0 : (team.questions[team.currentQuestion - 1]?.incorrect ?? 0)}
            <article class="station" class:is-live={live}>
              <header class="station-head">
                <div class="min-w-0">
                  <h3>{team.name}</h3>
                  {#if team.group}<p class="lv-soft lv-small">{team.group}</p>{/if}
                </div>
                {#if pinned.includes(team.id)}
                  <button
                    type="button"
                    class="lbtn lbtn-quiet lbtn-sm"
                    aria-label="Unpin {team.name}"
                    onclick={() => setPins(pinned.filter((id) => id !== team.id))}>Unpin</button
                  >
                {:else if allTeams && pinned.length < 2}
                  <button
                    type="button"
                    class="lbtn lbtn-line lbtn-sm"
                    aria-label="Pin {team.name}"
                    onclick={() => pinTeam(team.id)}>Pin</button
                  >
                {/if}
              </header>
              <div class="station-now">
                <p class="station-q">
                  {#key team.currentQuestion}
                    {#if done || snapshot.state === "lobby" || snapshot.state === "finished"}
                      <span class="question-change is-text"
                        >{teamProgress(team, snapshot.questionCount, snapshot.state)}</span
                      >
                    {:else}
                      <span class="question-change">Q{team.currentQuestion}</span>
                      <span class="station-of">of {snapshot.questionCount}</span>
                    {/if}
                  {/key}
                </p>
                <p class="station-stuck lv-small">
                  {#if stuck}{wrongAttempts(stuck)} on this question{/if}
                </p>
              </div>
              <QuestionTrack {team} round={snapshot.state} />
              <div class="station-keys">
                <button
                  type="button"
                  class="key key-correct"
                  aria-label="Mark {team.name} correct"
                  disabled={blocked}
                  onclick={() => mark(team, "correct")}><Check /> Correct</button
                >
                <button
                  type="button"
                  class="key key-wrong"
                  aria-label="Mark {team.name} wrong"
                  disabled={blocked}
                  onclick={() => mark(team, "wrong")}><X /> Wrong</button
                >
                <button
                  type="button"
                  class="lbtn lbtn-line"
                  aria-label="Skip question for {team.name}"
                  disabled={blocked}
                  onclick={() => mark(team, "skip")}><SkipForward /> Skip question</button
                >
                <button
                  type="button"
                  class="lbtn lbtn-line"
                  aria-label="Undo last mark for {team.name}"
                  disabled={!synced ||
                    busy.has(team.id) ||
                    !team.canUndo ||
                    !["running", "paused"].includes(snapshot.state)}
                  onclick={() => mark(team, "undo")}><RotateCcw /> Undo</button
                >
              </div>
              <p role="status" class="station-status" class:lv-alert={feedback[team.id]?.error}>
                {busy.has(team.id) ? "Saving…" : (feedback[team.id]?.text ?? idleHint)}
              </p>
              <footer class="station-foot">
                <p class="lv-soft lv-small">{teamTally(team)}</p>
                <button
                  type="button"
                  class="lbtn lbtn-quiet lbtn-sm"
                  aria-label="Team record for {team.name}"
                  onclick={() => {
                    recordTeamId = team.id;
                    recordDialog?.showModal();
                  }}>Team record</button
                >
              </footer>
            </article>
          {/each}
          {#if !allTeams && pinned.length < 2}
            <div class="station-slot">
              <label class="lv-label" for="pin-team"
                >{pinned.length ? "Choose a second team" : "Choose the teams you score"}</label
              >
              <div class="station-slot-pick">
                <select id="pin-team" class="lv-select" bind:value={chosen}>
                  <option value="">Select team</option>
                  {#each roster.filter((team) => !pinned.includes(team.id)) as team (team.id)}
                    <option value={team.id}>{team.name}{team.group ? ` (${team.group})` : ""}</option>
                  {/each}
                </select>
                <button type="button" class="lbtn lbtn-solid" disabled={!chosen} onclick={() => pinTeam(chosen)}
                  >Pin team</button
                >
              </div>
              {#if pinned.length === 0}<p class="lv-hint">
                  Pin one or two teams to keep their marking controls here. Your choices are saved on this device.
                </p>{/if}
            </div>
          {/if}
        </div>
      </section>
      <aside class="desk-standings" aria-labelledby="marker-standings">
        <h2 id="marker-standings" class="lv-h2">Live standings</h2>
        <LiveStandings {snapshot} {pinned} />
      </aside>
    </div>
    <dialog bind:this={recordDialog} class="record" aria-labelledby="team-record-heading">
      <div class="record-head">
        <h2 id="team-record-heading" class="lv-h2">
          {recordTeam ? `${recordTeam.name} team record` : "Team record"}
        </h2>
        <form method="dialog"><button type="submit" class="lbtn lbtn-line lbtn-sm">Close</button></form>
      </div>
      {#if recordTeam}
        <p class="lv-soft mt-1">{teamTally(recordTeam)}</p>
        <ul aria-label="Question results">
          {#each recordTeam.questions as question (question.questionNumber)}
            <li class:is-open={question.outcome !== "correct" && question.outcome !== "skipped"}>
              <strong>Q{question.questionNumber}</strong>
              <span>{question.outcome}{question.incorrect ? `, ${question.incorrect} wrong` : ""}</span>
            </li>
          {/each}
        </ul>
      {:else}<p class="lv-soft mt-2">This team is no longer on the roster.</p>{/if}
    </dialog>
  </main>
{:else}
  <main class="gate lv-soft" role="status">{accessError || "Loading marker desk…"}</main>
{/if}

<style>
  .gate {
    width: min(28rem, calc(100% - 1.5rem));
    margin: clamp(1.5rem, 12vh, 7rem) auto 3rem;
    padding: clamp(1.25rem, 4vw, 2rem);
    border: 1px solid var(--lv-line);
    border-radius: 4px;
    background: var(--lv-surface);
    box-shadow: 0 1px 2px rgb(25 28 22 / 5%);
  }
  .gate h1 {
    margin-bottom: 0.5rem;
    font-size: 1.875rem;
  }
  .gate :global(.gate-pin) {
    height: 3rem;
    font-size: 1.25rem;
  }
  .gate-go {
    width: 100%;
    min-height: 2.75rem;
    margin-top: 1.25rem;
    font-size: 1rem;
  }

  .desk {
    width: min(92rem, 100%);
    margin-inline: auto;
    padding: clamp(0.75rem, 2vw, 1.5rem) clamp(0.75rem, 3vw, 2rem) 3rem;
  }
  .desk-title {
    font-size: clamp(1.375rem, 2.6vw, 2rem);
  }
  .desk-grid {
    display: grid;
    gap: 2rem;
    margin-top: 0.9rem;
  }
  .desk-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.25rem 1rem;
    margin-bottom: 0.5rem;
  }
  .desk-stations {
    min-width: 0;
  }
  .stations {
    display: grid;
    gap: 1rem;
    align-items: start;
  }
  .desk-standings {
    min-width: 0;
    padding-top: 0.75rem;
    border-top: 2px solid var(--lv-ink);
  }

  .station {
    display: grid;
    gap: 0.75rem;
    min-width: 0;
    padding: 0.9rem clamp(0.8rem, 1.6vw, 1.25rem) 0.6rem;
    border: 1px solid var(--lv-line);
    border-radius: 4px;
    background: var(--lv-surface);
    box-shadow: 0 1px 2px rgb(25 28 22 / 5%);
    --track-h: 0.5rem;
  }
  .station-head {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .station-head h3 {
    font-size: clamp(1.25rem, 2vw, 1.5rem);
    font-weight: 700;
    letter-spacing: -0.015em;
    line-height: 1.08;
    overflow-wrap: anywhere;
  }
  .station-now {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0 1rem;
  }
  .station-q {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    color: var(--primary);
    font-size: clamp(2.5rem, 5vw, 3.5rem);
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 0.95;
    white-space: nowrap;
  }
  .station-q .is-text {
    font-size: 0.6em;
    line-height: 1.5;
  }
  .station-of {
    color: var(--lv-ink-soft);
    font-size: 0.36em;
    font-weight: 600;
  }
  .station-stuck {
    color: var(--lv-stop);
    font-weight: 600;
  }
  .station-keys {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }
  .key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-height: 4.25rem;
    border-radius: 3px;
    font-size: 1.25rem;
    font-weight: 700;
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
  }
  .key :global(svg) {
    width: 1.15em;
    height: 1.15em;
    stroke-width: 2.5;
  }
  .key-correct {
    background: var(--primary);
    color: var(--primary-foreground);
  }
  .key-wrong {
    background: var(--lv-stop);
    color: var(--lv-stop-ink);
  }
  .key:not(:disabled):active {
    transform: translateY(2px);
  }
  .key:disabled {
    background: var(--lv-line-soft);
    color: var(--lv-ink-soft);
    cursor: not-allowed;
  }
  @media (hover: hover) {
    .key:not(:disabled):hover {
      opacity: 0.9;
    }
  }
  .station-status {
    min-height: 2.9em;
    font-size: 0.9375rem;
    font-weight: 600;
  }
  .station-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0 0.75rem;
    padding-top: 0.25rem;
    border-top: 1px solid var(--lv-line);
  }
  .station-slot {
    padding: 1rem clamp(0.8rem, 1.6vw, 1.25rem);
    border: 1px dashed var(--competition-line-strong);
    border-radius: 4px;
  }
  .station-slot-pick {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .station-slot-pick select {
    flex: 1 1 12rem;
  }

  .record {
    width: min(34rem, 94vw);
    max-height: 85dvh;
    margin: auto;
    padding: 1.25rem;
    overflow: auto;
    border: 1px solid var(--lv-line);
    border-radius: 4px;
    background: var(--lv-surface);
    color: var(--lv-ink);
  }
  .record::backdrop {
    background: rgb(0 0 0 / 0.5);
  }
  .record-head {
    display: flex;
    flex-wrap: wrap;
    align-items: start;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .record-head h2 {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .record ul {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: 0 1.5rem;
    margin-top: 0.9rem;
  }
  .record li {
    display: flex;
    gap: 0.6rem;
    padding-block: 0.3rem;
    border-bottom: 1px solid var(--lv-line);
  }
  .record li strong {
    min-width: 2.6rem;
  }
  .record li.is-open span {
    color: var(--lv-ink-soft);
  }

  @media (min-width: 40rem) {
    .stations {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (min-width: 62rem) {
    .desk-grid {
      grid-template-columns: minmax(0, 1fr) minmax(18rem, 23rem);
      align-items: start;
    }
    .desk-standings {
      position: sticky;
      top: 1rem;
      max-height: calc(100dvh - 2rem);
      overflow: auto;
    }
  }
  @media (min-width: 62rem) and (max-width: 74.99rem) {
    .stations.all {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (min-width: 75rem) {
    .stations.all {
      grid-template-columns: repeat(auto-fill, minmax(21rem, 1fr));
    }
  }
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
