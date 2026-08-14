<script lang="ts">
  import { page } from "$app/state";

  import { io, type Socket } from "socket.io-client";
  import {
    type RoomManageServerToClientEvents,
    type RoomManageClientToServerEvents,
    type RoomState,
    type RoomSocketData,
    type LogEntry,
    type LeaderboardEntry,
    type LogVerbosity
  } from "$lib/mathex/schemas";

  import { Input } from "$lib/components/ui/input";
  import { Button } from "$lib/components/ui/button";
  import { Header } from "$lib/components/ui/header";
  import { Label } from "$lib/components/ui/label";
  import { Progress } from "$lib/components/ui/progress";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import * as Select from "$lib/components/ui/select";
  import Identicon from "$lib/components/Identicon.svelte";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Copy from "@lucide/svelte/icons/copy";
  import Radio from "@lucide/svelte/icons/radio";
  import UsersRound from "@lucide/svelte/icons/users-round";

  const roomId = page.url.searchParams.get("id");
  const runToken = page.url.searchParams.get("runToken");

  import { toast } from "svelte-sonner";
  import { copyText, msToMinutesAndSeconds } from "$lib/utils";

  const socket: Socket<RoomManageServerToClientEvents, RoomManageClientToServerEvents> = io(`/manage-${roomId}`, {
    query: {
      runToken
    },
    forceNew: true
  });
  socket.on("alert", (type, message) => {
    if (type === "normal" || type === "action" || type === "default") {
      toast(message);
    } else {
      const notify = toast[type];
      if (typeof notify === "function") notify(message);
      else toast(message);
    }
  });
  socket.on("connect", () => {
    toast.success("Connected!");
  });
  socket.on("connect_error", () => toast.error("Failed to connect!"));
  socket.on("disconnect", () => toast.warning("Disconnected!"));
  let players: RoomSocketData[] = $state([]);
  socket.on("playerData", (data) => (players = data));
  let currentState: RoomState = $state("lobby");
  socket.on("state", (state) => (currentState = state));

  let totalQuestions = $derived(players.length > 0 ? players[0].totalQuestions : 0);

  let alertTypes = ["normal", "action", "success", "info", "warning", "error", "loading", "default"] as const;
  let alertType: (typeof alertTypes)[number] | undefined = $state(undefined);
  let alertText = $state("");

  let logs: LogEntry[] = $state([]);
  socket.on("logs", (data) => (logs = data));
  socket.on("log", (entry) => {
    logs = [...logs, entry];
  });

  let verbosity: LogVerbosity = $state("all");
  let showLogs = $state(true);

  let filteredLogs = $derived.by(() => {
    if (!showLogs) return [];
    if (verbosity === "all") return logs;
    if (verbosity === "submissions")
      return logs.filter((l) => l.type === "submitted" || l.type === "correct" || l.type === "wrong" || l.type === "skipped");
    if (verbosity === "finished")
      return logs.filter(
        (l) => l.type === "finished" || l.type === "correct" || l.type === "wrong" || l.type === "visibility"
      );
    return logs;
  });

  let leaderboard: LeaderboardEntry[] = $state([]);
  socket.on("leaderboard", (data) => (leaderboard = data));

  let exportFormat: "json" | "csv" = $state("json");

  let tick = $state(0);
  setInterval(() => tick++, 1000);

  function exportScores() {
    if (leaderboard.length === 0) {
      toast.error("No results to export yet!");
      return;
    }
    let content: string;
    let filename: string;
    let mimeType: string;

    if (exportFormat === "json") {
      content = JSON.stringify(leaderboard, null, 2);
      filename = `mathex-results-${roomId}.json`;
      mimeType = "application/json";
    } else {
      const header = "Rank,Name,Time (ms),Time,Questions Completed,Total Questions";
      const rows = leaderboard.map(
        (e) =>
          `${e.rank},"${e.name}",${e.totalMs ?? "DNF"},${e.totalMs ? msToMinutesAndSeconds(e.totalMs) : "DNF"},${e.questionsCompleted},${e.totalQuestions}`
      );
      content = [header, ...rows].join("\n");
      filename = `mathex-results-${roomId}.csv`;
      mimeType = "text/csv";
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${exportFormat.toUpperCase()} results!`);
  }

  async function copyRoomCode() {
    try {
      await copyText(roomId || "");
      toast.success("Room code copied");
    } catch {
      toast.error("Could not copy room code");
    }
  }
</script>

<div class="mathex-shell min-h-screen p-4 sm:p-6">
  <main class="mx-auto flex w-full max-w-7xl flex-col gap-4">
    <header class="flex flex-col justify-between gap-4 py-2 sm:flex-row sm:items-end">
      <div>
        <p class="mathex-kicker">Host control room</p>
        <Header size="h1" class="mt-1 text-3xl tracking-[-0.04em]">Competition dashboard</Header>
      </div>
      <span
        class="flex w-fit items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-600 dark:text-amber-400"
        ><Radio class="h-3.5 w-3.5" />
        {currentState === "lobby" ? "LOBBY OPEN" : currentState === "started" ? "ROUND LIVE" : "ROUND FINISHED"}</span
      >
    </header>
    <div class="mathex-panel rounded-2xl p-5 sm:p-6">
      <div class="flex flex-col items-center justify-center gap-3 text-center sm:flex-row sm:gap-5">
        <span class="text-sm text-muted-foreground"
          >Players join at <span class="font-mono font-medium text-foreground">{page.url.host}/mathex/app/play</span
          ></span
        >
        <button
          type="button"
          class="group flex items-center gap-3 rounded-xl bg-primary px-4 py-2.5 text-primary-foreground shadow-lg shadow-primary/20"
          onclick={copyRoomCode}
          ><span class="text-2xl font-bold tracking-[0.08em] sm:text-3xl">{roomId}</span><Copy
            class="h-4 w-4 opacity-75 transition-opacity group-hover:opacity-100"
          /></button
        >
      </div>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <div class="mathex-panel rounded-2xl p-5 sm:p-6">
        <div class="flex items-center justify-between">
          <Header size="h2" class="text-2xl">Players</Header><span
            class="flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary"
            ><UsersRound class="h-3.5 w-3.5" />{players.length} joined</span
          >
        </div>
        <div class="mt-4 flex max-h-96 flex-col gap-2 overflow-y-auto scrollbar-thin">
          {#each players as player, i (player.name)}
            {@const progress =
              totalQuestions > 0
                ? ((player.finishingTime ? player.currentQuestion - 1 : player.currentQuestion - 1) / totalQuestions) *
                  100
                : 0}
            {@const elapsed =
              tick >= 0 && player.startingTime ? (player.finishingTime || Date.now()) - player.startingTime : null}
            <div
              class="flex items-center gap-3 rounded-lg border-2 border-solid p-3 transition-colors {player.startingTime
                ? player.finishingTime
                  ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800'
                  : 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800'
                : 'bg-muted/50 border-border'}"
            >
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold {player.finishingTime
                  ? 'bg-emerald-500 text-white'
                  : player.startingTime
                    ? 'bg-red-500 text-white'
                    : 'bg-muted text-muted-foreground'}"
              >
                {i + 1}
              </div>
              <Identicon className="w-10 h-10 shrink-0" seed={player.name || "Choosing..."} />
              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate text-sm font-medium">{player.name || "Choosing..."}</span>
                  {#if player.visibilityFlags > 0}
                    <span
                      class="flex shrink-0 items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400"
                    >
                      <TriangleAlert class="h-3.5 w-3.5" />
                      {player.visibilityFlags}
                    </span>
                  {/if}
                  {#if elapsed !== null}
                    <span class="shrink-0 text-xs text-muted-foreground">{msToMinutesAndSeconds(elapsed)}</span>
                  {/if}
                </div>
                {#if currentState === "started"}
                  <div class="mt-1.5 flex items-center gap-2">
                    <Progress value={progress} class="h-2 flex-1" />
                    <span class="shrink-0 text-xs font-medium text-muted-foreground">
                      {player.finishingTime ? player.currentQuestion - 1 : player.currentQuestion - 1}/{totalQuestions}
                    </span>
                  </div>
                {/if}
              </div>
            </div>
          {:else}
            <p class="italic text-sm text-muted-foreground">No players yet</p>
          {/each}
        </div>
      </div>

      <div class="flex flex-col gap-4">
        <div class="mathex-panel rounded-2xl p-5 sm:p-6">
          <Header size="h2">Alerts</Header>
          <form
            class="mt-4 flex w-full flex-col gap-3 sm:flex-row"
            onsubmit={(e) => {
              e.preventDefault();
              if (alertType === undefined) {
                toast.error("Choose an alert type!");
                return;
              }
              if (!alertText) {
                toast.error("Write some alert text!");
                return;
              }
              socket.emit("alertAll", alertType, alertText);
              alertText = "";
            }}
          >
            <Select.Root type="single" bind:value={alertType}>
              <Select.Trigger class="w-full sm:w-[180px]">
                {alertType ? alertType.charAt(0).toUpperCase() + alertType.substring(1).toLowerCase() : "Alert Type"}
              </Select.Trigger>
              <Select.Content>
                {#each alertTypes as type}
                  <Select.Item value={type}
                    >{type.charAt(0).toUpperCase() + type.substring(1).toLowerCase()}</Select.Item
                  >
                {/each}
              </Select.Content>
            </Select.Root>
            <Input bind:value={alertText} class="flex-1" placeholder="Alert Text" />
            <Button type="submit">Send</Button>
          </form>
        </div>

        {#if currentState === "finished" && leaderboard.length > 0}
          <div class="mathex-panel rounded-2xl p-5 sm:p-6">
            <div class="flex items-center justify-between">
              <Header size="h2">Leaderboard</Header>
              <div class="flex items-center gap-2">
                <Select.Root type="single" bind:value={exportFormat}>
                  <Select.Trigger class="w-[80px]">
                    {exportFormat.toUpperCase()}
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="json">JSON</Select.Item>
                    <Select.Item value="csv">CSV</Select.Item>
                  </Select.Content>
                </Select.Root>
                <Button variant="outline" size="sm" onclick={exportScores}>Export</Button>
              </div>
            </div>
            <div class="mt-4 flex max-h-64 flex-col gap-1.5 overflow-y-auto scrollbar-thin">
              {#each leaderboard as entry}
                <div class="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 p-2.5">
                  <div
                    class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold {entry.rank ===
                    1
                      ? 'bg-yellow-400 text-yellow-900'
                      : entry.rank === 2
                        ? 'bg-gray-300 text-gray-700'
                        : entry.rank === 3
                          ? 'bg-amber-600 text-white'
                          : 'bg-muted text-muted-foreground'}"
                  >
                    {entry.rank}
                  </div>
                  <Identicon className="w-8 h-8 shrink-0" seed={entry.name} />
                  <div class="min-w-0 flex-1">
                    <span class="truncate text-sm font-medium">{entry.name}</span>
                  </div>
                  {#if entry.visibilityFlags > 0}
                    <span
                      class="flex shrink-0 items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400"
                    >
                      <TriangleAlert class="h-3.5 w-3.5" />
                      {entry.visibilityFlags}
                    </span>
                  {/if}
                  <span class="shrink-0 text-xs text-muted-foreground">
                    {entry.totalMs !== null ? msToMinutesAndSeconds(entry.totalMs) : "DNF"} &middot; {entry.questionsCompleted}/{entry.totalQuestions}
                  </span>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <div class="mathex-panel rounded-2xl p-5 sm:p-6">
          <div class="flex items-center justify-between">
            <Header size="h2">Logs ({filteredLogs.length})</Header>
            <div class="flex items-center gap-3">
              <div class="flex items-center gap-2">
                <Checkbox id="showLogs" bind:checked={showLogs} />
                <Label for="showLogs" class="text-sm cursor-pointer">Show</Label>
              </div>
              <Select.Root type="single" bind:value={verbosity} disabled={!showLogs}>
                <Select.Trigger class="w-[140px]">
                  {verbosity === "all" ? "All activity" : verbosity === "submissions" ? "Answers" : "Results & tabs"}
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="all">All activity</Select.Item>
                  <Select.Item value="submissions">Answers only</Select.Item>
                  <Select.Item value="finished">Results & tab activity</Select.Item>
                </Select.Content>
              </Select.Root>
            </div>
          </div>
          {#if showLogs}
            <div
              class="mt-3 max-h-48 overflow-y-auto scrollbar-thin rounded-lg border border-border/40 bg-muted/20 p-2 font-mono text-xs"
            >
              {#each filteredLogs as log}
                <div
                  class="flex gap-2 py-0.5 {log.type === 'correct'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : log.type === 'wrong'
                      ? 'text-red-600 dark:text-red-400'
                      : log.type === 'skipped'
                        ? 'text-amber-600 dark:text-amber-400'
                        : log.type === 'finished'
                          ? 'text-yellow-600 dark:text-yellow-400 font-bold'
                          : 'text-muted-foreground'}"
                >
                  <span class="shrink-0 text-muted-foreground/60">{new Date(log.timestamp).toLocaleTimeString()}</span>
                  <span class="shrink-0 font-semibold">{log.playerName}</span>
                  <span>
                    {#if log.type === "submitted"}
                      submitted Q{log.questionNumber}{verbosity === "all" ? `: ${log.detail}` : ""}
                    {:else if log.type === "correct"}
                      Q{log.questionNumber} correct
                    {:else if log.type === "wrong"}
                      Q{log.questionNumber} wrong{verbosity === "all" ? ` (${log.detail})` : ""}
                    {:else if log.type === "skipped"}
                      skipped Q{log.questionNumber}
                    {:else if log.type === "finished"}
                      finished all questions
                    {:else if log.type === "visibility"}
                      {log.detail}
                    {:else}
                      {log.type}
                    {/if}
                  </span>
                </div>
              {:else}
                <p class="italic text-muted-foreground">No logs yet</p>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>

    {#if currentState !== "finished"}
      <Button
        onclick={() => {
          if (currentState === "lobby") {
            socket.emit("start");
            currentState = "started";
          } else {
            socket.emit("finish");
            currentState = "finished";
          }
        }}
        class="w-full shadow-lg shadow-primary/20 sm:w-auto"
        size="lg">{currentState === "lobby" ? "Start" : "Finish"} Game</Button
      >
    {/if}
  </main>
</div>
