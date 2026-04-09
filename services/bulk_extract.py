"""
Bulk signature extraction from .docx files.
Parses uploaded signature documents page-by-page to extract all signatories
and add them to the signature log.

Distinguishes between entity signers (with signing_entity, possible
additional_signing_entity and role) and individual signers (name only, no title).

Extraction priority:
  1. Azure OpenAI API (via extract_fields) — preferred, more accurate
  2. Heuristic parser (parse_signature_block) — fallback if AI is unavailable or fails
"""

import dataclasses
import logging
import re
from docx import Document

logger = logging.getLogger(__name__)


def _block_to_text(block_paragraphs):
    """Convert block paragraphs to plain text string for AI extraction."""
    return "\n".join(p.text.strip() for p in block_paragraphs if p.text.strip())


def _normalize_ai_result(ai_result):
    """Normalize AI extraction output to the same format as the heuristic parser.

    AI returns: signing_entity, signer_name, title, additional_signing_entity, ...
    Heuristic returns: entity_name, signer_name, title, signer_type, ...
    """
    if not ai_result:
        return None
    entity = ai_result.get("signing_entity", "")
    signer_type = "entity" if entity else "individual"
    normalized = {
        "signer_type": signer_type,
        "entity_name": entity,
        "signer_name": ai_result.get("signer_name", ""),
        "title": ai_result.get("title", ""),
        "additional_signing_entity": ai_result.get("additional_signing_entity", ""),
        "additional_signing_entity_title": ai_result.get("additional_signing_entity_title", ""),
        "additional_signing_entity_2": ai_result.get("additional_signing_entity_2", ""),
        "additional_signing_entity_title_2": ai_result.get("additional_signing_entity_title_2", ""),
        "additional_signing_entity_3": ai_result.get("additional_signing_entity_3", ""),
        "additional_signing_entity_title_3": ai_result.get("additional_signing_entity_title_3", ""),
        "email": ai_result.get("email", ""),
        "phone": ai_result.get("phone", ""),
        "cc_email": ai_result.get("cc_email", ""),
        "address": ai_result.get("address", ""),
        "city_state_zip": ai_result.get("city_state_zip", ""),
    }
    return normalized


def extract_signatories_from_docx(file_path):
    """Extract all signature blocks from a .docx file.

    For each block, tries AI extraction first (Azure OpenAI via extract_fields).
    Falls back to the heuristic parser if AI is unavailable or returns empty.

    Returns a list of dicts, each with:
        entity_name, signer_name, title, additional_signing_entity,
        additional_signing_entity_title, (and contact fields)
    """
    try:
        doc = Document(file_path)
    except Exception as e:
        raise ValueError(f"Failed to read .docx file '{file_path}': {e}") from e

    # Import here to avoid circular imports at module load time
    try:
        from services.extraction import extract_multiple_fields
        ai_available = True
    except ImportError:
        ai_available = False
        logger.warning("extraction module not available; using heuristic only")

    paragraphs = doc.paragraphs
    blocks = split_into_blocks(paragraphs)

    signatories = []
    for block in blocks:
        sig_added = False

        # --- Try AI extraction first (returns a list — handles multiple signers per block) ---
        if ai_available:
            block_text = _block_to_text(block)
            if block_text:
                try:
                    ai_results = extract_multiple_fields(block_text)
                    valid = [
                        _normalize_ai_result(r) for r in ai_results
                        if r and (r.get("signer_name") or r.get("signing_entity"))
                    ]
                    if valid:
                        signatories.extend(valid)
                        sig_added = True
                except Exception as e:
                    logger.warning(f"AI extraction failed for block, falling back to heuristic: {e}")

        # --- Fallback to heuristic parser ---
        if not sig_added:
            extracted = parse_signature_block(block)
            if extracted:
                for sig in extracted:
                    if sig.get("signer_name") or sig.get("entity_name"):
                        signatories.append(sig)

    return signatories


# ---------------------------------------------------------------------------
# Block splitting
# ---------------------------------------------------------------------------

_BOUNDARY_RE = re.compile(
    r'(?i)^('
    r'(?:ACKNOWLEDGED|AGREED|ACCEPTED)\s*(?:AND\s*(?:AGREED|ACCEPTED))?\s*[:.]?'
    r'|SIGNATURE\s+PAGE'
    r'|\[SIGNATURE\s+PAGE'
    r'|EXECUTED\s+as\s+of'
    r'|The\s+parties\s+have\s+executed'
    r')$'
)

