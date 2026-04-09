/**
 * Signatures — CRUD, upload/extract, bulk extract, Excel import/export
 * Form handling, signing entity management
 */

// -- Signature image upload --

document.addEventListener("DOMContentLoaded", () => {
    const area = document.getElementById("upload-area");
    const fileInput = document.getElementById("sig-file-input");

    fileInput.addEventListener("change", (e) => {
        if (e.target.files.length > 0) handleScreenshotUpload(e.target.files[0]);
    });

    area.addEventListener("dragover", (e) => {
        e.preventDefault();
        area.classList.add("drag-over");
    });
    area.addEventListener("dragleave", () => area.classList.remove("drag-over"));
    area.addEventListener("drop", (e) => {
        e.preventDefault();
        area.classList.remove("drag-over");
        if (e.dataTransfer.files.length > 0) handleScreenshotUpload(e.dataTransfer.files[0]);
    });
});

async function handleScreenshotUpload(file) {
    if (!file.type.startsWith("image/")) {
        alert("Please upload an image file (PNG, JPG, etc.).");
        return;
    }
    const reader = new FileReader();
    console.log("Reading file for preview and extraction:", file);
    reader.onload = async (e) => {
        signatureBase64 = e.target.result;
        document.getElementById("sig-preview-img").src = signatureBase64;
        document.getElementById("upload-placeholder").style.display = "none";
        document.getElementById("upload-preview").style.display = "block";

        const statusEl = document.getElementById("extract-status");
        statusEl.textContent = "Extracting...";
        statusEl.style.display = "block";

        try {
            const extractPayload = { image: signatureBase64 };

            const resp = await fetch("/extract", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(extractPayload),
            });
            const data = await resp.json();
            if (resp.ok && data.fields) {
                const f = data.fields;
                clearSignerFormFields();
                populateSignerFormFields(f);

                // Auto-set signer type based on extracted fields
                if (f.signing_entity) {
                    setSignerType('entity');
                } else {
                    setSignerType('individual');
                }
                autoRevealEntities();
                // Auto-open contact details if any contact fields were extracted
                if (f.email || f.phone || f.cc_email || f.address || f.city_state_zip) {
                    const contactSection = document.getElementById('contact-fields');
                    if (contactSection && contactSection.classList.contains('collapsed')) {
                        toggleSection('contact-fields');
                    }
                }
                const count = Object.keys(f).length;
                const via = data.method === "azure_document_intelligence" ? "Azure Document Intelligence" : "Claude Code";
                statusEl.textContent = count > 0
                    ? `${count} field(s) via ${via}`
                    : "No fields found";
            } else {
                statusEl.textContent = data.error || "Could not extract";
            }
        } catch (err) {
            statusEl.textContent = "Failed: " + err.message;
        }
    };
    reader.readAsDataURL(file);
}

function removeScreenshot(e) {
    e.stopPropagation();
    signatureBase64 = null;
    document.getElementById("sig-file-input").value = "";
    document.getElementById("upload-placeholder").style.display = "flex";
    document.getElementById("upload-preview").style.display = "none";
    document.getElementById("extract-status").style.display = "none";
}

// -- Additional signing entity progressive disclosure --

function addSigningEntity() {
    for (let i = 1; i <= 3; i++) {
        const pair = document.getElementById(`additional-entity-${i}`);
        if (pair && pair.style.display === 'none') {
            pair.style.display = '';
            updateAddEntityButton();
            return;
        }
    }
}

function removeSigningEntity(n) {
    const pair = document.getElementById(`additional-entity-${n}`);
    if (!pair) return;
    // Clear values
    const inputs = pair.querySelectorAll('input[type="text"]');
    inputs.forEach(inp => { inp.value = ''; });
    pair.style.display = 'none';
    updateAddEntityButton();
}

function updateAddEntityButton() {
    const btn = document.getElementById('add-entity-btn');
    if (!btn) return;
    let allVisible = true;
    for (let i = 1; i <= 3; i++) {
        const pair = document.getElementById(`additional-entity-${i}`);
        if (pair && pair.style.display === 'none') {
            allVisible = false;
            break;
        }
    }
    btn.style.display = allVisible ? 'none' : '';
}

function autoRevealEntities() {
    const pairs = [
        { n: 1, entityId: 'additional-signing-entity', roleId: 'additional-signing-entity-title' },
        { n: 2, entityId: 'additional-signing-entity-2', roleId: 'additional-signing-entity-title-2' },
        { n: 3, entityId: 'additional-signing-entity-3', roleId: 'additional-signing-entity-title-3' },
    ];
    pairs.forEach(p => {
        const entity = document.getElementById(p.entityId);
        const role = document.getElementById(p.roleId);
        if ((entity && entity.value.trim()) || (role && role.value.trim())) {
            const container = document.getElementById(`additional-entity-${p.n}`);
            if (container) container.style.display = '';
        }
    });
    updateAddEntityButton();
}

