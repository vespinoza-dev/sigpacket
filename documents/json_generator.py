"""
JSON-driven document generation for the Signature Packet Generator.

Builds .docx documents programmatically from JSON configs — no .docx template
files.  Each page type is described by a config dict (from template_config)
whose ``fields`` list drives which paragraphs are emitted and in what order.

Exports the same API surface as the old template_filler module:
    VALID_PAGE_TYPES  — set of all 10 page type strings
    build_page(...)   — build a single page, returns Document
    generate_from_templates(...)  — combine multiple pages, returns Document
"""

import copy
import re

from docx import Document
from docx.shared import Inches
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

from documents.docx_helpers import (
    setup_styles,
    _set_run_font,
    _set_direct_indent,
    _set_direct_spacing,
    _set_direct_alignment,
    _add_tab_stop,
    _add_break_run,
    _set_section_footer,
    _add_witness_clause,
    _add_entity_header,
    _add_blank_indented,
    _add_indented_normal,
    _add_by_line,
    _add_name_line,
    _add_title_line,
    _add_name_title_line,
    _add_date_entity_line,
    RUN_SIZE,
    RUN_FONT,
)
from services.template_config import get_config, VALID_PAGE_TYPES, get_valid_page_types  # noqa: F401 — re-exported


def _add_rich_runs(paragraph, text):
    """Parse text with <b> and <i> tags and add runs with formatting.

    Supports <b>...</b> for bold and <i>...</i> for italic.
    Tags can be nested. All other HTML tags are stripped.
    Returns the paragraph for chaining.
    """
    parts = re.split(r'(</?[bi]>)', text)
    bold = False
    italic = False
    for part in parts:
        if part == '<b>':
            bold = True
            continue
        if part == '</b>':
            bold = False
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
        _set_run_font(r)
        if bold:
            r.bold = True
        if italic:
            r.italic = True
    return paragraph


def _has_rich_tags(text):
    """Check if text contains <b> or <i> tags."""
    return bool(re.search(r'<[bi]>', text))


def _add_field_paragraph(doc, ctx, space_after=240):
    """Add a Normal paragraph with indentation based on the current column.

    Left column: no indent (left margin).
    Right column: standard 4320 twips indent with tab at 9360.
    """
    if ctx.get("_current_column") == "left":
        p = doc.add_paragraph(style="Normal")
        if space_after is not None:
            _set_direct_spacing(p, after=space_after)
        return p
    return _add_indented_normal(doc, space_after=space_after)


# Page types that use special witness clause spacing (space_before=240, space_after=720)
_WITNESS_EXTRA_SPACING_TYPES = {
    "certificate_of_incorporation",
    "secretary_certificate",
    "compliance_certificate",
}


# ---------------------------------------------------------------------------
# Document creation helper (inlined from build_templates._new_doc)
# ---------------------------------------------------------------------------

def _new_doc():
    """Create a fresh Document with 8.5x11 page, 1" margins, and custom styles."""
    doc = Document()
    section = doc.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(1)
    section.bottom_margin = Inches(1)
    section.left_margin = Inches(1)
    section.right_margin = Inches(1)
    setup_styles(doc)
    # Remove the default empty paragraph that python-docx always creates
    if doc.paragraphs:
        p = doc.paragraphs[0]._element
        p.getparent().remove(p)
    return doc


# ---------------------------------------------------------------------------
# Per-field builder functions
#
# Each builder receives (doc, field, ctx) where:
#   doc   — the Document being constructed
#   field — the field dict from the config's "fields" list
#   ctx   — a dict of computed display values (see build_page)
# ---------------------------------------------------------------------------

