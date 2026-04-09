/**
 * Signature Packet Generator — globals, constants, initialization
 * Load order: utils.js → signatures.js → preview.js → drawer.js → app.js
 */

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------

let signatureBase64 = null;
let savedSignatures = [];

// Built-in page types (used to detect custom vs default)
const DEFAULT_PAGE_TYPES = new Set([
    "stock_purchase_agreement",
    "certificate_of_incorporation",
    "investors_rights_agreement",
    "voting_agreement",
    "rofr_cosale",
    "board_consent",
    "stockholder_consent",
    "compliance_certificate",
    "secretary_certificate",
    "indemnification_agreement",
]);

// Short abbreviations for column headers
const PAGE_TYPE_ABBREVS = {
    "stock_purchase_agreement": "SPA",
    "certificate_of_incorporation": "A&R COI",
    "investors_rights_agreement": "IRA",
    "voting_agreement": "VA",
    "rofr_cosale": "ROFR",
    "board_consent": "Board",
    "stockholder_consent": "SH Consent",
    "compliance_certificate": "Compliance",
    "secretary_certificate": "Secy",
    "indemnification_agreement": "Indem",
};

// Page types loaded dynamically from backend
let PAGE_TYPES = [];

// Hidden page types (visibility toggle — does NOT delete templates)
let hiddenPageTypes = new Set(JSON.parse(localStorage.getItem('sig_hidden_page_types') || '[]'));

// Preview / drawer state
let previewDebounceTimer = null;
let editingPageKey = null; // "sigIndex-pageType" or null
let templateConfigs = {};
let drawerOpen = false;
let templateSaveTimer = null;
let drawerScope = 'all'; // 'all' or 'selected'
let activeTemplateType = null;
let PREVIEW_RENDERERS = {};

// Undo / Redo stacks
const undoStack = [];
const redoStack = [];
const MAX_UNDO = 50;

// Multi-select for preview grid fields
let selectedFieldIds = new Set();

// ---------------------------------------------------------------------------
// Close all dropdown menus on outside click
// ---------------------------------------------------------------------------

document.addEventListener('click', function(e) {
    if (!e.target.closest('.doc-manager-dropdown')) {
        const panel = document.getElementById('doc-manager-panel');
        if (panel) panel.classList.remove('show');
    }
    if (!e.target.closest('.generate-dropdown')) {
        const menu = document.getElementById('generate-menu');
        if (menu) menu.classList.remove('show');
    }
    if (!e.target.closest('.add-template-dropdown')) {
        const menu = document.getElementById('add-template-menu');
        if (menu) menu.classList.remove('show');
    }
    if (!e.target.closest('.excel-dropdown')) {
        const menu = document.getElementById('excel-menu');
        if (menu) menu.classList.remove('show');
    }
});

// ---------------------------------------------------------------------------
// Section collapse toggle
// ---------------------------------------------------------------------------

function toggleSection(id) {
    const section = document.getElementById(id);
    const collapse = section.closest('.section-collapse');
    const toggle = collapse ? collapse.querySelector('.section-toggle') : null;
    section.classList.toggle('collapsed');
    if (toggle) toggle.classList.toggle('expanded');
}

// ---------------------------------------------------------------------------
// API key persistence
// ---------------------------------------------------------------------------

function initApiKey() {
    const input = document.getElementById("api-key");
    const saved = localStorage.getItem("sig_azure_api_key");
    if (saved) input.value = saved;
    input.addEventListener("input", () => {
        localStorage.setItem("sig_azure_api_key", input.value);
    });
}

// ---------------------------------------------------------------------------
// Main initialization
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", async () => {
    await loadTemplateConfigs();
    // Prune hidden types that no longer exist
    hiddenPageTypes = new Set([...hiddenPageTypes].filter(pt => PAGE_TYPES.includes(pt)));
    saveHiddenPageTypes();
    renderMatrixHeader();
    fetchSignatureLog();
    initMatrixDragDrop();
    attachPreviewListeners();
    initEditableTextHandlers();
    initApiKey();

    // Bulk upload drag-drop
    const bulkArea = document.getElementById("bulk-upload-area");
    if (bulkArea) {
        bulkArea.addEventListener("dragover", (e) => { e.preventDefault(); bulkArea.style.borderColor = "var(--blue-accent)"; });
        bulkArea.addEventListener("dragleave", () => { bulkArea.style.borderColor = ""; });
        bulkArea.addEventListener("drop", (e) => {
            e.preventDefault();
            bulkArea.style.borderColor = "";
            if (e.dataTransfer.files.length > 0) submitBulkExtract(e.dataTransfer.files[0]);
        });
    }
});

// Initialize keyboard shortcuts
document.addEventListener('DOMContentLoaded', () => {
    // Escape closes drawer
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && drawerOpen) toggleSettingsDrawer();
    });

    // Ctrl+Z / Ctrl+Y (or Cmd on Mac) for field undo/redo
    document.addEventListener('keydown', (e) => {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

        const isMod = e.ctrlKey || e.metaKey;
        if (!isMod) return;

        if (e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            undoFieldChange();
        } else if (e.key === 'z' && e.shiftKey) {
            e.preventDefault();
            redoFieldChange();
        } else if (e.key === 'y') {
            e.preventDefault();
            redoFieldChange();
        }
    });
});
