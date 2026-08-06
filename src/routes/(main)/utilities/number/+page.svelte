<script lang="ts">
  import { goto } from "$app/navigation";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Header } from "$lib/components/ui/header";
  import { Hash } from "@lucide/svelte/icons";

  let query = $state("");
  async function submit() {
    if (isNaN(Number(query))) return;
    requestAnimationFrame(() => goto(`/utilities/number/${query}`));
  }
</script>

<div class="py-12">
  <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
    <div class="mx-auto max-w-2xl text-center">
      <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Hash class="h-6 w-6" />
      </div>
      <Header size="h1">Number Search</Header>
      <p class="mt-4 text-lg text-muted-foreground">Search for a number and get fun facts about it!</p>

      <form onsubmit={submit} class="mt-8 flex justify-center">
        <div class="flex w-full max-w-sm items-center gap-2">
          <Input
            bind:value={query}
            onkeypress={(e) => {
              if (e.key === "Enter") {
                submit();
              } else if (!"0123456789".split("").includes(e.key)) {
                e.preventDefault();
              }
            }}
            onpaste={(e) => e.preventDefault()}
            type="search"
            placeholder="Search for a number"
            class="text-center text-lg"
          />
          <Button type="submit" class="gap-2">Search</Button>
        </div>
      </form>
    </div>
  </div>
</div>
