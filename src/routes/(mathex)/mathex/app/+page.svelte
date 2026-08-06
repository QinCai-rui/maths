<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Header } from "$lib/components/ui/header";
  import { Calculator, Gamepad2, MoveLeft } from "@lucide/svelte/icons";
</script>

<div class="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
  <div class="text-center">
    <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
      <Calculator class="h-7 w-7" />
    </div>
    <Header size="h1">Mathex</Header>
    <p class="mt-2 text-lg text-muted-foreground">An application designed for Mathex-style events.</p>
  </div>
  <div class="w-full max-w-sm space-y-3">
    <Button href="/mathex/app/play" class="w-full gap-2">
      <Gamepad2 class="h-4 w-4" />
      Play
    </Button>
    <Button href="/mathex/app/create" variant="outline" class="w-full gap-2">
      <Calculator class="h-4 w-4" />
      Create
    </Button>
  </div>
  <Button variant="ghost" href="/" class="gap-2">
    <MoveLeft class="h-4 w-4" />
    Back to Devarsh's Maths, revived
  </Button>
</div>
