<script lang="ts">
  import { goto } from "$app/navigation";
  import { Button } from "$lib/components/ui/button";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Header } from "$lib/components/ui/header";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import type {
    PhysicalCreateClientToServerEvents,
    PhysicalCreateServerToClientEvents
  } from "$lib/mathex/physical.schemas";
  import { ArrowLeft, Clock3, Radio, ShieldCheck, UsersRound } from "@lucide/svelte/icons";
  import { io, type Socket } from "socket.io-client";
  import { toast } from "svelte-sonner";
  import TeamEditor, { type EditableTeam } from "./TeamEditor.svelte";

  const socket: Socket<PhysicalCreateServerToClientEvents, PhysicalCreateClientToServerEvents> = io("/physical");

  let name = $state("");
  let questionCount = $state(20);
  let timerEnabled = $state(true);
  let timerMinutes = $state(30);
  let markerPin = $state("");
  let creating = $state(false);
  let teams: EditableTeam[] = $state([
    { id: crypto.randomUUID(), name: "Team 1", group: "" },
    { id: crypto.randomUUID(), name: "Team 2", group: "" },
    { id: crypto.randomUUID(), name: "Team 3", group: "" },
    { id: crypto.randomUUID(), name: "Team 4", group: "" }
  ]);

  const validTeams = $derived(teams.filter((team) => team.name.trim()));
  const canCreate = $derived(
    name.trim().length >= 3 &&
      questionCount >= 1 &&
      questionCount <= 200 &&
      (!timerEnabled || timerMinutes >= 1) &&
      /^\d{4,12}$/.test(markerPin) &&
      validTeams.length > 0 &&
      !creating
  );

  socket.on("error", (message) => {
    creating = false;
    toast.error(message);
  });
  socket.on("goto", (path) => {
    socket.disconnect();
    goto(path);
  });

  function createCompetition() {
    if (!canCreate) return;
    creating = true;
    socket.emit(
      "createCompetition",
      {
        name: name.trim(),
        questionCount,
        countdownDurationMs: timerEnabled ? timerMinutes * 60_000 : null,
        markerPin,
        teams: validTeams.map((team) => ({ name: team.name.trim(), group: team.group.trim() }))
      },
      (result) => {
        if (!result.ok) {
          creating = false;
          toast.error(result.error);
        }
      }
    );
  }
</script>

<svelte:head><title>Set up Mathex Live</title></svelte:head>

<div class="mathex-shell min-h-full px-4 py-5 sm:px-8 sm:py-8">
  <main class="mx-auto w-full max-w-6xl">
    <a
      href="/mathex/app"
      class="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft class="h-4 w-4" /> Competition home
    </a>
    <div class="mt-9 grid gap-8 lg:grid-cols-[0.7fr_1.3fr] lg:items-start">
      <section class="lg:sticky lg:top-8">
        <p class="mathex-kicker">Physical event mode</p>
        <Header size="h1" class="mt-2 text-4xl leading-none tracking-[-0.04em] sm:text-5xl">
          Put the room<br /><span class="text-primary">on the board.</span>
        </Header>
        <p class="mt-5 max-w-sm leading-7 text-muted-foreground">
          Teams solve on paper while markers record progress. No questions or answers are stored here.
        </p>
        <div class="mt-8 grid max-w-sm gap-3 text-sm">
          <div class="flex gap-3">
            <Radio class="mt-0.5 h-4 w-4 text-primary" /><span>A public, projector-safe live scoreboard</span>
          </div>
          <div class="flex gap-3">
            <UsersRound class="mt-0.5 h-4 w-4 text-primary" /><span>Team and group views for busy marking desks</span>
          </div>
          <div class="flex gap-3">
            <ShieldCheck class="mt-0.5 h-4 w-4 text-primary" /><span>Separate host token and marker PIN access</span>
          </div>
        </div>
      </section>

      <form
        class="space-y-4"
        onsubmit={(event) => {
          event.preventDefault();
          createCompetition();
        }}
      >
        <section class="mathex-panel rounded-3xl p-5 sm:p-7">
          <div>
            <p class="mathex-kicker">Competition details</p>
            <h2 class="mt-1 text-2xl font-bold">The essentials</h2>
          </div>
          <div class="mt-6 grid gap-5 sm:grid-cols-2">
            <div class="sm:col-span-2">
              <Label for="competition-name">Competition name</Label>
              <Input
                id="competition-name"
                class="mt-2 h-11"
                bind:value={name}
                maxlength={80}
                placeholder="e.g. Year 8 Mathex final"
                autofocus
              />
            </div>
            <div>
              <Label for="question-count">Number of questions</Label>
              <Input id="question-count" class="mt-2 h-11" type="number" min="1" max="200" bind:value={questionCount} />
            </div>
            <div>
              <Label for="marker-pin">Marker PIN</Label>
              <Input
                id="marker-pin"
                class="mt-2 h-11 font-mono tracking-[0.25em]"
                type="password"
                inputmode="numeric"
                pattern={"[0-9]{4,12}"}
                maxlength={12}
                bind:value={markerPin}
                placeholder="4-12 digits"
              />
            </div>
          </div>
          <div class="mt-5 rounded-2xl border border-border/70 bg-background/55 p-4">
            <label class="flex cursor-pointer items-center gap-3 font-semibold">
              <Checkbox bind:checked={timerEnabled} />
              <Clock3 class="h-4 w-4 text-primary" /> Use a competition timer
            </label>
            {#if timerEnabled}
              <div class="mt-4 max-w-48">
                <Label for="timer">Minutes</Label><Input
                  id="timer"
                  class="mt-2"
                  type="number"
                  min="1"
                  max="600"
                  bind:value={timerMinutes}
                />
              </div>
            {/if}
          </div>
        </section>

        <section class="mathex-panel rounded-3xl p-5 sm:p-7">
          <div class="mb-5 flex items-end justify-between gap-4">
            <div>
              <p class="mathex-kicker">Teams</p>
              <h2 class="mt-1 text-2xl font-bold">Starting roster</h2>
            </div>
            <span class="text-sm tabular-nums text-muted-foreground">{validTeams.length} ready</span>
          </div>
          <TeamEditor bind:teams disabled={creating} />
        </section>

        <Button type="submit" size="lg" class="h-12 w-full text-base shadow-lg shadow-primary/20" disabled={!canCreate}>
          {creating ? "Creating dashboard..." : "Create live dashboard"}
        </Button>
      </form>
    </div>
  </main>
</div>
