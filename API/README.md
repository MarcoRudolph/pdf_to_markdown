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
`Authorization: Bearer <API_TOKEN>` and a multipart `file` part with
`application/pdf` content type. It returns UTF-8 Markdown as the fixed
attachment `document.md`. For example:

```bash
curl -fsS -H "Authorization: Bearer $API_TOKEN" \
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

PyMuPDF is offered under AGPLv3 or a commercial license. Review licensing
before public or proprietary deployment.
