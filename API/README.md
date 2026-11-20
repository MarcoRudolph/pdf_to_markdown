# PDF text-layer transcriber

`transcriber.py` is a byte-for-byte copy of the validated script at
`/root/backup/pdf_trans/deliverable/pdf-transkribieren/scripts/pdf_transkribieren.py`.
Its extraction and formatting logic is unchanged. The callable interface is
`from transcriber import transcribe`; `transcribe(pdf_path: Path)` returns a
`tuple[str, list[str]]` containing Markdown and warnings. It transcribes the
existing PDF text layer; it does not perform OCR.

## API usage

Install with Python 3.11 and provide a nonempty server-side `API_TOKEN` at startup:

```bash
cd API
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
export API_TOKEN='replace-with-long-random-server-secret'
.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000
```

`GET /health` requires no token. `POST /v1/convert` requires
a bearer authorization header and a multipart `file` part with
`application/pdf` content type. It returns UTF-8 Markdown as the fixed
attachment `document.md`. For example, after setting `API_TOKEN` in your shell:

```bash
curl -fsS -H "Authorization: Bearer ${API_TOKEN}" \
  -F 'file=@sample.pdf;type=application/pdf' \
  http://127.0.0.1:8000/v1/convert -o document.md
```

The token is a server secret; never embed it in the React client or commit it.
Use TLS via a reverse proxy for any remote access. No public route is configured
by this package. Set a reverse-proxy request-body limit as well: multipart is
parsed before the endpoint can apply its per-file byte limit. Defaults are
`MAX_UPLOAD_BYTES=10485760` (10 MiB) and `MAX_PAGES=100`; both environment
variables must be positive integers. Invalid configuration prevents startup.
Uploads are copied in bounded chunks to a private, per-request temporary
`document.pdf`, which is removed on success and error. The API does no OCR:
image-only/empty documents are rejected, and partial empty pages retain the
transcriber's warnings. Status codes: 400 for missing/invalid upload, 401 for
authentication failure, 413 for oversize, 422 for unreadable/encrypted/over-page-
limit/no-text PDFs, and a redacted 500 for unexpected errors.

## Local verification

Use a dedicated Python 3.11 environment (not the Hermes interpreter):

```bash
cd API
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
cd ..
cmp /root/backup/pdf_trans/deliverable/pdf-transkribieren/scripts/pdf_transkribieren.py API/transcriber.py
```

`requirements.txt` pins the runtime dependency; `requirements-dev.txt` adds
the pinned test runner. To update the transcriber, validate changes in the
source project first, copy the entire validated script into `API/transcriber.py`
without editing its domain logic, run the tests, and run `cmp` again. If the
backup path is unavailable on another machine, obtain the validated source
from the source project before updating; the checked-in copy has no runtime
dependency on `/root/backup`.

## Container and local HTTP smoke

From `API/`, use a fresh token generated outside Git. Do not put a real token
in `.env.example` or in a client bundle:

```bash
export API_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
docker compose config --quiet
docker compose up --build -d
.venv/bin/python -m pytest -q
.venv/bin/python tests/smoke.py  # /health and a real generated text PDF upload
docker compose ps
docker compose down  # only after verifying this is your test stack; no -v
```

Compose binds only `127.0.0.1:8000` by default. If that port is occupied,
first check the existing listener and use `API_PORT=8001` with
`python tests/smoke.py http://127.0.0.1:8001`; never replace a live service.
The image runs as a non-root user with one Uvicorn worker and a `/health`
healthcheck. The container installs only the pinned runtime dependencies;
the test environment uses the pinned `requirements-dev.txt`. The fixed
`document.md` response is Markdown, not JSON; warnings returned by the
transcriber are not exposed as a separate API field. Uploaded files are
temporary and removed after conversion; avoid retaining upload bodies in
proxy or application logs.

## Production gate (not configured here)

This local-only Compose setup does not expose a public endpoint. Before any
remote use, configure a real domain, DNS, HTTPS/TLS termination (e.g. Traefik),
proxy timeouts, rate limiting, token rotation and a reverse-proxy request-body
limit that includes multipart overhead beyond `MAX_UPLOAD_BYTES`. Multipart
parsing occurs before the API's file-size check. Set a proxy-level concurrency
gate as well: PDF conversion runs in a thread pool and can consume substantial
CPU/RAM under concurrent uploads despite the one Uvicorn worker. Size, page,
latency and resource limits need realistic load tests on the target VPS.

A Cloudflare Worker can proxy uploads to the HTTPS API, but the bearer token
must be stored **only as a Worker secret**, never in React, browser requests,
or a public environment variable. The Worker must enforce its own request-body
and abuse controls. Do not enable a public route until these controls and
negative HTTP tests (401, 413), TLS, and cleanup are verified.

PyMuPDF is offered under AGPLv3 or a commercial license. Resolve the intended
public/SaaS licensing model with the operator (comply with AGPL or buy a
commercial license) before deployment; the repository's MIT license does not
supersede PyMuPDF's license.
