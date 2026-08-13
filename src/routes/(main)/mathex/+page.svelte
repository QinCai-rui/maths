<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Header } from "$lib/components/ui/header";
  import { Calculator } from "@lucide/svelte/icons";
</script>

<section class="relative isolate min-h-full overflow-hidden py-20">
  <div class="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
    <div class="mx-auto max-w-2xl text-center">
      <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Calculator class="h-7 w-7" />
      </div>
      <Header size="h1">Mathex on Raymont's Maths</Header>
      <p class="mt-4 text-center text-lg text-muted-foreground">An application designed for Mathex-style events.</p>
      <div class="mt-8 flex justify-center">
        <Button href="/mathex/app" class="gap-2">
          <Calculator class="h-4 w-4" />
          Let's go!
        </Button>
      </div>
    </div>
  </div>
</section>
