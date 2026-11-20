"""Transkribiert die Textebene von PDF-Dateien nach Markdown (Lesereihenfolge per XY-Cut)."""
from __future__ import annotations

import math
import re
import statistics
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import pymupdf

COL_GAP = 12.0          # pt: min. vertical white gap that separates two columns
SECTION_GAP = 2.0       # x median line height: horizontal gap that separates sections
EDGE_ZONE = 0.10        # top/bottom share of the page searched for running lines
NOISE_MIN_PAGES = 3
NOISE_SHARE = 0.6
H2_RATIO = 1.5
H3_RATIO = 1.15
HEADING_MAX_CHARS = 120
PARA_GAP = 0.45         # x line height
SIZE_JUMP = 0.12
SHORT_PAGE_CHARS = 20
BULLETS = "•●▪■◦·"
NO_JOIN_WORDS = {"und", "oder", "bzw.", "sowie", "bis", "als", "and", "or"}
GENERATED_PREFIX = '---\ndescription: "Transkript von '
INLINE_ESCAPE = re.compile(r"([\\`*_\[\]<|~])")
LINE_START_ESCAPE = re.compile(r"^([#>+\-=])")


@dataclass
class Line:
    x0: float
    y0: float
    x1: float
    y1: float
    spans: list[tuple[str, bool]]
    size: float

    @property
    def text(self) -> str:
        return "".join(t for t, _ in self.spans)

    @property
    def height(self) -> float:
        return self.y1 - self.y0


def _merge_spans(spans: list[tuple[str, bool]]) -> list[tuple[str, bool]]:
    merged: list[tuple[str, bool]] = []
    for text, bold in spans:
        if merged and merged[-1][1] == bold:
            merged[-1] = (merged[-1][0] + text, bold)
        else:
            merged.append((text, bold))
    return merged


def extract_lines(page: pymupdf.Page) -> list[Line]:
    lines: list[Line] = []
    for block in page.get_text("dict", flags=pymupdf.TEXTFLAGS_TEXT)["blocks"]:
        if block["type"] != 0:
            continue
        for raw in block["lines"]:
            spans: list[tuple[str, bool]] = []
            sizes: Counter[float] = Counter()
            for span in raw["spans"]:
                bold = bool(span["flags"] & pymupdf.TEXT_FONT_BOLD) or "bold" in span["font"].lower()
                spans.append((span["text"], bold))
                sizes[round(span["size"], 1)] += len(span["text"].strip())
            spans = _merge_spans(spans)
            # collapse whitespace across the whole line, keeping span borders
            cleaned, prev_space = [], True
            for text, bold in spans:
                out = []
                for ch in text:
                    if ch.isspace():
                        if not prev_space:
                            out.append(" ")
                        prev_space = True
                    else:
                        out.append(ch)
                        prev_space = False
                cleaned.append(("".join(out), bold))
            while cleaned and not cleaned[-1][0].strip():
                cleaned.pop()
            if not cleaned:
                continue
            cleaned[-1] = (cleaned[-1][0].rstrip(), cleaned[-1][1])
            cleaned = [(t, b) for t, b in cleaned if t]
            if not cleaned:
                continue
            x0, y0, x1, y1 = raw["bbox"]
            lines.append(Line(x0, y0, x1, y1, cleaned, sizes.most_common(1)[0][0]))
    return lines


def remove_noise(pages: list[list[Line]], heights: list[float]) -> list[list[Line]]:
    n = len(pages)
    if n < NOISE_MIN_PAGES:
        return pages
    need = max(NOISE_MIN_PAGES, math.ceil(NOISE_SHARE * n))
    edge_pages: Counter[str] = Counter()
    offset_pages: Counter[int] = Counter()
    for no, (lines, h) in enumerate(zip(pages, heights), start=1):
        keys, offsets = set(), set()
        for ln in lines:
            if ln.y1 <= h * EDGE_ZONE or ln.y0 >= h * (1 - EDGE_ZONE):
                keys.add(re.sub(r"\d", "#", ln.text))
            if re.fullmatch(r"\d{1,4}", ln.text):
                offsets.add(int(ln.text) - no)
        edge_pages.update(keys)
        offset_pages.update(offsets)
    noise_keys = {k for k, c in edge_pages.items() if c >= need}
    offset = next((o for o, c in offset_pages.most_common(1) if c >= need), None)
    result = []
    for no, (lines, h) in enumerate(zip(pages, heights), start=1):
        kept = []
        for ln in lines:
            at_edge = ln.y1 <= h * EDGE_ZONE or ln.y0 >= h * (1 - EDGE_ZONE)
            if at_edge and re.sub(r"\d", "#", ln.text) in noise_keys:
                continue
            if offset is not None and re.fullmatch(r"\d{1,4}", ln.text) and int(ln.text) - no == offset:
                continue
            kept.append(ln)
        result.append(kept)
    return result


