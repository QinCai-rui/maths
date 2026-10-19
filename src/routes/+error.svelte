<script lang="ts">
  import "../app.css";
  import { page } from "$app/state";
  import { reportIssueUrl } from "#lib/utils.js";

  const isNotFound = $derived(page.status === 404);
  const isServerError = $derived(page.status >= 500);
  const issueUrl = $derived(reportIssueUrl(page.status, page.url.href, page.error?.message));

  const eyebrow = $derived(isNotFound ? "Missing page" : isServerError ? "Server error" : "Request error");
  const title = $derived(
    isNotFound
      ? "Page not found"
      : isServerError
        ? "Something went wrong on our end"
        : (page.error?.message ?? "Something went wrong")
  );
</script>

<svelte:head><title>{page.status} · Raymont's Maths</title></svelte:head>

<div class="public-site flex min-h-screen flex-col">
  <section class="site-wrap error-page">
    <p class="error-code" aria-hidden="true">{page.status}</p>
    <p class="site-eyebrow">{eyebrow}</p>
    <h1 class="site-title">{title}</h1>
    {#if isServerError}
      <p class="site-lead">Try refreshing the page. If it keeps happening, please report it.</p>
      <div class="site-actions">
        <button type="button" class="site-button site-button-primary" onclick={() => location.reload()}>Refresh</button>
        <a class="site-button site-button-secondary" href={issueUrl} target="_blank" rel="noreferrer">Report an issue</a
        >
        <a class="site-button site-button-secondary" href="/">Go home</a>
      </div>
    {:else if isNotFound}
      <p class="site-lead">That page does not exist. It may have moved, or the link may be wrong.</p>
      <div class="site-actions">
        <a class="site-button site-button-primary" href="/">Go home</a>
        <a class="site-button site-button-secondary" href="/tools">Open tools</a>
      </div>
    {:else}
      <p class="site-lead">Check the link and try again.</p>
      <div class="site-actions">
        <a class="site-button site-button-primary" href="/">Go home</a>
      </div>
    {/if}
  </section>
</div>

<style>
  .error-page {
    position: relative;
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
