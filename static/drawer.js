/**
 * Settings Drawer — template editor, section builders, auto-save,
 * signer info editing, template CRUD, related documents
 */

// -- Template Editor --

function toggleSettingsDrawer() {
    drawerOpen = !drawerOpen;
    document.getElementById('settings-drawer').classList.toggle('open', drawerOpen);
    document.getElementById('drawer-toggle-btn').classList.toggle('active', drawerOpen);
    // Ensure preview container is visible when opening drawer
    if (drawerOpen) {
        const container = document.getElementById('preview-container');
        if (container.classList.contains('collapsed')) {
            togglePreview();
        }
        if (!activeTemplateType) {
            initTemplateEditor();
        }
    }
}

function setDrawerScope(scope) {
    if (scope === 'selected' && !editingPageKey) return;
    drawerScope = scope;
    // Clear field multi-selection when switching scope
    selectedFieldIds.clear();
    document.querySelectorAll('.scope-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.scope === scope);
    });
    // Re-render form to reflect the right field states for this scope
    if (activeTemplateType) renderTemplateForm(activeTemplateType);
}

// Called after renderPreview to keep the scope toggle in sync with edit mode
function updateDrawerScopeUI() {
    const selectedBtn = document.querySelector('.scope-btn[data-scope="selected"]');
    if (!selectedBtn) return;

    if (editingPageKey) {
        selectedBtn.disabled = false;
        const sigIdx = parseInt(editingPageKey.split('-')[0]);
        const sig = savedSignatures[sigIdx];
        const name = sig ? (sig.signer_name || `Signer ${sigIdx + 1}`) : "This Signer's Page";
        selectedBtn.textContent = name;
    } else {
        selectedBtn.disabled = true;
        selectedBtn.textContent = "This Signer's Page";
        // Fall back to 'all' if we lost the selection
        if (drawerScope === 'selected') {
            drawerScope = 'all';
            document.querySelectorAll('.scope-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.scope === 'all');
            });
            if (activeTemplateType) renderTemplateForm(activeTemplateType);
        }
    }
}

function initTemplateEditor() {
    const selectEl = document.getElementById('drawer-tab-select');
    selectEl.innerHTML = PAGE_TYPES.map(pt => {
        const cfg = templateConfigs[pt] || {};
        const label = cfg.display_name || pt;
        return `<option value="${pt}">${escapeHtml(label)}</option>`;
    }).join('');
    selectTemplateTab(PAGE_TYPES[0]);
}

function selectTemplateTab(pageType) {
    activeTemplateType = pageType;
    const selectEl = document.getElementById('drawer-tab-select');
    if (selectEl) selectEl.value = pageType;
    // Update the "All" scope button to show the current template name
    const allBtn = document.querySelector('.scope-btn[data-scope="all"]');
    if (allBtn) {
        const cfg = templateConfigs[pageType];
        const name = (cfg && cfg.display_name) || pageType;
        allBtn.textContent = `All ${name}`;
    }
    renderTemplateForm(pageType);
}

function getMergedFields(pageType) {
    const cfg = templateConfigs[pageType];
    const fields = (cfg && cfg.fields) || [];
    if (drawerScope === 'selected' && editingPageKey) {
        const sigIdx = parseInt(editingPageKey.split('-')[0]);
        const sig = savedSignatures[sigIdx];
        const sigOverrides = sig && sig.field_overrides && sig.field_overrides[pageType];
        if (sigOverrides && sigOverrides.fields) {
            return fields.map(f => {
                const ov = sigOverrides.fields[f.id];
                return ov ? { ...f, ...ov } : { ...f };
            });
        }
    }
    return fields;
}

function getMergedConfigValue(pageType, key) {
    if (drawerScope === 'selected' && editingPageKey) {
        const sigIdx = parseInt(editingPageKey.split('-')[0]);
        const sig = savedSignatures[sigIdx];
        const ov = sig && sig.field_overrides && sig.field_overrides[pageType] && sig.field_overrides[pageType].config;
        if (ov && key in ov) return ov[key];
    }
    const cfg = templateConfigs[pageType];
    return cfg ? cfg[key] : undefined;
}

function _drawerInfoField(label, fieldId, inputHtml, extraClass, mergedFields, sigIdx) {
    const toggleId = _fieldIdForInfoField(fieldId);
    let toggleHtml = '';
    let isOn = true;
    if (toggleId) {
        const mf = mergedFields.find(f => f.id === toggleId);
        isOn = mf ? mf.enabled !== false : true;
        toggleHtml = `<input type="checkbox" class="info-field-cb" data-field-id="${toggleId}" data-sig="${sigIdx}" ${isOn ? 'checked' : ''} onchange="onInfoFieldToggle(this)">`;
    }
    const disabledClass = !isOn ? ' field-disabled' : '';
    return `<div class="signer-info-field${disabledClass}${extraClass ? ' ' + extraClass : ''}">
        <div class="info-field-header">
            ${toggleHtml}
            <label>${label}</label>
        </div>
        ${inputHtml}
    </div>`;
}

