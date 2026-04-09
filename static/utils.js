/**
 * Utility functions, shared helpers, and constants
 */

// ---------------------------------------------------------------------------
// Escape / sanitize
// ---------------------------------------------------------------------------

function escapeHtml(str) {
    if (!str) return "";
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
}

function escapeAttr(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Allow only <b>, <strong>, <i>, <em> tags; strip everything else
function sanitizeRichText(str) {
    if (!str) return '';
    let safe = escapeHtml(str);
    safe = safe.replace(/&lt;(\/?(b|strong|i|em))&gt;/gi, '<$1>');
    return safe;
}

// Extract text with <b> and <i> tags from a contenteditable element
function richTextToTagged(el) {
    let html = el.innerHTML;
    html = html.replace(/<strong[^>]*>/gi, '<b>').replace(/<\/strong>/gi, '</b>');
    html = html.replace(/<em[^>]*>/gi, '<i>').replace(/<\/em>/gi, '</i>');
    html = html.replace(/<span[^>]*font-weight\s*:\s*(bold|[7-9]00)[^>]*>([\s\S]*?)<\/span>/gi, '<b>$2</b>');
    html = html.replace(/<span[^>]*font-style\s*:\s*italic[^>]*>([\s\S]*?)<\/span>/gi, '<i>$1</i>');
    html = html.replace(/<b>/gi, '\u2060BOPEN\u2060');
    html = html.replace(/<\/b>/gi, '\u2060BCLOSE\u2060');
    html = html.replace(/<i>/gi, '\u2060IOPEN\u2060');
    html = html.replace(/<\/i>/gi, '\u2060ICLOSE\u2060');
    html = html.replace(/<[^>]+>/g, '');
    const tmp = document.createElement('textarea');
    tmp.innerHTML = html;
    html = tmp.value;
    html = html.replace(/\u2060BOPEN\u2060/g, '<b>');
    html = html.replace(/\u2060BCLOSE\u2060/g, '</b>');
    html = html.replace(/\u2060IOPEN\u2060/g, '<i>');
    html = html.replace(/\u2060ICLOSE\u2060/g, '</i>');
    html = html.replace(/\u00a0/g, ' ');
    return html.trim();
}

// ---------------------------------------------------------------------------
// Download helper
// ---------------------------------------------------------------------------

function downloadBlobAsFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Matrix selection helper
// ---------------------------------------------------------------------------

// Returns [{ sigIndex, sig, checkedTypes: [pageType, ...] }, ...] for rows with checks
function getMatrixSelections() {
    const selections = [];
    document.querySelectorAll("#matrix-tbody tr[data-sig-index]").forEach(row => {
        const idx = parseInt(row.dataset.sigIndex, 10);
        const sig = savedSignatures[idx];
        if (!sig) return;
        const checkedTypes = [];
        row.querySelectorAll("input.matrix-cb:checked").forEach(cb => {
            checkedTypes.push(cb.dataset.type);
        });
        if (checkedTypes.length > 0) {
            selections.push({ sigIndex: idx, sig, checkedTypes });
        }
    });
    return selections;
}

// ---------------------------------------------------------------------------
// Signer form field helpers
// ---------------------------------------------------------------------------

// Maps data field keys to their HTML form element IDs
const SIGNER_FIELD_MAP = {
    signing_entity: "signing-entity",
    additional_signing_entity: "additional-signing-entity",
    additional_signing_entity_title: "additional-signing-entity-title",
    additional_signing_entity_2: "additional-signing-entity-2",
    additional_signing_entity_title_2: "additional-signing-entity-title-2",
    additional_signing_entity_3: "additional-signing-entity-3",
    additional_signing_entity_title_3: "additional-signing-entity-title-3",
    signer_name: "signer-name",
    title: "signer-title",
    email: "signer-email",
    phone: "signer-phone",
    cc_email: "cc-email",
    address: "signer-address",
    city_state_zip: "signer-city-state",
};

function collectSignerFormFields() {
    const fields = { signer_type: document.getElementById("signer-type").value || "entity" };
    for (const [key, elId] of Object.entries(SIGNER_FIELD_MAP)) {
        const el = document.getElementById(elId);
        fields[key] = el ? el.value.trim() : "";
    }
    return fields;
}

function clearSignerFormFields() {
    for (const elId of Object.values(SIGNER_FIELD_MAP)) {
        const el = document.getElementById(elId);
        if (el) el.value = "";
    }
}

function populateSignerFormFields(fields) {
    for (const [key, elId] of Object.entries(SIGNER_FIELD_MAP)) {
        if (fields[key]) {
            const el = document.getElementById(elId);
            if (el) el.value = fields[key];
        }
    }
}

// ---------------------------------------------------------------------------
// Page type helpers
// ---------------------------------------------------------------------------

function getPageAbbrev(pageType) {
    if (PAGE_TYPE_ABBREVS[pageType]) return PAGE_TYPE_ABBREVS[pageType];
    const label = getPageLabel(pageType);
    if (label.length <= 10) return label;
    return label.split(/\s+/).map(w => w[0].toUpperCase()).join('');
}

function getVisiblePageTypes() {
    return PAGE_TYPES.filter(pt => !hiddenPageTypes.has(pt));
}

function saveHiddenPageTypes() {
    localStorage.setItem('sig_hidden_page_types', JSON.stringify([...hiddenPageTypes]));
}

function togglePageTypeVisibility(pageType) {
    if (hiddenPageTypes.has(pageType)) {
        hiddenPageTypes.delete(pageType);
        saveHiddenPageTypes();
        renderMatrixHeader();
        fetchSignatureLog();
        renderDocManagerList();
        return;
    }
    const checkedCbs = document.querySelectorAll(`input.matrix-cb[data-type="${pageType}"]:checked`);
    if (checkedCbs.length > 0) {
        const label = getPageLabel(pageType);
        if (!confirm(`"${label}" is checked for ${checkedCbs.length} signator${checkedCbs.length === 1 ? 'y' : 'ies'}. Hide this column? (The template is not deleted — you can re-enable it anytime.)`)) {
            return;
        }
    }
    hiddenPageTypes.add(pageType);
    saveHiddenPageTypes();
    renderMatrixHeader();
    fetchSignatureLog();
    renderDocManagerList();
}

function renderDocManagerList() {
    const list = document.getElementById('doc-manager-list');
    if (!list) return;
    list.innerHTML = PAGE_TYPES.map(pt => {
        const label = getPageLabel(pt);
        const checked = !hiddenPageTypes.has(pt);
        return `<label class="doc-manager-item${checked ? '' : ' doc-hidden'}">
            <input type="checkbox" ${checked ? 'checked' : ''} onchange="togglePageTypeVisibility('${pt}')">
            <span>${escapeHtml(label)}</span>
        </label>`;
    }).join('');
}

function toggleDocManager() {
    const panel = document.getElementById('doc-manager-panel');
    if (!panel) return;
    const isOpen = panel.classList.toggle('show');
    if (isOpen) renderDocManagerList();
}

// Page labels read from JSON configs (display_name field)
function getPageLabel(pageType) {
    const cfg = templateConfigs[pageType];
    return (cfg && cfg.display_name) || pageType;
}

function getCompanyName() {
    const el = document.getElementById("company-name");
    return el ? el.value.trim() || "[Company]" : "[Company]";
}

// Override helpers

function _collectRelatedDocs() {
    const related = [];
    document.querySelectorAll('.template-related-docs input[data-related-type]').forEach(cb => {
        if (cb.checked) related.push(cb.dataset.relatedType);
    });
    return related;
}

function _ensureOverrides(sig, pageType, fieldId) {
    if (!sig.field_overrides) sig.field_overrides = {};
    if (!sig.field_overrides[pageType]) sig.field_overrides[pageType] = { fields: {} };
    if (!sig.field_overrides[pageType].fields) sig.field_overrides[pageType].fields = {};
    if (!sig.field_overrides[pageType].fields[fieldId]) sig.field_overrides[pageType].fields[fieldId] = {};
    return sig.field_overrides[pageType].fields[fieldId];
}

function _ensureConfigOverride(sig, pageType) {
    if (!sig.field_overrides) sig.field_overrides = {};
    if (!sig.field_overrides[pageType]) sig.field_overrides[pageType] = { fields: {} };
    if (!sig.field_overrides[pageType].config) sig.field_overrides[pageType].config = {};
    return sig.field_overrides[pageType].config;
}

function _saveFieldOverrides(sigIndex, pageType) {
    const sig = savedSignatures[sigIndex];
    if (!sig) return;
    fetch(`/signatures/${sigIndex}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { field_overrides: sig.field_overrides } }),
    });
}

function _hasCustomOverrides(sig, pageType) {
    if (!sig || !sig.field_overrides || !sig.field_overrides[pageType]) return false;
    const ov = sig.field_overrides[pageType];
    const hasFields = ov.fields && Object.keys(ov.fields).length > 0;
    const hasConfig = ov.config && Object.keys(ov.config).length > 0;
    return hasFields || hasConfig;
}

// Map signatory info field names to their corresponding template field IDs
function _fieldIdForInfoField(fieldName) {
    const map = {
        signer_name: 'signer_name',
        signing_entity: 'entity_name',
        title: 'title',
        email: 'email',
        cc_email: 'cc_email',
        address: 'address',
        city_state_zip: 'city_state_zip',
        phone: 'phone',
    };
    return map[fieldName] || null;
}
