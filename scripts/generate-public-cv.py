#!/usr/bin/env python3
"""Build a two-page public CV from canonical portfolio JSON on stdin.

Usage: python generate-public-cv.py output.pdf < portfolio.json
Requires reportlab. Never reads private CVs, contact files, or environment secrets.
Expected JSON: site, links, facts, journey, skills, awards, publications, projects.
Projects are a list of frontmatter records with an added id (Markdown filename).
"""

import json
import re
import sys
from pathlib import Path
from xml.sax.saxutils import escape

import reportlab
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, KeepTogether, Table, TableStyle,
)


def clean(value):
    """Retain facts, while normalising typography for cross-platform PDF text."""
    return str(value).translate(str.maketrans({
        "\u2013": "-", "\u2014": "-", "\u2011": "-", "\u2018": "'",
        "\u2019": "'", "\u201c": '"', "\u201d": '"', "\u2192": "to",
        "\u2248": "approx.", "\u00d7": "x", "\u00a0": " ",
    }))


def text(value):
    return escape(clean(value))


def link(label, href):
    if not re.match(r"^(https://|mailto:)", href):
        raise ValueError("CV links must use HTTPS or mailto")
    return f'<a href="{escape(href, {chr(34): "&quot;"})}" color="#17539b">{text(label)}</a>'


FONT_DIR = Path(reportlab.__file__).parent / "fonts"
pdfmetrics.registerFont(TTFont("CV", str(FONT_DIR / "Vera.ttf")))
pdfmetrics.registerFont(TTFont("CV-Bold", str(FONT_DIR / "VeraBd.ttf")))
pdfmetrics.registerFontFamily("CV", normal="CV", bold="CV-Bold", italic="CV", boldItalic="CV-Bold")
INK = colors.HexColor("#162338")
MUTED = colors.HexColor("#566577")
BLUE = colors.HexColor("#17539b")
LINE = colors.HexColor("#dbe3ec")

STYLES = {
    "name": ParagraphStyle("name", fontName="CV-Bold", fontSize=25, leading=31, textColor=INK, spaceAfter=3),
    "role": ParagraphStyle("role", fontName="CV", fontSize=11, leading=16, textColor=MUTED, spaceAfter=7),
    "links": ParagraphStyle("links", fontName="CV", fontSize=8.3, leading=12, textColor=BLUE, spaceAfter=3),
    "summary": ParagraphStyle("summary", fontName="CV", fontSize=9.2, leading=13.5, textColor=INK, spaceAfter=8),
    "section": ParagraphStyle("section", fontName="CV-Bold", fontSize=10.5, leading=14, textColor=BLUE, spaceBefore=13, spaceAfter=8),
    "body": ParagraphStyle("body", fontName="CV", fontSize=8.7, leading=12.5, textColor=INK, spaceAfter=4),
    "bullet": ParagraphStyle("bullet", fontName="CV", fontSize=8.7, leading=12.3, leftIndent=10, firstLineIndent=-10, textColor=INK, spaceAfter=3),
    "title": ParagraphStyle("title", fontName="CV-Bold", fontSize=9.5, leading=13, textColor=INK),
    "meta": ParagraphStyle("meta", fontName="CV", fontSize=8.2, leading=11.5, textColor=MUTED, spaceAfter=4),
    "year": ParagraphStyle("year", fontName="CV", fontSize=8.2, leading=12, textColor=MUTED, alignment=TA_RIGHT),
    "research": ParagraphStyle("research", fontName="CV", fontSize=8.3, leading=11.7, textColor=INK, spaceAfter=6),
    "small": ParagraphStyle("small", fontName="CV", fontSize=8.2, leading=11.7, textColor=INK, spaceAfter=4),
}


def para(value, style="body"):
    return Paragraph(value, STYLES[style])


def dated_title(title, date, width):
    table = Table([[para(text(title), "title"), para(text(date), "year")]], colWidths=[width - 100, 100])
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return table


