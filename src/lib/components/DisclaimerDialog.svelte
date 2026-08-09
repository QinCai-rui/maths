<script lang="ts">
  import { onMount } from "svelte";
  import * as AlertDialog from "$lib/components/ui/alert-dialog";

  const acknowledgementKey = "disclaimer-acknowledged";
  let open = $state(false);

  onMount(() => {
    open = localStorage.getItem(acknowledgementKey) !== "true";
  });

  function acknowledge() {
    localStorage.setItem(acknowledgementKey, "true");
    open = false;
  }
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Content class="max-w-xl">
    <AlertDialog.Header>
      <AlertDialog.Title>Important disclaimer</AlertDialog.Title>
      <AlertDialog.Description class="leading-6">
        This site is free software distributed under the GNU GPLv3 and is provided as-is. Its information and
        functionality may be inaccurate, incomplete, or outdated. No warranty is provided, including implied warranties
        of merchantability or fitness for a particular purpose. To the fullest extent permitted by law, the site owners
        disclaim liability arising from its use.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Action onclick={acknowledge}>I understand</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
