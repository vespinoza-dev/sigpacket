# Bulk Signature Extractor — Feature Specification

## Overview

The Bulk Signature Extractor allows a user to upload a single `.docx` file containing multiple signature pages/blocks and have all signatories automatically extracted and added to the signer list.

---

## User Flow

1. User clicks the **"Bulk Extract"** button in the UI.
2. A file picker opens — user selects a `.docx` file (e.g., a full signature packet or executed agreement).
3. The file is uploaded to `POST /bulk-extract`.
4. The backend:
   - Splits the document into individual signature blocks using boundary phrases (e.g., "SIGNATURE PAGE", "ACKNOWLEDGED AND AGREED", "IN WITNESS WHEREOF").
   - For each block, attempts **AI extraction first** (Azure OpenAI).
   - Falls back to the **heuristic parser** only if the AI call fails or returns empty.
5. Each extracted signer is added to the signature log (Excel sheet).
6. The UI reloads the signer list and shows a summary: `"X signatories extracted and added."`

---

## Extraction Priority

| Priority | Method | Trigger |
|----------|--------|---------|
| 1 (preferred) | Azure OpenAI (`extract_fields`) | Always attempted first |
| 2 (fallback) | Heuristic regex parser (`parse_signature_block`) | Only if AI fails or returns empty |

The AI extraction uses the same `EXTRACT_PROMPT` as single-image extraction — it classifies signer type (1–5) and extracts all structured fields.

---

## Signer Types Extracted

| Type | Description |
|------|-------------|
| 1 | Individual — natural person, no company |
| 2 | Entity, direct signer — company + person |
| 3 | Entity → 1 intermediary → signer |
| 4 | Entity → 2 intermediaries → signer |
| 5 | Entity → 3 intermediaries → signer |

---

## Fields Extracted Per Signer

| Field | Description |
|-------|-------------|
| `signer_name` | Full name of the signing individual |
| `signing_entity` | Primary entity name (if applicable) |
| `title` | Signer's title/role (e.g., "CEO", "Managing Partner") |
| `additional_signing_entity` | First intermediary entity |
| `additional_signing_entity_title` | First intermediary's role (e.g., "General Partner") |
| `additional_signing_entity_2` | Second intermediary entity |
| `additional_signing_entity_title_2` | Second intermediary's role |
| `additional_signing_entity_3` | Third intermediary entity |
| `additional_signing_entity_title_3` | Third intermediary's role |
| `email` | Email address |
| `cc_email` | CC/secondary email |
| `phone` | Phone number |
| `address` | Street address |
| `city_state_zip` | City, state, and ZIP |

---

## Document Splitting Logic

The document is split into blocks at these boundary phrases (case-insensitive):

- `SIGNATURE PAGE`
- `ACKNOWLEDGED AND AGREED`
- `AGREED AND ACCEPTED`
- `EXECUTED as of`
- `IN WITNESS WHEREOF`
- `BY EXECUTING THIS ACTION BY WRITTEN CONSENT`
- `THE UNDERSIGNED HAS EXECUTED`
- `VERY TRULY YOURS`
- `STOCKHOLDERS:`

If a block contains 2+ signers (detected by multiple `Name:` labels), it is further split at gaps of 2+ blank lines.

---

## API Endpoint

```
POST /bulk-extract
Content-Type: multipart/form-data

file: <.docx file>
```

**Response:**
```json
{
  "ok": true,
  "total_found": 12,
  "added": 12,
  "signatories": [...]
}
```

**Errors:**
- `400` — No file provided or file is not `.docx`
- `500` — Parsing or internal error

---

## Environment Variables Required

| Variable | Purpose |
|----------|---------|
| `AZURE_OPENAI_API_KEY` | Required for AI extraction |
| `AZURE_OPENAI_BASE_URL` | Azure OpenAI endpoint URL |

If `AZURE_OPENAI_API_KEY` is not set, extraction automatically falls back to the heuristic parser for all blocks.

---

## Error Handling

- If AI extraction fails for a specific block (network error, timeout, bad JSON), the heuristic parser is used for that block only.
- If a block yields no signer (no `signer_name` or `signing_entity`), it is silently skipped.
- File is deleted from the server after processing (temp file cleanup).
