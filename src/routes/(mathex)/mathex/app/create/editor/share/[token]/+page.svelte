<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import {
    downloadSetJson,
    MATHEX_DRAFT_KEY,
    parseQuestionSet,
    questionSetDifferences
  } from "#lib/mathex/set-draft.js";
  import type {
    SetShareClientToServerEvents,
    SetShareServerToClientEvents,
    SharedSet
  } from "#lib/mathex/set-share.schemas.js";
  import { Download, LoaderCircle } from "@lucide/svelte/icons";
  import { io, type Socket } from "socket.io-client";
  import { onMount } from "svelte";

  let share: SharedSet | null = $state(null);
  let status: "loading" | "error" | "conflict" | "imported" | "same" = $state("loading");
  let error = $state("");
  let differences: string[] = $state([]);
  let localRaw: unknown = null;

  function saveSharedSet() {
    if (!share) return;
    try {
      localStorage.setItem(MATHEX_DRAFT_KEY, JSON.stringify(share.set));
      status = "imported";
    } catch {
      error =
        "This browser could not save the shared set. Your existing draft has not changed. Free some browser storage and open this link again.";
      status = "error";
    }
  }

  function replaceAndOpen() {
    saveSharedSet();
    if (status === "imported") goto("/mathex/app/create/editor");
  }

  function backupLocal() {
    downloadSetJson(localRaw, "mathex-local-draft-backup.json");
  }

  onMount(() => {
    const socket: Socket<SetShareServerToClientEvents, SetShareClientToServerEvents> = io("/set-share");
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
        differences = ["Your draft is not valid JSON, so it cannot be compared"];
        status = "conflict";
        return;
      }
      const local = parseQuestionSet(localRaw);
      if (!local.success) {
        differences = local.error.issues.map(
          (issue) => `Your draft, ${issue.path.join(".") || "root"}: ${issue.message}`
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

<svelte:head><title>Receive a shared set · Mathex</title></svelte:head>

<div class="mathex-editor mx-receive">
  <main>
    <a class="brand" href="/mathex/app/create/editor"><span class="mark">∑</span> Mathex</a>
    {#if status === "loading"}
      <LoaderCircle class="size-6 animate-spin text-[var(--mx-accent)]" />
      <h1>Opening the shared set…</h1>
    {:else if status === "error"}
      <p class="kicker bad">Link unavailable</p>
      <h1>This set could not be opened.</h1>
      <p class="lede">{error}</p>
      <a class="mx-btn" href="/mathex/app/create/editor">Open the editor</a>
    {:else if status === "conflict"}
      <p class="kicker warn">Your draft is different</p>
      <h1>Replace your draft with “{share?.set.name || "the shared set"}”?</h1>
      <p class="lede">This replaces the draft saved in this browser. Back it up first if you want to keep it.</p>
      <div class="diff">
        <p>What would change</p>
        <ul>
          {#each differences as difference}<li>{difference}</li>{/each}
        </ul>
      </div>
      <div class="actions">
        <button type="button" class="mx-btn" onclick={backupLocal}><Download class="size-4" /> Back up my draft</button>
        <button type="button" class="mx-btn danger" onclick={replaceAndOpen}>Replace and open</button>
        <a class="mx-btn ghost" href="/mathex/app/create/editor">Keep my draft</a>
      </div>
    {:else}
      <p class="kicker">{status === "same" ? "Already up to date" : "Saved to this browser"}</p>
      <h1>{share?.set.name || "Shared Mathex set"}</h1>
      <p class="lede">
        {status === "same"
          ? "This set matches the draft already in your browser."
          : (share?.set.questions.length ?? 0) === 1
            ? "1 question is now your draft in this browser."
            : `${share?.set.questions.length ?? 0} questions are now your draft in this browser.`}
      </p>
      <p class="meta">Link expires {share ? new Date(share.expiresAt).toLocaleString() : "soon"}</p>
      <a class="mx-btn primary" href="/mathex/app/create/editor">Open in the editor</a>
    {/if}
  </main>
</div>

<style>
  .mx-receive {
    display: grid;
    place-items: center;
    min-height: 100dvh;
    padding: 1.5rem;
    background: var(--mx-bg);
    color: var(--mx-text);
  }
  main {
    width: min(32rem, 100%);
    padding: 1.75rem;
    border: 1px solid var(--mx-line);
    border-radius: 12px;
    background: var(--mx-surface);
    box-shadow: var(--mx-shadow);
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    margin-bottom: 1.5rem;
    color: var(--mx-text);
    font-size: 0.92rem;
    font-weight: 600;
    text-decoration: none;
  }
  .mark {
    display: inline-grid;
    place-items: center;
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 5px;
    background: var(--mx-text);
    color: var(--mx-surface);
    font-size: 0.95rem;
    line-height: 1;
  }
  .kicker {
    color: var(--mx-muted);
    font-size: 0.75rem;
    font-weight: 600;
  }
  .kicker.warn {
    color: var(--mx-warn);
  }
  .kicker.bad {
    color: var(--mx-danger);
  }
  h1 {
    margin: 0.3rem 0 0.5rem;
    font-size: 1.3rem;
    font-weight: 600;
    line-height: 1.25;
    letter-spacing: -0.01em;
  }
  .lede {
    margin-bottom: 1.1rem;
    color: var(--mx-text-soft);
    font-size: 0.88rem;
    line-height: 1.5;
  }
  .meta {
    margin: -0.4rem 0 1.1rem;
    color: var(--mx-muted);
    font-size: 0.75rem;
  }
  .diff {
    max-height: 16rem;
    overflow-y: auto;
    margin-bottom: 1.1rem;
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--mx-line);
    border-left: 3px solid var(--mx-warn);
    border-radius: 6px;
    background: var(--mx-subtle);
  }
  .diff p {
    margin-bottom: 0.35rem;
    font-size: 0.78rem;
    font-weight: 600;
  }
  .diff ul {
    display: grid;
    gap: 0.2rem;
    padding-left: 1rem;
    list-style: disc;
    font-size: 0.82rem;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  :global(.mx-receive .mx-btn) {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    height: 2.1rem;
    padding: 0 0.8rem;
    border: 1px solid var(--mx-line-strong);
    border-radius: 6px;
    background: var(--mx-surface);
    color: var(--mx-text);
    font-size: 0.84rem;
    font-weight: 500;
    text-decoration: none;
    box-shadow: var(--mx-shadow);
  }
  :global(.mx-receive .mx-btn:hover) {
    background: var(--mx-subtle);
  }
  :global(.mx-receive .mx-btn.primary) {
    border-color: var(--mx-accent);
    background: var(--mx-accent);
    color: var(--mx-accent-fg);
  }
  :global(.mx-receive .mx-btn.primary:hover) {
    border-color: var(--mx-accent-hover);
    background: var(--mx-accent-hover);
  }
  :global(.mx-receive .mx-btn.danger) {
    border-color: var(--mx-danger);
    background: var(--mx-danger);
    color: var(--mx-danger-fg);
  }
  :global(.mx-receive .mx-btn.ghost) {
    border-color: transparent;
    background: transparent;
    box-shadow: none;
  }
  :global(.mx-receive .mx-btn.ghost:hover) {
    background: var(--mx-subtle);
  }
</style>