function buildSignerInfoSection(sig, sigIdx, mergedFields) {
    const isEntity = (sig.signer_type || 'entity') === 'entity';

    const addlEntities = [
        { name: sig.additional_signing_entity || '', role: sig.additional_signing_entity_title || '', nameField: 'additional_signing_entity', roleField: 'additional_signing_entity_title' },
        { name: sig.additional_signing_entity_2 || '', role: sig.additional_signing_entity_title_2 || '', nameField: 'additional_signing_entity_2', roleField: 'additional_signing_entity_title_2' },
        { name: sig.additional_signing_entity_3 || '', role: sig.additional_signing_entity_title_3 || '', nameField: 'additional_signing_entity_3', roleField: 'additional_signing_entity_title_3' },
    ];
    const canAddMore = addlEntities.filter(a => a.name || a.role).length < 3;

    const addlHtml = addlEntities.map((a, idx) => {
        const hasFill = !!(a.name || a.role);
        const hidden = !hasFill ? 'style="display:none"' : '';
        return `<div class="signer-addl-entity drawer-entity-only" data-addl-idx="${idx}" ${!isEntity ? 'style="display:none"' : hidden}>
            <div class="signer-addl-entity-row">
                <div class="signer-info-field">
                    <label>Additional Entity ${idx + 1}</label>
                    <input type="text" class="drawer-info-input" data-sig="${sigIdx}" data-field="${a.nameField}" value="${escapeAttr(a.name)}">
                </div>
                <div class="signer-info-field">
                    <label>Role</label>
                    <input type="text" class="drawer-info-input" data-sig="${sigIdx}" data-field="${a.roleField}" value="${escapeAttr(a.role)}">
                </div>
                <button class="signer-addl-remove" onclick="removeDrawerAddlEntity(this, ${idx})" title="Remove">&times;</button>
            </div>
        </div>`;
    }).join('');

    const inf = (label, fieldId, inputHtml, extraClass) => _drawerInfoField(label, fieldId, inputHtml, extraClass, mergedFields, sigIdx);

    return `<div class="drawer-signer-info">
        <div class="signer-info-grid">
            <div class="signer-info-field">
                <label>Signer Type</label>
                <select class="drawer-info-input" data-sig="${sigIdx}" data-field="signer_type" onchange="onDrawerSignerTypeChange(this)">
                    <option value="entity" ${isEntity ? 'selected' : ''}>Entity</option>
                    <option value="individual" ${!isEntity ? 'selected' : ''}>Individual</option>
                </select>
            </div>
            ${inf('Signer Name', 'signer_name',
                `<input type="text" class="drawer-info-input" data-sig="${sigIdx}" data-field="signer_name" value="${escapeAttr(sig.signer_name)}">`)}
            ${inf('Signing Entity', 'signing_entity',
                `<input type="text" class="drawer-info-input" data-sig="${sigIdx}" data-field="signing_entity" value="${escapeAttr(sig.signing_entity)}">`,
                `drawer-entity-only${!isEntity ? '" style="display:none' : ''}`)}
            ${inf('Title', 'title',
                `<input type="text" class="drawer-info-input" data-sig="${sigIdx}" data-field="title" value="${escapeAttr(sig.title)}">`,
                `drawer-entity-only${!isEntity ? '" style="display:none' : ''}`)}
        </div>
        ${addlHtml}
        <div class="drawer-entity-only" ${!isEntity ? 'style="display:none"' : ''}>
            <div class="signer-addl-controls">
                <button class="signer-add-entity-btn" id="add-addl-entity-btn" onclick="addDrawerAddlEntity(${sigIdx})" ${!canAddMore ? 'style="display:none"' : ''}>+ Add Entity</button>
                <label class="config-option-toggle" onclick="toggleConfigOption(this)">
                    <span class="config-toggle-track${getMergedConfigValue(activeTemplateType, 'separate_its_line') ? ' on' : ''}">
                        <span class="config-toggle-thumb"></span>
                    </span>
                    <input type="checkbox" data-config-toggle="separate_its_line" ${getMergedConfigValue(activeTemplateType, 'separate_its_line') ? 'checked' : ''} style="display:none">
                    Separate "By:" and "Its:" on two lines
                </label>
            </div>
        </div>
        <div class="signer-config-toggles" style="margin-top:4px">
            <label class="config-option-toggle" onclick="toggleConfigOption(this)">
                <span class="config-toggle-track${getMergedConfigValue(activeTemplateType, 'show_by_prefix_individual') ? ' on' : ''}">
                    <span class="config-toggle-thumb"></span>
                </span>
                <input type="checkbox" data-config-toggle="show_by_prefix_individual" ${getMergedConfigValue(activeTemplateType, 'show_by_prefix_individual') ? 'checked' : ''} style="display:none">
                Show "By:" prefix for individual signers
            </label>
        </div>
        <div class="signer-info-grid" style="margin-top:4px">
            ${inf('Email', 'email',
                `<input type="text" class="drawer-info-input" data-sig="${sigIdx}" data-field="email" value="${escapeAttr(sig.email)}">`)}
            ${inf('CC Email', 'cc_email',
                `<input type="text" class="drawer-info-input" data-sig="${sigIdx}" data-field="cc_email" value="${escapeAttr(sig.cc_email)}">`)}
            ${inf('Address', 'address',
                `<input type="text" class="drawer-info-input" data-sig="${sigIdx}" data-field="address" value="${escapeAttr(sig.address)}" placeholder="Street Address">
                 <input type="text" class="drawer-info-input" data-sig="${sigIdx}" data-field="city_state_zip" value="${escapeAttr(sig.city_state_zip)}" placeholder="City, State ZIP" style="margin-top:4px">`)}
            ${inf('Phone', 'phone',
                `<input type="text" class="drawer-info-input" data-sig="${sigIdx}" data-field="phone" value="${escapeAttr(sig.phone)}">`)}
        </div>
    </div>
    <div class="drawer-divider"></div>`;
}

function buildEditableFieldsSection(cfg, mergedFields) {
    let html = '';
    const witnessField = mergedFields.find(f => f.id === 'witness_clause');
    const consentField = mergedFields.find(f => f.id === 'consent_text');
    const sectionHeaderField = mergedFields.find(f => f.id === 'section_header');

    if (witnessField) {
        const en = witnessField.enabled !== false;
        html += `<div class="template-editable-field">
            <label class="template-field-toggle editable-field-label">
                <input type="checkbox" data-field-id="witness_clause" ${en ? 'checked' : ''}> Execution / Witness Clause
            </label>
            <div id="tpl-witness-clause" class="editable-field-input richtext-input${!en ? ' disabled-input' : ''}" contenteditable="${en ? 'true' : 'false'}">${sanitizeRichText(getMergedConfigValue(activeTemplateType, 'witness_clause_text') || '')}</div>
        </div>`;
    }
    if (consentField) {
        const en = consentField.enabled !== false;
        html += `<div class="template-editable-field">
            <label class="template-field-toggle editable-field-label">
                <input type="checkbox" data-field-id="consent_text" ${en ? 'checked' : ''}> Consent Action Language
            </label>
            <div id="tpl-consent-text" class="editable-field-input richtext-input${!en ? ' disabled-input' : ''}" contenteditable="${en ? 'true' : 'false'}">${sanitizeRichText(getMergedConfigValue(activeTemplateType, 'consent_text') || '')}</div>
        </div>`;
    }
    if (sectionHeaderField) {
        const en = sectionHeaderField.enabled !== false;
        html += `<div class="template-editable-field">
            <label class="template-field-toggle editable-field-label">
                <input type="checkbox" data-field-id="section_header" ${en ? 'checked' : ''}> Signer Role Label
            </label>
            <div id="tpl-signer-header" class="editable-field-input richtext-input${!en ? ' disabled-input' : ''}" contenteditable="${en ? 'true' : 'false'}" data-placeholder="e.g., STOCKHOLDER, DIRECTOR">${sanitizeRichText(getMergedConfigValue(activeTemplateType, 'section_header_label') || getMergedConfigValue(activeTemplateType, 'entity_header_label') || '')}</div>
        </div>`;
    }
    const footerEnabled = getMergedConfigValue(activeTemplateType, 'footer_enabled') !== false;
    const footerText = getMergedConfigValue(activeTemplateType, 'footer_template') || cfg.footer_template || '';
    html += `<div class="template-editable-field">
        <label class="template-field-toggle editable-field-label">
            <input type="checkbox" data-editable-toggle="footer" ${footerEnabled ? 'checked' : ''}> Page Footer Text
        </label>
        <div id="tpl-footer" class="editable-field-input richtext-input${!footerEnabled ? ' disabled-input' : ''}" contenteditable="${footerEnabled ? 'true' : 'false'}">${sanitizeRichText(footerText)}</div>
    </div>`;
    return html;
}

