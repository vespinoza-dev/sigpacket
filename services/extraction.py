"""
OCR / AI extraction module for Signature Packet Generator.

Extracts structured fields from signature block screenshots using
the Azure AI Foundry API (OpenAI v1 compatible) or the Claude Code CLI.
"""

import json
import logging
import os
import re
from openai import OpenAI

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Extraction prompt
# ---------------------------------------------------------------------------

EXTRACT_PROMPT = """You are extracting structured fields from a signature block screenshot.
The OCR text from the image is below. First classify the signer type, then extract fields.

Step 1: Classify signer type (there are 5 types)

Type 1 — Individual (natural person signing in their own capacity, no company)
Type 2 — Entity, direct signer (company + person signing directly for it)
Type 3 — Entity → one intermediary → signer (company acts through a sub-entity)
Type 4 — Entity → two intermediaries → signer (chain of two sub-entities)
Type 5 — Entity → three intermediaries → signer (chain of three sub-entities)

Step 2: Extract fields based on type

Type 1 (Individual):
- signer_name: The person's full name
- title: Their title/role if present
- Do NOT include signing_entity or any additional entity fields

Type 2 (Entity, direct):
- signing_entity: The company/organization name
- signer_name: The person signing
- title: The person's title (e.g., "CEO", "President")

Type 3 (Entity + 1 intermediary):
- signing_entity: The main entity (e.g., "Blockchain Capital V, LP")
- additional_signing_entity: The intermediary entity (e.g., "Blockchain Capital V GP, LLC")
- additional_signing_entity_title: The intermediary's role (e.g., "General Partner")
- signer_name: The individual person signing
- title: The person's title (e.g., "Managing Partner")

Type 4 (Entity + 2 intermediaries):
- signing_entity: The main entity
- additional_signing_entity: First intermediary
- additional_signing_entity_title: First intermediary's role
- additional_signing_entity_2: Second intermediary
- additional_signing_entity_title_2: Second intermediary's role
- signer_name: The individual person signing
- title: The person's title

Type 5 (Entity + 3 intermediaries):
- All of Type 4, plus:
- additional_signing_entity_3: Third intermediary
- additional_signing_entity_title_3: Third intermediary's role

Contact fields (available for any type, extract when present):
- email: Email address (look for "Email:" label or @-containing text)
- phone: Phone number (look for "Phone:" or "Tel:" label)
- cc_email: CC or secondary email address
- address: Street address (look for "Address:" label, street numbers, Suite/Floor)
- city_state_zip: City, state and ZIP code (e.g., "San Francisco, CA 94105")

How to identify intermediaries: Look for patterns like "By: [Entity Name], its [Role]" or "By: [Entity Name]" followed by "its [Role]" on the next line. Each "By:" before the signature line represents an intermediary in the chain.

Rules:
- Only include fields you are confident about. Omit any field you cannot determine.
- If text has explicit labels like "Name:", "Title:", use those directly.
- Return ONLY valid JSON with no markdown, no explanation, no extra text.

OCR text:
---
{ocr_text}
---

Examples:
Type 1: {{"signer_name": "John Doe"}}
Type 2: {{"signing_entity": "Acme Corp", "signer_name": "Jane Smith", "title": "CEO"}}
Type 3: {{"signing_entity": "Fund LP", "additional_signing_entity": "Fund GP LLC", "additional_signing_entity_title": "General Partner", "signer_name": "Jane Smith", "title": "Managing Partner"}}
Type 4: {{"signing_entity": "Fund LP", "additional_signing_entity": "Fund GP LP", "additional_signing_entity_title": "General Partner", "additional_signing_entity_2": "Fund GP LLC", "additional_signing_entity_title_2": "General Partner", "signer_name": "Jane Smith", "title": "Partner"}}"""


# ---------------------------------------------------------------------------
# Bulk extraction prompt (returns an array of signers)
# ---------------------------------------------------------------------------

BULK_EXTRACT_PROMPT = """You are extracting ALL signature blocks from a section of a legal document.
The text may contain one or more signatories. Extract every signer you find.

For each signer, classify the type and extract fields:

Signer Types:
Type 1 — Individual (natural person, no company)
Type 2 — Entity, direct signer (company + person)
Type 3 — Entity → one intermediary → signer
Type 4 — Entity → two intermediaries → signer
Type 5 — Entity → three intermediaries → signer

Fields per signer (only include fields you are confident about):
- signing_entity: Primary company/organization name
- additional_signing_entity: First intermediary entity name
- additional_signing_entity_title: First intermediary's role (e.g. "General Partner")
- additional_signing_entity_2: Second intermediary entity name
- additional_signing_entity_title_2: Second intermediary's role
- additional_signing_entity_3: Third intermediary entity name
- additional_signing_entity_title_3: Third intermediary's role
- signer_name: Full name of the individual signing
- title: The individual's title/role (e.g. "CEO", "Managing Partner")
- email: Email address
- cc_email: CC or secondary email
- phone: Phone number
- address: Street address
- city_state_zip: City, state, and ZIP (e.g. "San Francisco, CA 94105")

How to identify intermediaries: "By: [Entity], its [Role]" patterns. Each "By:" before
the signature line is an intermediary. The last person listed under Name: is the signer.

Return a JSON array of signer objects. If no signers found, return [].
Return ONLY valid JSON — no markdown, no explanation.

Document text:
---
{block_text}
---

Examples:
[
  {{"signing_entity": "Fund LP", "additional_signing_entity": "Fund GP LLC", "additional_signing_entity_title": "General Partner", "signer_name": "Jane Smith", "title": "Managing Partner"}},
  {{"signer_name": "John Doe"}}
]"""


