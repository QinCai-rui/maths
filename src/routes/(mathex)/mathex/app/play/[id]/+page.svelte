<script lang="ts">
  import { page } from "$app/state";
  import { io, type Socket } from "socket.io-client";
  import {
    type RoomServerToClientEvents,
    type RoomClientToServerEvents,
    type State,
    type LeaderboardEntry,
    Question
  } from "$lib/mathex/schemas";
  import { msToMinutesAndSeconds } from "$lib/utils";

  import Identicon from "$lib/components/Identicon.svelte";
  import { Input } from "$lib/components/ui/input";
  import { Button } from "$lib/components/ui/button";
  import { Header } from "$lib/components/ui/header";
  import { Label } from "$lib/components/ui/label";
  import { Progress } from "$lib/components/ui/progress";

  import NumberAnswer from "$lib/mathex/answers/NumberAnswer.svelte";
  import TextAnswer from "$lib/mathex/answers/TextAnswer.svelte";
  import ExpressionAnswer from "$lib/mathex/answers/ExpressionAnswer.svelte";

  import LoaderCircle from "@lucide/svelte/icons/loader-circle";

  import { Confetti } from "svelte-confetti";
  let confetti = $state(false);

  import DOMPurify from "dompurify";
  import { renderMath } from "$lib/mathex/content";

  const roomId = page.params.id;

  let gameState: State = $state("connecting");

  let name: string = $state("");

  import { toast } from "svelte-sonner";
  import type { z } from "zod";

  const socket: Socket<RoomServerToClientEvents, RoomClientToServerEvents> = io(`/room-${roomId}`);
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
    if (gameState === "connecting") gameState = "choose-name";
    toast.success("Connected!");
  });
  socket.on("connect_error", () => toast.error("Failed to connect! Does this room exist?"));
  socket.on("disconnect", () => toast.warning("Disconnected!"));

  $effect(() => {
    const reportVisibility = () => socket.emit("visibilityChange", document.hidden);
    document.addEventListener("visibilitychange", reportVisibility);
    return () => document.removeEventListener("visibilitychange", reportVisibility);
  });

  socket.on("lobby", () => (gameState = "waiting_start"));

  let answer: number | string | null = $state(null);

  let running: number | false = $state(false);
  let runningDuration = $state(16000);
  let runningVisible = $state(0);
  let currentQuestion: {
    number: number;
    content: string;
    solutionTypes: z.infer<typeof Question>["solutions"][number]["type"][];
  } = $state({
    number: 0,
    content: "<p>Loading...</p>",
    solutionTypes: ["text"]
  });
  let startingTime: number | null = $state(null);
  let timePassed = $state(0);
  setInterval(() => {
    if (!startingTime) timePassed = 0;
    else timePassed = Date.now() - startingTime;
  }, 100);
  socket.on("gameStart", () => {
    gameState = "started";
    startingTime = Date.now();
  });
  socket.on("gameFinish", () => {
    gameState = "finished";
  });
  socket.on("confetti", () => {
    confetti = true;
    setTimeout(() => (confetti = false), 6000);
  });
  socket.on("newQuestion", (content, solutionTypes) => {
    answer = null;
    currentQuestion = {
      number: currentQuestion.number + 1,
      content: DOMPurify.sanitize(content),
      solutionTypes
    };
    running = false;
  });
  socket.on("running", (durationMs: number) => {
    running = Date.now();
    runningDuration = durationMs;
    const interval = setInterval(() => {
      if (running) runningVisible = ((Date.now() - running) / runningDuration) * 100;
      else clearInterval(interval);
    });
  });
  socket.on("stopRunning", () => (running = false));
  let questionCount = $state(1);
  socket.on("questionCount", (data) => (questionCount = data));

  let leaderboard: LeaderboardEntry[] = $state([]);
  socket.on("leaderboard", (data) => (leaderboard = data));
</script>

