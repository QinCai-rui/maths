<script lang="ts">
  import { onMount } from "svelte";
  import * as AlertDialog from "#lib/components/ui/alert-dialog/index.js";
  import { CONNECTION_EVENT } from "./connection";
  let open = $state(false);
  onMount(() => {
    const show = () => {
      open = true;
    };
    window.addEventListener(CONNECTION_EVENT, show);
    return () => window.removeEventListener(CONNECTION_EVENT, show);
  });
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Mathex connection interrupted</AlertDialog.Title>
      <AlertDialog.Description>
        We couldn't reconnect to Mathex. Your bot check may have expired, or the server may be unavailable. Reload the
        page to reconnect and complete the check if asked. Unsaved changes may be lost. If a submission was interrupted,
        check whether it went through before trying again.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Keep this page open</AlertDialog.Cancel>
      <AlertDialog.Action onclick={() => window.location.reload()}>Reload page</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
