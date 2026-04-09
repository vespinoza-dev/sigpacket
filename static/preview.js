/**
 * Live Preview — rendering, field rendering, dynamic preview, drag-to-reorder
 * Undo/redo, template config loading
 */

// ---------------------------------------------------------------------------
// Undo / Redo for field override operations
// ---------------------------------------------------------------------------

function _snapshotOverrides(sigIndex, pageType) {
    const sig = savedSignatures[sigIndex];
    if (!sig) return null;
    const ov = sig.field_overrides && sig.field_overrides[pageType];
    return { sigIndex, pageType, overrides: JSON.parse(JSON.stringify(ov || {})) };
}

function pushUndo(sigIndex, pageType) {
    const snap = _snapshotOverrides(sigIndex, pageType);
    if (!snap) return;
    undoStack.push(snap);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0; // clear redo on new action
}

function undoFieldChange() {
    if (undoStack.length === 0) return;
    const snap = undoStack.pop();
    // Save current state to redo before restoring
    const current = _snapshotOverrides(snap.sigIndex, snap.pageType);
    if (current) redoStack.push(current);
    _restoreOverrides(snap);
}

function redoFieldChange() {
    if (redoStack.length === 0) return;
    const snap = redoStack.pop();
    // Save current state to undo before restoring
    const current = _snapshotOverrides(snap.sigIndex, snap.pageType);
    if (current) undoStack.push(current);
    _restoreOverrides(snap);
}

function _restoreOverrides(snap) {
    const sig = savedSignatures[snap.sigIndex];
    if (!sig) return;
    if (!sig.field_overrides) sig.field_overrides = {};
    if (Object.keys(snap.overrides).length === 0) {
        delete sig.field_overrides[snap.pageType];
    } else {
        sig.field_overrides[snap.pageType] = snap.overrides;
    }
    _saveFieldOverrides(snap.sigIndex, snap.pageType);
    debouncePreview();
}

async function loadTemplateConfigs() {
    try {
        const resp = await fetch("/api/templates");
        const configs = await resp.json();
        templateConfigs = {};
        PAGE_TYPES = [];
        configs.forEach(c => {
            templateConfigs[c.page_type] = c;
            PAGE_TYPES.push(c.page_type);
        });
        rebuildPreviewRenderers();
    } catch (e) {
        // Editor not set up yet or configs don't exist — use defaults
    }
}

// ---------------------------------------------------------------------------
// Dynamic Preview Renderer — driven by JSON template configs
// ---------------------------------------------------------------------------

// All page-type-specific text (witness clause, entity header labels, consent text)
// is now read from the JSON configs at templateConfigs[pageType].
// Helper: get the agreement title from config (formal name for legal text)
function getAgreementTitle(pageType) {
    const cfg = templateConfigs[pageType];
    if (!cfg) return 'Agreement';
    return cfg.agreement_title || cfg.display_name || 'Agreement';
}
// Helper: get the financing round from the UI input
function getFinancingRound() {
    const el = document.getElementById('financing-round');
    return (el && el.value.trim()) || '[___]';
}
// Helper to get text from config with {{agreement_name}} and {{financing_round}} replaced.
// When sigIndex is provided, per-signatory config overrides are checked first.
function getWitnessText(pageType, sigIndex) {
    const text = sigIndex != null
        ? getEffectiveConfig(pageType, sigIndex, 'witness_clause_text')
        : (templateConfigs[pageType] || {}).witness_clause_text;
    if (!text) return '';
    return text
        .replace(/\{\{agreement_name\}\}/g, getAgreementTitle(pageType))
        .replace(/\{\{financing_round\}\}/g, getFinancingRound());
}
function getEntityHeaderLabel(pageType, sigIndex) {
    if (sigIndex != null) return getEffectiveConfig(pageType, sigIndex, 'entity_header_label') || '';
    const cfg = templateConfigs[pageType];
    return (cfg && cfg.entity_header_label) || '';
}
function getSectionHeaderLabel(pageType, sigIndex) {
    if (sigIndex != null) return getEffectiveConfig(pageType, sigIndex, 'section_header_label') || '';
    const cfg = templateConfigs[pageType];
    return (cfg && cfg.section_header_label) || '';
}
function getConsentText(pageType, sigIndex) {
    const text = sigIndex != null
        ? getEffectiveConfig(pageType, sigIndex, 'consent_text')
        : (templateConfigs[pageType] || {}).consent_text;
    return text || '';
}

// Standard default field order (fallback when no config exists)
const STANDARD_SIG_FIELDS = ['section_header','date_line','entity_name','additional_signing_entity','additional_signing_entity_2','additional_signing_entity_3','by_line','signer_name','title'];

