<script lang="ts">
  import { Github } from "@lucide/svelte/icons";

  const buildCommit = __BUILD_COMMIT__;
  const buildTime = __BUILD_TIME__;
</script>

<footer class="border-t border-border bg-muted/40">
  <div class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
    <div class="flex flex-col items-center justify-between gap-4 sm:flex-row">
      <div class="flex flex-col items-center gap-1 sm:items-start">
        <p class="text-sm font-medium text-foreground">
          Made with ♥ by <a href="https://qincai.xyz" class="underline-offset-4 hover:underline">Raymont</a> to celebrate
          Maths Week.
        </p>
        <p class="text-sm text-muted-foreground">
          Originally made by <a href="https://devarsh.me" class="font-medium underline-offset-4 hover:underline"
            >Devarsh</a
          > as a side project in Room 22 @ BBI.
        </p>
      </div>
      <a
        href="https://github.com/QinCai-rui/maths"
        target="_blank"
        class="text-muted-foreground transition-colors hover:text-foreground"
        aria-label="GitHub"
      >
        <Github class="h-5 w-5" />
      </a>
    </div>
    <div class="mt-6 border-t border-border/40 pt-6 text-center">
      <p class="text-xs text-muted-foreground">Built with SvelteKit, Tailwind CSS, and Bun.</p>
      <p class="mt-2 text-xs text-muted-foreground">
        <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.7rem] text-foreground/80"
          >git:{buildCommit} · build:{buildTime}</code
        >
      </p>
    </div>
  </div>
</footer>
