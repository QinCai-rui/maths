<script lang="ts">
  import { page } from "$app/state";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Header } from "#lib/components/ui/header/index.js";
  import { reportIssueUrl } from "#lib/utils.js";

  const isNotFound = $derived(page.status === 404);
  const isServerError = $derived(page.status >= 500);
  const issueUrl = $derived(reportIssueUrl(page.status, page.url.href, page.error?.message));

  const eyebrow = $derived(isNotFound ? "Missing page" : isServerError ? "Server error" : "Request error");
  const title = $derived(
    isNotFound
      ? "Page not found"
      : isServerError
        ? "Something went wrong"
        : (page.error?.message ?? "Something went wrong")
  );
</script>

<svelte:head><title>{page.status} - Mathex</title></svelte:head>

<div class="mathex-shell flex min-h-screen items-center justify-center px-3 py-10 sm:px-6">
  <main class="mathex-panel w-full max-w-md p-6 sm:p-8">
    <p class="mathex-kicker">{eyebrow}</p>
    <p class="mt-2 font-mono text-5xl font-bold text-primary">{page.status}</p>
    <Header size="h2" class="mt-4 text-2xl">{title}</Header>
    {#if isServerError}
      <p class="mt-2 text-sm leading-6 text-muted-foreground">
        Try refreshing. If it keeps happening, please report it.
      </p>
      <div class="mt-6 flex flex-col gap-2">
        <Button onclick={() => location.reload()} class="w-full">Refresh</Button>
        <Button href={issueUrl} target="_blank" rel="noreferrer" variant="outline" class="w-full"
          >Report an issue</Button
        >
        <Button href="/mathex/app" variant="ghost" class="w-full">Mathex home</Button>
      </div>
    {:else if isNotFound}
      <p class="mt-2 text-sm leading-6 text-muted-foreground">
        That mathex page does not exist. It may have moved, or the link may be wrong.
      </p>
      <div class="mt-6 flex flex-col gap-2">
        <Button href="/mathex/app" class="w-full">Mathex home</Button>
        <Button href="/mathex/app/play" variant="outline" class="w-full">Join a competition</Button>
      </div>
    {:else}
      <p class="mt-2 text-sm leading-6 text-muted-foreground">Check the link and try again.</p>
      <div class="mt-6 flex flex-col gap-2">
        <Button href="/mathex/app" class="w-full">Mathex home</Button>
      </div>
    {/if}
  </main>
</div>