_PREFIX_BOUNDARIES = (
    "by executing this action by written consent",
    "in witness whereof",
    "very truly yours",
    "the undersigned has executed",
)


def split_into_blocks(paragraphs):
    """Split paragraphs into signature blocks."""
    blocks = []
    current_block = []

    for p in paragraphs:
        text = p.text.strip()
        text_lower = text.lower()

        is_boundary = (
            text_lower.startswith(_PREFIX_BOUNDARIES)
            or "stockholders:" in text_lower
            or _BOUNDARY_RE.match(text)
        )

        if is_boundary and current_block:
            blocks.append(current_block)
            current_block = []

        current_block.append(p)

    if current_block:
        blocks.append(current_block)

    # Resplit any block that contains multiple signatories separated by
    # 2+ blank paragraphs.  Previously this only ran when the entire
    # document produced a single block; now it runs on every block so
    # that large sections under one boundary header are properly split.
    expanded = []
    for blk in blocks:
        expanded.extend(_resplit_large_block(blk))
    blocks = expanded

    return blocks


def _resplit_large_block(block):
    """Split a single large block at gaps of 2+ blank paragraphs."""
    # Count Name:/By: lines to decide whether resplit is worthwhile.
    # Only count substantive Name: lines — By: lines are subordinate to
    # their entity and don't indicate separate signature blocks.
    name_by_count = sum(
        1 for p in block
        if re.match(r'(?i)^\s*(?:print(?:ed)?|signatory)?\s*name\s*:', p.text)
    )
    if name_by_count < 2:
        return [block]

    sub_blocks = []
    current = []
    blank_run = 0

    for p in block:
        text = p.text.strip()
        if not text:
            blank_run += 1
        else:
            if blank_run >= 2 and current:
                sub_blocks.append(current)
                current = []
            blank_run = 0
        current.append(p)

    if current:
        sub_blocks.append(current)

    if len(sub_blocks) <= 1:
        return [block]

    # Merge sub-blocks that have entity/intermediary content but no actual
    # signer with the following sub-block, so that blank-line gaps inside
    # a signature block don't orphan the entity from its signer.
    merged = []
    i = 0
    while i < len(sub_blocks):
        blk = sub_blocks[i]
        if i + 1 < len(sub_blocks) and _should_merge_forward(blk):
            sub_blocks[i + 1] = blk + sub_blocks[i + 1]
        else:
            merged.append(blk)
        i += 1

    return merged if len(merged) > 1 else [block]


def _should_merge_forward(paragraphs):
    """True when a sub-block has entity/intermediary content but no signer.

    Covers both entity-only blocks and entity + By:/Its: blocks that lack
    a Name: line or bare person name.
    """
    has_entity_content = False
    for p in paragraphs:
        text = p.text.strip()
        if not text:
            continue
        text_lower = text.lower()
        # A substantive Name: label means this block has a signer
        if re.match(r'(?i)^\s*(?:print(?:ed)?|signatory)?\s*name\s*:', text):
            val = re.sub(r'(?i)^(?:print(?:ed)?|signatory)?\s*name\s*:\s*', '', text).strip()
            if val and val.replace('_', '').replace(' ', ''):
                return False
        # Inline signer patterns
        if re.match(r'.+,\s*individually$', text, re.IGNORECASE):
            return False
        if re.match(r'.+,\s*as\s+.+\s+of\s+.+$', text, re.IGNORECASE):
            return False
        # Bare person name (not after By:/Its: prefix) means signer present
        if not text_lower.startswith(('by:', 'its:')):
            if _looks_like_person_name(text):
                return False
        # Track entity-like content (entity names, By:/Its: lines, headers)
        if _looks_like_entity_name(text) or _is_entity_header(text):
            has_entity_content = True
        if text_lower.startswith(('by:', 'its:')):
            has_entity_content = True
    return has_entity_content


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

