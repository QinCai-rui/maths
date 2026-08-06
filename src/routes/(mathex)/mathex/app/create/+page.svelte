<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Header } from "$lib/components/ui/header";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { toast } from "svelte-sonner";

  import MoveLeft from "@lucide/svelte/icons/move-left";
  import Upload from "@lucide/svelte/icons/upload";
  import FileJson from "@lucide/svelte/icons/file-json";

  import {
    Question,
    RoomName,
    type RoomCreateServerToClientEvents,
    type RoomCreateClientToServerEvents
  } from "$lib/mathex/schemas";
  import { z } from "zod";

  import { io, type Socket } from "socket.io-client";
  import { goto } from "$app/navigation";
  const socket: Socket<RoomCreateServerToClientEvents, RoomCreateClientToServerEvents> = io("/rooms");
  const ROOM_SET_KEY = "mathex-room-set";

  let file: File | undefined = $state(undefined);
  let fileValid = $state(false);
  let questionCount = $state(0);
  let editorSet: z.infer<typeof Question>[] | undefined = $state(undefined);
  let useEditorSet = $state(false);
  let roomName = $state("");
  let creating = $state(false);
  let dragOver = $state(false);
  let runningTime = $state(16);
  let visibilityTracking = $state(false);

  $effect(() => {
    if (!file) {
      fileValid = false;
      questionCount = 0;
      return;
    }
    (async () => {
      try {
        const text = await file!.text();
        const parsed = JSON.parse(text);
        const result = z.array(Question).safeParse(parsed);
        if (!result.success) {
          fileValid = false;
          questionCount = 0;
          return;
        }
        fileValid = true;
        questionCount = result.data.length;
      } catch {
        fileValid = false;
        questionCount = 0;
      }
    })();
  });

  $effect(() => {
    try {
      const result = z.array(Question).safeParse(JSON.parse(localStorage.getItem(ROOM_SET_KEY) || "null"));
      if (result.success && result.data.length > 0) {
        editorSet = result.data;
        useEditorSet = true;
      }
    } catch {}
  });

  let roomNameValid = $state(true);
  $effect(() => {
    if (!roomName) {
      roomNameValid = true;
      return;
    }
    const result = RoomName.safeParse(roomName);
    roomNameValid = result.success;
  });

  const canCreate = $derived(
    (fileValid || (useEditorSet && editorSet !== undefined)) && roomNameValid && roomName.length >= 3 && !creating
  );

  function handleFileDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const dropped = e.dataTransfer?.files?.[0];
    if (dropped && (dropped.type === "application/json" || dropped.name.endsWith(".json"))) {
      file = dropped;
    } else {
      toast.error("Please drop a .json file");
    }
  }

  async function createRoom() {
    if (!fileValid && (!useEditorSet || !editorSet)) {
      toast.error("Upload a valid question set file");
      return;
    }
    let roomNameResult = await RoomName.safeParseAsync(roomName);
    if (!roomNameResult.success) {
      for (const issue of roomNameResult.error.issues) toast.error(issue.message);
      return;
    }
    creating = true;
    try {
      const set = useEditorSet && editorSet ? editorSet : z.array(Question).parse(JSON.parse(await file!.text()));
      socket.emit("newRoom", roomNameResult.data, set, runningTime * 1000, visibilityTracking);
      socket.once("goto", (path) => {
        socket.disconnect();
        goto(path);
      });
    } catch {
      toast.error("Failed to create room");
      creating = false;
    }
  }
</script>

<div
  class="flex min-h-screen flex-col items-center justify-center gap-6 p-4"
  role="region"
  aria-label="Create room"
  ondragover={(e) => {
    e.preventDefault();
    dragOver = true;
  }}
  ondragleave={() => (dragOver = false)}
  ondrop={handleFileDrop}
>
  <div class="text-center">
    <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
      <svg class="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
      </svg>
    </div>
    <Header size="h1">Create</Header>
    <p class="mt-2 text-muted-foreground">Upload a question set and start a new room.</p>
  </div>

  <div class="w-full max-w-sm space-y-4">
    <div class="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
      <div class="space-y-4">
        <!-- File drop zone -->
        <div class="space-y-2">
          <Label>Question Set</Label>
          {#if editorSet}
            <button
              type="button"
              class="mb-2 flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors {useEditorSet
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/50'}"
              onclick={() => (useEditorSet = true)}
            >
              <span class="text-sm font-medium">Use set from editor</span>
              <span class="text-xs text-muted-foreground">
                {editorSet.length} question{editorSet.length === 1 ? "" : "s"}
              </span>
            </button>
          {/if}
          <button
            class="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed p-4 text-center transition-colors {dragOver
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50'} {file && !fileValid ? 'border-destructive' : ''} {file &&
            !useEditorSet
              ? 'border-primary bg-primary/5'
              : ''}"
            onclick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = ".json,application/json";
              input.onchange = () => {
                file = input.files?.[0];
                useEditorSet = false;
              };
              input.click();
            }}
            type="button"
          >
            {#if file}
              <FileJson class="h-8 w-8 text-primary" />
              <span class="text-sm font-medium">{file.name}</span>
              {#if fileValid}
                <span class="text-xs text-emerald-600 dark:text-emerald-400">
                  {questionCount} question{questionCount === 1 ? "" : "s"}
                </span>
              {:else}
                <span class="text-xs text-destructive">Invalid format</span>
              {/if}
            {:else}
              <Upload class="h-8 w-8 text-muted-foreground" />
              <span class="text-sm text-muted-foreground">
                {dragOver ? "Drop here" : "Click or drag a JSON file"}
              </span>
            {/if}
          </button>
        </div>

        <!-- Room name -->
        <div class="space-y-2">
          <Label for="room-name">Room Name</Label>
          <div class="relative">
            <Input
              bind:value={roomName}
              placeholder="Enter room name"
              maxlength={60}
              class={roomName && !roomNameValid ? "border-destructive" : ""}
            />
            <span class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              {roomName.length}/60
            </span>
          </div>
          {#if roomName && !roomNameValid}
            <p class="text-xs text-destructive">Must be 3-60 characters</p>
          {/if}
        </div>

        <!-- Running time -->
        <div class="space-y-2">
          <Label for="running-time">Thinking Time (seconds)</Label>
          <div class="relative">
            <Input id="running-time" type="number" min={1} max={60} bind:value={runningTime} class="pr-12" />
            <span class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">sec</span>
          </div>
          <p class="text-xs text-muted-foreground">How long players see "Running…" after submitting (1–60s)</p>
        </div>

        <div class="flex items-start gap-2 rounded-lg border border-border/60 p-3">
          <Checkbox id="visibility-tracking" bind:checked={visibilityTracking} />
          <div>
            <Label for="visibility-tracking" class="cursor-pointer">Flag players who leave the game tab</Label>
            <p class="mt-1 text-xs text-muted-foreground">
              Hosts can review tab changes and time away in the room log.
            </p>
          </div>
        </div>

        <Button onclick={createRoom} class="w-full" disabled={!canCreate}>
          {creating ? "Creating…" : "Create Room"}
        </Button>
      </div>
    </div>

    <div class="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <p class="text-sm font-medium text-foreground">Need a question set?</p>
      <p class="mt-1 text-sm text-muted-foreground">
        Use the editor to create your own questions, then export as JSON.
      </p>
      <Button href="/mathex/app/create/editor" variant="link" class="mt-2 px-0">Open Editor →</Button>
    </div>
  </div>

  <Button variant="ghost" href="/mathex/app" class="gap-2">
    <MoveLeft class="h-4 w-4" />
    Back to home
  </Button>
</div>
