"""v58.13.132mk — Parsers for Tasmanian WHS legislation sources.

Two families:
  · HTML (Acts + Regs from legislation.tas.gov.au) — BeautifulSoup4
    walks headings and body blocks, tracks Part > Division > Section
    hierarchy, emits a flat list of (section_number, section_title,
    section_text, section_html, parent_section, full_path).
  · PDF (Codes of Practice from worksafe.tas.gov.au and Safe Work
    Australia model COPs) — PyMuPDF (fitz) reads pages, then a
    heuristic split by numbered heading markers (`4.2`, `4.2.1`),
    with a page-block fallback when no numbering is detected.

Both parsers are best-effort. If the source structure is unusual
we fall back to coarser chunks rather than throwing. The ingest
run doc surfaces the strategy used per doc so operators can spot
degraded parses.
"""
from __future__ import annotations

import io
import logging
import re
from dataclasses import dataclass, field
from typing import Iterable, List, Optional, Tuple

from bs4 import BeautifulSoup, NavigableString, Tag

log = logging.getLogger("paneltec.whs_legislation.parser")

# ── Chunking config ─────────────────────────────────────────────
# Sections longer than this get split at paragraph boundaries.
# Bytes-of-utf8 for the section_text field.
_CHUNK_SIZE_BYTES = 8_000


@dataclass
class ParsedSection:
    section_number: str
    section_title: str
    section_text: str
    section_html: str = ""
    parent_section: str = ""
    full_path: str = ""

    def key(self) -> str:
        return self.section_number


# ── HTML parser (Acts + Regs) ───────────────────────────────────

# Tas legislation section headings we accept. Examples:
#   "1. Short title"           (Act preliminary)
#   "s. 19  Primary duty of care"
#   "19  Primary duty of care"
#   "Reg 347  Hazardous manual tasks"
_SECTION_HEADING_RE = re.compile(
    r"^\s*(?:s\.?\s*|reg\s+|r\.?\s*|Regulation\s+)?"
    r"(\d+[A-Za-z]*)"        # section number, optionally with alpha suffix
    r"[\.\s\u2014\-–—]+"     # separator
    r"(.{2,200}?)\s*$",
    re.IGNORECASE,
)

# Structural container headings we track for `full_path`.
_STRUCT_RE = re.compile(
    r"^\s*(Part|Division|Chapter|Subdivision|Schedule)\s+"
    r"([\dA-Z]+)"
    r"[\.\s\u2014\-–—]*(.*?)\s*$",
    re.IGNORECASE,
)


