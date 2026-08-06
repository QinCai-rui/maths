<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Header } from "$lib/components/ui/header";
  import * as InputOTP from "$lib/components/ui/input-otp";
  import MoveLeft from "@lucide/svelte/icons/move-left";
  import { toast } from "svelte-sonner";
  import { REGEXP_ONLY_DIGITS_AND_CHARS } from "bits-ui";

  import { goto } from "$app/navigation";

  import { io, type Socket } from "socket.io-client";
  import type { RoomCreateClientToServerEvents, RoomCreateServerToClientEvents } from "$lib/mathex/schemas";
  const socket: Socket<RoomCreateServerToClientEvents, RoomCreateClientToServerEvents> = io("/rooms");

  let code: string = $state("");
  let lastCode: string = "";
  async function setCode(newCode: string) {
    code = newCode.toUpperCase();
    if (code.length === 8 && lastCode !== code) {
      lastCode = code;
      toast.promise(
        new Promise<void>(async (resolve, reject) => {
          if (await socket.emitWithAck("checkRoom", code)) {
            resolve();
          } else reject();
        }),
        {
          loading: "Loading...",
          success() {
            socket.disconnect();
            goto("/mathex/app/play/" + code);
            return "Going to room...";
          },
          error: "That room does not exist! Try typing the room ID again."
        }
      );
    }
  }
</script>

<div class="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
  <div class="text-center">
    <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
      <svg class="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M15 7h.01M15 12h.01M15 17h.01M4 7h.01M4 12h.01M4 17h.01M8 7h.01M8 12h.01M8 17h.01"
        />
      </svg>
    </div>
    <Header size="h1">Join Room</Header>
    <p class="mt-2 text-muted-foreground">Enter the 8-character room code provided by your host.</p>
  </div>

  <div class="flex gap-2 mt-2">
    <InputOTP.Root
      maxlength={8}
      spellcheck="false"
      pattern={REGEXP_ONLY_DIGITS_AND_CHARS}
      bind:value={() => code, setCode}
    >
      {#snippet children({ cells })}
        {#each cells as cell (cell)}
          <InputOTP.Group>
            <InputOTP.Slot class="bg-muted text-foreground border-border" {cell} />
          </InputOTP.Group>
        {/each}
      {/snippet}
    </InputOTP.Root>
  </div>

  <Button variant="ghost" href="/mathex/app" class="gap-2">
    <MoveLeft class="h-4 w-4" />
    Back to home
  </Button>
</div>
