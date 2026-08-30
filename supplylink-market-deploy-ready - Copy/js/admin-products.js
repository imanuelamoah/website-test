
  (function() {
    'use strict';
    
// ── REGISTERED SUPPLIERS (live) ──────────────────────────────
// Previously this was a hardcoded list of 6 fake demo suppliers,
// which meant Add Product / Bulk Import could only ever assign
// products to those fakes — real onboarded suppliers never showed
// up here. This now pulls live from actual registered+active
// supplier accounts instead.
function getRegisteredSuppliers() {
  const users = (window.SL && window.SL.getUsers) ? window.SL.getUsers() : [];
  return users
    .filter(u => u.role === 'supplier' && u.status === 'active')
    .map(u => ({ id: u.id, name: u.name, bizType: u.bizType, location: u.location }));
}

// ── DEMO PRODUCTS (pre-loaded) ────────────────────────────
// Single source of truth lives in the SL shared-store block,
// exposed as window.SL_DEMO_PRODUCTS — referenced here instead of a
// separate copy so the two can never drift out of sync again.
const DEMO_PRODUCTS = window.SL_DEMO_PRODUCTS;

// ── STATE ─────────────────────────────────────────────────
let products = JSON.parse(localStorage.getItem('sl_products') || 'null') || [...DEMO_PRODUCTS];
let activeCategory = 'All';
let editingId = null;
let deletingId = null;
let admProdSelectedIds = new Set();

/* ── PRODUCT PHOTOS (up to 4, auto-compressed) — separate arrays for the
   Add panel and the Edit modal since both live in this same script block ── */
let addProductImages = [];
let editProductImages = [];

function renderAdminPhotoPicker(target) {
  const arr = target === 'edit' ? editProductImages : addProductImages;
  const el = document.getElementById(target === 'edit' ? 'edit-photo-picker' : 'add-photo-picker');
  if (!el) return;
  let html = arr.map((src, i) => `
    <div class="photo-thumb">
      <img src="${src}" alt="Product photo ${i + 1}">
      <button type="button" class="photo-remove-btn" onclick="adminRemoveProductPhoto('${target}', ${i})">×</button>
    </div>`).join('');
  if (arr.length < 4) {
    html += `<div class="photo-add-tile" onclick="document.getElementById('${target}-photo-input').click()">
      <span>+</span><small>Add photo</small>
    </div>`;
  }
  el.innerHTML = html;
}

async function adminHandleProductPhotos(target, fileList) {
  const arr = target === 'edit' ? editProductImages : addProductImages;
  const input = document.getElementById(target + '-photo-input');
  const files = Array.from(fileList || []).slice(0, 4 - arr.length);
  if (!files.length) { if (input) input.value = ''; return; }
  for (const f of files) {
    try {
      const url = await window.SL.uploadProductImage(f, { maxWidth: 1200, quality: 0.72 });
      arr.push(url);
    } catch (uploadErr) {
      // Cloud upload failed (e.g. offline) — fall back to local-only base64
      // so the admin isn't fully blocked, but warn since it won't be visible
      // to buyers on other devices until re-uploaded with a connection.
      try {
        const dataUrl = await window.SL.compressImage(f, { maxWidth: 1200, quality: 0.72 });
        arr.push(dataUrl);
        const err = document.getElementById(target === 'edit' ? 'edit-error' : 'add-error');
        if (err) { err.textContent = 'Saved photo locally only (upload failed — check your connection). It won\'t show for buyers until re-uploaded.'; err.style.display = 'block'; }
      } catch (e) {
        const err = document.getElementById(target === 'edit' ? 'edit-error' : 'add-error');
        if (err) { err.textContent = 'Could not process one of the photos — skipped.'; err.style.display = 'block'; }
      }
    }
  }
  renderAdminPhotoPicker(target);
  if (input) input.value = '';
}

function adminRemoveProductPhoto(target, i) {
  const arr = target === 'edit' ? editProductImages : addProductImages;
  arr.splice(i, 1);
  renderAdminPhotoPicker(target);
}

function saveProducts() { localStorage.setItem('sl_products', JSON.stringify(products)); }

// ── TABS ──────────────────────────────────────────────────
function switchTab(tab) {
  document.getElementById('tab-list').classList.toggle('active', tab === 'list');
  document.getElementById('tab-add').classList.toggle('active', tab === 'add');
  document.getElementById('tab-import').classList.toggle('active', tab === 'import');
  document.getElementById('panel-list').style.display = tab === 'list' ? 'block' : 'none';
  document.getElementById('panel-add').style.display = tab === 'add' ? 'block' : 'none';
  document.getElementById('panel-import').style.display = tab === 'import' ? 'block' : 'none';
  if (tab === 'list') renderProductList();
  if (tab === 'add') resetAddForm();
  if (tab === 'import') resetImportPanel();
}

// ── RESET ADD FORM ────────────────────────────────────────
let selectedAddSourceType = null;
function setAddSourceType(type) {
  selectedAddSourceType = type;
  const farmBtn = document.getElementById('add-source-farm');
  const whBtn = document.getElementById('add-source-warehouse');
  if (farmBtn) { farmBtn.style.borderColor = type === 'farm' ? '#1a472a' : '#ddd'; farmBtn.style.background = type === 'farm' ? '#eef6ee' : '#fff'; }
  if (whBtn) { whBtn.style.borderColor = type === 'wholesale' ? '#1a472a' : '#ddd'; whBtn.style.background = type === 'wholesale' ? '#eef6ee' : '#fff'; }
}

function resetAddForm() {
  ['add-name','add-desc','add-stock','add-supplier-price','add-buyer-price','add-weight-kg'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('add-category').value = '';
  document.getElementById('add-unit').value = '';
  populateSuppliers();
  document.getElementById('add-supplier').value = '';
  selectedAddSourceType = null;
  setAddSourceType(null);
  document.getElementById('markup-preview').style.display = 'none';
  document.getElementById('add-error').style.display = 'none';
  addProductImages = [];
  renderAdminPhotoPicker('add');
}

// ── POPULATE SUPPLIER DROPDOWN ────────────────────────────
function populateSuppliers() {
  const sel = document.getElementById('add-supplier');
  sel.innerHTML = '<option value="">Select supplier…</option>';
  const suppliers = getRegisteredSuppliers();
  if (!suppliers.length) {
    sel.innerHTML += '<option value="" disabled>No active suppliers registered yet</option>';
    return;
  }
  suppliers.forEach(s => {
    sel.innerHTML += `<option value="${s.id}">${s.name}${s.location ? ' — ' + s.location : ''}</option>`;
  });
}

// ── LIVE MARKUP CALC ──────────────────────────────────────
function calcMarkup() {
  const sp = parseFloat(document.getElementById('add-supplier-price').value) || 0;
  const bp = parseFloat(document.getElementById('add-buyer-price').value) || 0;
  const prev = document.getElementById('markup-preview');
  if (sp > 0 && bp > 0) {
    const markup = bp - sp;
    const pct = sp > 0 ? ((markup / sp) * 100).toFixed(1) : 0;
    document.getElementById('mp-supplier').textContent = 'GH₵ ' + sp.toFixed(2);
    document.getElementById('mp-buyer').textContent    = 'GH₵ ' + bp.toFixed(2);
    document.getElementById('mp-markup').textContent   = (markup >= 0 ? '+' : '') + 'GH₵ ' + markup.toFixed(2);
    document.getElementById('mp-pct').textContent      = pct + '%';
    document.getElementById('mp-markup').style.color   = markup >= 0 ? 'var(--green-mid)' : 'var(--red)';
    prev.style.display = 'block';
  } else {
    prev.style.display = 'none';
  }
}

function calcEditMarkup() {
  const sp = parseFloat(document.getElementById('edit-supplier-price').value) || 0;
  const bp = parseFloat(document.getElementById('edit-buyer-price').value) || 0;
  const prev = document.getElementById('edit-markup-preview');
  if (sp > 0 && bp > 0) {
    const markup = bp - sp;
    const pct = sp > 0 ? ((markup / sp) * 100).toFixed(1) : 0;
    document.getElementById('emp-markup').textContent = (markup >= 0 ? '+' : '') + 'GH₵ ' + markup.toFixed(2);
    document.getElementById('emp-pct').textContent    = pct + '%';
    document.getElementById('emp-markup').style.color = markup >= 0 ? 'var(--green-mid)' : 'var(--red)';
    prev.style.display = 'block';
  } else {
    prev.style.display = 'none';
  }
}

// ── ADD PRODUCT ───────────────────────────────────────────
function addProduct() {
  const name    = document.getElementById('add-name').value.trim();
  const cat     = document.getElementById('add-category').value;
  const unit    = document.getElementById('add-unit').value;
  const weightKg = parseFloat(document.getElementById('add-weight-kg').value) || null;
  const desc    = document.getElementById('add-desc').value.trim();
  const stock   = parseInt(document.getElementById('add-stock').value) || 0;
  const sp      = parseFloat(document.getElementById('add-supplier-price').value);
  const bp      = parseFloat(document.getElementById('add-buyer-price').value);
  const suppId  = document.getElementById('add-supplier').value;
  const err     = document.getElementById('add-error');

  if (!name)   return showErr(err, 'Please enter a product name.');
  if (!selectedAddSourceType) return showErr(err, 'Please choose how this product is sourced (farm or warehouse).');
  if (!cat)    return showErr(err, 'Please select a category.');
  if (!unit)   return showErr(err, 'Please select a unit.');
  if (!suppId) return showErr(err, 'Please select a supplier for this product.');
  if (!sp || sp <= 0) return showErr(err, 'Please enter a valid supplier price.');
  if (!bp || bp <= 0) return showErr(err, 'Please enter a valid buyer price.');
  if (bp < sp) return showErr(err, 'Buyer price cannot be less than supplier price — you would make a loss!');

  err.style.display = 'none';
  const supp = getRegisteredSuppliers().find(s => s.id === suppId);
  products.unshift({
    id: 'p' + Date.now(),
    name, category: cat, unit, weightKg, description: desc,
    supplierPrice: sp, buyerPrice: bp, stockQty: stock,
    supplierId: suppId, supplierName: supp ? supp.name : 'Unknown',
    sourceType: selectedAddSourceType,
    isAvailable: true, createdAt: Date.now(),
    images: addProductImages.slice()
  });
  saveProducts();
  updateStats();
  switchTab('list');
  renderCategoryFilters();
}

// ── CSV BULK IMPORT ────────────────────────────────────────
const IMPORT_CATEGORIES = ["Vegetables","Fruits","Grains & Cereals","Proteins","Meat & Poultry","Fish & Seafood","Dairy & Eggs","Cooking Oil","Spices & Herbs","Biscuits & Snacks","Drinks & Beverages","Wholesale Goods","Other"];
const IMPORT_UNITS = ["kg","crate","bag","box","bunch","dozen","litre","piece","sachet"];
let importParsedRows = []; // last parsed+validated rows, for commit

function getCSVTemplateText() {
  const header = "name,category,unit,description,stock,supplierPrice,buyerPrice,supplierName";
  const example = "Fresh Tomatoes,Vegetables,crate,Grade A tomatoes from Ejura farms,50,80,100,Kwame Asante";
  return header + "\n" + example + "\n";
}

function showTemplateMsg(text, isError) {
  const el = document.getElementById('import-template-msg');
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? '#c0392b' : '#2D6A4F';
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 4000);
}

// Primary: native share sheet (works well on most Android/iOS mobile browsers,
// lets the person save straight to Files/Drive/WhatsApp themselves).
async function shareCSVTemplate() {
  const csv = getCSVTemplateText();
  try {
    if (navigator.canShare && navigator.share) {
      const file = new File([csv], "supplylink_product_import_template.csv", { type: "text/csv" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "SupplyLink CSV Template" });
        return;
      }
    }
  } catch (e) {
    // user cancelled the share sheet, or it's unsupported — fall through
  }
  // Fallback: try the classic blob download (works on desktop browsers)
  try {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = "supplylink_product_import_template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showTemplateMsg('If nothing downloaded, use "Copy Template Text" below instead.');
  } catch (e) {
    showTemplateMsg('Sharing isn\'t supported on this browser — please use "Copy Template Text" below instead.', true);
  }
}

// Fallback: copy the template text so it can be pasted into Sheets/Notes/etc.
async function copyCSVTemplate() {
  const csv = getCSVTemplateText();
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(csv);
      showTemplateMsg('✅ Copied! Paste it into Google Sheets or Notes, then save/export as .csv.');
      return;
    }
    throw new Error('no clipboard API');
  } catch (e) {
    // Older-browser fallback: select the textarea text so the person can copy manually
    const ta = document.getElementById('import-template-text');
    if (ta) {
      ta.select();
      ta.setSelectionRange(0, 99999);
      try {
        document.execCommand('copy');
        showTemplateMsg('✅ Copied! Paste it into Google Sheets or Notes, then save/export as .csv.');
      } catch (e2) {
        showTemplateMsg('Please tap the box above and copy the text manually.', true);
      }
    }
  }
}

