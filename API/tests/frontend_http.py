"""Exercise the real API through the frontend's same-origin HTTP route."""
import urllib.request
import urllib.error
import os
import pymupdf

BASE = os.environ.get('FRONTEND_URL', 'http://127.0.0.1:3001')
BOUNDARY = 'local-http-check'

def convert(payload, filename='probe.pdf', mime='application/pdf'):
    body = (f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: {mime}\r\n\r\n'.encode() + payload + f'\r\n--{BOUNDARY}--\r\n'.encode())
    request = urllib.request.Request(BASE + '/v1/convert', body, headers={'Content-Type': f'multipart/form-data; boundary={BOUNDARY}'}, method='POST')
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read().decode(), response.headers
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode(), error.headers

pdf = pymupdf.open()
page = pdf.new_page()
page.insert_text((72, 72), 'Hallo aus dem HTTP End-to-End Test')
text_pdf = pdf.tobytes()
for label, payload, expected in [
    ('valid', text_pdf, 200),
    ('repeat', text_pdf, 200),
    ('invalid signature', b'not a PDF', 400),
    ('too large', b'0' * (10485760 + 65537), 413),
]:
    code, body, headers = convert(payload)
    assert code == expected, (label, code, body)
    if code == 200:
        assert 'Hallo aus dem HTTP End-to-End Test' in body, (label, body)
        assert headers['Content-Disposition'] == 'attachment; filename="document.md"'
    print(label, code, len(body), headers.get('Content-Disposition', ''))
empty = pymupdf.open()
empty.new_page()
code, body, _ = convert(empty.tobytes())
assert code == 422, (code, body)
print('image-only/no text', code)
for route in ['/', '/impressum', '/datenschutz']:
    with urllib.request.urlopen(BASE + route) as response:
        html = response.read().decode()
        assert response.status == 200 and 'PDF to Markdown' in html
        print(route, response.status)
