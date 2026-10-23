import { gzipSync } from "node:zlib";
import { appendFileSync } from "node:fs";

const entries = await Promise.all(
  Array.from(new Bun.Glob("**/*.js").scanSync("build/client")).map(async (path) => {
    const bytes = await Bun.file(`build/client/${path}`).bytes();
    return { path, bytes: bytes.byteLength, gzip: gzipSync(bytes).byteLength };
  })
);
if (entries.length === 0) throw new Error("No client JavaScript found in the production build");
entries.sort((left, right) => right.gzip - left.gzip);
const report = [
  "## JavaScript bundle report",
  "",
  "These are build sizes, not per-page transfer sizes. No performance threshold has been calibrated yet.",
  "",
  "| Largest assets | Raw bytes | Gzip bytes |",
  "| --- | ---: | ---: |",
  ...entries.slice(0, 15).map(({ path, bytes, gzip }) => `| ${path} | ${bytes} | ${gzip} |`),
  ""
].join("\n");
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