const DEFAULT_FIELD_ORDER = {
    // Main Documents
    stock_purchase_agreement: ['witness_clause', ...STANDARD_SIG_FIELDS, 'address','city_state_zip','email','cc_email','phone'],
    certificate_of_incorporation: ['witness_clause', ...STANDARD_SIG_FIELDS],
    investors_rights_agreement: ['witness_clause', ...STANDARD_SIG_FIELDS],
    voting_agreement: ['witness_clause', ...STANDARD_SIG_FIELDS],
    rofr_cosale: ['witness_clause', ...STANDARD_SIG_FIELDS],
    // Ancillary Documents
    board_consent: ['witness_clause', ...STANDARD_SIG_FIELDS],
    stockholder_consent: ['consent_text', ...STANDARD_SIG_FIELDS],
    compliance_certificate: ['witness_clause', ...STANDARD_SIG_FIELDS],
    secretary_certificate: ['witness_clause', ...STANDARD_SIG_FIELDS],
    indemnification_agreement: ['witness_clause', ...STANDARD_SIG_FIELDS, 'accepted_and_agreed'],
};

function getEffectiveConfig(pageType, sigIndex, key) {
    const sig = savedSignatures[sigIndex];
    const ov = sig && sig.field_overrides && sig.field_overrides[pageType] && sig.field_overrides[pageType].config;
    if (ov && key in ov) return ov[key];
    const cfg = templateConfigs[pageType];
    return cfg ? cfg[key] : undefined;
}

function fieldStyle(field) {
    const parts = [];
    if (field.bold) parts.push("font-weight:bold");
    if (field.italic) parts.push("font-style:italic");
    return parts.length ? ` style="${parts.join(";")}"` : "";
}

