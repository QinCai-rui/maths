<script lang="ts">
  import { page } from "$app/state";
  import SetEditor from "#lib/mathex/editor/SetEditor.svelte";
</script>

<svelte:head><title>Live set editor · Mathex</title></svelte:head>

{#key page.params.token}
  <SetEditor sessionToken={page.params.token} />
{/key}