function buildFieldGroupsSection(mergedFields, isSelectedScope) {
    const EDITABLE_FIELD_IDS = new Set(['section_header', 'witness_clause', 'consent_text']);
    const HIDDEN_FIELD_IDS = new Set(['city_state_zip']);
    // Sub-entity fields are grouped under a single "Sub-Entities" toggle
    const SUB_ENTITY_IDS = new Set(['additional_signing_entity', 'additional_signing_entity_2', 'additional_signing_entity_3']);

    const groups = [
        { label: 'Page Structure', ids: new Set(['company_header', 'date_line', 'salutation', 'accepted_and_agreed']) },
        { label: 'Signing Entity Details', ids: new Set(['entity_name', 'additional_signing_entity', 'additional_signing_entity_2', 'additional_signing_entity_3']), extraToggles: ['separate_its_line'], condense: { ids: SUB_ENTITY_IDS, label: 'Intermediary Entities' } },
        { label: 'Signer Information', ids: new Set(['by_line', 'signer_name', 'title']), extraToggles: ['show_by_prefix_individual'] },
        { label: 'Contact Details', ids: new Set(['email', 'phone', 'cc_email', 'address', 'city_state_zip']) },
    ];

    const grouped = new Set([...EDITABLE_FIELD_IDS, ...HIDDEN_FIELD_IDS]);
    if (isSelectedScope) {
        ['signer_name', 'entity_name', 'title', 'email', 'cc_email', 'address', 'city_state_zip', 'phone',
         'by_line', 'additional_signing_entity', 'additional_signing_entity_2', 'additional_signing_entity_3'].forEach(id => grouped.add(id));
    }

    let html = '';
    for (const g of groups) {
        const items = mergedFields.filter(f => g.ids.has(f.id) && !grouped.has(f.id));
        if (items.length === 0) continue;
        items.forEach(f => grouped.add(f.id));
        let extraHtml = '';
        if (g.extraToggles) {
            const CONFIG_TOGGLE_LABELS = {
                separate_its_line: 'Separate "By:" and "Its:" on two lines',
                show_by_prefix_individual: 'Show "By:" prefix for individual signers',
            };
            extraHtml = g.extraToggles.map(key => {
                const checked = getMergedConfigValue(activeTemplateType, key) ? 'checked' : '';
                const label = CONFIG_TOGGLE_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                return `<label class="config-option-toggle" onclick="toggleConfigOption(this)">
                    <span class="config-toggle-track${checked ? ' on' : ''}">
                        <span class="config-toggle-thumb"></span>
                    </span>
                    <input type="checkbox" data-config-toggle="${key}" ${checked} style="display:none">
                    ${label}
                </label>`;
            }).join('');
        }

        // Condense sub-entity fields into a single toggle
        let displayItems = items;
        if (g.condense) {
            const condensedIds = g.condense.ids;
            const condensedFields = items.filter(f => condensedIds.has(f.id));
            const otherFields = items.filter(f => !condensedIds.has(f.id));
            if (condensedFields.length > 0) {
                const allEnabled = condensedFields.every(f => f.enabled !== false);
                displayItems = [
                    ...otherFields,
                    { id: '_condensed_sub_entities', label: g.condense.label, enabled: allEnabled, _condensedIds: condensedFields.map(f => f.id) },
                ];
            } else {
                displayItems = otherFields;
            }
        }

        html += `<div class="field-group">
            <span class="field-group-label">${g.label}</span>
            <div class="template-field-toggles">
                ${displayItems.map(f => {
                    if (f._condensedIds) {
                        // Render a single toggle that controls multiple fields
                        return `<label class="template-field-toggle">
                            <input type="checkbox" data-condensed-fields="${f._condensedIds.join(',')}" ${f.enabled ? 'checked' : ''}>
                            ${escapeHtml(f.label)}
                        </label>`;
                    }
                    return `<label class="template-field-toggle">
                        <input type="checkbox" data-field-id="${f.id}" ${f.enabled !== false ? 'checked' : ''}>
                        ${escapeHtml(f.label)}
                    </label>`;
                }).join('')}
            </div>
            ${extraHtml}
        </div>`;
    }
    const ungrouped = mergedFields.filter(f => !grouped.has(f.id));
    if (ungrouped.length > 0) {
        html += `<div class="field-group">
            <span class="field-group-label">Other</span>
            <div class="template-field-toggles">
                ${ungrouped.map(f => `<label class="template-field-toggle">
                    <input type="checkbox" data-field-id="${f.id}" ${f.enabled !== false ? 'checked' : ''}>
                    ${escapeHtml(f.label)}
                </label>`).join('')}
            </div>
        </div>`;
    }
    return html;
}

