// Real local lifecycle verification. Uses fictional data and incurs model usage.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import path from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const creds = await readFile(
  path.join(root, ".skyvern/credentials.toml"),
  "utf8",
);
const key = creds.match(/"?cred"?\s*=\s*"([^"\n]+)"/m)?.[1];
if (!key) throw new Error("Missing local credential");
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
const id = randomUUID().replaceAll("-", "");
const request = buildQuestionnaireRequest({
  url: "https://v.wjx.cn/vm/demo.aspx",
  information: "姓名：测试用户（虚构资料）",
  answers: [],
  submit: false,
});
request.url = `http://form-demo:8765/wjx.html?case=${id}`;
async function call(suffix = "", body, expected = 200) {
  const response = await fetch(
    `http://127.0.0.1:8001/v1/operations/${id}${suffix}`,
    {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(75000),
    },
  );
  assert.equal(response.status, expected);
  return response.json();
}
const created = await call("", { request, submit: false });
assert.ok(created.run_id, `Creation uncertain: inspect ${id}`);
const output = path.join(root, "artifacts/flowtrail");
await mkdir(output, { recursive: true });
await writeFile(
  path.join(output, "lifecycle-latest.json"),
  JSON.stringify(
    { id, run_id: created.run_id, session_id: created.session_id },
    null,
    2,
  ),
);
console.log(`Started cancellation verification: ${id} (${created.run_id})`);
const active = await call();
assert.ok(
  !terminalRunStatuses.has(active.run_status),
  "Task ended before cancellation could be exercised",
);
await call("/close", {}, 409);
await call("/cancel", {});
await call("/cancel", {});
let result;
for (let i = 0; i < 90; i++) {
  result = await call();
  if (terminalRunStatuses.has(result.run_status)) break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.equal(
  result.run_status,
  "canceled",
  "Cancellation did not reach the canceled state",
);
await call("/close", {});
await call("/close", {});
result = await call();
assert.equal(result.session_state, "closed");
await writeFile(
  path.join(output, `${id}-verification.json`),
  JSON.stringify(
    {
      ...result,
      checks: [
        "active-close-rejected",
        "cancel-confirmed",
        "repeated-cancel-safe",
        "repeated-close-safe",
      ],
    },
    null,
    2,
  ),
);
console.log(
  "Verified active-run close guard, cancellation confirmation and repeated resource release",
);
