<script lang="ts">
  import "../app.css";
  import { page } from "$app/state";
  import { Button } from "#lib/components/ui/button/index.js";
  import { reportIssueUrl } from "#lib/utils.js";

  const isServerError = $derived(page.status >= 500);
  const issueUrl = $derived(reportIssueUrl(page.status, page.url.href, page.error?.message));
</script>

<svelte:head><title>{page.status}</title></svelte:head>

<div class="public-site flex min-h-screen flex-col items-center justify-center px-4 py-16">
  <main class="w-full">
    <div class="mx-auto max-w-2xl text-center">
      <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <span class="text-3xl font-bold">{page.status}</span>
      </div>
      <h1 class="mt-6 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        {page.error?.message || (isServerError ? "Something went wrong on our end" : "Page not found")}
      </h1>
      {#if isServerError}
        <p class="mt-4 text-lg text-muted-foreground">
          Try refreshing the page. If it keeps happening, please report it.
        </p>
        <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button onclick={() => location.reload()} class="gap-2">Refresh</Button>
          <Button href={issueUrl} target="_blank" rel="noreferrer" variant="outline">Report an issue</Button>
          <Button href="/" variant="ghost">Go home</Button>
        </div>
      {:else}
        <p class="mt-4 text-lg text-muted-foreground">
          That page does not exist. It may have moved, or it may never have existed.
        </p>
        <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button href="/" class="gap-2">Go back home</Button>
          <Button href="/tools" variant="outline">Open tools</Button>
        </div>
      {/if}
    </div>
  </main>
</div>
