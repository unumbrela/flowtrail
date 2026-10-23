"""Run the fictional form demo against local Skyvern; never print credentials."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASE = 'http://127.0.0.1:8000/v1'


def request(path: str, payload: dict | None = None, method: str | None = None, base: str = BASE) -> dict:
    """Call the local API using its generated organization credential."""
    credentials = (ROOT / '.skyvern/credentials.toml').read_text()
    match = re.search(r'"?cred"?\s*=\s*"([^\"]+)"', credentials, re.MULTILINE)
    if not match:
        raise RuntimeError('Local Skyvern credential is missing')
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(base + path, data=data, method=method, headers={
        'x-api-key': match.group(1), 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        message = error.read().decode().replace(match.group(1), '[REDACTED]')
        for line in (ROOT / '.env.bailian').read_text().splitlines():
            if line.startswith('OPENAI_COMPATIBLE_API_KEY='):
                message = message.replace(line.split('=', 1)[1].strip(), '[REDACTED]')
        raise RuntimeError(f'API HTTP {error.code}: {message[:2000]}') from None


def main() -> None:
    """Submit one bounded task and save its final response for review."""
    parser = argparse.ArgumentParser()
    parser.add_argument('--run-id', help='Resume polling an existing run without new model usage')
    args = parser.parse_args()
    run_id = args.run_id
    receipts_file = ROOT / 'artifacts/local-demo/submissions.jsonl'
    initial_count = len(receipts_file.read_text().splitlines()) if receipts_file.exists() else 0
    if not run_id:
        result = request('/run/tasks', {
            'title': 'Bailian Qwen - local form demo',
            'url': 'http://form-demo:8765/form.html',
            'engine': 'skyvern-1.0', 'proxy_location': 'NONE', 'max_steps': 10,
            'prompt': 'Complete and submit this local demo form using these fictional details: '
                      'Full name: Alex Demo; Email: alex.demo@example.com; Role: Agent Engineer; '
                      'Introduction: I build reliable browser agents with Python. '
                      'Check the fictional demo details checkbox. Submit the form once. '
                      'Success means the page displays Application received and a receipt_id.',
            'data_extraction_schema': {'type': 'object', 'properties': {
                'receipt_id': {'type': 'string'}, 'full_name': {'type': 'string'},
                'email': {'type': 'string'}, 'role': {'type': 'string'}},
                'required': ['receipt_id', 'full_name', 'email', 'role']},
        })
        run_id = result['run_id']
        print('Created:', run_id, flush=True)
    last_status = None
    for _ in range(120):
        result = request('/runs/' + run_id)
        status = result.get('status')
        if status != last_status:
            print('Status:', status, flush=True)
            last_status = status
        if status in ('completed', 'failed', 'terminated', 'timed_out', 'canceled'):
            output = ROOT / 'artifacts/local-demo' / (run_id + '.json')
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(result, indent=2, ensure_ascii=False))
            print('Result:', output, flush=True)
            print(json.dumps({k: result.get(k) for k in ('status', 'output', 'failure_reason')}, ensure_ascii=False))
            if status != 'completed':
                raise SystemExit(1)
            if not args.run_id:
                receipts = [json.loads(line) for line in receipts_file.read_text().splitlines()]
                expected = {
                    'full_name': 'Alex Demo', 'email': 'alex.demo@example.com',
                    'role': 'Agent Engineer', 'demo_confirmed': 'on',
                    'introduction': 'I build reliable browser agents with Python.',
                }
                new_receipts = receipts[initial_count:]
                if not any(all(r.get(k) == v for k, v in expected.items()) for r in new_receipts):
                    raise SystemExit('Agent completed, but matching server receipt was not found')
                print('Verified: matching submission persisted by the form server')
            return
        time.sleep(5)
    raise SystemExit('Still running; resume with --run-id ' + run_id)


if __name__ == '__main__':
    main()
