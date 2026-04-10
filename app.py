"""
Signature Packet Generator
A Flask web app that generates professional legal signature pages as .docx files.
Formatting exactly matches the reference template (Company 1 (1).docx).
"""

from flask import Flask, render_template, request, send_file, jsonify
from io import BytesIO
from collections import OrderedDict
import base64
import binascii
import logging
import os
import re
import tempfile
import zipfile
from PIL import Image, UnidentifiedImageError

from documents.json_generator import generate_from_templates
from services.template_config import get_valid_page_types, get_config
from services.extraction import extract_fields
from services.signatures import signatures_bp, add_signature_row, add_signature_rows_batch
from services.template_config import template_editor_bp
from services.bulk_extract import extract_signatories_from_docx, extract_signatories_from_pdf
from services.azure_document_intelligence import image_to_string_azure

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024  # 100 MB max upload (large executed PDFs)

# Register the signatures Blueprint
app.register_blueprint(signatures_bp)
app.register_blueprint(template_editor_bp)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Flask routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


# Page type ordering for grouped output
PAGE_TYPE_ORDER = [
    # Main Documents
    "stock_purchase_agreement",
    "certificate_of_incorporation",
    "investors_rights_agreement",
    "voting_agreement",
    "rofr_cosale",
    # Ancillary Documents
    "board_consent",
    "stockholder_consent",
    "compliance_certificate",
    "secretary_certificate",
    "indemnification_agreement",
]


def _sanitize_filename(name):
    """Remove characters unsafe in filenames and replace spaces with underscores."""
    name = re.sub(r'[<>:"/\\|?*]', '', name)
    name = name.strip().replace(' ', '_')
    return name or "Unnamed"


@app.route("/generate", methods=["POST"])
def generate():
    payload = request.get_json()
    financing_round = payload.get("financing_round", "[___]")
    company_name = payload.get("company_name", "[Company]")

    entries = payload.get("entries", [])
    if not entries:
        return jsonify({"error": "No signatories provided"}), 400

    # Build (page_type, sig_block, field_overrides) tuples in signer order
    # Entries arrive in matrix row order — preserve that order for the output
    pairs = []
    for entry in entries:
        sb = entry.get("sig_block", {})
        all_overrides = sb.get("field_overrides", {})
        for pt in entry.get("page_types", []):
            if pt in get_valid_page_types():
                pt_overrides = all_overrides.get(pt) if all_overrides else None
                pairs.append((pt, sb, pt_overrides))

    if not pairs:
        return jsonify({"error": "No valid page types selected"}), 400

    download_mode = payload.get("download_mode", "all_in_one")

    if download_mode == "all_in_one":
        doc = generate_from_templates(pairs, financing_round=financing_round, company_name=company_name)
        if not doc:
            return jsonify({"error": "Failed to generate document"}), 500
        buffer = BytesIO()
        doc.save(buffer)
        buffer.seek(0)
        return send_file(
            buffer, as_attachment=True,
            download_name="Signature_Pages.docx",
            mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )

    elif download_mode == "by_entity":
        grouped = OrderedDict()
        for pt, sb, overrides in pairs:
            key = (sb.get("signer_name", ""), sb.get("signing_entity", ""))
            grouped.setdefault(key, []).append((pt, sb, overrides))

        zip_buffer = BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
            used_names = set()
            for (signer_name, signing_entity), group_pairs in grouped.items():
                doc = generate_from_templates(group_pairs, financing_round=financing_round, company_name=company_name)
                if not doc:
                    continue
                # Use entity name for entities, signer name for individuals
                signer_type = group_pairs[0][1].get("signer_type", "entity")
                label = (signing_entity if signer_type == "entity" and signing_entity else signer_name) or "Unnamed"
                safe_name = _sanitize_filename(label)
                original = safe_name
                counter = 2
                while safe_name in used_names:
                    safe_name = f"{original}_{counter}"
                    counter += 1
                used_names.add(safe_name)
                doc_buffer = BytesIO()
                doc.save(doc_buffer)
                zf.writestr(f"{safe_name}.docx", doc_buffer.getvalue())
        zip_buffer.seek(0)
        return send_file(
            zip_buffer, as_attachment=True,
            download_name="Signature_Pages_By_Entity.zip",
            mimetype="application/zip",
        )

    elif download_mode == "by_document":
        grouped = OrderedDict()
        for pt, sb, overrides in pairs:
            grouped.setdefault(pt, []).append((pt, sb, overrides))

        def _sort_key(pt):
            try:
                return PAGE_TYPE_ORDER.index(pt)
            except ValueError:
                return len(PAGE_TYPE_ORDER)

        zip_buffer = BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
            for pt in sorted(grouped.keys(), key=_sort_key):
                group_pairs = grouped[pt]
                doc = generate_from_templates(group_pairs, financing_round=financing_round, company_name=company_name)
                if not doc:
                    continue
                config = get_config(pt)
                display = config.get("display_name", pt.replace("_", " ").title()) if config else pt.replace("_", " ").title()
                safe_name = _sanitize_filename(display)
                doc_buffer = BytesIO()
                doc.save(doc_buffer)
                zf.writestr(f"{safe_name}.docx", doc_buffer.getvalue())
        zip_buffer.seek(0)
        return send_file(
            zip_buffer, as_attachment=True,
            download_name="Signature_Pages_By_Document.zip",
            mimetype="application/zip",
        )

    else:
        return jsonify({"error": f"Unknown download_mode: {download_mode}"}), 400


