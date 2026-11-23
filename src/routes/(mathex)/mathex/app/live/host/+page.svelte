<script lang="ts">
  import { page } from "$app/state";
  import { Input } from "#lib/components/ui/input/index.js";
  import type {
    PhysicalHostClientToServerEvents,
    PhysicalHostServerToClientEvents,
    PhysicalHostSnapshot,
    PhysicalOperationResult
  } from "#lib/mathex/physical.schemas.js";
  import { physicalRosterKey } from "#lib/mathex/physical.schemas.js";
  import { copyText, msToMinutesAndSeconds } from "#lib/utils.js";
  import { Copy, ExternalLink, Flag, Pause, Play } from "@lucide/svelte/icons";
  import type { Socket } from "socket.io-client";
  import { io } from "#lib/mathex/connection.js";
  import { toast } from "svelte-sonner";
  import TeamEditor, { type EditableTeam } from "../TeamEditor.svelte";
  import LiveStandings from "../LiveStandings.svelte";
  import LiveBar from "../LiveBar.svelte";
  import { roundLabels } from "../standings.js";
  import * as AlertDialog from "#lib/components/ui/alert-dialog/index.js";

  const id = page.url.searchParams.get("id") || "";
  const hostToken = page.url.searchParams.get("hostToken") || "";
  const socket: Socket<PhysicalHostServerToClientEvents, PhysicalHostClientToServerEvents> = io(
    `/physical-host-${id}`,
    { auth: { token: hostToken }, forceNew: true }
  );

  let snapshot: PhysicalHostSnapshot | null = $state(null);
  let teams: EditableTeam[] = $state([]);
  let connected = $state(false);
  let saving = $state(false);
  let savedRoster = $state<EditableTeam[]>([]);
  let draftConflict = $state(false);
  let loadError = $state(false);
  let finishConfirmOpen = $state(false);
  let removalConfirmOpen = $state(false);
  let removalTargets = $state<{ id: string; name: string }[]>([]);
  let pinConfirmOpen = $state(false);
  let changingPin = $state(false);
  let pendingRoundAction = $state(false);
  let timerMinutes = $state<number | undefined>();
  let timerBusy = $state(false);
  let markerPin = $state("");
  let snapshotReceivedAt = $state(Date.now());

  const scoreboardUrl = $derived(`/mathex/app/live/scoreboard/${encodeURIComponent(id)}`);
  const markerUrl = $derived(`/mathex/app/live/marker/${encodeURIComponent(id)}`);
  const unfinished = $derived.by(() => {
    if (!snapshot) return 0;
    const { teams, questionCount } = snapshot;
    return teams.filter((team) => team.currentQuestion <= questionCount).length;
  });
  const draftDirty = $derived(physicalRosterKey(teams) !== physicalRosterKey(savedRoster));
  const removedWithMarks = $derived.by(
    () => snapshot?.teams.filter((team) => !teams.some((draft) => draft.id === team.id) && team.lastActionId) ?? []
  );

  socket.on("disconnect", () => {
    connected = false;
  });
  socket.on("connect_error", () => {
    loadError = true;
    toast.error("Could not connect to the live dashboard");
  });
  socket.on("error", (message) => {
    loadError = true;
    toast.error(message);
  });
  socket.on("snapshot", (next) => {
    connected = true;
    loadError = false;
    const nextRoster = next.teams.map(({ id, name, group }) => ({ id, name, group }));
    if (!snapshot || physicalRosterKey(savedRoster) !== physicalRosterKey(nextRoster)) {
      if (!draftDirty) resetDraft(nextRoster);
      else if (!saving) draftConflict = true;
      savedRoster = nextRoster;
    }
    snapshot = next;
    snapshotReceivedAt = Date.now();
    now = snapshotReceivedAt;
  });

  function resetDraft(roster = savedRoster) {
    teams = roster.map((team) => ({ ...team }));
    draftConflict = false;
  }

  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => {
      if (connected) now = Date.now();
    }, 250);
    const fallback = setTimeout(() => {
      if (!snapshot) loadError = true;
    }, 8000);
    return () => {
      clearInterval(timer);
      clearTimeout(fallback);
      socket.disconnect();
    };
  });

  const liveElapsedMs = $derived.by(() => {
    if (!snapshot) return 0;
    return snapshot.elapsedMs + (snapshot.state === "running" ? now - snapshotReceivedAt : 0);
  });
  const remainingMs = $derived.by(() => {
    const current = snapshot;
    if (!current || current.countdownDurationMs === null) return null;
    return current.countdownDurationMs - liveElapsedMs;
  });
  const clock = $derived(msToMinutesAndSeconds(remainingMs ?? liveElapsedMs));
  const timerMs = $derived(Math.round((timerMinutes ?? 0) * 60_000));

  function setTimer(duration: number | null) {
    if (!connected || timerBusy || snapshot?.state === "finished") return;
    if (duration !== null && (!Number.isFinite(duration) || duration < 1000 || duration > 86_400_000)) return;
    timerBusy = true;
    socket.timeout(4000).emit("setTimer", duration, (error, result) => {
      timerBusy = false;
      showResult(error, result);
      if (result?.ok) toast.success(duration === null ? "Countdown turned off" : "Countdown set");
    });
  }

  function act(action: "start" | "pause" | "resume" | "finish") {
    if (action === "finish") {
      finishConfirmOpen = true;
      return;
    }
    sendRoundAction(action);
  }

  function sendRoundAction(action: "start" | "pause" | "resume" | "finish") {
    if (!connected || pendingRoundAction) return;
    pendingRoundAction = true;
    socket.timeout(4000).emit(action, (error, result) => {
      pendingRoundAction = false;
      if (action === "finish" && result?.ok) finishConfirmOpen = false;
      showResult(error, result);
    });
  }

  function saveTeams(confirmedRemovals?: string[]) {
    if (!connected || saving || draftConflict || snapshot?.state === "finished") return;
    const blank = teams.length - teams.filter((team) => team.name.trim()).length;
    if (blank > 0) {
      toast.error(
        teams.length === 1
          ? "The team row is blank. Fill it in to save."
          : blank === 1
            ? "One team row is blank. Fill it in or delete it."
            : `${blank} team rows are blank.`
      );
      return;
    }
    const cleaned = teams
      .filter((team) => team.name.trim())
      .map((team) => ({ ...team, name: team.name.trim(), group: team.group.trim() }));
    if (cleaned.length === 0 || !snapshot) return;
    const names = cleaned.map((team) => team.name.toLocaleLowerCase());
    if (new Set(names).size !== names.length) {
      toast.error("Team names must be unique");
      return;
    }
    if (removedWithMarks.some((team) => !confirmedRemovals?.includes(team.id))) {
      removalTargets = removedWithMarks.map(({ id, name }) => ({ id, name }));
      removalConfirmOpen = true;
      return;
    }
    const expectedRoster = physicalRosterKey(savedRoster);
    saving = true;
    socket
      .timeout(4000)
      .emit(
        "updateTeams",
        { teams: cleaned, expectedRoster, confirmedRemovals: confirmedRemovals ?? [] },
        (error, result) => {
          saving = false;
          if (error || !result?.ok) {
            if (physicalRosterKey(savedRoster) !== expectedRoster) draftConflict = true;
            showResult(error, result);
            removalConfirmOpen = false;
            return;
          }
          removalConfirmOpen = false;
          resetDraft();
          toast.success("Teams saved");
        }
      );
  }

  function showResult(error: Error | null, result?: PhysicalOperationResult) {
    if (error || !result) toast.error("Couldn’t confirm the change. Check the current state before trying again.");
    else if (!result.ok) toast.error(result.error);
  }

  function resetMarkerPin() {
    if (!connected || changingPin || !/^(?:[A-Z0-9]{8}|\d{4,12})$/.test(markerPin)) return;
    changingPin = true;
    socket.timeout(6000).emit("configure", { markerPin }, (error, result) => {
      changingPin = false;
      if (error || !result?.ok) {
        showResult(error, result);
        return;
      }
      pinConfirmOpen = false;
      markerPin = "";
      toast.success("Marker PIN updated");
    });
  }

  const screens = $derived([
    {
      label: "Projector scoreboard",
      short: "scoreboard",
      note: "Public. Anyone with the event code can watch.",
      url: scoreboardUrl
    },
    { label: "Marker desk", short: "marker", note: "Opens with the event code and the marker PIN.", url: markerUrl }
  ]);
  const active = $derived.by(() => snapshot?.state === "running" || snapshot?.state === "paused");

  async function copyLink(path: string, label: string) {
    try {
      await copyText(`${page.url.origin}${path}`);
      toast.success(`${label} link copied`);
    } catch {
      toast.error("Could not copy link");
    }
  }
