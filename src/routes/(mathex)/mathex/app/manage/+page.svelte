<script lang="ts">
  import { page } from "$app/state";

  import { io, type Socket } from "socket.io-client";
  import {
    type RoomManageServerToClientEvents,
    type RoomManageClientToServerEvents,
    type RoomState,
    type RoomSocketData
  } from "$lib/mathex/schemas";

  import { Input } from "$lib/components/ui/input";
  import { Button } from "$lib/components/ui/button";
  import { Header } from "$lib/components/ui/header";
  import { Label } from "$lib/components/ui/label";
  import * as Select from "$lib/components/ui/select";
  import Identicon from "$lib/components/Identicon.svelte";

  const roomId = page.url.searchParams.get("id");
  const runToken = page.url.searchParams.get("runToken");

  import { toast } from "svelte-sonner";

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

  let alertTypes = ["normal", "action", "success", "info", "warning", "error", "loading", "default"] as const;
  let alertType: (typeof alertTypes)[number] | undefined = $state(undefined);
  let alertText = $state("");
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
      <div class="mt-4 flex max-h-64 flex-wrap gap-3 overflow-y-auto scrollbar-thin">
        {#each players as player}
          <div
            class="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-solid p-3 text-center transition-colors {player.startingTime
              ? player.finishingTime
                ? 'bg-emerald-100 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800'
                : 'bg-red-100 border-red-200 dark:bg-red-950/30 dark:border-red-800'
              : 'bg-muted/50 border-border'}"
          >
            <Identicon className="w-12 h-12" seed={player.name || "Choosing..."} />
            <span class="text-sm font-medium">{player.name || "Choosing..."}</span>
            {#if currentState === "started" && !player.finishingTime}
              <span class="text-xs text-muted-foreground">Question {player.currentQuestion}</span>
            {/if}
          </div>
        {:else}
          <p class="italic text-sm text-muted-foreground">No players yet</p>
        {/each}
      </div>
    </div>

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