// -- Signer type toggle --

function setSignerType(type) {
    document.getElementById("signer-type").value = type;
    document.querySelectorAll(".signer-type-toggle .type-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.type === type);
    });
    document.querySelectorAll(".entity-fields").forEach(el => {
        el.classList.toggle("hidden", type === "individual");
    });
}

// -- Matrix: column toggle (click header to toggle all) --

function toggleColumn(type) {
    const typeIdx = PAGE_TYPES.indexOf(type);
    if (typeIdx === -1) return;
    const allCbs = document.querySelectorAll(`input.matrix-cb[data-type="${type}"]`);
    const allChecked = Array.from(allCbs).every(cb => cb.checked);
    const newState = !allChecked;
    allCbs.forEach(cb => {
        cb.checked = newState;
        const cell = cb.closest('.matrix-cell');
        if (cell) cell.classList.toggle('checked', newState);
        if (newState) applyRelatedDocuments(type, cb.dataset.row);
    });
    updateColumnHeaderState(type);
    document.querySelectorAll('#matrix-tbody tr[data-sig-index]').forEach(row => {
        updateRowToggleState(row.dataset.sigIndex);
    });
    debouncePreview();
}

// -- Matrix: row toggle (click signer name to toggle all) --

function toggleRow(rowIdx) {
    const row = document.querySelector(`#matrix-tbody tr[data-sig-index="${rowIdx}"]`);
    if (!row) return;
    const allCbs = row.querySelectorAll('input.matrix-cb');
    const allChecked = Array.from(allCbs).every(cb => cb.checked);
    const newState = !allChecked;
    allCbs.forEach(cb => {
        cb.checked = newState;
        const cell = cb.closest('.matrix-cell');
        if (cell) cell.classList.toggle('checked', newState);
        if (newState) applyRelatedDocuments(cb.dataset.type, rowIdx);
    });
    updateRowToggleState(rowIdx);
    PAGE_TYPES.forEach(pt => updateColumnHeaderState(pt));
    debouncePreview();
}

// Update column header visual state (filled/half/empty)
function updateColumnHeaderState(type) {
    const th = document.querySelector(`th.col-type[data-type="${type}"]`);
    if (!th) return;
    const allCbs = document.querySelectorAll(`input.matrix-cb[data-type="${type}"]`);
    if (allCbs.length === 0) { th.classList.remove('col-all', 'col-partial'); return; }
    const checkedCount = Array.from(allCbs).filter(cb => cb.checked).length;
    th.classList.toggle('col-all', checkedCount === allCbs.length);
    th.classList.toggle('col-partial', checkedCount > 0 && checkedCount < allCbs.length);
}

// Update row name visual state
function updateRowToggleState(rowIdx) {
    const nameCell = document.querySelector(`tr[data-sig-index="${rowIdx}"] .col-name`);
    if (!nameCell) return;
    const row = document.querySelector(`#matrix-tbody tr[data-sig-index="${rowIdx}"]`);
    const allCbs = row.querySelectorAll('input.matrix-cb');
    if (allCbs.length === 0) return;
    const checkedCount = Array.from(allCbs).filter(cb => cb.checked).length;
    nameCell.classList.toggle('row-all', checkedCount === allCbs.length);
    nameCell.classList.toggle('row-partial', checkedCount > 0 && checkedCount < allCbs.length);
}

function updateAllToggleStates() {
    PAGE_TYPES.forEach(pt => updateColumnHeaderState(pt));
    document.querySelectorAll('#matrix-tbody tr[data-sig-index]').forEach(row => {
        updateRowToggleState(row.dataset.sigIndex);
    });
}

// Toggle a single matrix cell (styled check)
function toggleMatrixCell(cell) {
    const cb = cell.querySelector('input.matrix-cb');
    if (!cb) return;
    cb.checked = !cb.checked;
    cell.classList.toggle('checked', cb.checked);
    if (cb.checked) applyRelatedDocuments(cb.dataset.type, cb.dataset.row);
    updateColumnHeaderState(cb.dataset.type);
    updateRowToggleState(cb.dataset.row);
    debouncePreview();
}

// -- Generate --

