
  (function() {
    'use strict';
    
    // ── LIVE DATA from SL shared store ──
    const CATEGORY_EMOJI = {
      "Vegetables":"🥦","Fruits":"🍊","Grains & Cereals":"🌾","Grains":"🌾",
      "Tubers":"🍠","Proteins":"🥩","Meat & Poultry":"🍗","Fish & Seafood":"🐟",
      "Cooking Oil":"🛢️","Spices & Herbs":"🧄","Spices":"🧄","Biscuits & Snacks":"🍪",
      "Drinks & Beverages":"🥤","Groceries":"🛒","Packaged Goods":"📦","Other":"📋"
    };

    function getMyId() {
      const u = window.SL.currentUser();
      return u ? u.id : null;
    }

    /* Products that belong to this supplier */
    let products = [];
    function loadMyProducts() {
      const myId = getMyId();
      products = window.SL.getProducts()
        .filter(p => p.supplierId === myId)
        .map(p => ({
          id: p.id,
          name: p.name,
          emoji: CATEGORY_EMOJI[p.category] || "📦",
          category: p.category,
          unit: p.unit,
          price: p.supplierPrice,
          stock: p.stockQty,
          available: p.isAvailable !== false,
          description: p.description || "",
          sourceType: p.sourceType || window.SL.getProductTier(p),
          images: p.images || [],
          lowStockSince: p.lowStockSince || null
        }));
    }

    let editingProductId = null;
    let selectedProdSourceType = null;

    /* ── PRODUCT PHOTOS (up to 4, auto-compressed) ── */
    let productPhotos = []; // array of compressed JPEG data URLs, current form

    function renderProductPhotoPicker() {
      const el = document.getElementById('prod-photo-picker');
      if (!el) return;
      let html = productPhotos.map((src, i) => `
        <div class="photo-thumb">
          <img src="${src}" alt="Product photo ${i + 1}">
          <button type="button" class="photo-remove-btn" onclick="removeProductPhoto(${i})">×</button>
        </div>`).join('');
      if (productPhotos.length < 4) {
        html += `<div class="photo-add-tile" onclick="document.getElementById('prod-photo-input').click()">
          <span>+</span><small>Add photo</small>
        </div>`;
      }
      el.innerHTML = html;
    }

    async function handleProductPhotos(fileList) {
      const files = Array.from(fileList || []).slice(0, 4 - productPhotos.length);
      const input = document.getElementById('prod-photo-input');
      if (!files.length) { if (input) input.value = ''; return; }
      for (const f of files) {
        try {
          const url = await window.SL.uploadProductImage(f, { maxWidth: 1200, quality: 0.72 });
          productPhotos.push(url);
        } catch (uploadErr) {
          // Cloud upload failed (e.g. offline) — fall back to local-only
          // base64 so the supplier isn't fully blocked, but warn since it
          // won't be visible to buyers until re-uploaded with a connection.
          try {
            const dataUrl = await window.SL.compressImage(f, { maxWidth: 1200, quality: 0.72 });
            productPhotos.push(dataUrl);
            showToast('Saved photo locally only (upload failed) — re-upload when back online.', 'error');
          } catch (e) {
            showToast('Could not process one of the photos — skipped.', 'error');
          }
        }
      }
      renderProductPhotoPicker();
      if (input) input.value = '';
    }

    function removeProductPhoto(i) {
      productPhotos.splice(i, 1);
      renderProductPhotoPicker();
    }

    /* Fulfillments: orders containing this supplier's unprepared products.
       Widened past just 'pending' — an order auto-assigns to its supplier
       (moving to 'confirmed') independently of and often shortly after
       placement, before the supplier has had a chance to prepare it. Under
       the old 'pending'-only filter, a fast auto-assign could make an order
       vanish from a supplier's queue before they ever got to act on it. */
    function getFulfillmentsData() {
      const myId = getMyId();
      const SLOT_LABELS = { 0:"Morning (7–10am)", 1:"Midday (11am–1pm)", 2:"Afternoon (2–5pm)" };
      const orders = window.SL.getOrders().filter(o => ['pending', 'confirmed', 'preparing'].includes(o.status || 'pending'));
      const result = [];
      orders.forEach(o => {
        (o.items || []).forEach(item => {
          if (item.supplierId === myId && !item.prepared) {
            result.push({
              orderId: o.id,
              productId: item.productId,
              supplierId: myId,
              key: o.id + '::' + item.productId,
              product: item.productName,
              emoji: CATEGORY_EMOJI["Other"] || "📦",
              qty: item.qty + " " + (item.unit || "units"),
              urgent: false,
              pickup: o.slot || "TBD",
              deadline: o.address === "In-person pickup" ? "In-person pickup" : o.address,
              tag: "New"
            });
          }
        });
      });
      return result;
    }

    /* Analytics: revenue/units/orders/top-products for this supplier's own sales */
    function getAnalyticsData() {
      const myId = getMyId();
      const orders = window.SL.getOrders();
      let totalRevenue = 0, totalUnits = 0;
      const orderIds = new Set();
      const byProduct = {};
      const byDay = {};

      orders.forEach(o => {
        (o.items || []).forEach(item => {
          if (item.supplierId !== myId) return;
          const qty = item.qty || 0;
          const rev = (item.supplierPrice || 0) * qty;
          totalRevenue += rev;
          totalUnits += qty;
          orderIds.add(o.id);

          if (!byProduct[item.productName]) byProduct[item.productName] = { qty: 0, revenue: 0 };
          byProduct[item.productName].qty += qty;
          byProduct[item.productName].revenue += rev;

          const d = new Date(o.createdAt || Date.now());
          const key = d.toISOString().slice(0, 10);
          byDay[key] = (byDay[key] || 0) + rev;
        });
        totalRevenue -= window.SL.getRefundedAmountForOrderSupplier(o.id, myId);
      });
      totalRevenue = Math.max(0, totalRevenue);

      const topProducts = Object.entries(byProduct)
        .map(([name, v]) => ({ name, qty: v.qty, revenue: v.revenue }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);

      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        days.push({ label: d.toLocaleDateString('en-GH', { weekday: 'short' }), revenue: byDay[key] || 0 });
      }

      return { totalRevenue, totalUnits, totalOrders: orderIds.size, topProducts, days };
    }

    function renderAnalytics() {
      const data = getAnalyticsData();
      document.getElementById('an-total-revenue').textContent = 'GH₵ ' + data.totalRevenue.toFixed(2);
      document.getElementById('an-total-units').textContent = data.totalUnits;
      document.getElementById('an-total-orders').textContent = data.totalOrders;

      const maxDay = Math.max(1, ...data.days.map(d => d.revenue));
      document.getElementById('an-chart').innerHTML = data.days.map(d => `
        <div class="an-bar-col">
          <div class="an-bar" style="height:${Math.max(4, (d.revenue / maxDay) * 100)}px" title="GH₵ ${d.revenue.toFixed(2)}"></div>
          <div class="an-bar-label">${d.label}</div>
        </div>`).join('');

      const topEl = document.getElementById('an-top-products');
      if (data.topProducts.length === 0) {
        topEl.innerHTML = '<p style="text-align:center;color:var(--ink-3);padding:20px 0;">No sales yet — once buyers order your products, they will show up here.</p>';
      } else {
        topEl.innerHTML = data.topProducts.map((p, i) => `
          <div class="an-top-row">
            <span class="an-top-rank">${i + 1}</span>
            <span class="an-top-name">${p.name}</span>
            <span class="an-top-qty">${p.qty} sold</span>
            <span class="an-top-rev">GH₵ ${p.revenue.toFixed(2)}</span>
          </div>`).join('');
      }

      renderMyPayoutStatus();
    }

    /* My payout status — mirrors admin payout ledger, filtered to this supplier */
    function renderMyPayoutStatus() {
      const myId = getMyId();
      const orders = (window.SL.getOrders() || []).filter(o => o.status === 'delivered');
      const payouts = window.SL.getPayouts();
      const lines = [];

      orders.forEach(o => {
        let amount = 0;
        (o.items || []).forEach(it => {
          if (it.supplierId !== myId) return;
          amount += (it.supplierPrice || 0) * (it.qty || 0);
        });
        amount = Math.max(0, amount - window.SL.getRefundedAmountForOrderSupplier(o.id, myId));
        if (amount === 0) return;
        const key = o.id + '::' + myId;
        const rec = payouts[key] || {};
        lines.push({ orderId: o.id, amount, deliveredAt: o.createdAt, status: rec.status || 'unpaid' });
      });

      const unpaidTotal = lines.filter(l => l.status === 'unpaid').reduce((s,l) => s + l.amount, 0);
      document.getElementById('an-unpaid-balance').textContent = 'GH₵ ' + unpaidTotal.toFixed(2);

      const listEl = document.getElementById('an-payout-list');
      if (lines.length === 0) {
        listEl.innerHTML = '<p style="text-align:center;color:var(--ink-3);padding:20px 0;">No delivered orders yet — payment status will appear here once a buyer receives your goods.</p>';
        return;
      }
      lines.sort((a,b) => (b.deliveredAt||0) - (a.deliveredAt||0));
      listEl.innerHTML = lines.map(l => `
        <div class="pay-line">
          <div class="pay-line-info">
            <div class="pay-line-order">Order ${l.orderId}</div>
            <div class="pay-line-date">${l.deliveredAt ? new Date(l.deliveredAt).toLocaleDateString('en-GH', {day:'numeric',month:'short',year:'numeric'}) : '—'}</div>
          </div>
          <span class="pay-line-amount">GH₵ ${l.amount.toFixed(2)}</span>
          <span class="pay-badge ${l.status}">${l.status === 'paid' ? 'Paid' : 'Unpaid'}</span>
        </div>`).join('');
    }


    // ── NAVIGATION ──
    function goTo(screen) {
      document.querySelectorAll('#view-supplier .screen').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('#view-supplier .sidebar-link').forEach(l => l.classList.remove('active'));
      document.querySelectorAll('#view-supplier .bn-link').forEach(l => l.classList.remove('active'));

      document.getElementById('b5-screen-' + screen).classList.add('active');
      const navEl = document.getElementById('b5-nav-' + screen);
      if (navEl) navEl.classList.add('active');
      const bnEl = document.getElementById('b5-bn-' + screen);
      if (bnEl) bnEl.classList.add('active');

      const sidebarBadge = document.getElementById('fulfillment-sidebar-badge');
      if (sidebarBadge) {
        const pendingCount = getFulfillmentsData().length;
        sidebarBadge.textContent = pendingCount;
        sidebarBadge.style.display = pendingCount > 0 ? '' : 'none';
      }

      if (screen === 'dashboard') renderDashboard();
      if (screen === 'products') renderProducts();
      if (screen === 'fulfillments') renderFulfillments();
      if (screen === 'analytics') renderAnalytics();
      if (screen === 'profile') renderMyProfile();
      if (screen === 'add-product' && !editingProductId) clearProductForm();
    }

    // ── RENDER PRODUCTS TABLE ──
    let productSelection = new Set();

    /* ── Price ranking visibility (v11.104) ──
       Shows a supplier where they stand against every other seller of the
       same-named product, using buyer-facing price (what actually decides
       a sale) — mirrors the comparison badge buyers already see, just from
       the other side of the marketplace. */
    function getPriceRankInfo(p) {
      const myId = getMyId();
      const allProducts = window.SL.getProducts() || [];
      const normName = (p.name || '').trim().toLowerCase();
      const group = allProducts.filter(x => !x.deleted && x.isAvailable !== false && (x.name || '').trim().toLowerCase() === normName);
      if (group.length <= 1) return null;
      const sorted = group.slice().sort((a, b) => a.buyerPrice - b.buyerPrice);
      const myIndex = sorted.findIndex(x => x.supplierId === myId);
      if (myIndex === -1) return null;
      return { rank: myIndex + 1, total: sorted.length, cheapest: sorted[0].buyerPrice, isCheapest: myIndex === 0 };
    }

    function renderProducts() {
      const tbody = document.getElementById('products-tbody');
      tbody.innerHTML = '';
      const validIds = new Set(products.map(p => p.id));
      productSelection.forEach(id => { if (!validIds.has(id)) productSelection.delete(id); });

      products.forEach(p => {
        const stockClass = p.stock === 0 ? 'stock-out' : p.stock <= 5 ? 'stock-low' : 'stock-ok';
        const stockLabel = p.stock === 0 ? 'Out of stock' : p.stock <= 5 ? `Low (${p.stock})` : p.stock;
        const rankInfo = getPriceRankInfo(p);
        const rankHtml = rankInfo
          ? `<div style="font-size:11px;margin-top:2px;font-weight:600;color:${rankInfo.isCheapest ? '#0A5C36' : '#B45309'};">${rankInfo.isCheapest ? '🏆 Cheapest' : `#${rankInfo.rank} of ${rankInfo.total} · from GH₵${rankInfo.cheapest.toFixed(2)}`}</div>`
          : '';
        tbody.innerHTML += `
          <tr>
            <td data-label=""><input type="checkbox" ${productSelection.has(p.id) ? 'checked' : ''} onchange="window.toggleProductSelect('${p.id}', this.checked)" style="width:16px;height:16px;cursor:pointer;"></td>
            <td data-label="">
              <div class="prod-name-cell">
                <div class="prod-thumb${(p.images && p.images.length) ? ' has-photo' : ''}">${(p.images && p.images.length) ? `<img src="${p.images[0]}" alt="${p.name}">` : p.emoji}</div>
                <div>
                  <div class="prod-name">${p.name}</div>
                  <div class="prod-category">${p.category}</div>
                </div>
              </div>
            </td>
            <td data-label="Price"><span class="price-val">GH₵ ${p.price.toFixed(2)}</span>${rankHtml}</td>
            <td data-label="Stock"><span class="stock-pill ${stockClass}"><span class="stock-dot"></span>${stockLabel}</span></td>
            <td data-label="Unit" style="color:var(--ink-3);font-size:13px;">per ${p.unit}</td>
            <td data-label="Available">
              <label class="avail-toggle">
                <input type="checkbox" ${p.available ? 'checked' : ''} onchange="toggleAvail('${p.id}', this.checked)">
                <span class="toggle-track"></span>
                <span class="toggle-thumb"></span>
              </label>
            </td>
            <td data-label="" style="white-space:nowrap;">
              <button class="tbl-action-btn btn-edit" onclick="editProduct('${p.id}')">Edit</button>
              <button class="tbl-action-btn btn-edit" onclick="window.duplicateProduct('${p.id}')" title="Create a copy of this listing">Duplicate</button>
            </td>
          </tr>`;
      });
      updateProductBulkBar();
    }

    window.toggleProductSelect = function(id, checked) {
      if (checked) productSelection.add(id); else productSelection.delete(id);
      const allBox = document.getElementById('products-select-all');
      if (allBox) allBox.checked = products.length > 0 && productSelection.size === products.length;
      updateProductBulkBar();
    };

    window.toggleAllProductSelect = function(checked) {
      productSelection = checked ? new Set(products.map(p => p.id)) : new Set();
      renderProducts();
    };

    function updateProductBulkBar() {
      const bar = document.getElementById('products-bulk-bar');
      const countEl = document.getElementById('products-bulk-count');
      if (!bar) return;
      const n = productSelection.size;
      bar.style.display = n > 0 ? 'flex' : 'none';
      if (countEl) countEl.textContent = n + (n === 1 ? ' selected' : ' selected');
    }

    window.clearProductSelection = function() {
      productSelection.clear();
      renderProducts();
    };

    /* ── Bulk edit (v11.104) ──
       Updating stock or price one product at a time doesn't scale for a
       supplier with a large catalogue — e.g. "restock everything" or
       "raise prices 5% for the new season". These apply to every selected
       product in one action. */
    window.bulkUpdateStock = function() {
      const ids = Array.from(productSelection);
      if (!ids.length) return;
      const input = window.prompt(`Set stock to how many units for ${ids.length} selected product${ids.length === 1 ? '' : 's'}?`, '');
      if (input === null) return;
      const val = parseInt(input, 10);
      if (isNaN(val) || val < 0) { showToast('Enter a valid stock number.', 'error'); return; }
      ids.forEach(id => window.SL.updateProduct(id, { stockQty: val }));
      showToast(`✅ Stock updated for ${ids.length} product${ids.length === 1 ? '' : 's'}.`, 'success');
      loadMyProducts();
      productSelection.clear();
      renderProducts();
    };

    window.bulkUpdatePrice = function() {
      const ids = Array.from(productSelection);
      if (!ids.length) return;
      const mode = window.prompt(`Update price for ${ids.length} selected product${ids.length === 1 ? '' : 's'}:\n\nType a fixed amount (e.g. "12.50") to set that price for all,\nor a percentage (e.g. "+5%" or "-10%") to adjust each by that much.`, '');
      if (mode === null || !mode.trim()) return;
      const trimmed = mode.trim();
      const pctMatch = trimmed.match(/^([+-]?\d+(\.\d+)?)%$/);
      if (pctMatch) {
        const pct = parseFloat(pctMatch[1]) / 100;
        ids.forEach(id => {
          const p = products.find(x => x.id === id);
          if (!p) return;
          const newPrice = Math.max(0, +(p.price * (1 + pct)).toFixed(2));
          window.SL.updateProduct(id, { supplierPrice: newPrice });
        });
        showToast(`✅ Price adjusted by ${pctMatch[1]}% for ${ids.length} product${ids.length === 1 ? '' : 's'}.`, 'success');
      } else {
        const val = parseFloat(trimmed);
        if (isNaN(val) || val < 0) { showToast('Enter a valid price or percentage, e.g. 12.50 or +5%.', 'error'); return; }
        ids.forEach(id => window.SL.updateProduct(id, { supplierPrice: val }));
        showToast(`✅ Price set to GH₵${val.toFixed(2)} for ${ids.length} product${ids.length === 1 ? '' : 's'}.`, 'success');
      }
      loadMyProducts();
      productSelection.clear();
      renderProducts();
    };

    /* ── Duplicate Listing (v11.104) ──
       For a supplier selling several sizes/varieties of similar items,
       re-typing category/description/photos every time is pure friction.
       This clones an existing listing (marked unavailable until reviewed)
       and drops the supplier straight into editing the copy. */
    window.duplicateProduct = function(id) {
      const original = (window.SL.getProducts() || []).find(p => p.id === id);
      if (!original) return;
      const newId = 'PRD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      const copy = Object.assign({}, original, {
        id: newId,
        name: original.name + ' (Copy)',
        isAvailable: false,
        createdAt: Date.now()
      });
      window.SL.addProduct(copy);
      showToast('✅ Duplicated — now editing the copy.', 'success');
      loadMyProducts();
      editProduct(newId);
    };


    function toggleAvail(id, val) {
      const p = products.find(x => x.id === id);
      if (p) {
        p.available = val;
        window.SL.updateProduct(id, { isAvailable: val });
        showToast(`${p.name} marked as ${val ? 'available' : 'unavailable'}.`, 'success');
      }
    }

    // ── ADD / EDIT PRODUCT ──
    function setProdSourceType(type) {
      selectedProdSourceType = type;
      updateProdSourceButtons();
      clearErr('err-prod-source');
    }
    function updateProdSourceButtons() {
      const farmBtn = document.getElementById('prod-source-farm');
      const whBtn = document.getElementById('prod-source-warehouse');
      if (!farmBtn || !whBtn) return;
      farmBtn.style.borderColor = selectedProdSourceType === 'farm' ? '#1a472a' : '#ddd';
      farmBtn.style.background = selectedProdSourceType === 'farm' ? '#eef6ee' : '#fff';
      whBtn.style.borderColor = selectedProdSourceType === 'wholesale' ? '#1a472a' : '#ddd';
      whBtn.style.background = selectedProdSourceType === 'wholesale' ? '#eef6ee' : '#fff';
    }

    function clearProductForm() {
      editingProductId = null;
      selectedProdSourceType = null;
      updateProdSourceButtons();
      document.getElementById('add-product-title').textContent = 'Add New Product';
      document.getElementById('submit-product-btn').textContent = 'Save Product';
      document.getElementById('delete-product-btn').style.display = 'none';
      ['prod-name','prod-category','prod-unit','prod-weight-kg','prod-price','prod-stock','prod-description'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      productPhotos = [];
      renderProductPhotoPicker();
      clearAllErrors();
    }

    function editProduct(id) {
      const p = products.find(x => x.id === id);
      if (!p) return;
      editingProductId = id;
      selectedProdSourceType = p.sourceType || null;
      updateProdSourceButtons();
      document.getElementById('add-product-title').textContent = 'Edit Product';
      document.getElementById('submit-product-btn').textContent = 'Save Changes';
      document.getElementById('delete-product-btn').style.display = 'block';
      document.getElementById('prod-name').value = p.name;
      document.getElementById('prod-category').value = p.category;
      document.getElementById('prod-unit').value = p.unit;
      document.getElementById('prod-weight-kg').value = p.weightKg || '';
      document.getElementById('prod-price').value = p.price;
      document.getElementById('prod-stock').value = p.stock;
      document.getElementById('prod-description').value = p.description || '';
      productPhotos = (p.images || []).slice();
      renderProductPhotoPicker();
      clearAllErrors();
      goTo('add-product');
    }

    // ── AUTO-GENERATE DESCRIPTION ──
    // Builds a clean, buyer-friendly description from the fields the supplier
    // has already filled in (name, category, unit, stock) plus their location.
    // No typing required beyond the product name — helps suppliers who find
    // writing a full description difficult.
    function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    const DESC_OPENERS = {
      "Vegetables":     ["Fresh and crisp", "Garden-fresh", "Hand-picked"],
      "Fruits":         ["Sweet and ripe", "Sun-ripened", "Juicy, fresh"],
      "Grains & Cereals": ["Well-dried", "Clean, properly sorted", "Quality-milled"],
      "Tubers":         ["Firm and freshly harvested", "Well-sized, fresh", "Good quality"],
      "Proteins":       ["Fresh", "Quality, well-handled", "Carefully sourced"],
      "Meat & Poultry": ["Fresh, well-handled", "Quality, properly stored", "Carefully sourced"],
      "Fish & Seafood": ["Fresh off the boat", "Well-dried", "Quality, properly smoked/dried"],
      "Cooking Oil":    ["Pure, unadulterated", "Quality, well-sealed", "Trusted brand"],
      "Spices & Herbs": ["Aromatic, fresh", "High quality", "Well-dried"],
      "Biscuits & Snacks": ["Fresh stock", "Quality, well-sealed", "Popular brand"],
      "Drinks & Beverages": ["Chilled and ready", "Quality, well-stocked", "Popular brand"],
      "Packaged Goods": ["Quality", "Reliable,  well-packaged", "Trusted"],
      "Other":          ["Quality", "Reliable", "Good quality"]
    };

    const DESC_CLOSERS = [
      "Great for household cooking and business use.",
      "Sourced directly — no middleman markup.",
      "Available for regular weekly supply.",
      "Good for bulk or small orders alike.",
      "Reliable quality, every batch."
    ];

    function generateDescription() {
      const name = document.getElementById('prod-name').value.trim();
      const category = document.getElementById('prod-category').value;
      const unit = document.getElementById('prod-unit').value;
      const stock = document.getElementById('prod-stock').value;

      if (!name || !category || !unit) {
        showToast('Fill in Product Name, Category and Unit first, then tap Auto-generate.', 'error');
        return;
      }

      const user = window.SL.currentUser();
      const location = (user && user.location) ? user.location : '';

      const opener = pickRandom(DESC_OPENERS[category] || DESC_OPENERS['Other']);
      const closer = pickRandom(DESC_CLOSERS);

      let desc = `${opener} ${name}`;
      if (location) desc += ` from ${location}`;
      desc += `. Sold per ${unit}`;
      if (stock) desc += ` — ${stock} currently in stock`;
      desc += `. ${closer}`;

      document.getElementById('prod-description').value = desc;
      showToast('Description generated — feel free to edit it.', 'success');
    }

    function submitProduct() {
      clearAllErrors();
      let valid = true;

      const name = document.getElementById('prod-name').value.trim();
      const category = document.getElementById('prod-category').value;
      const unit = document.getElementById('prod-unit').value;
      const weightKg = parseFloat(document.getElementById('prod-weight-kg').value) || null;
      const price = parseFloat(document.getElementById('prod-price').value);
      const stock = parseInt(document.getElementById('prod-stock').value);
      const desc = document.getElementById('prod-description').value.trim();

      if (!name) { showErr('err-prod-name', 'Product name is required.'); valid = false; }
      if (!selectedProdSourceType) { showErr('err-prod-source', 'Please choose how this product is sourced.'); valid = false; }
      if (!category) { showErr('err-prod-category', 'Please select a category.'); valid = false; }
      if (!unit) { showErr('err-prod-unit', 'Please select a unit.'); valid = false; }
      if (isNaN(price) || price <= 0) { showErr('err-prod-price', 'Enter a valid price.'); valid = false; }
      if (isNaN(stock) || stock < 0) { showErr('err-prod-stock', 'Stock quantity is required.'); valid = false; }

      if (!valid) return;

      const images = productPhotos.slice();

      if (editingProductId) {
        const p = products.find(x => x.id === editingProductId);
        Object.assign(p, { name, category, unit, weightKg, price, stock, description: desc, images, sourceType: selectedProdSourceType });
        window.SL.updateProduct(editingProductId, {
          name, category, unit, weightKg, description: desc,
          supplierPrice: price, stockQty: stock, images, sourceType: selectedProdSourceType
        });
        showToast('Product updated successfully.', 'success');
      } else {
        const emojis = { Vegetables:'🥦', Fruits:'🍊', 'Grains & Cereals':'🌾', Tubers:'🍠', Proteins:'🥩', 'Meat & Poultry':'🍗', 'Fish & Seafood':'🐟', 'Cooking Oil':'🛢️', 'Spices & Herbs':'🧄', 'Biscuits & Snacks':'🍪', 'Drinks & Beverages':'🥤', 'Packaged Goods':'📦', Other:'📋' };
        const newId = 'p' + Date.now();
        const myId = getMyId();
        const myUser = window.SL.currentUser();
        const newProd = { id: newId, name, category, unit, weightKg, price, stock, description: desc, available: true, emoji: emojis[category] || '📦', images, sourceType: selectedProdSourceType };
        products.push(newProd);
        /* Also save to shared SL store so admin and catalogue see it */
        window.SL.addProduct({
          id: newId,
          name, category, unit, weightKg,
          description: desc,
          supplierPrice: price,
          buyerPrice: price,  // admin can update markup later
          stockQty: stock,
          supplierId: myId,
          supplierName: myUser ? myUser.name : 'Unknown',
          sourceType: selectedProdSourceType,
          isAvailable: true,
          createdAt: Date.now(),
          images
        });
        showToast('Product added successfully!', 'success');
      }
      editingProductId = null;
      selectedProdSourceType = null;
      productPhotos = [];
      setTimeout(() => goTo('products'), 400);
    }

    function deleteProduct() {
      if (!editingProductId) return;
      const p = products.find(x => x.id === editingProductId);
      if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
      products = products.filter(x => x.id !== editingProductId);
      editingProductId = null;
      showToast('Product deleted.', 'error');
      setTimeout(() => goTo('products'), 400);
    }

    // ── RENDER FULFILLMENTS ──
    let fulfillmentSelection = new Set();

    /* ── Real pending-request badges (v11.107) ──
       The bell dot and Requests badge previously never reflected actual
       state — the dot always showed and the badge was a hardcoded "3" in
       the HTML. Both now compute the real count from getFulfillmentsData()
       and are called on init, after every fulfillments render, and on the
       periodic poll refresh — so they stay accurate without a supplier
       having to open the Requests screen to "clear" it. */
    function refreshSupplierRequestBadges() {
      const count = getFulfillmentsData().length;
      const dot = document.getElementById('b5-notif-dot');
      if (dot) dot.style.display = count > 0 ? 'block' : 'none';
      const badge = document.getElementById('b5-bn-requests-badge');
      if (badge) {
        badge.textContent = count > 9 ? '9+' : String(count);
        badge.style.display = count > 0 ? 'flex' : 'none';
      }
      // Was previously only set inside renderFulfillments(), which the
      // 20s poll never calls — only this function does. That gap meant
      // the badge (live on every poll) and the "N pending" header text
      // (frozen since the last manual render) could show different
      // numbers if anything changed the underlying data in between.
      // Owning both here, always together, makes that impossible.
      const countLabel = document.getElementById('fulfillment-count-label');
      if (countLabel) countLabel.textContent = count + ' pending';
    }
    window.refreshSupplierRequestBadges = refreshSupplierRequestBadges;

    function renderFulfillments() {
      const list = document.getElementById('fulfillment-list');
      const fulfillmentsData = getFulfillmentsData();
      // Drop any stale selections for items that no longer exist (e.g. already prepared)
      const validKeys = new Set(fulfillmentsData.map(f => f.key));
      fulfillmentSelection.forEach(k => { if (!validKeys.has(k)) fulfillmentSelection.delete(k); });

      refreshSupplierRequestBadges();

      if (!fulfillmentsData.length) {
        list.innerHTML = '<div class="empty-state"><div class="empty-icon">📦</div><h4>All caught up</h4><p>No pending fulfillment requests right now.</p></div>';
        updateFulfillmentBulkBar();
        return;
      }

      list.innerHTML = fulfillmentsData.map(f => `
        <div class="fulfillment-card${f.urgent ? ' urgent' : ''}">
          <label style="flex-shrink:0;display:flex;align-items:center;cursor:pointer;" onclick="event.stopPropagation();">
            <input type="checkbox" ${fulfillmentSelection.has(f.key) ? 'checked' : ''} onchange="window.toggleFulfillmentSelect('${f.key}', this.checked)" style="width:18px;height:18px;cursor:pointer;">
          </label>
          <div class="fulfillment-icon">
            <svg viewBox="0 0 24 24"><path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
          </div>
          <div class="fulfillment-info">
            <div class="fulfillment-product">${f.emoji} ${f.product}</div>
            <div class="fulfillment-qty">Qty needed: <strong>${f.qty}</strong></div>
            <div class="fulfillment-meta">
              ${f.urgent ? '<span class="fulfillment-tag tag-urgent">Urgent</span>' : ''}
              <span class="fulfillment-tag tag-${f.urgent ? 'urgent' : 'new'} tag-pickup">Ready for pickup</span>
            </div>
            <button class="tbl-action-btn btn-edit" style="margin-top:8px;" onclick="window.showWaybill('${f.orderId}')">🧾 Waybill</button>
          </div>
          <div class="fulfillment-date">
            ${f.pickup}
            <span>${f.deadline}</span>
          </div>
        </div>
      `).join('');
      updateFulfillmentBulkBar();
    }

    window.toggleFulfillmentSelect = function(key, checked) {
      if (checked) fulfillmentSelection.add(key); else fulfillmentSelection.delete(key);
      updateFulfillmentBulkBar();
    };

    function updateFulfillmentBulkBar() {
      const bar = document.getElementById('fulfillment-bulk-bar');
      const countEl = document.getElementById('fulfillment-bulk-count');
      if (!bar) return;
      const n = fulfillmentSelection.size;
      bar.style.display = n > 0 ? 'flex' : 'none';
      if (countEl) countEl.textContent = n + (n === 1 ? ' selected' : ' selected');
    }

    window.clearFulfillmentSelection = function() {
      fulfillmentSelection.clear();
      renderFulfillments();
    };

    /* ── Batch order actions (v11.104) ──
       Lets a supplier select several pending line items at once and mark
       them all ready for pickup in one tap, instead of handling each order
       individually during a busy morning. */
    window.markSelectedFulfillmentsPrepared = async function() {
      const myId = getMyId();
      const fulfillmentsData = getFulfillmentsData();
      const selected = fulfillmentsData.filter(f => fulfillmentSelection.has(f.key));
      if (!selected.length) return;
      // Group by orderId, then apply as ONE write (see
      // markMultipleOrderItemsPrepared) — looping per-order writes here was
      // the actual cause of marked items reappearing: each order's write
      // fired its own full-table upload, and an earlier one completing
      // could clear sync-protection for a later one still in flight.
      const byOrder = {};
      selected.forEach(f => { (byOrder[f.orderId] = byOrder[f.orderId] || []).push(f.productId); });
      const btn = document.getElementById('fulfillment-mark-ready-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
      try {
        await window.SL.markMultipleOrderItemsPrepared(myId, byOrder);
        showToast(`✅ ${selected.length} item${selected.length === 1 ? '' : 's'} marked ready for pickup.`, 'success');
      } catch (e) {
        showToast('⚠️ Could not confirm with the server — please check your connection and try again.', 'error');
      }
      if (btn) { btn.disabled = false; btn.textContent = '✓ Mark Ready for Pickup'; }
      fulfillmentSelection.clear();
      renderFulfillments();
      if (typeof renderDashboard === 'function') renderDashboard();
    };


    // ── DASHBOARD ──
    function renderDashboard() {
      const u = window.SL.currentUser();
      if (!u) return;

      const firstName = (u.name || '').split(' ')[0] || u.name;
      const now = new Date();
      const dateLabel = now.toLocaleDateString('en-GH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const hour = now.getHours();
      const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
      document.getElementById('dash-date-greeting').textContent = `${dateLabel} · ${greeting}, ${firstName}!`;
      document.getElementById('dash-welcome-name').textContent = `Welcome back, ${u.name} 👋`;

      const fulfillments = getFulfillmentsData();
      refreshSupplierRequestBadges();
      const pendingMsgEl = document.getElementById('dash-pending-msg');
      pendingMsgEl.textContent = fulfillments.length === 0
        ? 'You have no pending fulfillment requests right now.'
        : `You have ${fulfillments.length} pending fulfillment request${fulfillments.length === 1 ? '' : 's'} waiting for preparation.`;

      const sidebarBadge = document.getElementById('fulfillment-sidebar-badge');
      if (sidebarBadge) {
        sidebarBadge.textContent = fulfillments.length;
        sidebarBadge.style.display = fulfillments.length > 0 ? '' : 'none';
      }

      document.getElementById('dash-account-status').textContent = u.status === 'active' ? '✓ Active' : capitalize(u.status || '');

      const lowStockProducts = products.filter(p => p.stock > 0 && p.stock <= 5);
      document.getElementById('dash-stat-listings').textContent = products.filter(p => p.available).length;
      document.getElementById('dash-stat-pending').textContent = fulfillments.length;
      document.getElementById('dash-stat-lowstock').textContent = lowStockProducts.length;

      const previewEl = document.getElementById('dash-fulfillment-preview');
      if (fulfillments.length === 0) {
        previewEl.innerHTML = '<p style="text-align:center;color:var(--ink-3);padding:20px 0;">No pending fulfillment requests — new orders will show up here.</p>';
      } else {
        previewEl.innerHTML = fulfillments.slice(0, 2).map(f => `
          <div class="fulfillment-card${f.urgent ? ' urgent' : ''}">
            <div class="fulfillment-icon">
              <svg viewBox="0 0 24 24"><path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
            </div>
            <div class="fulfillment-info">
              <div class="fulfillment-product">${f.emoji} ${f.product}</div>
              <div class="fulfillment-qty">Qty needed: <strong>${f.qty}</strong></div>
              <div class="fulfillment-meta">
                ${f.urgent ? '<span class="fulfillment-tag tag-urgent">Urgent</span>' : ''}
                <span class="fulfillment-tag tag-${f.urgent ? 'urgent' : 'new'} tag-pickup">Ready for pickup</span>
              </div>
            </div>
            <div class="fulfillment-date">
              ${f.pickup}
              <span>${f.deadline}</span>
            </div>
          </div>`).join('');
      }

      const lowStockEl = document.getElementById('dash-low-stock-list');
      if (lowStockProducts.length === 0) {
        lowStockEl.innerHTML = '<p style="text-align:center;color:var(--ink-3);padding:10px 0;">All your products are well stocked.</p>';
      } else {
        const THREE_DAYS = 3 * 86400000;
        lowStockEl.innerHTML = lowStockProducts.map(p => {
          const daysLow = p.lowStockSince ? Math.floor((Date.now() - p.lowStockSince) / 86400000) : 0;
          const escalated = p.lowStockSince && (Date.now() - p.lowStockSince) > THREE_DAYS;
          return `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:${escalated ? '#FEE2E2' : 'var(--warning-light)'};border-radius:var(--radius-md);border:1px solid ${escalated ? 'rgba(185,28,28,.3)' : 'rgba(180,83,9,.2)'};">
            <div>
              <div style="font-size:14px;font-weight:700;color:var(--ink);">${p.name}</div>
              <div style="font-size:12px;color:${escalated ? '#B91C1C' : 'var(--warning)'};margin-top:2px;font-weight:${escalated ? '700' : '400'};">
                Only ${p.stock} ${p.unit}${p.stock === 1 ? '' : 's'} remaining${escalated ? ` — low for ${daysLow} day${daysLow === 1 ? '' : 's'}` : ''}
              </div>
            </div>
            <button class="tbl-action-btn btn-edit" onclick="goTo('products')">Update Stock</button>
          </div>`;
        }).join('');
      }
    }

    // ── PROFILE ──
    function initialsOf(name) {
      if (!name) return '—';
      const parts = name.trim().split(/\s+/);
      return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    function renderMyProfile() {
      const u = window.SL.currentUser();
      if (!u) return;

      document.getElementById('profile-avatar-initials').textContent = initialsOf(u.name);
      document.getElementById('profile-name-display').textContent = u.name;
      document.getElementById('profile-status-label').textContent = capitalize(u.status || '');
      document.getElementById('profile-info-name').textContent = u.name;
      document.getElementById('profile-info-biztype').textContent = capitalize(u.bizType || '—');
      document.getElementById('profile-info-location').textContent = u.location || '—';
      document.getElementById('profile-info-phone').textContent = u.phone ? u.phone.slice(0, 3) + ' ••• ••••' : '—';
      document.getElementById('profile-info-membersince').textContent = u.createdAt
        ? new Date(u.createdAt).toLocaleDateString('en-GH', { month: 'long', year: 'numeric' })
        : '—';
      document.getElementById('profile-info-activeproducts').textContent = `${products.length} listing${products.length === 1 ? '' : 's'}`;

      const networkNames = { mtn: 'MTN Mobile Money', voda: 'Vodafone Cash', airtel: 'AirtelTigo Money' };
      const net = u.momoNetwork || 'mtn';
      document.getElementById('profile-momo-icon').className = 'momo-icon ' + net;
      document.getElementById('profile-momo-icon').textContent = net === 'mtn' ? 'MTN' : net === 'voda' ? 'VOD' : 'AT';
      document.getElementById('profile-momo-network').textContent = networkNames[net] || 'MTN Mobile Money';
      document.getElementById('profile-momo-num').textContent = u.momo ? u.momo.slice(0, 3) + ' ••• ••••' : '—';

      document.getElementById('profile-edit-name').value = u.name || '';
      document.getElementById('profile-edit-biztype').value = u.bizType || 'wholesaler';
      document.getElementById('profile-edit-location').value = u.location || '';
    }

    function saveProfileEdits() {
      const u = window.SL.currentUser();
      if (!u) return;
      const name = document.getElementById('profile-edit-name').value.trim();
      const bizType = document.getElementById('profile-edit-biztype').value;
      const location = document.getElementById('profile-edit-location').value.trim();

      if (!name || !location) {
        showToast('Name and location cannot be empty.', 'error');
        return;
      }

      window.SL.updateUser(u.id, { name, bizType, location });
      renderMyProfile();
      if (typeof window.slUpdateTopbar === 'function') window.slUpdateTopbar();
      showToast('Profile updated successfully.', 'success');
    }

    // ── MOMO MODAL ──
    function openMomoModal() {
      const u = window.SL.currentUser();
      if (u) {
        document.getElementById('momo-modal-network').value = u.momoNetwork || 'mtn';
        document.getElementById('momo-modal-number').value = u.momo || '';
      }
      document.getElementById('momo-modal').classList.add('open');
      window.slPushOverlay(closeMomoModal);
    }
    function closeMomoModal() {
      document.getElementById('momo-modal').classList.remove('open');
      window.slPopOverlay();
    }
    function saveMomo() {
      const u = window.SL.currentUser();
      if (!u) return;
      const momoNetwork = document.getElementById('momo-modal-network').value;
      const momo = document.getElementById('momo-modal-number').value.trim();
      if (!momo) {
        showToast('Enter a MoMo number.', 'error');
        return;
      }
      window.SL.updateUser(u.id, { momo, momoNetwork });
      renderMyProfile();
      closeMomoModal();
      showToast('MoMo details saved.', 'success');
    }

    // ── HELPERS ──
    function showErr(id, msg) {
      const el = document.getElementById(id);
      if (el) { el.textContent = msg; el.classList.add('show'); }
      const inputId = id.replace('err-', '');
      const input = document.getElementById(inputId);
      if (input) input.classList.add('error');
    }
    function clearAllErrors() {
      document.querySelectorAll('#view-supplier .field-error').forEach(e => e.classList.remove('show'));
      document.querySelectorAll('#view-supplier .field-input, #view-supplier .field-select').forEach(e => e.classList.remove('error'));
    }

    let toastTimer;
    function showToast(msg, type = '') {
      const t = document.getElementById('b5-toast');
      t.textContent = msg;
      t.className = 'toast show' + (type ? ' ' + type : '');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { t.classList.remove('show'); }, 2800);
    }

    // ── INIT ──
    window.SL.registerInit('supplier-portal', function() {
      loadMyProducts();
      renderProducts();
      renderFulfillments();
      renderDashboard();
      renderMyProfile();
    });
  
    /* expose inline-onclick functions to global scope */
    window.closeMomoModal=closeMomoModal; window.deleteProduct=deleteProduct;
    window.editProduct=editProduct; window.goTo=goTo;
    window.openMomoModal=openMomoModal; window.saveMomo=saveMomo;
    window.submitProduct=submitProduct; window.toggleAvail=toggleAvail;
    window.generateDescription=generateDescription;
    window.handleProductPhotos=handleProductPhotos; window.removeProductPhoto=removeProductPhoto;
    window.setProdSourceType=setProdSourceType;
    window.renderMyProfile=renderMyProfile; window.saveProfileEdits=saveProfileEdits;
    window.renderDashboard=renderDashboard;
  })();
  