def _get_field_text(field, ctx):
    """Return the plain text content of a field (for side-by-side rendering).

    Used when two fields share the same grid row and need to be on one line.
    """
    fid = field.get("id", "")
    sig = ctx["sig_block"]
    name = ctx["name"]
    entity = ctx["entity"]
    title = ctx["title"]
    is_individual = ctx["is_individual"]

    if fid == "date_line":
        return "Date: _________________"
    elif fid == "entity_name":
        return entity if (entity and not is_individual) else ""
    elif fid == "signer_description":
        return sig.get("signer_description", "").strip() if not is_individual else ""
    elif fid == "entity_header":
        return ctx["config"].get("entity_header_label", "")
    elif fid == "company_header":
        return "COMPANY:"
    elif fid == "section_header":
        return ctx["config"].get("section_header_label", "")
    elif fid == "directors_header":
        return "DIRECTORS:"
    elif fid == "salutation":
        return "Very truly yours,"
    elif fid == "signer_name":
        return name if is_individual else f"Name: {name}"
    elif fid == "title":
        if is_individual:
            return ""
        return f"Title: {title}" if title else "Title:"
    elif fid == "by_line":
        show_by = ctx["config"].get("show_by_prefix_individual", False)
        if is_individual and not show_by:
            return "____________________________"
        return "By: ____________________________"
    elif fid == "email":
        v = sig.get("email", "")
        return f"Email: {v}" if v else "Email:"
    elif fid == "phone":
        v = sig.get("phone", "")
        return f"Phone: {v}" if v else "Phone:"
    elif fid == "cc_email":
        v = sig.get("cc_email", "")
        return f"CC Email: {v}" if v else "CC Email:"
    elif fid == "address":
        v = sig.get("address", "")
        return f"Address: {v}" if v else "Address:"
    elif fid == "city_state_zip":
        return sig.get("city_state_zip", "")
    elif fid == "accepted_and_agreed":
        return ctx["config"].get("accepted_agreed_label", "Accepted and Agreed:")
    elif fid.startswith("additional_signing_entity"):
        suffix = "" if fid == "additional_signing_entity" else fid.replace("additional_signing_entity", "")
        ent = sig.get(f"additional_signing_entity{suffix}", "").rstrip(",").strip()
        role = sig.get(f"additional_signing_entity_title{suffix}", "")
        if not ent:
            return ""
        separate = ctx["config"].get("separate_its_line", False)
        if separate and role:
            return f"By: {ent}\nIts: {role}"
        if role:
            return f"By: {ent}, its {role}"
        return f"By: {ent}"
    return ""


def _build_witness_clause(doc, field, ctx):
    """Emit the witness / execution clause paragraph(s)."""
    page_type = ctx["page_type"]
    text = ctx["config"].get("witness_clause_text", "")
    if not text:
        # Fallback — use a generic clause with agreement_name
        text = (
            "IN WITNESS WHEREOF, the parties have executed this "
            "{{agreement_name}} as of the date first above written."
        )
    text = text.replace("{{agreement_name}}", ctx["agreement_name"])
    text = text.replace("{{financing_round}}", ctx.get("financing_round", "[___]"))

    if _has_rich_tags(text):
        # Rich text witness clause — build manually with bold runs
        p = doc.add_paragraph(style="Bod")
        _add_rich_runs(p, text)
        _set_direct_indent(p, first_line=720)
        space_before = 240 if page_type in _WITNESS_EXTRA_SPACING_TYPES else None
        space_after = 720 if page_type in _WITNESS_EXTRA_SPACING_TYPES else 480
        kwargs = {"after": space_after}
        if space_before is not None:
            kwargs["before"] = space_before
        _set_direct_spacing(p, **kwargs)
    elif page_type in _WITNESS_EXTRA_SPACING_TYPES:
        _add_witness_clause(doc, text, space_before=240, space_after=720)
    else:
        _add_witness_clause(doc, text)


def _build_consent_text(doc, field, ctx):
    """Emit the stockholder consent language paragraph + Sigsty spacer."""
    text = ctx["config"].get("consent_text", "")
    if not text:
        return
    p = doc.add_paragraph(style="Normal")
    _set_direct_alignment(p, "both")
    if '<b>' in text:
        _add_rich_runs(p, text)
    else:
        run = p.add_run(text)
        _set_run_font(run)
    # Sigsty spacer
    sp = doc.add_paragraph(style="Sigsty")
    _set_direct_spacing(sp, after=0, line=240, line_rule="auto")