function toggleGenerateMenu() {
    document.getElementById('generate-menu').classList.toggle('show');
}
function toggleExcelMenu() {
    document.getElementById('excel-menu').classList.toggle('show');
}
function handleExcelDrop(e) {
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.xlsx')) {
        const input = document.getElementById('upload-excel-input');
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change'));
    }
}
async function submitGenerate(downloadMode) {
    document.getElementById('generate-menu').classList.remove('show');
    const selections = getMatrixSelections();
    const entries = selections.map(({ sig, checkedTypes }) => ({
        sig_block: {
            signer_type: sig.signer_type || "entity",
            signing_entity: sig.signing_entity || "",
            additional_signing_entity: sig.additional_signing_entity || "",
            additional_signing_entity_title: sig.additional_signing_entity_title || "",
            additional_signing_entity_2: sig.additional_signing_entity_2 || "",
            additional_signing_entity_title_2: sig.additional_signing_entity_title_2 || "",
            additional_signing_entity_3: sig.additional_signing_entity_3 || "",
            additional_signing_entity_title_3: sig.additional_signing_entity_title_3 || "",
            signer_name: sig.signer_name || "",
            title: sig.title || "",
            email: sig.email || "",
            phone: sig.phone || "",
            cc_email: sig.cc_email || "",
            address: sig.address || "",
            city_state_zip: sig.city_state_zip || "",
            field_overrides: sig.field_overrides || {},
        },
        page_types: checkedTypes,
    }));

    if (entries.length === 0) {
        alert("Please check at least one page type for at least one signatory in the matrix.");
        return;
    }

    const companyName = document.getElementById("company-name").value.trim() || "[Company]";
    const financingRound = document.getElementById("financing-round").value.trim() || "[___]";

    const btn = document.getElementById("generate-btn");
    btn.disabled = true;
    btn.textContent = "Generating...";

    try {
        const response = await fetch("/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                entries: entries,
                financing_round: financingRound,
                company_name: companyName,
                download_mode: downloadMode,
            }),
        });

        if (!response.ok) {
            const err = await response.json();
            alert("Error: " + (err.error || "Failed to generate document."));
            return;
        }

        const blob = await response.blob();
        const disposition = response.headers.get('Content-Disposition') || '';
        let filename = 'Signature_Pages.docx';
        const fnMatch = disposition.match(/filename="?([^";\n]+)"?/);
        if (fnMatch) filename = fnMatch[1];
        downloadBlobAsFile(blob, filename);
    } catch (e) {
        alert("Error generating document: " + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = "Generate & Download \u25BE";
    }
}

// ---------------------------------------------------------------------------
// Signatures log / matrix
// ---------------------------------------------------------------------------

function getSelectedSignatureIndexes() {
    return [...document.querySelectorAll('#matrix-tbody input.sig-row-cb:checked')]
        .filter(cb => {
            const tr = cb.closest('tr[data-sig-index]');
            return !tr || tr.style.display !== 'none';
        })
        .map(cb => parseInt(cb.dataset.sigIndex, 10))
        .filter(n => Number.isFinite(n));
}

function updateDeleteSelectedButton() {
    const btn = document.getElementById("delete-selected-btn");
    if (!btn) return;
    btn.disabled = getSelectedSignatureIndexes().length === 0;
}

function toggleSelectAll(checked) {
    const allCbs = [...document.querySelectorAll('#matrix-tbody input.sig-row-cb')]
        .filter(cb => cb.closest('tr[data-sig-index]')?.style.display !== 'none');
    allCbs.forEach(cb => { cb.checked = checked; });
    updateDeleteSelectedButton();
}

function syncSelectAllCheckbox() {
    const header = document.getElementById("select-all-cb");
    if (!header) return;
    const allCbs = [...document.querySelectorAll('#matrix-tbody input.sig-row-cb')]
        .filter(cb => cb.closest('tr[data-sig-index]')?.style.display !== 'none');
    header.checked = allCbs.length > 0 && allCbs.every(cb => cb.checked);
    header.indeterminate = !header.checked && allCbs.some(cb => cb.checked);
}

document.addEventListener("DOMContentLoaded", () => {
    const tbody = document.getElementById("matrix-tbody");
    if (!tbody) return;
    tbody.addEventListener("change", (e) => {
        if (e.target && e.target.classList && e.target.classList.contains("sig-row-cb")) {
            updateDeleteSelectedButton();
            syncSelectAllCheckbox();
        }
    });
    updateDeleteSelectedButton();
});

async function deleteSelectedSignatures() {
    const indexes = getSelectedSignatureIndexes().sort((a, b) => b - a);
    if (indexes.length === 0) return;
    if (!confirm(`Delete ${indexes.length} selected row(s)?`)) return;

    try {
        for (const idx of indexes) {
            const resp = await fetch(`/signatures/${idx}`, { method: "DELETE" });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.error || `Failed to delete row ${idx}`);
            }
        }
        fetchSignatureLog();
    } catch (e) {
        alert("Error deleting: " + e.message);
    }
}

async function submitSaveSignature() {
    const fields = collectSignerFormFields();

    const btn = document.getElementById("save-sig-btn");
    btn.disabled = true;
    btn.textContent = "Saving...";

    try {
        const resp = await fetch("/signatures", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client: "", fields }),
        });
        if (resp.ok) {
            btn.textContent = "Saved!";
            clearSignerFormFields();
            removeScreenshot({ stopPropagation: () => {} });
            setSignerType('entity');  // Reset toggle
            // Hide all additional entity pairs
            for (let i = 1; i <= 3; i++) removeSigningEntity(i);
            fetchSignatureLog();
            setTimeout(() => { btn.textContent = "Save Signatory"; btn.disabled = false; }, 1500);
        } else {
            const err = await resp.json();
            alert(err.error || "Failed to save");
            btn.textContent = "Save Signatory";
            btn.disabled = false;
        }
    } catch (e) {
        alert("Error saving: " + e.message);
        btn.textContent = "Save Signatory";
        btn.disabled = false;
    }
}

