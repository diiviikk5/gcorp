"""Engine discovery, the gstack way.

Resolution order for the engine endpoint:
1. GCORP_ENDPOINT env var
2. `gcorp config set endpoint <url>` (~/.gcorp/config.json) — e.g. the AgentCore URL
3. A local daemon described by ~/.gcorp/engine.json; started on first use if
   missing or dead, health-checked, auto-shut-down after 30 min idle.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path

import httpx

HOME = Path(os.environ.get("GCORP_HOME", Path.home() / ".gcorp"))
CONFIG = HOME / "config.json"
STATE = HOME / "engine.json"
LOG = HOME / "engine.log"
DEFAULT_PORT = 8000  # the web app's default; falls back to a free port


def _read(p: Path) -> dict:
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _write(p: Path, data: dict) -> None:
    HOME.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
    tmp.replace(p)  # atomic


def config_get() -> dict:
    return _read(CONFIG)


def config_set(key: str, value: str | None) -> dict:
    cfg = _read(CONFIG)
    if value in (None, "", "none", "local"):
        cfg.pop(key, None)
    else:
        cfg[key] = value
    _write(CONFIG, cfg)
    return cfg


def _healthy(url: str, timeout: float = 1.5) -> bool:
    try:
        return httpx.get(url + "/api/health", timeout=timeout).status_code == 200
    except httpx.HTTPError:
        return False


def _alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform == "win32":
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True).stdout
        return str(pid) in out
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except OSError:
        return False


def _free_port(preferred: int) -> int:
    for port in [preferred] + [10000 + (uuid.uuid4().int % 39151) for _ in range(5)]:
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError("no free port")


def start_daemon(port: int | None = None) -> dict:
    port = _free_port(port or DEFAULT_PORT)
    HOME.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "GCORP_IDLE_EXIT": "1800"}
    flags = 0
    if sys.platform == "win32":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
    log = open(LOG, "ab")
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "gcorp.api:app", "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=str(Path(__file__).resolve().parent.parent), env=env, stdout=log, stderr=log, creationflags=flags,
        start_new_session=sys.platform != "win32",
    )
    state = {"pid": proc.pid, "port": port, "url": f"http://127.0.0.1:{port}", "token": str(uuid.uuid4()), "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    _write(STATE, state)
    for _ in range(60):
        if _healthy(state["url"], 0.5):
            return state
        time.sleep(0.25)
    raise RuntimeError(f"engine did not become healthy; see {LOG}")


def stop_daemon() -> bool:
    st = _read(STATE)
    pid = st.get("pid", 0)
    if not pid or not _alive(pid):
        STATE.unlink(missing_ok=True)
        return False
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
    else:
        os.kill(pid, 15)
    STATE.unlink(missing_ok=True)
    return True


def resolve(start: bool = True) -> tuple[str, str]:
    """Returns (endpoint, source) where source is env | config | daemon | started."""
    if os.environ.get("GCORP_ENDPOINT"):
        return os.environ["GCORP_ENDPOINT"].rstrip("/"), "env"
    if config_get().get("endpoint"):
        return config_get()["endpoint"].rstrip("/"), "config"
    st = _read(STATE)
    if st.get("url") and _alive(st.get("pid", 0)):
        # Alive but slow is busy, not dead: probe for a bounded window.
        for _ in range(16):
            if _healthy(st["url"]):
                return st["url"], "daemon"
            time.sleep(0.5)
        raise RuntimeError(f"engine pid {st['pid']} is alive but not answering; run `gcorp stop` to force a restart")
    if _healthy(f"http://127.0.0.1:{DEFAULT_PORT}"):
        return f"http://127.0.0.1:{DEFAULT_PORT}", "daemon"  # e.g. `gcorp serve` in another terminal
    if not start:
        raise RuntimeError("no engine running")
    return start_daemon()["url"], "started"


class Engine:
    def __init__(self, url: str | None = None):
        self.url, self.source = (url, "flag") if url else resolve()
        self.http = httpx.Client(base_url=self.url, timeout=60)

    def get(self, path: str, **params):
        r = self.http.get(path, params=params)
        r.raise_for_status()
        return r.json()

    def post(self, path: str, body: dict):
        r = self.http.post(path, json=body)
        r.raise_for_status()
        return r.json()

    def stream(self, path: str, **params):
        with self.http.stream("GET", path, params=params, timeout=None) as r:
            for line in r.iter_lines():
                if line.startswith("data: "):
                    yield json.loads(line[6:])
