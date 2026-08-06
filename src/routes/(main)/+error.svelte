<script lang="ts">
  import { page } from "$app/state";
  import { Button } from "$lib/components/ui/button";
</script>

<section class="py-20">
  <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
    <div class="mx-auto max-w-2xl text-center">
      <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <span class="text-3xl font-bold">{page.status}</span>
      </div>
      <h1 class="mt-6 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        {page.error?.message || "Something went wrong"}
      </h1>
      <p class="mt-4 text-lg text-muted-foreground">
        {#if page.status === 404}
          Hmm... maybe try going
        {:else}
          Whoops!
        {/if}
      </p>
      {#if page.status === 404}
        <p class="mt-2 text-lg text-muted-foreground">
          Or maybe solve a <a href="/games" class="font-medium text-primary underline-offset-4 hover:underline"
            >maths problem</a
          >?
        </p>
      {/if}
      <div class="mt-8 flex items-center justify-center gap-3">
        <Button href="/" class="gap-2">Go back home</Button>
        {#if page.status === 404}
          <Button href="/games" variant="outline">Play a game</Button>
        {/if}
      </div>
      <p class="mt-6 text-sm text-muted-foreground">
        If this was unexpected, please <a
          href="/contact"
          class="font-medium text-primary underline-offset-4 hover:underline">contact us</a
        >.
      </p>
    </div>
  </div>
</section>
