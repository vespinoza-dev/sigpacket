"""
Template configuration management for the Visual Template Editor.
Stores per-page-type JSON configs that control which fields appear,
their order, and optional custom .docx templates.
"""

import json
import os
import re
from flask import Blueprint, jsonify, request

template_editor_bp = Blueprint('template_editor', __name__)

CONFIGS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "template_configs")

# ---------------------------------------------------------------------------
# Default configs for all 10 page types
# ---------------------------------------------------------------------------

def _f(id, type, label, enabled=True, order=0, bold=False, italic=False, column="right"):
    """Helper to create a field dict with formatting defaults."""
    return {"id": id, "type": type, "label": label, "enabled": enabled, "order": order, "bold": bold, "italic": italic, "column": column}


# Standard sig block fields shared by all page types (after page-specific headers)
def _standard_sig_fields(start_order):
    """Return the standard entity signer block fields starting at a given order."""
    return [
        _f("company_header", "field", '"Company:" Header Label', enabled=False, order=start_order, bold=True, column="left"),
        _f("section_header", "field", "Signer Role Label", enabled=False, order=start_order + 1, bold=True, column="left"),
        _f("date_line", "field", "Date Field", enabled=False, order=start_order + 2, column="left"),
        _f("entity_name", "field", "Signing Entity Name", order=start_order + 2, bold=True),
        _f("additional_signing_entity", "field", "Intermediary Entity 1", order=start_order + 3),
        _f("additional_signing_entity_2", "field", "Intermediary Entity 2", order=start_order + 4),
        _f("additional_signing_entity_3", "field", "Intermediary Entity 3", order=start_order + 5),
        _f("by_line", "signature", 'Signature / "By:" Line', order=start_order + 6),
        _f("signer_name", "field", "Signer Name Line", order=start_order + 7),
        _f("title", "field", "Title Line", order=start_order + 8),
        _f("address", "field", "Mailing Address", enabled=False, order=start_order + 9),
        _f("city_state_zip", "field", "City/State/ZIP", enabled=False, order=start_order + 10),
        _f("email", "field", "Email Address", enabled=False, order=start_order + 11),
        _f("cc_email", "field", "CC Email Address", enabled=False, order=start_order + 12),
        _f("phone", "field", "Phone Number", enabled=False, order=start_order + 13),
    ]


