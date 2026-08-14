<script lang="ts">
  import { page } from "$app/state";
  import CollaborativeSetEditor from "$lib/mathex/editors/CollaborativeSetEditor.svelte";
</script>

<CollaborativeSetEditor sessionToken={page.params.token} />
