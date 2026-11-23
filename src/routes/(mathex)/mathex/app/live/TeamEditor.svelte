<script lang="ts">
  import { onDestroy } from "svelte";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Label } from "#lib/components/ui/label/index.js";
  import { Plus, Trash2 } from "@lucide/svelte/icons";

  export interface EditableTeam {
    id: string;
    name: string;
    group: string;
  }

  interface Props {
    teams: EditableTeam[];
    disabled?: boolean;
  }

  let { teams = $bindable(), disabled = false }: Props = $props();

  function addTeam() {
    if (teams.length >= 60) return;
    teams = [...teams, { id: crypto.randomUUID(), name: `Team ${teams.length + 1}`, group: "" }];
  }

  let armDeleteId = $state<string | null>(null);
  let armTimer: ReturnType<typeof setTimeout> | undefined;
  onDestroy(() => clearTimeout(armTimer));

  function removeTeam(id: string) {
    if (armDeleteId !== id) {
      armDeleteId = id;
      clearTimeout(armTimer);
      armTimer = setTimeout(() => {
        if (armDeleteId === id) armDeleteId = null;
      }, 4000);
      return;
    }
    clearTimeout(armTimer);
    armDeleteId = null;
    teams = teams.filter((team) => team.id !== id);
  }
</script>

<div>
  <div class="roster-head" aria-hidden="true">
    <span></span><span>Team name</span><span>Group</span><span></span>
  </div>
  {#each teams as team, index (team.id)}
    {@const armed = armDeleteId === team.id}
    <div class="roster-row">
      <span class="roster-n" aria-hidden="true">{index + 1}</span>
      <div>
        <Label for="team-{team.id}" class="sr-only">Team {index + 1} name</Label>
        <Input id="team-{team.id}" bind:value={team.name} maxlength={50} placeholder="Team name" {disabled} />
      </div>
      <div class="roster-group">
        <Label for="group-{team.id}" class="sr-only">Group</Label>
        <Input id="group-{team.id}" bind:value={team.group} maxlength={30} placeholder="Optional group" {disabled} />
      </div>
      <button
        type="button"
        class="roster-remove"
        class:is-armed={armed}
        aria-label={armed
          ? `Confirm remove ${team.name || `team ${index + 1}`}`
          : `Remove ${team.name || `team ${index + 1}`}`}
        title={armed ? "Click again to confirm removal" : "Remove team"}
        onclick={() => removeTeam(team.id)}
        disabled={disabled || teams.length <= 1}
        >{#if armed}Remove?{:else}<Trash2 />{/if}</button
      >
    </div>
  {/each}
  <button
    type="button"
    class="lbtn lbtn-line lbtn-sm mt-3"
    onclick={addTeam}
    disabled={disabled || teams.length >= 60}
    title={teams.length >= 60 ? "Roster is limited to 60 teams" : "Add team"}
  >
    <Plus /> Add team
  </button>
  {#if teams.length >= 60}
    <p class="lv-hint">Roster is limited to 60 teams.</p>
  {/if}
</div>
