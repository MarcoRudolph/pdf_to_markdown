# PDF text-layer transcriber

`transcriber.py` is a byte-for-byte copy of the validated script at
`/root/backup/pdf_trans/deliverable/pdf-transkribieren/scripts/pdf_transkribieren.py`.
Its extraction and formatting logic is unchanged. The callable interface is
`from transcriber import transcribe`; `transcribe(pdf_path: Path)` returns a
`tuple[str, list[str]]` containing Markdown and warnings. It transcribes the
existing PDF text layer; it does not perform OCR.

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
