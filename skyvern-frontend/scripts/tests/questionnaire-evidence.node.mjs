import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEvidence } from "../questionnaire-evidence.mjs";

const expected = {
  email: "test@example.com",
  attendance: "线上",
  hobbies: ["阅读", "运动"],
  demo_confirmed: true,
};
const base = () => ({
  mode: "fill",
  caseId: "case-a",
  expected,
  result: { status: "completed" },
  evidence: {
    case_id: "case-a",
    observation: {
      case_id: "case-a",
      page: 2,
      values: structuredClone(expected),
    },
    receipts: [],
  },
});

test("completed status alone is insufficient", () => {
  const input = base();
  input.evidence.observation = null;
  assert.equal(checkEvidence(input).passed, false);
});
test("fill verifies all DOM values regardless of checkbox order", () => {
  const input = base();
  input.evidence.observation.values.hobbies.reverse();
  assert.equal(checkEvidence(input).passed, true);
  input.evidence.observation.values.attendance = "线下";
  assert.ok(checkEvidence(input).failures.includes("DOM mismatch: attendance"));
});
test("wrong or extra checkbox values fail", () => {
  const input = base();
  input.evidence.observation.values.hobbies.push("音乐");
  assert.equal(checkEvidence(input).passed, false);
});
test("fill rejects any submission and an unfinished page", () => {
  const input = base();
  input.evidence.receipts = [{ case_id: "case-a", ...expected }];
  assert.equal(checkEvidence(input).passed, false);
  input.evidence.receipts = [];
  input.evidence.observation.page = 1;
  assert.equal(checkEvidence(input).passed, false);
});
test("submit requires exactly one matching receipt including selections", () => {
  const input = base();
  input.mode = "submit";
  input.evidence.receipts = [{ case_id: "case-a", ...expected }];
  assert.equal(checkEvidence(input).passed, true);
  input.evidence.receipts[0].hobbies = ["阅读"];
  assert.ok(
    checkEvidence(input).failures.includes("Receipt mismatch: hobbies"),
  );
  input.evidence.receipts.push({ case_id: "case-a", ...expected });
  assert.ok(
    checkEvidence(input).failures.includes("Unexpected submission count"),
  );
});
test("evidence and receipts cannot come from another case", () => {
  const input = base();
  input.evidence.case_id = "case-b";
  assert.equal(checkEvidence(input).passed, false);
  input.evidence.case_id = "case-a";
  input.evidence.observation.case_id = "case-b";
  assert.equal(checkEvidence(input).passed, false);
  input.mode = "submit";
  input.evidence.observation.case_id = "case-a";
  input.evidence.receipts = [{ case_id: "case-b", ...expected }];
  assert.equal(checkEvidence(input).passed, false);
});
test("missing requires structured reason identifying email and an empty observed email", () => {
  const input = base();
  input.mode = "missing";
  input.result = {
    status: "terminated",
    errors: [{ error_code: "MISSING_INFORMATION", reasoning: "缺少必填邮箱" }],
  };
  input.evidence.observation.values.email = "";
  assert.equal(checkEvidence(input).passed, true);
  input.result.errors[0].reasoning = "姓名缺失";
  assert.equal(checkEvidence(input).passed, false);
  input.result.errors[0].reasoning = "Missing email";
  input.evidence.observation.values.email = "invented@example.com";
  assert.equal(checkEvidence(input).passed, false);
});
test("unrelated termination does not satisfy missing-information scenario", () => {
  const input = base();
  input.mode = "missing";
  input.result = {
    status: "terminated",
    failure_reason: "email",
    errors: [{ error_code: "HUMAN_REQUIRED", reasoning: "email" }],
  };
  input.evidence.observation.values.email = "";
  assert.equal(checkEvidence(input).passed, false);
});