function resetImportPanel() {
  importParsedRows = [];
  const fileInput = document.getElementById('import-file-input');
  if (fileInput) fileInput.value = '';
  document.getElementById('import-error').style.display = 'none';
  document.getElementById('import-preview-wrap').style.display = 'none';
  document.getElementById('import-preview-table').innerHTML = '';
  const ta = document.getElementById('import-template-text');
  if (ta) ta.value = getCSVTemplateText();
}

// Simple CSV line parser that handles quoted fields containing commas
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i+1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && next === '\n') i++;
        row.push(field); field = '';
        if (row.some(f => f.trim() !== '')) rows.push(row);
        row = [];
      } else { field += c; }
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function handleCSVFileSelect(evt) {
  const file = evt.target.files && evt.target.files[0];
  const err = document.getElementById('import-error');
  err.style.display = 'none';
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.csv')) {
    return showErr(err, 'Please upload a .csv file.');
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      processCSVText(e.target.result);
    } catch (ex) {
      showErr(err, 'Could not read that file. Please check it is a valid CSV and try again.');
    }
  };
  reader.onerror = () => showErr(err, 'Could not read that file. Please try again.');
  reader.readAsText(file);
}

function processCSVText(text) {
  const err = document.getElementById('import-error');
  const rows = parseCSV(text);
  if (rows.length < 2) {
    return showErr(err, 'That CSV has no data rows. Download the template and fill in your products below the header row.');
  }
  const header = rows[0].map(h => h.trim().toLowerCase());
  const required = ['name','category','unit','description','stock','supplierprice','buyerprice','suppliername'];
  const colIdx = {};
  required.forEach(col => { colIdx[col] = header.indexOf(col); });
  const missing = required.filter(col => colIdx[col] === -1);
  if (missing.length) {
    return showErr(err, 'Missing column(s) in your CSV header: ' + missing.join(', ') + '. Download the template to see the exact column names needed.');
  }

  const dataRows = rows.slice(1);
  importParsedRows = dataRows.map((r, idx) => validateImportRow(r, colIdx, idx + 2));
  renderImportPreview();
}

