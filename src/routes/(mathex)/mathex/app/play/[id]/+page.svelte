<script lang="ts">
  import { page } from "$app/state";
  import Calculator from "$lib/mathex/Calculator.svelte";
  import RankBadge from "$lib/mathex/RankBadge.svelte";
  import SketchPad from "$lib/mathex/SketchPad.svelte";
  import { DEFAULT_ROOM_SETTINGS, type ChatMessage } from "$lib/mathex/schemas";
  import {
    Calculator as CalculatorIcon,
    Pencil,
    Trophy,
    MessageCircle,
    Send,
    UserX,
    Hourglass
  } from "@lucide/svelte/icons";
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
  import * as AlertDialog from "$lib/components/ui/alert-dialog";

  import NumberAnswer from "$lib/mathex/answers/NumberAnswer.svelte";
  import TextAnswer from "$lib/mathex/answers/TextAnswer.svelte";
  import ExpressionAnswer from "$lib/mathex/answers/ExpressionAnswer.svelte";

  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import CircleCheckBig from "@lucide/svelte/icons/circle-check-big";
  import CircleX from "@lucide/svelte/icons/circle-x";
  import Flag from "@lucide/svelte/icons/flag";
  import Timer from "@lucide/svelte/icons/timer";
  import CircleMinus from "@lucide/svelte/icons/circle-minus";

  import { Confetti } from "svelte-confetti";
  let confetti = $state(false);

  import DOMPurify from "dompurify";
  import { renderMath } from "$lib/mathex/content";
  const reduceMotion = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const roomId = page.params.id;
  const sessionKey = `mathex-player-${roomId}`;

  let gameState: State = $state("connecting");
  let kicked = $state(false);
  let connectionError = $state(false);
  let sessionNotice = $state<string | null>(null);

  let name: string = $state("");
  let playerId = $state("");
  let publicPlayerId = $state("");
  let joining = $state(false);
  let joinTimer: ReturnType<typeof setTimeout> | undefined;

  import { toast } from "svelte-sonner";
  import type { z } from "zod";

  const socket: Socket<RoomServerToClientEvents, RoomClientToServerEvents> = io(`/room-${roomId}`);
  socket.on("playerIdentity", (id) => (publicPlayerId = id));
  socket.on("alert", (type, message) => {
    if (type === "error" && gameState === "connecting" && message.includes("Room does not exist")) {
      connectionError = true;
    }
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
  socket.on("connect_error", () => {
    connectionError = true;
    toast.error("Failed to connect! Does this room exist?");
  });
  socket.on("disconnect", () => {
    if (!kicked) {
      toast.warning("Disconnected!");
      if (gameState === "connecting") connectionError = true;
    }
  });
  socket.on("kicked", () => {
    kicked = true;
    gameState = "kicked";
    running = false;
    skipConfirmOpen = false;
    try {
      localStorage.removeItem(sessionKey);
    } catch {
      /* Storage is optional. */
    }
  });
  socket.on("joinDenied", (reason) => {
    joining = false;
    clearTimeout(joinTimer);
    try {
      localStorage.removeItem(sessionKey);
    } catch {
      /* Storage is optional. */
    }
    sessionNotice = reason;
    gameState = "choose-name";
  });

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
    skippable: boolean;
  } = $state({
    number: 0,
    content: "<p>Loading...</p>",
    answerGroups: [["text"]],
    requireAllSolutionGroups: false,
    solutionOrderMatters: false,
    skippable: true
  });
  let startingTime: number | null = $state(null);
  let timePassed = $state(0);
  let progressInterval: ReturnType<typeof setInterval> | undefined;
  let confettiTimer: ReturnType<typeof setTimeout> | undefined;
  let submittingAnswer = $state(false);
  let answerTimer: ReturnType<typeof setTimeout> | undefined;
  let clockNow = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => {
      clockNow = Date.now();
      if (gameState === "started") timePassed = startingTime === null ? 0 : clockNow - startingTime;
    }, 100);
    return () => {
      clearInterval(timer);
      clearInterval(progressInterval);
      clearTimeout(confettiTimer);
      clearTimeout(joinTimer);
      clearTimeout(answerTimer);
      socket.disconnect();
    };
  });
  socket.on("joined", (joinedName) => {
    joining = false;
    clearTimeout(joinTimer);
    name = joinedName;
    try {
      localStorage.setItem(sessionKey, JSON.stringify({ name, playerId }));
    } catch {
      /* Keep playing without saved sessions. */
    }
  });
  socket.on("gameStart", (serverStartingTime) => {
    gameState = "started";
    startingTime = serverStartingTime;
  });
  socket.on("gameFinish", () => {
    gameState = "finished";
    running = false;
    skipConfirmOpen = false;
    clearInterval(progressInterval);
    sketchOpen = false;
    calcOpen = false;
  });
  socket.on("confetti", () => {
    if (reduceMotion) return;
    confetti = true;
    clearTimeout(confettiTimer);
    confettiTimer = setTimeout(() => (confetti = false), 6000);
  });
  let skipConfirmOpen = $state(false);

  socket.on(
    "newQuestion",
    (content, answerGroups, requireAllSolutionGroups, solutionOrderMatters, questionNumber, skippable) => {
      submittingAnswer = false;
      clearTimeout(answerTimer);
      skipConfirmOpen = false;
      answer = null;
      answers = answerGroups.map(() => null);
      answerFeedback = null;
      currentQuestion = {
        number: questionNumber,
        content: DOMPurify.sanitize(content),
        answerGroups,
        requireAllSolutionGroups,
        solutionOrderMatters,
        skippable
      };
      running = false;
    }
  );
  socket.on("running", (durationMs: number) => {
    answerFeedback = null;
    running = Date.now();
    runningDuration = durationMs;
    clearInterval(progressInterval);
    progressInterval = setInterval(() => {
      if (running) runningVisible = ((Date.now() - running) / runningDuration) * 100;
      else clearInterval(progressInterval);
    }, 50);
  });
  socket.on("answerResult", (correct) => {
    submittingAnswer = false;
    clearTimeout(answerTimer);
    answerFeedback = correct ? "correct" : "wrong";
    if (!correct) answer = null;
  });
  socket.on("stopRunning", () => {
    running = false;
    clearInterval(progressInterval);
  });
  let questionCount = $state(1);
  socket.on("questionCount", (data) => (questionCount = data));

  let leaderboard: LeaderboardEntry[] = $state([]);
  socket.on("leaderboard", (data) => (leaderboard = data));
  let settings = $state({ ...DEFAULT_ROOM_SETTINGS });
  let endsAt = $state<number | null>(null);
  let panel = $state<"standings" | "chat" | null>(null);
  let calcOpen = $state(false);
  let sketchOpen = $state(false);
  let chat = $state<ChatMessage[]>([]);
  let chatDraft = $state("");
  let unread = $state(0);
  let muted = $state(false);
  let chatContainer = $state<HTMLDivElement | null>(null);
  let standingsContainer = $state<HTMLDivElement | null>(null);
  let selfPinned = $state<"top" | "bottom" | null>(null);
  socket.on("roomSettings", (value) => (settings = value));
  socket.on("gameEndsAt", (value) => (endsAt = value));
  socket.on("chatHistory", (messages) => (chat = messages.slice(-200)));
  socket.on("chatMessage", (message) => {
    chat = [...chat, message].slice(-200);
    if (panel !== "chat") unread++;
  });
  socket.on("chatDeleted", (id) => (chat = chat.filter((message) => message.id !== id)));
  socket.on("chatMuted", (value) => (muted = value));
  $effect(() => {
    if (!settings.showLeaderboard && panel === "standings") {
      panel = null;
      leaderboard = [];
    }
    if (!settings.allowChat && panel === "chat") panel = null;
    if (!settings.allowCalculator) calcOpen = false;
    if (!settings.allowSketch) sketchOpen = false;
  });
  $effect(() => {
    if (panel === "chat" && chatContainer) {
      chat.length;
      chatContainer.scrollTop = chatContainer.scrollHeight;
      unread = 0;
    }
  });
  function pinSelf() {
    const container = standingsContainer;
    const row = container?.querySelector<HTMLElement>("[data-self]");
    if (!container || !row) {
      selfPinned = null;
      return;
    }
    const box = container.getBoundingClientRect(),
      item = row.getBoundingClientRect();
    selfPinned = item.top < box.top - 1 ? "top" : item.bottom > box.bottom + 1 ? "bottom" : null;
  }
  $effect(() => {
    leaderboard;
    panel;
    standingsContainer;
    const frame = requestAnimationFrame(pinSelf);
    return () => cancelAnimationFrame(frame);
  });
  function sendChat() {
    const text = chatDraft.trim();
    if (!text || muted || !settings.allowChat) return;
    socket.emit("sendChat", text.slice(0, 500));
    chatDraft = "";
  }
  function submitAnswer() {
    if (submittingAnswer) return;
    const value = currentQuestion.requireAllSolutionGroups ? answers : answer;
    if (running || gameState !== "started") return;
    if (
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.some((item) => item === null || item === ""))
    ) {
      toast.error("Enter an answer first");
      return;
    }
    submittingAnswer = true;
    socket.emit("answer", value as string | number | (string | number)[]);
    sketchOpen = false;
    // Re-enable if the server never acknowledges the answer.
    clearTimeout(answerTimer);
    answerTimer = setTimeout(() => (submittingAnswer = false), 4000);
  }

  function joinRoom() {
    if (joining) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Enter a display name");
      return;
    }
    sessionNotice = null;
    joining = true;
    name = trimmedName;
    kicked = false;
    playerId = createId();
    socket.emit("join", name, playerId);
    // Re-enable if the server never answers (e.g. a dropped connection).
    clearTimeout(joinTimer);
    joinTimer = setTimeout(() => (joining = false), 2000);
  }

  function confirmSkip() {
    skipConfirmOpen = true;
  }

  function executeSkip() {
    skipConfirmOpen = false;
    socket.emit("skip");
  }
