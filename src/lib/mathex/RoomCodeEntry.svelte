<script lang="ts">
  import { goto } from "$app/navigation";
  import { Header } from "#lib/components/ui/header/index.js";
  import * as InputOTP from "#lib/components/ui/input-otp/index.js";
  import { ArrowLeft } from "@lucide/svelte/icons";
  import { REGEXP_ONLY_DIGITS } from "bits-ui";
  import { io, type Socket } from "socket.io-client";
  import { toast } from "svelte-sonner";
  import { untrack, type Snippet } from "svelte";

  interface Props {
    /** Socket namespace that answers the code check, e.g. "/rooms". */
    namespace: string;
    /** The check event, e.g. "checkRoom" or "checkCompetition". */
    checkEvent: string;
    /** Path prefix to navigate to once the code is valid. */
    hrefBase: string;
    backHref: string;
    backLabel: string;
    kicker: string;
    title: string;
    description: string;
    fieldLabel: string;
    hint: string;
    errorMessage: string;
    icon: Snippet;
    hintIcon: Snippet;
  }

  let {
    namespace,
    checkEvent,
    hrefBase,
    backHref,
    backLabel,
    kicker,
    title,
    description,
    fieldLabel,
    hint,
    errorMessage,
    icon,
    hintIcon
  }: Props = $props();

  const socket: Socket = io(untrack(() => namespace));
  let code = $state("");
  let lastCode = "";
  let checking = $state(false);
  let resumeTimer: ReturnType<typeof setTimeout> | undefined;

  /** Holds the dedupe flag so a wrong code is not re-sent for a short cooldown. */
  function scheduleResume() {
    checking = true;
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      lastCode = "";
      checking = false;
    }, 1500);
  }

  async function setCode(value: string) {
    code = value;
    if (code.length !== 6 || lastCode === code || checking) return;
    lastCode = code;
    checking = true;
    try {
      const exists = (await socket.timeout(5000).emitWithAck(checkEvent, code)) as boolean;
      checking = false;
      if (exists) {
        socket.disconnect();
        goto(hrefBase + code);
        return;
      }
      // Brief cooldown so rapid retyping cannot hammer the check endpoint.
      scheduleResume();
      toast.error(errorMessage);
    } catch {
      checking = false;
      // A timeout or dropped connection is not proof the code is wrong.
      scheduleResume();
      toast.error("Could not check the code. Check your connection and try again.");
    }
  }

  $effect(() => {
    return () => {
      clearTimeout(resumeTimer);
      socket.disconnect();
    };
  });
</script>

<div class="mathex-shell relative flex min-h-full items-center justify-center overflow-hidden px-3 py-8 sm:px-6">
  <div class="mathex-grid pointer-events-none absolute inset-0 opacity-70"></div>
  <main class="relative w-full max-w-lg">
    <a
      href={backHref}
      class="mb-10 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      ><ArrowLeft class="h-4 w-4" /> {backLabel}</a
    >
    <div class="mathex-panel p-6 sm:p-9">
      <div class="flex h-12 w-12 items-center justify-center bg-primary text-primary-foreground">{@render icon()}</div>
      <p class="mathex-kicker mt-7">{kicker}</p>
      <Header size="h1" class="mt-2 text-4xl tracking-[-0.04em]">{title}</Header>
      <p class="mt-3 leading-7 text-muted-foreground">{description}</p>
      <div class="mt-8 border border-border bg-background p-4 sm:p-5" aria-busy={checking}>
        <p class="mb-3 text-sm font-semibold text-muted-foreground">{fieldLabel}</p>
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
        <p class="mt-3 min-h-5 text-sm text-muted-foreground" aria-live="polite">
          {#if checking}Checking the code…{/if}
        </p>
      </div>
      <div class="mt-6 flex items-center gap-2 text-sm text-muted-foreground">{@render hintIcon()} {hint}</div>
    </div>
  </main>
</div>