function validateImportRow(r, colIdx, rowNum) {
  const get = (col) => (r[colIdx[col]] || '').trim();
  const name = get('name');
  const catRaw = get('category');
  const unitRaw = get('unit');
  const description = get('description');
  const stockRaw = get('stock');
  const spRaw = get('supplierprice');
  const bpRaw = get('buyerprice');
  const suppNameRaw = get('suppliername');

  const errors = [];

  if (!name) errors.push('Missing product name');

  const category = IMPORT_CATEGORIES.find(c => c.toLowerCase() === catRaw.toLowerCase());
  if (!category) errors.push(`Unrecognised category "${catRaw}"`);

  const unit = IMPORT_UNITS.find(u => u.toLowerCase() === unitRaw.toLowerCase());
  if (!unit) errors.push(`Unrecognised unit "${unitRaw}"`);

  const supplier = getRegisteredSuppliers().find(s => s.name.toLowerCase() === suppNameRaw.toLowerCase());
  if (!supplier) errors.push(`Unknown supplier "${suppNameRaw}"`);

  const stock = stockRaw === '' ? 0 : parseInt(stockRaw, 10);
  if (isNaN(stock) || stock < 0) errors.push('Stock must be a whole number ≥ 0');

  const sp = parseFloat(spRaw);
  if (!spRaw || isNaN(sp) || sp <= 0) errors.push('Supplier price must be a number > 0');

  const bp = parseFloat(bpRaw);
  if (!bpRaw || isNaN(bp) || bp <= 0) errors.push('Buyer price must be a number > 0');

  if (!isNaN(sp) && !isNaN(bp) && bp < sp) errors.push('Buyer price is less than supplier price (would be a loss)');

  return {
    rowNum, name, category: category || catRaw, unit: unit || unitRaw, description,
    stock: isNaN(stock) ? 0 : stock, supplierPrice: sp, buyerPrice: bp,
    supplierId: supplier ? supplier.id : null,
    supplierName: supplier ? supplier.name : suppNameRaw,
    valid: errors.length === 0, errors
  };
}