DEFAULT_CONFIGS = {
    # ===== Main Documents =====
    "stock_purchase_agreement": {
        "page_type": "stock_purchase_agreement",
        "display_name": "Stock Purchase Agreement",
        "agreement_title": "Preferred Stock Purchase Agreement",
        "default_title": "Chief Executive Officer",
        "witness_clause_text": "IN WITNESS WHEREOF, the parties have executed this Series {{financing_round}} {{agreement_name}} as of the date first written above.",
        "entity_header_label": "PURCHASER:",
        "section_header_label": "PURCHASER:",
        "consent_text": "",
        "separate_its_line": True,
        "show_by_prefix_individual": False,
        "fields": [
            _f("witness_clause", "text", "Execution / Witness Clause", order=0),
            _f("company_header", "field", '"Company:" Header Label', enabled=False, order=1, bold=True, column="left"),
            _f("section_header", "field", "Signer Role Label", enabled=True, order=2, bold=True, column="left"),
            _f("date_line", "field", "Date Field", enabled=False, order=3, column="left"),
            _f("entity_name", "field", "Signing Entity Name", order=3, bold=True),
            _f("additional_signing_entity", "field", "Intermediary Entity 1", order=4),
            _f("additional_signing_entity_2", "field", "Intermediary Entity 2", order=5),
            _f("additional_signing_entity_3", "field", "Intermediary Entity 3", order=6),
            _f("by_line", "signature", 'Signature / "By:" Line', order=7),
            _f("signer_name", "field", "Signer Name Line", order=8),
            _f("title", "field", "Title Line", order=9),
            _f("address", "field", "Mailing Address", enabled=False, order=10),
            _f("city_state_zip", "field", "City/State/ZIP", enabled=False, order=11),
            _f("email", "field", "Email Address", enabled=False, order=12),
            _f("cc_email", "field", "CC Email Address", enabled=False, order=13),
            _f("phone", "field", "Phone Number", enabled=False, order=14),
        ],
        "footer_template": "Signature Page to {{agreement_name}} of {{company_name}}",
    },
    "certificate_of_incorporation": {
        "page_type": "certificate_of_incorporation",
        "display_name": "A&R Certificate of Incorporation",
        "default_title": "President",
        "witness_clause_text": "IN WITNESS WHEREOF, this Amended and Restated Certificate of Incorporation has been executed by a duly authorized officer of this corporation on [__].",
        "entity_header_label": "",
        "section_header_label": "",
        "consent_text": "",
        "separate_its_line": True,
        "show_by_prefix_individual": False,
        "fields": [
            _f("witness_clause", "text", "Execution / Witness Clause", order=0),
            _f("company_header", "field", "Company Header", enabled=False, order=1, bold=True, column="left"),
            _f("section_header", "field", "Section Header", enabled=False, order=2, bold=True, column="left"),
            _f("date_line", "field", "Date Line", enabled=False, order=3, column="left"),
            _f("entity_name", "field", "Entity Name", enabled=False, order=4, bold=True),
            _f("additional_signing_entity", "field", "Sub-Entity 1", enabled=False, order=5),
            _f("additional_signing_entity_2", "field", "Sub-Entity 2", enabled=False, order=6),
            _f("additional_signing_entity_3", "field", "Sub-Entity 3", enabled=False, order=7),
            _f("by_line", "signature", "Signature Line", order=8),
            _f("signer_name", "field", "Signer Name", order=9),
            _f("title", "field", "Title", order=10),
            _f("address", "field", "Address", enabled=False, order=11),
            _f("city_state_zip", "field", "City/State/ZIP", enabled=False, order=12),
            _f("email", "field", "Email", enabled=False, order=13),
            _f("cc_email", "field", "CC Email", enabled=False, order=14),
            _f("phone", "field", "Phone", enabled=False, order=15),
        ],
        "footer_template": "Signature Page to Amended and Restated Certificate of Incorporation of {{company_name}}",
    },
    "investors_rights_agreement": {
        "page_type": "investors_rights_agreement",
        "display_name": "Investors\u2019 Rights Agreement",
        "default_title": "",
        "witness_clause_text": "IN WITNESS WHEREOF, the parties have executed this {{agreement_name}} as of the date first above written.",
        "entity_header_label": "",
        "section_header_label": "",
        "consent_text": "",
        "separate_its_line": True,
        "show_by_prefix_individual": False,
        "fields": [
            _f("witness_clause", "text", "Execution / Witness Clause", order=0),
            *_standard_sig_fields(1),
        ],
        "footer_template": "Signature Page to Investors\u2019 Rights Agreement of {{company_name}}",
        "related_documents": [],
    },
    "voting_agreement": {
        "page_type": "voting_agreement",
        "display_name": "Voting Agreement",
        "default_title": "",
        "witness_clause_text": "IN WITNESS WHEREOF, the parties have executed this {{agreement_name}} as of the date first above written.",
        "entity_header_label": "",
        "section_header_label": "",
        "consent_text": "",
        "separate_its_line": True,
        "show_by_prefix_individual": False,
        "fields": [
            _f("witness_clause", "text", "Execution / Witness Clause", order=0),
            *_standard_sig_fields(1),
        ],
        "footer_template": "Signature Page to Voting Agreement of {{company_name}}",
        "related_documents": [],
    },
    "rofr_cosale": {
        "page_type": "rofr_cosale",
        "display_name": "Right of First Refusal and Co-Sale Agreement",
        "default_title": "",
        "witness_clause_text": "IN WITNESS WHEREOF, the parties have executed this {{agreement_name}} as of the date first above written.",
        "entity_header_label": "",
        "section_header_label": "",
        "consent_text": "",
        "separate_its_line": True,
        "show_by_prefix_individual": False,
        "fields": [
            _f("witness_clause", "text", "Execution / Witness Clause", order=0),
            *_standard_sig_fields(1),
        ],
        "footer_template": "Signature Page to Right of First Refusal and Co-Sale Agreement of {{company_name}}",
        "related_documents": [],
    },
    # ===== Ancillary Documents =====
    "board_consent": {
        "page_type": "board_consent",
        "display_name": "Board Consent",
        "default_title": "",
        "witness_clause_text": "IN WITNESS WHEREOF, the undersigned has executed this Action by Unanimous Written Consent effective as of the date set forth above.",
        "entity_header_label": "",
        "section_header_label": "DIRECTORS:",
        "consent_text": "",
        "separate_its_line": True,
        "show_by_prefix_individual": False,
        "fields": [
            _f("witness_clause", "text", "Execution / Witness Clause", order=0),
            *_standard_sig_fields(1),
        ],
        "footer_template": "Signature Page to Action by Unanimous Written Consent of the Board of Directors of {{company_name}}",
    },
    "stockholder_consent": {
        "page_type": "stockholder_consent",
        "display_name": "Stockholder Consent",
        "default_title": "",
        "witness_clause_text": "",
        "entity_header_label": "",
        "section_header_label": "STOCKHOLDERS:",
        "consent_text": "By executing this action by written consent, each undersigned stockholder is giving written consent with respect to all shares of the Company\u2019s capital stock held by such stockholder in favor of the above resolutions. This action by written consent may be executed in any number of counterparts, each of which shall constitute an original and all of which together shall constitute one action. Any copy, facsimile or other reliable reproduction of this action by written consent may be substituted or used in lieu of the original writing for any and all purposes for which the original writing could be used. This action by written consent shall be filed with the minutes of the proceedings of the stockholders of the Company.",
        "separate_its_line": True,
        "show_by_prefix_individual": False,
        "fields": [
            _f("consent_text", "text", "Consent Action Language", order=0),
            _f("company_header", "field", "Company Header", enabled=False, order=1, bold=True, column="left"),
            _f("section_header", "field", "Section Header", enabled=True, order=2, bold=True, column="left"),
            _f("date_line", "field", "Date Line", enabled=False, order=3, column="left"),
            _f("entity_name", "field", "Entity Name", order=4, bold=True),
            _f("additional_signing_entity", "field", "Sub-Entity 1", order=5),
            _f("additional_signing_entity_2", "field", "Sub-Entity 2", order=6),
            _f("additional_signing_entity_3", "field", "Sub-Entity 3", order=7),
            _f("by_line", "signature", "Signature Line", order=8),
            _f("signer_name", "field", "Signer Name", order=9),
            _f("title", "field", "Title", order=10),
            _f("address", "field", "Address", enabled=False, order=11),
            _f("city_state_zip", "field", "City/State/ZIP", enabled=False, order=12),
            _f("email", "field", "Email", enabled=False, order=13),
            _f("cc_email", "field", "CC Email", enabled=False, order=14),
            _f("phone", "field", "Phone", enabled=False, order=15),
        ],
        "footer_template": "Signature Page to Stockholder Consent of {{company_name}}",
    },
    "compliance_certificate": {
        "page_type": "compliance_certificate",
        "display_name": "Compliance Certificate",
        "default_title": "President",
        "witness_clause_text": "The undersigned has executed this Compliance Certificate as an officer of the Company as of the date first set forth above.",
        "entity_header_label": "",
        "section_header_label": "",
        "consent_text": "",
        "separate_its_line": True,
        "show_by_prefix_individual": False,
        "fields": [
            _f("witness_clause", "text", "Execution / Witness Clause", order=0),
            *_standard_sig_fields(1),
        ],
        "footer_template": "Signature Page to Compliance Certificate of {{company_name}}",
    },
    "secretary_certificate": {
        "page_type": "secretary_certificate",
        "display_name": "Secretary\u2019s Certificate",
        "default_title": "Secretary",
        "witness_clause_text": "The undersigned has executed this Secretary\u2019s Certificate as an officer of the Company as of the date first set forth above.",
        "entity_header_label": "",
        "section_header_label": "",
        "consent_text": "",
        "separate_its_line": True,
        "show_by_prefix_individual": False,
        "fields": [
            _f("witness_clause", "text", "Execution / Witness Clause", order=0),
            *_standard_sig_fields(1),
        ],
        "footer_template": "Signature Page to Secretary\u2019s Certificate of {{company_name}}",
    },
    "indemnification_agreement": {
        "page_type": "indemnification_agreement",
        "display_name": "Indemnification Agreement",
        "default_title": "",
        "witness_clause_text": "IN WITNESS WHEREOF, the parties have executed this {{agreement_name}} as of the date first above written.",
        "entity_header_label": "",
        "section_header_label": "INDEMNITEE:",
        "consent_text": "",
        "separate_its_line": True,
        "show_by_prefix_individual": False,
        "fields": [
            _f("witness_clause", "text", "Execution / Witness Clause", order=0),
            _f("company_header", "field", "Company Header", enabled=True, order=1, bold=True, column="left"),
            _f("section_header", "field", "Section Header", enabled=True, order=2, bold=True, column="left"),
            _f("date_line", "field", "Date Line", enabled=False, order=3, column="left"),
            _f("entity_name", "field", "Entity Name", order=4, bold=True),
            _f("additional_signing_entity", "field", "Sub-Entity 1", order=5),
            _f("additional_signing_entity_2", "field", "Sub-Entity 2", order=6),
            _f("additional_signing_entity_3", "field", "Sub-Entity 3", order=7),
            _f("by_line", "signature", "Signature Line", order=8),
            _f("signer_name", "field", "Signer Name", order=9),
            _f("title", "field", "Title", order=10),
            _f("address", "field", "Address", enabled=False, order=11),
            _f("city_state_zip", "field", "City/State/ZIP", enabled=False, order=12),
            _f("email", "field", "Email", enabled=False, order=13),
            _f("cc_email", "field", "CC Email", enabled=False, order=14),
            _f("phone", "field", "Phone", enabled=False, order=15),
        ],
        "footer_template": "Signature Page to Indemnification Agreement of {{company_name}}",
    },
}

