"""Local fixture with separate observed form state and submission evidence."""

import json
import os
import re
import socket
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

CASE_ID = re.compile(r"^[a-f0-9]{32}$")


class FixtureServer(ThreadingHTTPServer):
    """Keep fixture storage isolated and serialize evidence reads and writes."""

    def __init__(self, address: tuple[str, int], directory: Path, data: Path) -> None:
        self.directory = directory
        self.data = data
        self.data.mkdir(parents=True, exist_ok=True)
        self.evidence_lock = Lock()
        super().__init__(address, Handler)


class Handler(SimpleHTTPRequestHandler):
    """Serve local pages and collect bounded, fictional test evidence."""

    server: FixtureServer

    def __init__(
        self, request: socket.socket, client_address: tuple[str, int], server: FixtureServer
    ) -> None:
        super().__init__(request, client_address, server, directory=str(server.directory))

    def reply(self, payload: dict, status: int = 200) -> None:
        """Return JSON without caching evidence."""
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def records(self, name: str) -> list[dict]:
        """Read a local evidence stream while the caller holds the lock."""
        path = self.server.data / name
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text().splitlines() if line]

    def do_GET(self) -> None:
        """Expose evidence only for the requested fixture case."""
        url = urlsplit(self.path)
        if url.path != "/evidence":
            super().do_GET()
            return
        case_id = parse_qs(url.query).get("case", [""])[0]
        if not CASE_ID.fullmatch(case_id):
            self.reply({"error": "invalid case"}, 400)
            return
        with self.server.evidence_lock:
            observations = [
                r for r in self.records("observations.jsonl") if r.get("case_id") == case_id
            ]
            receipts = [r for r in self.records("submissions.jsonl") if r.get("case_id") == case_id]
        self.reply(
            {
                "case_id": case_id,
                "observation": observations[-1] if observations else None,
                "receipts": receipts,
            }
        )

    def do_POST(self) -> None:
        """Store observed values independently from actual form submissions."""
        if self.path not in ("/submit", "/observe"):
            self.reply({"error": "not found"}, 404)
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size < 16384:
                raise ValueError("invalid size")
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError("invalid payload")
            case_id = data.get("case_id")
            if case_id is not None and (
                not isinstance(case_id, str) or not CASE_ID.fullmatch(case_id)
            ):
                raise ValueError("invalid case")
            if self.path == "/observe":
                if (
                    not case_id
                    or not isinstance(data.get("values"), dict)
                    or data.get("page") not in (0, 1, 2)
                ):
                    raise ValueError("invalid observation")
                result = {"case_id": case_id, "values": data["values"], "page": data["page"]}
                filename = "observations.jsonl"
            else:
                required = ("full_name", "email", "role", "introduction", "demo_confirmed")
                if not all(data.get(key) for key in required):
                    raise ValueError("missing fields")
                result = {
                    "receipt_id": "DEMO-" + uuid4().hex[:8],
                    **{key: data[key] for key in required},
                }
                # Preserve the older generic form fixture; test cases require all WJX fields.
                if case_id:
                    if data.get("attendance") not in ("线上", "线下") or not isinstance(
                        data.get("hobbies"), list
                    ):
                        raise ValueError("invalid selections")
                    result.update(
                        case_id=case_id, attendance=data["attendance"], hobbies=data["hobbies"]
                    )
                filename = "submissions.jsonl"
        except (ValueError, UnicodeDecodeError):
            self.reply({"error": "invalid fixture payload"}, 400)
            return
        with self.server.evidence_lock:
            with (self.server.data / filename).open("a") as stream:
                stream.write(json.dumps(result, ensure_ascii=False) + "\n")
        self.reply(result)


if __name__ == "__main__":
    FixtureServer(
        ("0.0.0.0", int(os.environ.get("FIXTURE_PORT", "8765"))),
        Path(os.environ.get("FIXTURE_DIRECTORY", "/demo")),
        Path(os.environ.get("FIXTURE_DATA", "/data")),
    ).serve_forever()
