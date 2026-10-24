// Produce a compact shareable summary without raw answers or execution logs.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { summarize } from "./eval-summary.mjs";

const input = process.argv[2];
if (!input)
  throw new Error(
    "Usage: node scripts/render-evaluation.mjs path/to/summary.json",
  );
const report = JSON.parse(await readFile(input, "utf8"));
const summary = summarize(report.attempts);
const cell = (value) =>
  String(value ?? "unknown")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
const lines = [
  "# FlowTrail local questionnaire evaluation",
  "",
  `Dataset: ${cell(report.dataset_version)}. Suite: ${cell(report.suite_id)}.`,
  "",
  `Scope: ${cell(report.scope)}.`,
  "",
  `Passed ${summary.passed}/${summary.planned} planned attempts; ${summary.finished} finished.`,
  `Wall-clock latency: p50 ${summary.latency_seconds.p50 ?? "unknown"}s; p95 ${summary.latency_seconds.p95 ?? "unknown"}s (n=${summary.latency_seconds.sample_count}).`,
  "",
  "| Scenario | Repeat | Outcome | Seconds | Run | Failures |",
  "| --- | --- | --- | --- | --- | --- |",
  ...report.attempts.map(
    (a) =>
      `| ${[a.scenario_id, a.repetition, a.outcome, a.elapsed_seconds, a.run_id, (a.failures ?? []).join("; ") || "—"].map(cell).join(" | ")} |`,
  ),
  "",
  "All planned attempts remain in the denominator. Pending attempts are not passes.",
  "This small fixed-fixture sample is not a production success rate or cross-site benchmark.",
  `Configured model: ${cell(report.environment.configured_model?.model_name)} (${cell(report.environment.configured_model?.source)}).`,
  `Model label: ${cell(report.environment.model)} (${cell(report.environment.model_label_source)}). Tokens/cost are unavailable.`,
  `Git base: ${cell(report.environment.git_commit)}; dirty working tree: ${report.environment.working_tree_dirty}. Exact source hashes are in summary.json.`,
  "",
];
const target = path.join(path.dirname(input), "report.md");
await writeFile(target, lines.join("\n"));
console.log(target);
