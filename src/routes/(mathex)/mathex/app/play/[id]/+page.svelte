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
  import { createId, msToMinutesAndSeconds } from "$lib/utils";

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
  import CircleCheckBig from "@lucide/svelte/icons/circle-check-big";
  import CircleX from "@lucide/svelte/icons/circle-x";
  import Flag from "@lucide/svelte/icons/flag";
  import Timer from "@lucide/svelte/icons/timer";

  import { Confetti } from "svelte-confetti";
  let confetti = $state(false);

  import DOMPurify from "dompurify";
  import { renderMath } from "$lib/mathex/content";

  const roomId = page.params.id;
  const sessionKey = `mathex-player-${roomId}`;

  let gameState: State = $state("connecting");

  let name: string = $state("");
  let playerId = "";

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
    try {
      const session = JSON.parse(localStorage.getItem(sessionKey) || "null");
      if (typeof session?.name === "string" && typeof session?.playerId === "string") {
        name = session.name;
        playerId = session.playerId;
        socket.emit("join", name, playerId);
      } else {
        gameState = "choose-name";
      }
    } catch {
      gameState = "choose-name";
    }
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
  let answers: (number | string | null)[] = $state([]);

  let running: number | false = $state(false);
  let runningDuration = $state(16000);
  let runningVisible = $state(0);
  let answerFeedback: "correct" | "wrong" | null = $state(null);
  let currentQuestion: {
    number: number;
    content: string;
    answerGroups: z.infer<typeof Question>["solutions"][number]["type"][][];
    requireAllSolutionGroups: boolean;
    solutionOrderMatters: boolean;
  } = $state({
    number: 0,
    content: "<p>Loading...</p>",
    answerGroups: [["text"]],
    requireAllSolutionGroups: false,
    solutionOrderMatters: false
  });
  let startingTime: number | null = $state(null);
  let timePassed = $state(0);
  setInterval(() => {
    if (!startingTime) timePassed = 0;
    else timePassed = Date.now() - startingTime;
  }, 100);
  socket.on("joined", (joinedName) => {
    name = joinedName;
    localStorage.setItem(sessionKey, JSON.stringify({ name, playerId }));
  });
  socket.on("gameStart", (serverStartingTime) => {
    gameState = "started";
    startingTime = serverStartingTime;
  });
  socket.on("gameFinish", () => {
    gameState = "finished";
  });
  socket.on("confetti", () => {
    confetti = true;
    setTimeout(() => (confetti = false), 6000);
  });
  socket.on("newQuestion", (content, answerGroups, requireAllSolutionGroups, solutionOrderMatters, questionNumber) => {
    answer = null;
    answers = answerGroups.map(() => null);
    answerFeedback = null;
    currentQuestion = {
      number: questionNumber,
      content: DOMPurify.sanitize(content),
      answerGroups,
      requireAllSolutionGroups,
      solutionOrderMatters
    };
    running = false;
  });
  socket.on("running", (durationMs: number) => {
    answerFeedback = null;
    running = Date.now();
    runningDuration = durationMs;
    const interval = setInterval(() => {
      if (running) runningVisible = ((Date.now() - running) / runningDuration) * 100;
      else clearInterval(interval);
    });
  });
  socket.on("answerResult", (correct) => {
    answerFeedback = correct ? "correct" : "wrong";
    if (!correct) answer = null;
  });
  socket.on("stopRunning", () => (running = false));
  let questionCount = $state(1);
  socket.on("questionCount", (data) => (questionCount = data));

  let leaderboard: LeaderboardEntry[] = $state([]);
  socket.on("leaderboard", (data) => (leaderboard = data));

  function joinRoom() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Enter a username");
      return;
    }
    name = trimmedName;
    playerId = createId();
    socket.emit("join", name, playerId);
  }
</script>