function renderField(field, sig, pageType, fields, isEditing, sigIndex) {
    if (!field.enabled) return '';
    const style = fieldStyle(field);
    const entity = sig.signing_entity || '';
    const name = sig.signer_name || '[__]';
    const title = sig.title || '';
    const email = sig.email || '';
    const address = sig.address || '';
    const cityStateZip = sig.city_state_zip || '';
    const additional = sig.additional_signing_entity || '';
    const additionalTitle = sig.additional_signing_entity_title || '';
    const isIndividual = sig.signer_type === 'individual';

    switch (field.id) {
        case 'witness_clause': {
            const wText = getWitnessText(pageType, sigIndex);
            if (!wText) return '';
            const editable = isEditing
                ? ` contenteditable="true" data-config-key="witness_clause_text" data-page-type="${pageType}"`
                : '';
            let html = `<div class="preview-witness${isEditing ? ' editable-text' : ''}"${style}${editable}>${sanitizeRichText(wText)}</div>`;
            return html;
        }
        case 'consent_text': {
            const cText = getConsentText(pageType, sigIndex);
            if (!cText) return '';
            const editable = isEditing
                ? ` contenteditable="true" data-config-key="consent_text" data-page-type="${pageType}"`
                : '';
            return `<div class="preview-consent-text${isEditing ? ' editable-text' : ''}"${style}${editable}>${sanitizeRichText(cText)}</div>`;
        }
        case 'entity_header': {
            const label = getEntityHeaderLabel(pageType, sigIndex) || 'ENTITY';
            if (pageType === 'stockholder_consent') {
                return `<div class="preview-blank-line"></div><div class="preview-entity-header preview-entity-header-indented"${style}>${label}</div>`;
            }
            return `<div class="preview-entity-header"${style}>${label}</div>`;
        }
        case 'section_header': {
            const shLabel = getSectionHeaderLabel(pageType, sigIndex) || '';
            return `<div class="preview-sig-line section-header-editable" style="font-weight:bold" data-config-key="section_header_label" data-page-type="${pageType}">${sanitizeRichText(shLabel || 'Signer Header')}</div>`;
        }
        case 'company_header':
            return `<div class="preview-sig-line" style="font-weight:bold">COMPANY:</div>`;
        case 'directors_header':
            return `<div class="preview-directors-header"${style}>DIRECTORS:</div>`;
        case 'salutation':
            return `<div class="preview-closing-yours"${style}>Very truly yours,</div>`;
        case 'date_line': {
            return `<div class="preview-sig-line">Date: _________________</div>`;
        }
        case 'entity_name': {
            if (!entity) return null;
            return `<div class="preview-sig-line" style="font-weight:bold;white-space:normal;word-wrap:break-word">${escapeHtml(entity.toUpperCase())}</div>`;
        }
        case 'additional_signing_entity':
        case 'additional_signing_entity_2':
        case 'additional_signing_entity_3': {
            // Map field id to the right data fields
            const suffix = field.id === 'additional_signing_entity' ? '' : field.id === 'additional_signing_entity_2' ? '_2' : '_3';
            const ent = sig[`additional_signing_entity${suffix}`] || '';
            const role = sig[`additional_signing_entity_title${suffix}`] || '';
            if (!ent) return '';
            const separate = getEffectiveConfig(pageType, sigIndex, 'separate_its_line');
            let html = `<div class="preview-additional-entity">`;
            if (role && separate) {
                html += `<div>By: ${escapeHtml(ent)}</div>`;
                html += `<div>Its: ${escapeHtml(role)}</div>`;
            } else if (role) {
                html += `<div>By: ${escapeHtml(ent)}, its ${escapeHtml(role)}</div>`;
            } else {
                html += `<div>By: ${escapeHtml(ent)}</div>`;
            }
            html += `</div>`;
            return html;
        }
        case 'by_line': {
            const showByPrefix = getEffectiveConfig(pageType, sigIndex, 'show_by_prefix_individual');
            if (isIndividual && !showByPrefix)
                return `<div class="preview-blank-line"></div><div class="preview-blank-line"></div><div class="preview-sig-line"><span class="preview-underline"></span></div>`;
            return `<div class="preview-blank-line"></div><div class="preview-blank-line"></div><div class="preview-sig-line"${style}>By: <span class="preview-underline"></span></div>`;
        }
        case 'signer_name': {
            if (isIndividual)
                return `<div class="preview-sig-line"${style}>${escapeHtml(name)}</div>`;
            return `<div class="preview-sig-line"${style}>Name: ${escapeHtml(name)}</div>`;
        }
        case 'title': {
            if (isIndividual) return '';
            const displayTitle = title || getEffectiveConfig(pageType, sigIndex, 'default_title') || '';
            return `<div class="preview-sig-line"${style}>Title: ${escapeHtml(displayTitle)}</div>`;
        }
        case 'email': {
            return `<div class="preview-sig-line"${style}>Email: ${email ? escapeHtml(email) : ''}</div>`;
        }
        case 'address': {
            let addrHtml = `<div class="preview-sig-line preview-address-block"${style}>`;
            addrHtml += `<span class="preview-address-label">Address:</span>`;
            addrHtml += `<span class="preview-address-value">${address ? escapeHtml(address) : ''}`;
            addrHtml += `<br>${cityStateZip ? escapeHtml(cityStateZip) : '&nbsp;'}`;
            addrHtml += `</span></div>`;
            return addrHtml;
        }
        case 'city_state_zip': {
            return '';
        }
        case 'phone': {
            const phone = sig.phone || '';
            return `<div class="preview-sig-line"${style}>Phone: ${phone ? escapeHtml(phone) : ''}</div>`;
        }
        case 'cc_email': {
            const ccEmail = sig.cc_email || '';
            return `<div class="preview-sig-line"${style}>CC Email: ${ccEmail ? escapeHtml(ccEmail) : ''}</div>`;
        }
        case 'accepted_and_agreed': {
            const aaLabel = getEffectiveConfig(pageType, sigIndex, 'accepted_agreed_label') || 'Accepted and Agreed:';
            return `<div class="preview-accepted"${style}>${escapeHtml(aaLabel)}</div>`;
        }
        default:
            return '';
    }
}

