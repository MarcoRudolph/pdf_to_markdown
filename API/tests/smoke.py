"""Real HTTP smoke: API_TOKEN=... python tests/smoke.py [base URL]."""

import os
import sys
import urllib.error
import urllib.request


def sample_pdf() -> bytes:
    """Build a one-page, text-layer PDF with correct byte offsets."""
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    stream = b"BT /F1 18 Tf 72 720 Td (Smoke PDF text) Tj ET\n"
    objects.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"endstream")
    data = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f"{number} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(data)
    data.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        data.extend(f"{offset:010d} 00000 n \n".encode())
    data.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(data)


def request(url: str, headers: dict[str, str] | None = None, body: bytes | None = None):
    with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=headers or {}), timeout=15) as response:
        return response.status, response.headers, response.read()


def main() -> None:
    token = os.environ.get("API_TOKEN")
    if not token:
        raise SystemExit("Set API_TOKEN in the local environment before running smoke.py")
    base = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000").rstrip("/")
    status, _, body = request(base + "/health")
    assert status == 200 and b'"status":"ok"' in body, (status, body)
    print("GET /health: 200")
    boundary = "smoke-boundary"
    payload = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"smoke.pdf\"\r\n"
        "Content-Type: application/pdf\r\n\r\n"
    ).encode() + sample_pdf() + f"\r\n--{boundary}--\r\n".encode()
    status, headers, body = request(base + "/v1/convert", {
        "Authorization": "Bearer " + token,
        "Content-Type": "multipart/form-data; boundary=" + boundary,
    }, payload)
    assert status == 200, status
    assert headers.get_content_type() == "text/markdown", headers.get_content_type()
    assert headers.get("Content-Disposition") == 'attachment; filename="document.md"', headers.get("Content-Disposition")
    assert "Smoke PDF text" in body.decode("utf-8"), body
    print("POST /v1/convert: 200; Markdown text and document.md filename verified")


if __name__ == "__main__":
    main()
