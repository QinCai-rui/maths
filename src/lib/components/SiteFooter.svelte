<script lang="ts">
  const buildCommit = __BUILD_COMMIT__;
  const buildTime = __BUILD_TIME__;
</script>

<footer class="site-footer">
  <div class="site-wrap site-footer-inner">
    <div>
      <p class="font-medium text-foreground">
        Made with ♥ by <a href="https://qincai.xyz">Raymont</a> to celebrate Maths Week.
      </p>
      <p>Originally made by <a href="https://devarsh.me">Devarsh</a> as a side project in Room 22 @ BBI.</p>
    </div>
    <p class="site-build">Built with SvelteKit · Tailwind CSS · Bun<br />git:{buildCommit} · build:{buildTime}</p>
  </div>
</footer>