function renderDynamicPreview(sig, pageType, sigIndex) {
    const config = templateConfigs[pageType];
    let fields;

    // Merge per-signatory field overrides
    const sigOverrides = (sig.field_overrides || {})[pageType];
    if (sigOverrides && sigOverrides.fields && config && config.fields) {
        const fieldOverrides = sigOverrides.fields;
        // Deep copy fields and apply overrides
        fields = config.fields.map(f => {
            const override = fieldOverrides[f.id];
            return override ? { ...f, ...override } : { ...f };
        }).sort((a, b) => a.order - b.order);
    } else if (config && config.fields && config.fields.length > 0) {
        fields = [...config.fields].sort((a, b) => a.order - b.order);
    } else {
        fields = (DEFAULT_FIELD_ORDER[pageType] || []).map((id, i) => ({
            id, enabled: true, order: i, bold: false, italic: false
        }));
    }

    // Witness clause and consent text are full-width. Everything else goes into a 2-col grid.
    const FULL_WIDTH_FIELDS = new Set(['witness_clause', 'consent_text']);
    const EDITABLE_TEXT_FIELDS = new Set(['witness_clause', 'consent_text']);

    let fullWidthHtml = '';

    const pageKey = `${sigIndex}-${pageType}`;
    const isEditing = editingPageKey === pageKey;

    const GRID_ROWS = 20;
    const GRID_COLS = 2;
    let disabledFields = [];

    // Build a map of cell contents: grid[row][col] = { field, html }
    const grid = Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill(null));

    for (const field of fields) {
        const isEnabled = field.enabled !== false;
        if (!isEnabled) { disabledFields.push(field); continue; }

        // Skip additional entity fields when signer has no data for them
        if (field.id && field.id.startsWith('additional_signing_entity')) {
            const suffix = field.id === 'additional_signing_entity' ? '' : field.id.replace('additional_signing_entity', '');
            const entVal = (sig[`additional_signing_entity${suffix}`] || '').trim();
            if (!entVal) { disabledFields.push(field); continue; }
        }

        let html = renderField(field, sig, pageType, fields, isEditing, sigIndex);
        if (html === null || html === '') { disabledFields.push(field); continue; }

        if (FULL_WIDTH_FIELDS.has(field.id)) {
            const canEdit = isEditing && EDITABLE_TEXT_FIELDS.has(field.id);
            const draggable = canEdit ? 'false' : 'true';
            fullWidthHtml += `<div class="preview-field-block${canEdit ? ' editable-block' : ''}" data-field-id="${field.id}" draggable="${draggable}">
                <span class="field-drag-handle">\u2807</span>
                <div class="field-controls">
                    <span class="field-label-tag">${escapeHtml(field.label || field.id)}</span>
                    <button class="field-remove-btn" onclick="event.stopPropagation(); removePreviewField('${field.id}')" title="Remove">\u00d7</button>
                </div>
                ${html}
            </div>`;
            continue;
        }

        // Place in grid cell
        const colIdx = (field.column === 'left') ? 0 : 1;
        let rowIdx = (field.row !== undefined && field.row !== null) ? field.row : -1;
        // Auto-assign row if not set: find first empty cell in this column
        if (rowIdx < 0 || rowIdx >= GRID_ROWS || grid[rowIdx][colIdx]) {
            for (let r = 0; r < GRID_ROWS; r++) {
                if (!grid[r][colIdx]) { rowIdx = r; break; }
            }
        }
        if (rowIdx >= 0 && rowIdx < GRID_ROWS && !grid[rowIdx][colIdx]) {
            grid[rowIdx][colIdx] = { field, html };
        }
    }

    // Find the by_line row so we can insert spacing rows before it
    let byLineRow = -1;
    for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
            if (grid[r][c] && grid[r][c].field.id === 'by_line') { byLineRow = r; break; }
        }
        if (byLineRow >= 0) break;
    }

    // Find the last row with any content (to mark trailing rows)
    let lastFilledRow = -1;
    for (let r = GRID_ROWS - 1; r >= 0; r--) {
        if (grid[r][0] || grid[r][1]) { lastFilledRow = r; break; }
    }

    // Render the grid as an HTML table
    let gridHtml = '';
    for (let r = 0; r < GRID_ROWS; r++) {
        // Insert 2 blank spacing rows before the by_line row
        const isTrailing = r > lastFilledRow;
        gridHtml += `<tr class="${isTrailing ? 'sig-grid-row-trailing' : ''}">`;
        for (let c = 0; c < GRID_COLS; c++) {
            const cell = grid[r][c];
            const cellAttr = `data-grid-row="${r}" data-grid-col="${c}"`;
            if (cell) {
                gridHtml += `<td class="sig-grid-cell sig-grid-cell-filled" ${cellAttr}>
                    <div class="preview-field-block" data-field-id="${cell.field.id}" data-column="${c === 0 ? 'left' : 'right'}" data-row="${r}" draggable="true">
                        <span class="field-drag-handle">\u2807</span>
                        <div class="field-controls">
                            <span class="field-label-tag">${escapeHtml(cell.field.label || cell.field.id)}</span>
                            <button class="field-remove-btn" onclick="event.stopPropagation(); removePreviewField('${cell.field.id}')" title="Remove">\u00d7</button>
                        </div>
                        ${cell.html}
                    </div>
                </td>`;
            } else {
                gridHtml += `<td class="sig-grid-cell sig-grid-cell-empty" ${cellAttr}></td>`;
            }
        }
        gridHtml += `</tr>`;
    }

    let bodyHtml = fullWidthHtml;
    bodyHtml += `<table class="preview-sig-grid"><tbody>${gridHtml}</tbody></table>`;

    const name = sig.signer_name || '[__]';
    const entity = sig.signing_entity || '';
    return previewPageWrap(pageType, name, bodyHtml, entity, sigIndex);
}

function togglePreview() {
    const container = document.getElementById("preview-container");
    const btn = document.getElementById("preview-toggle-btn");
    container.classList.toggle("collapsed");
    btn.textContent = container.classList.contains("collapsed") ? "Show Preview" : "Hide Preview";
}