def extract_multiple_fields(block_text):
    """Extract all signers from a block of text using AI.

    Returns a list of dicts (one per signer). Falls back to [] on failure.
    """
    key = os.environ.get("AZURE_OPENAI_API_KEY")
    if not key:
        return []

    try:
        endpoint = os.environ.get("AZURE_OPENAI_BASE_URL")
        client = OpenAI(base_url=endpoint, api_key=key)
        completion = client.chat.completions.create(
            model="gpt-5.4",
            messages=[{
                "role": "user",
                "content": BULK_EXTRACT_PROMPT.format(block_text=block_text)
            }],
        )
        raw = completion.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = re.sub(r'^```(?:json)?\s*', '', raw)
            raw = re.sub(r'\s*```$', '', raw)
        result = json.loads(raw)
        if isinstance(result, list):
            return result
        if isinstance(result, dict):
            return [result]
        return []
    except Exception as e:
        logger.error(f"AI bulk extraction error: {e}")
        return []


# # ---------------------------------------------------------------------------
# # Claude CLI discovery (fallback)
# # ---------------------------------------------------------------------------

# def find_claude_cli():
#     """Locate the claude CLI binary."""
#     for path in [
#         os.path.expanduser("~/.local/bin/claude"),
#         "/usr/local/bin/claude",
#         "/opt/homebrew/bin/claude",
#     ]:
#         if os.path.isfile(path):
#             return path
#     result = subprocess.run(["which", "claude"], capture_output=True, text=True)
#     if result.returncode == 0:
#         return result.stdout.strip()
#     return None


# CLAUDE_CLI = find_claude_cli()


# ---------------------------------------------------------------------------
# Extraction backends
# ---------------------------------------------------------------------------

# def extract_with_claude_code(ocr_text):
#     """Use the claude CLI (Claude Code) to extract fields. No API key needed."""
#     if not CLAUDE_CLI:
#         logger.warning("Claude CLI not found")
#         return None
#     prompt = EXTRACT_PROMPT.format(ocr_text=ocr_text)
#     try:
#         env = os.environ.copy()
#         env["PATH"] = os.path.expanduser("~/.local/bin") + ":" + env.get("PATH", "")
#         result = subprocess.run(
#             [CLAUDE_CLI, "-p", "--max-turns", "1", prompt],
#             capture_output=True, text=True, timeout=60,
#             env=env, stdin=subprocess.DEVNULL
#         )
#         logger.info(f"Claude CLI rc={result.returncode} stdout={result.stdout[:300]}")
#         if result.returncode != 0:
#             logger.error(f"Claude CLI stderr: {result.stderr[:500]}")
#             return None
#         raw = result.stdout.strip()
#         if raw.startswith("```"):
#             raw = re.sub(r'^```(?:json)?\s*', '', raw)
#             raw = re.sub(r'\s*```$', '', raw)
#         return json.loads(raw)
#     except subprocess.TimeoutExpired:
#         logger.error("Claude CLI timed out")
#         return None
#     except json.JSONDecodeError:
#         logger.error(f"JSON parse error, raw: {result.stdout[:500]}")
#         return None
#     except Exception as e:
#         logger.error(f"Claude CLI error: {e}")
#         return None


def extract_with_api(ocr_text, api_key, base_url=None, model=None):
    """Use the Azure AI Foundry API (OpenAI v1 compatible) to extract fields.

    Requires:
      - api_key: Azure OpenAI API key
      - base_url: e.g. "https://YOUR-RESOURCE.openai.azure.com/openai/v1/"
      - model: deployment name (e.g. "gpt-4.1-nano", "gpt-4o")
    """
    try:
        from openai import OpenAI
        endpoint = os.environ.get("AZURE_OPENAI_BASE_URL") or base_url
        model_name = "gpt-5.4"
        deployment_name = "gpt-5.4"

        api_key = os.environ.get("AZURE_OPENAI_API_KEY") or api_key

        client = OpenAI(
            base_url=f"{endpoint}",
            api_key=api_key
        )

        completion = client.chat.completions.create(
            model=deployment_name,
            messages=[
                {
                    "role": "user",
                    "content": EXTRACT_PROMPT.format(ocr_text=ocr_text)
                }
            ],
        )
        raw = completion.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = re.sub(r'^```(?:json)?\s*', '', raw)
            raw = re.sub(r'\s*```$', '', raw)
        return json.loads(raw)
    except Exception as e:
        logger.error(f"Azure OpenAI API error: {e}")
        return None


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def extract_fields(ocr_text, ):
    """Extract signature block fields using AI.

    Priority: 1) Azure AI Foundry API (if key provided), 2) Claude Code CLI.
    """
    key = os.environ.get("AZURE_OPENAI_API_KEY")
    if key:
        result = extract_with_api(ocr_text, key)
        if result:
            return result

    # # Fallback: Claude Code CLI
    # result = extract_with_claude_code(ocr_text)
    # if result:
    #     return result

    return {}
