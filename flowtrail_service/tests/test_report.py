"""Test report privacy and the distinction between completion and verification."""

import json
import unittest
from flowtrail_service.report import build_report


class ReportTests(unittest.TestCase):
    def setUp(self):
        self.operation = {"id": "a" * 32, "submit": False, "state": "ready", "run_id": "tsk_1"}

    def test_completed_is_not_verification_and_private_payload_is_excluded(self):
        report = build_report(
            self.operation,
            {
                "status": "completed",
                "run_request": {"prompt": "PRIVATE"},
                "output": "PRIVATE",
                "failure_reason": "PRIVATE",
                "screenshot_urls": ["PRIVATE"],
                "errors": [
                    {"error_code": "MISSING_INFORMATION", "reasoning": "PRIVATE"},
                    {"error_code": "PRIVATE"},
                ],
                "started_at": "2026-10-24T10:00:00",
                "finished_at": "2026-10-24T10:00:12.5",
            },
        )
        self.assertNotIn("PRIVATE", json.dumps(report))
        self.assertEqual(report["verification"]["status"], "not_verified")
        self.assertEqual(report["executor"]["duration_seconds"], 12.5)
        self.assertEqual(report["executor"]["error_codes"], ["MISSING_INFORMATION", "OTHER"])
        self.assertIsNone(report["usage"]["cost"])

    def test_unknown_and_invalid_duration_remain_unknown(self):
        self.assertEqual(build_report(self.operation, None)["executor"]["status"], "unknown")
        for start, end in [
            (None, None),
            ("bad", "bad"),
            ("2026-10-24T10:00:12", "2026-10-24T10:00:00"),
        ]:
            report = build_report(self.operation, {"started_at": start, "finished_at": end})
            self.assertIsNone(report["executor"]["duration_seconds"])
