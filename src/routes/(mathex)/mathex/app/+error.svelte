<script lang="ts">
  import { page } from "$app/state";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Header } from "#lib/components/ui/header/index.js";
  import { reportIssueUrl } from "#lib/utils.js";

  const isServerError = $derived(page.status >= 500);
  const issueUrl = $derived(reportIssueUrl(page.status, page.url.href, page.error?.message));
</script>

<svelte:head><title>{page.status} - Mathex</title></svelte:head>

<div class="mathex-shell flex min-h-screen items-center justify-center px-3 py-10 sm:px-6">
  <main class="mathex-panel w-full max-w-md p-6 text-center sm:p-8">
    <div class="mx-auto flex h-14 w-14 items-center justify-center bg-destructive/10 text-destructive">
      <span class="text-2xl font-bold">{page.status}</span>
    </div>
    <Header size="h2" class="mt-5 text-2xl">
      {page.error?.message || (isServerError ? "Something went wrong" : "Not found")}
    </Header>
    {#if isServerError}
      <p class="mt-2 text-sm leading-6 text-muted-foreground">
        Try refreshing. If it keeps happening, please report it.
      </p>
      <div class="mt-5 flex flex-col gap-2">
        <Button onclick={() => location.reload()} class="w-full">Refresh</Button>
        <Button href={issueUrl} target="_blank" rel="noreferrer" variant="outline" class="w-full"
          >Report an issue</Button
        >
        <Button href="/mathex/app" variant="ghost" class="w-full">Mathex home</Button>
      </div>
    {:else}
      <p class="mt-2 text-sm leading-6 text-muted-foreground">
        That mathex page does not exist. It may have moved, or the link may be wrong.
      </p>
      <div class="mt-5 flex flex-col gap-2">
        <Button href="/mathex/app" class="w-full">Mathex home</Button>
        <Button href="/mathex/app/play" variant="outline" class="w-full">Join a competition</Button>
      </div>
    {/if}
  </main>
</div>