ENTITY_HEADERS = {
    "STOCKHOLDERS:", "STOCKHOLDER", "STOCKHOLDERS",
    "COMPANY", "COMPANY:",
    "INDEMNITEE", "INDEMNITEE:",
    "KEY HOLDER", "KEY HOLDER:", "KEY HOLDERS", "KEY HOLDERS:",
    "DIRECTORS:", "DIRECTOR", "DIRECTORS",
    "INVESTORS:", "INVESTOR", "INVESTORS",
    "PURCHASER", "PURCHASER:", "PURCHASERS", "PURCHASERS:",
    "HOLDER", "HOLDER:", "HOLDERS", "HOLDERS:",
    "SHAREHOLDER", "SHAREHOLDER:", "SHAREHOLDERS", "SHAREHOLDERS:",
    "FOUNDER", "FOUNDER:", "FOUNDERS", "FOUNDERS:",
    "LENDER", "LENDER:", "LENDERS", "LENDERS:",
    "BUYER", "BUYER:", "BUYERS", "BUYERS:",
    "SELLER", "SELLER:", "SELLERS", "SELLERS:",
    "BORROWER", "BORROWER:", "BORROWERS", "BORROWERS:",
    "GUARANTOR", "GUARANTOR:", "GUARANTORS", "GUARANTORS:",
    "PARTICIPANT", "PARTICIPANT:", "PARTICIPANTS", "PARTICIPANTS:",
}

_ENTITY_HEADERS_NORMALIZED = {h.rstrip(":") for h in ENTITY_HEADERS}

SKIP_PREFIXES = (
    "by executing", "in witness whereof", "the undersigned",
    "very truly yours", "accepted and agreed", "signature page",
    "fax:", "facsimile:", "attn:", "attention:",
)

# Regex matching any name label variant: Name:, Print Name:, Printed Name:, Signatory Name:
_NAME_LABEL_RE = re.compile(r'(?i)^(?:print(?:ed)?|signatory)?\s*name\s*:\s*')

# Regex matching title-like labels: Title:, Capacity:, Its:, In the capacity of:
_TITLE_LABEL_RE = re.compile(r'(?i)^(?:title|capacity|its|in\s+the\s+capacity\s+of)\s*:\s*')

# Regex matching address labels: Address:, Notice Address:, Registered Office:
_ADDRESS_LABEL_RE = re.compile(
    r'(?i)^(?:notice\s+address|notice\s+info|address|registered\s+office|registered\s+address|registered\s+agent)\s*:\s*'
)

# Regex matching phone labels: Phone:, Tel:, Telephone:
_PHONE_LABEL_RE = re.compile(r'(?i)^(?:phone|tel(?:ephone)?)\s*:\s*')

# Regex to detect signature placeholder lines
_SIGNATURE_LINE_RE = re.compile(r'(?i)^signature\s*:\s*[_\s]*$')

# Heuristic for bare address lines (no "Address:" prefix)
_BARE_ADDRESS_RE = re.compile(
    r'(?:'
    r'\d+\s+[\w\s]+(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Way|Place|Pl|Center|Centre|Marg)\b'
    r'|(?:Suite|Ste|Floor|Fl)\s+\d'
    r'|\d+(?:st|nd|rd|th)\s+Floor'
    r'|P\.?O\.?\s*Box\s+\d'
    r'|c/o\s+'
    r'|\d+\s+\w+\s+\w+,\s*(?:Suite|Ste|Floor|Fl|#)\s*\d'
    r'|\w+(?:strasse|straße|gasse|weg|platz)\s+\d'
    r'|#\d+-\d+\s+'
    r'|\d+\s+\w+\s+\w+,\s+\d+(?:st|nd|rd|th)\s+Floor'
    r'|Sector\s+\d'
    r'|\w+\s+Marg\b'
    r')',
    re.IGNORECASE,
)

_CITY_STATE_ZIP_RE = re.compile(
    r'(?:'
    r'[A-Z][a-zA-Z\s]+,\s*[A-Z]{2}\s+\d{5}'  # US: City, ST 12345
    r'|[A-Z][a-zA-Z\s]+,\s*[A-Z]{2}\s+\w{3}\s*\w{3}'  # Canada: City, ON M5A 1A1
    r'|\d{4,5}\s+[A-Z]'  # International: 8001 Zurich
    r'|[A-Za-z]+,\s*[A-Za-z\s]+\d{4,6}'  # Gurugram, Haryana 122001
    r'|[A-Z][a-z]+\s+[A-Z][a-z]+,?\s+\w{2,3}\d'  # Grand Cayman KY1-1104
    r'|Singapore\s+\d'  # Singapore 018981
    r'|Marina\s+Bay'  # Marina Bay Financial Centre
    r')',
)