{#if confetti}
  <div class="fixed top-[-50px] left-0 h-screen w-screen flex justify-center overflow-hidden pointer-events-none">
    <Confetti x={[-5, 5]} y={[0, 0.1]} delay={[500, 2000]} infinite duration={4000} amount={400} fallDistance="100vh" />
  </div>
{/if}

<div class="mathex-shell min-h-screen p-4 sm:p-6">
  {#if gameState === "connecting"}
    <div class="flex min-h-[calc(100vh-3rem)] flex-1 items-center justify-center">
      <span
        class="mathex-panel flex items-center gap-3 rounded-2xl px-5 py-4 text-lg font-medium text-muted-foreground"
      >
        <LoaderCircle class="h-5 w-5 animate-spin" />
        Connecting...
      </span>
    </div>
  {:else if gameState === "choose-name"}
    <div class="flex min-h-[calc(100vh-3rem)] flex-1 items-center justify-center">
      <div class="mathex-panel w-full max-w-md rounded-3xl p-7 sm:p-9">
        <p class="mathex-kicker">Player check-in</p>
        <Header size="h1" class="mt-2 text-3xl tracking-[-0.04em]">Choose your name.</Header>
        <p class="mt-2 text-sm leading-6 text-muted-foreground">This is how you will appear on the live leaderboard.</p>
        <form
          class="flex flex-col items-center"
          onsubmit={(e) => {
            e.preventDefault();
            joinRoom();
          }}
        >
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
          <Button type="submit" class="mt-5 w-full shadow-lg shadow-primary/20" size="lg">Join competition</Button>
        </form>
      </div>
    </div>
  {:else if gameState === "waiting_start"}
    <div class="flex min-h-[calc(100vh-3rem)] flex-1 items-center justify-center">
      <span
        class="mathex-panel flex items-center gap-3 rounded-2xl px-5 py-4 text-lg font-medium text-muted-foreground"
      >
        <LoaderCircle class="h-5 w-5 animate-spin" />
        Waiting for game to start...
      </span>
    </div>
  {:else if gameState === "started"}
    <div class="mx-auto w-full max-w-3xl">
      <header class="mathex-panel flex items-center justify-between rounded-2xl p-3.5 sm:p-4">
        <div class="flex items-center gap-3">
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"
            ><Timer class="h-4 w-4" /></span
          >
          <div>
            <p class="text-xl font-bold tabular-nums sm:text-2xl">{msToMinutesAndSeconds(timePassed)}</p>
            <p class="text-[0.65rem] font-bold uppercase tracking-wider text-muted-foreground">Elapsed time</p>
          </div>
        </div>
        <div class="text-right">
          <p class="text-sm font-bold">
            Question {currentQuestion.number}<span class="text-muted-foreground"> / {questionCount}</span>
          </p>
          <div class="mt-2 h-1.5 w-24 overflow-hidden rounded-full bg-muted">
            <div
              class="h-full rounded-full bg-primary"
              style={`width: ${(currentQuestion.number / questionCount) * 100}%`}
            ></div>
          </div>
        </div>
      </header>

      {#if running}
        <div class="mathex-panel mt-4 rounded-3xl p-7 text-center sm:p-9">
          {#if answerFeedback === "correct"}
            <div
              class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            >
              <CircleCheckBig class="h-9 w-9" />
            </div>
            <p class="mathex-kicker mt-5 text-emerald-600 dark:text-emerald-400">Correct answer</p>
            <Header size="h3" class="mt-1 text-3xl">Excellent work.</Header>
            <p class="mt-2 text-sm text-muted-foreground">Loading your next question...</p>
          {:else if answerFeedback === "wrong"}
            <div
              class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"
            >
              <CircleX class="h-9 w-9" />
            </div>
            <p class="mathex-kicker mt-5 text-destructive">Not quite</p>
            <Header size="h3" class="mt-1 text-3xl">Try again.</Header>
            <p class="mt-2 text-sm text-muted-foreground">The question will reopen in a moment.</p>
          {:else}
            <p class="mathex-kicker">Answer received</p>
            <Header size="h3" class="mt-1">Checking your work...</Header>
            <div class="mt-4 flex items-center gap-3">
              <LoaderCircle class="h-5 w-5 animate-spin text-primary" />
              <Progress value={runningVisible} class="*:transition-none" />
            </div>
          {/if}
        </div>
      {:else}
        <div class="mathex-panel mt-4 rounded-3xl p-6 sm:p-9">
          <div class="mb-7 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-primary">
            <Flag class="h-3.5 w-3.5" /> Problem {currentQuestion.number}
          </div>
          <div class="question-content prose prose-slate max-w-none dark:prose-invert">
            {@html renderMath(currentQuestion.content)}
          </div>
          <div class="mt-6">
            {#if currentQuestion.requireAllSolutionGroups}
              <div class="grid gap-4">
                {#each currentQuestion.answerGroups as answerGroup, index}
                  <div class="grid gap-1.5">
                    <Label>Answer {index + 1}</Label>
                    {#if answerGroup.length === 1 && answerGroup[0] === "number"}
                      <NumberAnswer bind:answer={answers[index]} />
                    {:else if answerGroup.length === 1 && answerGroup[0] === "text"}
                      <TextAnswer bind:answer={answers[index]} />
                    {:else}
                      <ExpressionAnswer bind:answer={answers[index]} />
                    {/if}
                  </div>
                {/each}
              </div>
            {:else if currentQuestion.answerGroups[0]?.length === 1 && currentQuestion.answerGroups[0][0] === "number"}
              <NumberAnswer bind:answer />
            {:else if currentQuestion.answerGroups[0]?.length === 1 && currentQuestion.answerGroups[0][0] === "text"}
              <TextAnswer bind:answer />
            {:else if currentQuestion.answerGroups[0]?.length === 1 && currentQuestion.answerGroups[0][0] === "expression"}
              <ExpressionAnswer bind:answer />
            {:else}
              <ExpressionAnswer bind:answer />
            {/if}
          </div>
          <form
            class="mt-4"
            onsubmit={(e) => {
              e.preventDefault();
              const submittedAnswer = currentQuestion.requireAllSolutionGroups ? answers : answer;
              if (
                (Array.isArray(submittedAnswer) && submittedAnswer.some((value) => value === null || value === "")) ||
                submittedAnswer === null ||
                submittedAnswer === ""
              ) {
                toast.error("Enter an answer first");
                return;
              }
              socket.emit("answer", submittedAnswer);
            }}
          >
            <Button
              type="submit"
              class="w-full shadow-lg shadow-primary/20"
              size="lg"
              disabled={currentQuestion.requireAllSolutionGroups
                ? answers.some((value) => value === null || value === "")
                : answer === null || answer === ""}>Lock in answer</Button
            >
          </form>
        </div>
      {/if}
    </div>
  {:else if gameState === "finished"}
    <div class="flex min-h-[calc(100vh-3rem)] flex-1 items-center justify-center">
      <div class="mathex-panel w-full max-w-md rounded-3xl p-7 text-center sm:p-9">
        <div
          class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        >
          <CircleCheckBig class="h-7 w-7" />
        </div>
        <p class="mathex-kicker mt-5">Round complete</p>
        <Header size="h1" class="mt-2 text-4xl tracking-[-0.04em]">You finished!</Header>
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

<style>
  .question-content :global(img) {
    max-width: 100%;
    max-height: 32rem;
    margin-inline: auto;
    border-radius: 0.5rem;
  }
</style>
