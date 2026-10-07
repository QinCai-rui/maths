// Generate the Crossmath puzzle pool: deterministic, committed to git.
import { generate, TEMPLATES } from "../src/lib/crossmath/generator";

const COUNTS: Record<string, number> = { easy: 30, medium: 30, hard: 20 };

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const started = Date.now();
const puzzles = [];
for (const template of TEMPLATES) {
  const want = COUNTS[template.difficulty] ?? 10;
  const rng = mulberry32(0xc4055 + template.id.length * 7919 + template.size * 131);
  let made = 0;
  let serial = 1;
  while (made < want) {
    const id = `crossmath-${template.difficulty}-${serial}`;
    const puzzle = generate(template, rng, id);
    serial++;
    if (!puzzle) continue;
    if (puzzles.some((p) => JSON.stringify(p.solution) === JSON.stringify(puzzle.solution))) continue;
    puzzles.push(puzzle);
    made++;
    if (serial > 5000) throw new Error(`template ${template.id} stalled`);
  }
  console.log(`${template.difficulty}: ${made} puzzles`);
}

await Bun.write(new URL("../src/lib/crossmath/puzzles.json", import.meta.url), JSON.stringify(puzzles, null, 2) + "\n");
console.log(`wrote ${puzzles.length} puzzles in ${((Date.now() - started) / 1000).toFixed(1)}s`);
