<script lang="ts">
  import { goto } from "$app/navigation";
  import { Checkbox } from "#lib/components/ui/checkbox/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Label } from "#lib/components/ui/label/index.js";
  import type {
    PhysicalCreateClientToServerEvents,
    PhysicalCreateServerToClientEvents
  } from "#lib/mathex/physical.schemas.js";
  import { ArrowLeft } from "@lucide/svelte/icons";
  import type { Socket } from "socket.io-client";
  import { io } from "#lib/mathex/connection.js";
  import { toast } from "svelte-sonner";
  import TeamEditor, { type EditableTeam } from "./TeamEditor.svelte";

  const socket: Socket<PhysicalCreateServerToClientEvents, PhysicalCreateClientToServerEvents> = io("/physical");
  $effect(() => () => socket.disconnect());

  let name = $state("");
  let questionCount = $state(20);
  let timerEnabled = $state(true);
  let timerMinutes = $state(30);
  let autoFinishWhenComplete = $state(false);
  const markerPinCharacters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const createMarkerPin = () => {
    const values = crypto.getRandomValues(new Uint32Array(8));
    return Array.from(values, (value) => markerPinCharacters[value % markerPinCharacters.length]).join("");
  };

  let markerPin = $state(createMarkerPin());
  let creating = $state(false);
  let teams: EditableTeam[] = $state([
    { id: crypto.randomUUID(), name: "Team 1", group: "" },
    { id: crypto.randomUUID(), name: "Team 2", group: "" },
    { id: crypto.randomUUID(), name: "Team 3", group: "" },
    { id: crypto.randomUUID(), name: "Team 4", group: "" }
  ]);

  const validTeams = $derived(teams.filter((team) => team.name.trim()));
  const duplicateTeamName = $derived.by(() => {
    const names = validTeams.map((team) => team.name.trim());
    const lowered = names.map((name) => name.toLocaleLowerCase());
    const clash = lowered.find((name, index) => lowered.indexOf(name) !== index);
    return clash === undefined ? null : (names[lowered.indexOf(clash)] ?? clash);
  });
  const canCreate = $derived(
    name.trim().length >= 3 &&
      questionCount >= 1 &&
      questionCount <= 200 &&
      (!timerEnabled || timerMinutes >= 1) &&
      /^(?:[A-Z0-9]{8}|\d{4,12})$/.test(markerPin) &&
      validTeams.length > 0 &&
      duplicateTeamName === null &&
      !creating
  );

  const blocker = $derived(
    name.trim().length < 3
      ? "Add a competition name of at least 3 characters."
      : !(questionCount >= 1 && questionCount <= 200)
        ? "Set between 1 and 200 questions."
        : timerEnabled && !(timerMinutes >= 1)
          ? "Set the timer to at least 1 minute."
          : !/^(?:[A-Z0-9]{8}|\d{4,12})$/.test(markerPin)
            ? "The marker PIN needs 8 letters or digits, or 4 to 12 digits."
            : validTeams.length === 0
              ? "Add at least one team."
              : duplicateTeamName !== null
                ? "Team names must be unique."
                : ""
  );

  socket.on("error", (message) => {
    creating = false;
    toast.error(message);
  });
  socket.on("disconnect", () => (creating = false));
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
        autoFinishWhenComplete,
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

