<script lang="ts">
  let { rank, class: className = "" }: { rank: number; class?: string } = $props();
</script>

<div
  class="flex shrink-0 items-center justify-center rounded-full text-xs font-bold {rank === 1
    ? 'bg-yellow-400 text-yellow-900'
    : rank === 2
      ? 'bg-muted text-muted-foreground'
      : rank === 3
        ? 'bg-amber-600 text-white'
        : 'bg-muted text-muted-foreground'} {className}"
>
  {rank}
</div>