function renderImportPreview() {
  const validCount = importParsedRows.filter(r => r.valid).length;
  const errorCount = importParsedRows.length - validCount;
  document.getElementById('import-summary').textContent =
    `${importParsedRows.length} row(s) found — ${validCount} valid, ${errorCount} with errors`;

  const table = document.getElementById('import-preview-table');
  table.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead>
        <tr style="background:#f5f7f5;text-align:left;">
          <th style="padding:8px;">Row</th>
          <th style="padding:8px;">Name</th>
          <th style="padding:8px;">Supplier</th>
          <th style="padding:8px;">Category</th>
          <th style="padding:8px;">Unit</th>
          <th style="padding:8px;">Stock</th>
          <th style="padding:8px;">S. Price</th>
          <th style="padding:8px;">B. Price</th>
          <th style="padding:8px;">Status</th>
        </tr>
      </thead>
      <tbody>
        ${importParsedRows.map(r => `
          <tr style="border-top:1px solid #eee;${r.valid ? '' : 'background:#fff5f5;'}">
            <td style="padding:8px;">${r.rowNum}</td>
            <td style="padding:8px;">${r.name || '—'}</td>
            <td style="padding:8px;">${r.supplierName || '—'}</td>
            <td style="padding:8px;">${r.category || '—'}</td>
            <td style="padding:8px;">${r.unit || '—'}</td>
            <td style="padding:8px;">${r.stock}</td>
            <td style="padding:8px;">${isNaN(r.supplierPrice) ? '—' : 'GH₵' + r.supplierPrice.toFixed(2)}</td>
            <td style="padding:8px;">${isNaN(r.buyerPrice) ? '—' : 'GH₵' + r.buyerPrice.toFixed(2)}</td>
            <td style="padding:8px;">${r.valid ? '<span style="color:#2D6A4F;font-weight:700;">✅ Valid</span>' : `<span style="color:#c0392b;font-weight:700;">❌ ${r.errors.join('; ')}</span>`}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  const commitBtn = document.getElementById('import-commit-btn');
  commitBtn.textContent = validCount > 0 ? `Import ${validCount} Valid Product(s)` : 'No valid rows to import';
  commitBtn.disabled = validCount === 0;
  commitBtn.style.opacity = validCount === 0 ? '0.5' : '1';
  commitBtn.style.cursor = validCount === 0 ? 'not-allowed' : 'pointer';

  document.getElementById('import-preview-wrap').style.display = 'block';
}

function commitCSVImport() {
  const validRows = importParsedRows.filter(r => r.valid);
  if (!validRows.length) return;

  validRows.forEach((r, i) => {
    products.unshift({
      id: 'p' + Date.now() + '_' + i,
      name: r.name, category: r.category, unit: r.unit, description: r.description,
      supplierPrice: r.supplierPrice, buyerPrice: r.buyerPrice, stockQty: r.stock,
      supplierId: r.supplierId, supplierName: r.supplierName,
      isAvailable: true, createdAt: Date.now()
    });
  });
  saveProducts();
  updateStats();
  renderCategoryFilters();
  resetImportPanel();
  switchTab('list');
  alert(`✅ Imported ${validRows.length} product(s) into the catalogue.`);
}

// ── RENDER PRODUCT LIST ───────────────────────────────────
function clearLowStockFilter() {
  window.__slLowStockFilter = false;
  renderProductList();
}
window.clearLowStockFilter = clearLowStockFilter;

function renderProductList() {
  products = window.SL.getProducts() || products; // pick up changes from cloud sync / other tabs
  const search = (document.getElementById('search-input').value || '').toLowerCase();
  const lowStockOnly = !!window.__slLowStockFilter;
  const visibleProducts = products.filter(p => !p.deleted);
  let filtered = visibleProducts.filter(p => {
    const matchCat = activeCategory === 'All' || p.category === activeCategory;
    const matchSearch = !search || p.name.toLowerCase().includes(search) ||
      p.category.toLowerCase().includes(search) || (p.supplierName || '').toLowerCase().includes(search);
    const matchStock = !lowStockOnly || (p.stockQty || 0) <= 10;
    return matchCat && matchSearch && matchStock;
  });

  const banner = document.getElementById('lowstock-filter-banner');
  if (banner) {
    banner.innerHTML = lowStockOnly
      ? `<div style="background:#fff3cd;color:#8a6d1a;border-radius:10px;padding:10px 12px;font-size:12px;font-weight:600;margin:8px 0;display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <span>⚠️ Showing low-stock &amp; out-of-stock items only</span>
          <button onclick="clearLowStockFilter()" style="background:#8a6d1a;color:#fff;border:none;padding:5px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;">Show All</button>
        </div>`
      : '';
  }

  document.getElementById('list-count').textContent =
    filtered.length === visibleProducts.length
      ? `All Products (${visibleProducts.length})`
      : `${filtered.length} of ${visibleProducts.length} products`;

  const el = document.getElementById('product-list');
  if (filtered.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📦</div>
        <h4>${visibleProducts.length === 0 ? 'No products yet' : 'No results found'}</h4>
        <p>${visibleProducts.length === 0
          ? 'Add your first product using the Add Product tab above.'
          : 'Try a different search or category filter.'}</p>
      </div>`;
    window.admProdUpdateBulkBar([]);
    return;
  }

  el.innerHTML = filtered.map(p => {
    const markup = p.buyerPrice - p.supplierPrice;
    const pct    = p.supplierPrice > 0 ? ((markup / p.supplierPrice) * 100).toFixed(1) : 0;
    const stockClass = p.stockQty === 0 ? 'stock-out' : p.stockQty <= 10 ? 'stock-low' : 'stock-ok';
    const stockLabel = p.stockQty === 0 ? '⚠️ Out of Stock' : p.stockQty <= 10 ? `⚠️ Low: ${p.stockQty} left` : `✅ ${p.stockQty} in stock`;
    const tier = window.SL.getProductTier(p);
    const tierBadge = tier === 'farm'
      ? `<span style="display:inline-block;margin-top:3px;padding:2px 8px;border-radius:20px;background:#eef6ee;color:#1a472a;font-size:10.5px;font-weight:700;">🌾 Farm-sourced</span>`
      : `<span style="display:inline-block;margin-top:3px;padding:2px 8px;border-radius:20px;background:#eef2fb;color:#2a3d66;font-size:10.5px;font-weight:700;">🏬 Warehouse-sourced</span>`;

    return `
      <div class="product-card">
        <div class="product-card-header">
          <div style="display:flex;align-items:flex-start;gap:10px;">
            <input type="checkbox" class="adm-prod-cb" ${admProdSelectedIds.has(p.id) ? 'checked' : ''} onchange="window.admProdToggleSelect('${p.id}', this.checked)" style="margin-top:4px;width:16px;height:16px;cursor:pointer;flex-shrink:0;">
            ${(p.images && p.images.length) ? `<div style="width:44px;height:44px;border-radius:8px;overflow:hidden;flex-shrink:0;"><img src="${p.images[0]}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;display:block;"></div>` : ''}
            <div>
              <div class="product-name">${p.name}</div>
              <div class="product-meta">${p.category} · per ${p.unit} · ${p.supplierName}</div>
              <div>${tierBadge}</div>
            </div>
          </div>
          <div class="product-actions">
            <button class="icon-btn icon-btn-edit" onclick="openEditModal('${p.id}')" title="Edit">✏️</button>
            <button class="icon-btn icon-btn-delete" onclick="openConfirmDelete('${p.id}')" title="Delete">🗑️</button>
          </div>
        </div>
        <div class="product-card-body">
          <div class="price-grid">
            <div class="price-box supplier">
              <div class="pb-label">Supplier</div>
              <div class="pb-value">GH₵${p.supplierPrice.toFixed(2)}</div>
            </div>
            <div class="price-box markup">
              <div class="pb-label">Markup</div>
              <div class="pb-value">+GH₵${markup.toFixed(2)}</div>
            </div>
            <div class="price-box buyer">
              <div class="pb-label">Buyer Price</div>
              <div class="pb-value">GH₵${p.buyerPrice.toFixed(2)}</div>
            </div>
          </div>
          <div class="product-footer">
            <span class="stock-badge ${stockClass}">${stockLabel}</span>
            <div class="avail-toggle" onclick="toggleAvailability('${p.id}')">
              <div class="toggle-switch ${p.isAvailable ? 'on' : 'off'}"></div>
              <span style="color:${p.isAvailable ? 'var(--green-mid)' : 'var(--grey-400)'}">
                ${p.isAvailable ? 'Visible' : 'Hidden'}
              </span>
            </div>
          </div>
          ${p.description ? `<p style="font-size:11px;color:var(--grey-600);margin-top:8px;line-height:1.5;">${p.description}</p>` : ''}
          <p style="font-size:10px;color:var(--grey-400);margin-top:6px;">Markup: ${pct}% · Added ${timeAgo(p.createdAt)}</p>
        </div>
      </div>`;
  }).join('');
  window.admProdUpdateBulkBar(filtered);
}

// ── ADMIN PRODUCT BULK SELECTION ──
window.admProdToggleSelect = function(id, checked) {
  if (checked) admProdSelectedIds.add(id); else admProdSelectedIds.delete(id);
  window.admProdUpdateBulkBar();
};

window.admProdToggleSelectAll = function(checked) {
  const visibleProducts = products.filter(p => !p.deleted);
  const search = (document.getElementById('search-input').value || '').toLowerCase();
  const lowStockOnly = !!window.__slLowStockFilter;
  const visible = visibleProducts.filter(p => {
    const matchCat = activeCategory === 'All' || p.category === activeCategory;
    const matchSearch = !search || p.name.toLowerCase().includes(search) ||
      p.category.toLowerCase().includes(search) || (p.supplierName || '').toLowerCase().includes(search);
    const matchStock = !lowStockOnly || (p.stockQty || 0) <= 10;
    return matchCat && matchSearch && matchStock;
  });
  visible.forEach(p => { checked ? admProdSelectedIds.add(p.id) : admProdSelectedIds.delete(p.id); });
  renderProductList();
};

window.admProdClearSelection = function() {
  admProdSelectedIds.clear();
  renderProductList();
};

window.admProdUpdateBulkBar = function(visibleList) {
  const bar = document.getElementById('adm-prod-bulk-bar');
  const countEl = document.getElementById('adm-prod-bulk-count');
  if (!bar || !countEl) return;
  const n = admProdSelectedIds.size;
  bar.style.display = n > 0 ? 'flex' : 'none';
  countEl.textContent = n + (n === 1 ? ' selected' : ' selected');
  const selectAllCb = document.getElementById('adm-prod-select-all-cb');
  if (selectAllCb && visibleList) {
    const visibleSelected = visibleList.filter(p => admProdSelectedIds.has(p.id)).length;
    selectAllCb.checked = visibleList.length > 0 && visibleSelected === visibleList.length;
    selectAllCb.indeterminate = visibleSelected > 0 && visibleSelected < visibleList.length;
  }
};

window.admProdBulkSetStock = function() {
  const n = admProdSelectedIds.size;
  if (n === 0) return;
  const val = prompt('Set stock quantity for ' + n + (n === 1 ? ' product' : ' products') + ':', '');
  if (val === null) return;
  const qty = parseInt(val, 10);
  if (isNaN(qty) || qty < 0) { alert('Please enter a valid non-negative number.'); return; }
  let changed = 0;
  products.forEach(p => { if (admProdSelectedIds.has(p.id)) { p.stockQty = qty; changed++; } });
  saveProducts(); updateStats(); renderProductList();
  if (typeof window.logAdminAction === 'function') window.logAdminAction('Bulk stock update', `Set stock to ${qty} for ${changed} product(s)`);
  if (typeof showToast === 'function') showToast('✅ Stock updated for ' + changed + ' product(s).');
};

window.admProdBulkSetAvailability = function(visible) {
  const n = admProdSelectedIds.size;
  if (n === 0) return;
  if (!confirm((visible ? 'Show' : 'Hide') + ' ' + n + (n === 1 ? ' product' : ' products') + (visible ? ' to buyers?' : ' from buyers?'))) return;
  let changed = 0;
  products.forEach(p => { if (admProdSelectedIds.has(p.id)) { p.isAvailable = visible; changed++; } });
  saveProducts(); updateStats(); renderProductList();
  if (typeof window.logAdminAction === 'function') window.logAdminAction(visible ? 'Bulk show products' : 'Bulk hide products', `${changed} product(s)`);
  if (typeof showToast === 'function') showToast('✅ ' + changed + ' product(s) ' + (visible ? 'shown.' : 'hidden.'));
};

window.admProdBulkDelete = function() {
  const n = admProdSelectedIds.size;
  if (n === 0) return;
  if (!confirm('Delete ' + n + (n === 1 ? ' product' : ' products') + '? This cannot be undone.')) return;
  let changed = 0;
  products.forEach(p => { if (admProdSelectedIds.has(p.id)) { p.deleted = true; p.isAvailable = false; changed++; } });
  saveProducts(); updateStats(); renderProductList(); renderCategoryFilters();
  admProdSelectedIds.clear();
  if (typeof window.logAdminAction === 'function') window.logAdminAction('Bulk delete products', `${changed} product(s) removed`);
  if (typeof showToast === 'function') showToast('🗑️ ' + changed + ' product(s) deleted.', 'error');
};

// ── CATEGORY FILTERS ──────────────────────────────────────
function renderCategoryFilters() {
  const cats = ['All', ...new Set(products.filter(p => !p.deleted).map(p => p.category))];
  const el = document.getElementById('category-filters');
  el.innerHTML = cats.map(c =>
    `<div class="filter-chip ${activeCategory === c ? 'active' : ''}" onclick="setCategory('${c}')">${c}</div>`
  ).join('');
}

function setCategory(cat) {
  activeCategory = cat;
  renderCategoryFilters();
  renderProductList();
}

// ── STATS ─────────────────────────────────────────────────
function updateStats() {
  const active   = products.filter(p => !p.deleted);
  const total    = active.length;
  const lowStock = active.filter(p => p.stockQty > 0 && p.stockQty <= 10).length;
  const outStock = active.filter(p => p.stockQty === 0).length;
  const unavail  = active.filter(p => !p.isAvailable).length;
  // Guard against a GH₵0 supplierPrice producing Infinity/NaN and silently
  // corrupting the average (same divide-by-zero class already fixed in the
  // Commission Tracker's margin() calc) — every current path that creates a
  // product (Add/Edit/CSV import) already requires supplierPrice > 0, but this
  // keeps the tile honest if that ever changes or older data slips through.
  const markupable = active.filter(p => p.supplierPrice > 0);
  const avgMarkup = markupable.length > 0
    ? (markupable.reduce((s, p) => s + ((p.buyerPrice - p.supplierPrice) / p.supplierPrice * 100), 0) / markupable.length).toFixed(1) + '%'
    : '—';

  document.getElementById('stat-total').textContent    = total;
  document.getElementById('stat-markup').textContent   = avgMarkup;
  document.getElementById('stat-lowstock').textContent = lowStock + outStock;
  document.getElementById('stat-unavail').textContent  = unavail;
}

// ── TOGGLE AVAILABILITY ───────────────────────────────────
function toggleAvailability(id) {
  const p = products.find(p => p.id === id);
  if (p) { p.isAvailable = !p.isAvailable; saveProducts(); updateStats(); renderProductList(); }
}

// ── EDIT MODAL ────────────────────────────────────────────
let selectedEditSourceType = null;
function setEditSourceType(type) {
  selectedEditSourceType = type;
  const farmBtn = document.getElementById('edit-source-farm');
  const whBtn = document.getElementById('edit-source-warehouse');
  if (farmBtn) { farmBtn.style.borderColor = type === 'farm' ? '#1a472a' : '#ddd'; farmBtn.style.background = type === 'farm' ? '#eef6ee' : '#fff'; }
  if (whBtn) { whBtn.style.borderColor = type === 'wholesale' ? '#1a472a' : '#ddd'; whBtn.style.background = type === 'wholesale' ? '#eef6ee' : '#fff'; }
}

function openEditModal(id) {
  const p = products.find(p => p.id === id);
  if (!p) return;
  editingId = id;
  document.getElementById('edit-name').value           = p.name;
  document.getElementById('edit-category').value       = p.category;
  document.getElementById('edit-unit').value           = p.unit;
  document.getElementById('edit-weight-kg').value      = p.weightKg || '';
  document.getElementById('edit-desc').value           = p.description || '';
  document.getElementById('edit-stock').value          = p.stockQty;
  document.getElementById('edit-supplier-price').value = p.supplierPrice;
  document.getElementById('edit-buyer-price').value    = p.buyerPrice;
  document.getElementById('edit-error').style.display  = 'none';
  setEditSourceType(p.sourceType || (window.SL.getProductTier ? window.SL.getProductTier(p) : null));
  editProductImages = (p.images || []).slice();
  renderAdminPhotoPicker('edit');
  calcEditMarkup();
  document.getElementById('edit-modal').classList.add('open');
  window.slPushOverlay(closeEditModal);
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.remove('open');
  editingId = null;
  window.slPopOverlay();
}

/* Fix: an overriding .modal CSS rule later in this file sets
   overflow:hidden with no max-height, which clips the Edit Product
   modal's content (including the Save button) and leaves the page
   stuck since body scroll is locked while it's open. Force this one
   modal to be internally scrollable via an ID rule (wins the
   cascade regardless of source order). */
(function() {
  const style = document.createElement('style');
  style.textContent = '#edit-modal .modal { max-height: 90vh !important; overflow-y: auto !important; -webkit-overflow-scrolling: touch !important; }';
  document.head.appendChild(style);
})();

function saveEdit() {
  const name  = document.getElementById('edit-name').value.trim();
  const cat   = document.getElementById('edit-category').value;
  const unit  = document.getElementById('edit-unit').value;
  const weightKg = parseFloat(document.getElementById('edit-weight-kg').value) || null;
  const desc  = document.getElementById('edit-desc').value.trim();
  const stock = parseInt(document.getElementById('edit-stock').value) || 0;
  const sp    = parseFloat(document.getElementById('edit-supplier-price').value);
  const bp    = parseFloat(document.getElementById('edit-buyer-price').value);
  const err   = document.getElementById('edit-error');

  if (!name) return showErr(err, 'Product name cannot be empty.');
  if (!selectedEditSourceType) return showErr(err, 'Please choose how this product is sourced (farm or warehouse).');
  if (!sp || sp <= 0) return showErr(err, 'Please enter a valid supplier price.');
  if (!bp || bp <= 0) return showErr(err, 'Please enter a valid buyer price.');
  if (bp < sp) return showErr(err, 'Buyer price cannot be less than supplier price!');

  const idx = products.findIndex(p => p.id === editingId);
  if (idx > -1) {
    products[idx] = { ...products[idx], name, category: cat, unit, weightKg, description: desc, stockQty: stock, supplierPrice: sp, buyerPrice: bp, sourceType: selectedEditSourceType, images: editProductImages.slice() };
    saveProducts(); updateStats(); renderProductList(); renderCategoryFilters();
  }
  closeEditModal();
}

// ── DELETE ────────────────────────────────────────────────
function openConfirmDelete(id) {
  const p = products.find(p => p.id === id);
  deletingId = id;
  document.getElementById('confirm-delete-name').textContent =
    `This will permanently remove "${p ? p.name : 'this product'}" from the catalogue.`;
  document.getElementById('confirm-delete').classList.add('open');
  window.slPushOverlay(closeConfirm);
}

function closeConfirm() {
  document.getElementById('confirm-delete').classList.remove('open');
  deletingId = null;
  window.slPopOverlay();
}

function confirmDelete() {
  const idx = products.findIndex(p => p.id === deletingId);
  if (idx > -1) {
    // Soft delete: flag it rather than removing the row. This means the app
    // never needs public DELETE privileges on the products table at all —
    // that privilege has been intentionally removed from Supabase entirely.
    products[idx].deleted = true;
    products[idx].isAvailable = false;
  }
  saveProducts(); updateStats(); renderProductList(); renderCategoryFilters();
  closeConfirm();
}

// ── HELPERS ───────────────────────────────────────────────
function showErr(el, msg) { el.textContent = msg; el.style.display = 'block'; }

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

/* ── ONE-TIME MIGRATION (v11.89): move existing base64 product photos
   into Supabase Storage ──
   Products created before the upload-to-Storage fix have their photos
   stored as giant base64 strings directly in the images[] array (and
   therefore in localStorage + the products table). This decodes each
   base64 image, uploads it to the 'product-images' bucket, and swaps the
   array entry for the short public URL instead.
   Self-healing / idempotent: guarded by a localStorage flag so it only
   attempts once per browser; if it fails partway (e.g. offline), it will
   simply try again next time an admin loads this screen, since only
   products still holding a "data:" image get touched. */
async function migrateBase64ProductImages() {
  if (localStorage.getItem('sl_img_migration_v1189')) return;
  const sb = window.SL_sb;
  if (!sb) return; // offline — try again next load

  let anyLeft = false;
  let changed = false;
  for (const p of products) {
    if (!Array.isArray(p.images) || !p.images.length) continue;
    for (let i = 0; i < p.images.length; i++) {
      const src = p.images[i];
      if (typeof src !== 'string' || src.indexOf('data:') !== 0) continue;
      try {
        const blob = await (await fetch(src)).blob();
        const fileName = `migrated_${p.id}_${i}_${Date.now()}.jpg`;
        const { error: uploadError } = await sb.storage
          .from('product-images')
          .upload(fileName, blob, { contentType: 'image/jpeg', cacheControl: '3600', upsert: false });
        if (uploadError) throw uploadError;
        const { data } = sb.storage.from('product-images').getPublicUrl(fileName);
        if (data && data.publicUrl) {
          p.images[i] = data.publicUrl;
          changed = true;
        } else {
          anyLeft = true;
        }
      } catch (e) {
        console.warn('Image migration failed for', p.id, e);
        anyLeft = true;
      }
    }
  }
  if (changed) saveProducts(); // triggers existing localStorage→Supabase sync automatically
  if (!anyLeft) localStorage.setItem('sl_img_migration_v1189', '1');
}

// ── INIT ──────────────────────────────────────────────────
populateSuppliers();
window.SL.registerInit('admin-products', function() {
  // Refresh from cloud sync BEFORE computing stats/filters — updateStats() and
  // renderCategoryFilters() read the module-level `products` array directly and,
  // unlike renderProductList() (which pulls window.SL.getProducts() itself), had
  // no way to see products added/edited on another device since this tab loaded.
  // Stat tiles and category chips could silently show stale counts on open.
  products = window.SL.getProducts() || products;
  updateStats();
  renderCategoryFilters();
  renderProductList();
  migrateBase64ProductImages().then(() => {
    renderProductList();
    if (typeof renderAdminDigest === 'function') { try { renderAdminDigest(); } catch(e) {} }
  });
  // Refresh admin dashboard stats (orders count + pending dot)
  if (typeof renderAdminUsersList === 'function') {
    try { renderAdminUsersList(); } catch(e) {}
  }
});

    /* expose inline-onclick functions to global scope */
    window.addProduct=addProduct; window.calcEditMarkup=calcEditMarkup;
    window.calcMarkup=calcMarkup; window.closeConfirm=closeConfirm;
    window.closeEditModal=closeEditModal; window.confirmDelete=confirmDelete;
    window.openConfirmDelete=openConfirmDelete; window.openEditModal=openEditModal;
    window.renderProductList=renderProductList; window.saveEdit=saveEdit;
    window.setCategory=setCategory; window.switchTab=switchTab;
    window.toggleAvailability=toggleAvailability;
    window.adminHandleProductPhotos=adminHandleProductPhotos; window.adminRemoveProductPhoto=adminRemoveProductPhoto;
    window.setAddSourceType=setAddSourceType; window.setEditSourceType=setEditSourceType;
  })();
  