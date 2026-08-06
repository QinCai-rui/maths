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

  const roomId = page.url.searchParams.get("id");
  const runToken = page.url.searchParams.get("runToken");

  import { toast } from "svelte-sonner";
  import { msToMinutesAndSeconds } from "$lib/utils";

  const socket: Socket<RoomManageServerToClientEvents, RoomManageClientToServerEvents> = io(`/manage-${roomId}`, {
    query: {
      runToken
    },
    forceNew: true
  });
  socket.on("alert", (type, message) => {
    // @ts-ignore
    toast[type](message);
  });
  socket.on("connect", () => {
    toast.success("Connected!");
  });
  socket.on("connect_error", () => toast.error("Failed to connect!"));
  socket.on("disconnect", () => toast.warning("Disconnected!"));
  let players: RoomSocketData[] = $state([]);
  socket.on("playerData", (data) => (players = data));
  let currentState: RoomState = $state("lobby");

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
      return logs.filter((l) => l.type === "submitted" || l.type === "correct" || l.type === "wrong");
    if (verbosity === "finished")
      return logs.filter((l) => l.type === "finished" || l.type === "correct" || l.type === "wrong");
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
</script>

<div class="flex flex-col w-full gap-4 p-4">
  <div class="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
    <div class="flex flex-col items-center justify-center gap-2 text-center sm:flex-row sm:gap-4">
      <span class="text-base text-muted-foreground"
        >Join at <span class="font-mono font-medium text-foreground">{page.url.host}/mathex/app/play</span> with code:</span
      >
      <div class="text-4xl font-bold tracking-tight text-primary sm:text-5xl">{roomId}</div>
    </div>
  </div>

  <div class="grid gap-4 lg:grid-cols-2">
    <div class="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
      <Header size="h2">Players ({players.length})</Header>
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
                  <span class="flex shrink-0 items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
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
      <div class="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
        <Header size="h2">Alerts</Header>
        <div class="mt-4 flex w-full flex-col gap-3 sm:flex-row">
          <Select.Root type="single" bind:value={alertType}>
            <Select.Trigger class="w-full sm:w-[180px]">
              {alertType ? alertType.charAt(0).toUpperCase() + alertType.substring(1).toLowerCase() : "Alert Type"}
            </Select.Trigger>
            <Select.Content>
              {#each alertTypes as type}
                <Select.Item value={type}>{type.charAt(0).toUpperCase() + type.substring(1).toLowerCase()}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
          <Input bind:value={alertText} class="flex-1" placeholder="Alert Text" />
          <Button
            onclick={() => {
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
            }}>Send</Button
          >
        </div>
      </div>

      {#if currentState === "finished" && leaderboard.length > 0}
        <div class="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
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
                  <span class="flex shrink-0 items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
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

      <div class="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
        <div class="flex items-center justify-between">
          <Header size="h2">Logs ({filteredLogs.length})</Header>
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-2">
              <Checkbox id="showLogs" bind:checked={showLogs} />
              <Label for="showLogs" class="text-sm cursor-pointer">Show</Label>
            </div>
            <Select.Root type="single" bind:value={verbosity} disabled={!showLogs}>
              <Select.Trigger class="w-[140px]">
                {verbosity.charAt(0).toUpperCase() + verbosity.substring(1)}
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="all">All</Select.Item>
                <Select.Item value="submissions">Submissions</Select.Item>
                <Select.Item value="finished">Finished</Select.Item>
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
      class="w-full sm:w-auto">{currentState === "lobby" ? "Start" : "Finish"} Game</Button
    >
  {/if}
</div>