async function submitBulkExtract(file) {
    if (!file) return;

    const statusEl = document.getElementById("bulk-status");
    statusEl.textContent = "Extracting signatories...";
    statusEl.style.display = "block";

    const formData = new FormData();
    formData.append("file", file);

    try {
        const resp = await fetch("/bulk-extract", {
            method: "POST",
            body: formData,
        });
        const data = await resp.json();
        if (resp.ok) {
            statusEl.textContent = `Found ${data.total_found} signatories, added ${data.added} to table.`;
            fetchSignatureLog();
        } else {
            statusEl.textContent = data.error || "Extraction failed";
        }
    } catch (e) {
        statusEl.textContent = "Error: " + e.message;
    }

    // Reset file input
    document.getElementById("bulk-file-input").value = "";
}

function renderFieldOverridesHtml(s, i) {
    return PAGE_TYPES.map(pt => {
        const cfg = templateConfigs[pt] || {};
        const fields = cfg.fields || [];
        const overrides = (s.field_overrides || {})[pt] || {};
        const fieldOverrides = (overrides && overrides.fields) || {};
        return '<div class="override-page-type">'
            + '<strong>' + escapeHtml(cfg.display_name || pt) + '</strong>'
            + '<div class="override-fields">'
            + fields.map(f => {
                const isOverridden = f.id in fieldOverrides;
                const enabled = isOverridden ? fieldOverrides[f.id].enabled : f.enabled;
                return '<label class="override-toggle ' + (isOverridden ? 'overridden' : '') + '">'
                    + '<input type="checkbox" ' + (enabled !== false ? 'checked' : '')
                    + ' onchange="setFieldOverride(' + i + ', \'' + pt + '\', \'' + f.id + '\', this.checked)">'
                    + escapeHtml(f.label)
                    + '</label>';
            }).join('')
            + '</div>'
            + '</div>';
    }).join('');
}

function renderMatrixHeader() {
    const thead = document.querySelector("#matrix-table thead");
    const colgroup = document.getElementById("matrix-colgroup");
    const visibleTypes = getVisiblePageTypes();
    const headerCols = visibleTypes.map(pt => {
        const label = getPageLabel(pt);
        const abbrev = getPageAbbrev(pt);
        const isCustom = !DEFAULT_PAGE_TYPES.has(pt);
        const deleteBtn = isCustom ? `<button class="col-delete-btn" onclick="event.stopPropagation(); deleteCustomPageType('${pt}')" title="Delete">&times;</button>` : '';
        return `<th class="col-type${isCustom ? ' col-type-custom' : ''}" data-type="${pt}" onclick="toggleColumn('${pt}')" title="${escapeHtml(label)}">${escapeHtml(abbrev)}${deleteBtn}</th>`;
    }).join('');

    // Build colgroup: left 50% fixed, right 50% split evenly among type cols + actions
    const typeCols = visibleTypes.map(() => `<col class="col-type">`).join('');
    colgroup.innerHTML = `
        <col class="col-select">
        <col class="col-signer-type">
        <col class="col-name">
        <col class="col-entity">
        <col class="col-title">
        ${typeCols}
        <col class="col-actions">
    `;

    thead.innerHTML = `<tr>
        <th class="col-select"><input type="checkbox" id="select-all-cb" title="Select all" onchange="toggleSelectAll(this.checked)"></th>
        <th class="col-signer-type"></th>
        <th class="col-name">Signer</th>
        <th class="col-entity">Entity</th>
        <th class="col-title">Title</th>
        ${headerCols}
        <th class="col-actions"></th>
    </tr>`;
}

let _promptModalResolve = null;

function showPromptModal(title) {
    document.getElementById('prompt-modal-title').textContent = title;
    const input = document.getElementById('prompt-modal-input');
    input.value = '';
    document.getElementById('prompt-modal-overlay').classList.add('open');
    setTimeout(() => input.focus(), 50);

    return new Promise(resolve => {
        _promptModalResolve = resolve;
    });
}

function resolvePromptModal(value) {
    document.getElementById('prompt-modal-overlay').classList.remove('open');
    if (_promptModalResolve) _promptModalResolve(value ? value.trim() : null);
    _promptModalResolve = null;
}