VALID_PAGE_TYPES = set(DEFAULT_CONFIGS.keys())


def get_valid_page_types():
    """Return all valid page types: built-in defaults + any custom configs on disk."""
    ensure_configs()
    types = set(DEFAULT_CONFIGS.keys())
    for filename in os.listdir(CONFIGS_DIR):
        if filename.endswith(".json"):
            types.add(filename[:-5])
    return types


# ---------------------------------------------------------------------------
# Data functions
# ---------------------------------------------------------------------------

def _write_config_file(path, config):
    """Write one config file using the canonical built-in shape."""
    with open(path, "w") as f:
        json.dump(config, f, indent=2)


def ensure_configs():
    """Create built-in config files only if missing or corrupted."""
    os.makedirs(CONFIGS_DIR, exist_ok=True)
    for page_type, config in DEFAULT_CONFIGS.items():
        path = os.path.join(CONFIGS_DIR, f"{page_type}.json")
        if not os.path.exists(path):
            _write_config_file(path, config)
            continue
        # Only recreate if the file is corrupted (unreadable JSON)
        try:
            with open(path) as f:
                json.load(f)
        except (OSError, json.JSONDecodeError):
            _write_config_file(path, config)


def get_config(page_type):
    """Load config for a single page type."""
    ensure_configs()
    path = os.path.join(CONFIGS_DIR, f"{page_type}.json")
    if not os.path.exists(path):
        return DEFAULT_CONFIGS.get(page_type)
    with open(path) as f:
        return json.load(f)


