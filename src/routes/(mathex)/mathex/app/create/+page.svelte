<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Header } from "$lib/components/ui/header";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { toast } from "svelte-sonner";

  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import Clock3 from "@lucide/svelte/icons/clock-3";
  import Upload from "@lucide/svelte/icons/upload";
  import FileJson from "@lucide/svelte/icons/file-json";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";

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
  class="mathex-shell min-h-screen px-4 py-5 sm:px-8 sm:py-8"
  role="region"
  aria-label="Create room"
  ondragover={(e) => {
    e.preventDefault();
    dragOver = true;
  }}
  ondragleave={() => (dragOver = false)}
  ondrop={handleFileDrop}
>
  <main class="mx-auto w-full max-w-6xl">
    <a
      href="/mathex/app"
      class="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      ><ArrowLeft class="h-4 w-4" /> Competition home</a
    >
    <div class="mt-10 grid gap-8 lg:grid-cols-[0.75fr_1.25fr] lg:items-start">
      <section class="lg:sticky lg:top-8">
        <p class="mathex-kicker">Host setup</p>
        <Header size="h1" class="mt-2 text-4xl leading-none tracking-[-0.04em] sm:text-5xl"
          >Build the<br /><span class="text-primary">starting line.</span></Header
        >
        <p class="mt-5 max-w-sm leading-7 text-muted-foreground">
          Choose the question set, tune the round, and share a unique room code when everything is ready.
        </p>
        <div class="mt-8 space-y-4 border-l border-border/70 pl-4 text-sm">
          <div>
            <p class="font-semibold">1. Select questions</p>
            <p class="mt-0.5 text-muted-foreground">Upload JSON or use your saved editor set.</p>
          </div>
          <div>
            <p class="font-semibold">2. Set the pace</p>
            <p class="mt-0.5 text-muted-foreground">Configure time between submissions.</p>
          </div>
          <div>
            <p class="font-semibold">3. Open the room</p>
            <p class="mt-0.5 text-muted-foreground">Start when every player is in.</p>
          </div>
        </div>
      </section>

      <div class="space-y-4">
        <div class="mathex-panel rounded-3xl p-5 sm:p-7">
          <div class="mb-6 flex items-center justify-between">
            <div>
              <p class="mathex-kicker">Room details</p>
              <h2 class="mt-1 text-xl font-bold">Create a new competition</h2>
            </div>
            <span class="rounded-xl bg-primary/10 p-2.5 text-primary"><FileJson class="h-5 w-5" /></span>
          </div>
          <form
            class="space-y-4"
            onsubmit={(e) => {
              e.preventDefault();
              createRoom();
            }}
          >
            <div class="space-y-2">
              <Label class="font-semibold">Question set</Label>
              {#if editorSet}
                <button
                  type="button"
                  class="mb-2 flex w-full items-center justify-between rounded-xl border p-3.5 text-left transition-colors {useEditorSet
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
                class="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition-colors {dragOver
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

            <div class="space-y-2">
              <Label for="room-name" class="font-semibold">Room name</Label>
              <div class="relative">
                <Input
                  bind:value={roomName}
                  placeholder="e.g. Euclid Invitational"
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

            <div class="grid gap-4 sm:grid-cols-2">
              <div class="space-y-2">
                <Label for="running-time" class="flex items-center gap-2 font-semibold"
                  ><Clock3 class="h-4 w-4 text-primary" /> Thinking time</Label
                >
                <div class="relative">
                  <Input id="running-time" type="number" min={1} max={60} bind:value={runningTime} class="pr-12" />
                  <span class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">sec</span>
                </div>
                <p class="text-xs leading-5 text-muted-foreground">
                  A short pause after every answer. 1 to 60 seconds.
                </p>
              </div>

              <div class="rounded-2xl border border-border/70 bg-muted/30 p-3.5">
                <div class="flex items-start gap-2.5">
                  <Checkbox id="visibility-tracking" bind:checked={visibilityTracking} />
                  <div>
                    <Label
                      for="visibility-tracking"
                      class="flex cursor-pointer items-center gap-1.5 text-sm font-semibold"
                      ><ShieldCheck class="h-4 w-4 text-primary" /> Fair play tracking</Label
                    >
                    <p class="mt-1 text-xs leading-5 text-muted-foreground">Log players who leave the game tab.</p>
                  </div>
                </div>
              </div>
            </div>

            <Button type="submit" class="mt-2 w-full shadow-lg shadow-primary/20" size="lg" disabled={!canCreate}>
              {creating ? "Creating…" : "Create Room"}
            </Button>
          </form>
        </div>

        <div
          class="flex flex-col justify-between gap-3 rounded-2xl border border-border/70 bg-muted/30 p-5 sm:flex-row sm:items-center"
        >
          <div>
            <p class="text-sm font-semibold">Need a question set?</p>
            <p class="mt-1 text-sm text-muted-foreground">Create one in the built-in editor, then return here.</p>
          </div>
          <Button href="/mathex/app/create/editor" variant="outline" class="shrink-0">Open editor</Button>
        </div>
      </div>
    </div>
  </main>
</div>
