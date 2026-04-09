"""
Document formatting helpers for the Signature Packet Generator.
Extracted from app.py — contains all docx XML helpers, style setup,
and paragraph builder functions.
"""

import re

from docx.shared import Pt, Inches, Emu
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

# All runs in the template use 11pt (139700 EMU)
RUN_SIZE = Pt(11)
RUN_FONT = "Times New Roman"


# ---------------------------------------------------------------------------
# Low-level XML helpers
# ---------------------------------------------------------------------------

def _set_run_font(run, size=None, name=None, bold=None, underline=None):
    """Apply explicit font properties to a run, including szCs for complex scripts."""
    run.font.size = size or RUN_SIZE
    run.font.name = name or RUN_FONT
    if bold is not None:
        run.bold = bold
    if underline is not None:
        run.font.underline = underline
    # Add szCs (complex script size) to match PFH model
    rPr = run._element.get_or_add_rPr()
    szCs = rPr.find(qn("w:szCs"))
    if szCs is None:
        szCs = OxmlElement("w:szCs")
        rPr.append(szCs)
    sz_val = str(int((size or RUN_SIZE).pt * 2))  # half-points
    szCs.set(qn("w:val"), sz_val)


def _set_direct_indent(para, left=None, first_line=None, hanging=None):
    """Set direct paragraph indentation via XML (twips)."""
    pPr = para._element.get_or_add_pPr()
    ind = pPr.find(qn("w:ind"))
    if ind is None:
        ind = OxmlElement("w:ind")
        pPr.append(ind)
    if left is not None:
        ind.set(qn("w:left"), str(left))
    if first_line is not None:
        ind.set(qn("w:firstLine"), str(first_line))
    if hanging is not None:
        ind.set(qn("w:hanging"), str(hanging))


def _set_direct_alignment(para, val):
    """Set direct paragraph alignment via XML."""
    pPr = para._element.get_or_add_pPr()
    jc = pPr.find(qn("w:jc"))
    if jc is None:
        jc = OxmlElement("w:jc")
        pPr.append(jc)
    jc.set(qn("w:val"), val)


def _set_direct_spacing(para, before=None, after=None, line=None, line_rule=None):
    """Set direct paragraph spacing via XML (twips for before/after, line in 240ths of a line)."""
    pPr = para._element.get_or_add_pPr()
    spacing = pPr.find(qn("w:spacing"))
    if spacing is None:
        spacing = OxmlElement("w:spacing")
        pPr.append(spacing)
    if before is not None:
        spacing.set(qn("w:before"), str(before))
    if after is not None:
        spacing.set(qn("w:after"), str(after))
    if line is not None:
        spacing.set(qn("w:line"), str(line))
    if line_rule is not None:
        spacing.set(qn("w:lineRule"), line_rule)


def _add_tab_stop(para, position_twips, val="left", leader=None):
    """Add a tab stop to a paragraph via XML."""
    pPr = para._element.get_or_add_pPr()
    tabs = pPr.find(qn("w:tabs"))
    if tabs is None:
        tabs = OxmlElement("w:tabs")
        pPr.append(tabs)
    tab = OxmlElement("w:tab")
    tab.set(qn("w:val"), val)
    tab.set(qn("w:pos"), str(position_twips))
    if leader:
        tab.set(qn("w:leader"), leader)
    tabs.append(tab)


def _add_break_run(run):
    """Add a line break (<w:br/>) to a run via XML."""
    br = OxmlElement("w:br")
    run._element.append(br)


# ---------------------------------------------------------------------------
# Style setup
# ---------------------------------------------------------------------------