def _build_entity_header(doc, field, ctx):
    """Emit the entity / role header line."""
    label = ctx["config"].get("entity_header_label", "ENTITY")
    page_type = ctx["page_type"]

    if page_type == "stockholder_consent":
        # Special tab-indented format with bold label
        p = doc.add_paragraph(style="Normal")
        pPr = p._element.get_or_add_pPr()
        wc = OxmlElement("w:widowControl")
        wc.set(qn("w:val"), "0")
        pPr.append(wc)
        _add_tab_stop(p, 4320, val="left")
        _add_tab_stop(p, 9092, val="right")
        r1 = p.add_run("\t")
        _set_run_font(r1)
        r2 = p.add_run(label)
        _set_run_font(r2, bold=True)
    else:
        _add_entity_header(doc, label, bold=True)


def _build_company_header(doc, field, ctx):
    """Emit 'COMPANY:' bold header on the left column."""
    p = _add_field_paragraph(doc, ctx)
    r = p.add_run("COMPANY:")
    _set_run_font(r, bold=True)


def _build_section_header(doc, field, ctx):
    """Emit a bold section header (e.g., STOCKHOLDER, DIRECTOR, INDEMNITEE)."""
    label = ctx["config"].get("section_header_label", "")
    if not label:
        return
    p = _add_field_paragraph(doc, ctx)
    if _has_rich_tags(label):
        _add_rich_runs(p, label)
    else:
        r = p.add_run(label)
        _set_run_font(r, bold=True)


def _build_directors_header(doc, field, ctx):
    """Emit the DIRECTORS: header for board consent pages."""
    p = _add_field_paragraph(doc, ctx, space_after=240)
    r = p.add_run("DIRECTORS:")
    _set_run_font(r, bold=True)


def _build_salutation(doc, field, ctx):
    """Emit 'Very truly yours,' as an indented normal line."""
    p = _add_field_paragraph(doc, ctx)
    r = p.add_run("Very truly yours,")
    _set_run_font(r)


def _build_date_line(doc, field, ctx):
    """Emit just 'Date: ___' as an independent field."""
    p = _add_field_paragraph(doc, ctx, space_after=0)
    r = p.add_run("Date: _________________")
    _set_run_font(r, bold=False)


def _build_entity_name(doc, field, ctx):
    """Emit the bold entity name as an independent field. Skipped for individuals."""
    if ctx["is_individual"]:
        return
    entity = ctx["entity"]
    if not entity:
        return
    p = _add_field_paragraph(doc, ctx, space_after=0)
    r = p.add_run(entity)
    _set_run_font(r, bold=True)


def _build_signer_description(doc, field, ctx):
    """Emit the free-form signing capacity / nominee language line below the entity name."""
    if ctx["is_individual"]:
        return
    value = ctx["sig_block"].get("signer_description", "").strip()
    if not value:
        return
    p = _add_field_paragraph(doc, ctx, space_after=0)
    r = p.add_run(value)
    _set_run_font(r)


def _build_additional_entity(doc, field, ctx, suffix=""):
    """Emit one additional signing entity pair (entity line + role line).

    Skipped if the entity value is empty.
    When separate_its_line is enabled, renders:
        By: Entity Name
        Its: Role
    Otherwise renders on one line:
        By: Entity Name, its Role
    """
    entity_key = f"additional_signing_entity{suffix}"
    role_key = f"additional_signing_entity_title{suffix}"

    entity_val = ctx["sig_block"].get(entity_key, "").rstrip(",").strip()
    role_val = ctx["sig_block"].get(role_key, "")

    if not entity_val:
        return

    separate = ctx["config"].get("separate_its_line", False)

    if separate and role_val:
        # Entity on its own line, then "Its:" on the next line
        p = _add_field_paragraph(doc, ctx, space_after=0)
        r = p.add_run(f"By: {entity_val}")
        _set_run_font(r)
        p2 = _add_field_paragraph(doc, ctx, space_after=0)
        r2 = p2.add_run(f"Its: {role_val}")
        _set_run_font(r2)
    else:
        # "By: {entity}, its {role}" — all on one line
        p = _add_field_paragraph(doc, ctx, space_after=0)
        if role_val:
            r = p.add_run(f"By: {entity_val}, its {role_val}")
        else:
            r = p.add_run(f"By: {entity_val}")
        _set_run_font(r)


