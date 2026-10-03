<script lang="ts">
  import { Brain, Calculator, CircleDot, Gamepad2, Hash, Pencil, Radio, Zap } from "@lucide/svelte/icons";

  const numberTools = [
    {
      name: "Number facts",
      description: "Look up a whole number to see its factors, prime factorisation and other patterns.",
      url: "/utilities/number",
      action: "Explore a number",
      kind: "Number explorer",
      icon: Hash
    }
  ];

  const games = [
    {
      name: "Digitle",
      description: "Guess the hidden five-digit number in six tries. Each guess reveals which digits belong.",
      url: "/tools/digitle",
      action: "Play Digitle",
      kind: "Number guessing",
      icon: Gamepad2
    },
    {
      name: "Basic Facts",
      description: "Race the clock through arithmetic, multiplication, powers and square roots.",
      url: "/tools/basic-facts",
      action: "Start a round",
      kind: "Timed arithmetic",
      icon: Zap
    },
    {
      name: "Sequencing",
      description: "Spot the rule in a number pattern and choose what should come next.",
      url: "/tools/sequencing",
      action: "Find the pattern",
      kind: "Pattern practice",
      icon: Brain
    },
    {
      name: "Factor Finder",
      description: "Find every number that divides the target with no remainder.",
      url: "/tools/factor-finder",
      action: "Find the factors",
      kind: "Divisibility",
      icon: CircleDot
    }
  ];

  const mathexTools = [
    {
      name: "Mathex Set Editor",
      description: "Create and edit question sets for a Mathex round.",
      url: "/mathex/app/create/editor",
      action: "Open the editor",
      kind: "For event hosts",
      icon: Pencil
    },
    {
      name: "Mathex Live Dashboard",
      description: "Score and project an in-person Mathex competition in real time.",
      url: "/mathex/app/live",
      action: "Set up a dashboard",
      kind: "For event hosts",
      icon: Radio
    }
  ];
</script>

<svelte:head>
  <title>Tools and games — Raymont's Maths</title>
  <meta name="description" content="Look up number facts, play Digitle and try maths games." />
</svelte:head>

<main class="site-wrap site-page">
  <header>
    <h1 class="site-page-title">Maths tools and games</h1>
    <p class="site-page-intro">
      Look up a number, try a quick game, or use the tools to prepare and run a Mathex event.
    </p>
  </header>

  <section class="site-section" id="number-facts" aria-labelledby="number-tools-heading">
    <div class="site-section-head">
      <h2 id="number-tools-heading">Number facts</h2>
      <span>Look up a whole number</span>
    </div>
    <div class="site-tool-grid">
      {#each numberTools as tool}
        <a class="site-tool" href={tool.url}>
          <span class="site-tool-type">{tool.kind}</span>
          <h3><tool.icon class="mr-2 inline h-4 w-4 text-primary" />{tool.name}</h3>
          <p>{tool.description}</p>
          <span class="site-tool-action">{tool.action} <span aria-hidden="true">↗</span></span>
        </a>
      {/each}
    </div>
  </section>

  <section class="site-section" id="games" aria-labelledby="games-heading">
    <div class="site-section-head">
      <h2 id="games-heading">Maths games</h2>
      <span>Choose a game</span>
    </div>
    <div class="site-tool-grid">
      {#each games as game}
        <a class="site-tool" href={game.url}>
          <span class="site-tool-type">{game.kind}</span>
          <h3><game.icon class="mr-2 inline h-4 w-4 text-primary" />{game.name}</h3>
          <p>{game.description}</p>
          <span class="site-tool-action">{game.action} <span aria-hidden="true">↗</span></span>
        </a>
      {/each}
    </div>
  </section>

  <section class="site-section" id="mathex-tools" aria-labelledby="mathex-tools-heading">
    <div class="site-section-head">
      <h2 id="mathex-tools-heading">For Mathex hosts</h2>
      <span>Prepare or run a competition</span>
    </div>
    <div class="site-tool-grid">
      {#each mathexTools as tool}
        <a class="site-tool" href={tool.url}>
          <span class="site-tool-type">{tool.kind}</span>
          <h3><tool.icon class="mr-2 inline h-4 w-4 text-primary" />{tool.name}</h3>
          <p>{tool.description}</p>
          <span class="site-tool-action">{tool.action} <span aria-hidden="true">↗</span></span>
        </a>
      {/each}
    </div>
  </section>
</main>