// Allow Enter to submit the prompt modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && _promptModalResolve && document.getElementById('prompt-modal-overlay').classList.contains('open')) {
        e.preventDefault();
        resolvePromptModal(document.getElementById('prompt-modal-input').value);
    }

    // Cmd/Ctrl+B for bold in contenteditable and richtext-input fields
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        const el = document.activeElement;
        if (el && (el.getAttribute('contenteditable') === 'true' || el.classList.contains('richtext-input'))) {
            e.preventDefault();
            document.execCommand('bold', false, null);
        }
    }
});

async function addCustomPageType() {
    const displayName = await showPromptModal('Enter Signature Page Name');
    if (!displayName) return;

    try {
        const resp = await fetch("/api/templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ display_name: displayName.trim() }),
        });

        if (!resp.ok) {
            const err = await resp.json();
            alert(err.error || "Failed to create page type");
            return;
        }

        const newConfig = await resp.json();
        _addNewPageType(newConfig);
    } catch (e) {
        alert("Error creating page type: " + e.message);
    }
}

async function addPageTypeFromDocx(file) {
    if (!file) return;
    document.getElementById('docx-page-type-input').value = '';

    const formData = new FormData();
    formData.append("file", file);

    try {
        const resp = await fetch("/api/templates/from-docx", {
            method: "POST",
            body: formData,
        });

        if (!resp.ok) {
            const err = await resp.json();
            alert(err.error || "Failed to create page type from document");
            return;
        }

        const newConfig = await resp.json();
        _addNewPageType(newConfig);
    } catch (e) {
        alert("Error creating page type: " + e.message);
    }
}

function _addNewPageType(newConfig) {
    templateConfigs[newConfig.page_type] = newConfig;
    PAGE_TYPES.push(newConfig.page_type);
    rebuildPreviewRenderers();

    renderMatrixHeader();
    fetchSignatureLog();

    if (!drawerOpen) toggleSettingsDrawer();
    initTemplateEditor();
    selectTemplateTab(newConfig.page_type);
}

function buildSignatureRowHtml(s, i) {
    const visibleTypes = getVisiblePageTypes();
    const typeCells = visibleTypes.map(t =>
        `<td class="col-type matrix-cell" data-type="${t}" data-row="${i}" onclick="toggleMatrixCell(this)"><input type="checkbox" class="matrix-cb" data-type="${t}" data-row="${i}" hidden><svg class="check-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg></td>`
    ).join("");

    const typeIcon = s.signer_type === 'individual'
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 7V5a4 4 0 0 0-8 0v2"/></svg>';

    return `
    <tr data-sig-index="${i}">
        <td class="col-select"><input type="checkbox" class="sig-row-cb" data-sig-index="${i}"></td>
        <td class="col-signer-type"><span class="signer-type-badge ${s.signer_type === 'individual' ? 'individual' : 'entity'}" title="${s.signer_type === 'individual' ? 'Individual' : 'Entity'}">${typeIcon}</span></td>
        <td class="col-name" onclick="toggleRow(${i})" title="Click to toggle all"><strong>${escapeHtml(s.signer_name)}</strong></td>
        <td class="col-entity">${escapeHtml(s.signing_entity)}</td>
        <td class="col-title">${escapeHtml(s.title)}</td>
        ${typeCells}
        <td class="col-actions">
            <button class="btn btn-outline btn-sm btn-edit-row" onclick="toggleEditRow(${i})">Edit</button>
            <button class="btn btn-outline btn-sm btn-delete-row" onclick="submitDeleteSignature(${i})">Delete</button>
        </td>
    </tr>
    ${buildEditRowHtml(s, i, visibleTypes)}`;
}