@app.route("/bulk-extract", methods=["POST"])
def bulk_extract():
    """Upload a .docx with signature blocks, extract all signatories."""
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    filename_lower = file.filename.lower()
    if filename_lower.endswith(".pdf"):
        suffix = ".pdf"
    elif filename_lower.endswith(".docx"):
        suffix = ".docx"
    else:
        return jsonify({"error": "File must be a .docx or .pdf"}), 400

    # Save to temp file
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        file.save(tmp.name)
        tmp_path = tmp.name

    try:
        if suffix == ".pdf":
            signatories = extract_signatories_from_pdf(tmp_path)
        else:
            signatories, _ = extract_signatories_from_docx(tmp_path)

        # Collect all valid rows then write in one batch (single load/save cycle).
        # Deduplicate by (signing_entity, signer_name) — executed PDFs repeat the same
        # investor across multiple agreement signature pages.
        batch = []
        seen_keys = set()
        for sig in signatories:
            fields = {
                "signer_type": sig.get("signer_type", "entity"),
                "signer_name": sig.get("signer_name", ""),
                "title": sig.get("title", ""),
                "signing_entity": sig.get("entity_name", ""),
                "additional_signing_entity": sig.get("additional_signing_entity", ""),
                "additional_signing_entity_title": sig.get("additional_signing_entity_title", ""),
                "additional_signing_entity_2": sig.get("additional_signing_entity_2", ""),
                "additional_signing_entity_title_2": sig.get("additional_signing_entity_title_2", ""),
                "additional_signing_entity_3": sig.get("additional_signing_entity_3", ""),
                "additional_signing_entity_title_3": sig.get("additional_signing_entity_title_3", ""),
                "email": sig.get("email", ""),
                "phone": sig.get("phone", ""),
                "cc_email": sig.get("cc_email", ""),
                "address": sig.get("address", ""),
                "city_state_zip": sig.get("city_state_zip", ""),
            }
            if fields["signer_name"] or fields["signing_entity"]:
                key = (fields["signing_entity"].lower(), fields["signer_name"].lower())
                if key not in seen_keys:
                    seen_keys.add(key)
                    batch.append(fields)

        if batch:
            add_signature_rows_batch("", batch)

        return jsonify({
            "ok": True,
            "total_found": len(signatories),
            "added": len(batch),
            "signatories": signatories,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        os.unlink(tmp_path)


@app.route("/extract", methods=["POST"])
def extract():
    """Accept a base64-encoded screenshot, OCR it, and return extracted fields."""
    payload = request.get_json()
    image_b64 = payload.get("image")
    if not image_b64:
        return jsonify({"error": "No image provided"}), 400

    # Strip data URL prefix
    if "," in image_b64:
        image_b64 = image_b64.split(",", 1)[1]

    try:
        image_data = base64.b64decode(image_b64, validate=True)
    except (binascii.Error, ValueError, UnidentifiedImageError, OSError):
        return jsonify({"error": "Invalid image payload"}), 400

    # Run OCR
    raw_text = image_to_string_azure(image_data)
    # Use AI to extract fields
    logger.info(f"OCR text: {raw_text[:200]}")
    fields = extract_fields(raw_text)
    logger.info(f"Extracted fields: {fields}")

    return jsonify({"raw_text": raw_text, "fields": fields, "method": 'azure_document_intelligence'})


if __name__ == "__main__":
    # app.run(debug=True, port=5050)
    app.run(host="0.0.0.0", port=8000)