def get_all_configs():
    """Load all template configs (defaults + custom)."""
    ensure_configs()
    configs = []
    seen = set()
    for pt in DEFAULT_CONFIGS:
        configs.append(get_config(pt))
        seen.add(pt)
    for filename in sorted(os.listdir(CONFIGS_DIR)):
        if filename.endswith(".json"):
            pt = filename[:-5]
            if pt not in seen:
                configs.append(get_config(pt))
                seen.add(pt)
    return configs


def save_config(page_type, data):
    """Validate and save a template config."""
    ensure_configs()
    if not re.match(r'^[a-z][a-z0-9_]*$', page_type):
        return False

    data["page_type"] = page_type
    if not data.get("display_name"):
        default = DEFAULT_CONFIGS.get(page_type)
        data["display_name"] = default["display_name"] if default else page_type.replace("_", " ").title()

    path = os.path.join(CONFIGS_DIR, f"{page_type}.json")
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    return True


def reset_config(page_type):
    """Reset a template config to defaults (built-in types only)."""
    if page_type not in DEFAULT_CONFIGS:
        return False

    path = os.path.join(CONFIGS_DIR, f"{page_type}.json")
    with open(path, "w") as f:
        json.dump(DEFAULT_CONFIGS[page_type], f, indent=2)
    return True


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@template_editor_bp.route("/api/templates", methods=["GET"])
def list_templates():
    """Return all template configs."""
    return jsonify(get_all_configs())