{#if confetti}
  <div class="fixed top-[-50px] left-0 h-screen w-screen flex justify-center overflow-hidden pointer-events-none">
    <Confetti x={[-5, 5]} y={[0, 0.1]} delay={[500, 2000]} infinite duration={4000} amount={400} fallDistance="100vh" />
  </div>
{/if}

<div class="flex min-h-screen flex-col p-4">
  {#if gameState === "connecting"}
    <div class="flex flex-1 items-center justify-center">
      <span class="flex items-center gap-3 text-xl font-medium text-muted-foreground">
        <LoaderCircle class="h-5 w-5 animate-spin" />
        Connecting...
      </span>
    </div>
  {:else if gameState === "choose-name"}
    <div class="flex flex-1 items-center justify-center">
      <div class="w-full max-w-sm rounded-xl border border-border/60 bg-card p-6 shadow-sm">
        <div class="flex flex-col items-center">
          {#if name}
            <Identicon seed={name} className="w-16 h-16 rounded-lg" />
          {:else}
            <div
              class="flex h-16 w-16 items-center justify-center rounded-lg border-2 border-dashed border-border text-2xl text-muted-foreground"
            >
              ?
            </div>
          {/if}
          <div class="mt-4 w-full space-y-2">
            <Label for="name" class="text-sm font-medium">Your name</Label>
            <Input bind:value={name} type="text" placeholder="Enter your name" maxlength={20} />
          </div>
          <Button class="mt-4 w-full" onclick={() => socket.emit("join", name)}>Join Room</Button>
        </div>
      </div>
    </div>
  {:else if gameState === "waiting_start"}
    <div class="flex flex-1 items-center justify-center">
      <span class="flex items-center gap-3 text-xl font-medium text-muted-foreground">
        <LoaderCircle class="h-5 w-5 animate-spin" />
        Waiting for game to start...
      </span>
    </div>
  {:else if gameState === "started"}
    <div class="mx-auto w-full max-w-2xl">
      <div class="flex items-center justify-between rounded-xl border border-border/60 bg-card p-4 shadow-sm">
        <div class="text-2xl font-semibold tabular-nums">{msToMinutesAndSeconds(timePassed)}</div>
        <div class="text-sm text-muted-foreground">Question {currentQuestion.number} / {questionCount}</div>
      </div>

      {#if running}
        <div class="mt-4 rounded-xl border border-border/60 bg-card p-6 shadow-sm">
          <Header size="h3">Running...</Header>
          <div class="mt-4 flex items-center gap-3">
            <LoaderCircle class="h-5 w-5 animate-spin text-primary" />
            <Progress value={runningVisible} class="*:transition-none" />
          </div>
        </div>
      {:else}
        <div class="mt-4 rounded-xl border border-border/60 bg-card p-6 shadow-sm">
          <div class="prose prose-slate max-w-none dark:prose-invert">
            {@html renderMath(currentQuestion.content)}
          </div>
          <div class="mt-6">
            {#if currentQuestion.solutionTypes.length === 1 && currentQuestion.solutionTypes[0] === "number"}
              <NumberAnswer bind:answer />
            {:else if currentQuestion.solutionTypes.length === 1 && currentQuestion.solutionTypes[0] === "text"}
              <TextAnswer bind:answer />
            {:else if currentQuestion.solutionTypes.length === 1 && currentQuestion.solutionTypes[0] === "expression"}
              <ExpressionAnswer bind:answer />
            {:else}
              <ExpressionAnswer bind:answer />
            {/if}
          </div>
          <form
            class="mt-4"
            onsubmit={(e) => {
              e.preventDefault();
              if (answer === null || answer === "") {
                toast.error("Enter an answer first");
                return;
              }
              socket.emit("answer", answer);
            }}
          >
            <Button type="submit" class="w-full" disabled={answer === null || answer === ""}>Submit Answer</Button>
          </form>
        </div>
      {/if}
    </div>
  {:else if gameState === "finished"}
    <div class="flex flex-1 items-center justify-center">
      <div class="w-full max-w-md rounded-xl border border-border/60 bg-card p-8 shadow-sm text-center">
        <Header size="h1">Game finished!</Header>
        {#if leaderboard.length > 0}
          {@const myEntry = leaderboard.find((e) => e.name === name)}
          {#if myEntry}
            <div class="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary/10 px-4 py-2">
              <span class="text-lg font-bold text-primary">#{myEntry.rank}</span>
              <span class="text-sm text-muted-foreground">
                &middot; {myEntry.totalMs !== null ? msToMinutesAndSeconds(myEntry.totalMs) : "DNF"} &middot;
                {myEntry.questionsCompleted}/{myEntry.totalQuestions} correct
              </span>
            </div>
          {/if}
          <div class="mt-4 flex flex-col gap-1.5 text-left">
            {#each leaderboard as entry}
              <div
                class="flex items-center gap-2 rounded-lg border border-border/60 p-2 {entry.name === name
                  ? 'bg-primary/5 border-primary/20'
                  : 'bg-muted/30'}"
              >
                <div
                  class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold {entry.rank ===
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
                <span class="truncate text-sm font-medium {entry.name === name ? 'text-primary' : ''}"
                  >{entry.name}</span
                >
                <span class="ml-auto shrink-0 text-xs text-muted-foreground">
                  {entry.totalMs !== null ? msToMinutesAndSeconds(entry.totalMs) : "DNF"} &middot; {entry.questionsCompleted}/{entry.totalQuestions}
                </span>
              </div>
            {/each}
          </div>
        {/if}
        <p class="mt-4 text-muted-foreground">
          The host may communicate more information to you via alerts. They will appear at the bottom right.
        </p>
      </div>
    </div>
  {/if}
</div>
