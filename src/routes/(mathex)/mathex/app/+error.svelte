<script lang="ts">
  import { page } from "$app/state";
  import ErrorPage from "#lib/components/ErrorPage.svelte";

  // Mirrors siteShellRoutes in the Mathex layout. Those routes already render the site header and footer.
  const layoutHasChrome = $derived(
    ["/mathex/app", "/mathex/app/create", "/mathex/app/play", "/mathex/app/live"].includes(page.url.pathname)
  );
</script>

<ErrorPage chrome={!layoutHasChrome} />
