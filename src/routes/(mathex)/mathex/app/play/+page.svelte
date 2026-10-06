<script lang="ts">
  import RoomCodeEntry from "#lib/mathex/RoomCodeEntry.svelte";
  import KeyRound from "@lucide/svelte/icons/key-round";
  import UsersRound from "@lucide/svelte/icons/users-round";
</script>

<RoomCodeEntry
  namespace="/rooms"
  checkEvent="checkRoom"
  hrefBase="/mathex/app/play/"
  backHref="/mathex/app"
  backLabel="Competition home"
  kicker="Join a competition"
  title="Enter the room code"
  description="Your host has a 6-digit access code. Enter it below to join the competition lobby."
  fieldLabel="Six-digit room code"
  hint="You will choose a display name next."
  errorMessage="That room does not exist! Try typing the room code again."
>
  {#snippet icon()}<KeyRound class="h-6 w-6" />{/snippet}
  {#snippet hintIcon()}<UsersRound class="h-4 w-4 text-primary" />{/snippet}
</RoomCodeEntry>