function debouncePreview() {
    clearTimeout(previewDebounceTimer);
    previewDebounceTimer = setTimeout(renderPreview, 100);
}

function renderPreview() {
    const pagesEl = document.getElementById("preview-pages");
    const placeholderEl = document.getElementById("preview-placeholder");
    // Collect checked matrix entries
    const selections = getMatrixSelections();
    const pages = [];
    selections.forEach(({ sigIndex, sig, checkedTypes }) => {
        checkedTypes.forEach(pt => pages.push({ sig, pageType: pt, sigIndex }));
    });

    if (pages.length === 0) {
        pagesEl.innerHTML = "";
        placeholderEl.style.display = "block";
        return;
    }

    placeholderEl.style.display = "none";

    // Pages are already in matrix row order — no sort needed

    pagesEl.innerHTML = pages.map(p => {
        const renderer = PREVIEW_RENDERERS[p.pageType];
        if (!renderer) return "";
        return renderer(p.sig, p.sigIndex);
    }).join("");

    // Initialize drag handlers for edit mode
    initPreviewFieldDrag();

    // Keep drawer scope toggle in sync with edit state
    updateDrawerScopeUI();
}

// Footer text: per-signatory override from drawer, global from inline preview.
function getFooterText(pageType, sigIndex) {
    const cfg = templateConfigs[pageType];
    if (!cfg) return '';
    const footerEnabled = sigIndex != null
        ? getEffectiveConfig(pageType, sigIndex, 'footer_enabled')
        : cfg.footer_enabled;
    if (footerEnabled === false) return '';
    const footerTpl = sigIndex != null
        ? getEffectiveConfig(pageType, sigIndex, 'footer_template')
        : cfg.footer_template;
    if (!footerTpl) return '';
    return footerTpl
        .replace(/\{\{agreement_name\}\}/g, getAgreementTitle(pageType))
        .replace(/\{\{financing_round\}\}/g, getFinancingRound())
        .replace(/\{\{company_name\}\}/g, getCompanyName());
}

function previewPageWrap(pageType, sigName, bodyHtml, entityName, sigIndex) {
    const label = getPageLabel(pageType);
    const footerText = getFooterText(pageType, sigIndex);
    const footerRichHtml = sanitizeRichText(footerText);
    const pageKey = `${sigIndex}-${pageType}`;
    const isEditing = editingPageKey === pageKey;
    const sig = savedSignatures[sigIndex];
    const hasOverrides = _hasCustomOverrides(sig, pageType);
    const labelClass = hasOverrides ? ' custom-page-label' : '';
    const customTag = hasOverrides ? '<span class="page-custom-tag">Custom</span>' : '';
    const footerEditable = isEditing
        ? ` contenteditable="true" data-config-key="footer_template" data-page-type="${pageType}"`
        : '';
    const footerEditClass = isEditing ? ' editable-text' : '';
    let html = `<div class="preview-page-wrapper">
        <div class="preview-page ${isEditing ? 'editing' : ''}" data-page-key="${pageKey}" data-sig-index="${sigIndex}" data-page-type="${pageType}" onclick="togglePageEdit(this)">
            <div class="preview-page-label${labelClass}">${escapeHtml(label)}${customTag}<span class="sig-name">${escapeHtml(sigName)}</span></div>
            ${bodyHtml}
            <div class="preview-footer${footerEditClass}"${footerEditable}>${footerRichHtml}</div>
        </div>`;
    html += `</div>`;
    return html;
}

// -- Preview renderers: single dynamic function for all page types --

function rebuildPreviewRenderers() {
    PREVIEW_RENDERERS = Object.fromEntries(
        PAGE_TYPES.map(pt => [pt, (sig, sigIndex) => renderDynamicPreview(sig, pt, sigIndex)])
    );
}

// -- Interactive preview: click-to-edit, field toggle, drag-to-reorder --

function removePreviewField(fieldId) {
    const page = document.querySelector('.preview-page.editing');
    if (!page) return;
    const sigIndex = parseInt(page.dataset.sigIndex);
    const pageType = page.dataset.pageType;
    const sig = savedSignatures[sigIndex];
    if (!sig) return;

    pushUndo(sigIndex, pageType);
    const ov = _ensureOverrides(sig, pageType, fieldId);
    ov.enabled = false;
    _saveFieldOverrides(sigIndex, pageType);
    debouncePreview();
}