@template_editor_bp.route("/api/templates", methods=["POST"])
def create_template():
    """Create a new custom page type."""
    data = request.get_json()
    display_name = (data.get("display_name") or "").strip()
    if not display_name:
        return jsonify({"error": "display_name is required"}), 400

    page_type = re.sub(r'[^a-z0-9]+', '_', display_name.lower()).strip('_')
    if not page_type or not re.match(r'^[a-z]', page_type):
        return jsonify({"error": "Invalid display name"}), 400

    ensure_configs()
    if os.path.exists(os.path.join(CONFIGS_DIR, f"{page_type}.json")):
        return jsonify({"error": "A page type with this name already exists"}), 409

    config = {
        "page_type": page_type,
        "display_name": display_name,
        "default_title": "",
        "witness_clause_text": "IN WITNESS WHEREOF, the parties have executed this {{agreement_name}} as of the date first above written.",
        "entity_header_label": "",
        "section_header_label": "",
        "consent_text": "",
        "separate_its_line": True,
        "show_by_prefix_individual": False,
        "fields": [
            _f("witness_clause", "text", "Execution / Witness Clause", order=0),
            *_standard_sig_fields(1),
        ],
        "footer_template": f"Signature Page to {display_name} of {{{{company_name}}}}",
        "related_documents": [],
    }

    save_config(page_type, config)
    return jsonify(config), 201


@template_editor_bp.route("/api/templates/<page_type>", methods=["GET"])
def get_template(page_type):
    """Return config for one page type."""
    if page_type not in get_valid_page_types():
        return jsonify({"error": "Invalid page type"}), 404
    return jsonify(get_config(page_type))


@template_editor_bp.route("/api/templates/<page_type>", methods=["PUT"])
def update_template(page_type):
    """Save updated config for one page type."""
    if page_type not in get_valid_page_types():
        return jsonify({"error": "Invalid page type"}), 404
    data = request.get_json()
    if save_config(page_type, data):
        return jsonify({"ok": True})
    return jsonify({"error": "Failed to save"}), 500


@template_editor_bp.route("/api/templates/<page_type>", methods=["DELETE"])
def delete_template(page_type):
    """Delete a custom page type. Cannot delete built-in types."""
    if page_type in DEFAULT_CONFIGS:
        return jsonify({"error": "Cannot delete built-in page type"}), 403
    path = os.path.join(CONFIGS_DIR, f"{page_type}.json")
    if not os.path.exists(path):
        return jsonify({"error": "Page type not found"}), 404
    os.remove(path)
    return jsonify({"ok": True})


@template_editor_bp.route("/api/templates/batch", methods=["PUT"])
def batch_update():
    """Apply a field change across all templates that have the field."""
    data = request.get_json()
    field_id = data.get("field_id")
    enabled = data.get("enabled")
    if field_id is None or enabled is None:
        return jsonify({"error": "field_id and enabled required"}), 400

    updated = []
    for pt in get_valid_page_types():
        config = get_config(pt)
        changed = False
        for field in config.get("fields", []):
            if field["id"] == field_id:
                field["enabled"] = enabled
                changed = True
        if changed:
            save_config(pt, config)
            updated.append(pt)

    return jsonify({"ok": True, "updated": updated})


@template_editor_bp.route("/api/templates/<page_type>/reset", methods=["POST"])
def reset_template(page_type):
    """Reset template to defaults (built-in types only)."""
    if page_type not in DEFAULT_CONFIGS:
        return jsonify({"error": "Not a built-in page type"}), 404
    if reset_config(page_type):
        return jsonify({"ok": True})
    return jsonify({"error": "Failed to reset"}), 500


