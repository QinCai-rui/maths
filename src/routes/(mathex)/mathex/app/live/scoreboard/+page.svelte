<script lang="ts">
  import RoomCodeEntry from "$lib/mathex/RoomCodeEntry.svelte";
  import { Radio, UsersRound } from "@lucide/svelte/icons";
</script>

<svelte:head><title>Scoreboard - Mathex Live</title></svelte:head>

<RoomCodeEntry
  namespace="/physical"
  checkEvent="checkCompetition"
  hrefBase="/mathex/app/live/scoreboard/"
  backHref="/mathex/app/live"
  backLabel="Live dashboard setup"
  kicker="Public display"
  title="Enter the event code"
  description="Enter the six-digit live competition code to show its projector-safe standings."
  fieldLabel="Six-digit event code"
  hint="No PIN is required for the public scoreboard."
  errorMessage="That live competition does not exist. Check the room code and try again."
>
  {#snippet icon()}<Radio class="h-6 w-6" />{/snippet}
  {#snippet hintIcon()}<UsersRound class="h-4 w-4 text-primary" />{/snippet}
</RoomCodeEntry>
