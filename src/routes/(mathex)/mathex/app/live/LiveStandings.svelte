<script lang="ts">
  import type { PhysicalScoreboardSnapshot } from "#lib/mathex/physical.schemas.js";
  import { standingsGroups, teamProgress } from "./standings.js";
  import { flip } from "svelte/animate";
  import { liveMotionDuration } from "./motion.js";

  let {
    snapshot,
    pinned = [],
    showAttempts = false
  }: { snapshot: PhysicalScoreboardSnapshot; pinned?: string[]; showAttempts?: boolean } = $props();
  const groups = $derived(standingsGroups(snapshot.teams));
</script>

{#if snapshot.state !== "lobby"}
  <p class="px-4 py-2 text-xs text-muted-foreground">
    Equal scores: teams that finish rank first, earliest finish wins. If neither finishes or the times match, the team
    that reached the score first ranks higher.
  </p>
{/if}

{#each groups as group (group.name)}
  <table class="w-full border-collapse text-sm tabular-nums">
    <caption class={groups.length > 1 || group.name !== "Ungrouped" ? "px-4 pt-3 text-left font-bold" : "sr-only"}>
      {group.name === "Ungrouped" && groups.length === 1 ? "Team standings" : group.name}
    </caption>
    <thead class="sticky top-0 z-10 bg-card text-xs text-muted-foreground">
      <tr class="border-b border-border">
        {#if snapshot.state !== "lobby"}<th scope="col" class="py-2 ps-4 pe-2 text-right">Rank</th>{/if}
        <th scope="col" class="px-3 py-2 text-left">Team</th>
        <th scope="col" class="px-2 py-2 text-right">Correct</th>
        {#if showAttempts}
          <th scope="col" class="px-2 py-2 text-right">Wrong attempts</th>
          <th scope="col" class="px-2 py-2 text-right">Skipped</th>
        {/if}
        <th scope="col" class="py-2 ps-2 pe-4 text-right">Progress</th>
      </tr>
    </thead>
    <tbody>
      {#each group.teams as team (team.id)}
        {@const isPinned = pinned.includes(team.id)}
        <tr
          animate:flip={{ duration: liveMotionDuration() }}
          class="border-b border-border {isPinned ? 'bg-primary/10' : ''}"
        >
          {#if snapshot.state !== "lobby"}<td class="py-2 ps-4 pe-2 text-right text-muted-foreground">{team.rank}</td
            >{/if}
          <th scope="row" class="px-3 py-2 text-left font-semibold [overflow-wrap:anywhere]">
            {#if isPinned}<span class="sr-only">Pinned: </span>{/if}{team.name}
          </th>
          <td class="px-2 py-2 text-right font-bold">{team.correct}</td>
          {#if showAttempts}
            <td class="px-2 py-2 text-right">{team.incorrect}</td>
            <td class="px-2 py-2 text-right">{team.skipped}</td>
          {/if}
          <td class="py-2 ps-2 pe-4 text-right text-muted-foreground"
            >{teamProgress(team, snapshot.questionCount, snapshot.state)}</td
          >
        </tr>
      {/each}
    </tbody>
  </table>
{/each}
