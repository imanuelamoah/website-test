
(function() {
  'use strict';

  /* ── CONFIG ── */
  const LOW_STOCK_THRESHOLD = 10; // products at or below this are "low"

  /* ── STATE ── */
  let admFilter = 'all';
  let admEditingOrderId = null;
  let admSelectedStatus = null;
  let admSelectedSupplierId = null;
  let admSelectedIds = new Set(); // bulk-selection of order IDs

  const STATUS_CONFIG = [
    { key: 'pending',   label: 'Pending',          icon: '📋', desc: 'Awaiting your confirmation' },
    { key: 'confirmed', label: 'Confirmed',         icon: '✅', desc: 'Order confirmed with supplier' },
    { key: 'preparing', label: 'Being Prepared',   icon: '📦', desc: 'Supplier is packing the order' },
    { key: 'out',       label: 'Out for Delivery', icon: '🚚', desc: 'On the way to the buyer' },
    { key: 'delivered', label: 'Delivered',         icon: '🏠', desc: 'Order has been delivered' },
    { key: 'cancelled', label: 'Cancelled',         icon: '✕',  desc: 'Order was cancelled' },
  ];

  /* ── HELPERS ── */
  function fmtDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('en-GH', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }
  function fmtGHS(n) { return 'GH₵' + (n || 0).toFixed(2); }
  function statusClass(s) {
    return 'adm-status-' + (s || 'pending');
  }
  function statusLabel(s) {
    const c = STATUS_CONFIG.find(x => x.key === s);
    return c ? c.icon + ' ' + c.label : s || 'Pending';
  }

  /* ── LOAD AND RENDER ── */
  function admRender() {
    const orders = window.SL.getOrders() || [];
    // Sort newest-first by actual timestamp rather than relying on array
    // insertion order — cloud sync merges can return orders in a different
    // sequence than they were created, which made .reverse() unreliable.
    const filtered = (admFilter === 'all' ? orders : orders.filter(o => (o.status || 'pending') === admFilter))
      .slice()
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    // Stats
    document.getElementById('adm-stat-total').textContent   = orders.length;
    document.getElementById('adm-stat-pending').textContent = orders.filter(o => (o.status || 'pending') === 'pending').length;
    document.getElementById('adm-stat-active').textContent  = orders.filter(o => ['confirmed','preparing','out'].includes(o.status)).length;
    document.getElementById('adm-stat-done').textContent    = orders.filter(o => o.status === 'delivered').length;

    // Pending count badge
    const pendingN = orders.filter(o => (o.status || 'pending') === 'pending').length;
    document.getElementById('adm-pending-count').textContent = pendingN + ' Pending';

    // Render cards
    const container = document.getElementById('adm-order-list');
    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="adm-empty">
          <div class="adm-empty-icon">📭</div>
          <h4>${admFilter === 'all' ? 'No orders yet' : 'No ' + admFilter + ' orders'}</h4>
          <p>${admFilter === 'all' ? 'Orders placed by buyers will appear here.' : 'Switch the filter to see other orders.'}</p>
        </div>`;
      return;
    }

    container.innerHTML = filtered.map(o => {
      const itemsText = (o.items || []).map(i => `${i.qty}× ${i.productName}`).join(', ');
      const assignedSupp = o.assignedSupplier
        ? `<div class="adm-assigned-pill">${o.autoAssigned ? '📦 Auto-assigned' : '✅ Assigned'}: ${o.assignedSupplier}</div>`
        : `<div class="adm-assigned-pill" style="background:#fff3cd;color:#8a6d1a;">⚠️ Needs supplier assignment</div>`;
      const notifNote = o.supplierNote ? `<div style="font-size:12px;color:#6c757d;font-style:italic;margin-top:4px;">Note: "${o.supplierNote}"</div>` : '';

      // Ready-for-pickup readiness, aggregated from what suppliers have
      // marked prepared on their own line items (see markOrderItemsPrepared).
      // Only meaningful while the order is still pending assignment/pickup.
      const totalItems = (o.items || []).length;
      const preparedCount = (o.items || []).filter(i => i.prepared).length;
      let readinessHtml = '';
      // Widened past just 'pending': by the time a supplier can actually mark
      // items prepared, the order has usually already been auto-assigned to
      // them and moved to 'confirmed' (assignment happens before physical
      // prep, not after) — so gating this on 'pending' meant the pill almost
      // never showed in real use. It stays relevant through 'preparing' too,
      // since that status just means "packing in progress," not "done."
      const readinessRelevant = ['pending', 'confirmed', 'preparing'].includes(o.status || 'pending');
      if (readinessRelevant && totalItems > 0 && preparedCount > 0) {
        readinessHtml = preparedCount === totalItems
          ? `<div class="adm-assigned-pill" style="background:#DCFCE7;color:#166534;">✅ Ready for pickup — all ${totalItems} item${totalItems === 1 ? '' : 's'} prepared</div>`
          : `<div class="adm-assigned-pill" style="background:#FEF3C7;color:#92400E;">🔶 Partially ready — ${preparedCount} of ${totalItems} items prepared</div>`;
      }

      return `
        <div class="adm-order-card">
          <div class="adm-order-card-head">
            <div class="adm-order-head-left">
              <input type="checkbox" class="adm-order-cb" ${admSelectedIds.has(o.id) ? 'checked' : ''} onchange="admToggleOrderSelect('${o.id}', this.checked)">
              <div>
                <div class="adm-order-id">${o.id}</div>
                <div class="adm-order-buyer">👤 ${o.buyerName || o.name || 'Buyer'} · ${o.buyerPhone || o.phone || ''}</div>
                ${o.riderName ? `<div class="adm-order-buyer">🛵 ${o.riderName}</div>` : ((o.status || 'pending') === 'out' ? '<div class="adm-order-buyer" style="color:#1A4731;">🔓 Unassigned — open to any rider</div>' : '')}
                <div class="adm-order-date">🕐 ${fmtDate(o.createdAt)}</div>
              </div>
            </div>
            <span class="adm-status-badge ${statusClass(o.status || 'pending')}">${statusLabel(o.status || 'pending')}</span>
          </div>
          <div class="adm-order-body">
            <div class="adm-order-items">🛍️ ${itemsText || 'No items'}</div>
            <div class="adm-order-meta">
              <span>💰 ${fmtGHS(o.total)}</span>
              <span>${o.address === 'In-person pickup' ? '🏪 Pickup' : '🚚 ' + (o.zone || o.address || 'Delivery')}</span>
              <span>${o.payment === 'momo' ? '📱 MoMo' : '💵 Pay on Delivery'}</span>
              ${o.slot !== undefined ? `<span>⏰ ${o.slot}</span>` : ''}
            </div>
            ${assignedSupp}
            ${readinessHtml}
            ${notifNote}
            ${o.deliveryIssue ? `
            <div style="background:#FDECEC;border:1px solid #E74C3C;border-radius:8px;padding:10px 12px;margin-bottom:10px;">
              <div style="font-size:12px;font-weight:700;color:#a12727;">⚠️ Delivery Issue — ${o.deliveryIssue.reasonLabel}</div>
              <div style="font-size:12px;color:#a12727;margin-top:2px;">Reported by ${o.deliveryIssue.riderName} · ${new Date(o.deliveryIssue.reportedAt).toLocaleString('en-GH')}</div>
              ${o.deliveryIssue.note ? `<div style="font-size:12px;color:#7a2323;margin-top:4px;font-style:italic;">"${o.deliveryIssue.note}"</div>` : ''}
              <button class="adm-btn" style="background:#E74C3C;color:#fff;margin-top:8px;" onclick="window.admResolveDeliveryIssue('${o.id}')">✓ Mark Resolved</button>
            </div>` : ''}
            <div class="adm-order-actions">
              <button class="adm-btn adm-btn-status" onclick="openStatusModal('${o.id}')">📋 Update Status</button>
              <button class="adm-btn adm-btn-assign" onclick="openAssignModal('${o.id}')">📤 Assign Supplier</button>
              <button class="adm-btn" style="background:#f1f3f5;color:#333;" onclick="window.showWaybill('${o.id}')">🧾 Waybill</button>
              ${(o.status || 'pending') !== 'delivered' && (o.status || 'pending') !== 'cancelled' ? `<button class="adm-btn" style="background:#f1f3f5;color:#333;" onclick="window.openRiderAssignModal('${o.id}')">🛵 ${o.riderId ? 'Reassign' : 'Assign'} Rider</button>` : ''}
              ${o.deliveryProof ? `<button class="adm-btn" style="background:#f1f3f5;color:#333;" onclick="window.showDeliveryProof('${o.id}')">🖊️ Proof</button>` : ''}
              ${(o.status || 'pending') !== 'cancelled' ? `<button class="adm-btn adm-btn-cancel" onclick="admCancelOrder('${o.id}')">✕ Cancel</button>` : ''}
            </div>
          </div>
        </div>`;
    }).join('');

    // Low-stock
    admCheckLowStock();
    admUpdateBulkBar();
  }

  /* ── LOW STOCK ALERT ── */
  function admCheckLowStock() {
    const products = window.SL.getProducts() || [];
    // Exclude soft-deleted products — matches the !p.deleted convention already
    // used in Product Management's own stats. Without it, a deleted product's
    // stockQty is frozen at whatever it was when it was removed, so a product
    // deleted while low/out of stock stayed stuck in this banner (and kept
    // triggering the supplier auto-nudge below) forever, even though it no
    // longer exists in the catalogue.
    const lowItems = products.filter(p => !p.deleted && p.stockQty <= LOW_STOCK_THRESHOLD);

    const banner = document.getElementById('adm-low-stock-banner');
    if (lowItems.length === 0) {
      banner.style.display = 'none';
      return;
    }
    banner.style.display = 'block';
    document.getElementById('adm-low-stock-count').textContent = lowItems.length;
    document.getElementById('adm-low-stock-chips').innerHTML = lowItems.map(p =>
      `<span class="ls-chip${p.stockQty === 0 ? ' ls-out' : ''}">${p.name} (${p.stockQty === 0 ? 'Out' : p.stockQty + ' left'})</span>`
    ).join('');

    admNudgeLowStockSuppliers(lowItems);
  }

  /* ── AUTO-NUDGE SUPPLIERS ON LOW STOCK ──────────────────────
     Sends an in-app notification (bell icon) to the supplier who
     owns each low-stock product, once per product per calendar day,
     so admin isn't the only one who sees the alert. No SMS/backend
     required — reuses the existing window.SL.addNotification store.
     Matching is by supplier name (case-insensitive) against
     registered supplier accounts in sl_users — if no matching
     account is found, the nudge is skipped for that product. ─── */
  function admNudgeLowStockSuppliers(lowItems) {
    if (!window.SL || !window.SL.addNotification) return;
    const today = new Date().toISOString().slice(0, 10);
    const nudgeLog = JSON.parse(localStorage.getItem('sl_low_stock_nudges') || '{}');
    const users = JSON.parse(localStorage.getItem('sl_users') || '[]');
    let dirty = false;

    lowItems.forEach(p => {
      const key = p.id + '_' + today;
      if (nudgeLog[key]) return;
      const supplierUser = users.find(u => u.role === 'supplier' && u.name &&
        p.supplierName && u.name.trim().toLowerCase() === p.supplierName.trim().toLowerCase());
      if (!supplierUser) return;

      const message = p.stockQty === 0
        ? `⚠️ "${p.name}" is out of stock on SupplyLink. Restock soon to avoid missing orders.`
        : `⚠️ Low stock: "${p.name}" has only ${p.stockQty} left. Consider restocking soon.`;
      window.SL.addNotification({ userId: supplierUser.id, message, type: 'lowstock' });
      nudgeLog[key] = true;
      dirty = true;
    });

    if (dirty) localStorage.setItem('sl_low_stock_nudges', JSON.stringify(nudgeLog));
  }

  window.openLowStockModal = function() {
    const products = window.SL.getProducts() || [];
    const lowItems = products.filter(p => !p.deleted && p.stockQty <= LOW_STOCK_THRESHOLD);
    const list = document.getElementById('adm-lowstock-list');
    list.innerHTML = lowItems.map(p => {
      const cls = p.stockQty === 0 ? 'ls-detail-stock-zero' : p.stockQty <= 5 ? 'ls-detail-stock-low' : 'ls-detail-stock-ok';
      return `
        <div class="ls-detail-item">
          <div>
            <div class="ls-detail-name">${p.name}</div>
            <div class="ls-detail-sup">Supplier: ${p.supplierName || '—'} · ${p.category}</div>
          </div>
          <span class="adm-status-badge ${cls}" style="border-radius:6px;padding:4px 10px;font-size:11px;font-weight:700;">
            ${p.stockQty === 0 ? 'Out of stock' : p.stockQty + ' left'}
          </span>
        </div>`;
    }).join('');
    openAdmModal('lowstock');
  };

  /* ── FILTER ── */
  window.admSetFilter = function(filter, btn) {
    admFilter = filter;
    document.querySelectorAll('#view-admin-orders .adm-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    admRender();
  };

  /* ── STATUS MODAL ── */
  window.openStatusModal = function(orderId) {
    admEditingOrderId = orderId;
    const orders = window.SL.getOrders() || [];
    const order = orders.find(o => o.id === orderId);
    admSelectedStatus = order ? (order.status || 'pending') : 'pending';

    document.getElementById('adm-modal-order-id').textContent = 'Order ' + orderId;

    const opts = document.getElementById('adm-status-options');
    opts.innerHTML = STATUS_CONFIG.map(s => `
      <div class="adm-status-opt ${admSelectedStatus === s.key ? 'selected' : ''}"
           onclick="admPickStatus('${s.key}', this)">
        <div class="adm-status-opt-icon">${s.icon}</div>
        <div>
          <div class="adm-status-opt-label">${s.label}</div>
          <div class="adm-status-opt-desc">${s.desc}</div>
        </div>
      </div>`).join('');

    openAdmModal('status');
  };

  window.admPickStatus = function(key, el) {
    admSelectedStatus = key;
    document.querySelectorAll('#adm-status-options .adm-status-opt').forEach(e => e.classList.remove('selected'));
    el.classList.add('selected');
  };

  /* ── SHARED: apply a status change to one order (in-place on the orders array)
       and fire the matching buyer SMS. Used by both the single-order modal
       and the bulk action bar so the two flows always stay in sync. ── */
  function admChangeOrderStatus(orders, idx, newStatus) {
    orders[idx].status = newStatus;
    if (newStatus === 'out') orders[idx].outAt = Date.now();
    if (newStatus === 'delivered') orders[idx].deliveredAt = Date.now();
    const order = orders[idx];
    const buyerPhone = order.buyerPhone || order.phone;
    const buyerName  = order.buyerName  || order.name || 'Customer';
    const statusMessages = {
      confirmed:  'Great news! Your order ' + order.id + ' has been CONFIRMED by SupplyLink GH. We are preparing it for you.',
      preparing:  'Your order ' + order.id + ' is now being PREPARED. It will be ready for delivery soon.',
      out:        'Your order ' + order.id + ' is OUT FOR DELIVERY! Your rider is on the way. Please be available.',
      delivered:  'Your order ' + order.id + ' has been DELIVERED. Thank you for choosing SupplyLink GH! Rate us: 0XXXXXXXXX',
      cancelled:  'We are sorry. Your order ' + order.id + ' has been CANCELLED. Contact us: 0XXXXXXXXX for support or a refund.'
    };
    const smsText = statusMessages[newStatus];
    if (smsText && buyerPhone) {
      window.SL.sms({
        to: buyerPhone,
        message: 'SupplyLink GH: Hi ' + buyerName + '! ' + smsText,
        event: 'status_' + newStatus,
        orderId: order.id
      });
    }
    if (smsText && order.buyerId && window.SL.addNotification) {
      window.SL.addNotification({
        userId: order.buyerId,
        message: smsText,
        orderId: order.id,
        type: 'order_status'
      });
    }
    if (newStatus === 'delivered' && order.buyerId && window.SL.rewardReferralIfEligible) {
      window.SL.rewardReferralIfEligible(order.buyerId);
    }
  }

  window.saveAdmStatus = async function() {
    if (!admEditingOrderId || !admSelectedStatus) return;

    if (admSelectedStatus === 'delivered') {
      closeAdmModal('status');
      openDeliveryProofModal(admEditingOrderId);
      return;
    }

    const orders = window.SL.getOrders() || [];
    const idx = orders.findIndex(o => o.id === admEditingOrderId);
    if (idx !== -1) {
      // Same class of fix as the supplier's "Ready for Pickup" action:
      // this write pushes the device's ENTIRE local orders array, so if
      // Admin's local copy is even a few seconds stale, saving here can
      // silently overwrite some other concurrent change to a DIFFERENT
      // order (e.g. a supplier's "prepared" flag) with Admin's older
      // snapshot of it. Refresh this one row from the cloud first so the
      // rest of the array reflects the latest known state before we push.
      if (window.SL_sb) {
        try {
          const { data, error } = await window.SL_sb.from('orders').select('*').eq('id', admEditingOrderId).limit(1);
          if (!error && data && data[0]) orders[idx] = Object.assign({}, orders[idx], data[0]);
        } catch (e) { /* offline — fall back to local copy */ }
      }
      admChangeOrderStatus(orders, idx, admSelectedStatus);
      localStorage.setItem('sl_orders', JSON.stringify(orders));
    }
    closeAdmModal('status');
    admRender();
    admShowToast('Order status updated to ' + statusLabel(admSelectedStatus));
  };

  /* ── PROOF OF DELIVERY ──
     Marking an order "Delivered" requires a recipient name + hand-drawn
     signature, so there's proof of handoff to the right person — not just
     proof that the item was packed. Stored on order.deliveryProof. ── */
  let sigCtx = null, sigDrawing = false, sigHasDrawn = false;

  function closeDeliveryProofModal() {
    const modal = document.getElementById('admDeliveryProofModal');
    if (modal) modal.remove();
    window.slPopOverlay();
  }
  window.closeDeliveryProofModal = closeDeliveryProofModal;

  function openDeliveryProofModal(orderId) {
    const order = (window.SL.getOrders() || []).find(o => o.id === orderId);
    if (!order) return;
    const existing = document.getElementById('admDeliveryProofModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'admDeliveryProofModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:4100;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:22px;max-width:420px;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-height:92vh;overflow-y:auto;">
        <div style="font-size:16px;font-weight:700;margin-bottom:2px;">Confirm Delivery — ${order.id}</div>
        <div style="font-size:13px;color:#777;margin-bottom:16px;">Capture proof of handoff before this order is marked Delivered.</div>

        <label style="font-size:12px;font-weight:700;color:#333;">Received By</label>
        <input type="text" id="admProofRecipient" value="${(order.buyerName || '').replace(/"/g,'')}" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:10px;font-size:13px;margin:6px 0 14px;box-sizing:border-box;">

        <label style="font-size:12px;font-weight:700;color:#333;">Signature</label>
        <div style="border:1px solid #ddd;border-radius:10px;margin:6px 0 4px;overflow:hidden;">
          <canvas id="admProofCanvas" style="width:100%;height:140px;display:block;touch-action:none;background:#fafafa;"></canvas>
        </div>
        <button type="button" style="background:none;border:none;color:#1A4731;font-size:12px;font-weight:700;cursor:pointer;padding:0 0 12px;" onclick="window.__admClearSignature()">↺ Clear signature</button>

        <label style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:#333;margin:8px 0 16px;">
          <input type="checkbox" id="admProofConfirmCb" style="margin-top:2px;">
          <span>I confirm this order was physically handed over to the recipient above.</span>
        </label>

        <div style="display:flex;gap:10px;">
          <button style="flex:1;background:#f1f3f5;color:#333;border:none;padding:12px;border-radius:10px;font-weight:700;cursor:pointer;" onclick="window.closeDeliveryProofModal()">Cancel</button>
          <button id="admProofConfirmBtn" style="flex:1;background:#1A4731;color:#fff;border:none;padding:12px;border-radius:10px;font-weight:700;cursor:pointer;" onclick="window.__admConfirmDelivery('${orderId}')">✓ Confirm Delivery</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    window.slPushOverlay(closeDeliveryProofModal);
    setupSignaturePad();
  }

  function setupSignaturePad() {
    const canvas = document.getElementById('admProofCanvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    sigCtx = canvas.getContext('2d');
    sigCtx.strokeStyle = '#1A4731';
    sigCtx.lineWidth = 2.2;
    sigCtx.lineJoin = 'round';
    sigCtx.lineCap = 'round';
    sigDrawing = false;
    sigHasDrawn = false;

    function pos(e) {
      const r = canvas.getBoundingClientRect();
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: cx - r.left, y: cy - r.top };
    }
    function start(e) { sigDrawing = true; sigHasDrawn = true; const p = pos(e); sigCtx.beginPath(); sigCtx.moveTo(p.x, p.y); e.preventDefault(); }
    function move(e)  { if (!sigDrawing) return; const p = pos(e); sigCtx.lineTo(p.x, p.y); sigCtx.stroke(); e.preventDefault(); }
    function end()    { sigDrawing = false; }

    canvas.onmousedown = start; canvas.onmousemove = move; canvas.onmouseup = end; canvas.onmouseleave = end;
    canvas.ontouchstart = start; canvas.ontouchmove = move; canvas.ontouchend = end;
  }

  window.__admClearSignature = function() {
    const canvas = document.getElementById('admProofCanvas');
    if (!canvas || !sigCtx) return;
    sigCtx.clearRect(0, 0, canvas.width, canvas.height);
    sigHasDrawn = false;
  };

  window.__admConfirmDelivery = async function(orderId) {
    const recipientEl = document.getElementById('admProofRecipient');
    const confirmCb = document.getElementById('admProofConfirmCb');
    const recipient = (recipientEl.value || '').trim();

    if (!recipient) { alert('Please enter who received the order.'); return; }
    if (!sigHasDrawn) { alert('Please capture a signature before confirming.'); return; }
    if (!confirmCb.checked) { alert('Please tick the confirmation checkbox.'); return; }

    const canvas = document.getElementById('admProofCanvas');
    const signatureDataUrl = canvas.toDataURL('image/png');

    // Upload the signature to Storage rather than keeping it as base64 —
    // same graceful fallback as photo uploads elsewhere: if it fails (e.g.
    // offline) the order still gets confirmed, just with the signature
    // stored locally only until it can be re-uploaded.
    const btn = document.getElementById('admProofConfirmBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Confirming…'; }
    let signature = signatureDataUrl;
    try {
      signature = await window.SL.uploadDataUrlImage(signatureDataUrl, 'delivery-proofs');
    } catch (e) { /* keep the base64 fallback already assigned above */ }

    const orders = window.SL.getOrders() || [];
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx === -1) return;

    const admin = window.SL.currentUser ? window.SL.currentUser() : null;
    orders[idx].deliveryProof = {
      recipientName: recipient,
      signature,
      confirmedAt: Date.now(),
      confirmedBy: admin ? admin.name : 'Admin'
    };
    admChangeOrderStatus(orders, idx, 'delivered');
    localStorage.setItem('sl_orders', JSON.stringify(orders));

    const modal = document.getElementById('admDeliveryProofModal');
    if (modal) { modal.remove(); window.slPopOverlay(); }
    admRender();
    admShowToast('✅ Delivery confirmed for ' + orderId);
  };

  /* View a previously captured proof of delivery */
  window.showDeliveryProof = function(orderId) {
    const order = (window.SL.getOrders() || []).find(o => o.id === orderId);
    if (!order || !order.deliveryProof) return;
    const p = order.deliveryProof;
    const existing = document.getElementById('admProofViewModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'admProofViewModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:4100;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:22px;max-width:420px;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
        <div style="font-size:16px;font-weight:700;margin-bottom:4px;">Proof of Delivery — ${order.id}</div>
        <div style="font-size:13px;color:#777;margin-bottom:16px;">Received by <strong>${p.recipientName}</strong> · ${new Date(p.confirmedAt).toLocaleString('en-GH')}</div>
        <div style="border:1px solid #eee;border-radius:10px;padding:8px;background:#fafafa;">
          <img src="${p.signature}" style="width:100%;display:block;">
        </div>
        <div style="font-size:12px;color:#999;margin-top:8px;">Confirmed by ${p.confirmedBy}</div>
        <button style="width:100%;margin-top:16px;background:#f1f3f5;color:#333;border:none;padding:12px;border-radius:10px;font-weight:700;cursor:pointer;" onclick="window.closeProofViewModal()">Close</button>
      </div>`;
    document.body.appendChild(modal);
    window.slPushOverlay(window.closeProofViewModal);
  };
  window.closeProofViewModal = function() {
    const modal = document.getElementById('admProofViewModal');
    if (modal) modal.remove();
    window.slPopOverlay();
  };

  /* ── BULK SELECTION ── */
  window.admToggleOrderSelect = function(orderId, checked) {
    if (checked) admSelectedIds.add(orderId);
    else admSelectedIds.delete(orderId);
    admUpdateBulkBar();
  };

  window.admToggleSelectAll = function(checked) {
    const orders = window.SL.getOrders() || [];
    const visible = admFilter === 'all' ? orders : orders.filter(o => (o.status || 'pending') === admFilter);
    visible.forEach(o => { checked ? admSelectedIds.add(o.id) : admSelectedIds.delete(o.id); });
    admRender();
  };

  window.admClearSelection = function() {
    admSelectedIds.clear();
    admRender();
  };

  function admUpdateBulkBar() {
    const bar = document.getElementById('adm-bulk-bar');
    const countEl = document.getElementById('adm-bulk-count');
    if (!bar || !countEl) return;
    const n = admSelectedIds.size;
    bar.style.display = n > 0 ? 'flex' : 'none';
    countEl.textContent = n + (n === 1 ? ' order selected' : ' orders selected');

    const selectAllCb = document.getElementById('adm-select-all-cb');
    if (selectAllCb) {
      const orders = window.SL.getOrders() || [];
      const visible = admFilter === 'all' ? orders : orders.filter(o => (o.status || 'pending') === admFilter);
      const visibleSelected = visible.filter(o => admSelectedIds.has(o.id)).length;
      selectAllCb.checked = visible.length > 0 && visibleSelected === visible.length;
      selectAllCb.indeterminate = visibleSelected > 0 && visibleSelected < visible.length;
    }
  }

  /* ── BULK STATUS APPLY (one-by-one via checkbox+Update Status still works fine too) ── */
  window.admApplyBulkStatus = function() {
    const n = admSelectedIds.size;
    if (n === 0) return;
    const newStatus = document.getElementById('adm-bulk-status-select').value;
    const label = statusLabel(newStatus);

    if (newStatus === 'delivered') {
      alert('Marking as Delivered requires a signature and recipient name for each order, so it can\'t be done in bulk. Please confirm delivery one order at a time using "📋 Update Status".');
      return;
    }

    if (!confirm('Move ' + n + (n === 1 ? ' order' : ' orders') + ' to "' + label + '"? Buyers will be notified by SMS.')) return;

    const orders = window.SL.getOrders() || [];
    let changed = 0;
    orders.forEach((o, idx) => {
      if (admSelectedIds.has(o.id)) {
        admChangeOrderStatus(orders, idx, newStatus);
        changed++;
      }
    });
    localStorage.setItem('sl_orders', JSON.stringify(orders));
    admSelectedIds.clear();
    admRender();
    admShowToast('✅ ' + changed + (changed === 1 ? ' order' : ' orders') + ' moved to ' + label);
  };

  /* ── CANCEL ORDER ── */
  window.admCancelOrder = function(orderId) {
    if (!confirm('Cancel order ' + orderId + '? This cannot be undone.')) return;
    const orders = window.SL.getOrders() || [];
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx !== -1) {
      orders[idx].status = 'cancelled';
      localStorage.setItem('sl_orders', JSON.stringify(orders));

      /* ── SMS: Order Cancelled (to buyer) ── */
      const order = orders[idx];
      const buyerPhone = order.buyerPhone || order.phone;
      const buyerName  = order.buyerName  || order.name || 'Customer';
      if (buyerPhone) {
        window.SL.sms({
          to: buyerPhone,
          message: 'SupplyLink GH: Hi ' + buyerName + ', we are sorry to inform you that order ' +
                   orderId + ' has been CANCELLED. Please contact us on 0XXXXXXXXX for support or to reorder.',
          event: 'order_cancelled',
          orderId: orderId
        });
      }
    }
    admRender();
    admShowToast('Order cancelled.');
  };

  /* ── SUPPLIER ASSIGNMENT MODAL ── */
  window.openAssignModal = function(orderId) {
    admEditingOrderId = orderId;
    admSelectedSupplierId = null;

    const orders = window.SL.getOrders() || [];
    const order = orders.find(o => o.id === orderId);

    document.getElementById('adm-assign-order-id').textContent = 'Order ' + orderId;

    // Show items summary
    const items = (order && order.items) || [];
    document.getElementById('adm-assign-items-summary').innerHTML =
      items.map(i => `<span style="font-weight:600;color:#1A4731;">${i.qty}×</span> ${i.productName}`).join('<br>') ||
      'No items';

    // Build supplier options from existing suppliers in the system
    const allSuppliers = getAdmSuppliers(order);
    const opts = document.getElementById('adm-supplier-options');
    opts.innerHTML = allSuppliers.map(s => `
      <div class="adm-supplier-opt ${(order && order.assignedSupplierId === s.id) ? 'selected' : ''}"
           onclick="admPickSupplier('${s.id}', '${s.name}', this)">
        <div class="adm-supp-avatar">${s.name.charAt(0).toUpperCase()}</div>
        <div>
          <div class="adm-supp-name">${s.name}</div>
          <div class="adm-supp-products">${s.products.join(', ') || 'Supplier'}</div>
        </div>
      </div>`).join('');

    // Pre-select if already assigned
    if (order && order.assignedSupplierId) admSelectedSupplierId = order.assignedSupplierId;

    // Reset notification area
    document.getElementById('adm-assign-note').value = (order && order.supplierNote) || '';
    document.getElementById('adm-notif-sent-msg').style.display = 'none';

    openAdmModal('assign');
  };

  function getAdmSuppliers(order) {
    const users = JSON.parse(localStorage.getItem('sl_users') || '[]');
    const suppUsers = users.filter(u => u.role === 'supplier' && u.status === 'active').map(u => ({ id: u.id, name: u.name || u.phone }));

    // Annotate with products relevant to this order
    const products = window.SL.getProducts() || [];
    const orderItems = order ? (order.items || []) : [];
    const suppIds = [...new Set(orderItems.map(i => i.supplierId).filter(Boolean))];

    return suppUsers.map(s => {
      const myProds = products.filter(p => p.supplierId === s.id).map(p => p.name);
      return { ...s, products: myProds, relevant: suppIds.includes(s.id) };
    }).sort((a, b) => (b.relevant ? 1 : 0) - (a.relevant ? 1 : 0));
  }

  window.admPickSupplier = function(id, name, el) {
    admSelectedSupplierId = id;
    document.querySelectorAll('#adm-supplier-options .adm-supplier-opt').forEach(e => e.classList.remove('selected'));
    el.classList.add('selected');
  };

  window.saveAdmAssign = function() {
    if (!admEditingOrderId || !admSelectedSupplierId) {
      admShowToast('Please select a supplier first.');
      return;
    }
    const orders = window.SL.getOrders() || [];
    const idx = orders.findIndex(o => o.id === admEditingOrderId);
    if (idx !== -1) {
      const supplierNameEl = document.querySelector('#adm-supplier-options .adm-supplier-opt.selected .adm-supp-name');
      const supplierName = supplierNameEl ? supplierNameEl.textContent : admSelectedSupplierId;
      const note = document.getElementById('adm-assign-note').value.trim();
      orders[idx].assignedSupplierId = admSelectedSupplierId;
      orders[idx].assignedSupplier   = supplierName;
      orders[idx].supplierNote       = note;
      localStorage.setItem('sl_orders', JSON.stringify(orders));

      /* ── SMS: Supplier Assigned (to supplier) ── */
      const order = orders[idx];
      const itemSummary = (order.items || []).map(i => i.qty + 'x ' + i.productName).join(', ');
      // Get supplier phone if they are a registered user
      const allUsers = JSON.parse(localStorage.getItem('sl_users') || '[]');
      const supplierUser = allUsers.find(u => u.id === admSelectedSupplierId);
      const supplierPhone = supplierUser ? supplierUser.phone : null;

      if (supplierPhone) {
        window.SL.sms({
          to: supplierPhone,
          message: 'SupplyLink GH [SUPPLIER ALERT]: Hi ' + supplierName + ', you have been assigned order ' +
                   order.id + '. Items needed: ' + itemSummary + '.' +
                   (note ? ' Note: ' + note : '') +
                   ' Delivery slot: ' + (order.slot || 'N/A') + '. Please prepare ASAP.',
          event: 'supplier_assigned',
          orderId: order.id
        });
      }

      /* ── SMS: Assignment Confirmation (to buyer) ── */
      const buyerPhone = order.buyerPhone || order.phone;
      const buyerName  = order.buyerName  || order.name || 'Customer';
      if (buyerPhone) {
        window.SL.sms({
          to: buyerPhone,
          message: 'SupplyLink GH: Hi ' + buyerName + '! Your order ' + order.id +
                   ' has been assigned to a supplier and is being prepared. ' +
                   'Delivery slot: ' + (order.slot || 'N/A') + '. We will keep you updated!',
          event: 'buyer_supplier_assigned',
          orderId: order.id
        });
      }
    }

    document.getElementById('adm-notif-sent-msg').style.display = 'flex';
    setTimeout(function() {
      closeAdmModal('assign');
      admRender();
      admShowToast('✅ Supplier assigned and notified for order ' + admEditingOrderId);
    }, 1800);
  };

  /* ── MODAL HELPERS ── */
  function openAdmModal(type) {
    document.getElementById('adm-' + type + '-modal').classList.add('open');
    window.slPushOverlay(function() { window.closeAdmModal(type); });
  }
  window.openAdmModal = openAdmModal; // exported: also called from the Suppliers/Buyers script block
  window.closeAdmModal = function(type) {
    document.getElementById('adm-' + type + '-modal').classList.remove('open');
    window.slPopOverlay();
  };

  /* ── TOAST ── */
  let admToastTimer;
  function admShowToast(msg) {
    let t = document.getElementById('adm-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'adm-toast';
      t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);background:#1A4731;color:#fff;padding:12px 22px;border-radius:10px;font-size:14px;font-weight:600;z-index:9999;opacity:0;transition:all .3s;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,.18);font-family:Plus Jakarta Sans,Inter,sans-serif;';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    t.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(admToastTimer);
    admToastTimer = setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateX(-50%) translateY(20px)';
    }, 3000);
  }
  window.admShowToast = admShowToast; // exported: also called from the Suppliers/Buyers script block

  /* ── INIT ── */
  window.SL.registerInit('admin-orders', function() {
    admFilter = 'all';
    admEditingOrderId = null;
    admSelectedStatus = null;
    admSelectedSupplierId = null;
    admSelectedIds.clear();
    // Reset filter chips
    document.querySelectorAll('#view-admin-orders .adm-chip').forEach(c => c.classList.remove('active'));
    const allChip = document.querySelector('#view-admin-orders .adm-chip[data-filter="all"]');
    if (allChip) allChip.classList.add('active');
    admRender();
    admRenderSmsLog();
  });

  /* ── SMS LOG FUNCTIONS ── */
  function admRenderSmsLog() {
    const log = window.SL.getSmsLog();
    const countEl = document.getElementById('adm-sms-count');
    const entriesEl = document.getElementById('adm-sms-entries');
    if (countEl) countEl.textContent = log.length;
    if (!entriesEl) return;

    if (log.length === 0) {
      entriesEl.innerHTML = '<div class="adm-sms-empty">📭 No SMS sent yet. They will appear here after order actions.</div>';
      return;
    }

    const eventLabels = {
      order_placed:            '🛒 Order Placed',
      supplier_assigned:       '🏭 Supplier Alert',
      buyer_supplier_assigned: '📦 Prep Started',
      status_confirmed:        '✅ Confirmed',
      status_preparing:        '🔧 Preparing',
      status_out:              '🚚 Out for Delivery',
      status_delivered:        '🎉 Delivered',
      status_cancelled:        '❌ Cancelled',
      order_cancelled:         '❌ Cancelled'
    };

    entriesEl.innerHTML = log.map(function(s) {
      const d = new Date(s.sentAt);
      const timeStr = d.toLocaleDateString('en-GH', { day:'2-digit', month:'short' }) +
                      ' ' + d.toLocaleTimeString('en-GH', { hour:'2-digit', minute:'2-digit' });
      const label = eventLabels[s.event] || s.event;
      return '<div class="adm-sms-entry">' +
        '<div class="adm-sms-meta">' +
          '<span class="adm-sms-to">📱 ' + s.to + '</span>' +
          '<span class="adm-sms-time">' + timeStr + '</span>' +
        '</div>' +
        '<span class="adm-sms-event ' + (s.event || '') + '">' + label + '</span>' +
        '<div class="adm-sms-message">' + s.message + '</div>' +
        (s.orderId ? '<div class="adm-sms-order-tag">Order: ' + s.orderId + ' · ' + s.status + '</div>' : '') +
      '</div>';
    }).join('');
  }

  window.admToggleSmsLog = function() {
    const body = document.getElementById('adm-sms-log-body');
    const toggle = document.getElementById('adm-sms-toggle');
    if (!body) return;
    const isOpen = body.classList.contains('open');
    body.classList.toggle('open');
    if (toggle) toggle.classList.toggle('open', !isOpen);
    if (!isOpen) admRenderSmsLog(); // refresh on open
  };

  window.admClearSmsLog = function() {
    if (!confirm('Clear all SMS logs? This cannot be undone.')) return;
    window.SL.clearSmsLog();
    admRenderSmsLog();
    admShowToast('SMS log cleared.');
  };

  // Expose to global scope for inline handlers
  window.admSetFilter = window.admSetFilter;
  window.openStatusModal = window.openStatusModal;
  window.admPickStatus = window.admPickStatus;
  window.saveAdmStatus = window.saveAdmStatus;
  window.openAssignModal = window.openAssignModal;
  window.admPickSupplier = window.admPickSupplier;
  window.saveAdmAssign = window.saveAdmAssign;
  window.closeAdmModal = window.closeAdmModal;
  window.admCancelOrder = window.admCancelOrder;
  window.openLowStockModal = window.openLowStockModal;
  window.admToggleSmsLog = window.admToggleSmsLog;
  window.admClearSmsLog = window.admClearSmsLog;
  window.admRender = admRender;
  window.admChangeOrderStatus = admChangeOrderStatus;
  window.admResolveDeliveryIssue = function(orderId) {
    const orders = window.SL.getOrders() || [];
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx === -1) return;
    delete orders[idx].deliveryIssue;
    localStorage.setItem('sl_orders', JSON.stringify(orders));
    admRender();
  };

})();