function buildEditRowHtml(s, i, visibleTypes) {
    const isIndividual = s.signer_type === 'individual';
    const hideEntity = isIndividual ? 'style="display:none"' : '';

    function addlEntityField(idx, fieldKey, label, valueKey) {
        const val = s[valueKey] || '';
        const pairKey1 = `additional_signing_entity${idx === 0 ? '' : '_' + (idx + 1)}`;
        const pairKey2 = `additional_signing_entity_title${idx === 0 ? '' : '_' + (idx + 1)}`;
        const hidden = isIndividual || (!s[pairKey1] && !s[pairKey2]) ? 'style="display:none"' : '';
        return `<div class="edit-field edit-addl-entity entity-only" data-addl-idx="${idx}" ${hidden}>
            <label>${label}</label>
            <input type="text" class="edit-input" data-sig="${i}" data-field="${fieldKey}" value="${escapeAttr(val)}">
        </div>`;
    }

    return `<tr class="edit-row" id="edit-row-${i}" style="display:none;">
        <td colspan="${visibleTypes.length + 6}">
            <div class="edit-panel">
                <div class="edit-grid">
                    <div class="edit-field">
                        <label>Signer Type</label>
                        <select class="edit-input" data-sig="${i}" data-field="signer_type" onchange="toggleEntityFields(this)">
                            <option value="entity" ${(s.signer_type || 'entity') === 'entity' ? 'selected' : ''}>Entity</option>
                            <option value="individual" ${isIndividual ? 'selected' : ''}>Individual</option>
                        </select>
                    </div>
                    <div class="edit-field">
                        <label>Signer Name</label>
                        <input type="text" class="edit-input" data-sig="${i}" data-field="signer_name" value="${escapeAttr(s.signer_name)}">
                    </div>
                    <div class="edit-field entity-only" ${hideEntity}>
                        <label>Signing Entity</label>
                        <input type="text" class="edit-input" data-sig="${i}" data-field="signing_entity" value="${escapeAttr(s.signing_entity)}">
                    </div>
                    <div class="edit-field entity-only" ${hideEntity}>
                        <label>Title</label>
                        <input type="text" class="edit-input" data-sig="${i}" data-field="title" value="${escapeAttr(s.title)}">
                    </div>
                    ${addlEntityField(0, 'additional_signing_entity', 'Additional Entity 1', 'additional_signing_entity')}
                    ${addlEntityField(0, 'additional_signing_entity_title', 'Entity 1 Role', 'additional_signing_entity_title')}
                    ${addlEntityField(1, 'additional_signing_entity_2', 'Additional Entity 2', 'additional_signing_entity_2')}
                    ${addlEntityField(1, 'additional_signing_entity_title_2', 'Entity 2 Role', 'additional_signing_entity_title_2')}
                    ${addlEntityField(2, 'additional_signing_entity_3', 'Additional Entity 3', 'additional_signing_entity_3')}
                    ${addlEntityField(2, 'additional_signing_entity_title_3', 'Entity 3 Role', 'additional_signing_entity_title_3')}
                    <div class="edit-field entity-only" ${hideEntity}>
                        <button type="button" class="signer-add-entity-btn" onclick="addMatrixAddlEntity(this)">+ Add Entity</button>
                    </div>
                    <div class="edit-field"><label>Email</label><input type="text" class="edit-input" data-sig="${i}" data-field="email" value="${escapeAttr(s.email)}"></div>
                    <div class="edit-field"><label>CC Email</label><input type="text" class="edit-input" data-sig="${i}" data-field="cc_email" value="${escapeAttr(s.cc_email)}"></div>
                    <div class="edit-field"><label>Street Address</label><input type="text" class="edit-input" data-sig="${i}" data-field="address" value="${escapeAttr(s.address)}"></div>
                    <div class="edit-field"><label>City, State ZIP</label><input type="text" class="edit-input" data-sig="${i}" data-field="city_state_zip" value="${escapeAttr(s.city_state_zip)}"></div>
                    <div class="edit-field"><label>Phone</label><input type="text" class="edit-input" data-sig="${i}" data-field="phone" value="${escapeAttr(s.phone)}"></div>
                </div>
                <div class="edit-actions">
                    <button class="btn btn-primary btn-save-edit" onclick="saveEditRow(${i})">Save</button>
                    <button class="btn btn-outline btn-cancel-edit" onclick="cancelEditRow(${i})">Cancel</button>
                </div>
                <div class="edit-overrides">
                    <button class="btn btn-outline btn-toggle-overrides" onclick="toggleOverrides(${i})">Field Overrides</button>
                    <div class="overrides-panel" id="overrides-panel-${i}" style="display:none;">
                        ${renderFieldOverridesHtml(s, i)}
                    </div>
                </div>
            </div>
        </td>
    </tr>`;
}

function captureCheckStates() {
    const states = {};
    document.querySelectorAll("#matrix-tbody input.matrix-cb:checked").forEach(cb => {
        const row = cb.dataset.row;
        const type = cb.dataset.type;
        if (!states[row]) states[row] = [];
        states[row].push(type);
    });
    return states;
}

function restoreCheckStates(checkStates, tbody) {
    for (const [row, types] of Object.entries(checkStates)) {
        types.forEach(type => {
            const cb = tbody.querySelector(`input.matrix-cb[data-row="${row}"][data-type="${type}"]`);
            if (cb) {
                cb.checked = true;
                const cell = cb.closest('.matrix-cell');
                if (cell) cell.classList.add('checked');
            }
        });
    }
}

async function fetchSignatureLog() {
    try {
        const resp = await fetch("/signatures");
        const data = await resp.json();
        const tbody = document.getElementById("matrix-tbody");

        if (!data.signatures || data.signatures.length === 0) {
            savedSignatures = [];
            tbody.innerHTML = `<tr><td colspan="${getVisiblePageTypes().length + 6}" class="empty-row">
                <div class="empty-state">
                    <svg class="empty-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                    <span>No signatories yet</span>
                    <button class="btn btn-primary empty-cta" onclick="document.getElementById('signer-name').focus()">Add your first signatory</button>
                </div>
            </td></tr>`;
            updateDeleteSelectedButton();
            return;
        }

        const checkStates = captureCheckStates();
        savedSignatures = data.signatures;
        tbody.innerHTML = data.signatures.map((s, i) => buildSignatureRowHtml(s, i)).join("");
        restoreCheckStates(checkStates, tbody);
        updateAllToggleStates();
        renderPreview();
        updateDeleteSelectedButton();
    } catch (e) {
        console.error("Failed to load signatures:", e);
    }
}

