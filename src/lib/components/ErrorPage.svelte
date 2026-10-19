<script lang="ts">
  import "../../app.css";
  import { page } from "$app/state";
  import SiteNav from "#lib/components/SiteNav.svelte";
  import SiteFooter from "#lib/components/SiteFooter.svelte";
  import { reportIssueUrl } from "#lib/utils.js";

  let { chrome = true }: { chrome?: boolean } = $props();

  const isMathex = $derived(page.url.pathname.startsWith("/mathex"));
  const isNotFound = $derived(page.status === 404);
  const isServerError = $derived(page.status >= 500);
  const issueUrl = $derived(reportIssueUrl(page.status, page.url.href, page.error?.message));

  const homeHref = $derived(isMathex ? "/mathex/app" : "/");
  const homeLabel = $derived(isMathex ? "Mathex home" : "Go home");

  const eyebrow = $derived(
    isNotFound
      ? isMathex
        ? "Photocopier incident"
        : "Undefined here"
      : isServerError
        ? "Calculation failed"
        : "Request problem"
  );
  const title = $derived(
    isNotFound
      ? isMathex
        ? "Your question slip was eaten"
        : "This page is not on the number line"
      : isServerError
        ? "Our working went wrong"
        : "This request did not add up"
  );
  const lead = $derived(
    isNotFound
      ? isMathex
        ? "The photocopier ate this page on the way to the answer sheet. We have asked it to stop. Check the link, or head back to Mathex and try again."
        : "We checked every factor and this page is not among them. It may have moved, or the link may have a typo."
      : isServerError
        ? "Something broke on our side. Refresh and try again. If it keeps happening, tell us what you were doing."
        : page.error?.message || "Check the link or the number you entered and try again."
  );
</script>

<svelte:head><title>{page.status} · Raymont's Maths</title></svelte:head>

<div class={chrome ? "public-site flex min-h-screen flex-col" : "flex flex-1 flex-col"}>
  {#if chrome}<SiteNav />{/if}

  <main class="flex-1">
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
          <a class="site-button site-button-secondary" href={homeHref}>{homeLabel}</a>
        </div>
      {:else if isNotFound}
        <div class="site-actions">
          <a class="site-button site-button-primary" href={homeHref}>{homeLabel}</a>
          {#if isMathex}
            <a class="site-button site-button-secondary" href="/">Site home</a>
          {:else}
            <a class="site-button site-button-secondary" href="/tools">Explore the tools</a>
          {/if}
        </div>
      {:else}
        <div class="site-actions">
          <a class="site-button site-button-primary" href={homeHref}>{homeLabel}</a>
        </div>
      {/if}
    </section>
  </main>

  {#if chrome}<SiteFooter />{/if}
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