function toggleConfigOption(label) {
    const cb = label.querySelector('input[data-config-toggle]');
    if (!cb) return;
    cb.checked = !cb.checked;
    const track = label.querySelector('.config-toggle-track');
    if (track) track.classList.toggle('on', cb.checked);
    const key = cb.dataset.configToggle;
    const pt = activeTemplateType;
    if (drawerScope === 'selected' && editingPageKey) {
        const sigIdx = parseInt(editingPageKey.split('-')[0]);
        const sig = savedSignatures[sigIdx];
        if (sig) {
            const cfgOv = _ensureConfigOverride(sig, pt);
            cfgOv[key] = cb.checked;
        }
    } else {
        const cfg = templateConfigs[pt];
        if (cfg) cfg[key] = cb.checked;
    }
    onTemplateFieldChange();
}

function buildRelatedDocsSection(pageType, related) {
    const otherTypes = PAGE_TYPES.filter(pt => pt !== pageType);
    // Show as checked if either direction: this doc lists them OR they list this doc
    const allLinked = new Set(related);
    for (const pt of otherTypes) {
        const ptCfg = templateConfigs[pt];
        if (ptCfg && ptCfg.related_documents && ptCfg.related_documents.includes(pageType)) {
            allLinked.add(pt);
        }
    }
    const relatedCount = allLinked.size;
    return `<div class="drawer-toggle-section" onclick="this.classList.toggle('open')">
        <span class="drawer-section-label" style="margin:0;cursor:pointer">Linked Document Types${relatedCount ? ` (${relatedCount})` : ''}</span>
        <svg class="drawer-toggle-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
    </div>
    <div class="drawer-toggle-body">
        <div class="template-related-docs">
            ${otherTypes.map(pt => {
                const ptCfg = templateConfigs[pt] || {};
                const ptLabel = ptCfg.display_name || pt;
                const checked = allLinked.has(pt) ? 'checked' : '';
                return `<label class="template-related-doc">
                    <input type="checkbox" data-related-type="${pt}" ${checked}>
                    ${escapeHtml(ptLabel)}
                </label>`;
            }).join('')}
        </div>
    </div>`;
}

function renderDrawerFooter(pageType) {
    const footerEl = document.getElementById('drawer-footer');
    if (!footerEl) return;
    const isCustom = !DEFAULT_PAGE_TYPES.has(pageType);
    const inSelectedScope = drawerScope === 'selected' && editingPageKey;
    let footerButtons = '';
    if (inSelectedScope) {
        const _si = parseInt(editingPageKey.split('-')[0]);
        footerButtons = `<button class="template-reset-btn" onclick="resetSignatoryOverrides(${_si}, '${pageType}')">Reset to Defaults</button>
               <button class="template-apply-all-btn" onclick="applyThisToAll(${_si}, '${pageType}')">Apply to Global ${escapeHtml((templateConfigs[pageType] || {}).display_name || pageType)} Template</button>`;
    } else if (isCustom) {
        footerButtons = `<button class="template-delete-btn" onclick="deleteCustomPageType('${pageType}')">Delete This Template</button>`;
    } else {
        footerButtons = `<button class="template-reset-btn" onclick="resetTemplateConfig('${pageType}')">Reset to Defaults</button>
               <button class="template-apply-all-btn" onclick="applyToAllSignatories('${pageType}')">Apply to Custom Signers</button>`;
    }
    footerEl.innerHTML = `${footerButtons}
        <span class="drawer-save-indicator" id="drawer-save-indicator"></span>`;
}

function _initDrawerScrollShadow() {
    const body = document.querySelector('.drawer-body');
    const header = document.querySelector('.drawer-header');
    if (!body || !header) return;
    if (body._scrollHandler) body.removeEventListener('scroll', body._scrollHandler);
    body._scrollHandler = () => {
        header.classList.toggle('scrolled', body.scrollTop > 4);
    };
    body.addEventListener('scroll', body._scrollHandler, { passive: true });
}

function renderTemplateForm(pageType) {
    const cfg = templateConfigs[pageType];
    if (!cfg) return;

    const formEl = document.getElementById('template-form');
    const mergedFields = getMergedFields(pageType);
    const isSelectedScope = drawerScope === 'selected' && editingPageKey;

    let html = '';

    // Signer info section (per-signatory scope only)
    if (isSelectedScope) {
        const sigIdx = parseInt(editingPageKey.split('-')[0]);
        const sig = savedSignatures[sigIdx];
        if (sig) html += buildSignerInfoSection(sig, sigIdx, mergedFields);
    }

    // Fields section
    html += `<div class="drawer-section-label">Signature Page Layout${isSelectedScope ? ' <span class="drawer-scope-hint">(Only affects this signer\'s page)</span>' : ''}</div>`;
    html += buildEditableFieldsSection(cfg, mergedFields);
    html += buildFieldGroupsSection(mergedFields, isSelectedScope);

    // Related documents section
    html += buildRelatedDocsSection(pageType, cfg.related_documents || []);

    formEl.innerHTML = html;
    renderDrawerFooter(pageType);
    attachAutoSaveListeners();
    _initDrawerScrollShadow();
    attachDrawerSignerInfoListeners();
}

// -- Auto-save system --

// Named handler so we can remove before re-adding (prevents listener accumulation)
function _onFormChange(e) {
    // When a checkbox inside an editable field is toggled, enable/disable its input
    const cb = e.target;
    if (cb.type === 'checkbox' && cb.closest('.template-editable-field')) {
        const container = cb.closest('.template-editable-field');
        const input = container.querySelector('.editable-field-input');
        if (input) {
            const checked = cb.checked;
            if (input.hasAttribute('contenteditable')) {
                input.setAttribute('contenteditable', checked ? 'true' : 'false');
            } else {
                input.disabled = !checked;
            }
            input.classList.toggle('disabled-input', !checked);
        }
    }
    // When a field toggle checkbox changes, immediately update just that field
    if (cb.type === 'checkbox' && cb.dataset.fieldId) {
        const fieldId = cb.dataset.fieldId;
        const pt = activeTemplateType;
        const cfg = templateConfigs[pt];
        if (drawerScope === 'selected' && editingPageKey) {
            const sigIdx = parseInt(editingPageKey.split('-')[0]);
            const sig = savedSignatures[sigIdx];
            if (sig) {
                const ov = _ensureOverrides(sig, pt, fieldId);
                ov.enabled = cb.checked;
                if (fieldId === 'address') {
                    const czOv = _ensureOverrides(sig, pt, 'city_state_zip');
                    czOv.enabled = cb.checked;
                }
            }
        } else {
            if (cfg && cfg.fields) {
                const field = cfg.fields.find(f => f.id === fieldId);
                if (field) field.enabled = cb.checked;
                if (fieldId === 'address') {
                    const czField = cfg.fields.find(f => f.id === 'city_state_zip');
                    if (czField) czField.enabled = cb.checked;
                }
            }
        }
    }
    // Condensed toggle: controls multiple fields at once (e.g., Sub-Entities)
    if (cb.type === 'checkbox' && cb.dataset.condensedFields) {
        const fieldIds = cb.dataset.condensedFields.split(',');
        const pt = activeTemplateType;
        const cfg = templateConfigs[pt];
        for (const fieldId of fieldIds) {
            if (drawerScope === 'selected' && editingPageKey) {
                const sigIdx = parseInt(editingPageKey.split('-')[0]);
                const sig = savedSignatures[sigIdx];
                if (sig) {
                    const ov = _ensureOverrides(sig, pt, fieldId);
                    ov.enabled = cb.checked;
                }
            } else {
                if (cfg && cfg.fields) {
                    const field = cfg.fields.find(f => f.id === fieldId);
                    if (field) field.enabled = cb.checked;
                }
            }
        }
    }
    onTemplateFieldChange();
}