async function downloadSignaturesExcel() {
    const selections = getMatrixSelections();
    const matrixSelections = {};
    selections.forEach(({ sigIndex, checkedTypes }) => {
        matrixSelections[sigIndex] = checkedTypes;
    });

    const docColumns = PAGE_TYPES.map(pt => ({ key: pt, label: getPageLabel(pt) }));

    try {
        const resp = await fetch("/signatures/download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ matrix_selections: matrixSelections, doc_columns: docColumns }),
        });
        if (!resp.ok) {
            alert("Failed to download");
            return;
        }
        const blob = await resp.blob();
        downloadBlobAsFile(blob, "signatures.xlsx");
    } catch (e) {
        alert("Error downloading: " + e.message);
    }
}

async function uploadSignaturesExcel(input) {
    const file = input.files[0];
    if (!file) return;
    input.value = "";  // reset so same file can be re-uploaded

    const formData = new FormData();
    formData.append("file", file);

    try {
        const resp = await fetch("/signatures/upload", {
            method: "POST",
            body: formData,
        });
        const data = await resp.json();
        if (!resp.ok) {
            alert(data.error || "Upload failed");
            return;
        }

        // Apply document assignments by checking the right matrix checkboxes
        const assignments = data.doc_assignments || {};
        // Build a reverse map: display label -> page type key
        const labelToKey = {};
        PAGE_TYPES.forEach(pt => { labelToKey[getPageLabel(pt)] = pt; });

        // Auto-create page types for unknown labels in the Excel
        const allLabels = new Set();
        for (const labels of Object.values(assignments)) {
            for (const label of labels) allLabels.add(label);
        }
        let needsReload = false;
        for (const label of allLabels) {
            if (!labelToKey[label]) {
                // Unknown label — create a new custom page type
                try {
                    const createResp = await fetch("/api/templates", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ display_name: label }),
                    });
                    if (createResp.ok) {
                        const newCfg = await createResp.json();
                        templateConfigs[newCfg.page_type] = newCfg;
                        PAGE_TYPES.push(newCfg.page_type);
                        labelToKey[label] = newCfg.page_type;
                        needsReload = true;
                    }
                } catch (_) { /* skip if creation fails */ }
            }
        }
        if (needsReload) {
            rebuildPreviewRenderers();
            renderMatrixHeader();
        }

        // Reload the signature list to populate the matrix rows
        await fetchSignatureLog();

        for (const [rowIdx, labels] of Object.entries(assignments)) {
            for (const label of labels) {
                const key = labelToKey[label] || label;
                const cb = document.querySelector(`input.matrix-cb[data-row="${rowIdx}"][data-type="${key}"]`);
                if (cb) {
                    cb.checked = true;
                    const cell = cb.closest('.matrix-cell');
                    if (cell) cell.classList.add('checked');
                }
            }
        }

        updateAllToggleStates();
        renderPreview();
    } catch (e) {
        alert("Error uploading: " + e.message);
    }
}

function filterMatrixRows(query) {
    const q = query.toLowerCase().trim();
    const rows = document.querySelectorAll('#matrix-tbody tr[data-sig-index]');
    rows.forEach(row => {
        const name = row.querySelector('.col-name')?.textContent?.toLowerCase() || '';
        const entity = row.querySelector('.col-entity')?.textContent?.toLowerCase() || '';
        const match = !q || name.includes(q) || entity.includes(q);
        row.style.display = match ? '' : 'none';
        const editRow = row.nextElementSibling;
        if (editRow?.classList.contains('edit-row') && !match) {
            editRow.style.display = 'none';
        }
    });
    updateDeleteSelectedButton();
}

async function submitDeleteSignature(index) {
    if (!confirm("Delete this signature entry?")) return;
    try {
        const resp = await fetch(`/signatures/${index}`, { method: "DELETE" });
        if (resp.ok) {
            fetchSignatureLog();
        } else {
            const err = await resp.json();
            alert(err.error || "Failed to delete");
        }
    } catch (e) {
        alert("Error deleting: " + e.message);
    }
}

// -- Row editing --

function toggleEntityFields(select) {
    const panel = select.closest('.edit-panel');
    const isIndividual = select.value === 'individual';
    panel.querySelectorAll('.entity-only').forEach(el => {
        el.style.display = isIndividual ? 'none' : '';
    });
    // Re-hide empty additional entity slots
    if (!isIndividual) {
        panel.querySelectorAll('.edit-addl-entity').forEach(el => {
            const input = el.querySelector('input');
            if (input && !input.value.trim()) {
                // Check if the paired field also empty
                const idx = el.dataset.addlIdx;
                const siblings = panel.querySelectorAll(`.edit-addl-entity[data-addl-idx="${idx}"]`);
                const anyFilled = [...siblings].some(s => { const inp = s.querySelector('input'); return inp && inp.value.trim(); });
                if (!anyFilled) el.style.display = 'none';
            }
        });
    }
}