<main class="setup">
  <a href="/mathex/app" class="setup-back"><ArrowLeft class="h-4 w-4" /> Competition home</a>
  <header class="setup-head">
    <p class="mathex-kicker">Mathex Live</p>
    <h1 class="lv-title">Set up an in-person event</h1>
    <p class="setup-lede lv-soft">
      Teams solve on paper and run their answers to a marker. Markers record each answer and the room follows the
      scoreboard. No questions or answers are stored here.
    </p>
  </header>

  <form
    class="setup-grid"
    onsubmit={(event) => {
      event.preventDefault();
      createCompetition();
    }}
  >
    <div class="setup-form">
      <section aria-labelledby="setup-event">
        <h2 id="setup-event" class="lv-h2">Event</h2>
        <div class="setup-fields">
          <div class="setup-wide">
            <Label for="competition-name" class="lv-label">Competition name</Label>
            <Input
              id="competition-name"
              bind:value={name}
              maxlength={80}
              placeholder="e.g. Year 8 Mathex final"
              autofocus
            />
          </div>
          <div>
            <Label for="question-count" class="lv-label">Number of questions</Label>
            <Input id="question-count" type="number" min="1" max="200" bind:value={questionCount} />
          </div>
        </div>
      </section>

      <section aria-labelledby="setup-clock">
        <h2 id="setup-clock" class="lv-h2">Clock</h2>
        <label class="setup-check">
          <Checkbox bind:checked={timerEnabled} />
          <span>
            <span class="setup-check-name">Use a competition timer</span>
            <span class="lv-soft lv-small">Counts down on every screen. Without it the clock counts up.</span>
          </span>
        </label>
        {#if timerEnabled}
          <div class="setup-minutes">
            <Label for="timer" class="lv-label">Minutes</Label>
            <Input id="timer" type="number" min="1" max="600" bind:value={timerMinutes} />
          </div>
        {/if}
        <label class="setup-check">
          <Checkbox bind:checked={autoFinishWhenComplete} />
          <span>
            <span class="setup-check-name">Automatically finish when all teams are done</span>
            <span class="lv-soft lv-small">End marking as soon as every team completes the final question.</span>
          </span>
        </label>
      </section>

      <section aria-labelledby="setup-pin">
        <h2 id="setup-pin" class="lv-h2">Marker PIN</h2>
        <p class="lv-soft lv-small">Markers enter this to open the marker desk. Share it only with them.</p>
        <div class="setup-pin">
          <Input
            id="marker-pin"
            aria-labelledby="setup-pin"
            aria-describedby="marker-pin-hint"
            class="lv-code"
            type="text"
            autocapitalize="characters"
            autocomplete="one-time-code"
            inputmode="text"
            pattern={"(?:[A-Z0-9]{8}|\\d{4,12})"}
            maxlength={12}
            bind:value={markerPin}
            oninput={() =>
              (markerPin = markerPin
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, "")
                .slice(0, 12))}
          />
          <button type="button" class="lbtn lbtn-quiet lbtn-sm" onclick={() => (markerPin = createMarkerPin())}
            >Generate a new PIN</button
          >
        </div>
        <p id="marker-pin-hint" class="lv-hint">8 letters or digits, or 4 to 12 digits.</p>
      </section>

      <section aria-labelledby="setup-teams">
        <h2 id="setup-teams" class="lv-h2">Teams</h2>
        <p class="lv-soft lv-small">
          Teams in the same group are ranked against each other. You can edit the roster later from the host console.
        </p>
        {#if duplicateTeamName !== null}
          <p class="lv-alert lv-small mt-2" role="alert">
            Team names must be unique. “{duplicateTeamName}” appears more than once.
          </p>
        {/if}
        <div class="mt-3"><TeamEditor bind:teams disabled={creating} /></div>
      </section>
    </div>

    <aside class="setup-side">
      <div class="setup-summary">
        <h2 class="lv-h2">{name.trim() || "Your event"}</h2>
        <dl>
          <div>
            <dt>Teams</dt>
            <dd>{validTeams.length}</dd>
          </div>
          <div>
            <dt>Questions</dt>
            <dd>{questionCount || 0}</dd>
          </div>
          <div>
            <dt>Clock</dt>
            <dd>{timerEnabled ? `${timerMinutes || 0} min` : "Counts up"}</dd>
          </div>
        </dl>
        <button type="submit" class="lbtn lbtn-solid setup-create" disabled={!canCreate}>
          {creating ? "Creating dashboard..." : "Create live dashboard"}
        </button>
        {#if blocker && !creating}<p class="setup-blocker">{blocker}</p>{/if}
        <p class="setup-next">
          You land on the host console, a private link. From there you open the marker desk and the projector
          scoreboard, which use a six-digit event code.
        </p>
      </div>
      <div class="setup-join">
        <h2>Already have an event code?</h2>
        <a href="/mathex/app/live/marker">Open the marker desk</a>
        <a href="/mathex/app/live/scoreboard">Show the scoreboard</a>
      </div>
    </aside>
  </form>
</main>

<style>
  .setup {
    width: min(1120px, 100%);
    margin-inline: auto;
    padding: 1.5rem clamp(1rem, 4vw, 2.5rem) 4rem;
  }
  .setup-back {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--lv-ink-soft);
    font-size: 0.875rem;
    font-weight: 600;
  }
  .setup-back:hover {
    color: var(--lv-ink);
  }
  .setup-head {
    margin-top: 2rem;
    padding-bottom: 1.5rem;
    border-bottom: 2px solid var(--lv-ink);
  }
  .setup-head h1 {
    margin-top: 0.5rem;
    font-size: clamp(2.25rem, 5vw, 3rem);
    font-weight: 800;
    letter-spacing: -0.04em;
  }
  .setup-lede {
    max-width: 38rem;
    margin-top: 0.9rem;
    font-size: 1.0625rem;
  }
  .setup-grid {
    display: grid;
    gap: 2.5rem;
  }
  .setup-form section {
    padding-block: 1.5rem 1.75rem;
    border-bottom: 1px solid var(--lv-line);
  }
  .setup-form section:last-child {
    border-bottom: 0;
  }
  .setup-fields {
    display: grid;
    gap: 1rem;
    margin-top: 0.9rem;
  }
  .setup-check {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    margin-top: 0.9rem;
    cursor: pointer;
  }
  .setup-check :global([data-slot="checkbox"]) {
    margin-top: 0.2rem;
    border-color: var(--input);
  }
  .setup-check span span {
    display: block;
  }
  .setup-check-name {
    font-weight: 600;
  }
  .setup-minutes {
    width: 9rem;
    margin: 0.75rem 0 0.25rem 1.75rem;
  }
  .setup-pin {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .setup-pin :global([data-slot="input"]) {
    width: 13rem;
    font-size: 1.25rem;
  }
  .setup-summary {
    padding: 1.25rem;
    border: 1px solid var(--lv-line);
    border-radius: 4px;
    background: var(--lv-surface);
    box-shadow: 0 1px 2px rgb(25 28 22 / 5%);
  }
  .setup-summary h2 {
    overflow-wrap: anywhere;
  }
  .setup-summary dl {
    display: grid;
    grid-template-columns: repeat(3, auto);
    justify-content: space-between;
    gap: 1rem;
    margin-top: 1rem;
  }
  .setup-summary dt {
    color: var(--lv-ink-soft);
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .setup-summary dd {
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1.1;
    white-space: nowrap;
  }
  .setup-create {
    width: 100%;
    min-height: 2.75rem;
    margin-top: 1.25rem;
    font-size: 1rem;
  }
  .setup-blocker {
    margin-top: 0.6rem;
    color: var(--lv-warn);
    font-size: 0.875rem;
    font-weight: 600;
  }
  .setup-next {
    margin-top: 0.9rem;
    color: var(--lv-ink-soft);
    font-size: 0.875rem;
  }
  .setup-join {
    display: grid;
    justify-items: start;
    gap: 0.35rem;
    margin-top: 1.5rem;
  }
  .setup-join h2 {
    font-weight: 700;
  }
  .setup-join a {
    font-weight: 600;
    color: var(--primary);
    font-size: 0.9375rem;
  }
  .setup-join a:hover {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
  @media (min-width: 40rem) {
    .setup-fields {
      grid-template-columns: minmax(0, 1fr) 11rem;
    }
  }
  @media (min-width: 62rem) {
    .setup-grid {
      grid-template-columns: minmax(0, 1fr) 21rem;
      column-gap: 4rem;
      align-items: start;
    }
    .setup-side {
      position: sticky;
      top: 1.5rem;
      padding-top: 1.5rem;
    }
  }
</style>
