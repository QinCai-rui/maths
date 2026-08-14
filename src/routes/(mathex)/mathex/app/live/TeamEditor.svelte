<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { GripVertical, Plus, Trash2 } from "@lucide/svelte/icons";

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
    teams = [...teams, { id: crypto.randomUUID(), name: `Team ${teams.length + 1}`, group: "" }];
  }

  function removeTeam(id: string) {
    teams = teams.filter((team) => team.id !== id);
  }
</script>

<div class="space-y-3">
  <div
    class="hidden grid-cols-[1fr_0.65fr_2rem] gap-3 px-3 text-xs font-bold uppercase tracking-wider text-muted-foreground sm:grid"
  >
    <span>Team name</span><span>Group</span><span></span>
  </div>
  {#each teams as team, index (team.id)}
    <div
      class="grid gap-2 rounded-xl border border-border/70 bg-background/55 p-3 sm:grid-cols-[1fr_0.65fr_2rem] sm:items-end sm:gap-3"
    >
      <div>
        <Label for="team-{team.id}" class="mb-1.5 sm:sr-only">Team {index + 1} name</Label>
        <div class="flex items-center gap-2">
          <GripVertical class="hidden h-4 w-4 shrink-0 text-muted-foreground/60 sm:block" />
          <Input id="team-{team.id}" bind:value={team.name} maxlength={50} {disabled} />
        </div>
      </div>
      <div>
        <Label for="group-{team.id}" class="mb-1.5 sm:sr-only">Group</Label>
        <Input id="group-{team.id}" bind:value={team.group} maxlength={30} placeholder="Optional group" {disabled} />
      </div>
      <Button
        variant="ghost"
        size="icon"
        class="justify-self-end text-muted-foreground hover:text-destructive"
        aria-label="Remove {team.name || `team ${index + 1}`}"
        onclick={() => removeTeam(team.id)}
        disabled={disabled || teams.length <= 1}><Trash2 /></Button
      >
    </div>
  {/each}
  <Button variant="outline" class="w-full gap-2 border-dashed" onclick={addTeam} {disabled}>
    <Plus class="h-4 w-4" /> Add team
  </Button>
</div>