def make_cv(data, output):
    required = ("site", "links", "facts", "journey", "skills", "awards", "publications", "projects")
    for key in required:
        if key not in data:
            raise ValueError(f"Missing public portfolio field: {key}")

    site = data["site"]
    projects = {project["id"]: project for project in data["projects"]}
    documents = {
        document["id"]: (project, document)
        for project in data["projects"] for document in project.get("documents", [])
    }
    margins = 42
    # Platypus frames include six points of padding on each side.
    width = A4[0] - margins * 2 - 12
    doc = SimpleDocTemplate(
        str(output), pagesize=A4, rightMargin=margins, leftMargin=margins,
        topMargin=36, bottomMargin=38, title=f'{site["name"]} | Public CV',
        author=site["name"], subject="Public professional profile from demtsev.com",
        pageCompression=1,
    )
    story = []
    story.append(para(text(site["name"]), "name"))
    story.append(para(f'{text(site["role"])}  |  {text(site["location"])}', "role"))
    story.append(para("  |  ".join([
        link(site["domain"], site["url"]),
        link(site["email"], f'mailto:{site["email"]}'),
    ]), "links"))
    story.append(para("  |  ".join(
        link(item["label"], item["href"]) for item in data["links"]
        if item["id"] in {"github", "linkedin", "scholar"}
    ), "links"))
    story.append(Spacer(1, 9))
    story.append(para(text(site["description"]), "summary"))

    def journey_section(kind, heading):
        story.append(para(heading, "section"))
        for entry in data["journey"]:
            if entry["kind"] != kind:
                continue
            parts = [
                dated_title(entry["title"], entry["period"], width),
                para(f'{text(entry["organisation"])}  |  {text(entry["place"])}', "meta"),
            ]
            parts.extend(para(f'&bull; {text(point)}', "bullet") for point in entry["points"])
            parts.append(Spacer(1, 6))
            story.append(KeepTogether(parts))

    journey_section("work", "EXPERIENCE")
    journey_section("education", "EDUCATION")
    language_fact = next((fact["value"] for fact in data["facts"] if fact["label"] == "Languages"), None)
    if language_fact:
        story.append(para(f'<b>Spoken languages:</b> {text(language_fact)}', "small"))

    story.append(PageBreak())
    story.append(para(f'{text(site["name"])}  <font color="#566577">|  Projects and research</font>', "title"))
    story.append(para("SELECTED PROJECTS", "section"))
    for project_id in ("pixel-morph", "astro-pilot", "fx-regime-radar", "de-novo-drug-design"):
        project = projects.get(project_id)
        if project is None:
            continue
        title = link(project["title"], f'{site["url"].rstrip("/")}/work/{project_id}/')
        story.append(KeepTogether([
            para(f'<b>{title}</b> <font color="#566577">| {text(project["year"])}</font>', "body"),
            para(text(project["summary"]), "body"),
            Spacer(1, 3),
        ]))

    story.append(para("SELECTED PUBLICATIONS AND PATENT APPLICATION", "section"))
    for publication in data["publications"]:
        record = documents.get(publication["document"])
        if record is None or record[1].get("kind") == "poster":
            continue
        project, document = record
        original = document.get("original", {}).get("href")
        title = link(document["title"], original) if original else text(document["title"])
        venue = publication["venue"]
        # Keep the patent's application number and full article venue intact.
        story.append(KeepTogether([
            para(f'<b>{title}</b>', "research"),
            para(f'{text(publication["authors"])}<br/>{text(venue)} ({text(publication["year"])}).', "small"),
            Spacer(1, 3),
        ]))

    story.append(para("TECHNICAL SKILLS", "section"))
    for group in data["skills"]:
        story.append(para(f'<b>{text(group["group"])}:</b> {text(", ".join(group["items"]))}', "small"))

    story.append(para("AWARDS AND HONOURS", "section"))
    for award in data["awards"]:
        story.append(para(
            f'<b>{text(award["title"])}</b> - {text(award["detail"])} '
            f'<font color="#566577">({text(award["year"])})</font>', "small"
        ))

    def decorate(canvas, document):
        canvas.saveState()
        if document.page == 1:
            canvas.setStrokeColor(BLUE)
            canvas.setLineWidth(3)
            canvas.line(margins, A4[1] - 22, margins + 38, A4[1] - 22)
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(margins, 29, A4[0] - margins, 29)
        canvas.setFillColor(MUTED)
        canvas.setFont("CV", 7)
        canvas.drawString(margins, 17, f'{clean(site["domain"])} | Public CV')
        canvas.drawRightString(A4[0] - margins, 17, f'{document.page} / 2')
        canvas.restoreState()

    output.parent.mkdir(parents=True, exist_ok=True)
    doc.build(story, onFirstPage=decorate, onLaterPages=decorate)
    if doc.page != 2:
        raise RuntimeError(f"Expected two pages, got {doc.page}; review PDF layout before publishing")


if __name__ == "__main__":
    destination = Path(sys.argv[1] if len(sys.argv) > 1 else "output/pdf/daniil-emtsev-cv.pdf")
    make_cv(json.load(sys.stdin), destination)
    print(f"Created {destination}", file=sys.stderr)
