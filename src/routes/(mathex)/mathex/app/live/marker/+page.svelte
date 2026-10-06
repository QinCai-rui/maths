<script lang="ts">
  import RoomCodeEntry from "$lib/mathex/RoomCodeEntry.svelte";
  import { KeyRound, ShieldCheck } from "@lucide/svelte/icons";
</script>

<svelte:head><title>Marker Desk - Mathex Live</title></svelte:head>

<RoomCodeEntry
  namespace="/physical"
  checkEvent="checkCompetition"
  hrefBase="/mathex/app/live/marker/"
  backHref="/mathex/app/live"
  backLabel="Live dashboard setup"
  kicker="Marker access"
  title="Enter the event code"
  description="Enter the six-digit live competition code, then use the marker PIN."
  fieldLabel="Six-digit event code"
  hint="The marker PIN is requested on the next screen."
  errorMessage="That live competition does not exist. Check the room code and try again."
>
  {#snippet icon()}<ShieldCheck class="h-6 w-6" />{/snippet}
  {#snippet hintIcon()}<KeyRound class="h-4 w-4 text-primary" />{/snippet}
</RoomCodeEntry>