def _build_additional_signing_entity(doc, field, ctx):
    _build_additional_entity(doc, field, ctx, suffix="")


def _build_additional_signing_entity_2(doc, field, ctx):
    _build_additional_entity(doc, field, ctx, suffix="_2")


def _build_additional_signing_entity_3(doc, field, ctx):
    _build_additional_entity(doc, field, ctx, suffix="_3")


def _build_by_line(doc, field, ctx):
    """Emit the signature line (By: line or plain line for individuals).
    The 2 blank lines above are now handled at the grid rendering level."""
    show_by = ctx["config"].get("show_by_prefix_individual", False)
    if ctx["is_individual"] and not show_by:
        # Plain signature line — tab with underscore leader, no "By:" prefix
        p = _add_field_paragraph(doc, ctx, space_after=0)
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
        run = p.add_run("\t")
        _set_run_font(run)
    else:
        _add_by_line(doc, space_after=0)


def _build_signer_name(doc, field, ctx):
    """Emit the signer name (and title for entities)."""
    if ctx["is_individual"]:
        p = _add_field_paragraph(doc, ctx, space_after=0)
        r = p.add_run(ctx["name"])
        _set_run_font(r)
    else:
        p = _add_field_paragraph(doc, ctx, space_after=0)
        r = p.add_run(f"Name: {ctx['name']}")
        _set_run_font(r)


def _build_title(doc, field, ctx):
    """Emit the title line as its own independent paragraph. Skipped for individuals or empty title."""
    if ctx["is_individual"]:
        return
    title_val = ctx["title"]
    if not title_val:
        return
    p = _add_field_paragraph(doc, ctx, space_after=0)
    r = p.add_run(f"Title: {title_val}")
    _set_run_font(r)


def _build_email(doc, field, ctx):
    value = ctx["sig_block"].get("email", "")
    p = _add_field_paragraph(doc, ctx, space_after=0)
    r = p.add_run(f"Email: {value}" if value else "Email:")
    _set_run_font(r)


def _build_phone(doc, field, ctx):
    value = ctx["sig_block"].get("phone", "")
    p = _add_field_paragraph(doc, ctx, space_after=0)
    r = p.add_run(f"Phone: {value}" if value else "Phone:")
    _set_run_font(r)


def _build_cc_email(doc, field, ctx):
    value = ctx["sig_block"].get("cc_email", "")
    p = _add_field_paragraph(doc, ctx, space_after=0)
    r = p.add_run(f"CC Email: {value}" if value else "CC Email:")
    _set_run_font(r)


def _build_address(doc, field, ctx):
    value = ctx["sig_block"].get("address", "")
    city = ctx["sig_block"].get("city_state_zip", "")
    # Indent 3", tabs at 3.5" and 3.63" — value starts after the second tab
    p = doc.add_paragraph(style="Normal")
    _set_direct_indent(p, left=4320)
    _add_tab_stop(p, 5040)
    _add_tab_stop(p, 5227)
    _set_direct_spacing(p, after=0)
    r1 = p.add_run("Address:")
    _set_run_font(r1)
    p.add_run("\t")
    r2 = p.add_run(value or "")
    _set_run_font(r2)
    # City/State/ZIP always follows address — blank line if empty
    p2 = doc.add_paragraph(style="Normal")
    _set_direct_indent(p2, left=4320)
    _add_tab_stop(p2, 5040)
    _add_tab_stop(p2, 5227)
    _set_direct_spacing(p2, after=240)
    p2.add_run("\t")
    p2.add_run("\t")
    r3 = p2.add_run(city)
    _set_run_font(r3)


def _build_city_state_zip(doc, field, ctx):
    # Rendered by _build_address — no-op here to avoid duplication
    pass

