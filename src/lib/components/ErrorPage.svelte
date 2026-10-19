<script lang="ts">
  import "../../app.css";
  import { page } from "$app/state";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Header } from "#lib/components/ui/header/index.js";
  import SiteNav from "#lib/components/SiteNav.svelte";
  import SiteFooter from "#lib/components/SiteFooter.svelte";
  import { reportIssueUrl } from "#lib/utils.js";

  const isMathex = $derived(page.url.pathname.startsWith("/mathex"));
  const isNotFound = $derived(page.status === 404);
  const isServerError = $derived(page.status >= 500);
  const issueUrl = $derived(reportIssueUrl(page.status, page.url.href, page.error?.message));

  const eyebrow = $derived(
    isNotFound
      ? isMathex
        ? "Off the scoreboard"
        : "Undefined here"
      : isServerError
        ? "Calculation failed"
        : "Request problem"
  );
  const title = $derived(
    isNotFound
      ? isMathex
        ? "No such round in this competition"
        : "This page is not on the number line"
      : isServerError
        ? isMathex
          ? "The scoreboard froze"
          : "Our working went wrong"
        : (page.error?.message ?? "Something went wrong")
  );
  const lead = $derived(
    isNotFound
      ? isMathex
        ? "That Mathex page does not exist. Check the link, or head back to the competition hub."
        : "We checked every factor and this page is not among them. It may have moved, or the link may have a typo."
      : isServerError
        ? "Something broke on our side. Refresh and try again. If it keeps happening, tell us what you were doing."
        : "Check the link or the number you entered and try again."
  );
</script>

<svelte:head><title>{page.status} · {isMathex ? "Mathex" : "Raymont's Maths"}</title></svelte:head>

<div class="public-site flex min-h-screen flex-col" class:mathex-app={isMathex}>
  <SiteNav />

  <main class="flex-1">
    {#if isMathex}
      <div class="mathex-shell flex min-h-[60vh] items-center justify-center px-3 py-16 sm:px-6">
        <section class="mathex-panel w-full max-w-md p-6 text-center sm:p-8">
          <p class="mathex-kicker">{eyebrow}</p>
          <p class="mt-2 font-mono text-5xl font-bold text-primary">{page.status}</p>
          <Header size="h2" class="mt-4 text-2xl">{title}</Header>
          <p class="mt-2 text-sm leading-6 text-muted-foreground">{lead}</p>
          {#if isServerError}
            <div class="mt-6 flex flex-col gap-2">
              <Button onclick={() => location.reload()} class="w-full">Refresh</Button>
              <Button href={issueUrl} target="_blank" rel="noreferrer" variant="outline" class="w-full"
                >Report an issue</Button
              >
              <Button href="/mathex/app" variant="ghost" class="w-full">Mathex home</Button>
            </div>
          {:else if isNotFound}
            <div class="mt-6 flex flex-col gap-2">
              <Button href="/mathex/app" class="w-full">Mathex home</Button>
              <Button href="/" variant="outline" class="w-full">Site home</Button>
            </div>
          {:else}
            <div class="mt-6 flex flex-col gap-2">
              <Button href="/mathex/app" class="w-full">Mathex home</Button>
            </div>
          {/if}
        </section>
      </div>
    {:else}
      <section class="site-wrap error-page">
        <p class="error-code" aria-hidden="true">{page.status}</p>
        <p class="site-eyebrow">{eyebrow}</p>
        <h1 class="site-title">{title}</h1>
        <p class="site-lead">{lead}</p>
        {#if isServerError}
          <div class="site-actions">
            <button type="button" class="site-button site-button-primary" onclick={() => location.reload()}
              >Refresh</button
            >
            <a class="site-button site-button-secondary" href={issueUrl} target="_blank" rel="noreferrer"
              >Report an issue</a
            >
            <a class="site-button site-button-secondary" href="/">Go home</a>
          </div>
        {:else if isNotFound}
          <div class="site-actions">
            <a class="site-button site-button-primary" href="/">Go home</a>
            <a class="site-button site-button-secondary" href="/tools">Explore the tools</a>
          </div>
        {:else}
          <div class="site-actions">
            <a class="site-button site-button-primary" href="/">Go home</a>
          </div>
        {/if}
      </section>
    {/if}
  </main>

  <SiteFooter />
</div>

<style>
  .error-page {
    padding-block: clamp(3rem, 9vw, 7rem);
  }
  .error-code {
    margin: 0 0 0.5rem;
    color: var(--line-strong);
    font-family: "Fraunces", Georgia, serif;
    font-size: clamp(5.5rem, 22vw, 11rem);
    font-weight: 600;
    line-height: 0.9;
    letter-spacing: -0.04em;
  }
</style>
