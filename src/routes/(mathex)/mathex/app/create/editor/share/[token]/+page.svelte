<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { Button } from "$lib/components/ui/button";
  import { Header } from "$lib/components/ui/header";
  import { downloadSetJson, MATHEX_DRAFT_KEY, parseQuestionSet, questionSetDifferences } from "$lib/mathex/set-draft";
  import type {
    SetShareClientToServerEvents,
    SetShareServerToClientEvents,
    SharedSet
  } from "$lib/mathex/set-share.schemas";
  import { AlertTriangle, CheckCircle2, Download, FileWarning, LoaderCircle } from "@lucide/svelte/icons";
  import { io, type Socket } from "socket.io-client";
  import { onMount } from "svelte";

  const socket: Socket<SetShareServerToClientEvents, SetShareClientToServerEvents> = io("/set-share");
  let share: SharedSet | null = $state(null);
  let status: "loading" | "error" | "conflict" | "imported" | "same" = $state("loading");
  let error = $state("");
  let differences: string[] = $state([]);
  let localRaw: unknown = null;

  function saveSharedSet() {
    if (!share) return;
    localStorage.setItem(MATHEX_DRAFT_KEY, JSON.stringify(share.set));
    status = "imported";
  }

  function replaceAndOpen() {
    saveSharedSet();
    goto("/mathex/app/create/editor");
  }

  function backupLocal() {
    downloadSetJson(localRaw, "mathex-local-draft-backup.json");
  }

  onMount(() => {
    socket.emit("getShare", page.params.token || "", (result) => {
      socket.disconnect();
      if (!result.ok) {
        error = result.error;
        status = "error";
        return;
      }
      share = result.share;
      const raw = localStorage.getItem(MATHEX_DRAFT_KEY);
      if (!raw) {
        saveSharedSet();
        return;
      }
      try {
        localRaw = JSON.parse(raw);
      } catch {
        localRaw = raw;
        differences = ["Local draft: invalid JSON that cannot be compared"];
        status = "conflict";
        return;
      }
      const local = parseQuestionSet(localRaw);
      if (!local.success) {
        differences = local.error.issues.map(
          (issue) => `Local draft ${issue.path.join(".") || "root"}: ${issue.message}`
        );
        status = "conflict";
        return;
      }
      const meaningfulLocal = local.data.questions.length > 0 || local.data.name || local.data.instructions;
      if (!meaningfulLocal) {
        saveSharedSet();
        return;
      }
      differences = questionSetDifferences(local.data, result.share.set);
      status = differences.length === 0 ? "same" : "conflict";
    });
  });
</script>

<svelte:head><title>Receive Shared Mathex Set</title></svelte:head>

<div class="mathex-shell min-h-screen px-4 py-10 sm:px-6">
  <main class="mx-auto max-w-2xl">
    <section class="mathex-panel rounded-3xl p-6 sm:p-9">
      {#if status === "loading"}
        <LoaderCircle class="h-9 w-9 animate-spin text-primary" />
        <Header size="h1" class="mt-5 text-3xl">Loading shared set...</Header>
      {:else if status === "error"}
        <FileWarning class="h-10 w-10 text-destructive" />
        <Header size="h1" class="mt-5 text-3xl">Share unavailable</Header>
        <p class="mt-3 text-muted-foreground">{error}</p>
      {:else if status === "conflict"}
        <AlertTriangle class="h-10 w-10 text-amber-600 dark:text-amber-400" />
        <p class="mathex-kicker mt-5">Local draft conflict</p>
        <Header size="h1" class="mt-1 text-3xl">Your current set is different.</Header>
        <p class="mt-3 leading-6 text-muted-foreground">
          Replacing it will clear the local draft on this device. Export a JSON backup first so you can restore it
          later.
        </p>
        <div class="mt-6 max-h-72 overflow-y-auto rounded-xl border border-border bg-muted/30 p-4">
          <p class="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Conflicts found</p>
          <ul class="space-y-1.5 text-sm">
            {#each differences as difference}<li class="flex gap-2">
                <span class="text-amber-600">•</span>{difference}
              </li>{/each}
          </ul>
        </div>
        <div class="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button class="gap-2" onclick={backupLocal}><Download /> Export local backup</Button>
          <Button variant="destructive" onclick={replaceAndOpen}>Replace local draft</Button>
          <Button variant="outline" href="/mathex/app/create/editor">Cancel and keep local</Button>
        </div>
      {:else}
        <CheckCircle2 class="h-10 w-10 text-emerald-600 dark:text-emerald-400" />
        <p class="mathex-kicker mt-5">{status === "same" ? "Already saved" : "Saved locally"}</p>
        <Header size="h1" class="mt-1 text-3xl">{share?.set.name || "Shared Mathex set"}</Header>
        <p class="mt-3 text-muted-foreground">
          {status === "same"
            ? "This shared set matches your current local draft."
            : "The shared set is now stored in this browser's local storage."}
        </p>
        <p class="mt-2 text-sm text-muted-foreground">
          Share expires {share ? new Date(share.expiresAt).toLocaleString() : "soon"}.
        </p>
        <Button class="mt-6" href="/mathex/app/create/editor">Open set editor</Button>
      {/if}
    </section>
  </main>
</div>
