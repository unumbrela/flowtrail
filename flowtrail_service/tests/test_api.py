"""Exercise the real ASGI boundary with isolated upstream HTTP responses."""

import json
import tempfile
import unittest
from pathlib import Path

import httpx

from flowtrail_service.api import create_app
from flowtrail_service.coordinator import Store

KEY = "a" * 32
PAYLOAD = {
    "submit": False,
    "request": {
        "url": "https://v.wjx.cn/vm/test.aspx",
        "prompt": "fictional",
        "engine": "skyvern-1.0",
        "proxy_location": "NONE",
        "max_steps": 30,
    },
}


class ApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.posts = []

        async def upstream(request):
            key = request.headers.get("x-api-key")
            if request.url.path == "/api/v1/organizations/me":
                if key not in ("test-a", "test-b"):
                    return httpx.Response(401, json={"secret": "must not escape"})
                return httpx.Response(200, json={"organization_id": "org_" + key})
            if request.method == "POST":
                self.posts.append(request.url.path)
            if request.url.path == "/v1/browser_sessions":
                return httpx.Response(200, json={"browser_session_id": "pbs_1"})
            if request.url.path == "/v1/run/tasks":
                self.assertEqual(json.loads(request.content)["title"], f"FlowTrail {KEY}")
                return httpx.Response(200, json={"run_id": "tsk_1"})
            if request.url.path == "/v1/runs/tsk_1":
                return httpx.Response(200, json={"status": "completed"})
            if request.url.path == "/v1/browser_sessions/pbs_1":
                return httpx.Response(200, json={"status": "running"})
            raise AssertionError(request.url)

        self.upstream = httpx.AsyncClient(
            transport=httpx.MockTransport(upstream), base_url="http://upstream"
        )
        self.app = create_app(Store(Path(self.temp.name) / "db"), self.upstream)
        self.lifespan = self.app.router.lifespan_context(self.app)
        await self.lifespan.__aenter__()
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app), base_url="http://test"
        )

    async def asyncTearDown(self):
        await self.client.aclose()
        await self.lifespan.__aexit__(None, None, None)
        await self.upstream.aclose()
        self.temp.cleanup()

    async def test_authentication_and_org_isolation(self):
        url = f"/v1/operations/{KEY}"
        self.assertEqual((await self.client.post(url, json=PAYLOAD)).status_code, 401)
        denied = await self.client.post(url, json=PAYLOAD, headers={"x-api-key": "wrong"})
        self.assertEqual(denied.status_code, 401)
        self.assertNotIn("secret", denied.text)
        self.assertEqual(
            (
                await self.client.post(url, json=PAYLOAD, headers={"x-api-key": "test-a"})
            ).status_code,
            200,
        )
        self.assertEqual(
            (await self.client.get(url, headers={"x-api-key": "test-b"})).status_code, 404
        )
        result = await self.client.get(url, headers={"x-api-key": "test-a"})
        self.assertEqual(result.json()["run_status"], "completed")
        self.assertNotIn("fictional", result.text)

    async def test_report_uses_auth_and_org_boundary_without_creating_resources(self):
        url = f"/v1/operations/{KEY}"
        await self.client.post(url, json=PAYLOAD, headers={"x-api-key": "test-a"})
        for headers, status in [({}, 401), ({"x-api-key": "test-b"}, 404)]:
            response = await self.client.get(url + "/report", headers=headers)
            self.assertEqual(response.status_code, status)
        report = await self.client.get(url + "/report", headers={"x-api-key": "test-a"})
        self.assertEqual(report.status_code, 200)
        self.assertEqual(report.json()["verification"]["status"], "not_verified")
        self.assertEqual(report.json()["executor"]["status"], "completed")
        self.assertEqual(len(self.posts), 2)

    async def test_replay_conflict_and_cors(self):
        url = f"/v1/operations/{KEY}"
        headers = {"x-api-key": "test-a"}
        for _ in range(2):
            self.assertEqual(
                (await self.client.post(url, json=PAYLOAD, headers=headers)).status_code, 200
            )
        self.assertEqual(len(self.posts), 2)
        self.assertEqual(
            (
                await self.client.post(url, json={**PAYLOAD, "submit": True}, headers=headers)
            ).status_code,
            409,
        )
        denied = await self.client.options(
            url,
            headers={
                "Origin": "https://untrusted.example",
                "Access-Control-Request-Method": "POST",
            },
        )
        self.assertEqual(denied.status_code, 400)
        allowed = await self.client.options(
            url,
            headers={
                "Origin": "http://localhost:8080",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "x-api-key",
            },
        )
        self.assertEqual(allowed.status_code, 200)

    async def test_invalid_json_id_and_payload(self):
        headers = {"x-api-key": "test-a"}
        self.assertEqual(
            (
                await self.client.post(f"/v1/operations/{KEY}", content="{broken", headers=headers)
            ).status_code,
            422,
        )
        self.assertEqual(
            (
                await self.client.post("/v1/operations/bad", json=PAYLOAD, headers=headers)
            ).status_code,
            422,
        )
        self.assertEqual(
            (await self.client.post(f"/v1/operations/{KEY}", json=[], headers=headers)).status_code,
            422,
        )
        self.assertEqual(self.posts, [])


if __name__ == "__main__":
    unittest.main()