</script>

<svelte:head><title>{snapshot?.name || "Mathex Live"} - Host</title></svelte:head>

<LiveBar role="Host console" code={snapshot ? id : ""} />

<main class="host">
  {#if !id || !hostToken}
    <section class="host-message">
      <h1 class="lv-title">Host link incomplete</h1>
      <p class="lv-soft">Open the private host link created with the competition.</p>
      <a class="lbtn lbtn-line" href="/mathex/app/live">Set up a new event</a>
    </section>
  {:else if snapshot}
    <header class="host-head">
      <h1 class="lv-title">{snapshot.name}</h1>
      <p class="lv-soft">
        {snapshot.teams.length}
        {snapshot.teams.length === 1 ? "team" : "teams"}, {snapshot.questionCount}
        {snapshot.questionCount === 1 ? "question" : "questions"}{#if active}, {unfinished} still working{/if}
      </p>
    </header>

    <section class="round-band" aria-label="Round control">
      <div class="round-main">
        <div class="round-clock" class:overtime={remainingMs !== null && remainingMs < 0}>
          <p role="status">
            <span
              class="lv-plate"
              class:is-signal={connected && snapshot.state === "running"}
              class:is-line={connected && snapshot.state !== "running"}
              class:is-stop={!connected}
              >{connected ? roundLabels[snapshot.state] : "Reconnecting, controls unavailable"}</span
            >
          </p>
          <p class="round-time">
            <strong>{clock}</strong>
            <span>{remainingMs === null ? "Elapsed time" : remainingMs < 0 ? "Overtime" : "Time remaining"}</span>
          </p>
        </div>
        <div class="round-actions">
          {#if snapshot.state === "lobby"}
            <button
              type="button"
              class="lbtn lbtn-solid round-primary"
              onclick={() => act("start")}
              disabled={!connected || pendingRoundAction}><Play /> Start round</button
            >
          {:else if snapshot.state === "running"}
            <button
              type="button"
              class="lbtn lbtn-line round-primary"
              onclick={() => act("pause")}
              disabled={!connected || pendingRoundAction}><Pause /> Pause</button
            >
          {:else if snapshot.state === "paused"}
            <button
              type="button"
              class="lbtn lbtn-solid round-primary"
              onclick={() => act("resume")}
              disabled={!connected || pendingRoundAction}><Play /> Resume</button
            >
          {:else}
            <p class="round-locked">The round is finished. Marks are locked.</p>
          {/if}
          {#if active}
            <button
              type="button"
              class="lbtn lbtn-stop"
              onclick={() => act("finish")}
              disabled={!connected || pendingRoundAction}
              ><Flag /> {unfinished === 0 ? "Review and finish" : "Finish round"}</button
            >
          {/if}
        </div>
      </div>
      {#if unfinished === 0 && active}
        <p class="round-notice">All teams are done. Review the standings before finishing.</p>
      {/if}
      {#if snapshot.state !== "finished"}
        <details class="round-countdown">
          <summary>Countdown settings</summary>
          <form
            onsubmit={(event) => {
              event.preventDefault();
              setTimer(timerMs);
            }}
          >
            <label for="host-countdown"
              >Minutes
              <Input
                id="host-countdown"
                type="number"
                class="w-28"
                min={0.5}
                max={1440}
                step="any"
                required
                bind:value={timerMinutes}
              />
            </label>
            <button
              type="submit"
              class="lbtn lbtn-line"
              disabled={!connected ||
                timerBusy ||
                !Number.isFinite(timerMs) ||
                timerMs < 30_000 ||
                timerMs > 86_400_000}
            >
              {remainingMs === null ? "Start countdown" : "Reset countdown"}
            </button>
            {#if remainingMs !== null}
              <button
                type="button"
                class="lbtn lbtn-quiet"
                disabled={!connected || timerBusy}
                onclick={() => setTimer(null)}>Turn off countdown</button
              >
            {/if}
          </form>
          <p>
            Set 0.5 to 1,440 minutes. The countdown pauses with the round. Reaching zero shows overtime, it does not end
            scoring.
          </p>
        </details>
      {/if}
      <AlertDialog.Root bind:open={finishConfirmOpen}>
        <AlertDialog.Content>
          <AlertDialog.Header>
            <AlertDialog.Title>Finish this competition?</AlertDialog.Title>
            <AlertDialog.Description>
              {unfinished === 0
                ? "All teams reached the end."
                : unfinished === 1
                  ? "One team is still working."
                  : `${unfinished} teams are still working.`}
              Scorers will no longer be able to record or undo marks. This cannot be undone.
            </AlertDialog.Description>
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
            <AlertDialog.Action onclick={() => sendRoundAction("finish")} disabled={!connected || pendingRoundAction}
              >Finish competition</AlertDialog.Action
            >
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </section>

    <div class="host-grid">
      <section class="host-standings" aria-labelledby="host-standings">
        <h2 id="host-standings" class="lv-h2">
          {snapshot.state === "finished" ? "Final standings" : snapshot.state === "lobby" ? "Teams" : "Live standings"}
        </h2>
        <LiveStandings {snapshot} showAttempts />
      </section>

      <nav class="host-screens" aria-labelledby="host-screens">
        <h2 id="host-screens" class="lv-h2">Other screens</h2>
        <ul>
          {#each screens as screen (screen.short)}
            <li>
              <div>
                <p class="host-screen-name">{screen.label}</p>
                <p class="lv-soft lv-small">{screen.note}</p>
              </div>
              <div class="host-screen-actions">
                <a
                  class="lbtn lbtn-line lbtn-sm"
                  href={screen.url}
                  target="_blank"
                  rel="noopener"
                  aria-label={`Open ${screen.label.toLowerCase()} in a new tab`}><ExternalLink /> Open</a
                >
                <button
                  type="button"
                  class="lbtn lbtn-quiet lbtn-sm"
                  aria-label={`Copy link to ${screen.label.toLowerCase()}`}
                  onclick={() => copyLink(screen.url, screen.short === "marker" ? "Marker" : "Scoreboard")}
                  ><Copy /> Copy link</button
                >
              </div>
            </li>
          {/each}
        </ul>
      </nav>

      <details class="host-setup">
        <summary
          ><span class="lv-h2">Setup</span>{#if draftDirty}<span class="lv-plate is-signal">Unsaved roster changes</span
            >{/if}</summary
        >
        <section aria-labelledby="teams-heading">
          <h3 id="teams-heading">Teams and groups</h3>
          <p class="lv-soft lv-small">Saved changes appear on the marker desk and projector.</p>
          {#if draftConflict}<p class="lv-alert lv-small mt-2" role="alert">
              Another host saved roster changes. Your draft is still here, but you’ll need to discard it and start from
              the latest roster before saving.
            </p>{/if}
          <div class="mt-3"><TeamEditor bind:teams disabled={saving || snapshot.state === "finished"} /></div>
          <div class="host-setup-actions">
            <button
              type="button"
              class="lbtn lbtn-solid"
              onclick={() => saveTeams()}
              disabled={!connected || saving || draftConflict || !draftDirty || snapshot.state === "finished"}
              >{saving ? "Saving…" : "Save teams"}</button
            >
            {#if draftDirty || draftConflict}<button
                type="button"
                class="lbtn lbtn-quiet"
                onclick={() => resetDraft()}
                disabled={saving}>Discard draft</button
              >{/if}
          </div>
        </section>
        <section aria-labelledby="pin-heading">
          <h3 id="pin-heading">Marker PIN</h3>
          <p id="new-pin-hint" class="lv-soft lv-small">
            Changing the PIN disconnects active scorers. Use 8 letters or digits, or 4 to 12 digits.
          </p>
          <div class="host-pin">
            <Input
              aria-label="New marker PIN"
              aria-describedby="new-pin-hint"
              class="lv-code"
              type="text"
              autocapitalize="characters"
              maxlength={12}
              bind:value={markerPin}
              oninput={() => (markerPin = markerPin.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            />
            <button
              type="button"
              class="lbtn lbtn-line"
              onclick={() => (pinConfirmOpen = true)}
              disabled={!connected || !/^(?:[A-Z0-9]{8}|\d{4,12})$/.test(markerPin)}>Change PIN</button
            >
          </div>
        </section>
      </details>
    </div>

    <AlertDialog.Root bind:open={removalConfirmOpen}>
      <AlertDialog.Content>
        <AlertDialog.Header>
          <AlertDialog.Title>Remove teams and their marks?</AlertDialog.Title>
          <AlertDialog.Description
            >Saving will permanently remove the marks recorded for {removalTargets
              .map((team) => team.name)
              .join(", ")}.</AlertDialog.Description
          >
        </AlertDialog.Header>
        <AlertDialog.Footer
          ><AlertDialog.Cancel>Keep editing</AlertDialog.Cancel><AlertDialog.Action
            onclick={() => saveTeams(removalTargets.map((team) => team.id))}
            disabled={!connected || saving || draftConflict || snapshot.state === "finished"}
            >Remove and save</AlertDialog.Action
          ></AlertDialog.Footer
        >
      </AlertDialog.Content>
    </AlertDialog.Root>

    <AlertDialog.Root bind:open={pinConfirmOpen}>
      <AlertDialog.Content>
        <AlertDialog.Header
          ><AlertDialog.Title>Change the marker PIN?</AlertDialog.Title><AlertDialog.Description
            >Active scorers will have to reopen the desk with the new PIN. Existing marks are kept.</AlertDialog.Description
          ></AlertDialog.Header
        >
        <AlertDialog.Footer
          ><AlertDialog.Cancel>Cancel</AlertDialog.Cancel><AlertDialog.Action
            onclick={resetMarkerPin}
            disabled={!connected || changingPin}>Change and disconnect scorers</AlertDialog.Action
          ></AlertDialog.Footer
        >
      </AlertDialog.Content>
    </AlertDialog.Root>
  {:else if loadError}
    <section class="host-message">
      <h1 class="lv-title">Could not open the host console</h1>
      <p class="lv-soft">The link may be wrong, or the live competition may have ended.</p>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="lbtn lbtn-solid" onclick={() => location.reload()}>Refresh</button>
        <a class="lbtn lbtn-line" href="/mathex/app/live">Set up a new event</a>
      </div>
    </section>
  {:else}
    <p class="host-message lv-soft" role="status">Loading host controls…</p>
  {/if}
</main>

<style>
  .host {
    width: min(90rem, 100%);
    margin-inline: auto;
    padding: clamp(1rem, 2.5vw, 1.75rem) clamp(0.75rem, 3vw, 2rem) 4rem;
  }
  .host-message {
    display: grid;
    justify-items: start;
    gap: 0.75rem;
    padding-block: clamp(2rem, 8vh, 5rem);
  }
  .host-message .lv-title {
    font-size: clamp(1.75rem, 4vw, 2.75rem);
  }
  .host-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.25rem 1.5rem;
  }
  .host-head h1 {
    font-size: clamp(1.75rem, 3.4vw, 2.75rem);
  }

  .round-band {
    margin-top: 0.9rem;
    padding: clamp(0.75rem, 1.6vw, 1.1rem) clamp(0.9rem, 2vw, 1.5rem);
    border: 1px solid var(--lv-line);
    border-radius: 4px;
    background: var(--lv-surface);
    box-shadow: 0 1px 2px rgb(25 28 22 / 5%);
  }
  .round-main,
  .round-clock,
  .round-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
  }
  .round-main {
    justify-content: space-between;
    gap: 0.75rem 2rem;
  }
  .round-clock {
    gap: 0.5rem 1.25rem;
  }
  .round-time {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    color: var(--lv-ink-soft);
    font-size: 0.875rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .round-time strong {
    color: var(--lv-ink);
    font-size: clamp(2.25rem, 4.5vw, 3rem);
    font-weight: 700;
    letter-spacing: -0.025em;
    line-height: 0.95;
  }
  .overtime .round-time,
  .overtime .round-time strong {
    color: var(--lv-stop);
  }
  .round-actions {
    gap: 0.6rem;
  }
  .round-primary {
    min-width: 9.5rem;
    min-height: 2.75rem;
    font-size: 1rem;
  }
  .round-actions .lbtn-stop {
    min-height: 2.75rem;
  }
  .round-locked,
  .round-notice {
    font-weight: 600;
  }
  .round-notice {
    margin-top: 0.6rem;
    color: var(--lv-warn);
  }
  .round-countdown {
    margin-top: 0.75rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--lv-line);
  }
  .round-countdown summary,
  .host-setup summary {
    width: fit-content;
    cursor: pointer;
  }
  .round-countdown summary {
    color: var(--lv-ink-soft);
    font-size: 0.875rem;
    font-weight: 600;
  }
  .round-countdown summary:hover,
  .round-countdown[open] summary {
    color: var(--lv-ink);
  }
  .round-countdown form {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.6rem;
    margin-top: 0.6rem;
  }
  .round-countdown label {
    display: grid;
    gap: 0.25rem;
    font-size: 0.875rem;
    font-weight: 600;
  }
  .round-countdown > p {
    max-width: 44rem;
    margin-top: 0.6rem;
    color: var(--lv-ink-soft);
    font-size: 0.875rem;
  }

  .host-grid {
    display: grid;
    gap: 2rem;
    margin-top: 1.5rem;
  }
  .host-standings {
    min-width: 0;
  }
  .host-standings :global(.lv-standings caption) {
    padding-top: 0.9rem;
  }
  .host-standings h2,
  .host-screens,
  .host-setup {
    padding-top: 0.9rem;
    border-top: 2px solid var(--lv-ink);
  }
  .host-screens li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    padding-block: 0.8rem;
    border-bottom: 1px solid var(--lv-line);
  }
  .host-screen-name {
    font-weight: 700;
  }
  .host-screen-actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .host-setup summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
  }
  .host-setup summary::before {
    content: "+";
    width: 1ch;
    font-size: 1.25rem;
    font-weight: 700;
    line-height: 1;
  }
  .host-setup[open] summary::before {
    content: "\2212";
  }
  .host-setup summary {
    list-style: none;
  }
  .host-setup summary::-webkit-details-marker {
    display: none;
  }
  .host-setup section {
    margin-top: 1.25rem;
  }
  .host-setup h3 {
    font-size: 1.0625rem;
    font-weight: 700;
  }
  .host-setup-actions,
  .host-pin {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.9rem;
  }
  .host-pin :global([data-slot="input"]) {
    width: 12rem;
  }
  @media (min-width: 48rem) and (min-height: 40rem) {
    .round-band {
      position: sticky;
      top: 0.5rem;
      z-index: 20;
    }
  }
  @media (min-width: 68rem) {
    .host-grid {
      grid-template-columns: minmax(0, 1fr) 26rem;
      grid-template-rows: auto 1fr;
      column-gap: 3rem;
      row-gap: 2rem;
      align-items: start;
    }
    .host-standings {
      grid-row: 1 / 3;
    }
  }
</style>