function togglePageEdit(pageEl) {
    // Don't toggle if the click was on a control element
    if (event.target.closest('.field-controls') || event.target.closest('.field-remove-btn')) return;
    if (event.target.closest('[contenteditable="true"]') || event.target.closest('.section-header-editable')) return;

    const pageKey = pageEl.dataset.pageKey;
    // Clear multi-selection when switching pages
    _clearFieldSelection();
    if (editingPageKey === pageKey) {
        editingPageKey = null;
    } else {
        editingPageKey = pageKey;
        // Auto-open settings drawer with this page type selected in per-signatory scope
        const pageType = pageEl.dataset.pageType;
        if (!drawerOpen) toggleSettingsDrawer();
        if (pageType) selectTemplateTab(pageType);
        setDrawerScope('selected');
    }
    // Re-render to apply/remove editing class
    renderPreview();
    // Re-init drag handlers
    initPreviewFieldDrag();
}

async function saveEditableText(pageType, configKey, newText) {
    // Re-insert template placeholders so the saved config stays dynamic
    const agreementTitle = getAgreementTitle(pageType);
    if (agreementTitle) {
        newText = newText.replace(new RegExp(escapeRegExp(agreementTitle), 'g'), '{{agreement_name}}');
    }
    const round = getFinancingRound();
    if (round) {
        newText = newText.replace(new RegExp(escapeRegExp(round), 'g'), '{{financing_round}}');
    }
    const companyName = getCompanyName();
    if (companyName) {
        newText = newText.replace(new RegExp(escapeRegExp(companyName), 'g'), '{{company_name}}');
    }

    // Witness clause, footer, and signer header save globally from inline preview.
    // Other fields save per-signatory when editing a specific page.
    const globalKeys = new Set(['witness_clause_text', 'consent_text', 'footer_template']);
    if (!globalKeys.has(configKey) && editingPageKey) {
        const sigIdx = parseInt(editingPageKey.split('-')[0]);
        const sig = savedSignatures[sigIdx];
        if (sig) {
            const cfgOv = _ensureConfigOverride(sig, pageType);
            cfgOv[configKey] = newText;
            try {
                await fetch(`/signatures/${sigIdx}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fields: { field_overrides: sig.field_overrides } }),
                });
            } catch (e) {
                console.error('Failed to save per-signatory text override:', e);
            }
            return;
        }
    }

    // Global save
    const cfg = templateConfigs[pageType];
    if (!cfg) return;
    cfg[configKey] = newText;
    try {
        await fetch(`/api/templates/${pageType}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cfg),
        });
    } catch (e) {
        console.error('Failed to save editable text:', e);
    }
}

function initEditableTextHandlers() {
    const pagesEl = document.getElementById('preview-pages');
    if (!pagesEl) return;

    pagesEl.addEventListener('focusout', (e) => {
        const el = e.target;
        if (!el.hasAttribute('contenteditable') || el.getAttribute('contenteditable') !== 'true') return;
        const configKey = el.dataset.configKey;
        const pageType = el.dataset.pageType;
        if (!configKey || !pageType) return;
        const isRichField = (configKey === 'witness_clause_text' || configKey === 'consent_text' || configKey === 'footer_template');
        const newText = isRichField ? richTextToTagged(el) : el.textContent.trim();
        saveEditableText(pageType, configKey, newText).then(() => {
            // Re-render to show updated formatting
            if (isRichField) renderPreview();
        });
        // Remove contenteditable for dblclick-activated fields
        if (el.classList.contains('section-header-editable')) {
            el.removeAttribute('contenteditable');
        }
    });

    pagesEl.addEventListener('keydown', (e) => {
        if (e.target.hasAttribute('contenteditable') && e.target.getAttribute('contenteditable') === 'true') {
            // Allow Enter in witness/consent fields (multi-line), blur for others
            if (e.key === 'Enter' && !e.target.classList.contains('preview-witness') && !e.target.classList.contains('preview-consent-text')) {
                e.preventDefault();
                e.target.blur();
            }
        }
    });

    pagesEl.addEventListener('dblclick', (e) => {
        const el = e.target.closest('.section-header-editable');
        if (!el || el.getAttribute('contenteditable') === 'true') return;
        el.setAttribute('contenteditable', 'true');
        el.focus();
        // Select all text
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    });
}

function _clearFieldSelection() {
    selectedFieldIds.clear();
    _lastSelectedFieldId = null;
    document.querySelectorAll('.preview-field-block.field-selected').forEach(el => {
        el.classList.remove('field-selected');
    });
}

let _lastSelectedFieldId = null;