def setup_styles(doc):
    """Create all custom styles matching the reference template exactly."""
    styles = doc.styles

    # -- Normal (base) --
    normal = styles["Normal"]
    normal.font.name = RUN_FONT
    normal.font.size = Pt(12)
    normal.paragraph_format.space_after = Pt(0)
    normal.paragraph_format.space_before = Pt(0)

    # -- Bod (witness clauses) --
    # Template style: space_after=152400 (12pt), JUSTIFY. Paragraphs override to 480 twips via direct.
    bod_style = styles.add_style("Bod", 1)
    bod_style.base_style = normal
    bod_style.font.name = RUN_FONT
    bod_style.font.size = Pt(12)
    bod_style.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    bod_style.paragraph_format.space_after = Emu(152400)  # 12pt (style level)

    # -- bod (lowercase - director consent variant) --
    # Template: alignment=JUSTIFY (from style), space_after=0
    bod_lower = styles.add_style("bod", 1)
    bod_lower.base_style = normal
    bod_lower.font.name = RUN_FONT
    bod_lower.font.size = Pt(12)
    bod_lower.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    bod_lower.paragraph_format.space_after = Pt(0)
    bod_lower.paragraph_format.space_before = Pt(0)

    # -- Company-1 (entity/role headers) --
    # Template style: space_after=304800 (24pt). Paragraphs override to 240 twips via direct.
    company1 = styles.add_style("Company-1", 1)
    company1.base_style = normal
    company1.font.name = RUN_FONT
    company1.font.size = Pt(12)
    company1.paragraph_format.space_after = Emu(304800)  # 24pt (style level)

    # -- Body Text --
    if "Body Text" not in [s.name for s in styles]:
        bt = styles.add_style("Body Text", 1)
    else:
        bt = styles["Body Text"]
    bt.base_style = normal
    bt.font.name = RUN_FONT
    bt.font.size = Pt(12)
    bt.paragraph_format.space_after = Emu(152400)

    # -- Body Text First Indent 2 --
    btfi2 = styles.add_style("Body Text First Indent 2", 1)
    btfi2.base_style = normal
    btfi2.font.name = RUN_FONT
    btfi2.font.size = Pt(12)
    btfi2.paragraph_format.space_after = Pt(0)

    # -- Sigsty (spacer between consent text and header) --
    sigsty = styles.add_style("Sigsty", 1)
    sigsty.base_style = normal
    sigsty.font.name = RUN_FONT
    sigsty.font.size = Pt(12)
    sigsty.paragraph_format.space_after = Pt(0)

    return {
        "normal": normal,
        "Bod": bod_style,
        "bod": bod_lower,
        "Company-1": company1,
        "Body Text": bt,
        "Body Text First Indent 2": btfi2,
        "Sigsty": sigsty,
    }


def _add_section_break(doc):
    """Add a new page section break."""
    new_section = doc.add_section()
    new_section.start_type = 2  # NEW_PAGE
    new_section.page_width = Inches(8.5)
    new_section.page_height = Inches(11)
    new_section.top_margin = Inches(1)
    new_section.bottom_margin = Inches(1)
    new_section.left_margin = Inches(1)
    new_section.right_margin = Inches(1)
    return new_section


def _set_section_footer(section, lines):
    """Set a centered, bold, 11pt footer on a section.

    Args:
        section: A docx Section object.
        lines: List of strings, each rendered as a separate centered paragraph.
               Supports <b> and <i> tags for bold/italic formatting.

    Matches template: centered, bold, 11pt Times New Roman, no page numbers.
    """
    footer = section.footer
    footer.is_linked_to_previous = False

    # Clear any existing content
    for p in footer.paragraphs:
        p.clear()

    # Use the first existing paragraph, add more if needed
    for i, text in enumerate(lines):
        if i == 0:
            p = footer.paragraphs[0]
        else:
            p = footer.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        if re.search(r'<[bi]>', text):
            _add_rich_runs_footer(p, text)
        else:
            run = p.add_run(text)
            run.font.name = RUN_FONT
            run.font.size = RUN_SIZE


def _add_rich_runs_footer(paragraph, text):
    """Parse <b> and <i> tags for footer runs."""
    parts = re.split(r'(</?[bi]>)', text)
    bold = False
    italic = False
    explicit_bold = False
    for part in parts:
        if part == '<b>':
            explicit_bold = True
            continue
        if part == '</b>':
            explicit_bold = False
            continue
        if part == '<i>':
            italic = True
            continue
        if part == '</i>':
            italic = False
            continue
        if not part:
            continue
        r = paragraph.add_run(part)
        r.font.name = RUN_FONT
        r.font.size = RUN_SIZE
        if explicit_bold:
            r.bold = True
        if italic:
            r.italic = True


