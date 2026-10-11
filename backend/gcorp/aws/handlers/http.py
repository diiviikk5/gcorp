"""The engine's HTTP API on Lambda (Function URL) — what the deployed web app talks to.

Same FastAPI app as `gcorp serve`. Runs live in memory per warm container (plus the
four seeded runs at cold start) and are archived to S3/DynamoDB as they are created.
"""

from __future__ import annotations

import os

os.environ.setdefault("GCORP_RUNS_DIR", "/tmp/runs")
os.environ.setdefault("GCORP_ARCHIVE", "sync")

from mangum import Mangum  # noqa: E402

from gcorp.api import app  # noqa: E402

handler = Mangum(app, lifespan="auto")