function _toggleFieldSelection(block, e) {
    const fieldId = block.dataset.fieldId;
    if (!fieldId) return;
    const editingPage = block.closest('.preview-page.editing');

    if (e.shiftKey && _lastSelectedFieldId && editingPage) {
        // Shift-click: select range from last selected to this one
        const allBlocks = [...editingPage.querySelectorAll('.preview-field-block[data-field-id]')];
        const lastIdx = allBlocks.findIndex(b => b.dataset.fieldId === _lastSelectedFieldId);
        const curIdx = allBlocks.findIndex(b => b.dataset.fieldId === fieldId);
        if (lastIdx >= 0 && curIdx >= 0) {
            const start = Math.min(lastIdx, curIdx);
            const end = Math.max(lastIdx, curIdx);
            for (let i = start; i <= end; i++) {
                const bid = allBlocks[i].dataset.fieldId;
                selectedFieldIds.add(bid);
                allBlocks[i].classList.add('field-selected');
            }
        }
        // Don't update _lastSelectedFieldId on shift-click (anchor stays)
        return;
    }

    if (e.metaKey || e.ctrlKey) {
        // Cmd/Ctrl-click: toggle this field
        if (selectedFieldIds.has(fieldId)) {
            selectedFieldIds.delete(fieldId);
            block.classList.remove('field-selected');
        } else {
            selectedFieldIds.add(fieldId);
            block.classList.add('field-selected');
        }
    } else {
        // Plain click: select only this field (clear others)
        if (selectedFieldIds.size === 1 && selectedFieldIds.has(fieldId)) {
            _clearFieldSelection();
            _lastSelectedFieldId = null;
            return;
        } else {
            _clearFieldSelection();
            selectedFieldIds.add(fieldId);
            block.classList.add('field-selected');
        }
    }
    _lastSelectedFieldId = fieldId;
}

