<script lang="ts">
  import type { PhysicalLifecycle, PhysicalTeamSnapshot } from "#lib/mathex/physical.schemas.js";
  import { wrongAttempts } from "./standings.js";

  let { team, round }: { team: PhysicalTeamSnapshot; round: PhysicalLifecycle } = $props();
  const count = $derived(team.questions.length);
</script>

<div class="question-track" aria-hidden="true">
  <div class="question-track-cells" style:--n={count}>
    {#each team.questions as question (question.questionNumber)}
      <span
        class:solved={question.outcome === "correct"}
        class:skipped={question.outcome === "skipped"}
        class:current={round !== "finished" && round !== "lobby" && question.questionNumber === team.currentQuestion}
        title={`Q${question.questionNumber}: ${question.outcome}${question.incorrect ? `, ${wrongAttempts(question.incorrect)}` : ""}`}
      ></span>
    {/each}
  </div>
</div>
