<script lang="ts">
  import { page } from "$app/state";
  import { flip } from "svelte/animate";
  import { slide } from "svelte/transition";
  import RoomOptions from "$lib/mathex/RoomOptions.svelte";
  import { DEFAULT_ROOM_SETTINGS, type ChatMessage } from "$lib/mathex/schemas";
  import { exportableResults } from "$lib/mathex/room-state";

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
  import { Progress } from "$lib/components/ui/progress";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import * as Select from "$lib/components/ui/select";
  import Identicon from "$lib/components/Identicon.svelte";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Hourglass from "@lucide/svelte/icons/hourglass";
  import Copy from "@lucide/svelte/icons/copy";
  import Radio from "@lucide/svelte/icons/radio";
  import UsersRound from "@lucide/svelte/icons/users-round";
  import UserX from "@lucide/svelte/icons/user-x";

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
  let settings = $state({ ...DEFAULT_ROOM_SETTINGS });
  let endsAt = $state<number | null>(null);
  socket.on("roomSettings", (value) => (settings = value));
  socket.on("gameEndsAt", (value) => (endsAt = value));

  let totalQuestions = $state(0);
  socket.on("questionCount", (count) => (totalQuestions = count));

  let alertTypes = ["normal", "action", "success", "info", "warning", "error", "loading", "default"] as const;
  let alertType: (typeof alertTypes)[number] | undefined = $state(undefined);
  let alertText = $state("");

  let logs: LogEntry[] = $state([]);
  socket.on("logs", (data) => (logs = data));
  socket.on("log", (entry) => {
    logs = [...logs, entry];
  });

  let verbosity: LogVerbosity = $state("all");
  let view = $state<"list" | "tiles">("list");
  let showExtras = $state(true);
  let reducedMotion = $state(false);
  let preferencesLoaded = $state(false);
  let mobileTab = $state<"players" | "extras">("players");
  let kickArmed = $state<string | null>(null);
  let kickTimer: ReturnType<typeof setTimeout> | undefined;
  const preferencesKey = "mathex-host-settings-v1";
  $effect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(preferencesKey) ?? "null");
      if (saved?.view === "list" || saved?.view === "tiles") view = saved.view;
      if (typeof saved?.showExtras === "boolean") showExtras = saved.showExtras;
    } catch {
      /* Saved preferences are optional. */
    }
    preferencesLoaded = true;
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion = query.matches;
    const update = () => (reducedMotion = query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  });
  $effect(() => {
    if (!preferencesLoaded) return;
    try {
      localStorage.setItem(preferencesKey, JSON.stringify({ view, showExtras }));
    } catch {
      /* Keep preferences in memory. */
    }
  });
  $effect(() => {
    if (!showExtras) mobileTab = "players";
  });
  const motionDuration = $derived(reducedMotion ? 0 : 200);
  function askKick(id: string | null) {
    if (!id) return;
    clearTimeout(kickTimer);
    if (kickArmed === id) {
      kickArmed = null;
      socket.emit("kick", id);
    } else {
      kickArmed = id;
      kickTimer = setTimeout(() => (kickArmed = null), 4000);
    }
  }
  let chat = $state<ChatMessage[]>([]);
  socket.on("chatHistory", (messages) => (chat = messages));
  socket.on("chatMessage", (message) => (chat = [...chat, message].slice(-200)));
  socket.on("chatDeleted", (id) => (chat = chat.filter((message) => message.id !== id)));

  let filteredLogs = $derived.by(() => {
    if (verbosity === "all") return logs;
    if (verbosity === "submissions")
      return logs.filter(
        (l) => l.type === "submitted" || l.type === "correct" || l.type === "wrong" || l.type === "skipped"
      );
    if (verbosity === "finished")
      return logs.filter(
        (l) =>
          l.type === "finished" ||
          l.type === "correct" ||
          l.type === "wrong" ||
          l.type === "visibility" ||
          l.type === "kicked" ||
          l.type === "moderation"
      );
    return logs;
  });

  let leaderboard: LeaderboardEntry[] = $state([]);
  socket.on("leaderboard", (data) => (leaderboard = data));

  let exportFormat: "json" | "csv" = $state("json");

  let nowMs = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => {
      nowMs = Date.now();
    }, 1000);
    return () => {
      clearInterval(timer);
      clearTimeout(kickTimer);
      socket.disconnect();
    };
  });

  function exportScores() {
    if (leaderboard.length === 0) {
      toast.error("No results to export yet!");
      return;
    }
    let content: string;
    let filename: string;
    let mimeType: string;

    if (exportFormat === "json") {
      content = JSON.stringify(exportableResults(leaderboard), null, 2);
      filename = `mathex-results-${roomId}.json`;
      mimeType = "application/json";
    } else {
      const header = "Rank,Name,Correct Answers,Time (ms),Time,Questions Completed,Total Questions,Skips";
      const csvText = (value: string) => `"${value.replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`;
      const rows = leaderboard.map(
        (e) =>
          `${e.rank},${csvText(e.name)},${e.correctCount},${e.totalMs ?? "DNF"},${e.totalMs !== null ? msToMinutesAndSeconds(e.totalMs) : "DNF"},${e.questionsCompleted},${e.totalQuestions},${e.skips}`
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

<div class="mathex-shell min-h-screen px-3 py-5 sm:px-6 sm:py-7">
  <main class="mx-auto flex w-full max-w-7xl flex-col gap-4">
    <header class="flex flex-col justify-between gap-4 py-2 sm:flex-row sm:items-end">
      <div>
        <p class="mathex-kicker">Host control room</p>
        <Header size="h1" class="mt-1 text-3xl tracking-[-0.04em]">Competition dashboard</Header>
      </div>
      <div class="flex flex-wrap items-center gap-4">
        {#if currentState === "started" && endsAt !== null}
          <div class="flex items-center gap-3">
            <span class="flex h-9 w-9 items-center justify-center bg-primary/10 text-primary"
              ><Hourglass class="h-4 w-4" /></span
            >
            <div>
              <p class="text-xl font-bold tabular-nums sm:text-2xl" role="timer">
                {msToMinutesAndSeconds(Math.max(0, endsAt - nowMs))}
              </p>
              <p class="text-xs font-medium text-muted-foreground">Time left</p>
            </div>
          </div>
        {/if}
        <span
          class="flex w-fit items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-600 dark:text-amber-400"
          ><Radio class="h-3.5 w-3.5" />
          {currentState === "lobby" ? "LOBBY OPEN" : currentState === "started" ? "ROUND LIVE" : "ROUND FINISHED"}</span
        >
      </div>
    </header>
    <div class="mathex-panel p-5 sm:p-6">
      <div class="flex flex-col items-center justify-center gap-3 text-center sm:flex-row sm:gap-5">
        <span class="text-sm text-muted-foreground"
          >Players join at <span class="font-mono font-medium text-foreground">{page.url.host}/mathex/app/play</span
          ></span
        >
        <button
          type="button"
          class="group flex items-center gap-3 bg-primary px-4 py-2.5 text-primary-foreground"
          onclick={copyRoomCode}
          ><span class="text-2xl font-bold tracking-[0.08em] sm:text-3xl">{roomId}</span><Copy
            class="h-4 w-4 opacity-75 transition-opacity group-hover:opacity-100"
          /></button
        >
      </div>
    </div>

    <details class="mathex-panel p-4">
      <summary class="cursor-pointer text-sm font-semibold">Display settings</summary>
      <div class="mt-3 flex flex-wrap items-center gap-5">
        <div class="flex gap-2" role="group" aria-label="Player layout">
          <Button
            size="sm"
            variant={view === "list" ? "default" : "outline"}
            onclick={() => (view = "list")}
            aria-pressed={view === "list"}>List</Button
          ><Button
            size="sm"
            variant={view === "tiles" ? "default" : "outline"}
            onclick={() => (view = "tiles")}
            aria-pressed={view === "tiles"}>Tiles</Button
          >
        </div>
        <label class="flex items-center gap-2 text-sm"
          ><Checkbox bind:checked={showExtras} />Show controls and results</label
        >
      </div>
    </details>
    {#if showExtras}<div class="flex gap-2 lg:hidden" role="group" aria-label="Dashboard panels">
        <Button variant={mobileTab === "players" ? "default" : "outline"} onclick={() => (mobileTab = "players")}
          >Players</Button
        ><Button variant={mobileTab === "extras" ? "default" : "outline"} onclick={() => (mobileTab = "extras")}
          >Controls and results</Button
        >
      </div>{/if}
    <div
      class="grid items-start gap-4 {showExtras
        ? view === 'tiles'
          ? 'xl:grid-cols-[minmax(0,1fr)_360px]'
          : 'lg:grid-cols-2'
        : ''}"
    >
      <div class="flex flex-col gap-4 {mobileTab === 'extras' && showExtras ? 'hidden lg:block' : ''}">
        <div class="mathex-panel p-5 sm:p-6">
          <div class="flex items-center justify-between">
            <Header size="h2" class="text-2xl">Players</Header><span
              class="flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary"
              ><UsersRound class="h-3.5 w-3.5" />{players.length} joined</span
            >
          </div>
          <div
            class="mt-4 gap-2 {view === 'tiles'
              ? 'grid sm:grid-cols-2 2xl:grid-cols-3'
              : 'flex max-h-[36rem] flex-col overflow-y-auto scrollbar-thin'}"
          >
            {#each players as player, i (player.playerId)}
              {@const progress = totalQuestions > 0 ? (player.correctCount / totalQuestions) * 100 : 0}
              {@const elapsed =
                player.startingTime ? (player.finishingTime || nowMs) - player.startingTime : null}
              <div
                animate:flip={{ duration: motionDuration }}
                class="flex items-center gap-3 rounded-lg border-2 border-solid p-3 transition-colors {player.startingTime
                  ? player.questionsCompleted === totalQuestions
                    ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800'
                    : 'bg-primary/5 border-primary/20'
                  : 'bg-muted/50 border-border'}"
              >
                <div
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold {player.questionsCompleted ===
                  totalQuestions
                    ? 'bg-emerald-500 text-white'
                    : player.startingTime
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'}"
                >
                  {i + 1}
                </div>
                <Identicon className="w-10 h-10 shrink-0" seed={player.name || "Choosing..."} />
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <span class="truncate text-sm font-medium">{player.name || "Choosing..."}</span>
                    <span class="text-lg font-bold tabular-nums" aria-label="{player.name} score"
                      >{player.correctCount}<span class="ml-1 text-xs font-normal text-muted-foreground">correct</span
                      ></span
                    >
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
                  {#if currentState !== "lobby"}
                    <div class="mt-1.5 flex items-center gap-2">
                      <Progress value={progress} class="h-2 flex-1" />
                      <span class="shrink-0 text-xs font-medium text-muted-foreground">
                        {player.correctCount}/{totalQuestions}
                      </span>
                    </div>
                  {/if}
                  <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{player.questionsCompleted}/{totalQuestions} completed, {player.skips} skipped</span>
                    {#if settings.allowChat}<Button
                        size="sm"
                        variant="ghost"
                        onclick={() => socket.emit("muteChat", player.playerId!, !player.chatMuted)}
                        >{player.chatMuted ? "Unmute chat" : "Mute chat"}</Button
                      >{/if}
                    <Button
                      size="sm"
                      variant={kickArmed === player.playerId ? "destructive" : "ghost"}
                      onclick={() => askKick(player.playerId)}
                      aria-label="Remove {player.name}"
                      ><UserX class="h-3.5 w-3.5" />{kickArmed === player.playerId
                        ? "Confirm removal"
                        : "Remove"}</Button
                    >
                  </div>
                </div>
              </div>
            {:else}
              <p class="italic text-sm text-muted-foreground">No players yet</p>
            {/each}
          </div>
        </div>
        {#if settings.allowChat || chat.length > 0}
          <div class="mathex-panel p-5 sm:p-6">
            <Header size="h2">Player chat</Header>
            <p class="mt-1 text-xs text-muted-foreground">
              {settings.allowChat
                ? "Messages are visible to all players. Remove messages here or mute a player above."
                : "Chat is disabled. Saved messages remain available to moderate."}
            </p>
            <div class="mt-3 flex max-h-80 flex-col gap-3 overflow-y-auto scrollbar-thin">
              {#each chat as message (message.id)}<div class="border-b border-border pb-2">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-sm font-semibold">{message.name}</span><Button
                      size="sm"
                      variant="ghost"
                      onclick={() => socket.emit("deleteChat", message.id)}
                      aria-label="Delete message from {message.name}">Delete</Button
                    >
                  </div>
                  <p class="break-words text-sm">{message.text}</p>
                </div>{:else}<p class="text-sm text-muted-foreground">No messages yet.</p>{/each}
            </div>
          </div>
        {/if}
      </div>

      {#if showExtras}
        <div
          class="flex-col gap-4 {mobileTab === 'players' ? 'hidden lg:flex' : 'flex'}"
          transition:slide={{ duration: motionDuration }}
        >
          <div class="mathex-panel p-5 sm:p-6">
            <Header size="h2">Game options</Header>
            <div class="mt-4">
              <RoomOptions
                uid="manage"
                {settings}
                {endsAt}
                live={currentState === "started"}
                onchange={(change) => socket.emit("updateSettings", change)}
                ontimer={(minutes) => socket.emit("setGameTimer", minutes)}
              />
            </div>
          </div>
          <div class="mathex-panel p-5 sm:p-6">
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
            <div class="mathex-panel p-5 sm:p-6">
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
                {#each leaderboard as entry (entry.playerId)}
                  <div
                    animate:flip={{ duration: motionDuration }}
                    class="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 p-2.5"
                  >
                    <div
                      class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold {entry.rank ===
                      1
                        ? 'bg-yellow-400 text-yellow-900'
                        : entry.rank === 2
                          ? 'bg-muted text-muted-foreground'
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
                      {entry.correctCount}
                      correct, {entry.totalMs !== null ? msToMinutesAndSeconds(entry.totalMs) : "Not started"}
                    </span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <div class="mathex-panel p-5 sm:p-6">
            <div class="flex items-center justify-between">
              <Header size="h2">Logs ({filteredLogs.length})</Header>
              <div class="flex items-center gap-3">
                <Select.Root type="single" bind:value={verbosity}>
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
            <div
              class="mt-3 max-h-48 overflow-y-auto scrollbar-thin border border-border bg-muted/20 p-2 font-mono text-xs"
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
                    {:else if log.type === "kicked"}was removed from the room
                    {:else if log.type === "moderation"}{log.detail}
                    {:else}
                      {log.type}
                    {/if}
                  </span>
                </div>
              {:else}
                <p class="italic text-muted-foreground">No logs yet</p>
              {/each}
            </div>
          </div>
        </div>
      {/if}
    </div>

    {#if currentState !== "finished"}
      <Button
        onclick={() => {
          if (currentState === "lobby") {
            socket.emit("start");
          } else {
            socket.emit("finish");
          }
        }}
        class="w-full sm:w-auto"
        size="lg">{currentState === "lobby" ? "Start" : "Finish"} Game</Button
      >
    {/if}
  </main>
</div>