</script>

{#if confetti}
  <div class="fixed top-[-50px] left-0 h-screen w-screen flex justify-center overflow-hidden pointer-events-none">
    <Confetti x={[-5, 5]} y={[0, 0.1]} delay={[500, 2000]} infinite duration={4000} amount={400} fallDistance="100vh" />
  </div>
{/if}

<AlertDialog.Root bind:open={skipConfirmOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Skip this question?</AlertDialog.Title>
      <AlertDialog.Description>
        You cannot undo this action. The question will be marked as skipped and you will move to the next one.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action onclick={executeSkip}>Skip question</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

{#snippet standingsRow(entry: LeaderboardEntry, self: boolean)}
  <div
    data-self={self ? "" : undefined}
    class="flex items-center gap-2 border border-border p-2 text-sm {self ? 'bg-accent' : 'bg-card'}"
  >
    <span class="w-6 shrink-0 font-semibold">{entry.rank}</span><span class="min-w-0 flex-1 truncate font-medium"
      >{entry.name}</span
    ><span class="shrink-0 tabular-nums">{entry.correctCount}/{entry.totalQuestions}</span>
  </div>
{/snippet}

<div class="mathex-shell min-h-screen px-3 py-5 sm:px-6 sm:py-7">
  {#if gameState === "connecting"}
    <div class="flex min-h-[calc(100vh-3rem)] flex-1 items-center justify-center">
      {#if connectionError}
        <div class="mathex-panel max-w-md p-6 text-center sm:p-8">
          <p class="mathex-kicker">Connection problem</p>
          <Header size="h2" class="mt-2 text-2xl">That room could not be reached</Header>
          <p class="mt-2 text-sm leading-6 text-muted-foreground">
            It may not exist, or the competition may have ended. Check the code and try again.
          </p>
          <Button href="/mathex/app/play" class="mt-5 w-full" size="lg">Enter a different code</Button>
        </div>
      {:else}
        <span class="mathex-panel flex items-center gap-3 px-5 py-4 text-lg font-medium text-muted-foreground">
          <LoaderCircle class="h-5 w-5 animate-spin" />
          Connecting...
        </span>
      {/if}
    </div>
  {:else if gameState === "choose-name"}
    <div class="flex min-h-[calc(100vh-3rem)] flex-1 items-center justify-center">
      <div class="mathex-panel w-full max-w-md p-6 sm:p-8">
        <p class="mathex-kicker">Join the competition</p>
        <Header size="h1" class="mt-2 text-3xl tracking-[-0.04em]">Choose a display name</Header>
        <p class="mt-2 text-sm leading-6 text-muted-foreground">Your name will appear on the leaderboard.</p>
        {#if sessionNotice}
          <p class="mt-3 border border-border bg-muted/40 p-3 text-sm leading-6" role="alert">{sessionNotice}</p>
        {/if}
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
            <Input id="name" bind:value={name} type="text" placeholder="Enter your name" maxlength={20} />
          </div>
          <Button type="submit" class="mt-5 w-full" size="lg" disabled={joining || !name.trim()}
            >{joining ? "Joining…" : "Join competition"}</Button
          >
        </form>
      </div>
    </div>
  {:else if gameState === "waiting_start"}
    <div class="flex min-h-[calc(100vh-3rem)] flex-1 items-center justify-center">
      <span class="mathex-panel flex items-center gap-3 px-5 py-4 text-lg font-medium text-muted-foreground">
        <LoaderCircle class="h-5 w-5 animate-spin" />
        Waiting for the host to start the competition
      </span>
    </div>
  {:else if gameState === "started"}
    <div class="mx-auto w-full {panel ? 'max-w-6xl' : 'max-w-3xl'}">
      <header class="mathex-panel flex items-center justify-between p-3.5 sm:p-4">
        <div class="flex items-center gap-3">
          <span class="flex h-9 w-9 items-center justify-center bg-primary/10 text-primary"
            >{#if endsAt !== null}<Hourglass class="h-4 w-4" />{:else}<Timer class="h-4 w-4" />{/if}</span
          >
          <div>
            {#if endsAt !== null}
              {@const remaining = endsAt - clockNow}
              <p
                class="text-xl font-bold tabular-nums sm:text-2xl {remaining < 0 ? 'text-destructive' : ''}"
                role="timer"
              >
                {msToMinutesAndSeconds(remaining)}
              </p>
              <p class="text-xs font-medium text-muted-foreground">
                {remaining < 0 ? "Overtime" : "Time left"} · {msToMinutesAndSeconds(timePassed)} elapsed
              </p>
            {:else}
              <p class="text-xl font-bold tabular-nums sm:text-2xl">{msToMinutesAndSeconds(timePassed)}</p>
              <p class="text-xs font-medium text-muted-foreground">Elapsed time</p>
            {/if}
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
      <div class="mt-3 flex flex-wrap gap-2" role="group" aria-label="Player tools">
        {#if settings.showLeaderboard}<Button
            size="sm"
            variant={panel === "standings" ? "default" : "outline"}
            onclick={() => (panel = panel === "standings" ? null : "standings")}
            aria-pressed={panel === "standings"}><Trophy class="h-4 w-4" />Standings</Button
          >{/if}
        {#if settings.allowCalculator}<Button
            size="sm"
            variant={calcOpen ? "default" : "outline"}
            onclick={() => (calcOpen = !calcOpen)}
            aria-pressed={calcOpen}><CalculatorIcon class="h-4 w-4" />Calculator</Button
          >{/if}
        {#if settings.allowSketch}<Button
            size="sm"
            variant={sketchOpen ? "default" : "outline"}
            onclick={() => (sketchOpen = !sketchOpen)}
            aria-pressed={sketchOpen}><Pencil class="h-4 w-4" />Sketch</Button
          >{/if}
        {#if settings.allowChat}<Button
            size="sm"
            variant={panel === "chat" ? "default" : "outline"}
            onclick={() => {
              panel = panel === "chat" ? null : "chat";
              unread = 0;
            }}
            aria-pressed={panel === "chat"}
            ><MessageCircle class="h-4 w-4" />Chat{unread > 0 ? ` (${Math.min(unread, 99)})` : ""}</Button
          >{/if}
      </div>
      <div class="grid items-start gap-4 {panel ? 'lg:grid-cols-[minmax(0,1fr)_300px]' : ''}">
        <div class="min-w-0">
          {#if running}
            <div class="mathex-panel mt-4 p-7 text-center sm:p-9" role="status" aria-live="polite">
              {#if answerFeedback === "correct"}
                <div
                  class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                >
                  <CircleCheckBig class="h-9 w-9" />
                </div>
                <p class="mathex-kicker mt-5 text-emerald-600 dark:text-emerald-400">Correct answer</p>
                <Header size="h3" class="mt-1 text-3xl">Correct</Header>
                <p class="mt-2 text-sm text-muted-foreground">Loading your next question...</p>
              {:else if answerFeedback === "wrong"}
                <div
                  class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"
                >
                  <CircleX class="h-9 w-9" />
                </div>
                <p class="mathex-kicker mt-5 text-destructive">Not quite</p>
                <Header size="h3" class="mt-1 text-3xl">Not correct</Header>
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
            <div class="mathex-panel mt-4 p-6 sm:p-9">
              <div
                class="mb-6 flex items-center justify-between gap-3 border-b border-border pb-4 text-sm font-semibold text-primary"
              >
                <span class="flex items-center gap-2"><Flag class="h-4 w-4" /> Question {currentQuestion.number}</span>
                <span class="tabular-nums text-muted-foreground">{questionCount} total</span>
              </div>
              <div class="question-content prose prose-slate max-w-none dark:prose-invert">
                {@html renderMath(currentQuestion.content)}
              </div>
              <form
                class="mt-6"
                onsubmit={(event) => {
                  event.preventDefault();
                  submitAnswer();
                }}
              >
                <div>
                  {#if currentQuestion.requireAllSolutionGroups}
                    <div class="grid gap-4">
                      {#each currentQuestion.answerGroups as answerGroup, index}
                        <div class="grid gap-1.5">
                          <Label for={`answer-${index}`}>Answer {index + 1}</Label>
                          {#if answerGroup.length === 1 && answerGroup[0] === "number"}
                            <NumberAnswer id={`answer-${index}`} bind:answer={answers[index]} />
                          {:else if answerGroup.length === 1 && answerGroup[0] === "text"}
                            <TextAnswer id={`answer-${index}`} bind:answer={answers[index]} />
                          {:else}
                            <ExpressionAnswer id={`answer-${index}`} bind:answer={answers[index]} />
                          {/if}
                        </div>
                      {/each}
                    </div>
                  {:else}
                    <Label for="answer-single" class="sr-only">Your answer</Label>
                    {#if currentQuestion.answerGroups[0]?.length === 1 && currentQuestion.answerGroups[0][0] === "number"}
                      <NumberAnswer id="answer-single" bind:answer />
                    {:else if currentQuestion.answerGroups[0]?.length === 1 && currentQuestion.answerGroups[0][0] === "text"}
                      <TextAnswer id="answer-single" bind:answer />
                    {:else if currentQuestion.answerGroups[0]?.length === 1 && currentQuestion.answerGroups[0][0] === "expression"}
                      <ExpressionAnswer id="answer-single" bind:answer />
                    {:else}
                      <ExpressionAnswer id="answer-single" bind:answer />
                    {/if}
                  {/if}
                </div>
                <Button
                  type="submit"
                  class="mt-4 w-full"
                  size="lg"
                  disabled={submittingAnswer ||
                    (currentQuestion.requireAllSolutionGroups
                      ? answers.some((value) => value === null || value === "")
                      : answer === null || answer === "")}>{submittingAnswer ? "Submitting…" : "Lock in answer"}</Button
                >
              </form>
              {#if currentQuestion.skippable}
                <Button variant="outline" class="mt-2 w-full gap-2" size="lg" onclick={confirmSkip}>
                  <CircleMinus class="h-4 w-4" /> Skip question
                </Button>
              {/if}
            </div>
          {/if}
        </div>
        {#if panel === "standings" && settings.showLeaderboard}
          {@const self = leaderboard.find((entry) => entry.playerId === publicPlayerId)}
          <aside class="mathex-panel mt-4 p-4" aria-label="Live standings">
            <h2 class="font-semibold">Live standings</h2>
            <p class="mt-1 text-xs text-muted-foreground">Correct answers first, then elapsed time.</p>
            <div class="relative mt-3">
              {#if self && selfPinned}<div
                  class="absolute inset-x-0 z-10 {selfPinned === 'top' ? 'top-0' : 'bottom-0'}"
                  aria-hidden="true"
                >
                  {@render standingsRow(self, true)}
                </div>{/if}
              <div
                bind:this={standingsContainer}
                onscroll={pinSelf}
                aria-live="polite"
                class="flex max-h-96 flex-col gap-2 overflow-y-auto scrollbar-thin"
              >
                {#each leaderboard as entry (entry.playerId)}{@render standingsRow(
                    entry,
                    entry.playerId === publicPlayerId
                  )}{:else}<p class="text-sm text-muted-foreground">No standings yet.</p>{/each}
              </div>
            </div>
          </aside>
        {:else if panel === "chat" && settings.allowChat}
          <aside class="mathex-panel mt-4 p-4" aria-label="Player chat">
            <h2 class="font-semibold">Player chat</h2>
            <p class="mt-1 text-xs text-muted-foreground">The host can read and moderate messages.</p>
            <div
              bind:this={chatContainer}
              role="log"
              aria-live="polite"
              aria-label="Chat messages"
              class="mt-3 flex max-h-80 min-h-32 flex-col gap-2 overflow-y-auto scrollbar-thin"
            >
              {#each chat as message (message.id)}<div
                  class="border border-border p-2 {message.playerId === publicPlayerId ? 'bg-accent' : 'bg-muted/30'}"
                >
                  <p class="text-xs font-semibold">{message.name}</p>
                  <p class="break-words text-sm">{message.text}</p>
                </div>{:else}<p class="text-sm text-muted-foreground">No messages yet.</p>{/each}
            </div>
            {#if muted}<p class="mt-3 text-sm text-muted-foreground">The host has muted your chat.</p>{/if}
            <form
              class="mt-3 flex gap-2"
              onsubmit={(event) => {
                event.preventDefault();
                sendChat();
              }}
            >
              <Input
                aria-label="Chat message"
                placeholder="Message the room"
                maxlength={500}
                bind:value={chatDraft}
                disabled={muted}
              /><Button type="submit" size="icon" aria-label="Send message" disabled={muted || !chatDraft.trim()}
                ><Send class="h-4 w-4" /></Button
              >
            </form>
          </aside>
        {/if}
      </div>
    </div>
  {:else if gameState === "finished"}
    <div class="flex min-h-[calc(100vh-3rem)] flex-1 items-center justify-center">
      <div class="mathex-panel w-full max-w-md p-7 text-center sm:p-9">
        <div class="mx-auto flex h-14 w-14 items-center justify-center bg-accent text-primary">
          <CircleCheckBig class="h-7 w-7" />
        </div>
        <p class="mathex-kicker mt-5">Round complete</p>
        <Header size="h1" class="mt-2 text-4xl tracking-[-0.04em]">Finished</Header>
        {#if leaderboard.length > 0}
          {@const myEntry = leaderboard.find((e) => e.playerId === publicPlayerId)}
          {#if myEntry}
            <div class="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary/10 px-4 py-2">
              <span class="text-lg font-bold text-primary">#{myEntry.rank}</span>
              <span class="text-sm text-muted-foreground">
                &middot; {myEntry.totalMs !== null ? msToMinutesAndSeconds(myEntry.totalMs) : "DNF"} &middot;
                {myEntry.correctCount}/{myEntry.totalQuestions} correct
              </span>
            </div>
          {/if}
          <div class="mt-4 flex flex-col gap-1.5 text-left">
            {#each leaderboard as entry (entry.playerId)}
              <div
                class="flex items-center gap-2 rounded-lg border border-border/60 p-2 {entry.playerId === publicPlayerId
                  ? 'bg-primary/5 border-primary/20'
                  : 'bg-muted/30'}"
              >
                <RankBadge rank={entry.rank} class="h-6 w-6" />
                <span class="truncate text-sm font-medium {entry.playerId === publicPlayerId ? 'text-primary' : ''}"
                  >{entry.name}</span
                >
                <span class="ml-auto shrink-0 text-xs text-muted-foreground">
                  {entry.totalMs !== null ? msToMinutesAndSeconds(entry.totalMs) : "Not started"} &middot; {entry.correctCount}/{entry.totalQuestions}
                  correct
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
  {:else if gameState === "kicked"}
    <div class="mx-auto flex min-h-[calc(100vh-3rem)] max-w-md items-center">
      <div class="mathex-panel p-7">
        <UserX class="h-8 w-8 text-destructive" /><Header size="h1" class="mt-4 text-3xl">Removed by the host</Header>
        <p class="mt-3 text-muted-foreground">
          Your entry was removed. You can join again if the host allows late joining.
        </p>
        <Button
          class="mt-5"
          onclick={() => {
            kicked = false;
            name = "";
            playerId = "";
            gameState = "connecting";
            socket.connect();
          }}>Join again</Button
        ><Button href="/mathex/app" variant="outline" class="ml-2 mt-5">Competition home</Button>
      </div>
    </div>
  {/if}
</div>

<Calculator open={calcOpen && gameState === "started" && settings.allowCalculator} onclose={() => (calcOpen = false)} />
<SketchPad
  open={sketchOpen && gameState === "started" && settings.allowSketch}
  storageKey={`mathex-sketch-${roomId}`}
  onclose={() => (sketchOpen = false)}
/>

<style>
  .question-content :global(img) {
    max-width: 100%;
    max-height: 32rem;
    margin-inline: auto;
    border-radius: 0.5rem;
  }
</style>
