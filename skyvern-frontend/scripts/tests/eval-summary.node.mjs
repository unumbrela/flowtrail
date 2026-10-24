import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, classifyAttempt } from "../eval-summary.mjs";

test("failed, infrastructure and pending attempts remain in denominator", () => {
  const result = summarize([
    { outcome: "passed", elapsed_seconds: 10 },
    { outcome: "evidence_failed", elapsed_seconds: 30 },
    { outcome: "execution_error", elapsed_seconds: 20 },
    { outcome: "pending" },
  ]);
  assert.equal(result.pass_rate, 0.25);
  assert.equal(result.finished, 3);
  assert.deepEqual(result.latency_seconds, {
    sample_count: 3,
    p50: 20,
    p95: 30,
  });
});
test("no data is unknown rather than a zero latency or perfect score", () => {
  assert.equal(summarize([]).pass_rate, null);
  assert.equal(summarize([{ outcome: "pending" }]).latency_seconds.p50, null);
});

test("cleanup failures cannot be hidden by a passing or failing field verdict", () => {
  for (const passed of [true, false]) {
    assert.equal(
      classifyAttempt({
        code: 1,
        verification: { passed },
        cleanupConfirmed: false,
      }),
      "execution_error",
    );
  }
  assert.equal(
    classifyAttempt({
      code: 1,
      verification: { passed: false },
      cleanupConfirmed: true,
    }),
    "evidence_failed",
  );
  assert.equal(
    classifyAttempt({
      code: 0,
      verification: { passed: true },
      cleanupConfirmed: true,
    }),
    "passed",
  );
  assert.equal(
    classifyAttempt({ code: 0, cleanupConfirmed: true }),
    "missing_evidence",
  );
  assert.equal(classifyAttempt({ code: null, timedOut: true }), "timeout");
});
