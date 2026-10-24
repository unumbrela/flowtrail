"""Verify case isolation and receipt semantics without a model or Docker."""

import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from server import FixtureServer


class FixtureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.server = FixtureServer(("127.0.0.1", 0), Path(__file__).parent, Path(self.temp.name))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"
        self.case = "a" * 32

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, route, payload=None):
        req = Request(
            self.base + route,
            data=json.dumps(payload).encode() if payload is not None else None,
            headers={"Content-Type": "application/json"},
        )
        with urlopen(req, timeout=5) as response:
            return json.load(response)

    def test_observations_are_not_submissions_and_cases_are_isolated(self):
        payload = {"case_id": self.case, "page": 2, "values": {"email": "fake@example.com"}}
        self.request("/observe", payload)
        evidence = self.request(f"/evidence?case={self.case}")
        self.assertEqual(evidence["observation"], payload)
        self.assertEqual(evidence["receipts"], [])
        other = self.request(f"/evidence?case={'b' * 32}")
        self.assertIsNone(other["observation"])
        self.assertEqual(other["receipts"], [])

    def test_receipts_preserve_selections_and_duplicate_submissions(self):
        payload = dict(
            case_id=self.case,
            full_name="Demo",
            email="fake@example.com",
            role="工程师",
            introduction="Demo",
            demo_confirmed=True,
            attendance="线上",
            hobbies=["阅读", "运动"],
        )
        first = self.request("/submit", payload)
        self.assertEqual(first["attendance"], "线上")
        self.assertEqual(first["hobbies"], ["阅读", "运动"])
        self.request("/submit", payload)
        evidence = self.request(f"/evidence?case={self.case}")
        self.assertEqual(len(evidence["receipts"]), 2)
        self.assertNotEqual(
            evidence["receipts"][0]["receipt_id"], evidence["receipts"][1]["receipt_id"]
        )

    def test_bad_evidence_is_rejected(self):
        for route, data in [
            ("/evidence?case=../bad", None),
            ("/observe", {"case_id": self.case, "page": 3, "values": {}}),
            ("/submit", {"case_id": self.case}),
            ("/observe", []),
        ]:
            with self.subTest(route=route, data=data), self.assertRaises(HTTPError) as error:
                self.request(route, data)
            self.assertEqual(error.exception.code, 400)

    def test_generic_fixture_submission_remains_supported(self):
        receipt = self.request(
            "/submit",
            dict(
                full_name="Demo",
                email="fake@example.com",
                role="Engineer",
                introduction="Demo",
                demo_confirmed="on",
            ),
        )
        self.assertIn("receipt_id", receipt)


if __name__ == "__main__":
    unittest.main()