def _clean_text(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip()


def _chunk_text(text: str) -> List[str]:
    """Split on paragraph boundaries when body is > _CHUNK_SIZE_BYTES.
    Preserves paragraph atomicity; oversized paragraphs are kept
    whole rather than mid-sentence cut."""
    if len(text.encode("utf-8")) <= _CHUNK_SIZE_BYTES:
        return [text]
    paras = re.split(r"\n{2,}|\r\n\r\n", text)
    if len(paras) <= 1:
        return [text]  # single mega-paragraph, keep whole
    chunks: List[str] = []
    buf = ""
    for p in paras:
        p = p.strip()
        if not p:
            continue
        candidate = (buf + "\n\n" + p).strip() if buf else p
        if len(candidate.encode("utf-8")) > _CHUNK_SIZE_BYTES and buf:
            chunks.append(buf)
            buf = p
        else:
            buf = candidate
    if buf:
        chunks.append(buf)
    return chunks


def parse_legislation_html(
    html: str,
    *,
    doc_id: str,
    doc_title: str,
) -> List[ParsedSection]:
    """Walk a legislation.tas.gov.au 'whole HTML' view and extract
    sections. Best-effort — falls through to coarse chunking if the
    heading structure isn't recognised.
    """
    soup = BeautifulSoup(html, "lxml")

    # Strip nav / footer / script / style content.
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()

    body = soup.body or soup
    # Try to narrow to a main-content region if the source marks one.
    main = body.find(
        ["main", "article", "div"],
        attrs={"id": re.compile(r"content|main", re.I)},
    ) or body

    sections: List[ParsedSection] = []
    part = ""
    division = ""
    chapter = ""
    current: Optional[ParsedSection] = None
    body_parts: List[str] = []
    html_parts: List[str] = []

    def flush():
        nonlocal current, body_parts, html_parts
        if current is None:
            return
        joined = "\n\n".join(x for x in body_parts if x.strip())
        current.section_text = _clean_text(joined) if not joined.strip() else joined.strip()
        current.section_html = "\n".join(html_parts)
        sections.append(current)
        current = None
        body_parts = []
        html_parts = []

    def push_container(kind: str, num: str, title: str):
        nonlocal part, division, chapter
        k = kind.lower()
        label = f"{kind.title()} {num}"
        if title:
            label = f"{label} — {title}"
        if k == "part" or k == "chapter":
            part = label
            division = ""
        elif k == "division" or k == "subdivision":
            division = label
        elif k == "schedule":
            part = label
            division = ""

    def make_full_path(section_num: str, title: str) -> str:
        crumbs = [c for c in (chapter, part, division) if c]
        section_label = f"s.{section_num} {title}".strip()
        crumbs.append(section_label)
        return " > ".join(crumbs)

    # Walk any block-level element in doc order.
    walk_tags = main.find_all(
        ["h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "li", "table"],
        recursive=True,
    )
    for el in walk_tags:
        if not isinstance(el, Tag):
            continue
        text = _clean_text(el.get_text(" ", strip=True))
        if not text:
            continue

        # Structural container heading?
        m_struct = _STRUCT_RE.match(text)
        if m_struct and el.name in ("h1", "h2", "h3", "h4"):
            flush()
            kind, num, title = m_struct.group(1), m_struct.group(2), m_struct.group(3)
            push_container(kind, num, _clean_text(title))
            continue

        # Section heading?
        if el.name in ("h1", "h2", "h3", "h4", "h5"):
            m_sec = _SECTION_HEADING_RE.match(text)
            if m_sec:
                flush()
                sec_num, sec_title = m_sec.group(1), _clean_text(m_sec.group(2))
                current = ParsedSection(
                    section_number=f"s.{sec_num}",
                    section_title=sec_title,
                    section_text="",
                    parent_section=division or part,
                    full_path=make_full_path(sec_num, sec_title),
                )
                continue

        # Body block — accumulate into the current section.
        if current is not None:
            body_parts.append(text)
            html_parts.append(str(el))

    flush()

    # Fallback: if we got zero sections but there's real content,
    # emit one big "whole document" section so the doc isn't lost.
    if not sections:
        whole = _clean_text(main.get_text("\n", strip=True))
        if whole:
            sections.append(ParsedSection(
                section_number="whole",
                section_title=doc_title,
                section_text=whole,
                parent_section="",
                full_path=doc_title,
            ))
            log.warning(
                "[whs-parser] %s: no section headings matched; "
                "emitted whole-doc fallback (%d chars)",
                doc_id, len(whole),
            )

    log.info(
        "[whs-parser] %s: parsed %d sections (HTML)",
        doc_id, len(sections),
    )
    return sections


# ── COP landing-page link enumeration ───────────────────────────

_COP_TITLE_STRIP_RE = re.compile(r"\s+", re.M)


def enumerate_cop_pdfs(landing_html: str, base_url: str) -> List[dict]:
    """Return `[{title, url, revision_date}]` for every PDF link on
    the WorkSafe Tas Codes of Practice landing page. Accepts links
    to any host (Tas + Safe Work Australia model COPs)."""
    soup = BeautifulSoup(landing_html, "lxml")
    out: List[dict] = []
    seen: set = set()
    for a in soup.find_all("a", href=True):
        href = (a.get("href") or "").strip()
        if not href.lower().endswith(".pdf") and ".pdf?" not in href.lower():
            continue
        # Normalise relative URLs.
        if href.startswith("//"):
            href = "https:" + href
        elif href.startswith("/"):
            # base_url is like https://worksafe.tas.gov.au/...
            m = re.match(r"^(https?://[^/]+)", base_url)
            if m:
                href = m.group(1) + href
        if href in seen:
            continue
        seen.add(href)
        title = _clean_text(a.get_text(" ", strip=True)) or href.split("/")[-1]
        out.append({
            "title": title,
            "url": href,
            "revision_date": None,  # source rarely surfaces this per-link
        })
    log.info("[whs-parser] enumerated %d COP PDFs", len(out))
    return out


# ── PDF parser (Codes of Practice) ──────────────────────────────

# COP internal section markers, e.g. `4.2 Health monitoring` or
# `2.1.3 Ventilation`. Also matches leading `SECTION 4` / `PART 3`.
_COP_SECTION_RE = re.compile(
    r"^\s*(?:(?:SECTION|PART|CHAPTER)\s+)?"
    r"(\d+(?:\.\d+){0,3})"
    r"[\.\)\s\u2014\-–—]+"
    r"(.{3,140}?)\s*$",
)


def parse_cop_pdf(pdf_bytes: bytes, *, doc_id: str, doc_title: str
                    ) -> List[ParsedSection]:
    """Extract sections from a Code of Practice PDF via PyMuPDF.
    Uses a heuristic: page-by-page text, split on lines matching a
    numbered section marker. Falls back to one section per page when
    no numbering is detected."""
    try:
        import pymupdf  # noqa: PLC0415
    except ImportError:
        import fitz as pymupdf  # noqa: PLC0415

    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    except Exception as e:  # noqa: BLE001
        log.error("[whs-parser] %s: pymupdf failed to open: %s", doc_id, e)
        return []

    sections: List[ParsedSection] = []
    current: Optional[ParsedSection] = None
    buf: List[str] = []

    def flush():
        nonlocal current, buf
        if current is None:
            return
        current.section_text = "\n".join(x for x in buf if x.strip()).strip()
        sections.append(current)
        current = None
        buf = []

    for page_idx in range(doc.page_count):
        try:
            page = doc.load_page(page_idx)
            text = page.get_text("text") or ""
        except Exception:  # noqa: BLE001
            continue
        for raw_line in text.splitlines():
            line = raw_line.strip()
            if not line:
                if buf:
                    buf.append("")
                continue
            m = _COP_SECTION_RE.match(line)
            if m and len(line) < 200:
                # Looks like a section heading. Emit previous, start new.
                flush()
                sec_num = m.group(1)
                sec_title = _clean_text(m.group(2))
                current = ParsedSection(
                    section_number=f"COP§{sec_num}",
                    section_title=sec_title,
                    section_text="",
                    parent_section="",
                    full_path=f"{doc_title} > §{sec_num} {sec_title}",
                )
            else:
                if current is None:
                    # Content before first heading — put it in a preamble
                    # section so it's not lost.
                    current = ParsedSection(
                        section_number="COP§preamble",
                        section_title="Preamble",
                        section_text="",
                        parent_section="",
                        full_path=f"{doc_title} > Preamble",
                    )
                buf.append(line)

    flush()

    # Fallback: no numbered sections detected → chunk per page.
    if not sections:
        for page_idx in range(doc.page_count):
            try:
                page = doc.load_page(page_idx)
                text = _clean_text(page.get_text("text") or "")
            except Exception:  # noqa: BLE001
                continue
            if not text:
                continue
            sections.append(ParsedSection(
                section_number=f"COP§page-{page_idx + 1}",
                section_title=f"Page {page_idx + 1}",
                section_text=text,
                parent_section="",
                full_path=f"{doc_title} > Page {page_idx + 1}",
            ))
        log.warning(
            "[whs-parser] %s: no numbered sections detected; "
            "fell back to per-page chunks (%d pages)",
            doc_id, doc.page_count,
        )

    doc.close()
    log.info("[whs-parser] %s: parsed %d sections (PDF)", doc_id, len(sections))
    return sections


def maybe_chunk_section(section: ParsedSection
                          ) -> List[Tuple[str, str]]:
    """Chunk oversized sections. Returns [(id_suffix, text)] where
    `id_suffix` is `""` for the primary chunk or `"_chunk_N"` for
    additional chunks. Callers append the suffix to the base id."""
    text = section.section_text or ""
    parts = _chunk_text(text)
    if len(parts) == 1:
        return [("", parts[0])]
    return [
        ("" if i == 0 else f"_chunk_{i + 1}", p)
        for i, p in enumerate(parts)
    ]
