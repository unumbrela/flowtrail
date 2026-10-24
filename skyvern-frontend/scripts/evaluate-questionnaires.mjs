// Sequential model-backed evaluation. Every planned attempt is saved before execution.
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { configuredModelSnapshot } from "./eval-environment.mjs";
import { summarize, classifyAttempt } from "./eval-summary.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const repeat = Number(process.argv[2] ?? 2);
if (
  !Number.isInteger(repeat) ||
  repeat < 1 ||
  repeat > 10 ||
  process.argv.length > 4
)
  throw new Error(
    "Usage: node scripts/evaluate-questionnaires.mjs [repeat: 1..10] [scenario-id]",
  );
const datasetBytes = await readFile(
  new URL("./evals/questionnaires.json", import.meta.url),
);
const dataset = JSON.parse(datasetBytes);
const cases = process.argv[3]
  ? dataset.cases.filter((item) => item.id === process.argv[3])
  : dataset.cases;
if (!cases.length) throw new Error("Unknown scenario ID");
async function readModelConfiguration() {
  try {
    const credentials = await readFile(
      path.join(root, ".skyvern/credentials.toml"),
      "utf8",
    );
    const key = credentials.match(/"?cred"?\s*=\s*"([^"\n]+)"/m)?.[1];
    if (!key) throw new Error("missing credential");
    const get = async (route) => {
      const response = await fetch(`http://127.0.0.1:8000${route}`, {
        headers: { "x-api-key": key },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("metadata unavailable");
      return response.json();
    };
    const [identity, models] = await Promise.all([
      get("/api/v1/organizations/me"),
      get("/v1/custom-llms"),
    ]);
    return {
      ...configuredModelSnapshot(identity, models),
      observed_at: new Date().toISOString(),
    };
  } catch {
    return {
      source: "configuration_api",
      status: "unavailable",
      model_name: null,
    };
  }
}
const sourceFiles = [
  "skyvern-frontend/scripts/evals/questionnaires.json",
  "skyvern-frontend/scripts/wenjuanxing-smoke.mjs",
  "skyvern-frontend/scripts/questionnaire-evidence.mjs",
  "skyvern-frontend/scripts/evaluate-questionnaires.mjs",
  "skyvern-frontend/scripts/eval-summary.mjs",
  "skyvern-frontend/scripts/eval-environment.mjs",
  "skyvern-frontend/src/routes/wenjuanxing/wenjuanxing.ts",
  "flowtrail_service/coordinator.py",
  "flowtrail_service/api.py",
  "local-demo/server.py",
  "local-demo/wjx.html",
];
const hashes = Object.fromEntries(
  await Promise.all(
    sourceFiles.map(async (file) => [
      file,
      createHash("sha256")
        .update(await readFile(path.join(root, file)))
        .digest("hex"),
    ]),
  ),
);
const suiteId = `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`;
const output = path.join(root, "artifacts/evaluations", suiteId);
await mkdir(output, { recursive: true });
const report = {
  schema_version: 1,
  suite_id: suiteId,
  dataset_version: dataset.version,
  scope: dataset.scope,
  started_at: new Date().toISOString(),
  environment: {
    node: process.version,
    git_commit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    working_tree_dirty: !!execFileSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    source_sha256: hashes,
    configured_model: await readModelConfiguration(),
    model: process.env.FLOWTRAIL_EVAL_MODEL_LABEL || null,
    model_label_source: process.env.FLOWTRAIL_EVAL_MODEL_LABEL
      ? "operator_supplied_not_verified"
      : "not_recorded",
    tokens: null,
    cost: null,
  },
  attempts: Array.from({ length: repeat }, (_, index) =>
    cases.map((scenario) => ({
      scenario_id: scenario.id,
      mode: scenario.mode,
      repetition: index + 1,
      outcome: "pending",
    })),
  ).flat(),
};
async function save() {
  report.summary = summarize(report.attempts);
  await writeFile(
    path.join(output, "summary.json.tmp"),
    JSON.stringify(report, null, 2),
  );
  await rename(
    path.join(output, "summary.json.tmp"),
    path.join(output, "summary.json"),
  );
}
await save();
console.log(
  `Evaluation: ${output} (${report.attempts.length} planned attempts)`,
);
for (const [index, attempt] of report.attempts.entries()) {
  const directory = path.join(output, String(index + 1).padStart(2, "0"));
  await mkdir(directory);
  const started = performance.now();
  attempt.started_at = new Date().toISOString();
  await save();
  const result = await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["scripts/wenjuanxing-smoke.mjs", attempt.mode, "--lifecycle"],
      {
        cwd: path.join(root, "skyvern-frontend"),
        env: {
          ...process.env,
          FLOWTRAIL_EVAL_OUTPUT: directory,
          FLOWTRAIL_EVAL_SCENARIO: attempt.scenario_id,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let log = "";
    let timedOut = false;
    child.stdout.on("data", (data) => {
      log += data;
      process.stdout.write(data);
    });
    child.stderr.on("data", (data) => {
      log += data;
    });
    const timer = setTimeout(
      () => {
        timedOut = true;
        child.kill("SIGTERM");
      },
      12 * 60 * 1000,
    );
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: null, log, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, log, timedOut });
    });
  });
  attempt.elapsed_seconds =
    Math.round((performance.now() - started) / 10) / 100;
  attempt.exit_code = result.code;
  await writeFile(path.join(directory, "execution.log"), result.log);
  const files = await readdir(directory);
  const verificationFile = files.find((file) =>
    file.endsWith("-verification.json"),
  );
  const verification = verificationFile
    ? JSON.parse(await readFile(path.join(directory, verificationFile), "utf8"))
    : null;
  const marker = files.includes("attempt.json")
    ? JSON.parse(await readFile(path.join(directory, "attempt.json"), "utf8"))
    : {};
  const latest = files.includes(`${attempt.mode}-latest.json`)
    ? JSON.parse(
        await readFile(
          path.join(directory, `${attempt.mode}-latest.json`),
          "utf8",
        ),
      )
    : {};
  attempt.operation_id = latest.operation_id ?? marker.operation_id ?? null;
  attempt.run_id = latest.run_id ?? null;
  attempt.case_id = latest.case_id ?? marker.case_id ?? null;
  attempt.verification = verificationFile
    ? `${String(index + 1).padStart(2, "0")}/${verificationFile}`
    : null;
  const completion = files.includes("execution-complete.json")
    ? JSON.parse(
        await readFile(path.join(directory, "execution-complete.json"), "utf8"),
      )
    : null;
  attempt.outcome = classifyAttempt({
    ...result,
    verification,
    cleanupConfirmed: completion?.cleanup_confirmed === true,
  });
  attempt.failures = verification?.failures ?? [];
  await save();
  console.log(
    `${index + 1}/${report.attempts.length}: ${attempt.scenario_id} = ${attempt.outcome}`,
  );
  // Uncertain execution may still be active. Stop spending and retain remaining pending rows.
  if (
    ["timeout", "execution_error", "missing_evidence"].includes(attempt.outcome)
  )
    break;
}
report.finished_at = new Date().toISOString();
await save();
console.log(JSON.stringify(report.summary, null, 2));
console.log(`Report: ${output}/summary.json`);
process.exitCode = report.summary.passed === report.summary.planned ? 0 : 1;
