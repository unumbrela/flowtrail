"""Durable at-most-once dispatch with explicit uncertainty and read-only reconciliation."""

from __future__ import annotations

from contextlib import contextmanager
from collections.abc import Iterator

import hashlib
import json
import re
import sqlite3
import time
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlencode, urlsplit

TERMINAL = {"completed", "failed", "terminated", "timed_out", "canceled"}
ID = re.compile(r"^[a-f0-9]{32}$")


class Problem(Exception):
    """An actionable error safe to expose to the UI."""

    def __init__(self, status: int, code: str) -> None:
        self.status = status
        self.code = code
        super().__init__(code)


class Upstream(Protocol):
    async def call(self, method: str, path: str, body: dict | None = None) -> Any:
        """Call Skyvern with the authenticated caller's credentials."""
        ...


class Store:
    """Use a unique org/key pair and committed dispatch markers across process restarts."""

    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS operations (
                org TEXT NOT NULL, id TEXT NOT NULL, digest TEXT NOT NULL,
                state TEXT NOT NULL, session_id TEXT, run_id TEXT, submit INTEGER NOT NULL,
                created_at REAL NOT NULL, updated_at REAL NOT NULL, detail TEXT,
                session_state TEXT, action TEXT, PRIMARY KEY(org, id))""")

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        """Open a short-lived connection; never hold a transaction over network IO."""
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def read(self, org: str, key: str) -> dict:
        """Return only operations within the authenticated organization."""
        with self.connect() as db:
            row = db.execute("SELECT * FROM operations WHERE org=? AND id=?", (org, key)).fetchone()
        if row is None:
            raise Problem(404, "operation_not_found")
        return dict(row)

    def claim(self, org: str, key: str, digest: str, submit: bool) -> tuple[dict, bool]:
        """Atomically claim a request; reject reuse of a key for a different payload."""
        now = time.time()
        with self.connect() as db:
            cursor = db.execute(
                "INSERT OR IGNORE INTO operations (org,id,digest,state,submit,created_at,updated_at) "
                "VALUES (?,?,?,'creating_session',?,?,?)",
                (org, key, digest, int(submit), now, now),
            )
            fresh = cursor.rowcount == 1
        row = self.read(org, key)
        if row["digest"] != digest:
            raise Problem(409, "idempotency_conflict")
        return row, fresh

    def update(self, org: str, key: str, **values: Any) -> dict:
        """Persist internal state transitions; field names never come from the caller."""
        allowed = {"state", "session_id", "run_id", "detail", "session_state", "action"}
        if not values.keys() <= allowed:
            raise ValueError("Invalid state fields")
        values["updated_at"] = time.time()
        with self.connect() as db:
            db.execute(
                "UPDATE operations SET "
                + ",".join(f"{field}=?" for field in values)
                + " WHERE org=? AND id=?",
                (*values.values(), org, key),
            )
        return self.read(org, key)

    def recover(self) -> None:
        """Single-worker startup marks interrupted work uncertain, never redispatches it."""
        with self.connect() as db:
            db.execute(
                "UPDATE operations SET state='unknown', detail='coordinator_restarted' "
                "WHERE state IN ('creating_session','creating_task')"
            )
            db.execute("UPDATE operations SET action=NULL WHERE action IS NOT NULL")

    def claim_action(self, org: str, key: str, action: str) -> bool:
        """Serialize cancel/close requests, even across simultaneous HTTP handlers."""
        with self.connect() as db:
            return (
                db.execute(
                    "UPDATE operations SET action=? WHERE org=? AND id=? AND action IS NULL",
                    (action, org, key),
                ).rowcount
                == 1
            )


def validate(payload: dict, allow_fixture: bool = False) -> None:
    """Accept only the bounded questionnaire task shape, not arbitrary backend options."""
    task = payload.get("request")
    if not isinstance(task, dict) or type(payload.get("submit")) is not bool:
        raise Problem(422, "invalid_request")
    if set(task) - {
        "title",
        "url",
        "prompt",
        "engine",
        "proxy_location",
        "max_steps",
        "error_code_mapping",
    }:
        raise Problem(422, "unsupported_task_option")
    if task.get("engine") != "skyvern-1.0" or task.get("proxy_location") != "NONE":
        raise Problem(422, "unsupported_engine")
    if type(task.get("max_steps")) is not int or not 1 <= task["max_steps"] <= 30:
        raise Problem(422, "invalid_step_limit")
    if not isinstance(task.get("prompt"), str) or not 1 <= len(task["prompt"]) <= 550000:
        raise Problem(422, "invalid_prompt")
    try:
        url = urlsplit(task.get("url", ""))
        host = url.hostname or ""
        wjx = any(
            host == domain or host.endswith("." + domain)
            for domain in ("wjx.cn", "wjx.top", "wjx.com")
        )
        fixture = (
            allow_fixture and host == "form-demo" and url.port == 8765 and url.path == "/wjx.html"
        )
        if url.scheme not in ("http", "https") or url.username or url.password:
            raise ValueError()
        if not fixture and (not wjx or url.port or url.path in ("", "/")):
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise Problem(422, "invalid_questionnaire_url") from None


class Coordinator:
    """Coordinate side effects without pretending the upstream offers exactly-once delivery."""

    def __init__(self, store: Store, allow_fixture: bool = False) -> None:
        self.store = store
        self.allow_fixture = allow_fixture

    @staticmethod
    def public(row: dict) -> dict:
        """Expose references and states only, never credentials or submitted answers."""
        return {
            key: row[key]
            for key in (
                "id",
                "state",
                "session_id",
                "run_id",
                "submit",
                "created_at",
                "updated_at",
                "detail",
                "session_state",
                "action",
            )
        }

    async def create(self, org: str, key: str, payload: dict, upstream: Upstream) -> dict:
        """Persist intent before each external create; duplicate requests only read it back."""
        if not ID.fullmatch(key):
            raise Problem(422, "invalid_operation_id")
        validate(payload, self.allow_fixture)
        digest = hashlib.sha256(
            json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()
        ).hexdigest()
        row, fresh = self.store.claim(org, key, digest, payload["submit"])
        if not fresh:
            return self.public(row)
        try:
            session = await upstream.call(
                "POST",
                "/v1/browser_sessions",
                {
                    "timeout": 60,
                    "proxy_location": "NONE",
                    "needs_live_view": True,
                },
            )
            session_id = session["browser_session_id"]
            if not re.fullmatch(r"pbs_[a-zA-Z0-9_-]+", session_id):
                raise ValueError("invalid session response")
            self.store.update(org, key, state="creating_task", session_id=session_id)
            # The correlation title is set by this server, not supplied by the browser.
            task = {
                **payload["request"],
                "title": f"FlowTrail {key}",
                "browser_session_id": session_id,
            }
            result = await upstream.call("POST", "/v1/run/tasks", task)
            run_id = result["run_id"]
            if not re.fullmatch(r"tsk_[a-zA-Z0-9_-]+", run_id):
                raise ValueError("invalid run response")
            row = self.store.update(org, key, state="ready", run_id=run_id, detail=None)
        except Exception:
            # Even an HTTP error can follow an upstream side effect. Never resend creates.
            row = self.store.read(org, key)
            if not row["run_id"]:
                row = self.store.update(org, key, state="unknown", detail="creation_unconfirmed")
        return self.public(row)

    async def refresh(self, org: str, key: str, upstream: Upstream) -> dict:
        """Recover a lost task response by exact correlation and verify current resource state."""
        row = self.store.read(org, key)
        if not row["run_id"] and row["session_id"]:
            candidates = await upstream.call(
                "GET",
                "/api/v1/runs?"
                + urlencode(
                    {
                        "page": 1,
                        "page_size": 100,
                        "search_key": f"FlowTrail {key}",
                    }
                ),
            )
            matches = [
                run
                for run in candidates
                if run.get("title") == f"FlowTrail {key}"
                and run.get("browser_session_id") == row["session_id"]
            ]
            if len(candidates) >= 100:
                row = self.store.update(org, key, state="unknown", detail="recovery_search_limit")
            elif len(matches) == 1:
                run_id = matches[0].get("task_id") or matches[0].get("run_id")
                if isinstance(run_id, str) and re.fullmatch(r"tsk_[a-zA-Z0-9_-]+", run_id):
                    row = self.store.update(org, key, state="ready", run_id=run_id, detail=None)
            elif len(matches) > 1:
                row = self.store.update(org, key, state="unknown", detail="ambiguous_run_matches")
        result = self.public(row)
        if row["run_id"]:
            run = await upstream.call("GET", f"/v1/runs/{row['run_id']}")
            result["run_status"] = run["status"]
            result["failure_reason"] = run.get("failure_reason")
            result["can_cancel"] = run["status"] not in TERMINAL
            result["can_close"] = run["status"] in TERMINAL and row["session_state"] != "closed"
        if row["session_id"] and row["session_state"] != "closed":
            try:
                session = await upstream.call("GET", f"/v1/browser_sessions/{row['session_id']}")
                closed = session.get("completed_at") is not None or session.get("status") in (
                    "completed",
                    "closed",
                    "timeout",
                    "timed_out",
                    "failed",
                )
                result["session_state"] = "closed" if closed else session.get("status", "available")
                result["session_started_at"] = session.get("started_at")
                result["session_timeout_minutes"] = session.get("timeout")
                if closed:
                    self.store.update(org, key, session_state="closed")
                    result["can_close"] = False
            except Problem as error:
                if error.status != 404:
                    raise
                result["session_state"] = "unavailable"
                result["can_close"] = False
        return result

    async def action(self, org: str, key: str, action: str, upstream: Upstream) -> dict:
        """Verify live run state before cancellation or releasing a browser session."""
        if action not in ("cancel", "close"):
            raise Problem(404, "unknown_action")
        self.store.read(org, key)
        if not self.store.claim_action(org, key, action):
            raise Problem(409, "action_in_progress")
        try:
            current = await self.refresh(org, key, upstream)
            if not current["run_id"]:
                raise Problem(409, "creation_still_uncertain")
            if action == "cancel":
                if (
                    current["run_status"] not in TERMINAL
                    and current["detail"] != "cancel_requested"
                ):
                    await upstream.call("POST", f"/v1/runs/{current['run_id']}/cancel", {})
                    self.store.update(org, key, detail="cancel_requested")
            elif current["session_state"] != "closed":
                if current["run_status"] not in TERMINAL:
                    raise Problem(409, "run_still_active")
                await upstream.call(
                    "POST", f"/v1/browser_sessions/{current['session_id']}/close", {}
                )
                self.store.update(org, key, detail="close_requested")
            return await self.refresh(org, key, upstream)
        finally:
            self.store.update(org, key, action=None)