_ENTITY_CUE_RE = re.compile(
    r'\b('
    r'LLC|LP|L\.P\.|Inc\.?|Corp\.?|Corporation|Ltd\.?|Limited|LLP|PLC|P\.L\.C\.|'
    r'AG|GmbH|BV|N\.V\.|NV|S\.A\.|SAS|SRL|S\.R\.L\.|S\.p\.A\.|SPA|'
    r'GP|Partners?|Fund|Capital|Ventures|Holdings?|Trust|Foundation|Associates|'
    r'Company|Group|Management|International|Pty|Sociedad|Fundo|Authority|'
    r'Institute|University|KABUSHIKI|KAISHA|SERIES'
    r')\b',
    re.IGNORECASE,
)

# Regex for nominee/DBA patterns (used in both person and entity detection)
_NOMINEE_DBA_RE = re.compile(
    r'\b(AS NOMINEE|NOMINEE FOR|d/b/a|f/k/a|ACN\s+\d|ATF\s+)\b', re.IGNORECASE
)

_PERSON_CONNECTORS = {"and", "or"}
_PERSON_PREFIXES = {"mr", "mrs", "ms", "dr", "prof", "sir", "hon", "h.e", "he"}
_PERSON_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v", "vi"}
_NON_SIGNER_PREFIXES = (
    "acting ",
    "signing in the following capacities",
    "pursuant to:",
    "countersigned:",
    "poa reference:",
    "company no.",
    "number of shares of",
    "series a preferred:",
    "series b preferred:",
    "series c preferred:",
    "common stock:",
    "warrants",
    "shares consented as set forth",
)


def _is_entity_header(text):
    return text.strip().rstrip(":").upper() in _ENTITY_HEADERS_NORMALIZED


# Regex to match a signer role prefix at the start of a line (e.g., "PURCHASER:", "INVESTOR:")
# followed by optional whitespace/tab and then content. Used to strip role prefixes from entity names.
_SIGNER_ROLE_PREFIX_RE = re.compile(
    r'^(?:' + '|'.join(re.escape(h.rstrip(':')) for h in _ENTITY_HEADERS_NORMALIZED) + r')\s*:\s*',
    re.IGNORECASE
)


def _strip_signer_role_prefix(text):
    """Strip signer role prefixes like 'PURCHASER:', 'INVESTOR:' from the start of text."""
    return _SIGNER_ROLE_PREFIX_RE.sub('', text).strip()


def _clean_text(text):
    return re.sub(r'\s+', ' ', text.replace("\xa0", " ")).strip()


def _clean_entity_name(text):
    cleaned = _clean_text(text).rstrip(",")
    # Strip signer role prefixes (e.g., "PURCHASER: ENTITY NAME" -> "ENTITY NAME")
    cleaned = _strip_signer_role_prefix(cleaned)
    while cleaned.endswith(")") and cleaned.count(")") > cleaned.count("("):
        cleaned = cleaned[:-1].rstrip()
    return cleaned


def _looks_like_person_name(text):
    cleaned = _clean_entity_name(text).rstrip(":;")
    lowered = cleaned.lower()
    if not cleaned or cleaned.startswith("(") or len(cleaned) > 80:
        return False
    if _ENTITY_CUE_RE.search(cleaned):
        return False
    if _NOMINEE_DBA_RE.search(cleaned):
        return False
    if lowered.startswith(_NON_SIGNER_PREFIXES):
        return False

    raw_tokens = cleaned.replace(",", " ").split()
    if not 1 < len(raw_tokens) <= 8:
        return False

    personish = 0
    for token in raw_tokens:
        stripped = token.strip("()")
        lowered_token = stripped.lower().strip(".")
        if not stripped:
            continue
        if lowered_token in _PERSON_CONNECTORS:
            continue
        if lowered_token in _PERSON_PREFIXES or lowered_token in _PERSON_SUFFIXES:
            personish += 1
            continue
        if re.fullmatch(r'[A-Z](?:\.[A-Z])+\.?', stripped) or re.fullmatch(r'[A-Z]\.?', stripped):
            personish += 1
            continue
        alpha_only = re.sub(r"[^A-Za-z''-]", "", stripped)
        if alpha_only and alpha_only[0].isupper():
            personish += 1
            continue
        return False

    return personish >= 2


