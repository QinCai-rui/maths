<script lang="ts">
  import { goto } from "$app/navigation";

  let query = $state("");
  let errorMessage = $state("");

  function submit(event: SubmitEvent) {
    event.preventDefault();
    const cleanQuery = query.trim();
    if (!/^\d+$/.test(cleanQuery)) {
      errorMessage = "Enter a whole number between 0 and 10,000,000.";
      return;
    }
    const number = Number(cleanQuery);
    if (!Number.isSafeInteger(number) || number > 10_000_000) {
      errorMessage = "Enter a whole number between 0 and 10,000,000.";
      return;
    }
    errorMessage = "";
    void goto(`/utilities/number/${number}`);
  }
</script>

<svelte:head>
  <title>Number facts — Raymont's Maths</title>
</svelte:head>

<main class="site-wrap site-page">
  <p class="site-eyebrow">A closer look at numbers</p>
  <h1 class="site-page-title">Number facts</h1>
  <p class="site-page-intro">Enter a whole number to see its factors, prime factorisation and other properties.</p>

  <form class="site-search" onsubmit={submit}>
    <label class="sr-only" for="number-search">Whole number</label>
    <input
      id="number-search"
      bind:value={query}
      type="text"
      inputmode="numeric"
      autocomplete="off"
      placeholder="For example, 28"
      aria-describedby="search-help search-error"
    />
    <button class="site-button site-button-primary" type="submit">Show facts</button>
  </form>
  <p id="search-help" class="mt-2 text-sm text-muted-foreground">Use a whole number from 0 to 10,000,000.</p>
  {#if errorMessage}
    <p id="search-error" class="mt-2 text-sm font-medium text-destructive" role="alert">{errorMessage}</p>
  {/if}
</main>
