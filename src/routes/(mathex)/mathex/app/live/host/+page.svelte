<script lang="ts">
  import { page } from "$app/state";
  import { Button } from "$lib/components/ui/button";
  import { Header } from "$lib/components/ui/header";
  import { Input } from "$lib/components/ui/input";
  import type {
    PhysicalHostClientToServerEvents,
    PhysicalHostServerToClientEvents,
    PhysicalHostSnapshot,
    PhysicalOperationResult
  } from "$lib/mathex/physical.schemas";
  import { copyText, msToMinutesAndSeconds } from "$lib/utils";
  import { CirclePause, CirclePlay, Copy, ExternalLink, Flag, Radio, Save, ShieldCheck } from "@lucide/svelte/icons";
  import { io, type Socket } from "socket.io-client";
  import { toast } from "svelte-sonner";
  import { flip } from "svelte/animate";
  import TeamEditor, { type EditableTeam } from "../TeamEditor.svelte";
  import * as AlertDialog from "$lib/components/ui/alert-dialog";

  const motionDuration = $derived(
    typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200
  );

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
  let loadError = $state(false);
  let finishConfirmOpen = $state(false);
  let markerPin = $state("");
  let snapshotReceivedAt = $state(Date.now());

  const scoreboardUrl = $derived(`/mathex/app/live/scoreboard/${encodeURIComponent(id)}`);
  const markerUrl = $derived(`/mathex/app/live/marker/${encodeURIComponent(id)}`);
  const stateLabel = $derived.by(() =>
    snapshot?.state === "running"
      ? "ROUND LIVE"
      : snapshot?.state === "paused"
        ? "ROUND PAUSED"
        : snapshot?.state === "finished"
          ? "ROUND FINISHED"
          : "READY TO START"
  );

  socket.on("connect", () => {
    connected = true;
    saving = false;
    loadError = false;
  });
  socket.on("disconnect", () => {
    connected = false;
    saving = false;
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
    loadError = false;
    const previousRoster = snapshot?.teams.map(({ id, name, group }) => ({ id, name, group }));
    const nextRoster = next.teams.map(({ id, name, group }) => ({ id, name, group }));
    snapshot = next;
    snapshotReceivedAt = Date.now();
    if (!saving && JSON.stringify(previousRoster) !== JSON.stringify(nextRoster)) teams = nextRoster;
  });

  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 250);
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

  function act(action: "start" | "pause" | "resume" | "finish") {
    if (action === "finish") {
      finishConfirmOpen = true;
      return;
    }
    if (action === "start") socket.emit("start", showResult);
    else if (action === "pause") socket.emit("pause", showResult);
    else socket.emit("resume", showResult);
  }

  function saveTeams() {
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
    saving = true;
    socket.emit("updateTeams", cleaned, (result) => {
      saving = false;
      if (!result.ok) toast.error(result.error);
      if (snapshot) teams = snapshot.teams.map((team) => ({ id: team.id, name: team.name, group: team.group }));
    });
  }

  function showResult(result: PhysicalOperationResult) {
    if (!result.ok) toast.error(result.error);
  }

  function resetMarkerPin() {
    if (!/^(?:[A-Z0-9]{8}|\d{4,12})$/.test(markerPin)) return;
    socket.emit("configure", { markerPin }, (result) => {
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
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
  <main class="mx-auto flex w-full max-w-7xl flex-col gap-4">
    <header class="flex flex-col justify-between gap-4 py-2 sm:flex-row sm:items-end">
      <div>
        <p class="mathex-kicker">Host console <span class="font-mono tabular-nums">· {id}</span></p>
        <Header size="h1" class="mt-1 text-3xl tracking-[-0.04em]">{snapshot?.name || "Connecting..."}</Header>
      </div>
      <span
        class="flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold {connected
          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}"
      >
        <Radio class="h-3.5 w-3.5" />
        {connected ? stateLabel : "RECONNECTING"}
      </span>
    </header>

    {#if !id || !hostToken}
      <section class="mathex-panel p-8 text-center">
        <h2 class="text-xl font-bold">Host link incomplete</h2>
        <p class="mt-2 text-muted-foreground">Open the private host link created with the competition.</p>
      </section>
    {:else if snapshot}
      <section class="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div class="mathex-panel p-5 sm:p-7">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p class="mathex-kicker">Round control</p>
              <p class="mt-1 text-sm text-muted-foreground">
                {snapshot.questionCount} questions · {snapshot.teams.length} teams
              </p>
              <p
                class="mt-3 font-mono text-4xl font-black tabular-nums {remainingMs !== null && remainingMs < 0
                  ? 'text-destructive'
                  : 'text-foreground'}"
              >
                {clock}
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              {#if snapshot.state === "lobby"}
                <Button class="gap-2" onclick={() => act("start")} disabled={!connected}
                  ><CirclePlay /> Start round</Button
                >
              {:else if snapshot.state === "running"}
                <Button variant="outline" class="gap-2" onclick={() => act("pause")} disabled={!connected}
                  ><CirclePause /> Pause</Button
                >
                <Button variant="destructive" class="gap-2" onclick={() => act("finish")} disabled={!connected}
                  ><Flag /> Finish</Button
                >
              {:else if snapshot.state === "paused"}
                <Button class="gap-2" onclick={() => act("resume")} disabled={!connected}><CirclePlay /> Resume</Button>
                <Button variant="destructive" class="gap-2" onclick={() => act("finish")} disabled={!connected}
                  ><Flag /> Finish</Button
                >
              {/if}
            </div>
          </div>
          {#if snapshot.state === "finished"}
            <div class="mt-5 border border-border bg-accent p-4 text-sm font-semibold text-accent-foreground">
              This competition is finished. The public scoreboard remains available.
            </div>
          {/if}
          <AlertDialog.Root bind:open={finishConfirmOpen}>
            <AlertDialog.Content>
              <AlertDialog.Header>
                <AlertDialog.Title>Finish this competition?</AlertDialog.Title>
                <AlertDialog.Description>
                  Markers will no longer be able to record results. This cannot be undone.
                </AlertDialog.Description>
              </AlertDialog.Header>
              <AlertDialog.Footer>
                <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
                <AlertDialog.Action
                  onclick={() => {
                    finishConfirmOpen = false;
                    socket.emit("finish", showResult);
                  }}>Finish competition</AlertDialog.Action
                >
              </AlertDialog.Footer>
            </AlertDialog.Content>
          </AlertDialog.Root>
        </div>

        <div class="mathex-panel p-5 sm:p-7">
          <p class="mathex-kicker">Open on other screens</p>
          <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <div class="border border-border p-4">
              <Radio class="h-5 w-5 text-primary" />
              <p class="mt-3 font-bold">Scoreboard</p>
              <p class="mt-1 text-xs text-muted-foreground">Safe for the projector</p>
              <div class="mt-4 flex gap-2">
                <Button href={scoreboardUrl} target="_blank" variant="outline" size="sm"><ExternalLink /> Open</Button
                ><Button
                  variant="ghost"
                  size="icon"
                  aria-label="Copy scoreboard link"
                  onclick={() => copyLink(scoreboardUrl, "Scoreboard")}><Copy /></Button
                >
              </div>
            </div>
            <div class="border border-border p-4">
              <ShieldCheck class="h-5 w-5 text-primary" />
              <p class="mt-3 font-bold">Marker desk</p>
              <p class="mt-1 text-xs text-muted-foreground">Protected by marker PIN</p>
              <div class="mt-4 flex gap-2">
                <Button href={markerUrl} target="_blank" variant="outline" size="sm"><ExternalLink /> Open</Button
                ><Button
                  variant="ghost"
                  size="icon"
                  aria-label="Copy marker link"
                  onclick={() => copyLink(markerUrl, "Marker")}><Copy /></Button
                >
              </div>
              <div class="mt-3 flex gap-2">
                <Input
                  aria-label="New marker PIN"
                  type="text"
                  autocapitalize="characters"
                  autocomplete="one-time-code"
                  inputmode="text"
                  maxlength={12}
                  placeholder="8 letters/digits or 4-12 digits"
                  bind:value={markerPin}
                  oninput={() =>
                    (markerPin = markerPin
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, "")
                      .slice(0, 12))}
                /><Button
                  size="sm"
                  variant="outline"
                  onclick={resetMarkerPin}
                  disabled={!connected || !/^(?:[A-Z0-9]{8}|\d{4,12})$/.test(markerPin)}>Set</Button
                >
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="mathex-panel p-5 sm:p-7">
        <div class="mb-4 flex items-end justify-between gap-4">
          <div>
            <p class="mathex-kicker">Live standings</p>
            <h2 class="mt-1 text-2xl font-bold">Leaderboard</h2>
          </div>
          <span class="text-sm text-muted-foreground">Correct, then time</span>
        </div>
        <div class="grid gap-2 lg:grid-cols-2">
          {#each snapshot.teams as team (team.id)}
            <div
              animate:flip={{ duration: motionDuration }}
              class="grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 border-b border-border p-3"
            >
              <span class="text-center text-xl font-black text-muted-foreground">{team.rank}</span>
              <div class="min-w-0">
                <p class="truncate font-bold">{team.name}</p>
                <p class="text-xs text-muted-foreground">
                  {team.group || "Ungrouped"} · Q{Math.min(
                    team.currentQuestion,
                    snapshot.questionCount
                  )}/{snapshot.questionCount}
                </p>
              </div>
              <div class="text-right">
                <p class="text-xl font-black text-emerald-600 dark:text-emerald-400">{team.correct}</p>
                <p class="text-xs text-muted-foreground">correct · {team.incorrect} wrong</p>
              </div>
            </div>
          {/each}
        </div>
      </section>

      <section class="mathex-panel p-5 sm:p-7">
        <div class="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p class="mathex-kicker">Roster</p>
            <h2 class="mt-1 text-2xl font-bold">Teams and groups</h2>
            <p class="mt-1 text-sm text-muted-foreground">
              Changes appear on marker and scoreboard screens immediately.
            </p>
          </div>
          <Button class="gap-2" onclick={saveTeams} disabled={!connected || saving || snapshot.state === "finished"}
            ><Save /> {saving ? "Saving..." : "Save teams"}</Button
          >
        </div>
        <TeamEditor bind:teams disabled={saving || snapshot.state === "finished"} />
      </section>
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