def _looks_like_entity_name(text):
    """Heuristic: entity names contain corporate suffixes or are long ALL CAPS phrases."""
    cleaned = _clean_entity_name(text)
    if not cleaned:
        return False
    if _ENTITY_CUE_RE.search(cleaned):
        return True
    if _NOMINEE_DBA_RE.search(cleaned):
        return True
    if _looks_like_person_name(cleaned):
        return False
    words = cleaned.split()
    alpha = [c for c in cleaned if c.isalpha()]
    is_mostly_caps = alpha and sum(1 for c in alpha if c.isupper()) / len(alpha) > 0.7
    if is_mostly_caps and len(words) >= 4:
        return True
    return False


def _match_its_prefix(text):
    """Match 'its', 'Its', 'ITS', 'its:', ', its' role prefix variations."""
    m = re.match(r'^,?\s*its\s*:?\s*(.*)$', text, re.IGNORECASE)
    if m:
        return True, m.group(1).strip().rstrip(",")
    return False, ""


def _strip_name_label(text):
    """Remove any name label prefix (Name:, Print Name:, etc.) from text."""
    return _clean_text(_NAME_LABEL_RE.sub('', text))


def _strip_title_label(text):
    """Remove title/capacity/its label prefix from text."""
    return _clean_text(_TITLE_LABEL_RE.sub('', text))


def _split_name_title(name_value):
    """Split comma-separated name,Title or name,ITS patterns.

    Handles: 'Jet Li,  Title: Director' or 'Tom Cruise,  ITS: Manager'
    Returns (name, title).
    """
    m = re.search(r',\s*(?:title|its|capacity)\s*:\s*', name_value, re.IGNORECASE)
    if m:
        name = name_value[:m.start()].strip()
        title = name_value[m.end():].strip()
        return name, title
    return name_value, ""


def _additional_fields(additional_entities):
    fields = {}
    for idx, (name, title) in enumerate(additional_entities[:3]):
        suffix = "" if idx == 0 else f"_{idx + 1}"
        fields[f"additional_signing_entity{suffix}"] = name
        fields[f"additional_signing_entity_title{suffix}"] = title
    return fields


def _contact_fields(email, address, city_state_zip, phone):
    return {k: v for k, v in (("email", email), ("address", address),
            ("city_state_zip", city_state_zip), ("phone", phone)) if v}


def _looks_like_noise_line(text):
    cleaned = _clean_text(text)
    lowered = cleaned.lower()
    if not cleaned:
        return True
    if cleaned.startswith("[") and cleaned.endswith("]"):
        return True
    if lowered in {"and", "&"}:
        return True
    if lowered.startswith(_NON_SIGNER_PREFIXES):
        return True
    return False


def _collect_continuation_lines(texts, start_idx):
    lines = []
    j = start_idx + 1

    while j < len(texts):
        next_text = _clean_text(texts[j][0])
        next_lower = next_text.lower()
        if not next_text:
            break
        if _has_field_prefix(next_lower):
            break
        if _is_entity_header(next_text):
            break
        if next_lower.startswith(("attn:", "attention:")):
            break
        if len(next_text) >= 120:
            break
        lines.append(next_text)
        j += 1

    return lines, j


def _split_address_lines(lines):
    cleaned_lines = [_clean_text(line) for line in lines if _clean_text(line)]
    if not cleaned_lines:
        return "", ""
    if len(cleaned_lines) == 1:
        return cleaned_lines[0], ""

    city_idx = None
    for idx in range(len(cleaned_lines) - 1, -1, -1):
        if _CITY_STATE_ZIP_RE.search(cleaned_lines[idx]):
            city_idx = idx
            break

    if city_idx is None:
        return ", ".join(cleaned_lines), ""

    address_lines = cleaned_lines[:city_idx]
    city_state_zip = cleaned_lines[city_idx]
    address = ", ".join(address_lines).strip(", ")
    return address, city_state_zip


def _parse_inline_signer_line(text, additional_entities):
    cleaned = _clean_text(text)

    individual_match = re.match(r'^(?P<name>.+?),\s*individually$', cleaned, re.IGNORECASE)
    if individual_match:
        name = individual_match.group("name").strip()
        if _looks_like_person_name(name):
            return {
                "name": name,
                "title": "",
                "is_entity": False,
                "entity_name": "",
                "additional_entities": [],
            }

    entity_match = re.match(
        r'^(?P<name>.+?),\s*as\s+(?P<title>.+?)\s+of\s+(?P<entity>.+)$',
        cleaned,
        re.IGNORECASE,
    )
    if entity_match:
        name = entity_match.group("name").strip()
        title = entity_match.group("title").strip().rstrip(",")
        entity = _clean_entity_name(entity_match.group("entity"))
        if _looks_like_person_name(name) and entity:
            return {
                "name": name,
                "title": title,
                "is_entity": True,
                "entity_name": entity,
                "additional_entities": list(additional_entities),
            }

    return None


