/** All planned attempts remain in the denominator; missing results never imply a pass. */
export function summarize(attempts) {
  const counts = {};
  for (const attempt of attempts)
    counts[attempt.outcome] = (counts[attempt.outcome] ?? 0) + 1;
  const durations = attempts
    .filter(
      (a) => a.outcome !== "pending" && Number.isFinite(a.elapsed_seconds),
    )
    .map((a) => a.elapsed_seconds)
    .sort((a, b) => a - b);
  const percentile = (fraction) =>
    durations.length
      ? durations[Math.ceil(durations.length * fraction) - 1]
      : null;
  return {
    planned: attempts.length,
    finished: attempts.length - (counts.pending ?? 0),
    passed: counts.passed ?? 0,
    pass_rate: attempts.length ? (counts.passed ?? 0) / attempts.length : null,
    outcomes: counts,
    latency_seconds: {
      sample_count: durations.length,
      p50: percentile(0.5),
      p95: percentile(0.95),
    },
  };
}

/** A passing field verdict cannot hide an execution or cleanup failure. */
export function classifyAttempt({
  code,
  timedOut,
  verification,
  cleanupConfirmed,
}) {
  if (timedOut) return "timeout";
  if (!cleanupConfirmed)
    return code === 0 ? "missing_evidence" : "execution_error";
  if (verification?.passed === false) return "evidence_failed";
  if (code !== 0) return "execution_error";
  return verification?.passed === true ? "passed" : "missing_evidence";
}
