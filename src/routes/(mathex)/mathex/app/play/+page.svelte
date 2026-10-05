<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Header } from "$lib/components/ui/header";
  import * as InputOTP from "$lib/components/ui/input-otp";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import KeyRound from "@lucide/svelte/icons/key-round";
  import UsersRound from "@lucide/svelte/icons/users-round";
  import { toast } from "svelte-sonner";
  import { REGEXP_ONLY_DIGITS } from "bits-ui";

  import { goto } from "$app/navigation";

  import { io, type Socket } from "socket.io-client";
  import type { RoomCreateClientToServerEvents, RoomCreateServerToClientEvents } from "$lib/mathex/schemas";
  const socket: Socket<RoomCreateServerToClientEvents, RoomCreateClientToServerEvents> = io("/rooms");
  $effect(() => () => { socket.disconnect(); });

  let code: string = $state("");
  let lastCode: string = "";
  async function setCode(newCode: string) {
    code = newCode;
    if (code.length === 6 && lastCode !== code) {
      lastCode = code;
      toast.promise(
         socket.timeout(5000).emitWithAck("checkRoom", code).then((exists) => {
           if (!exists) { lastCode = ""; throw new Error("Room does not exist"); }
         }).catch((error) => { lastCode = ""; throw error; }),
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

<div class="mathex-shell relative flex min-h-full items-center justify-center overflow-hidden px-3 py-8 sm:px-6">
  <div class="mathex-grid pointer-events-none absolute inset-0 opacity-70"></div>
  <main class="relative w-full max-w-lg">
    <a
      href="/mathex/app"
      class="mb-10 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      ><ArrowLeft class="h-4 w-4" /> Competition home</a
    >
    <div class="mathex-panel p-6 sm:p-9">
      <div class="flex h-12 w-12 items-center justify-center bg-primary text-primary-foreground">
        <KeyRound class="h-6 w-6" />
      </div>
      <p class="mathex-kicker mt-7">Join a competition</p>
      <Header size="h1" class="mt-2 text-4xl tracking-[-0.04em]">Enter the room code</Header>
      <p class="mt-3 leading-7 text-muted-foreground">
        Your host has a 6-digit access code. Enter it below to join the competition lobby.
      </p>
      <div class="mt-8 border border-border bg-background p-4 sm:p-5">
        <p class="mb-3 text-sm font-semibold text-muted-foreground">Six-digit room code</p>
        <InputOTP.Root maxlength={6} spellcheck="false" pattern={REGEXP_ONLY_DIGITS} bind:value={() => code, setCode}>
          {#snippet children({ cells })}
            <div class="flex w-full justify-between gap-1.5 sm:gap-2">
              {#each cells as cell (cell)}
                <InputOTP.Group>
                  <InputOTP.Slot
                    class="h-11 w-8 border-border bg-muted/60 text-base font-bold text-foreground sm:h-14 sm:w-11 sm:text-xl"
                    {cell}
                  />
                </InputOTP.Group>
              {/each}
            </div>
          {/snippet}
        </InputOTP.Root>
      </div>
      <div class="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
        <UsersRound class="h-4 w-4 text-primary" /> You will choose a display name next.
      </div>
    </div>
  </main>
</div>