/**
 * Make linked documents bidirectional: if A links B, ensure B also links A.
 * If A unlinks B, ensure B also unlinks A.
 */
function _syncRelatedDocsBidirectional(sourcePageType) {
    const sourceCfg = templateConfigs[sourcePageType];
    if (!sourceCfg) return;
    const sourceRelated = sourceCfg.related_documents || [];

    for (const [pt, cfg] of Object.entries(templateConfigs)) {
        if (pt === sourcePageType || !cfg) continue;
        if (!cfg.related_documents) cfg.related_documents = [];

        const sourceLinksThis = sourceRelated.includes(pt);
        const thisLinksSource = cfg.related_documents.includes(sourcePageType);

        if (sourceLinksThis && !thisLinksSource) {
            // Source added this doc — add source to this doc's list
            cfg.related_documents.push(sourcePageType);
            fetch(`/api/templates/${pt}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cfg),
            });
        } else if (!sourceLinksThis && thisLinksSource) {
            // Source removed this doc — remove source from this doc's list
            cfg.related_documents = cfg.related_documents.filter(r => r !== sourcePageType);
            fetch(`/api/templates/${pt}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cfg),
            });
        }
    }
}

/**
 * Collect all templates linked to sourcePageType — both directions:
 *   1. Templates that sourcePageType lists as related (forward)
 *   2. Templates that list sourcePageType in THEIR related_documents (reverse)
 * Returns a deduplicated Set of page type strings (excluding sourcePageType).
 */
function _getRelatedPageTypes(sourcePageType) {
    const related = new Set();
    const sourceCfg = templateConfigs[sourcePageType];

    // Forward: docs this template lists as related
    if (sourceCfg && sourceCfg.related_documents) {
        for (const rt of sourceCfg.related_documents) related.add(rt);
    }

    // Reverse: docs that list this template as their related
    for (const [pt, cfg] of Object.entries(templateConfigs)) {
        if (pt === sourcePageType) continue;
        if (cfg.related_documents && cfg.related_documents.includes(sourcePageType)) {
            related.add(pt);
        }
    }

    related.delete(sourcePageType);
    return related;
}

/**
 * Sync field and config changes from the active template to all related documents.
 * Bidirectional: syncs to docs this template lists AND docs that list this template.
 * Works in both "All Signatories" (global config) and "This Signatory" (per-signatory overrides) modes.
 */
function _syncToRelatedDocs(sourcePageType) {
    const sourceCfg = templateConfigs[sourcePageType];
    if (!sourceCfg) return;

    const relatedTypes = _getRelatedPageTypes(sourcePageType);
    if (relatedTypes.size === 0) return;

    const SYNC_CONFIG_KEYS = ['separate_its_line', 'show_by_prefix_individual', 'footer_enabled'];

    const inSelectedScope = drawerScope === 'selected' && editingPageKey;

    if (inSelectedScope) {
        // Per-signatory mode: sync this signatory's overrides to related docs
        const sigIdx = parseInt(editingPageKey.split('-')[0]);
        const sig = savedSignatures[sigIdx];
        if (!sig) return;
        const sourceOv = (sig.field_overrides || {})[sourcePageType] || {};
        const sourceFieldOv = sourceOv.fields || {};
        const sourceConfigOv = sourceOv.config || {};

        for (const relType of relatedTypes) {
            // Copy field overrides to related doc for this signatory
            for (const [fieldId, ov] of Object.entries(sourceFieldOv)) {
                const relOv = _ensureOverrides(sig, relType, fieldId);
                Object.assign(relOv, ov);
            }
            // Copy config overrides
            if (Object.keys(sourceConfigOv).length > 0) {
                const relConfigOv = _ensureConfigOverride(sig, relType);
                for (const key of SYNC_CONFIG_KEYS) {
                    if (key in sourceConfigOv) relConfigOv[key] = sourceConfigOv[key];
                }
            }
            // Save signatory overrides
            _saveFieldOverrides(sigIdx, relType);
        }
    } else {
        // All Signatories mode: sync global configs
        const sourceFieldMap = {};
        for (const f of (sourceCfg.fields || [])) {
            sourceFieldMap[f.id] = f;
        }

        for (const relType of relatedTypes) {
            const relCfg = templateConfigs[relType];
            if (!relCfg) continue;

            // Sync field enabled/disabled states
            for (const relField of (relCfg.fields || [])) {
                const sourceField = sourceFieldMap[relField.id];
                if (sourceField) {
                    relField.enabled = sourceField.enabled;
                }
            }

            // Sync boolean config toggles
            for (const key of SYNC_CONFIG_KEYS) {
                if (key in sourceCfg) {
                    relCfg[key] = sourceCfg[key];
                }
            }

            // Save to backend
            fetch(`/api/templates/${relType}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(relCfg),
            });
        }
    }
}

function attachAutoSaveListeners() {
    const form = document.getElementById('template-form');
    if (!form) return;
    // Remove previous listeners to prevent accumulation
    form.removeEventListener('input', onTemplateFieldChange);
    form.removeEventListener('change', _onFormChange);
    // Clear pending save timers
    clearTimeout(templateSaveTimer);
    clearTimeout(drawerSignerSaveTimer);
    // Attach fresh
    form.addEventListener('input', onTemplateFieldChange);
    form.addEventListener('change', _onFormChange);
}

function onTemplateFieldChange() {
    showSaveIndicator('unsaved');
    clearTimeout(templateSaveTimer);
    templateSaveTimer = setTimeout(async () => {
        showSaveIndicator('saving');
        try {
            await saveTemplateConfig({ skipOverrideCheck: true });
            showSaveIndicator('saved');
        } catch (e) {
            if (e.message === 'Cancelled by user') {
                showSaveIndicator('unsaved');
            } else {
                showSaveIndicator('error');
            }
        }
    }, 500);
}

function showSaveIndicator(state) {
    const el = document.getElementById('drawer-save-indicator');
    if (!el) return;
    const labels = { unsaved: 'Unsaved changes', saving: 'Saving\u2026', saved: 'Saved', error: 'Save failed' };
    el.className = 'drawer-save-indicator ' + state;
    el.textContent = labels[state] || '';
}

// -- Drawer signer info auto-save --

let drawerSignerSaveTimer = null;

function attachDrawerSignerInfoListeners() {
    const form = document.getElementById('template-form');
    if (!form) return;
    form.querySelectorAll('.drawer-info-input').forEach(input => {
        input.addEventListener('input', onDrawerSignerInfoChange);
        input.addEventListener('change', onDrawerSignerInfoChange);
    });
}

function onDrawerSignerInfoChange(e) {
    const input = e.target;
    const sigIdx = parseInt(input.dataset.sig);
    const field = input.dataset.field;
    const sig = savedSignatures[sigIdx];
    if (!sig) return;

    // Update local state immediately
    sig[field] = input.value.trim();

    // Debounced save to backend
    clearTimeout(drawerSignerSaveTimer);
    drawerSignerSaveTimer = setTimeout(async () => {
        const fields = {};
        document.querySelectorAll(`.drawer-info-input[data-sig="${sigIdx}"]`).forEach(inp => {
            fields[inp.dataset.field] = inp.value.trim();
        });
        try {
            await fetch(`/signatures/${sigIdx}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fields }),
            });
            fetchSignatureLog();
        } catch (_) {}
    }, 600);

    debouncePreview();
}