# ---------------------------------------------------------------------------
# Block parser
# ---------------------------------------------------------------------------

_FIELD_PREFIXES = (
    "by:", "name:", "print name:", "printed name:", "signatory name:",
    "title:", "capacity:", "its:", "email:", "email ", "email(", "e-mail:", "address:",
    "notice address:", "notice info:", "phone:", "tel:", "telephone:", "date:", "fax:",
    "facsimile:", "attn:", "attention:", "signature:", "in the capacity of:",
    "signing in the following capacities:", "pursuant to:", "countersigned:",
    "poa reference:", "company no.", "registered office:", "registered address:",
    "registered agent:",
)


def _has_field_prefix(text_lower):
    return text_lower.startswith(_FIELD_PREFIXES)


@dataclasses.dataclass
class _ParserState:
    entity_name: str = ""
    additional_entities: list = dataclasses.field(default_factory=list)
    signers: list = dataclasses.field(default_factory=list)
    email: str = ""
    address: str = ""
    city_state_zip: str = ""
    phone: str = ""

    def reset_for_new_entity(self):
        self.signers = []
        self.additional_entities = []
        self.email = ""
        self.address = ""
        self.city_state_zip = ""
        self.phone = ""

    def flush(self, results):
        """Emit signatory dicts from accumulated state."""
        contact = _contact_fields(self.email, self.address, self.city_state_zip, self.phone)

        if self.signers:
            for s in self.signers:
                is_ent = s["is_entity"]
                sig = {
                    "signer_type": "entity" if is_ent else "individual",
                    "entity_name": s["entity_name"] if is_ent else "",
                    "signer_name": s["name"],
                    "title": s["title"] if is_ent else "",
                    **_additional_fields(s["additional_entities"]),
                    **contact,
                }
                results.append(sig)
        elif (self.entity_name and _looks_like_entity_name(self.entity_name)
              and (self.additional_entities or self.email or self.address
                   or self.city_state_zip or self.phone)):
            results.append({
                "signer_type": "entity",
                "entity_name": self.entity_name,
                "signer_name": "",
                "title": "",
                **_additional_fields(self.additional_entities),
                **contact,
            })


