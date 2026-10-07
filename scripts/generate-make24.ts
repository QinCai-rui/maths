import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { solve, tagDifficulty, type Difficulty } from "../src/lib/make24/solver";

interface Puzzle {
  cards: number[];
  solutionCount: number;
  needsFractions: boolean;
  difficulty: Difficulty;
  sample: string;
}

const puzzles: Puzzle[] = [];
for (let a = 1; a <= 13; a++) {
  for (let b = a; b <= 13; b++) {
    for (let c = b; c <= 13; c++) {
      for (let d = c; d <= 13; d++) {
        const cards = [a, b, c, d];
        const { solutions, needsFractions } = solve(cards);
        if (solutions.length === 0) continue;
        puzzles.push({
          cards,
          solutionCount: solutions.length,
          needsFractions,
          difficulty: tagDifficulty(solutions.length, needsFractions),
          sample: solutions[0]!
        });
      }
    }
  }
}

const outPath = join(import.meta.dir, "..", "src", "lib", "make24", "puzzles.json");
writeFileSync(outPath, JSON.stringify(puzzles, null, 1) + "\n");

const byDifficulty = { easy: 0, medium: 0, hard: 0 };
for (const p of puzzles) byDifficulty[p.difficulty]++;
console.log(`Wrote ${puzzles.length} puzzles to ${outPath}`);
console.log(`easy=${byDifficulty.easy} medium=${byDifficulty.medium} hard=${byDifficulty.hard}`);