function onInfoFieldToggle(checkbox) {
    const fieldId = checkbox.dataset.fieldId;
    const sigIdx = parseInt(checkbox.dataset.sig);
    const pageType = editingPageKey ? editingPageKey.replace(/^\d+-/, '') : activeTemplateType;
    const enabled = checkbox.checked;

    const sig = savedSignatures[sigIdx];
    if (!sig) return;

    const ov = _ensureOverrides(sig, pageType, fieldId);
    ov.enabled = enabled;

    // Address toggle also controls city_state_zip
    if (fieldId === 'address') {
        const czOv = _ensureOverrides(sig, pageType, 'city_state_zip');
        czOv.enabled = enabled;
    }

    // Dim the input when toggled off
    const fieldEl = checkbox.closest('.signer-info-field');
    fieldEl.classList.toggle('field-disabled', !enabled);

    // Persist and re-render preview
    _saveFieldOverrides(sigIdx, pageType);
    debouncePreview();
}

function onDrawerSignerTypeChange(select) {
    const isEntity = select.value === 'entity';
    const form = document.getElementById('template-form');
    form.querySelectorAll('.drawer-entity-only').forEach(el => {
        el.style.display = isEntity ? '' : 'none';
    });
    // Trigger save
    onDrawerSignerInfoChange({ target: select });
}

function addDrawerAddlEntity(sigIdx) {
    // Reveal the next hidden additional entity slot
    const slots = document.querySelectorAll('.signer-addl-entity');
    let revealed = false;
    slots.forEach(slot => {
        if (!revealed && slot.style.display === 'none') {
            slot.style.display = '';
            slot.querySelector('input').focus();
            revealed = true;
        }
    });
    // Hide the button if all 3 are now visible
    const visibleCount = [...slots].filter(s => s.style.display !== 'none').length;
    if (visibleCount >= 3) {
        const btn = document.getElementById('add-addl-entity-btn');
        if (btn) btn.style.display = 'none';
    }
}

function removeDrawerAddlEntity(btn, idx) {
    const slot = btn.closest('.signer-addl-entity');
    // Clear the inputs
    slot.querySelectorAll('input').forEach(inp => {
        inp.value = '';
        onDrawerSignerInfoChange({ target: inp });
    });
    // Hide the row
    slot.style.display = 'none';
    // Show the + Add button again
    const addBtn = document.getElementById('add-addl-entity-btn');
    if (addBtn) addBtn.style.display = '';
}

