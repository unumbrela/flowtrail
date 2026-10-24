"""Versioned, minimal execution summaries; executor status is not field verification."""

from datetime import datetime, timezone


def build_report(operation: dict, run: dict | None) -> dict:
    """Export allowlisted metadata without prompts, answers, URLs or free-form errors."""
    run = run or {}
    duration = None
    try:
        start = datetime.fromisoformat(run["started_at"])
        end = datetime.fromisoformat(run["finished_at"])
        seconds = (end - start).total_seconds()
        if seconds >= 0:
            duration = round(seconds, 3)
    except (KeyError, TypeError, ValueError):
        pass
    # Error codes are bounded to known product categories; reasoning can contain PII.
    known = {"MISSING_INFORMATION", "HUMAN_REQUIRED", "SURVEY_UNAVAILABLE"}
    codes = sorted(
        {
            error.get("error_code") if error.get("error_code") in known else "OTHER"
            for error in run.get("errors", []) or []
            if isinstance(error, dict)
        }
    )
    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "operation_id": operation["id"],
        "run_id": operation.get("run_id"),
        "session_id": operation.get("session_id"),
        "mode": "submit" if operation["submit"] else "fill",
        "coordination_state": operation["state"],
        "session_state": operation.get("session_state"),
        "executor": {
            "source": "skyvern_run_api",
            "status": run.get("status", "unknown"),
            "started_at": run.get("started_at"),
            "finished_at": run.get("finished_at"),
            "duration_seconds": duration,
            "error_codes": codes,
        },
        "verification": {
            "status": "not_verified",
            "fields": "not_observed",
            "submission": "not_observed",
            "reason": "No independent field or receipt evidence is attached to this operation.",
        },
        "usage": {"tokens": None, "cost": None, "reason": "not_available_from_run_api"},
    }