def parse_signature_block(block_paragraphs):
    """Parse a signature block and extract signatory information."""
    results = []
    texts = [(p.text, p) for p in block_paragraphs]
    st = _ParserState()

    i = 0
    while i < len(texts):
        raw_text = texts[i][0]
        text = raw_text.strip()
        text_lower = text.lower()

        # Skip blank lines
        if not text:
            i += 1
            continue

        # Skip boilerplate and noise lines
        if text_lower.startswith(SKIP_PREFIXES):
            i += 1
            continue
        if _is_entity_header(text):
            i += 1
            continue
        # Handle signer role prefix + entity name on the same line
        # e.g., "PURCHASER:\tTHH HOLDING, LLC" or "INVESTOR:  SOME FUND, LP"
        if _SIGNER_ROLE_PREFIX_RE.match(text):
            remainder = _strip_signer_role_prefix(text.replace("\t", " "))
            remainder = remainder.replace("_", "").strip()
            if remainder and len(remainder) > 2:
                cleaned = _clean_entity_name(remainder)
                if cleaned:
                    if st.signers:
                        st.flush(results)
                        st.reset_for_new_entity()
                    st.entity_name = cleaned
            i += 1
            continue

        # Skip boundary lines that may appear at the start of a block
        if _BOUNDARY_RE.match(text) or text_lower.startswith(_PREFIX_BOUNDARIES):
            i += 1
            continue

        # Skip document title lines (e.g. "ACTION BY WRITTEN CONSENT OF STOCKHOLDERS")
        if re.match(r'(?i)^(ACTION\s+BY\s+WRITTEN\s+CONSENT|CONSENT\s+OF\s+STOCKHOLDERS?|OF\s+\w)', text):
            i += 1
            continue

        # Skip signature placeholder lines ("Signature: ____")
        if _SIGNATURE_LINE_RE.match(text):
            i += 1
            continue

        if _looks_like_noise_line(text):
            i += 1
            continue
        if text.startswith("(") and (st.entity_name or st.signers):
            i += 1
            continue

        # --- Date line: entity name is after the tabs ---
        if text_lower.startswith("date:"):
            parts = raw_text.split("\t")
            for part in reversed(parts):
                cleaned = _clean_entity_name(re.sub(r'(?i)date\s*:', '', part).replace("_", ""))
                if cleaned and not cleaned.lower().startswith("by:"):
                    if _looks_like_entity_name(cleaned):
                        st.entity_name = cleaned
                    elif not _looks_like_person_name(cleaned) and not re.match(r'^[A-Z][a-z]+ \d', cleaned):
                        st.entity_name = cleaned
                    break
            i += 1
            continue

        # --- By: line ---
        if text_lower.startswith("by:"):
            remainder = re.sub(r'(?i)^by\s*:\s*', '', text)
            clean_remainder = remainder.replace("\t", "").replace("_", "").replace(" ", "").replace("\xa0", "")
            if len(clean_remainder) < 3:
                i += 1
                continue

            ent_parts = [remainder]
            role = ""
            j = i + 1

            while j < len(texts):
                next_text = texts[j][0].strip()
                next_lower = next_text.lower()
                if not next_text or _has_field_prefix(next_lower):
                    break
                if _is_entity_header(next_text):
                    break
                its_match = re.search(r',\s*its\s*:?\s*(.*)$', next_text, re.IGNORECASE)
                if its_match:
                    before = next_text[:its_match.start()].strip()
                    if before:
                        ent_parts.append(before)
                    role = its_match.group(1).strip().rstrip(",")
                    j += 1
                    break
                matched, role_text = _match_its_prefix(next_text)
                if matched:
                    role = role_text
                    j += 1
                    break
                ent_parts.append(next_text)
                j += 1

            if not role and j < len(texts):
                peek = texts[j][0].strip()
                matched, role_text = _match_its_prefix(peek)
                if matched:
                    role = role_text
                    j += 1

            while j < len(texts) and texts[j][0].strip().lower() in ("its", "its,", "its:"):
                j += 1

            ent_name = _clean_entity_name(" ".join(p.strip().rstrip(",") for p in ent_parts))

            if not role:
                its_inline = re.search(r'\bits\s*:?\s+', ent_name, re.IGNORECASE)
                if its_inline:
                    role = ent_name[its_inline.end():].strip().rstrip(",")
                    ent_name = _clean_entity_name(ent_name[:its_inline.start()].strip())

            if role.lower().endswith(" its"):
                role = role[:-4].strip()
            role = role.rstrip(",")
            ent_name = _clean_entity_name(ent_name)

            if ent_name and len(st.additional_entities) < 3:
                st.additional_entities.append((ent_name, role))

            i = j
            continue

        # --- Name line (Name:, Print Name:, Printed Name:, Signatory Name:) ---
        if _NAME_LABEL_RE.match(text):
            name = ""
            title = ""

            # The paragraph may contain embedded newlines with Its:/Title: on next line
            # e.g. "Name: Tom H Hanks\nIts:   President"
            para_lines = raw_text.split('\n')

            if '\t' in para_lines[0]:
                # Tab-separated: "Name: John\tTitle: VP"
                # Also handles "Name:\tJohn\tTitle:\tVP" where label and
                # value are in separate tab-parts.
                parts = [p.strip() for p in re.split(r'\t+', para_lines[0])]
                pending_name_label = False
                pending_title_label = False
                for part in parts:
                    if not part:
                        continue
                    if _NAME_LABEL_RE.match(part):
                        val = _strip_name_label(part)
                        if val:
                            name = val
                            pending_name_label = False
                        else:
                            # Label with no value — next part is the value
                            pending_name_label = True
                    elif _TITLE_LABEL_RE.match(part):
                        val = _strip_title_label(part)
                        if val:
                            title = val
                            pending_title_label = False
                        else:
                            pending_title_label = True
                    elif pending_name_label:
                        name = part
                        pending_name_label = False
                    elif pending_title_label:
                        title = part
                        pending_title_label = False
            else:
                name = _strip_name_label(para_lines[0].strip())

            # Check for comma-separated title within name: "Jet Li,  Title: Director"
            if name:
                name, comma_title = _split_name_title(name)
                if comma_title and not title:
                    title = comma_title

            # Check remaining lines in same paragraph for Its:/Title:/Capacity:
            for line in para_lines[1:]:
                line = line.strip()
                if _TITLE_LABEL_RE.match(line) and not title:
                    title = _strip_title_label(line)

            # If no title yet, check next paragraph
            if not title and i + 1 < len(texts):
                next_text = texts[i + 1][0].strip()
                if _TITLE_LABEL_RE.match(next_text):
                    title = _strip_title_label(next_text)
                    i += 1

            # Skip underscore-only or blank names
            if name and name.replace("_", "").replace(" ", "").replace("\xa0", ""):
                st.signers.append({
                    "name": name,
                    "title": title,
                    "is_entity": bool(st.entity_name),
                    "entity_name": st.entity_name,
                    "additional_entities": list(st.additional_entities),
                })
            i += 1
            continue

        # --- Title/Capacity/Its: line (standalone, updates last signer) ---
        if _TITLE_LABEL_RE.match(text) and st.signers:
            title = _strip_title_label(text)
            st.signers[-1]["title"] = title
            i += 1
            continue

        # --- Email line ---
        if re.match(r'(?i)e-?mail\b', text):
            st.email = re.sub(r'(?i)e-?mail\s*(?:\([^)]*\))?\s*:\s*', '', text).strip().replace("\xa0", " ").strip()
            i += 1
            continue

        # --- Address line (Address: or Notice Address:) ---
        if _ADDRESS_LABEL_RE.match(text):
            addr_val = _clean_text(_ADDRESS_LABEL_RE.sub('', text))
            lines, next_idx = _collect_continuation_lines(texts, i)
            address_parts = ([addr_val] if addr_val else []) + lines
            address_value, city_value = _split_address_lines(address_parts)
            if address_value:
                st.address = address_value
            if city_value:
                st.city_state_zip = city_value
            i = next_idx
            continue

        # --- Phone/Tel/Telephone line ---
        if _PHONE_LABEL_RE.match(text):
            st.phone = _PHONE_LABEL_RE.sub('', text).strip().replace("\xa0", " ").strip()
            i += 1
            continue

        # --- Inline signer lines ("Name, individually" or "Name, as role of Entity") ---
        inline_signer = _parse_inline_signer_line(text, st.additional_entities)
        if inline_signer:
            st.signers.append(inline_signer)
            i += 1
            continue

        # --- Bare address lines (no "Address:" prefix) ---
        # After signers are captured, unlabeled lines that look like street
        # addresses or city/state/zip should be captured as contact info.
        if (st.signers and not st.address
                and not _has_field_prefix(text_lower)
                and 1 < len(text) < 100
                and (_BARE_ADDRESS_RE.search(text) or text_lower.startswith("c/o "))):
            lines, next_idx = _collect_continuation_lines(texts, i)
            address_parts = [_clean_text(text)] + lines
            address_value, city_value = _split_address_lines(address_parts)
            if address_value:
                st.address = address_value
            if city_value and not st.city_state_zip:
                st.city_state_zip = city_value
            i = next_idx
            continue

        if (st.signers and not st.city_state_zip and st.address
                and not _has_field_prefix(text_lower)
                and 1 < len(text) < 80
                and _CITY_STATE_ZIP_RE.search(text)):
            st.city_state_zip = text.replace("\xa0", " ").strip()
            i += 1
            continue

        # --- Standalone names/entities (no prefix labels) ---
        if (not _has_field_prefix(text_lower)
                and 1 < len(text) < 200):

            cleaned = _clean_entity_name(text.replace("\t", " "))
            if cleaned:
                if st.signers and st.entity_name and cleaned.lower() == st.entity_name.lower():
                    i += 1
                    continue
                if _looks_like_entity_name(cleaned):
                    if st.signers:
                        st.flush(results)
                        st.reset_for_new_entity()
                    st.entity_name = cleaned
                else:
                    if not st.signers and _looks_like_person_name(cleaned):
                        next_title = ""
                        if i + 1 < len(texts):
                            nt = texts[i + 1][0].strip()
                            if _TITLE_LABEL_RE.match(nt):
                                next_title = _strip_title_label(nt)
                        st.signers.append({
                            "name": cleaned,
                            "title": next_title,
                            "is_entity": bool(st.entity_name),
                            "entity_name": st.entity_name,
                            "additional_entities": list(st.additional_entities),
                        })
                        if next_title:
                            i += 1

        i += 1

    st.flush(results)

    return results