function initPreviewFieldDrag() {
    const editingPage = document.querySelector('.preview-page.editing');
    if (!editingPage) return;

    let draggedBlock = null;
    const sigIndex = parseInt(editingPage.dataset.sigIndex);
    const pageType = editingPage.dataset.pageType;

    // Restore selection state after re-render
    editingPage.querySelectorAll('.preview-field-block').forEach(block => {
        if (selectedFieldIds.has(block.dataset.fieldId)) {
            block.classList.add('field-selected');
        }
    });

    // Field blocks — click to select, drag to move
    editingPage.querySelectorAll('.preview-field-block').forEach(block => {
        // Click to select/deselect
        block.addEventListener('click', (e) => {
            // Don't toggle selection if clicking controls or editable content
            if (e.target.closest('.field-controls') || e.target.closest('.field-remove-btn')) return;
            if (e.target.closest('[contenteditable="true"]') || e.target.closest('.section-header-editable')) return;
            e.stopPropagation();
            _toggleFieldSelection(block, e);
        });

        block.addEventListener('dragstart', (e) => {
            draggedBlock = block;
            const fieldId = block.dataset.fieldId;

            // If dragging an unselected field, select only it
            if (!selectedFieldIds.has(fieldId)) {
                _clearFieldSelection();
                selectedFieldIds.add(fieldId);
                block.classList.add('field-selected');
            }

            // Mark all selected fields as dragging
            requestAnimationFrame(() => {
                editingPage.querySelectorAll('.preview-field-block').forEach(b => {
                    if (selectedFieldIds.has(b.dataset.fieldId)) {
                        b.classList.add('dragging');
                    }
                });
            });
            e.dataTransfer.effectAllowed = 'move';

            // Ghost label shows count if multiple selected
            const ghost = document.createElement('div');
            if (selectedFieldIds.size > 1) {
                ghost.textContent = `${selectedFieldIds.size} fields`;
            } else {
                ghost.textContent = block.querySelector('.field-label-tag')?.textContent || 'Field';
            }
            ghost.style.cssText = 'position:fixed;top:-100px;padding:4px 10px;background:var(--primary);color:#fff;border-radius:4px;font-size:11px;font-family:var(--font-body);white-space:nowrap;';
            document.body.appendChild(ghost);
            e.dataTransfer.setDragImage(ghost, 0, 0);
            setTimeout(() => ghost.remove(), 0);
        });
        block.addEventListener('dragend', () => {
            editingPage.querySelectorAll('.preview-field-block.dragging').forEach(b => {
                b.classList.remove('dragging');
            });
            draggedBlock = null;
            editingPage.querySelectorAll('.drag-over-cell, .drag-insert-above').forEach(c => {
                c.classList.remove('drag-over-cell', 'drag-insert-above');
            });
        });
    });

    // All grid cells — drop targets with insertion indicator
    editingPage.querySelectorAll('.sig-grid-cell').forEach(cell => {
        cell.addEventListener('dragover', (e) => {
            e.preventDefault();
            // Clear all indicators first
            editingPage.querySelectorAll('.drag-insert-above, .drag-over-cell').forEach(c => {
                if (c !== cell) c.classList.remove('drag-insert-above', 'drag-over-cell');
            });
            const hasFilled = cell.querySelector('.preview-field-block');
            if (hasFilled) {
                cell.classList.add('drag-insert-above');
            } else {
                cell.classList.add('drag-over-cell');
            }
        });
        cell.addEventListener('dragleave', () => cell.classList.remove('drag-over-cell', 'drag-insert-above'));
        cell.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            cell.classList.remove('drag-over-cell', 'drag-insert-above');
            if (!draggedBlock) return;

            const targetRow = parseInt(cell.dataset.gridRow);
            const targetCol = parseInt(cell.dataset.gridCol) === 0 ? 'left' : 'right';

            const sig = savedSignatures[sigIndex];
            if (!sig) return;

            pushUndo(sigIndex, pageType);

            // Collect all selected fields with their current positions
            const movingFields = [];
            editingPage.querySelectorAll('.preview-field-block').forEach(b => {
                if (selectedFieldIds.has(b.dataset.fieldId)) {
                    movingFields.push({
                        id: b.dataset.fieldId,
                        row: parseInt(b.dataset.row) || 0,
                        column: b.dataset.column || 'right',
                    });
                }
            });
            movingFields.sort((a, b) => a.row - b.row);
            if (movingFields.length === 0) return;

            const anchorField = movingFields.find(f => f.id === draggedBlock.dataset.fieldId) || movingFields[0];
            const colChange = targetCol !== anchorField.column;

            // Build a list of non-selected fields with positions
            const allBlocks = editingPage.querySelectorAll('.preview-field-block[data-row]');
            const nonSelected = [];
            allBlocks.forEach(b => {
                if (!selectedFieldIds.has(b.dataset.fieldId)) {
                    nonSelected.push({ id: b.dataset.fieldId, row: parseInt(b.dataset.row), column: b.dataset.column });
                }
            });

            // Compute new positions for selected fields
            const newPositions = movingFields.map((f, idx) => ({
                id: f.id,
                row: targetRow + idx,
                column: colChange ? targetCol : f.column,
            }));

            // Check if any target cells are occupied — if so, shift those
            // fields (and everything at/below) down to make room.
            // The old positions are LEFT as gaps (no shifting up).
            const movingCount = newPositions.length;
            const occupiedTargets = newPositions.filter(np =>
                nonSelected.some(ns => ns.row === np.row && ns.column === np.column)
            );

            if (occupiedTargets.length > 0) {
                // Shift non-selected fields at or below the target row down
                for (const ns of nonSelected) {
                    if (ns.row >= targetRow && ns.column === targetCol) {
                        const ov = _ensureOverrides(sig, pageType, ns.id);
                        ov.row = ns.row + movingCount;
                        ov.column = ns.column;
                    }
                }
            }

            // Pin the moved fields' OLD positions as explicit overrides on
            // remaining fields so the gap is preserved (nothing shifts up).
            // This is handled naturally: fields without explicit row overrides
            // auto-assign, but fields WITH overrides keep their positions.
            // The moved fields' old rows simply become empty grid cells.

            // Apply new positions to selected fields
            for (const np of newPositions) {
                const ov = _ensureOverrides(sig, pageType, np.id);
                ov.row = np.row;
                ov.column = np.column;
            }

            // Pin all non-selected fields at their current positions so
            // they don't auto-shift to fill gaps left by moved fields
            for (const ns of nonSelected) {
                const ov = _ensureOverrides(sig, pageType, ns.id);
                if (ov.row === undefined) ov.row = ns.row;
                if (ov.column === undefined) ov.column = ns.column;
            }

            _saveFieldOverrides(sigIndex, pageType);
            renderPreview();
        });
    });

    // Click on empty area of the page to clear selection
    editingPage.addEventListener('click', (e) => {
        if (!e.target.closest('.preview-field-block') && !e.target.closest('.field-controls')) {
            _clearFieldSelection();
        }
    });
}

// -- Attach live preview listeners --

function attachPreviewListeners() {
    // Form field inputs
    const formIds = ["company-name", "financing-round", "signing-entity", "additional-signing-entity",
                     "signer-name", "signer-title", "signer-email", "signer-phone",
                     "cc-email", "signer-address", "signer-city-state"];
    formIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("input", debouncePreview);
    });

    // Matrix checkboxes (use event delegation on the table)
    document.getElementById("matrix-table").addEventListener("change", (e) => {
        if (e.target.classList.contains("matrix-cb")) {
            // Auto-check related documents when a doc is checked
            if (e.target.checked) {
                const row = e.target.dataset.row;
                const type = e.target.dataset.type;
                applyRelatedDocuments(type, row);
            }
            debouncePreview();
        } else if (e.target.classList.contains("col-toggle")) {
            debouncePreview();
        }
    });
}

// -- Bulk extract --
