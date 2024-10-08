<script lang="ts">
  import { page } from "$app/stores";

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
  import * as Select from "$lib/components/ui/select";
  import Identicon from "$lib/components/Identicon.svelte";

  const roomId = $page.url.searchParams.get("id");
  const runToken = $page.url.searchParams.get("runToken");

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
  let players: RoomSocketData[] = [];
  socket.on("playerData", (data) => (players = data));
  let currentState: RoomState = "lobby";

  import type { ToastT } from "svelte-sonner";
  let alertType: ToastT["type"] | null = null;
  let alertText = "";
</script>

<div class="flex flex-col w-full h-full p-2 gap-y-2">
  <div class="p-6 px-24 rounded text-slate-900 bg-white flex justify-center items-center text-center">
    <div class="flex-row text-xl">
      Join at <span class="font-bold">{$page.url.host}/mathex/app/play</span> with code:
    </div>
    <div class="w-full text-8xl font-bold">{roomId}</div>
  </div>

  <div class="p-3 rounded text-slate-900 bg-white">
    <Header size="h2">Players ({players.length})</Header>
    <div class="p-2 overflow-y-scroll flex items-center">
      {#each players as player}
        <div
          class="mr-2 p-2 h-full flex flex-col items-center justify-center text-center border-2 border-solid rounded {player.startingTime
            ? player.finishingTime
              ? 'bg-emerald-200'
              : 'bg-red-100'
            : 'bg-inherit'}"
        >
          <Identicon className="inline w-16 h-16" seed={player.name || "Choosing..."} />
          {#if player.name}
            <span>{player.name}</span>
          {:else}
            <span class="italic">Choosing...</span>
          {/if}
          {#if currentState === "started" && !player.finishingTime}
            <span>Question {player.currentQuestion}</span>
          {/if}
        </div>
      {:else}
        <p class="italic">No players yet</p>
      {/each}
    </div>
  </div>
  <div class="p-3 rounded text-slate-900 bg-white">
    <Header size="h2">Alerts</Header>
    <div class="flex w-full">
      <Select.Root
        onSelectedChange={(selection) => {
          // @ts-ignore
          if (selection?.value) alertType = selection.value;
        }}
      >
        <Select.Trigger class="w-[180px]">
          <Select.Value placeholder="Alert Type" />
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="success">Success</Select.Item>
          <Select.Item value="info">Info</Select.Item>
          <Select.Item value="warning">Warning</Select.Item>
          <Select.Item value="error">Error</Select.Item>
          <Select.Item value="loading">Loading</Select.Item>
        </Select.Content>
      </Select.Root>
      <Input bind:value={alertText} class="ml-2" placeholder="Alert Text" />
      <Button
        class="ml-2"
        on:click={() => {
          if (alertType === null) {
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
  {#if currentState !== "finished"}
    <Button
      on:click={() => {
        if (currentState === "lobby") {
          socket.emit("start");
          currentState = "started";
        } else {
          socket.emit("finish");
          currentState = "finished";
        }
      }}>{currentState === "lobby" ? "Start" : "Finish"}</Button
    >
  {/if}
</div>
