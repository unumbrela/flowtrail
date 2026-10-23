"""Local-only form fixture, storing fictional submissions for smoke verification."""
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import uuid4

DATA = Path('/data')
DATA.mkdir(exist_ok=True)

class Handler(SimpleHTTPRequestHandler):
    """Serve the fixture and accept bounded local demonstration submissions."""
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory='/demo', **kwargs)

    def do_POST(self) -> None:
        """Validate and persist a fictional submission before returning its receipt."""
        if self.path != '/submit':
            self.send_error(404)
            return
        size = int(self.headers.get('Content-Length', '0'))
        if not 0 < size < 16384:
            self.send_error(400)
            return
        try:
            data = json.loads(self.rfile.read(size))
        except (ValueError, UnicodeDecodeError):
            self.send_error(400)
            return
        required = ('full_name', 'email', 'role', 'introduction', 'demo_confirmed')
        if not isinstance(data, dict) or not all(data.get(k) for k in required):
            self.send_error(400)
            return
        result = {'receipt_id': 'DEMO-' + uuid4().hex[:8], **{k: data[k] for k in required}}
        with (DATA / 'submissions.jsonl').open('a') as stream:
            stream.write(json.dumps(result) + '\n')
        body = json.dumps(result).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

ThreadingHTTPServer(('0.0.0.0', 8765), Handler).serve_forever()
