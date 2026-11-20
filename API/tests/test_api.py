"""HTTP contract tests with locally generated PDFs, never customer documents."""

from io import BytesIO

import pymupdf
import pytest
from fastapi.testclient import TestClient
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartParser

from app import app


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("API_TOKEN", "test-only-secret")
    with TestClient(app) as test_client:
        yield test_client


def pdf_bytes(*pages, encrypted=False):
    with pymupdf.open() as document:
        for text in pages:
            page = document.new_page()
            if text:
                page.insert_text((72, 72), text)
        output = BytesIO()
        if encrypted:
            document.save(output, encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="password")
        else:
            document.save(output)
        return output.getvalue()


def upload(client, content, filename="document.pdf", mime="application/pdf", headers=None):
    return client.post("/v1/convert", files={"file": (filename, content, mime)}, headers=headers or {"Authorization": "Bearer test-only-secret"})


def test_text_pdf_download_has_markers_and_fixed_headers(client):
    response = upload(client, pdf_bytes("First page has text.", "Second page has text."))
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/markdown; charset=utf-8"
    assert response.headers["content-disposition"] == 'attachment; filename="document.md"'
    assert "<!-- Seite 1 -->" in response.text
    assert "<!-- Seite 2 -->" in response.text
    assert "First page has text." in response.text
    assert "Second page has text." in response.text


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer wrong"}, {"Authorization": "Basic test-only-secret"}, {"Authorization": "Bearer test-only-secret-extra"}])
def test_authentication_precedes_pdf_processing(client, headers, monkeypatch):
    def fail_if_processed(*args, **kwargs):
        raise AssertionError("Unauthenticated document was processed")
    monkeypatch.setattr("app.transcribe", fail_if_processed)
    response = client.post("/v1/convert", files={"file": ("bad.pdf", b"not a PDF", "application/pdf")}, headers=headers)
    assert response.status_code == 401
    assert response.json()["detail"] == "Unauthorized"


def test_missing_file_field_returns_400_not_framework_422(client):
    response = client.post("/v1/convert", data={}, headers={"Authorization": "Bearer test-only-secret"})
    assert response.status_code == 400


def test_malformed_multipart_is_400(client):
    response = client.post("/v1/convert", content=b"broken", headers={
        "Authorization": "Bearer test-only-secret", "Content-Type": "multipart/form-data; boundary=missing",
    })
    assert response.status_code == 400


@pytest.mark.parametrize("content,mime", [(b"not pdf", "application/pdf"), (b"%PDF- fake", "text/plain")])
def test_invalid_mime_or_pdf_signature_is_400(client, content, mime):
    assert upload(client, content, mime=mime).status_code == 400


@pytest.mark.parametrize("content", [b"%PDF-1.7\nnot a real PDF", pdf_bytes("secret", encrypted=True)])
def test_corrupt_or_encrypted_pdf_is_422(client, content):
    assert upload(client, content).status_code == 422


def test_image_only_or_empty_pdf_is_422(client):
    assert upload(client, pdf_bytes(None)).status_code == 422


def test_mixed_blank_and_text_page_preserves_transcriber_warning(client):
    response = upload(client, pdf_bytes(None, "Readable page content."))
    assert response.status_code == 200
    assert "> **Warnung:** Seite 1 enthält keine Textebene" in response.text
    assert "Readable page content." in response.text


def test_more_than_100_pages_is_422(client):
    assert upload(client, pdf_bytes(*(["text"] * 101))).status_code == 422


def test_oversize_without_content_length_is_413(client):
    content = pdf_bytes("small PDF") + b"x" * (10 * 1024 * 1024 + 1)
    boundary = "test-boundary"
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"document.pdf\"\r\n"
            "Content-Type: application/pdf\r\n\r\n").encode() + content + f"\r\n--{boundary}--\r\n".encode()
    response = client.post(
        "/v1/convert", content=iter([body[:100], body[100:]]),
        headers={"Authorization": "Bearer test-only-secret", "Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    assert response.status_code == 413


def test_untrusted_filename_never_reaches_yaml_or_download(client):
    filename = '../dangerous"\nsecret.pdf'
    response = upload(client, pdf_bytes("Safe text."), filename=filename)
    assert response.status_code == 200
    assert filename not in response.text
    assert "dangerous" not in response.text
    assert "dangerous" not in response.headers["content-disposition"]
    assert "document.pdf" in response.text


def test_health_without_token(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_temp_files_removed_after_success_and_error(client, monkeypatch, tmp_path):
    monkeypatch.setenv("TMPDIR", str(tmp_path))
    assert upload(client, pdf_bytes("Readable content")).status_code == 200
    assert list(tmp_path.iterdir()) == []
    assert upload(client, b"%PDF-1.7\nbroken").status_code == 422
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("outcome", ["success", "invalid_pdf", "unexpected_error"])
def test_multipart_upload_handle_closed_after_response(client, monkeypatch, outcome):
    # Observe the real multipart parser's UploadFile, not the client-side BytesIO.
    parsed_files = []
    original_parse = MultiPartParser.parse

    async def capture_parsed_file(parser):
        form = await original_parse(parser)
        parsed_file = form["file"]
        assert isinstance(parsed_file, UploadFile)
        parsed_files.append(parsed_file.file)
        return form

    monkeypatch.setattr(MultiPartParser, "parse", capture_parsed_file)
    if outcome == "unexpected_error":
        def crash(_path):
            raise RuntimeError("conversion failed")
        monkeypatch.setattr("app.transcribe", crash)

    content = b"%PDF-1.7\nbroken" if outcome == "invalid_pdf" else pdf_bytes("Readable content")
    response = upload(client, content)
    assert response.status_code == {"success": 200, "invalid_pdf": 422, "unexpected_error": 500}[outcome]
    assert len(parsed_files) == 1
    assert parsed_files[0].closed


def test_unexpected_error_is_redacted(client, monkeypatch, tmp_path):
    monkeypatch.setenv("TMPDIR", str(tmp_path))
    def crash(_path):
        raise RuntimeError("internal-secret-and-document-content")
    monkeypatch.setattr("app.transcribe", crash)
    response = upload(client, pdf_bytes("Text from customer."))
    assert response.status_code == 500
    assert "internal-secret" not in response.text
    assert "Text from customer" not in response.text
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("name,value", [("API_TOKEN", None), ("API_TOKEN", ""), ("MAX_UPLOAD_BYTES", "0"), ("MAX_PAGES", "nope")])
def test_invalid_configuration_prevents_startup(monkeypatch, name, value):
    monkeypatch.setenv("API_TOKEN", "test-only-secret")
    if value is None:
        monkeypatch.delenv(name, raising=False)
    else:
        monkeypatch.setenv(name, value)
    with pytest.raises(ValueError):
        with TestClient(app):
            pass
