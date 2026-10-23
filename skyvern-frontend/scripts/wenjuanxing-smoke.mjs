// Exercise the actual request builder against the local fixture and configured model.
// Run sequentially: receipt counts assume no other local demo submission is in flight.
import { build } from "esbuild";
import { Buffer } from "node:buffer";
import process from "node:process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = path.join(root, "artifacts/wenjuanxing");
const mode = process.argv[2] ?? "fill";
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

async function api(route, payload) {
  const response = await fetch(`http://127.0.0.1:8000/v1${route}`, {
    method: payload === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok)
    throw new Error(`Local Skyvern returned HTTP ${response.status}`);
  return response.json();
}

async function receipts() {
  try {
    const content = await readFile(
      path.join(root, "artifacts/local-demo/submissions.jsonl"),
      "utf8",
    );
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

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
const expected = {
  full_name: "测试小林",
  email: "xiaolin@example.com",
  role: "软件工程师",
  introduction: "我用 Python 开发浏览器自动化。",
  demo_confirmed: true,
};
const request = buildQuestionnaireRequest({
  url: "https://v.wjx.cn/vm/local-fixture.aspx",
  information: [
    `姓名：${expected.full_name}`,
    ...(mode === "missing" ? [] : [`邮箱：${expected.email}`]),
    `职业：${expected.role}`,
    "参加方式：线上",
    `个人介绍：${expected.introduction}`,
    "确认使用虚构演示信息：是",
  ].join("\n"),
  answers: [{ question: "兴趣爱好", answer: "阅读、运动" }],
  submit: mode === "submit",
});
// Test-only override; the product intentionally accepts only WJX domains.
request.url = "http://form-demo:8765/wjx.html";
const before = await receipts();
await mkdir(output, { recursive: true });
const session = await api("/browser_sessions", {
  timeout: 15,
  proxy_location: "NONE",
  needs_live_view: true,
});
const run = await api("/run/tasks", {
  ...request,
  browser_session_id: session.browser_session_id,
});
await writeFile(
  path.join(output, `${mode}-latest.json`),
  JSON.stringify(
    { run_id: run.run_id, session_id: session.browser_session_id },
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
    const after = await receipts();
    const expectedCount = before.length + (mode === "submit" ? 1 : 0);
    const statusOK =
      mode === "missing"
        ? result.status === "terminated"
        : result.status === "completed";
    const fieldsOK =
      mode !== "submit" ||
      Object.entries(expected).every(
        ([key, value]) => after.at(-1)?.[key] === value,
      );
    await api(`/browser_sessions/${session.browser_session_id}/close`, {});
    if (!statusOK || after.length !== expectedCount || !fieldsOK) {
      throw new Error(
        `Smoke check failed; inspect ${output}/${run.run_id}.json and run screenshots`,
      );
    }
    console.log(
      "Verified final status and server receipt count/fields. Inspect run screenshots for individual selections.",
    );
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
throw new Error(
  `Polling timed out; inspect existing run ${run.run_id} before starting another`,
);
