import { isDeepStrictEqual } from "node:util";

/** Judge model status against independent local fixture observations and receipts. */
export function checkEvidence({ mode, caseId, result, evidence, expected }) {
  const failures = [];
  const checks = [];
  const require = (condition, message) => {
    checks.push({ failure_message: message, passed: !!condition });
    if (!condition) failures.push(message);
  };
  require(evidence.case_id === caseId, "Evidence belongs to a different case");
  const observation = evidence.observation;
  require(observation?.case_id ===
    caseId, "Missing DOM observation for this case");
  const receipts = evidence.receipts ?? [];
  require(receipts.every(
    (receipt) => receipt.case_id === caseId,
  ), "Unrelated receipt in evidence");
  require(receipts.length ===
    (mode === "submit" ? 1 : 0), "Unexpected submission count");

  if (mode === "missing") {
    require(result.status ===
      "terminated", "Missing-information run did not terminate");
    const missing = result.errors?.find(
      (error) => error.error_code === "MISSING_INFORMATION",
    );
    require(!!missing, "Missing structured MISSING_INFORMATION error");
    require(/email|邮箱/i.test(
      missing?.reasoning ?? "",
    ), "Missing-information error does not identify email");
    require(observation?.values?.email ===
      "", "Missing email was fabricated or not observed");
  } else {
    require(result.status === "completed", "Run did not complete");
    // After submission the form is hidden; fill-only must reach the final page.
    if (mode === "fill")
      require(observation?.page ===
        2, "Fill-only did not stop on the final form page");
    for (const [field, value] of Object.entries(expected)) {
      const normalize = (item) =>
        field === "hobbies" && Array.isArray(item) ? [...item].sort() : item;
      require(isDeepStrictEqual(
        normalize(observation?.values?.[field]),
        normalize(value),
      ), `DOM mismatch: ${field}`);
      if (mode === "submit") {
        require(isDeepStrictEqual(
          normalize(receipts[0]?.[field]),
          normalize(value),
        ), `Receipt mismatch: ${field}`);
      }
    }
  }
  return { passed: failures.length === 0, failures, checks };
}
