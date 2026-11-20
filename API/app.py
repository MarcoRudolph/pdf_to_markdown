"""Authenticated, bounded text-layer PDF conversion endpoint."""

from contextlib import asynccontextmanager
import hmac
import os
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from starlette.datastructures import UploadFile
import pymupdf

from transcriber import transcribe


def _positive_setting(name: str, default: str) -> int:
    value = os.environ.get(name, default)
    try:
        parsed = int(value)
    except ValueError as exc:
        raise ValueError(f"{name} must be a positive integer") from exc
    if parsed <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return parsed


@asynccontextmanager
async def lifespan(application: FastAPI):
    token = os.environ.get("API_TOKEN")
    if not token:
        raise ValueError("API_TOKEN must be set and nonempty")
    application.state.token = token
    application.state.max_upload_bytes = _positive_setting("MAX_UPLOAD_BYTES", "10485760")
    application.state.max_pages = _positive_setting("MAX_PAGES", "100")
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok"}


def _convert(upload: UploadFile, max_bytes: int, max_pages: int) -> str:
    with TemporaryDirectory(dir=os.environ.get("TMPDIR")) as directory:
        pdf_path = Path(directory) / "document.pdf"
        size = 0
        with pdf_path.open("wb") as output:
            while chunk := upload.file.read(64 * 1024):
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(413, "PDF exceeds size limit")
                output.write(chunk)
        with pdf_path.open("rb") as source:
            if source.read(5) != b"%PDF-":
                raise HTTPException(400, "Invalid PDF signature")
        try:
            with pymupdf.open(pdf_path) as document:
                if document.needs_pass:
                    raise HTTPException(422, "Encrypted PDF is not supported")
                if document.page_count > max_pages:
                    raise HTTPException(422, "PDF exceeds page limit")
                if not any(page.get_text().strip() for page in document):
                    raise HTTPException(422, "PDF has no text layer")
        except (pymupdf.FileDataError, pymupdf.EmptyFileError) as exc:
            raise HTTPException(422, "Invalid PDF document") from exc
        markdown, _warnings = transcribe(pdf_path)
        return markdown


@app.post("/v1/convert")
async def convert(request: Request):
    authorization = request.headers.get("authorization", "")
    scheme, separator, provided = authorization.partition(" ")
    expected = request.app.state.token
    if not (separator and scheme == "Bearer" and hmac.compare_digest(provided, expected)):
        raise HTTPException(401, "Unauthorized", headers={"WWW-Authenticate": "Bearer"})

    try:
        try:
            form = await request.form()
        except Exception:
            raise HTTPException(400, "Invalid multipart upload") from None
        upload = form.get("file")
        if not isinstance(upload, UploadFile):
            raise HTTPException(400, "Missing PDF upload")
        if upload.content_type != "application/pdf":
            raise HTTPException(400, "Expected application/pdf")
        markdown = await run_in_threadpool(
            _convert, upload, request.app.state.max_upload_bytes, request.app.state.max_pages
        )
        return Response(
            markdown,
            media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="document.md"'},
        )
    except HTTPException:
        raise
    except Exception:
        # Never expose paths, document text, parser internals or token in responses/logs.
        raise HTTPException(500, "Internal conversion error") from None
