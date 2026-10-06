<script lang="ts">
  import { getNumberFacts, getNumberOfTheDay } from "#lib/number-facts.js";
  import { ArrowUpRight, Calculator, Gamepad2, Hash } from "@lucide/svelte/icons";

  const today = new Date();
  const utcDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const featuredNumber = getNumberOfTheDay(utcDay);
  const facts = getNumberFacts(featuredNumber);
  const primeLabel = facts.isPrime ? "Prime" : facts.primeFactorisation;
  const dateLabel = new Intl.DateTimeFormat("en", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC"
  }).format(today);

  const shortFactors =
    facts.factors.length > 6
      ? `${facts.factors.slice(0, 5).join(", ")}, …, ${facts.factors.at(-1)}`
      : facts.factors.join(", ");
  const dailyFacts = [
    { label: "Even or odd", value: facts.isEven ? "Even" : "Odd" },
    { label: "Prime or factors", value: primeLabel },
    { label: "Prime factors", value: facts.primeFactorisation },
    { label: "Perfect square", value: facts.isSquare ? "Yes" : "No" },
    { label: "Triangular", value: facts.isTriangular ? "Yes" : "No" },
    { label: "Factors", value: shortFactors }
  ];
</script>

<div class="site-home">
  <main class="site-wrap">
    <section class="site-hero">
      <div>
        <p class="site-eyebrow">Numbers, games and competitions</p>
        <h1 class="site-title">Mathematics, <em>worth lingering over.</em></h1>
        <p class="site-lead">Explore number facts, play maths games, or host a Mathex competition.</p>
        <div class="site-actions">
          <a class="site-button site-button-primary" href="/tools"><Gamepad2 class="h-4 w-4" /> Explore the tools</a>
          <a class="site-button site-button-secondary" href="/mathex"><Calculator class="h-4 w-4" /> About Mathex</a>
        </div>
      </div>

      <aside class="site-daily" aria-labelledby="daily-number-heading">
        <div id="daily-number-heading" class="sr-only">Number of the day</div>
        <div class="site-daily-number">{featuredNumber}</div>
        <div class="site-daily-date">Number of the day · {dateLabel} UTC</div>
        <dl class="site-daily-facts">
          {#each dailyFacts as fact}
            <div class="site-daily-fact">
              <dt><small>{fact.label}</small></dt>
              <dd><strong>{fact.value}</strong></dd>
            </div>
          {/each}
        </dl>
        <p class="site-daily-description">
          <a href={`/utilities/number/${featuredNumber}`}
            >See all facts about {featuredNumber} <ArrowUpRight class="inline h-3.5 w-3.5" /></a
          >
        </p>
      </aside>
    </section>

    <section class="site-section" aria-labelledby="ways-heading">
      <div class="site-section-head">
        <h2 id="ways-heading">Find your way in</h2>
        <span>Explore the site</span>
      </div>
      <div class="site-ways">
        <a class="site-way" href="/tools#explore">
          <h3>Number facts</h3>
          <p>Explore factors, patterns and surprising properties for any whole number.</p>
          <span class="site-way-action">Look up a number</span>
        </a>
        <a class="site-way" href="/tools#games">
          <h3>Maths games</h3>
          <p>Quick puzzles for pattern-spotting, number sense and mental arithmetic.</p>
          <span class="site-way-action">Find a game</span>
        </a>
        <a class="site-way" href="/mathex">
          <h3>Live Mathex</h3>
          <p>Host a room or race your friends through a real-time maths competition.</p>
          <span class="site-way-action">About Mathex</span>
        </a>
      </div>
    </section>
  </main>
</div>