def _gaps(intervals: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """White gaps between projected intervals as (size, cut position)."""
    gaps, end = [], None
    for lo, hi in sorted(intervals):
        if end is not None and lo > end:
            gaps.append((lo - end, (lo + end) / 2))
        end = hi if end is None else max(end, hi)
    return gaps


def _split(lines: list[Line], cuts: list[float], vertical: bool) -> list[list[Line]]:
    cuts = sorted(cuts)
    parts: list[list[Line]] = [[] for _ in range(len(cuts) + 1)]
    for ln in lines:
        pos = ln.x0 if vertical else ln.y0
        parts[sum(pos > c for c in cuts)].append(ln)
    return [p for p in parts if p]


def sort_rows(lines: list[Line]) -> list[Line]:
    rows: list[list[Line]] = []
    for ln in sorted(lines, key=lambda l: (l.y0, l.x0)):
        if rows:
            ref = rows[-1][0]
            overlap = min(ref.y1, ln.y1) - max(ref.y0, ln.y0)
            if overlap > 0.5 * min(ref.height, ln.height):
                rows[-1].append(ln)
                continue
        rows.append([ln])
    return [ln for row in rows for ln in sorted(row, key=lambda l: l.x0)]


def xy_cut(lines: list[Line]) -> list[Line]:
    if len(lines) <= 1:
        return list(lines)
    median_h = statistics.median(ln.height for ln in lines)
    h_gaps = _gaps([(ln.y0, ln.y1) for ln in lines])
    sections = [pos for size, pos in h_gaps if size >= SECTION_GAP * median_h]
    if sections:
        return [ln for part in _split(lines, sections, vertical=False) for ln in xy_cut(part)]
    columns = [pos for size, pos in _gaps([(ln.x0, ln.x1) for ln in lines]) if size >= COL_GAP]
    if columns:
        return [ln for part in _split(lines, columns, vertical=True) for ln in xy_cut(part)]
    if h_gaps:
        cut = max(h_gaps)[1]
        return [ln for part in _split(lines, [cut], vertical=False) for ln in xy_cut(part)]
    return sort_rows(lines)


def _escape(text: str) -> str:
    return INLINE_ESCAPE.sub(r"\\\1", text)


def _heading_level(ln: Line, body: float) -> int:
    if len(ln.text) > HEADING_MAX_CHARS:
        return 0
    if ln.size >= H2_RATIO * body:
        return 2
    if ln.size >= H3_RATIO * body and all(b for _, b in ln.spans):
        return 3
    return 0


def _render(ln: Line, level: int) -> str:
    spans = list(ln.spans)
    bullet = spans[0][0][:1] in BULLETS and len(ln.text) > 1
    if bullet:
        spans[0] = (spans[0][0][1:].lstrip(), spans[0][1])
    parts = []
    for text, bold in spans:
        esc = _escape(text)
        if bold and not level and esc.strip():
            lead = esc[: len(esc) - len(esc.lstrip())]
            trail = esc[len(esc.rstrip()):]
            esc = f"{lead}**{esc.strip()}**{trail}"
        parts.append(esc)
    out = LINE_START_ESCAPE.sub(r"\\\1", "".join(parts).strip())
    if bullet:
        return "- " + out
    return "#" * level + " " + out if level else out


def _same_row(a: Line, b: Line) -> bool:
    overlap = min(a.y1, b.y1) - max(a.y0, b.y0)
    return overlap > 0.5 * min(a.height, b.height) and b.x0 >= a.x1


def _dehyphenate(a: Line, b: Line) -> bool:
    words = b.text.split()
    return bool(
        re.search(r"[a-zäöüß]-$", a.text)
        and words
        and b.text[0].islower()
        and words[0].lower() not in NO_JOIN_WORDS
    )


def build_page(lines: list[Line], body: float) -> list[str]:
    """Returns the page's Markdown paragraphs."""
    paragraphs: list[list[str]] = []
    prev: Line | None = None
    prev_level = 0
    i = 0
    lines = list(lines)
    while i < len(lines):
        ln = lines[i]
        tail = ln
        while i + 1 < len(lines) and _dehyphenate(ln, lines[i + 1]) and not _same_row(ln, lines[i + 1]):
            nxt = lines[i + 1]
            head = ln.spans[:-1] + [(ln.spans[-1][0][:-1], ln.spans[-1][1])]
            ln = Line(min(ln.x0, nxt.x0), ln.y0, max(ln.x1, nxt.x1), nxt.y1,
                      _merge_spans(head + nxt.spans), ln.size)
            tail = nxt
            i += 1
        level = _heading_level(ln, body)
        text = _render(ln, level)
        if prev is None:
            paragraphs.append([text])
        elif _same_row(prev, ln) and level == prev_level:
            last = paragraphs[-1][-1]
            paragraphs[-1][-1] = last + " " + (text.lstrip("# ") if level else text)
        else:
            new_para = (
                level != prev_level
                or ln.y0 - prev.y1 > PARA_GAP * prev.height
                or ln.y0 < prev.y0
                or min(prev.x1, ln.x1) - max(prev.x0, ln.x0) <= 0
                or abs(ln.size - prev.size) > SIZE_JUMP * prev.size
            )
            if new_para:
                paragraphs.append([text])
            elif level:
                paragraphs[-1][-1] += " " + text.lstrip("# ")
            else:
                paragraphs[-1].append(text)
        prev, prev_level = tail, level
        i += 1
    return ["\n".join(p) for p in paragraphs]


def transcribe(pdf_path: Path) -> tuple[str, list[str]]:
    pdf_path = Path(pdf_path)
    warnings: list[str] = []
    with pymupdf.open(pdf_path) as doc:
        pages, heights, empty = [], [], set()
        for no, page in enumerate(doc, start=1):
            lines = extract_lines(page)
            chars = sum(len(ln.text.replace(" ", "")) for ln in lines)
            if chars == 0:
                empty.add(no)
                warnings.append(f"Seite {no}: keine Textebene (Scan?) - kein Text extrahiert")
            elif chars < SHORT_PAGE_CHARS:
                warnings.append(f"Seite {no}: nur {chars} Zeichen Text - bitte prüfen")
            want = Counter(page.get_text("text", flags=pymupdf.TEXTFLAGS_TEXT).split())
            got = Counter(w for ln in lines for w in ln.text.split())
            if want != got:
                diff = sum(((want - got) + (got - want)).values())
                warnings.append(f"Seite {no}: Vollständigkeitsprüfung fehlgeschlagen ({diff} Wörter Abweichung)")
            bad = sum(ln.text.count("�") for ln in lines)
            if bad:
                warnings.append(f"Seite {no}: {bad} nicht darstellbare Zeichen (U+FFFD)")
            pages.append(lines)
            heights.append(page.rect.height)
    pages = remove_noise(pages, heights)
    sizes: Counter[float] = Counter()
    for lines in pages:
        for ln in lines:
            sizes[ln.size] += len(ln.text)
    body = sizes.most_common(1)[0][0] if sizes else 0.0
    chunks = [f'---\ndescription: "Transkript von {pdf_path.name}"\npaths:\n  - "./{pdf_path.name}"\n---']
    for no, lines in enumerate(pages, start=1):
        chunks.append(f"<!-- Seite {no} -->")
        if no in empty:
            chunks.append(f"> **Warnung:** Seite {no} enthält keine Textebene (vermutlich ein Scan). "
                          "Es wurde kein Text extrahiert.")
            continue
        chunks.extend(build_page(xy_cut(lines), body))
    return "\n\n".join(chunks) + "\n", warnings


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    pdfs = [Path(a) for a in args] or sorted(Path(__file__).resolve().parent.glob("*.pdf"))
    if not pdfs:
        print("FEHLER keine PDF-Datei gefunden", file=sys.stderr)
        return 1
    status = 0
    for pdf in pdfs:
        target = pdf.with_suffix(".md")
        try:
            if target.exists() and not target.read_bytes().startswith(GENERATED_PREFIX.encode()):
                raise FileExistsError(
                    f"{target.name} existiert bereits und ist kein Transkript dieses Skripts - nicht überschrieben")
            markdown, warnings = transcribe(pdf)
            target.write_text(markdown, encoding="utf-8", newline="\n")
        except Exception as exc:  # noqa: BLE001  # one broken file must not stop the others
            print(f"FEHLER {pdf.name}: {exc}", file=sys.stderr)
            status = 1
            continue
        print(f"OK {pdf.name} -> {target.name} ({len(markdown)} Zeichen, {len(warnings)} Warnungen)")
        for warning in warnings:
            print(f"  WARNUNG {warning}")
        if warnings and status == 0:
            status = 2
    return status


if __name__ == "__main__":
    sys.exit(main())
