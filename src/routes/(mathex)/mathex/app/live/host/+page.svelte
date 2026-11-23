<script lang="ts">
  import { page } from "$app/state";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Header } from "#lib/components/ui/header/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import type {
    PhysicalHostClientToServerEvents,
    PhysicalHostServerToClientEvents,
    PhysicalHostSnapshot,
    PhysicalOperationResult
  } from "#lib/mathex/physical.schemas.js";
  import { physicalRosterKey } from "#lib/mathex/physical.schemas.js";
  import { copyText, msToMinutesAndSeconds } from "#lib/utils.js";
  import { CirclePause, CirclePlay, Copy, ExternalLink, Flag, Save } from "@lucide/svelte/icons";
  import type { Socket } from "socket.io-client";
  import { io } from "#lib/mathex/connection.js";
  import { toast } from "svelte-sonner";
  import TeamEditor, { type EditableTeam } from "../TeamEditor.svelte";
  import LiveStandings from "../LiveStandings.svelte";
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

<div class="mathex-shell min-h-screen px-3 py-5 sm:px-6 sm:py-7">
  <main class="mx-auto flex w-full max-w-5xl flex-col gap-4">
    <header>
      <p class="mathex-kicker">Host console · Event {id}</p>
      <Header size="h1" class="mt-1 text-3xl tracking-tight">{snapshot?.name || "Mathex Live"}</Header>
    </header>

    {#if !id || !hostToken}
      <section class="mathex-panel p-8 text-center">
        <h2 class="text-xl font-bold">Host link incomplete</h2>
        <p class="mt-2 text-muted-foreground">Open the private host link created with the competition.</p>
      </section>
    {:else if snapshot}
      <section class="mathex-panel sticky top-0 z-20 p-3 sm:p-4" aria-label="Round control">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p class="text-sm font-bold {connected ? 'text-primary' : 'text-destructive'}" role="status">
              {connected ? roundLabels[snapshot.state] : "Reconnecting · controls unavailable"}
            </p>
            <p class="mt-1 text-xs text-muted-foreground">
              {remainingMs === null ? "Elapsed time" : remainingMs < 0 ? "Overtime" : "Time remaining"}
            </p>
            <p
              class="text-3xl leading-none font-black tabular-nums {remainingMs !== null && remainingMs < 0
                ? 'text-destructive'
                : 'text-foreground'}"
            >
              {clock}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            {#if snapshot.state === "lobby"}
              <Button class="gap-2" onclick={() => act("start")} disabled={!connected || pendingRoundAction}
                ><CirclePlay /> Start round</Button
              >
            {:else if snapshot.state === "running"}
              <Button
                variant="outline"
                class="gap-2"
                onclick={() => act("pause")}
                disabled={!connected || pendingRoundAction}><CirclePause /> Pause</Button
              >
            {:else if snapshot.state === "paused"}
              <Button class="gap-2" onclick={() => act("resume")} disabled={!connected || pendingRoundAction}
                ><CirclePlay /> Resume</Button
              >
            {/if}
            {#if snapshot.state === "running" || snapshot.state === "paused"}
              <Button
                variant="ghost"
                class="ms-2 gap-2 text-destructive"
                onclick={() => act("finish")}
                disabled={!connected || pendingRoundAction}
                ><Flag /> {unfinished === 0 ? "Review and finish" : "Finish round"}</Button
              >
            {/if}
          </div>
        </div>
        {#if snapshot.state !== "finished"}
          <details class="mt-2 border-t border-border pt-2">
            <summary class="w-fit cursor-pointer text-sm font-semibold">Countdown settings</summary>
            <form
              class="mt-2 flex flex-wrap items-end gap-2"
              onsubmit={(event) => {
                event.preventDefault();
                setTimer(timerMs);
              }}
            >
              <label class="grid gap-1 text-xs font-semibold" for="host-countdown"
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
              <Button
                type="submit"
                size="sm"
                disabled={!connected ||
                  timerBusy ||
                  !Number.isFinite(timerMs) ||
                  timerMs < 30_000 ||
                  timerMs > 86_400_000}
              >
                {remainingMs === null ? "Start countdown" : "Reset countdown"}
              </Button>
              {#if remainingMs !== null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!connected || timerBusy}
                  onclick={() => setTimer(null)}>Turn off countdown</Button
                >
              {/if}
            </form>
            <p class="mt-2 text-xs text-muted-foreground">
              Set 0.5 to 1,440 minutes. The countdown pauses with the round; reaching zero shows overtime, not the end
              of scoring.
            </p>
          </details>
        {/if}
        {#if unfinished === 0 && (snapshot.state === "running" || snapshot.state === "paused")}
          <p class="mt-2 text-sm font-medium text-primary">
            All teams are done. Review the standings before finishing.
          </p>
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

      <nav class="flex flex-wrap gap-x-4 gap-y-2" aria-label="Other screens">
        {#each [{ url: scoreboardUrl, open: "Open projector scoreboard", label: "Scoreboard" }, { url: markerUrl, open: "Open marker desk in new tab", label: "Marker" }] as link (link.label)}
          <div class="flex gap-1">
            <Button href={link.url} target="_blank" rel="noopener" variant="outline" size="sm"
              ><ExternalLink /> {link.open}</Button
            >
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Copy ${link.label.toLowerCase()} link`}
              title={`Copy ${link.label.toLowerCase()} link`}
              onclick={() => copyLink(link.url, link.label)}><Copy /></Button
            >
          </div>
        {/each}
      </nav>

      <section class="mathex-panel" aria-labelledby="host-standings">
        <div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
          <h2 id="host-standings" class="text-lg font-bold">
            {snapshot.state === "finished" ? "Final standings" : "Live standings"}
          </h2>
          <p class="text-sm text-muted-foreground">
            {snapshot.teams.length} teams · {snapshot.questionCount} questions
          </p>
        </div>
        <div class="max-h-[55dvh] overflow-auto"><LiveStandings {snapshot} showAttempts /></div>
      </section>

      <details class="mathex-panel p-4">
        <summary class="cursor-pointer font-bold">Setup{draftDirty ? " · Unsaved roster changes" : ""}</summary>
        <section class="mt-4 border-t border-border pt-4" aria-labelledby="teams-heading">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 id="teams-heading" class="text-lg font-bold">Teams and groups</h2>
              <p class="text-sm text-muted-foreground">Saved changes appear on the marker desk and projector.</p>
            </div>
            <div class="flex gap-2">
              {#if draftDirty || draftConflict}<Button variant="outline" onclick={() => resetDraft()} disabled={saving}
                  >Discard draft</Button
                >{/if}
              <Button
                onclick={() => saveTeams()}
                disabled={!connected || saving || draftConflict || !draftDirty || snapshot.state === "finished"}
                ><Save /> {saving ? "Saving…" : "Save teams"}</Button
              >
            </div>
          </div>
          {#if draftConflict}<p class="mb-3 font-semibold text-destructive" role="alert">
              Another host saved roster changes. Your draft is still here, but you’ll need to discard it and start from
              the latest roster before saving.
            </p>{/if}
          <TeamEditor bind:teams disabled={saving || snapshot.state === "finished"} />
        </section>
        <section class="mt-5 border-t border-border pt-4" aria-labelledby="pin-heading">
          <h2 id="pin-heading" class="text-lg font-bold">Marker PIN</h2>
          <p id="new-pin-hint" class="my-2 text-sm text-muted-foreground">
            Changing the PIN disconnects active scorers. Use 8 letters or digits, or 4 to 12 digits.
          </p>
          <div class="flex flex-wrap gap-2">
            <Input
              aria-label="New marker PIN"
              aria-describedby="new-pin-hint"
              class="max-w-xs"
              type="text"
              autocapitalize="characters"
              maxlength={12}
              bind:value={markerPin}
              oninput={() => (markerPin = markerPin.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            />
            <Button
              variant="outline"
              onclick={() => (pinConfirmOpen = true)}
              disabled={!connected || !/^(?:[A-Z0-9]{8}|\d{4,12})$/.test(markerPin)}>Change PIN</Button
            >
          </div>
        </section>
      </details>

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
      <section class="mathex-panel p-8 text-center">
        <p class="mathex-kicker">Connection problem</p>
        <Header size="h2" class="mt-2 text-2xl">Could not open the host console</Header>
        <p class="mt-2 text-sm text-muted-foreground">The link may be wrong, or the live competition may have ended.</p>
        <div class="mt-4 flex justify-center gap-2">
          <Button onclick={() => location.reload()}>Refresh</Button>
          <Button href="/mathex/app/live" variant="outline">Live dashboard</Button>
        </div>
      </section>
    {:else}
      <section class="mathex-panel p-8 text-center">
        <p class="text-muted-foreground">Loading host controls...</p>
      </section>
    {/if}
  </main>
</div>
