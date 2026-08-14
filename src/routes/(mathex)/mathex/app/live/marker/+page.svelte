<script lang="ts">
  import { goto } from "$app/navigation";
  import { Header } from "$lib/components/ui/header";
  import * as InputOTP from "$lib/components/ui/input-otp";
  import type {
    PhysicalCreateClientToServerEvents,
    PhysicalCreateServerToClientEvents
  } from "$lib/mathex/physical.schemas";
  import { ArrowLeft, KeyRound, ShieldCheck } from "@lucide/svelte/icons";
  import { REGEXP_ONLY_DIGITS } from "bits-ui";
  import { io, type Socket } from "socket.io-client";
  import { toast } from "svelte-sonner";

  const socket: Socket<PhysicalCreateServerToClientEvents, PhysicalCreateClientToServerEvents> = io("/physical");
  let code = $state("");
  let lastCode = "";

  async function setCode(value: string) {
    code = value;
    if (code.length !== 6 || lastCode === code) return;
    lastCode = code;
    if (await socket.emitWithAck("checkCompetition", code)) {
      socket.disconnect();
      goto(`/mathex/app/live/marker/${code}`);
    } else {
      lastCode = "";
      toast.error("That live competition does not exist. Check the room code and try again.");
    }
  }
</script>

<svelte:head><title>Marker Desk - Mathex Live</title></svelte:head>

<div class="mathex-shell relative flex min-h-full items-center justify-center overflow-hidden p-4">
  <div class="mathex-grid pointer-events-none absolute inset-0 opacity-70"></div>
  <main class="relative w-full max-w-lg">
    <a
      href="/mathex/app/live"
      class="mb-10 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft class="h-4 w-4" /> Live dashboard setup
    </a>
    <section class="mathex-panel rounded-3xl p-6 sm:p-9">
      <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"
        ><ShieldCheck class="h-6 w-6" /></span
      >
      <p class="mathex-kicker mt-7">Marker desk</p>
      <Header size="h1" class="mt-2 text-4xl tracking-[-0.04em]">Enter the room.</Header>
      <p class="mt-3 leading-7 text-muted-foreground">
        Enter the six-digit live competition code, then use the marker PIN.
      </p>
      <div class="mt-8 rounded-2xl border border-border/70 bg-background/55 p-4 sm:p-5">
        <p class="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Room code</p>
        <InputOTP.Root maxlength={6} spellcheck="false" pattern={REGEXP_ONLY_DIGITS} bind:value={() => code, setCode}>
          {#snippet children({ cells })}
            <div class="flex w-full justify-between gap-1.5 sm:gap-2">
              {#each cells as cell (cell)}
                <InputOTP.Group
                  ><InputOTP.Slot
                    class="h-11 w-8 border-border bg-muted/60 text-base font-bold text-foreground sm:h-14 sm:w-11 sm:text-xl"
                    {cell}
                  /></InputOTP.Group
                >
              {/each}
            </div>
          {/snippet}
        </InputOTP.Root>
      </div>
      <div class="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
        <KeyRound class="h-4 w-4 text-primary" /> The marker PIN is requested on the next screen.
      </div>
    </section>
  </main>
</div>
