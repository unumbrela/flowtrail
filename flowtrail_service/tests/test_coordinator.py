"""Failure-injection tests for actual durable coordinator state transitions."""

import asyncio
import copy
import tempfile
import unittest
from pathlib import Path

from flowtrail_service.coordinator import Coordinator, Problem, Store

KEY = "a" * 32
PAYLOAD = {
    "submit": False,
    "request": {
        "title": "Test",
        "url": "https://v.wjx.cn/vm/demo.aspx",
        "prompt": "Private fictional answer",
        "engine": "skyvern-1.0",
        "proxy_location": "NONE",
        "max_steps": 30,
    },
}


class FakeUpstream:
    def __init__(self):
        self.posts = []
        self.runs = []
        self.status = "running"
        self.closed = False
        self.lose_session = False
        self.lose_task = False
        self.lose_close = False
        self.close_immediate = True
        self.pause = None

    async def call(self, method, path, body=None):
        if method == "POST":
            self.posts.append(path)
        if path == "/v1/browser_sessions":
            if self.pause:
                await self.pause.wait()
            if self.lose_session:
                raise Problem(503, "lost_response")
            return {"browser_session_id": "pbs_1"}
        if path == "/v1/run/tasks":
            self.runs.append(
                {
                    "task_id": "tsk_1",
                    "title": body["title"],
                    "browser_session_id": body["browser_session_id"],
                }
            )
            if self.lose_task:
                raise Problem(503, "lost_response")
            return {"run_id": "tsk_1"}
        if path.startswith("/api/v1/runs?"):
            return self.runs
        if path.endswith("/cancel"):
            return None  # Cancellation acceptance is not terminal confirmation.
        if path.endswith("/close"):
            self.closed = self.close_immediate
            if self.lose_close:
                raise Problem(503, "lost_close_response")
            return {}
        if path == "/v1/browser_sessions/pbs_1":
            return {"status": "completed" if self.closed else "running", "timeout": 60}
        if path == "/v1/runs/tsk_1":
            return {"status": self.status}
        raise AssertionError(path)


class CoordinatorTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "operations.db"
        self.store = Store(self.path)
        self.service = Coordinator(self.store)
        self.upstream = FakeUpstream()

    def tearDown(self):
        self.temp.cleanup()

    async def create(self, key=KEY, org="org_a", payload=None):
        return await self.service.create(org, key, payload or PAYLOAD, self.upstream)

    async def test_replay_is_durable_and_does_not_store_answers(self):
        first = await self.create()
        self.service = Coordinator(Store(self.path))
        self.assertEqual((await self.create())["run_id"], first["run_id"])
        self.assertEqual(self.upstream.posts, ["/v1/browser_sessions", "/v1/run/tasks"])
        row = self.store.read("org_a", KEY)
        self.assertNotIn("Private fictional answer", str(row))

    async def test_concurrent_requests_claim_once_across_store_instances(self):
        self.upstream.pause = asyncio.Event()
        first = asyncio.create_task(self.create())
        await asyncio.sleep(0)
        other = Coordinator(Store(self.path))
        duplicate = await other.create("org_a", KEY, PAYLOAD, self.upstream)
        self.assertEqual(duplicate["state"], "creating_session")
        self.upstream.pause.set()
        await first
        self.assertEqual(len(self.upstream.posts), 2)

    async def test_conflicting_payload_returns_409(self):
        await self.create()
        changed = copy.deepcopy(PAYLOAD)
        changed["request"]["prompt"] = "different"
        with self.assertRaises(Problem) as caught:
            await self.create(payload=changed)
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(len(self.upstream.posts), 2)

    async def test_org_isolation(self):
        await self.create()
        with self.assertRaises(Problem) as caught:
            await self.service.refresh("org_b", KEY, self.upstream)
        self.assertEqual(caught.exception.status, 404)
        await self.create(org="org_b")
        self.assertEqual(len(self.upstream.posts), 4)

    async def test_lost_task_response_recovers_without_redispatch(self):
        self.upstream.lose_task = True
        self.assertEqual((await self.create())["state"], "unknown")
        recovered = await self.service.refresh("org_a", KEY, self.upstream)
        self.assertEqual(recovered["run_id"], "tsk_1")
        self.assertEqual(recovered["run_status"], "running")
        await self.create()
        self.assertEqual(len(self.upstream.posts), 2)

    async def test_lost_session_response_stays_unknown_without_new_browser(self):
        self.upstream.lose_session = True
        self.assertEqual((await self.create())["state"], "unknown")
        self.service = Coordinator(Store(self.path))
        self.store.recover()
        await self.create()
        self.assertEqual(self.upstream.posts, ["/v1/browser_sessions"])
        with self.assertRaises(Problem):
            await self.service.action("org_a", KEY, "close", self.upstream)

    async def test_process_crash_never_restarts_a_create(self):
        self.upstream.pause = asyncio.Event()
        pending = asyncio.create_task(self.create())
        await asyncio.sleep(0)
        pending.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await pending
        self.store.recover()
        self.assertEqual((await self.create())["state"], "unknown")
        self.assertEqual(self.upstream.posts, ["/v1/browser_sessions"])

    async def test_reconciliation_requires_exact_title_and_session(self):
        self.upstream.lose_task = True
        await self.create()
        self.upstream.runs[0]["browser_session_id"] = "pbs_other"
        self.assertIsNone((await self.service.refresh("org_a", KEY, self.upstream))["run_id"])
        self.upstream.runs[0]["browser_session_id"] = "pbs_1"
        self.upstream.runs.append(dict(self.upstream.runs[0]))
        self.assertEqual(
            (await self.service.refresh("org_a", KEY, self.upstream))["detail"],
            "ambiguous_run_matches",
        )

    async def test_close_refuses_active_run_and_cancel_waits_for_terminal(self):
        await self.create()
        with self.assertRaises(Problem) as caught:
            await self.service.action("org_a", KEY, "close", self.upstream)
        self.assertEqual(caught.exception.code, "run_still_active")
        await self.service.action("org_a", KEY, "cancel", self.upstream)
        self.assertEqual(
            (await self.service.refresh("org_a", KEY, self.upstream))["run_status"], "running"
        )
        self.upstream.status = "canceled"
        await self.service.action("org_a", KEY, "close", self.upstream)
        await self.service.action("org_a", KEY, "close", self.upstream)
        self.assertEqual(self.upstream.posts.count("/v1/browser_sessions/pbs_1/close"), 1)

    async def test_close_acceptance_is_not_confirmation(self):
        await self.create()
        self.upstream.status = "completed"
        self.upstream.close_immediate = False
        result = await self.service.action("org_a", KEY, "close", self.upstream)
        self.assertNotEqual(result["session_state"], "closed")
        self.assertEqual(result["detail"], "close_requested")
        self.upstream.closed = True
        self.assertEqual(
            (await self.service.refresh("org_a", KEY, self.upstream))["session_state"], "closed"
        )

    async def test_lost_close_response_is_reconciled_before_retry(self):
        await self.create()
        self.upstream.status = "completed"
        self.upstream.lose_close = True
        with self.assertRaises(Problem):
            await self.service.action("org_a", KEY, "close", self.upstream)
        result = await self.service.action("org_a", KEY, "close", self.upstream)
        self.assertEqual(result["session_state"], "closed")
        self.assertEqual(self.upstream.posts.count("/v1/browser_sessions/pbs_1/close"), 1)

    async def test_action_lock_and_restart_release(self):
        await self.create()
        self.store.claim_action("org_a", KEY, "cancel")
        with self.assertRaises(Problem) as caught:
            await self.service.action("org_a", KEY, "close", self.upstream)
        self.assertEqual(caught.exception.code, "action_in_progress")
        self.store.recover()
        self.assertIsNone(self.store.read("org_a", KEY)["action"])

    async def test_rejects_unsafe_urls_and_backend_options(self):
        for url in [
            "http://127.0.0.1/private",
            "https://wjx.cn.evil.test/f",
            "https://u:p@wjx.cn/form",
            "https://wjx.cn:8443/f",
        ]:
            payload = copy.deepcopy(PAYLOAD)
            payload["request"]["url"] = url
            with self.assertRaises(Problem):
                await self.create(payload=payload)
        payload = copy.deepcopy(PAYLOAD)
        payload["request"]["webhook_url"] = "https://example.com"
        with self.assertRaises(Problem):
            await self.create(payload=payload)
        self.assertEqual(self.upstream.posts, [])


if __name__ == "__main__":
    unittest.main()
