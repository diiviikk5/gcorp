"""AgentCore Runtime entrypoint: the Gcorp engine as a hosted agent.

AgentCore Runtime speaks HTTP on :8080 — GET /ping for health, POST /invocations for work.
Payload: {"policy": str, "zone"?: str, "backend"?: "bedrock"|"rules"}
Returns the run (no grids), its confidence grade, and which backend each agent actually used.
Runs are archived to S3 and indexed in DynamoDB when those are configured.
"""

from __future__ import annotations

import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))  # bundle root
os.environ.setdefault("GCORP_RUNS_DIR", "/tmp/runs")
os.environ.setdefault("GCORP_IN_CLOUD", "1")

from gcorp.orchestrator import confidence, execute  # noqa: E402


def assess(payload: dict) -> dict:
    backend = None
    if payload.get("backend", "bedrock") == "bedrock":
        from gcorp.council.bedrock import BedrockBackend
        backend = BedrockBackend()
    t0 = time.time()
    run = execute(payload["policy"], payload.get("zone"), payload.get("overrides"), backend=backend)
    out = run.to_json(grids=False)
    out["confidence"] = confidence(run)
    out["host"] = {"runtime": "agentcore", "seconds": round(time.time() - t0, 2),
                   "backends": getattr(backend, "used", {}) or {"*": "rules"}}
    try:
        from gcorp.aws.cloud import archive
        archive(run, out)
    except Exception as e:  # archiving is best-effort
        out["host"]["archive"] = f"skipped ({type(e).__name__})"
    return out


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: dict):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/ping"):
            return self._send(200, {"status": "Healthy", "time_of_last_update": int(time.time())})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self.path.startswith("/invocations"):
            return self._send(404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(n) or b"{}")
            if not payload.get("policy"):
                return self._send(400, {"error": "payload needs a 'policy' string"})
            self._send(200, assess(payload))
        except Exception as e:
            self._send(500, {"error": f"{type(e).__name__}: {e}"})

    def log_message(self, fmt, *args):
        sys.stderr.write("gcorp-runtime " + fmt % args + "\n")


def main():
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), Handler).serve_forever()


if __name__ == "__main__":
    main()