def _build_accepted_and_agreed(doc, field, ctx):
    """Emit a secondary header label (e.g., 'Accepted and Agreed:', 'INDEMNITEE:')."""
    label = ctx["config"].get("accepted_agreed_label", "Accepted and Agreed:")
    p = _add_field_paragraph(doc, ctx, space_after=240)
    r = p.add_run(label)
    _set_run_font(r, bold=field.get("bold", False))


# ---------------------------------------------------------------------------
# Field ID → builder dispatch table
# ---------------------------------------------------------------------------

_FIELD_BUILDERS = {
    "witness_clause": _build_witness_clause,
    "consent_text": _build_consent_text,
    "entity_header": _build_entity_header,
    "company_header": _build_company_header,
    "section_header": _build_section_header,
    "directors_header": _build_directors_header,
    "salutation": _build_salutation,
    "date_line": _build_date_line,
    "entity_name": _build_entity_name,
    "signer_description": _build_signer_description,
    "additional_signing_entity": _build_additional_signing_entity,
    "additional_signing_entity_2": _build_additional_signing_entity_2,
    "additional_signing_entity_3": _build_additional_signing_entity_3,
    "by_line": _build_by_line,
    "signer_name": _build_signer_name,
    "title": _build_title,
    "email": _build_email,
    "phone": _build_phone,
    "cc_email": _build_cc_email,
    "address": _build_address,
    "city_state_zip": _build_city_state_zip,
    "accepted_and_agreed": _build_accepted_and_agreed,
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def _merge_config(global_config, overrides):
    """Deep-merge per-signatory field overrides into a global template config.

    Returns a new config dict. The ``overrides`` dict has the shape:
    ``{"fields": {"witness_clause": {"enabled": false}, ...},
      "config": {"footer_template": "...", "footer_enabled": false, ...}}``
    """
    if not overrides:
        return global_config

    import copy as _copy
    merged = _copy.deepcopy(global_config)

    # Merge config-level overrides (footer_template, witness_clause_text, etc.)
    config_overrides = overrides.get("config", {})
    for key, value in config_overrides.items():
        merged[key] = value

    # Merge field-level overrides (enabled, bold, italic, etc.)
    field_overrides = overrides.get("fields", {})
    for field in merged.get("fields", []):
        fid = field.get("id", "")
        if fid in field_overrides:
            field.update(field_overrides[fid])

    return merged


def build_page(page_type, sig_block, company_name=None, field_overrides=None, financing_round="[___]"):
    """Build a single signature page from JSON config.

    Args:
        page_type: One of the 10 VALID_PAGE_TYPES strings.
        sig_block: Dict of signatory data (signer_name, signing_entity, etc.).
        company_name: Optional company name for footer rendering.
        field_overrides: Optional per-signatory overrides for this page type.
        financing_round: The financing round string (e.g. "A", "Seed").

    Returns:
        A ``docx.Document`` containing the fully-formatted page.
    """
    config = get_config(page_type)
    if config is None:
        return None

    # Derive agreement_name from config (agreement_title or display_name)
    agreement_name = config.get("agreement_title") or config.get("display_name", "Agreement")

    # Merge per-signatory overrides if provided
    config = _merge_config(config, field_overrides)

    # --- Create fresh document ---
    doc = _new_doc()
    section = doc.sections[0]

    # --- Compute display values ---
    name = sig_block.get("signer_name", "[__]")
    entity = sig_block.get("signing_entity", "").upper()
    title = sig_block.get("title", "") or config.get("default_title", "")
    is_individual = sig_block.get("signer_type") == "individual"

    ctx = {
        "page_type": page_type,
        "config": config,
        "sig_block": sig_block,
        "agreement_name": agreement_name,
        "financing_round": financing_round,
        "company_name": company_name or "",
        "name": name,
        "entity": entity,
        "title": title,
        "is_individual": is_individual,
    }

    # --- Walk enabled fields: full-width first, then left column, then right ---
    _FULL_WIDTH_IDS = {"witness_clause", "consent_text"}
    enabled_fields = sorted(
        [f for f in config.get("fields", []) if f.get("enabled", True)],
        key=lambda f: f.get("order", 0),
    )
    full_width = [f for f in enabled_fields if f.get("id") in _FULL_WIDTH_IDS]
    # Filter out additional entity fields that have no data (they'd render empty)
    def _has_content(f):
        fid = f.get("id", "")
        if fid.startswith("additional_signing_entity"):
            suffix = "" if fid == "additional_signing_entity" else fid.replace("additional_signing_entity", "")
            return bool(sig_block.get(f"additional_signing_entity{suffix}", "").strip())
        if fid == "signer_description":
            return bool(sig_block.get("signer_description", "").strip())
        return True
    grid_fields = [f for f in enabled_fields if f.get("id") not in _FULL_WIDTH_IDS and _has_content(f)]

    # Render full-width fields first (witness clause, consent text)
    for field in full_width:
        ctx["_current_column"] = "right"
        builder = _FIELD_BUILDERS.get(field.get("id", ""))
        if builder:
            builder(doc, field, ctx)

    # Assign rows to grid fields — pack left+right into same row when possible
    used = {"left": set(), "right": set()}
    for f in grid_fields:
        if f.get("row") is not None:
            used[f.get("column", "right")].add(f["row"])
    next_row = {"left": 0, "right": 0}
    for f in grid_fields:
        if f.get("row") is not None:
            continue
        col = f.get("column", "right")
        while next_row[col] in used[col]:
            next_row[col] += 1
        f["row"] = next_row[col]
        used[col].add(next_row[col])
        next_row[col] += 1

    # Group by row
    GRID_ROWS = 20
    row_map = {}  # row_num -> {"left": field, "right": field}
    for f in grid_fields:
        col = f.get("column", "right")
        if f["row"] not in row_map:
            row_map[f["row"]] = {}
        row_map[f["row"]][col] = f

    # Find the last row that has any content
    max_used_row = max(row_map.keys()) if row_map else -1

    # Find the row that contains the by_line so we can insert blank rows before it
    by_line_row = None
    for rn, cols in row_map.items():
        for col_f in cols.values():
            if col_f and col_f.get("id") == "by_line":
                by_line_row = rn
                break

    # Render rows 0 through max_used_row — empty rows become blank lines
    for row_num in range(max_used_row + 1):
        # Insert 2 blank rows before the by_line row for signature spacing
        if by_line_row is not None and row_num == by_line_row:
            by_row = row_map.get(by_line_row, {})
            has_left = by_row.get("left") is not None
            for _ in range(2):
                if has_left:
                    # Both columns present — side-by-side blank row
                    p = doc.add_paragraph(style="Normal")
                    _set_direct_indent(p, left=4320, hanging=4320)
                    _add_tab_stop(p, 4320, val="left")
                    _set_direct_spacing(p, after=0)
                else:
                    # Right column only — indented blank
                    _add_indented_normal(doc, space_after=0)

        row = row_map.get(row_num)

        if not row:
            # Empty row = blank line in the document
            p = doc.add_paragraph(style="Normal")
            _set_direct_spacing(p, after=0)
            continue

        left_f = row.get("left")
        right_f = row.get("right")

        if left_f and right_f:
            # Both columns: render side-by-side with tab
            left_text = _get_field_text(left_f, ctx)
            right_text = _get_field_text(right_f, ctx)
            # Skip if both are empty (e.g., additional entities with no data)
            if not left_text and not right_text:
                p = doc.add_paragraph(style="Normal")
                _set_direct_spacing(p, after=0)
            elif left_text and right_text:
                p = doc.add_paragraph(style="Normal")
                _set_direct_indent(p, left=4320, hanging=4320)
                _add_tab_stop(p, 4320, val="left")
                _set_direct_spacing(p, after=0)
                r1 = p.add_run(left_text)
                _set_run_font(r1, bold=left_f.get("bold"))
                r2 = p.add_run("\t")
                _set_run_font(r2)
                r3 = p.add_run(right_text)
                _set_run_font(r3, bold=right_f.get("bold"))
            elif left_text:
                ctx["_current_column"] = "left"
                builder = _FIELD_BUILDERS.get(left_f.get("id", ""))
                if builder:
                    builder(doc, left_f, ctx)
            else:
                ctx["_current_column"] = "right"
                builder = _FIELD_BUILDERS.get(right_f.get("id", ""))
                if builder:
                    builder(doc, right_f, ctx)
        elif left_f:
            ctx["_current_column"] = "left"
            builder = _FIELD_BUILDERS.get(left_f.get("id", ""))
            if builder:
                builder(doc, left_f, ctx)
        elif right_f:
            ctx["_current_column"] = "right"
            builder = _FIELD_BUILDERS.get(right_f.get("id", ""))
            if builder:
                builder(doc, right_f, ctx)

    # --- Footer ---
    footer_tpl = config.get("footer_template", "")
    if footer_tpl and config.get("footer_enabled", True) is not False:
        footer_text = (
            footer_tpl
            .replace("{{agreement_name}}", agreement_name)
            .replace("{{financing_round}}", financing_round)
            .replace("{{company_name}}", company_name or "")
        )
        lines = footer_text.split("\n")
        _set_section_footer(section, lines)

    return doc


def generate_from_templates(pairs, company_name=None, financing_round="[___]"):
    """Generate a combined document from multiple (page_type, sig_block, [overrides]) tuples.

    Args:
        pairs: List of tuples. Each is either (page_type, sig_block) or
               (page_type, sig_block, field_overrides).
        company_name: Optional company name for footer rendering.
        financing_round: The financing round string (e.g. "A", "Seed").

    Returns:
        A ``docx.Document`` with all pages combined, or None if pairs is empty.
    """
    if not pairs:
        return None

    def _unpack(pair):
        if len(pair) == 3:
            return pair[0], pair[1], pair[2]
        return pair[0], pair[1], None

    # Build first page — becomes the base document
    first_type, first_sig, first_overrides = _unpack(pairs[0])
    output_doc = build_page(first_type, first_sig, company_name=company_name, field_overrides=first_overrides, financing_round=financing_round)
    if not output_doc:
        return None

    # Append subsequent pages
    for pair in pairs[1:]:
        page_type, sig_block, overrides = _unpack(pair)
        page_doc = build_page(page_type, sig_block, company_name=company_name, field_overrides=overrides, financing_round=financing_round)
        if not page_doc:
            continue
        _append_document(output_doc, page_doc)

    return output_doc


# ---------------------------------------------------------------------------
# Multi-page assembly helpers
# ---------------------------------------------------------------------------

def _append_document(target_doc, source_doc):
    """Append all content from *source_doc* into *target_doc* as a new section."""
    new_section = target_doc.add_section()
    new_section.start_type = 2  # NEW_PAGE
    new_section.page_width = Inches(8.5)
    new_section.page_height = Inches(11)
    new_section.top_margin = Inches(1)
    new_section.bottom_margin = Inches(1)
    new_section.left_margin = Inches(1)
    new_section.right_margin = Inches(1)

    source_body = source_doc.element.body
    target_body = target_doc.element.body
    target_sectPr = target_body.find(qn("w:sectPr"))

    for child in list(source_body):
        tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
        if tag == "sectPr":
            continue
        target_sectPr.addprevious(copy.deepcopy(child))

    _copy_section_footer(target_doc, source_doc, new_section)


def _copy_section_footer(target_doc, source_doc, target_section):
    """Copy footer content from source document's first section to target section."""
    try:
        source_footer = source_doc.sections[0].footer
        target_footer = target_section.footer
        target_footer.is_linked_to_previous = False
        for p in target_footer.paragraphs:
            p.clear()
        source_footer_element = source_footer._element
        target_footer_element = target_footer._element
        for child in list(target_footer_element):
            target_footer_element.remove(child)
        for child in source_footer_element:
            target_footer_element.append(copy.deepcopy(child))
    except Exception:
        pass
