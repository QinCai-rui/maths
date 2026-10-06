<script lang="ts">
  import { Checkbox } from "#lib/components/ui/checkbox/index.js";
  import { Label } from "#lib/components/ui/label/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as AlertDialog from "#lib/components/ui/alert-dialog/index.js";
  import { CHAT_DISCLAIMER, dismissChatDisclaimer, hasDismissedChatDisclaimer } from "./chat-disclaimer";
  import type { RoomSettings } from "./schemas";
  import { msToMinutesAndSeconds } from "#lib/utils.js";

  let {
    settings,
    onchange,
    ontimer,
    endsAt = null,
    live = false,
    uid
  }: {
    settings: RoomSettings;
    onchange: (change: Partial<RoomSettings>) => void;
    ontimer: (minutes: number | null) => void;
    endsAt?: number | null;
    live?: boolean;
    uid: string;
  } = $props();
  let minutes = $state(5);
  let now = $state(Date.now());
  let dialogOpen = $state(false);
  let remember = $state(false);
  let chatKey = $state(0);
  let chatConfirmed = false;
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });
  const toggles = [
    { key: "allowLateJoin", label: "Allow late joining", description: "Existing players can always reconnect." },
    {
      key: "endOnPerfectScore",
      label: "End when someone answers all questions correctly",
      description: "Wrong attempts are allowed. Skipped questions do not count."
    },
    { key: "showLeaderboard", label: "Live standings", description: "Players can see scores beside the question." },
    {
      key: "allowCalculator",
      label: "Calculator",
      description: "A scientific calculator with degree and radian modes."
    },
    { key: "allowSketch", label: "Sketch pad", description: "Players can draw and add notes over the question." }
  ] as const;
  function toggleChat(checked: boolean) {
    if (!checked || hasDismissedChatDisclaimer()) onchange({ allowChat: checked });
    else {
      remember = false;
      dialogOpen = true;
    }
  }
</script>

<div class="space-y-4">
  <div class="border border-border p-3">
    <Label for="timer-{uid}">Game timer</Label>
    <p class="mt-1 text-sm text-muted-foreground" aria-live="off">
      {#if live && endsAt !== null}Time left: {msToMinutesAndSeconds(Math.max(0, endsAt - now))}
      {:else if !live && settings.gameTimerMs}Configured: {msToMinutesAndSeconds(settings.gameTimerMs)}
      {:else}No timer{/if}
    </p>
    <div class="mt-2 flex flex-wrap gap-2">
      <Input
        id="timer-{uid}"
        aria-label="Game length in minutes"
        type="number"
        min={0.5}
        max={480}
        step={0.5}
        bind:value={minutes}
        class="w-24"
      />
      <Button
        type="button"
        size="sm"
        disabled={!Number.isFinite(minutes) || minutes <= 0}
        onclick={() => ontimer(minutes)}>Set timer</Button
      >
      <Button type="button" size="sm" variant="outline" onclick={() => ontimer(null)}>Remove timer</Button>
    </div>
    <p class="mt-2 text-xs text-muted-foreground">
      {live
        ? "Sets a new deadline in minutes from now."
        : "Minutes for the whole game. Starts when the host begins the round."}
    </p>
  </div>
  {#each toggles as toggle}
    <div class="flex items-start gap-3">
      <Checkbox
        id="{uid}-{toggle.key}"
        checked={settings[toggle.key]}
        onCheckedChange={(checked) => onchange({ [toggle.key]: checked === true })}
      />
      <div>
        <Label for="{uid}-{toggle.key}" class="cursor-pointer">{toggle.label}</Label>
        <p class="mt-1 text-xs text-muted-foreground">{toggle.description}</p>
      </div>
    </div>
  {/each}
  <div class="flex items-start gap-3">
    {#key chatKey}<Checkbox
        id="{uid}-chat"
        checked={settings.allowChat}
        onCheckedChange={(checked) => toggleChat(checked === true)}
      />{/key}
    <div>
      <Label for="{uid}-chat" class="cursor-pointer">Player chat</Label>
      <p class="mt-1 text-xs text-muted-foreground">Hosts can read messages, delete them, and mute players.</p>
    </div>
  </div>
</div>

<AlertDialog.Root
  bind:open={dialogOpen}
  onOpenChange={(open) => {
    if (!open && !chatConfirmed) chatKey++;
    chatConfirmed = false;
  }}
>
  <AlertDialog.Content>
    <AlertDialog.Header
      ><AlertDialog.Title>Enable player chat?</AlertDialog.Title><AlertDialog.Description
        >{CHAT_DISCLAIMER}</AlertDialog.Description
      ></AlertDialog.Header
    >
    <div class="flex items-center gap-2">
      <Checkbox id="{uid}-remember-chat" bind:checked={remember} /><Label for="{uid}-remember-chat"
        >Don't show this again</Label
      >
    </div>
    <AlertDialog.Footer
      ><AlertDialog.Cancel>Cancel</AlertDialog.Cancel><AlertDialog.Action
        onclick={() => {
          if (remember) dismissChatDisclaimer();
          chatConfirmed = true;
          onchange({ allowChat: true });
          dialogOpen = false;
        }}>Enable chat</AlertDialog.Action
      ></AlertDialog.Footer
    >
  </AlertDialog.Content>
</AlertDialog.Root>