async function saveTemplateConfig(opts = {}) {
    const pt = activeTemplateType;
    const cfg = templateConfigs[pt];
    if (!cfg) return;

    // Read display name (always global)
    const displayNameEl = document.getElementById('tpl-display-name');
    if (displayNameEl) cfg.display_name = displayNameEl.value.trim();

    // Footer, witness clause, signer header: always global from drawer
    // Consent text: per-signatory when in "This Signatory" scope
    if (drawerScope !== 'selected') {
        const footerEl = document.getElementById('tpl-footer');
        if (footerEl) cfg.footer_template = richTextToTagged(footerEl);
        const signerHeaderEl = document.getElementById('tpl-signer-header');
        if (signerHeaderEl) {
            const signerHeader = richTextToTagged(signerHeaderEl);
            cfg.entity_header_label = signerHeader;
            cfg.section_header_label = signerHeader;
        }
        const witnessEl = document.getElementById('tpl-witness-clause');
        if (witnessEl) cfg.witness_clause_text = richTextToTagged(witnessEl);
        const consentEl = document.getElementById('tpl-consent-text');
        if (consentEl) cfg.consent_text = richTextToTagged(consentEl);
    }

    // Field toggles & related documents
    if (drawerScope === 'selected' && editingPageKey) {
        // --- Per-signatory mode: save field visibility + config as overrides ---
        const sigIdx = parseInt(editingPageKey.split('-')[0]);
        const sig = savedSignatures[sigIdx];
        if (sig) {
            // Save text fields as per-signatory overrides
            const consentEl = document.getElementById('tpl-consent-text');
            if (consentEl) {
                const cfgOv = _ensureConfigOverride(sig, pt);
                cfgOv.consent_text = richTextToTagged(consentEl);
            }
            const witnessEl = document.getElementById('tpl-witness-clause');
            if (witnessEl) {
                const cfgOv = _ensureConfigOverride(sig, pt);
                cfgOv.witness_clause_text = richTextToTagged(witnessEl);
            }
            const signerHeaderEl = document.getElementById('tpl-signer-header');
            if (signerHeaderEl) {
                const cfgOv = _ensureConfigOverride(sig, pt);
                const headerVal = richTextToTagged(signerHeaderEl);
                cfgOv.section_header_label = headerVal;
                cfgOv.entity_header_label = headerVal;
            }
            const footerEl = document.getElementById('tpl-footer');
            if (footerEl) {
                const cfgOv = _ensureConfigOverride(sig, pt);
                cfgOv.footer_template = richTextToTagged(footerEl);
            }
            // Save footer_enabled as per-signatory config override
            const footerToggle = document.querySelector('[data-editable-toggle="footer"]');
            if (footerToggle) {
                const cfgOv = _ensureConfigOverride(sig, pt);
                cfgOv.footer_enabled = footerToggle.checked;
            }
            // Save config toggles as per-signatory overrides
            document.querySelectorAll('#template-form input[data-config-toggle]').forEach(cb => {
                const cfgOv = _ensureConfigOverride(sig, pt);
                cfgOv[cb.dataset.configToggle] = cb.checked;
            });
            // Save field visibility overrides
            document.querySelectorAll('#template-form input[data-field-id]').forEach(cb => {
                const ov = _ensureOverrides(sig, pt, cb.dataset.fieldId);
                ov.enabled = cb.checked;
            });
            // Save condensed field toggles (e.g., Sub-Entities)
            document.querySelectorAll('#template-form input[data-condensed-fields]').forEach(cb => {
                for (const fid of cb.dataset.condensedFields.split(',')) {
                    const ov = _ensureOverrides(sig, pt, fid);
                    ov.enabled = cb.checked;
                }
            });

            // Save signatory overrides to backend
            await fetch(`/signatures/${sigIdx}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fields: { field_overrides: sig.field_overrides } }),
            });
        }

        // Still save text/label changes to the global template config
        cfg.related_documents = _collectRelatedDocs();
        _syncRelatedDocsBidirectional(pt);

        const resp = await fetch(`/api/templates/${pt}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cfg),
        });
        if (!resp.ok) throw new Error('Server returned ' + resp.status);
    } else {
        // --- All signatories mode: save field visibility + config to global template ---
        const footerToggle = document.querySelector('[data-editable-toggle="footer"]');
        if (footerToggle) cfg.footer_enabled = footerToggle.checked;

        document.querySelectorAll('#template-form input[data-field-id]').forEach(cb => {
            const field = cfg.fields.find(f => f.id === cb.dataset.fieldId);
            if (field) field.enabled = cb.checked;
        });
        // Save condensed field toggles (e.g., Sub-Entities)
        document.querySelectorAll('#template-form input[data-condensed-fields]').forEach(cb => {
            for (const fid of cb.dataset.condensedFields.split(',')) {
                const field = cfg.fields.find(f => f.id === fid);
                if (field) field.enabled = cb.checked;
            }
        });

        cfg.related_documents = _collectRelatedDocs();
        _syncRelatedDocsBidirectional(pt);

        // Check for signatories with individual overrides on this page type
        const overriddenSigs = [];
        savedSignatures.forEach((sig, idx) => {
            if (_hasCustomOverrides(sig, pt)) {
                overriddenSigs.push({ idx, name: sig.signer_name || `Signatory ${idx + 1}` });
            }
        });

        if (overriddenSigs.length > 0 && !opts.skipOverrideCheck) {
            const result = await showOverrideModal(overriddenSigs);
            if (result.action === 'none') throw new Error('Cancelled by user');

            const sigsToReset = result.action === 'all' ? overriddenSigs : result.selected;
            for (const s of sigsToReset) {
                const sig = savedSignatures[s.idx];
                delete sig.field_overrides[pt];
                await fetch(`/signatures/${s.idx}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fields: { field_overrides: sig.field_overrides } }),
                });
            }
        }

        const resp = await fetch(`/api/templates/${pt}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cfg),
        });
        if (!resp.ok) throw new Error('Server returned ' + resp.status);
    }

    templateConfigs[pt] = cfg;
    // Sync field/config changes to related documents (both scopes)
    _syncToRelatedDocs(pt);
    const opt = document.querySelector(`#drawer-tab-select option[value="${pt}"]`);
    if (opt) opt.textContent = cfg.display_name;
    renderPreview();
}

// -- Override confirmation modal --

let _overrideModalResolve = null;
let _overrideModalSigs = [];

function showOverrideModal(overriddenSigs) {
    _overrideModalSigs = overriddenSigs;
    const listEl = document.getElementById('override-modal-list');
    listEl.innerHTML = overriddenSigs.map(s => `
        <label class="override-modal-item checked" onclick="this.classList.toggle('checked')">
            <input type="checkbox" data-sig-idx="${s.idx}" checked>
            <span class="override-modal-item-name">${escapeHtml(s.name)}</span>
        </label>
    `).join('');

    document.getElementById('override-modal-overlay').classList.add('open');

    return new Promise(resolve => {
        _overrideModalResolve = resolve;
    });
}

function resolveOverrideModal(action) {
    document.getElementById('override-modal-overlay').classList.remove('open');

    if (action === 'all') {
        _overrideModalResolve({ action: 'all', selected: _overrideModalSigs });
    } else if (action === 'selected') {
        const selected = [];
        document.querySelectorAll('#override-modal-list input[type="checkbox"]:checked').forEach(cb => {
            const idx = parseInt(cb.dataset.sigIdx);
            const match = _overrideModalSigs.find(s => s.idx === idx);
            if (match) selected.push(match);
        });
        if (selected.length === 0) {
            _overrideModalResolve({ action: 'none' });
        } else {
            _overrideModalResolve({ action: 'selected', selected });
        }
    } else {
        _overrideModalResolve({ action: 'none' });
    }

    _overrideModalResolve = null;
    _overrideModalSigs = [];
}