# Footer text per page type
FOOTER_TEXT = {
    # Main Documents
    "stock_purchase_agreement": lambda ag, ent: [f"Signature Page to {ag} of", ent],
    "certificate_of_incorporation": lambda ag, ent: [f"Signature Page to Amended and Restated Certificate of Incorporation of", ent],
    "investors_rights_agreement": lambda ag, ent: [f"Signature Page to Investors\u2019 Rights Agreement of", ent],
    "voting_agreement": lambda ag, ent: [f"Signature Page to Voting Agreement of", ent],
    "rofr_cosale": lambda ag, ent: [f"Signature Page to Right of First Refusal and Co-Sale Agreement of", ent],
    # Ancillary Documents
    "board_consent": lambda ag, ent: [f"Signature Page to Action by Unanimous Written Consent of the Board of Directors of", ent],
    "stockholder_consent": lambda ag, ent: [f"Signature Page to Stockholder Consent of", ent],
    "compliance_certificate": lambda ag, ent: [f"Signature Page to Compliance Certificate of", ent],
    "secretary_certificate": lambda ag, ent: [f"Signature Page to Secretary\u2019s Certificate of", ent],
    "indemnification_agreement": lambda ag, ent: [f"Signature Page to Indemnification Agreement of", ent],
}


# ---------------------------------------------------------------------------
# Paragraph helpers — match template's exact direct formatting
# ---------------------------------------------------------------------------

def _add_indented_normal(doc, space_after=240):
    """Create a Normal paragraph with the standard sig-block indentation.

    PFH model pattern for By/Name/Title/blank lines:
      left_indent = 4320 twips (3 inches)
      tab_stop at 9360 twips
    """
    p = doc.add_paragraph(style="Normal")
    _set_direct_indent(p, left=4320)
    _add_tab_stop(p, 9360)
    if space_after is not None:
        _set_direct_spacing(p, after=space_after)
    return p


def _add_witness_clause(doc, text=None, space_before=None, space_after=480):
    """Add the standard witness/execution clause (Bod style).

    Template: Bod style, all runs 11pt. Direct spacing after=480 twips (24pt).
    Some have custom space_before/after overrides.
    """
    if text is None:
        text = "IN WITNESS WHEREOF, the parties have executed this Agreement as of the date first above written."
    p = doc.add_paragraph(style="Bod")
    run = p.add_run(text)
    _set_run_font(run)
    _set_direct_indent(p, first_line=720)
    spacing_kwargs = {}
    if space_before is not None:
        spacing_kwargs["before"] = space_before
    if space_after is not None:
        spacing_kwargs["after"] = space_after
    if spacing_kwargs:
        _set_direct_spacing(p, **spacing_kwargs)
    return p


def _add_entity_header(doc, name, bold=False, space_after=240):
    """Add an entity/role header in Company-1 style.

    Template: Company-1 style, 11pt run. Direct spacing after=240 twips (12pt).
    """
    p = doc.add_paragraph(style="Company-1")
    run = p.add_run(name)
    _set_run_font(run, bold=bold if bold else None)
    if space_after is not None:
        _set_direct_spacing(p, after=space_after)
    return p


def _add_blank_indented(doc, space_after=240):
    """Add a blank indented Normal paragraph (matches template blanks in sig blocks)."""
    return _add_indented_normal(doc, space_after=space_after)


def _add_by_line(doc, space_after=240):
    """Add 'By:<tab>' signature line using underscore tab leader.

    PFH model: tab stop at 9360 with w:leader="underscore" creates a proper
    underline from "By:" to the right margin.
    """
    p = _add_indented_normal(doc, space_after=space_after)
    # Override the default tab stop with an underscore leader version
    pPr = p._element.get_or_add_pPr()
    tabs = pPr.find(qn("w:tabs"))
    if tabs is not None:
        pPr.remove(tabs)
    tabs = OxmlElement("w:tabs")
    pPr.append(tabs)
    tab = OxmlElement("w:tab")
    tab.set(qn("w:val"), "left")
    tab.set(qn("w:leader"), "underscore")
    tab.set(qn("w:pos"), "9360")
    tabs.append(tab)

    run1 = p.add_run("By:")
    _set_run_font(run1)
    run2 = p.add_run("\t")
    _set_run_font(run2)
    return p


def _add_name_line(doc, name, space_after=240):
    """Add 'Name: {name}' line.

    Template: two runs - "Name:" + " {name}" (or three runs for placeholder).
    """
    p = _add_indented_normal(doc, space_after=space_after)
    run1 = p.add_run("Name:")
    _set_run_font(run1)
    run2 = p.add_run(f" {name}")
    _set_run_font(run2)
    return p


def _add_title_line(doc, title, space_after=240):
    """Add 'Title: {title}' line."""
    p = _add_indented_normal(doc, space_after=space_after)
    run = p.add_run(f"Title: {title}")
    _set_run_font(run)
    return p


