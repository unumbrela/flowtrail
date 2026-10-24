// Exercise the actual request builder against the local fixture and configured model.
// Each execution has isolated evidence; run sequentially to control model usage.
import { build } from "esbuild";
import { randomUUID } from "node:crypto";
import { checkEvidence } from "./questionnaire-evidence.mjs";
import { Buffer } from "node:buffer";
import process from "node:process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output =
  process.env.FLOWTRAIL_EVAL_OUTPUT || path.join(root, "artifacts/wenjuanxing");
const startedAt = new Date().toISOString();
const started = performance.now();
const mode = process.argv[2] ?? "fill";
const lifecycle = process.argv.includes("--lifecycle");
const operationId = randomUUID().replaceAll("-", "");
if (!["fill", "submit", "missing"].includes(mode)) {
  throw new Error(
    "Usage: node scripts/wenjuanxing-smoke.mjs [fill|submit|missing]",
  );
}
const credentials = await readFile(
  path.join(root, ".skyvern/credentials.toml"),
  "utf8",
);
const key = credentials.match(/"?cred"?\s*=\s*"([^"\n]+)"/m)?.[1];
if (!key) throw new Error("Local Skyvern credential is missing");

async function api(route, payload, base = "http://127.0.0.1:8000/v1") {
  const response = await fetch(`${base}${route}`, {
    method: payload === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok)
    throw new Error(`Local Skyvern returned HTTP ${response.status}`);
  return response.json();
}

const caseId = randomUUID().replaceAll("-", "");
async function readEvidence() {
  const response = await fetch(
    `http://127.0.0.1:8765/evidence?case=${caseId}`,
    {
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok)
    throw new Error("Fixture evidence endpoint unavailable; restart form-demo");
  return response.json();
}
// Fail before spending model tokens if the fixture server has not been updated.
await readEvidence();

const compiled = await build({
  entryPoints: [
    path.join(root, "skyvern-frontend/src/routes/wenjuanxing/wenjuanxing.ts"),
  ],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { buildQuestionnaireRequest, terminalRunStatuses } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);
const dataset = JSON.parse(
  await readFile(
    new URL("./evals/questionnaires.json", import.meta.url),
    "utf8",
  ),
);
const scenario = process.env.FLOWTRAIL_EVAL_SCENARIO
  ? dataset.cases.find(
      (item) => item.id === process.env.FLOWTRAIL_EVAL_SCENARIO,
    )
  : null;
if (
  process.env.FLOWTRAIL_EVAL_SCENARIO &&
  (!scenario || scenario.mode !== mode)
)
  throw new Error("Invalid evaluation scenario");
const expected = scenario?.expected ?? {
  full_name: "测试小林",
  email: "xiaolin@example.com",
  role: "软件工程师",
  introduction: "我用 Python 开发浏览器自动化。",
  demo_confirmed: true,
  attendance: "线上",
  hobbies: ["阅读", "运动"],
};
const request = buildQuestionnaireRequest({
  url: "https://v.wjx.cn/vm/local-fixture.aspx",
  information: [
    `姓名：${expected.full_name}`,
    ...(mode === "missing" ? [] : [`邮箱：${expected.email}`]),
    `职业：${expected.role}`,
    `参加方式：${expected.attendance}`,
    `个人介绍：${expected.introduction}`,
    "确认使用虚构演示信息：是",
  ].join("\n"),
  answers: [{ question: "兴趣爱好", answer: expected.hobbies.join("、") }],
  submit: mode === "submit",
});
// Test-only override; the product intentionally accepts only WJX domains.
request.url = `http://form-demo:8765/wjx.html?case=${caseId}`;
await mkdir(output, { recursive: true });
async function lifecycleApi(route, payload, expectedStatus = 200) {
  const response = await fetch(`http://127.0.0.1:8001/v1${route}`, {
    method: payload === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(75000),
  });
  if (response.status !== expectedStatus)
    throw new Error(
      `Lifecycle HTTP ${response.status}, expected ${expectedStatus}`,
    );
  return response.json();
}
let session;
let run;
const payload = { request, submit: mode === "submit" };
// Persist correlation BEFORE dispatch, including unknown-response and timeout attempts.
await writeFile(
  path.join(output, "attempt.json"),
  JSON.stringify(
    {
      started_at: startedAt,
      case_id: caseId,
      operation_id: lifecycle ? operationId : null,
      scenario_id: scenario?.id ?? mode,
    },
    null,
    2,
  ),
);
if (lifecycle) {
  const responses = await Promise.all([
    lifecycleApi(`/operations/${operationId}`, payload),
    lifecycleApi(`/operations/${operationId}`, payload),
  ]);
  const created = responses.find((item) => item.run_id);
  if (!created)
    throw new Error(
      `Creation uncertain. Inspect operation ${operationId}; do not start a new operation.`,
    );
  session = { browser_session_id: created.session_id };
  run = { run_id: created.run_id };
  const replay = await lifecycleApi(`/operations/${operationId}`, payload);
  if (
    replay.run_id !== run.run_id ||
    replay.session_id !== session.browser_session_id
  )
    throw new Error("Replay changed resource IDs");
  await lifecycleApi(
    `/operations/${operationId}`,
    { ...payload, submit: !payload.submit },
    409,
  );
  console.log(
    `Concurrent create, replay and conflict verified: ${operationId}`,
  );
} else {
  session = await api("/browser_sessions", {
    timeout: 15,
    proxy_location: "NONE",
    needs_live_view: true,
  });
  run = await api("/run/tasks", {
    ...request,
    browser_session_id: session.browser_session_id,
  });
}
await writeFile(
  path.join(output, `${mode}-latest.json`),
  JSON.stringify(
    {
      run_id: run.run_id,
      session_id: session.browser_session_id,
      case_id: caseId,
      operation_id: lifecycle ? operationId : undefined,
    },
    null,
    2,
  ),
);
console.log(`Started ${mode}: ${run.run_id}`);
let lastStatus;
for (let attempt = 0; attempt < 180; attempt++) {
  const result = await api(`/runs/${run.run_id}`);
  if (result.status !== lastStatus) console.log(`Status: ${result.status}`);
  lastStatus = result.status;
  if (terminalRunStatuses.has(result.status)) {
    await writeFile(
      path.join(output, `${run.run_id}.json`),
      JSON.stringify(result, null, 2),
    );
    // Allow the fixture's final DOM observation to reach its server.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const evidence = await readEvidence();
    const verdict = checkEvidence({ mode, caseId, result, evidence, expected });
    const report = {
      schema_version: 1,
      dataset_version: dataset.version,
      scenario_id: scenario?.id ?? mode,
      started_at: startedAt,
      elapsed_seconds: (performance.now() - started) / 1000,
      mode,
      case_id: caseId,
      run_id: run.run_id,
      observed_at: new Date().toISOString(),
      operation_id: lifecycle ? operationId : undefined,
      model_status: result.status,
      evidence,
      ...verdict,
    };
    await writeFile(
      path.join(output, `${run.run_id}-verification.json`),
      JSON.stringify(report, null, 2),
    );
    if (lifecycle) {
      const restored = await lifecycleApi(`/operations/${operationId}`);
      if (restored.run_id !== run.run_id)
        throw new Error("Reconciliation lost the task reference");
      await lifecycleApi(`/operations/${operationId}/close`, {});
      await lifecycleApi(`/operations/${operationId}/close`, {});
      const closed = await lifecycleApi(`/operations/${operationId}`);
      if (closed.session_state !== "closed")
        throw new Error("Session close was not confirmed");
      const history = await api(
        `/runs?search_key=${encodeURIComponent(`FlowTrail ${operationId}`)}&page_size=100`,
        undefined,
        "http://127.0.0.1:8000/api/v1",
      );
      if (
        history.filter((item) => item.title === `FlowTrail ${operationId}`)
          .length !== 1
      )
        throw new Error("Expected exactly one correlated task");
      console.log(
        "Verified one correlated task, recovered status and idempotent session close",
      );
    } else {
      await api(`/browser_sessions/${session.browser_session_id}/close`, {});
    }
    await writeFile(
      path.join(output, "execution-complete.json"),
      JSON.stringify({ cleanup_confirmed: lifecycle }),
    );
    if (!verdict.passed) {
      throw new Error(
        `Evidence check failed: ${verdict.failures.join("; ")}. Report: ${output}/${run.run_id}-verification.json`,
      );
    }
    console.log(
      `Verified DOM values, case-scoped receipts and termination reason: ${mode} (${caseId})`,
    );
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
throw new Error(
  `Polling timed out; inspect existing run ${run.run_id} before starting another`,
);
