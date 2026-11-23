<script lang="ts">
  import type { PhysicalScoreboardSnapshot } from "#lib/mathex/physical.schemas.js";
  import { msToMinutesAndSeconds } from "#lib/utils.js";
  import { standingsGroups, teamProgress } from "./standings.js";
  import { flip } from "svelte/animate";
  import { liveMotionDuration } from "./motion.js";
  import QuestionTrack from "./QuestionTrack.svelte";

  let {
    snapshot,
    pinned = [],
    showAttempts = false
  }: { snapshot: PhysicalScoreboardSnapshot; pinned?: string[]; showAttempts?: boolean } = $props();
  const groups = $derived(standingsGroups(snapshot.teams));
  const ranked = $derived(snapshot.state !== "lobby");
</script>

<div class="lv-standings-wrap" class:is-wide={showAttempts}>
  {#each groups as group (group.name)}
    <table class="lv-standings">
      <caption class={groups.length > 1 || group.name !== "Ungrouped" ? "" : "sr-only"}>
        {group.name === "Ungrouped" && groups.length === 1 ? "Team standings" : group.name}
      </caption>
      <thead>
        <tr>
          {#if ranked}<th scope="col" class="col-rank">Rank</th>{/if}
          <th scope="col" class="col-team">Team</th>
          <th scope="col">Correct</th>
          {#if showAttempts}
            <th scope="col" class="col-extra">Wrong attempts</th>
            <th scope="col" class="col-extra">Skipped</th>
          {/if}
          <th scope="col" colspan={showAttempts ? 2 : 1}>Progress</th>
          {#if showAttempts}<th scope="col" class="col-extra">Finish time</th>{/if}
        </tr>
      </thead>
      <tbody>
        {#each group.teams as team (team.id)}
          {@const isPinned = pinned.includes(team.id)}
          {@const finish = team.finishTimeMs === null ? null : msToMinutesAndSeconds(team.finishTimeMs)}
          <tr
            animate:flip={{ duration: liveMotionDuration() }}
            class:is-pinned={isPinned}
            class:is-leader={ranked && team.rank === 1}
          >
            {#if ranked}<td class="col-rank"><span>{team.rank}</span></td>{/if}
            <th scope="row" class="col-team">
              {#if isPinned}<span class="sr-only">Pinned: </span>{/if}{team.name}
              {#if showAttempts}
                <span class="team-meta">
                  <span>Wrong attempts <b>{team.incorrect}</b></span>
                  <span>Skipped <b>{team.skipped}</b></span>
                  {#if finish}<span>Finish time <b>{finish}</b></span>{/if}
                </span>
              {/if}
            </th>
            <td class="col-correct">{team.correct}</td>
            {#if showAttempts}
              <td class="col-extra">{team.incorrect}</td>
              <td class="col-extra">{team.skipped}</td>
              <td class="col-extra col-track" aria-hidden="true"><QuestionTrack {team} round={snapshot.state} /></td>
            {/if}
            <td class="col-progress">{teamProgress(team, snapshot.questionCount, snapshot.state)}</td>
            {#if showAttempts}
              <td class="col-extra">{finish ?? "—"}</td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  {/each}
</div>

{#if ranked}
  <p class="lv-note">
    Ties on correct answers go to the team that has finished, then to the earlier finish time, then to the team that
    reached the score first.
  </p>
{/if}