def _add_name_title_line(doc, name, title, space_after=0):
    """Add merged 'Name: {name}<br/>Title: {title}' in one paragraph.

    PFH model: Name and Title on separate visual lines but in a single
    paragraph, joined by <w:br/> (soft line break).
    """
    p = _add_indented_normal(doc, space_after=space_after)
    run1 = p.add_run("Name:")
    _set_run_font(run1)
    run2 = p.add_run(f" {name}")
    _set_run_font(run2)
    # Line break between Name and Title
    br = OxmlElement("w:br")
    run2._element.append(br)
    run3 = p.add_run(f"Title: {title}")
    _set_run_font(run3)
    return p


def _add_date_entity_line(doc, entity_placeholder="{{entity_name}}", space_after=0):
    """Add combined 'Date: ___[tab]ENTITY NAME' line.

    PFH model: Date and entity name on the same paragraph.
    For individuals, the entity portion is blank.
    Uses hanging indent so Date: is at left margin, entity at 4320.
    """
    p = doc.add_paragraph(style="Normal")
    _set_direct_indent(p, left=4320, hanging=4320)
    # Tab stops: left at 4320 for entity name, right at 9360
    _add_tab_stop(p, 4320, val="left")
    _add_tab_stop(p, 9360, val="right")
    if space_after is not None:
        _set_direct_spacing(p, after=space_after)

    # "Date: _________________" — explicitly not bold
    run1 = p.add_run("Date: _________________")
    _set_run_font(run1, bold=False)
    # Tab to entity position
    run2 = p.add_run("\t")
    _set_run_font(run2)
    # Entity name (bold) — or blank for individuals
    run3 = p.add_run(entity_placeholder)
    _set_run_font(run3, bold=True)
    # Trailing tab for right alignment
    run4 = p.add_run("\t")
    _set_run_font(run4)
    return p


def _add_page_break(doc):
    """Add a simple page break paragraph (not a section break).

    PFH model: uses <w:br w:type="page"/> instead of heavy sectPr sections.
    """
    p = doc.add_paragraph(style="Normal")
    _set_direct_spacing(p, after=160, line=259, line_rule="auto")
    _set_direct_alignment(p, "left")
    run = p.add_run()
    br = OxmlElement("w:br")
    br.set(qn("w:type"), "page")
    run._element.append(br)
    return p


def _add_footer_paragraph(doc, lines):
    """Add footer text as a body paragraph (not a section footer).

    PFH model: footer text is a centered, bold paragraph at the bottom
    of each page's content, not in the section footer area.
    """
    for line in lines:
        p = doc.add_paragraph(style="Normal")
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run(line)
        _set_run_font(run, bold=True)
    return p


# ---------------------------------------------------------------------------
# Field tagging — embeds field IDs into paragraph XML for config-driven gen
# ---------------------------------------------------------------------------

# Field tagging uses Word bookmarks: _sig_FIELDID_ wrapping the paragraph.
# Word natively supports bookmarks so the docx stays valid.

_BOOKMARK_ID_COUNTER = [0]
_BOOKMARK_PREFIX = "_sig_"
_BOOKMARK_SUFFIX = "_"


def _tag_field(paragraph, field_id):
    """Tag a paragraph with a config field ID using Word bookmarks.

    Creates a bookmarkStart/bookmarkEnd pair named _sig_FIELDID_ around the paragraph.
    """
    bm_name = f"{_BOOKMARK_PREFIX}{field_id}{_BOOKMARK_SUFFIX}"
    bm_id = str(_BOOKMARK_ID_COUNTER[0])
    _BOOKMARK_ID_COUNTER[0] += 1

    p_elem = paragraph._element

    # bookmarkStart goes at the beginning of the paragraph
    bm_start = OxmlElement("w:bookmarkStart")
    bm_start.set(qn("w:id"), bm_id)
    bm_start.set(qn("w:name"), bm_name)
    p_elem.insert(0, bm_start)

    # bookmarkEnd goes at the end of the paragraph
    bm_end = OxmlElement("w:bookmarkEnd")
    bm_end.set(qn("w:id"), bm_id)
    p_elem.append(bm_end)


def _get_field_tag(para_element):
    """Read the field ID tag from a paragraph XML element. Returns None if untagged."""
    for child in para_element:
        if child.tag == qn("w:bookmarkStart"):
            name = child.get(qn("w:name"), "")
            if name.startswith(_BOOKMARK_PREFIX) and name.endswith(_BOOKMARK_SUFFIX):
                return name[len(_BOOKMARK_PREFIX):-len(_BOOKMARK_SUFFIX)]
    return None