function addMatrixAddlEntity(btn) {
    const panel = btn.closest('.edit-panel');
    // Find the first hidden additional entity slot pair
    for (let idx = 0; idx < 3; idx++) {
        const slots = panel.querySelectorAll(`.edit-addl-entity[data-addl-idx="${idx}"]`);
        if (slots.length && slots[0].style.display === 'none') {
            slots.forEach(s => s.style.display = '');
            slots[0].querySelector('input')?.focus();
            // Hide button if all 3 visible
            const allVisible = [0,1,2].every(i => {
                const s = panel.querySelectorAll(`.edit-addl-entity[data-addl-idx="${i}"]`);
                return s.length && s[0].style.display !== 'none';
            });
            if (allVisible) btn.closest('.edit-field').style.display = 'none';
            return;
        }
    }
}

function toggleEditRow(index) {
    const row = document.getElementById(`edit-row-${index}`);
    if (!row) return;
    const isOpen = row.style.display !== "none";
    // Close all other open edit rows
    document.querySelectorAll(".edit-row").forEach(r => r.style.display = "none");
    document.querySelectorAll(".btn-edit-row").forEach(b => b.textContent = "Edit");
    if (!isOpen) {
        row.style.display = "";
        const btn = document.querySelector(`tr[data-sig-index="${index}"] .btn-edit-row`);
        if (btn) btn.textContent = "Close";
    }
}

async function saveEditRow(index) {
    const row = document.getElementById(`edit-row-${index}`);
    if (!row) return;

    const fields = {};
    row.querySelectorAll(".edit-input").forEach(input => {
        const field = input.dataset.field;
        fields[field] = input.value.trim();
    });

    try {
        const resp = await fetch(`/signatures/${index}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields }),
        });
        if (resp.ok) {
            fetchSignatureLog();
        }
    } catch (e) {
        alert("Error saving: " + e.message);
    }
}

function cancelEditRow(index) {
    const row = document.getElementById(`edit-row-${index}`);
    if (row) row.style.display = "none";
    const btn = document.querySelector(`tr[data-sig-index="${index}"] .btn-edit-row`);
    if (btn) btn.textContent = "Edit";
}

// -- Drag-to-reorder matrix rows --

function initMatrixDragDrop() {
    const tbody = document.getElementById("matrix-tbody");
    let draggedRow = null;

    tbody.addEventListener("dragstart", (e) => {
        const handle = e.target.closest(".drag-handle");
        if (!handle) { e.preventDefault(); return; }
        draggedRow = handle.closest("tr[data-sig-index]");
        if (!draggedRow) { e.preventDefault(); return; }
        draggedRow.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
    });

    tbody.addEventListener("dragover", (e) => {
        e.preventDefault();
        const targetRow = e.target.closest("tr[data-sig-index]");
        if (!targetRow || targetRow === draggedRow) return;
        targetRow.classList.add("drag-over-row");
    });

    tbody.addEventListener("dragleave", (e) => {
        const targetRow = e.target.closest("tr[data-sig-index]");
        if (targetRow) targetRow.classList.remove("drag-over-row");
    });

    tbody.addEventListener("drop", (e) => {
        e.preventDefault();
        document.querySelectorAll(".drag-over-row").forEach(r => r.classList.remove("drag-over-row"));
        if (!draggedRow) return;
        const targetRow = e.target.closest("tr[data-sig-index]");
        if (!targetRow || targetRow === draggedRow) return;

        const fromIdx = parseInt(draggedRow.dataset.sigIndex);
        const toIdx = parseInt(targetRow.dataset.sigIndex);

        // Reorder savedSignatures
        const [moved] = savedSignatures.splice(fromIdx, 1);
        savedSignatures.splice(toIdx, 0, moved);

        // Re-render
        fetchSignatureLog();
    });

    tbody.addEventListener("dragend", () => {
        if (draggedRow) draggedRow.classList.remove("dragging");
        draggedRow = null;
        document.querySelectorAll(".drag-over-row").forEach(r => r.classList.remove("drag-over-row"));
    });
}

// -- Per-signatory field overrides --

function toggleOverrides(index) {
    const panel = document.getElementById(`overrides-panel-${index}`);
    if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
}

function setFieldOverride(sigIndex, pageType, fieldId, enabled) {
    const sig = savedSignatures[sigIndex];
    if (!sig) return;
    pushUndo(sigIndex, pageType);
    const ov = _ensureOverrides(sig, pageType, fieldId);
    ov.enabled = enabled;

    _saveFieldOverrides(sigIndex, pageType);
    debouncePreview();
}