@template_editor_bp.route("/api/templates/from-docx", methods=["POST"])
def create_template_from_docx():
    """Parse an uploaded .docx signature page and create a custom page type from it."""
    import tempfile
    from docx import Document as DocxDocument

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    file = request.files["file"]
    if not file.filename.endswith(".docx"):
        return jsonify({"error": "File must be a .docx"}), 400

    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
        file.save(tmp.name)
        tmp_path = tmp.name

    try:
        doc = DocxDocument(tmp_path)
        config = _parse_docx_to_config(doc, file.filename)

        # Ensure unique page_type key
        ensure_configs()
        base_pt = config["page_type"]
        pt = base_pt
        counter = 2
        while os.path.exists(os.path.join(CONFIGS_DIR, f"{pt}.json")):
            pt = f"{base_pt}_{counter}"
            counter += 1
        config["page_type"] = pt

        save_config(pt, config)
        return jsonify(config), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        os.unlink(tmp_path)


def _parse_docx_to_config(doc, filename):
    """Analyze a .docx document and build a template config from its structure."""
    paragraphs = [p for p in doc.paragraphs if p.text.strip()]

    # Derive display name from filename
    display_name = os.path.splitext(filename)[0]
    display_name = re.sub(r'[_\-]+', ' ', display_name).strip()
    display_name = display_name.title() if display_name else "Custom Document"

    page_type = re.sub(r'[^a-z0-9]+', '_', display_name.lower()).strip('_')
    if not page_type or not re.match(r'^[a-z]', page_type):
        page_type = "custom_document"

    # Detect structural elements from the text
    full_text = "\n".join(p.text.strip() for p in paragraphs)

    witness_clause = ""
    section_header = ""
    consent_text = ""
    footer_text = ""
    has_date_line = False
    has_by_line = False
    has_name = False
    has_title = False
    has_email = False
    has_address = False
    has_phone = False
    has_salutation = False
    has_accepted = False
    has_directors = False
    has_entity_header = False
    entity_header_label = ""

    for i, p in enumerate(paragraphs):
        text = p.text.strip()
        upper = text.upper()

        # Witness clause detection
        if "IN WITNESS WHEREOF" in upper or "WITNESS WHEREOF" in upper:
            # Collect the full witness clause (may span multiple paragraphs)
            parts = [text]
            for j in range(i + 1, min(i + 4, len(paragraphs))):
                next_t = paragraphs[j].text.strip()
                if next_t and not any(k in next_t.upper() for k in ["BY:", "NAME:", "DATE:", "TITLE:"]):
                    parts.append(next_t)
                else:
                    break
            witness_clause = " ".join(parts)
            continue

        # Consent text detection
        if "CONSENT" in upper and ("HEREBY" in upper or "UNDERSIGNED" in upper) and len(text) > 40:
            consent_text = text
            continue

        # Section header detection (bold all-caps short text like STOCKHOLDER:, INVESTOR:)
        if p.runs and all(r.bold for r in p.runs if r.text.strip()):
            if upper == upper and len(text) < 40 and text.endswith(":"):
                if "DIRECTOR" in upper:
                    has_directors = True
                elif any(kw in upper for kw in ["STOCKHOLDER", "SHAREHOLDER", "INVESTOR", "PURCHASER", "HOLDER"]):
                    has_entity_header = True
                    entity_header_label = text
                else:
                    section_header = text.rstrip(":")
                continue

        # Field detection
        if "DATE:" in upper or "DATE " in upper and "____" in text:
            has_date_line = True
        if text.startswith("By:") or text.startswith("BY:"):
            has_by_line = True
        if text.startswith("Name:") or text.startswith("NAME:"):
            has_name = True
        if text.startswith("Title:") or text.startswith("TITLE:"):
            has_title = True
        if text.startswith("Email:") or text.startswith("EMAIL:") or "E-MAIL:" in upper:
            has_email = True
        if text.startswith("Address:") or text.startswith("ADDRESS:"):
            has_address = True
        if text.startswith("Phone:") or text.startswith("PHONE:") or "TELEPHONE:" in upper:
            has_phone = True
        if "VERY TRULY YOURS" in upper or "TRULY YOURS" in upper:
            has_salutation = True
        if "ACCEPTED AND AGREED" in upper:
            has_accepted = True

        # Footer detection (short text at end with "Signature Page" mention)
        if "SIGNATURE PAGE" in upper and i >= len(paragraphs) - 3:
            footer_text = text

    # Also check document footers
    for section in doc.sections:
        footer = section.footer
        if footer and footer.paragraphs:
            ft = " ".join(fp.text.strip() for fp in footer.paragraphs if fp.text.strip())
            if ft:
                footer_text = ft

    # Build fields list
    order = 0
    fields = []

    if witness_clause:
        fields.append(_f("witness_clause", "text", "Witness Clause", order=order))
        order += 1
    if consent_text:
        fields.append(_f("consent_text", "text", "Consent Action Language", order=order))
        order += 1
    if has_directors:
        fields.append(_f("directors_header", "text", "Directors Header", order=order))
        order += 1
    if has_entity_header:
        fields.append(_f("entity_header", "text", "Entity Header", order=order))
        order += 1

    # Always include standard sig fields, but enable/disable based on what was found
    fields.append(_f("section_header", "field", "Section Header", enabled=bool(section_header), order=order, bold=True))
    order += 1
    fields.append(_f("date_line", "field", "Date Line", enabled=has_date_line, order=order, column="left"))
    order += 1
    fields.append(_f("entity_name", "field", "Entity Name", order=order, bold=True))
    order += 1
    for suffix, label, o in [("", "1", 0), ("_2", "2", 1), ("_3", "3", 2)]:
        fields.append(_f(f"additional_signing_entity{suffix}", "field", f"Additional Signing Entity {label}", order=order + o))
    order += 3
    fields.append(_f("by_line", "signature", "Signature Line", enabled=has_by_line or has_name, order=order))
    order += 1
    fields.append(_f("signer_name", "field", "Signer Name", enabled=has_name or has_by_line, order=order))
    order += 1
    fields.append(_f("title", "field", "Title", enabled=has_title, order=order))
    order += 1
    if has_salutation:
        fields.append(_f("salutation", "text", 'Closing Line', order=order))
        order += 1
    if has_accepted:
        fields.append(_f("accepted_and_agreed", "text", "Acceptance Header", order=order))
        order += 1
    fields.append(_f("email", "field", "Email", enabled=has_email, order=order))
    order += 1
    fields.append(_f("phone", "field", "Phone", enabled=has_phone, order=order))
    order += 1
    fields.append(_f("cc_email", "field", "CC Email", enabled=False, order=order))
    order += 1
    fields.append(_f("address", "field", "Address", enabled=has_address, order=order))
    order += 1
    fields.append(_f("city_state_zip", "field", "City/State/ZIP", enabled=has_address, order=order))
    order += 1

    # Replace literal agreement name with placeholder in witness clause
    witness_clause_tpl = witness_clause
    # Common patterns: try to detect and replace the agreement name
    for pattern in [r"this\s+(.+?)\s+as of", r"this\s+(.+?)\s+effective"]:
        m = re.search(pattern, witness_clause, re.IGNORECASE)
        if m:
            witness_clause_tpl = witness_clause_tpl.replace(m.group(1), "{{agreement_name}}")
            break

    # Build footer template
    footer_tpl = footer_text
    if footer_tpl:
        footer_tpl = re.sub(r"(?i)signature\s+page\s+to\s+", "Signature Page to ", footer_tpl)

    return {
        "page_type": page_type,
        "display_name": display_name,
        "default_title": "",
        "witness_clause_text": witness_clause_tpl,
        "entity_header_label": entity_header_label,
        "section_header_label": section_header,
        "consent_text": consent_text,
        "separate_its_line": True,
        "show_by_prefix_individual": False,
        "fields": fields,
        "footer_template": footer_tpl or f"Signature Page to {{{{agreement_name}}}} of {{{{company_name}}}}",
        "related_documents": [],
    }
