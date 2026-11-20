"""Integration checks for the copied PDF text-layer transcriber."""

from pathlib import Path

import pymupdf

from transcriber import transcribe


def test_transcribe_text_pdf(tmp_path: Path) -> None:
    pdf_path = tmp_path / "two-pages.pdf"
    with pymupdf.open() as document:
        for text in (
            "First page contains a complete text layer for transcription.",
            "Second page contains another complete text layer for transcription.",
        ):
            page = document.new_page()
            page.insert_text((72, 72), text)
        document.save(pdf_path)

    markdown, warnings = transcribe(pdf_path)

    assert warnings == []
    assert markdown.count("<!-- Seite 1 -->") == 1
    assert markdown.count("<!-- Seite 2 -->") == 1
    assert "First page contains a complete text layer" in markdown
    assert "Second page contains another complete text layer" in markdown
    assert markdown.index("<!-- Seite 1 -->") < markdown.index("<!-- Seite 2 -->")


def test_transcribe_empty_page_warning(tmp_path: Path) -> None:
    pdf_path = tmp_path / "empty.pdf"
    with pymupdf.open() as document:
        document.new_page()
        document.save(pdf_path)

    markdown, warnings = transcribe(pdf_path)

    assert warnings == ["Seite 1: keine Textebene (Scan?) - kein Text extrahiert"]
    assert "<!-- Seite 1 -->" in markdown
    assert "> **Warnung:** Seite 1 enthält keine Textebene" in markdown
    assert "Es wurde kein Text extrahiert." in markdown