async function resetSignatoryOverrides(sigIndex, pageType) {
    const sig = savedSignatures[sigIndex];
    if (!sig) return;
    const label = templateConfigs[pageType]?.display_name || pageType;
    if (!confirm(`Reset "${sig.signer_name || 'Signatory'}" to the default "${label}" settings?\n\nThis will remove all individual field overrides for this page type.`)) return;

    // Clear this signatory's overrides for this page type
    if (sig.field_overrides && sig.field_overrides[pageType]) {
        delete sig.field_overrides[pageType];
    }

    // Save to backend
    try {
        await fetch(`/signatures/${sigIndex}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields: { field_overrides: sig.field_overrides || {} } }),
        });
    } catch (_) {}

    // Re-render
    renderTemplateForm(pageType);
    renderPreview();
}

async function resetTemplateConfig(pageType) {
    if (!confirm(`Reset "${templateConfigs[pageType]?.display_name || pageType}" to defaults?\n\nThis will also clear any per-signatory overrides.`)) return;
    try {
        const resp = await fetch(`/api/templates/${pageType}/reset`, { method: 'POST' });
        if (resp.ok) {
            // Reload that config
            const cfgResp = await fetch(`/api/templates/${pageType}`);
            const newCfg = await cfgResp.json();
            templateConfigs[pageType] = newCfg;

            // Clear all per-signatory overrides for this page type
            for (let i = 0; i < savedSignatures.length; i++) {
                const sig = savedSignatures[i];
                if (sig.field_overrides && sig.field_overrides[pageType]) {
                    delete sig.field_overrides[pageType];
                    try {
                        await fetch(`/signatures/${i}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ fields: { field_overrides: sig.field_overrides } }),
                        });
                    } catch (_) {}
                }
            }

            renderTemplateForm(pageType);
            renderPreview();
        }
    } catch (e) {
        alert('Failed to reset: ' + e.message);
    }
}

async function applyToAllSignatories(pageType) {
    if (savedSignatures.length === 0) return;

    const label = templateConfigs[pageType]?.display_name || pageType;
    if (!confirm(`Apply the current field settings to all signatories for "${label}"?\n\nThis will remove all individual overrides so every signatory follows the global template settings.`)) return;

    try {
        // First, ensure the current drawer state is saved to the global config
        await saveTemplateConfig({ skipOverrideCheck: true });

        // Clear all per-signatory overrides for this page type.
        // The global config already has the correct values — clearing overrides
        // means everyone falls through to global, which is "apply to all."
        for (let i = 0; i < savedSignatures.length; i++) {
            const sig = savedSignatures[i];
            if (sig.field_overrides && sig.field_overrides[pageType]) {
                delete sig.field_overrides[pageType];

                await fetch(`/signatures/${i}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fields: { field_overrides: sig.field_overrides } }),
                });
            }
        }
        renderPreview();
        showSaveIndicator('saved');
    } catch (e) {
        alert('Error applying settings: ' + e.message);
    }
}

async function applyThisToAll(sigIndex, pageType) {
    const sig = savedSignatures[sigIndex];
    if (!sig) return;

    const label = templateConfigs[pageType]?.display_name || pageType;
    const sigName = sig.signer_name || `Signatory ${sigIndex + 1}`;
    if (!confirm(`Apply "${sigName}"'s settings to all signatories for "${label}"?\n\nThis will copy all field visibility, text, toggles, and field positions to the global template and remove all individual overrides.`)) return;

    try {
        // First, save the current drawer state for this signatory
        await saveTemplateConfig({ skipOverrideCheck: true });

        const cfg = templateConfigs[pageType];
        if (!cfg) return;

        // Get this signatory's overrides
        const sigOv = (sig.field_overrides || {})[pageType] || {};
        const fieldOv = sigOv.fields || {};
        const configOv = sigOv.config || {};

        // Merge this signatory's field overrides into the global config fields
        if (cfg.fields) {
            for (const field of cfg.fields) {
                const ov = fieldOv[field.id];
                if (ov) {
                    // Apply all override properties (enabled, bold, italic, row, column, etc.)
                    Object.assign(field, ov);
                }
            }
        }

        // Merge this signatory's config overrides into the global config
        for (const [key, value] of Object.entries(configOv)) {
            cfg[key] = value;
        }

        // Save the updated global config
        const resp = await fetch(`/api/templates/${pageType}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cfg),
        });
        if (!resp.ok) throw new Error('Failed to save global config');

        templateConfigs[pageType] = cfg;

        // Clear ALL per-signatory overrides for this page type (everyone follows global now)
        for (let i = 0; i < savedSignatures.length; i++) {
            const s = savedSignatures[i];
            if (s.field_overrides && s.field_overrides[pageType]) {
                delete s.field_overrides[pageType];
                await fetch(`/signatures/${i}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fields: { field_overrides: s.field_overrides } }),
                });
            }
        }

        // Switch to "All Signatories" scope since overrides are now global
        setDrawerScope('all');
        editingPageKey = null;
        renderTemplateForm(pageType);
        renderPreview();
        showSaveIndicator('saved');
    } catch (e) {
        alert('Error applying settings: ' + e.message);
    }
}

async function deleteCustomPageType(pageType) {
    const name = templateConfigs[pageType]?.display_name || pageType;
    if (!confirm(`Delete "${name}"? This will remove the page type and its column from the matrix.`)) return;
    try {
        const resp = await fetch(`/api/templates/${pageType}`, { method: 'DELETE' });
        if (!resp.ok) {
            const err = await resp.json();
            alert(err.error || 'Failed to delete');
            return;
        }

        // Remove from local state
        delete templateConfigs[pageType];
        PAGE_TYPES = PAGE_TYPES.filter(pt => pt !== pageType);
        rebuildPreviewRenderers();

        // Re-render matrix and editor
        renderMatrixHeader();
        await fetchSignatureLog();
        initTemplateEditor();
        if (PAGE_TYPES.length > 0) {
            selectTemplateTab(PAGE_TYPES[0]);
        }
        renderPreview();
    } catch (e) {
        alert('Error deleting page type: ' + e.message);
    }
}

// Related documents: only share template styles/settings, not matrix selection.
// This function is intentionally a no-op — related docs are linked for template
// inheritance, not for auto-checking in the signature matrix.
function applyRelatedDocuments(pageType, rowIndex) {
    // No-op: related documents should not auto-check in the matrix
}


