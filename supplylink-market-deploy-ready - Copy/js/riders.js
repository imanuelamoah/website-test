
(function() {
  'use strict';

  /* ══ MANAGE RIDERS (Admin) ══ */

  /* Delivered count, this-week count, avg time from "Out for Delivery" to
     confirmed handoff, and cash-on-hand owed back to SupplyLink. */
  function computeRiderStats(riderId) {
    const orders = window.SL.getOrders() || [];
    const delivered = orders.filter(o => o.deliveryProof && o.deliveryProof.riderId === riderId);
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 3600 * 1000;
    const thisWeek = delivered.filter(o => o.deliveryProof.confirmedAt >= weekAgo).length;

    const cashOrders = delivered.filter(o => o.payment === 'pod');
    const cashCollected = cashOrders.reduce((s, o) => s + (o.total || 0), 0);
    const remitted = (window.SL.getCashRemittances() || [])
      .filter(r => r.riderId === riderId)
      .reduce((s, r) => s + (r.amount || 0), 0);
    const cashOutstanding = Math.max(0, cashCollected - remitted);

    const timed = delivered.filter(o => o.outAt && o.deliveryProof.confirmedAt > o.outAt);
    const avgMinutes = timed.length
      ? Math.round(timed.reduce((s, o) => s + (o.deliveryProof.confirmedAt - o.outAt), 0) / timed.length / 60000)
      : null;

    return { totalDelivered: delivered.length, thisWeek, cashCollected, remitted, cashOutstanding, avgMinutes };
  }

  window.admSaveRiderRate = function() {
    const el = document.getElementById('adm-rider-rate');
    const rate = parseFloat(el.value);
    window.SL.saveSettings({ riderRatePerDelivery: isNaN(rate) || rate < 0 ? 0 : rate });
    el.value = (window.SL.getSettings().riderRatePerDelivery || 0);
    if (typeof window.admShowToast === 'function') window.admShowToast('Rider pay rate saved.');
    else alert('Saved.');
  };

  function admRenderRemitRequests() {
    const panel = document.getElementById('adm-remit-requests-panel');
    if (!panel) return;
    const pending = (window.SL.getRemitRequests() || []).filter(r => r.status === 'pending');
    if (pending.length === 0) { panel.innerHTML = ''; return; }
    panel.innerHTML = `
      <div class="panel" style="margin-bottom:16px;border:1.5px solid #F4A623;">
        <div class="panel-header"><div class="panel-title">💵 Cash Handovers Awaiting Confirmation (${pending.length})</div></div>
        <div class="panel-body">
          ${pending.map(r => `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #f1f3f5;">
              <div>
                <div style="font-size:13px;font-weight:700;color:#333;">${r.riderName || 'Rider'} — GH₵${r.amount.toFixed(2)}</div>
                <div style="font-size:11px;color:#888;">Logged ${new Date(r.requestedAt).toLocaleString('en-GH',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
              </div>
              <div style="display:flex;gap:8px;flex-shrink:0;">
                <button class="adm-dir-btn" style="background:#FDECEC;color:#c0392b;" onclick="window.admRejectRemit('${r.id}')">✗</button>
                <button class="adm-dir-btn" style="background:#1A4731;color:#fff;" onclick="window.admConfirmRemit('${r.id}')">✓ Confirm</button>
              </div>
            </div>`).join('')}
        </div>
      </div>`;
  }

  window.admConfirmRemit = function(id) {
    if (!confirm('Confirm you physically received this cash?')) return;
    window.SL.resolveRemitRequest(id, 'confirmed');
    admRenderRemitRequests();
    admRiderRender();
  };
  window.admRejectRemit = function(id) {
    const reason = prompt("Reject this handover log? Add a quick note for the rider (optional):", '');
    if (reason === null) return;
    window.SL.resolveRemitRequest(id, 'rejected');
    admRenderRemitRequests();
  };

  function admRiderRender() {
    const rateEl = document.getElementById('adm-rider-rate');
    if (rateEl && document.activeElement !== rateEl) rateEl.value = (window.SL.getSettings().riderRatePerDelivery || 0);
    admRenderRemitRequests();
    const users = window.SL.getUsers() || [];
    const riders = users.filter(u => u.role === 'rider');
    const active = riders.filter(u => (u.status || 'active') === 'active').length;
    const suspended = riders.filter(u => u.status === 'suspended').length;
    const onlineCount = riders.filter(u => window.SL.isRiderOnline(u.id)).length;
    const totalCashOutstanding = riders.reduce((s, u) => s + computeRiderStats(u.id).cashOutstanding, 0);

    const countEl = document.getElementById('adm-rider-count');
    if (countEl) countEl.textContent = riders.length + ' Total';
    const totalEl = document.getElementById('adm-rider-stat-total');
    if (totalEl) totalEl.textContent = riders.length;
    const activeEl = document.getElementById('adm-rider-stat-active');
    if (activeEl) activeEl.textContent = active;
    const suspEl = document.getElementById('adm-rider-stat-suspended');
    if (suspEl) suspEl.textContent = suspended;
    const onlineEl = document.getElementById('adm-rider-stat-online');
    if (onlineEl) onlineEl.textContent = onlineCount;
    const cashEl = document.getElementById('adm-rider-stat-cash');
    if (cashEl) cashEl.textContent = 'GH₵' + totalCashOutstanding.toFixed(0);

    const listEl = document.getElementById('adm-rider-list');
    if (!listEl) return;
    if (riders.length === 0) {
      listEl.innerHTML = '<div class="adm-dir-empty">No riders added yet. Use the form above to add your first rider.</div>';
      return;
    }

    listEl.innerHTML = riders.map(u => {
      const status = u.status || 'active';
      const stats = computeRiderStats(u.id);
      const online = window.SL.isRiderOnline(u.id);
      const contactHtml = `<a class="adm-dir-btn call" href="tel:${u.phone || ''}">📞 Call</a><button class="adm-dir-btn message" onclick="admOpenMessageModal('${u.id}')">✉️ Message</button>`;
      const actionsHtml = status === 'suspended'
        ? `<div class="adm-dir-actions"><button class="adm-dir-btn reactivate" onclick="window.admRiderReactivate('${u.id}')">Reactivate</button></div>
           <div class="adm-dir-actions" style="margin-top:8px;">${contactHtml}</div>`
        : `<div class="adm-dir-actions"><button class="adm-dir-btn suspend" onclick="window.admRiderSuspend('${u.id}')">Suspend</button></div>
           <div class="adm-dir-actions" style="margin-top:8px;">${contactHtml}</div>`;
      return `
        <div class="adm-dir-card">
          <div class="adm-dir-top">
            <div class="adm-dir-avatar">${(u.name || '?').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase()}</div>
            <div>
              <div class="adm-dir-name">${u.name} ${status === 'suspended' ? '' : (online ? '<span style="color:#1A9D55;font-size:11px;font-weight:800;">🟢 Online</span>' : '<span style="color:#999;font-size:11px;font-weight:700;">⚫ Offline</span>')}</div>
              <div class="adm-dir-sub">📞 ${u.phone || '—'}</div>
            </div>
            <span class="adm-dir-badge st-${status === 'suspended' ? 'suspended' : 'active'}">${status}</span>
          </div>
          <div class="adm-dir-stats">
            <div class="adm-dir-stat"><div class="adm-dir-stat-val">${stats.totalDelivered}</div><div class="adm-dir-stat-lbl">Delivered</div></div>
            <div class="adm-dir-stat"><div class="adm-dir-stat-val">${stats.thisWeek}</div><div class="adm-dir-stat-lbl">This Week</div></div>
            <div class="adm-dir-stat"><div class="adm-dir-stat-val">${stats.avgMinutes !== null ? stats.avgMinutes + 'm' : '—'}</div><div class="adm-dir-stat-lbl">Avg Time</div></div>
          </div>
          ${stats.cashOutstanding > 0 ? `
          <div style="display:flex;justify-content:space-between;align-items:center;background:#FEF3DC;border:1px solid #F4A623;border-radius:8px;padding:10px 12px;margin-top:10px;">
            <div>
              <div style="font-size:12px;color:#7a4f00;font-weight:700;">💵 Cash to Collect: GH₵${stats.cashOutstanding.toFixed(2)}</div>
              <div style="font-size:11px;color:#7a4f00;">from ${cashOrders(u.id).length} Pay-on-Delivery order${cashOrders(u.id).length===1?'':'s'}</div>
            </div>
            <button class="adm-dir-btn" style="background:#F4A623;color:#1A4731;" onclick="window.admRiderRecordCash('${u.id}')">Record Received</button>
          </div>` : ''}
          ${actionsHtml}
        </div>`;
    }).join('');
  }

  function cashOrders(riderId) {
    const orders = window.SL.getOrders() || [];
    return orders.filter(o => o.deliveryProof && o.deliveryProof.riderId === riderId && o.payment === 'pod');
  }

  window.admRiderRecordCash = function(riderId) {
    const stats = computeRiderStats(riderId);
    if (stats.cashOutstanding <= 0) { alert('No outstanding cash for this rider.'); return; }
    const input = prompt('Amount received from this rider (GH₵):', stats.cashOutstanding.toFixed(2));
    if (input === null) return;
    const amount = parseFloat(input);
    if (isNaN(amount) || amount <= 0) { alert('Please enter a valid amount.'); return; }
    window.SL.addCashRemittance({ riderId, amount });
    admRiderRender();
  };

  window.admAddRider = async function() {
    const nameEl = document.getElementById('adm-rider-name');
    const phoneEl = document.getElementById('adm-rider-phone');
    const passEl = document.getElementById('adm-rider-password');
    const errEl = document.getElementById('adm-rider-form-error');
    errEl.style.display = 'none';

    const name = (nameEl.value || '').trim();
    const phone = (phoneEl.value || '').trim();
    const password = (passEl.value || '').trim();

    if (!name || !phone || !password) {
      errEl.textContent = 'Please fill in name, phone number, and password.';
      errEl.style.display = 'block';
      return;
    }
    const users = window.SL.getUsers() || [];
    if (users.some(u => u.phone === phone)) {
      errEl.textContent = 'That phone number is already registered to another account.';
      errEl.style.display = 'block';
      return;
    }

    const salt = window.SL.genSalt();
    const hash = await window.SL.hashPassword(password, salt);
    const newRider = {
      id: 'u' + Date.now().toString(36),
      name, phone, password_hash: hash, password_salt: salt,
      role: 'rider',
      status: 'active',
      createdAt: Date.now()
    };
    users.push(newRider);
    window.SL.saveUsers(users);

    nameEl.value = ''; phoneEl.value = ''; passEl.value = '';
    admRiderRender();
  };

  window.admRiderSuspend = function(id) {
    const users = window.SL.getUsers() || [];
    const u = users.find(x => x.id === id);
    if (!confirm('Suspend ' + (u ? u.name : 'this rider') + '? They will not be able to log in until reactivated.')) return;
    const idx = users.findIndex(x => x.id === id);
    if (idx === -1) return;
    users[idx].status = 'suspended';
    window.SL.saveUsers(users);
    admRiderRender();
  };

  window.admRiderReactivate = function(id) {
    const users = window.SL.getUsers() || [];
    const idx = users.findIndex(u => u.id === id);
    if (idx === -1) return;
    users[idx].status = 'active';
    window.SL.saveUsers(users);
    admRiderRender();
  };

  /* ══ DATA EXPORT (CSV, no external libraries) ══ */
  function toCSV(rows) {
    return rows.map(r => r.map(v => {
      const s = (v === null || v === undefined) ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n');
  }
  function downloadCSV(filename, rows) {
    const csv = toCSV(rows);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  function todayStamp() {
    return new Date().toISOString().slice(0, 10);
  }

  window.admExportOrders = function() {
    const orders = window.SL.getOrders() || [];
    const rows = [['Order ID','Buyer Name','Buyer Phone','Address','Status','Payment Method','Total (GHS)','Rider','Created At','Delivered At']];
    orders.forEach(o => rows.push([
      o.id, o.buyerName || '', o.buyerPhone || '', o.address || '', o.status || '',
      o.payment === 'momo' ? 'MoMo' : 'Pay on Delivery',
      (o.total || 0).toFixed(2),
      o.riderName || 'Unassigned',
      o.createdAt ? new Date(o.createdAt).toLocaleString('en-GH') : '',
      o.deliveredAt ? new Date(o.deliveredAt).toLocaleString('en-GH') : ''
    ]));
    downloadCSV('supplylink-orders-' + todayStamp() + '.csv', rows);
  };

  window.admExportPayouts = function() {
    const lines = (typeof window.getPayoutLines === 'function') ? window.getPayoutLines() : [];
    const rows = [['Order ID','Supplier','MoMo Number','Amount (GHS)','Status','Paid At']];
    lines.forEach(l => rows.push([
      l.orderId, l.supplierName || '', l.momo || '', (l.amount || 0).toFixed(2),
      l.status || 'unpaid', l.paidAt ? new Date(l.paidAt).toLocaleString('en-GH') : ''
    ]));
    downloadCSV('supplylink-payouts-' + todayStamp() + '.csv', rows);
  };

  window.admExportRefunds = function() {
    const refunds = window.SL.getRefunds() || [];
    const rows = [['Refund ID','Order ID','Buyer','Reason','Amount Requested (GHS)','Status','Method','Admin Note','Submitted At']];
    refunds.forEach(r => rows.push([
      r.id, r.orderId, r.buyerName || '', r.reasonLabel || r.reason || '',
      (r.amountRequested || 0).toFixed(2), r.status || '', r.method || '',
      r.adminNote || '', r.createdAt ? new Date(r.createdAt).toLocaleString('en-GH') : ''
    ]));
    downloadCSV('supplylink-refunds-' + todayStamp() + '.csv', rows);
  };

  window.admExportRiders = function() {
    const riders = (window.SL.getUsers() || []).filter(u => u.role === 'rider');
    const rows = [['Name','Phone','Status','Total Delivered','This Week','Avg Delivery Time (min)','Cash Collected (GHS)','Cash Remitted (GHS)','Cash Outstanding (GHS)']];
    riders.forEach(u => {
      const s = computeRiderStats(u.id);
      rows.push([
        u.name, u.phone || '', u.status || 'active', s.totalDelivered, s.thisWeek,
        s.avgMinutes !== null ? s.avgMinutes : '',
        s.cashCollected.toFixed(2), s.remitted.toFixed(2), s.cashOutstanding.toFixed(2)
      ]);
    });
    downloadCSV('supplylink-riders-' + todayStamp() + '.csv', rows);
  };

  window.SL.registerInit('admin-riders', admRiderRender);

  /* ══ ASSIGN RIDER (Admin, per order) ══ */
  let admRiderAssignOrderId = null, admRiderAssignPickedId = null;

  window.openRiderAssignModal = function(orderId) {
    admRiderAssignOrderId = orderId;
    admRiderAssignPickedId = null;

    const order = (window.SL.getOrders() || []).find(o => o.id === orderId);
    const riders = (window.SL.getUsers() || []).filter(u => u.role === 'rider' && (u.status || 'active') === 'active');
    admRiderAssignPickedId = order ? (order.riderId || null) : null;

    const existing = document.getElementById('admRiderAssignModal');
    if (existing) existing.remove();

    const optionsHTML = riders.length ? riders.map(r => `
      <div class="adm-supplier-opt ${admRiderAssignPickedId === r.id ? 'selected' : ''}" onclick="window.__admPickRiderForAssign('${r.id}', this)">
        <div class="adm-supp-avatar">${r.name.charAt(0).toUpperCase()}</div>
        <div>
          <div class="adm-supp-name">${r.name}</div>
          <div class="adm-supp-products">📞 ${r.phone || ''}</div>
        </div>
      </div>`).join('') : '<div class="adm-dir-empty">No active riders yet. Add one from the Riders screen first.</div>';

    const modal = document.createElement('div');
    modal.id = 'admRiderAssignModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:4100;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:22px;max-width:420px;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-height:88vh;overflow-y:auto;">
        <div style="font-size:16px;font-weight:700;margin-bottom:2px;">Assign Rider — ${orderId}</div>
        <div style="font-size:13px;color:#777;margin-bottom:16px;">Only the assigned rider will see this order in their delivery list.</div>
        <div>${optionsHTML}</div>
        <div style="display:flex;gap:10px;margin-top:18px;">
          <button style="flex:1;background:#f1f3f5;color:#333;border:none;padding:12px;border-radius:10px;font-weight:700;cursor:pointer;" onclick="document.getElementById('admRiderAssignModal').remove()">Cancel</button>
          <button style="flex:1;background:#1A4731;color:#fff;border:none;padding:12px;border-radius:10px;font-weight:700;cursor:pointer;" onclick="window.__admSaveRiderAssign()">✓ Assign</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  };

  window.__admPickRiderForAssign = function(riderId, el) {
    admRiderAssignPickedId = riderId;
    document.querySelectorAll('#admRiderAssignModal .adm-supplier-opt').forEach(e => e.classList.remove('selected'));
    el.classList.add('selected');
  };

  window.__admSaveRiderAssign = function() {
    if (!admRiderAssignOrderId || !admRiderAssignPickedId) { alert('Please select a rider first.'); return; }
    const orders = window.SL.getOrders() || [];
    const idx = orders.findIndex(o => o.id === admRiderAssignOrderId);
    if (idx === -1) return;
    const rider = (window.SL.getUsers() || []).find(u => u.id === admRiderAssignPickedId);

    orders[idx].riderId = admRiderAssignPickedId;
    orders[idx].riderName = rider ? rider.name : '';
    localStorage.setItem('sl_orders', JSON.stringify(orders));

    window.SL.addNotification({
      userId: admRiderAssignPickedId,
      message: `New delivery assigned: order ${admRiderAssignOrderId}.`,
      orderId: admRiderAssignOrderId,
      type: 'delivery_assigned'
    });

    const modal = document.getElementById('admRiderAssignModal');
    if (modal) modal.remove();
    if (typeof window.admRender === 'function') window.admRender();
  };

  /* ══ RIDER PORTAL ══ */
  let riderSigCtx = null, riderSigDrawing = false, riderSigHasDrawn = false;
  let riderConfirmPhoto = null;
  let riderActiveTab = 'active';

  window.riderSetTab = function(tab, btn) {
    riderActiveTab = tab;
    document.querySelectorAll('#view-rider-portal .rider-bottom-nav .bn-link').forEach(c => c.classList.remove('active'));
    if (btn) btn.classList.add('active');
    else {
      const match = document.getElementById('rbn-' + tab);
      if (match) match.classList.add('active');
    }
    const listEl = document.getElementById('rider-delivery-list');
    const statsEl = document.getElementById('rider-stats-panel');
    if (tab === 'stats') {
      if (listEl) listEl.style.display = 'none';
      if (statsEl) statsEl.style.display = 'block';
      riderRenderStats();
    } else {
      if (listEl) listEl.style.display = 'block';
      if (statsEl) statsEl.style.display = 'none';
      riderRenderDeliveries();
    }
  };

  function riderRenderStats() {
    const u = window.SL.currentUser ? window.SL.currentUser() : null;
    const statsEl = document.getElementById('rider-stats-panel');
    if (!u || !statsEl) return;

    const delivered = (window.SL.getOrders() || [])
      .filter(o => o.deliveryProof && o.deliveryProof.riderId === u.id);

    const now = Date.now();
    const weekAgo = now - 7 * 24 * 3600 * 1000;
    const monthAgo = now - 30 * 24 * 3600 * 1000;
    const thisWeek = delivered.filter(o => o.deliveryProof.confirmedAt >= weekAgo).length;
    const thisMonth = delivered.filter(o => o.deliveryProof.confirmedAt >= monthAgo).length;

    const timed = delivered.filter(o => o.outAt && o.deliveryProof.confirmedAt > o.outAt);
    const avgMinutes = timed.length
      ? Math.round(timed.reduce((s, o) => s + (o.deliveryProof.confirmedAt - o.outAt), 0) / timed.length / 60000)
      : null;

    // Last 7 days, oldest to newest
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - i);
      const dayStart = d.getTime();
      const dayEnd = dayStart + 24 * 3600 * 1000;
      const count = delivered.filter(o => o.deliveryProof.confirmedAt >= dayStart && o.deliveryProof.confirmedAt < dayEnd).length;
      days.push({ label: d.toLocaleDateString('en-GH', { weekday: 'short' }), count });
    }
    const maxCount = Math.max(1, ...days.map(d => d.count));

    // Earnings — per-delivery rate set by Admin (Riders screen). Falls back
    // to 0 (hidden) until Admin sets one, so a salaried-only setup doesn't
    // show a misleading GH₵0 "earned" figure by default.
    const rate = (window.SL.getSettings() || {}).riderRatePerDelivery || 0;
    const deliveredTodayCount = delivered.filter(o => o.deliveryProof.confirmedAt >= new Date().setHours(0,0,0,0)).length;
    const earningsHTML = rate > 0 ? `
      <div class="stats-row" style="grid-template-columns:repeat(2,1fr);margin-top:14px;">
        <div class="stat-card">
          <div class="stat-num">GH₵${(deliveredTodayCount * rate).toFixed(0)}</div>
          <div class="stat-label">Earned Today</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">GH₵${(thisWeek * rate).toFixed(0)}</div>
          <div class="stat-label">Earned This Week</div>
        </div>
      </div>` : '';

    // Shift/utilization — total hours + shift count this week, from the
    // Online/Offline toggle doubling as shift start/end.
    const shifts = (window.SL.getRiderShifts() || []).filter(s => s.riderId === u.id);
    const weekShifts = shifts.filter(s => s.startedAt >= weekAgo);
    const activeShift = window.SL.getActiveShift(u.id);
    const weekMs = weekShifts.reduce((sum, s) => sum + ((s.endedAt || Date.now()) - s.startedAt), 0);
    const shiftHTML = `
      <div class="panel" style="margin-top:16px;">
        <div class="panel-header"><div class="panel-title">Shift Activity</div></div>
        <div class="panel-body">
          <div style="display:flex;justify-content:space-between;font-size:13px;color:#333;padding:4px 0;">
            <span>Status</span><strong>${activeShift ? '🟢 Online now' : '⚫ Offline'}</strong>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:13px;color:#333;padding:4px 0;">
            <span>Shifts this week</span><strong>${weekShifts.length}</strong>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:13px;color:#333;padding:4px 0;">
            <span>Hours online this week</span><strong>${(weekMs / 3600000).toFixed(1)}h</strong>
          </div>
        </div>
      </div>`;

    // Remittance history — confirmed handovers plus anything still pending.
    const remits = (window.SL.getCashRemittances() || []).filter(r => r.riderId === u.id).slice(0, 5);
    const remitReqs = (window.SL.getRemitRequests() || []).filter(r => r.riderId === u.id && r.status !== 'confirmed').slice(0, 5);
    const remitHTML = (remits.length || remitReqs.length) ? `
      <div class="panel" style="margin-top:16px;">
        <div class="panel-header"><div class="panel-title">Recent Cash Handovers</div></div>
        <div class="panel-body">
          ${remitReqs.map(r => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:6px 0;border-bottom:1px solid #f1f3f5;"><span>${new Date(r.requestedAt).toLocaleDateString('en-GH',{day:'numeric',month:'short'})} · GH₵${r.amount.toFixed(2)}</span><strong style="color:${r.status==='rejected'?'#c0392b':'#7a4f00'};">${r.status==='rejected'?'✗ Rejected':'⏳ Pending'}</strong></div>`).join('')}
          ${remits.map(r => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:6px 0;border-bottom:1px solid #f1f3f5;"><span>${new Date(r.recordedAt).toLocaleDateString('en-GH',{day:'numeric',month:'short'})} · GH₵${r.amount.toFixed(2)}</span><strong style="color:#1A4731;">✓ Confirmed</strong></div>`).join('')}
        </div>
      </div>` : '';

    statsEl.innerHTML = `
      <div class="stats-row" style="grid-template-columns:repeat(2,1fr);margin-top:14px;">
        <div class="stat-card">
          <div class="stat-num">${delivered.length}</div>
          <div class="stat-label">Total Delivered</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">${thisWeek}</div>
          <div class="stat-label">This Week</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">${thisMonth}</div>
          <div class="stat-label">This Month</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">${avgMinutes !== null ? avgMinutes + 'm' : '—'}</div>
          <div class="stat-label">Avg Delivery Time</div>
        </div>
      </div>
      ${earningsHTML}
      <div class="panel" style="margin-top:16px;">
        <div class="panel-header"><div class="panel-title">Last 7 Days</div></div>
        <div class="panel-body">
          <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:8px;height:120px;">
            ${days.map(d => `
              <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;">
                <div style="font-size:11px;font-weight:700;color:#1A4731;margin-bottom:4px;">${d.count || ''}</div>
                <div style="width:100%;max-width:28px;background:${d.count > 0 ? '#1A4731' : '#eee'};border-radius:6px 6px 0 0;height:${Math.max(4, (d.count / maxCount) * 80)}px;"></div>
                <div style="font-size:10px;color:#888;margin-top:6px;">${d.label}</div>
              </div>`).join('')}
          </div>
        </div>
      </div>
      ${shiftHTML}
      ${remitHTML}`;
  }

  function riderCashOutstanding(riderId) {
    const orders = window.SL.getOrders() || [];
    const collected = orders
      .filter(o => o.deliveryProof && o.deliveryProof.riderId === riderId && o.payment === 'pod')
      .reduce((s, o) => s + (o.total || 0), 0);
    const remitted = (window.SL.getCashRemittances() || [])
      .filter(r => r.riderId === riderId)
      .reduce((s, r) => s + (r.amount || 0), 0);
    return Math.max(0, collected - remitted);
  }

  /* ══ ONLINE/OFFLINE TOGGLE (doubles as shift start/end) ══ */
  let riderShiftTickInterval = null;

  function riderFormatDuration(ms) {
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function riderUpdateOnlineToggleUI() {
    const u = window.SL.currentUser ? window.SL.currentUser() : null;
    if (!u || u.role !== 'rider') {
      if (riderShiftTickInterval) { clearInterval(riderShiftTickInterval); riderShiftTickInterval = null; }
      return;
    }
    const btn = document.getElementById('rider-online-toggle');
    const timerEl = document.getElementById('rider-shift-timer');
    if (!btn) return;
    const shift = window.SL.getActiveShift(u.id);
    if (shift) {
      btn.textContent = '🟢 Online';
      btn.style.background = '#F4A623';
      btn.style.color = '#1A4731';
      if (timerEl) timerEl.textContent = 'On shift ' + riderFormatDuration(Date.now() - shift.startedAt);
    } else {
      btn.textContent = '⚫ Go Online';
      btn.style.background = 'rgba(255,255,255,.18)';
      btn.style.color = '#fff';
      if (timerEl) timerEl.textContent = 'Offline — go online to appear in the available pool';
    }
  }

  window.riderToggleOnline = function() {
    const u = window.SL.currentUser ? window.SL.currentUser() : null;
    if (!u) return;
    const shift = window.SL.getActiveShift(u.id);
    if (shift) {
      window.SL.endRiderShift(u.id);
    } else {
      window.SL.startRiderShift(u.id);
    }
    riderUpdateOnlineToggleUI();
  };

  /* ══ OFFLINE NETWORK BANNER ══
     Ghana's mobile data can be patchy on delivery routes. Proof-of-delivery
     already saves to localStorage first and retries the cloud push in the
     background (see the sync engine + SL_retrySyncPending), so nothing is
     ever lost — but a rider standing at a door with no bars deserves to
     know that, instead of wondering if their signature actually went
     through. This banner makes that state visible instead of silent. */
  function riderRenderNetworkBanner() {
    const el = document.getElementById('rider-network-banner');
    if (!el) return;
    if (!navigator.onLine) {
      el.innerHTML = `<div style="background:#FDECEC;border:1px solid #E74C3C;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:#a12727;font-weight:700;">📴 You're offline. Confirmed deliveries are saved on this phone and will sync automatically once you're back online.</div>`;
      return;
    }
    const pending = (typeof window.SL_getPendingSyncCount === 'function') ? window.SL_getPendingSyncCount() : 0;
    el.innerHTML = pending > 0
      ? `<div style="background:#FEF3DC;border:1px solid #F4A623;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:#7a4f00;font-weight:700;">🔄 Syncing ${pending} item${pending===1?'':'s'} to the cloud…</div>`
      : '';
  }

  window.addEventListener('online', riderRenderNetworkBanner);
  window.addEventListener('offline', riderRenderNetworkBanner);

  /* ══ ZONE GROUPING — proximity proxy + batching ══
     There's no lat/lng geocoding in this app, so true distance sorting
     isn't available. Delivery zone (the fixed list a buyer picks at
     checkout) is the closest real signal to "near each other" already in
     the data, so it's used both to order a multi-stop rider's list and to
     flag batchable pickups in the Available pool. */
  function riderZoneKey(o) {
    return o.address === 'In-person pickup' ? 'Pickup' : (o.zone || o.address || 'Other');
  }

  function riderGroupByZone(orders) {
    const groups = {};
    orders.forEach(o => {
      const key = riderZoneKey(o);
      (groups[key] = groups[key] || []).push(o);
    });
    // Largest zone groups first (most batchable), then by earliest outAt within each group.
    return Object.keys(groups)
      .map(key => ({ key, orders: groups[key].sort((a, b) => (a.outAt || a.createdAt || 0) - (b.outAt || b.createdAt || 0)) }))
      .sort((a, b) => b.orders.length - a.orders.length || (a.orders[0].outAt || 0) - (b.orders[0].outAt || 0));
  }

  window.riderNavigateAll = function() {
    const u = window.SL.currentUser ? window.SL.currentUser() : null;
    if (!u) return;
    const orders = (window.SL.getOrders() || [])
      .filter(o => o.status === 'out' && o.riderId === u.id && o.address !== 'In-person pickup');
    if (orders.length === 0) { alert('No active deliveries with an address to navigate to.'); return; }
    const groups = riderGroupByZone(orders);
    const stops = [];
    groups.forEach(g => g.orders.forEach(o => stops.push(o.address || o.zone)));
    // Google Maps directions supports destination + up to ~9 intermediate waypoints.
    const capped = stops.slice(0, 10);
    const destination = capped[capped.length - 1];
    const waypoints = capped.slice(0, -1);
    let url = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(destination) + '&travelmode=driving';
    if (waypoints.length) url += '&waypoints=' + waypoints.map(encodeURIComponent).join('|');
    window.open(url, '_blank', 'noopener');
  };

  window.riderOpenRemitModal = function() {
    const u = window.SL.currentUser ? window.SL.currentUser() : null;
    if (!u) return;
    const outstanding = riderCashOutstanding(u.id);
    const existing = document.getElementById('riderRemitModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'riderRemitModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:4100;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:22px;max-width:400px;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
        <div style="font-size:16px;font-weight:700;margin-bottom:2px;">Log Cash Handover</div>
        <div style="font-size:13px;color:#777;margin-bottom:16px;">Tell Admin you've handed this over. It'll show as pending until they confirm they received it in person.</div>
        <label style="font-size:12px;font-weight:700;color:#333;">Amount Handed Over (GH₵)</label>
        <input type="number" id="riderRemitAmount" value="${outstanding.toFixed(2)}" min="0.01" max="${outstanding.toFixed(2)}" step="0.01" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:10px;font-size:13px;margin:6px 0 14px;box-sizing:border-box;">
        <div style="display:flex;gap:10px;">
          <button style="flex:1;background:#f1f3f5;color:#333;border:none;padding:12px;border-radius:10px;font-weight:700;cursor:pointer;" onclick="document.getElementById('riderRemitModal').remove()">Cancel</button>
          <button style="flex:1;background:#1A4731;color:#fff;border:none;padding:12px;border-radius:10px;font-weight:700;cursor:pointer;" onclick="window.__riderSubmitRemit()">✓ Log Handover</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  };

  window.__riderSubmitRemit = function() {
    const u = window.SL.currentUser ? window.SL.currentUser() : null;
    if (!u) return;
    const amountEl = document.getElementById('riderRemitAmount');
    const amount = parseFloat(amountEl.value);
    const outstanding = riderCashOutstanding(u.id);
    if (isNaN(amount) || amount <= 0) { alert('Please enter a valid amount.'); return; }
    if (amount > outstanding + 0.01) { alert("That's more than you're currently showing as owed (GH₵" + outstanding.toFixed(2) + ")."); return; }
    window.SL.addRemitRequest({ riderId: u.id, riderName: u.name, amount });
    const admins = (window.SL.getUsers() || []).filter(a => a.role === 'admin');
    admins.forEach(a => window.SL.addNotification({
      userId: a.id,
      message: `💵 ${u.name} logged a cash handover of GH₵${amount.toFixed(2)} — please confirm.`,
      type: 'cash_remit_request'
    }));
    const modal = document.getElementById('riderRemitModal');
    if (modal) modal.remove();
    riderRenderDeliveries();
  };

  function riderRenderDeliveries() {
    riderRefreshBellBadge();
    riderRenderNetworkBanner();
    riderUpdateOnlineToggleUI();
    const u = window.SL.currentUser ? window.SL.currentUser() : null;
    const nameEl = document.getElementById('rider-welcome-name');
    const subEl = document.getElementById('rider-welcome-sub');
    if (u && nameEl && subEl) {
      const hour = new Date().getHours();
      const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
      nameEl.textContent = `${greeting}, ${u.name.split(' ')[0]} 👋`;
      const activeCount = (window.SL.getOrders() || []).filter(o => o.status === 'out' && o.riderId === u.id).length;
      subEl.textContent = activeCount > 0
        ? `You have ${activeCount} ${activeCount === 1 ? 'delivery' : 'deliveries'} to complete.`
        : 'No deliveries assigned right now.';
    }

    if (u) {
      const allOrders = window.SL.getOrders() || [];
      const activeEl = document.getElementById('rider-stat-active');
      if (activeEl) activeEl.textContent = allOrders.filter(o => o.status === 'out' && o.riderId === u.id).length;

      const todayStart = new Date(); todayStart.setHours(0,0,0,0);
      const deliveredTodayEl = document.getElementById('rider-stat-delivered-today');
      if (deliveredTodayEl) {
        deliveredTodayEl.textContent = allOrders.filter(o =>
          o.deliveryProof && o.deliveryProof.riderId === u.id && o.deliveryProof.confirmedAt >= todayStart.getTime()
        ).length;
      }
      const cashStatEl = document.getElementById('rider-stat-cash');
      if (cashStatEl) cashStatEl.textContent = 'GH₵' + riderCashOutstanding(u.id).toFixed(0);
    }

    const cashBanner = document.getElementById('rider-cash-banner');
    if (cashBanner && u) {
      const outstanding = riderCashOutstanding(u.id);
      const pendingReq = (window.SL.getRemitRequests() || []).find(r => r.riderId === u.id && r.status === 'pending');
      let html = '';
      if (pendingReq) {
        html += `<div style="background:#DCEEE1;border:1px solid #1A4731;border-radius:10px;padding:12px 14px;margin-bottom:10px;font-size:13px;color:#1A4731;font-weight:600;">⏳ You logged a handover of GH₵${pendingReq.amount.toFixed(2)} — waiting on Admin to confirm they received it.</div>`;
      }
      if (outstanding > 0) {
        html += `<div style="background:#FEF3DC;border:1px solid #F4A623;border-radius:10px;padding:12px 14px;margin-bottom:10px;font-size:13px;color:#7a4f00;font-weight:600;">
          <div style="margin-bottom:8px;">💵 You're holding GH₵${outstanding.toFixed(2)} in cash from Pay-on-Delivery orders — please hand this over to Admin.</div>
          ${pendingReq ? '' : `<button class="adm-btn" style="background:#F4A623;color:#1A4731;padding:8px 14px;" onclick="window.riderOpenRemitModal()">🧾 Log Handover</button>`}
        </div>`;
      }
      cashBanner.innerHTML = html;
    }

    const listEl = document.getElementById('rider-delivery-list');
    if (!listEl || !u) return;

    if (riderActiveTab === 'available') {
      const available = (window.SL.getOrders() || [])
        .filter(o => o.status === 'out' && !o.riderId)
        .sort((a, b) => (a.outAt || a.createdAt || 0) - (b.outAt || b.createdAt || 0));

      if (available.length === 0) {
        listEl.innerHTML = `
          <div class="adm-empty">
            <div class="adm-empty-icon">📭</div>
            <h4>No unclaimed deliveries</h4>
            <p>When Admin leaves an order open for any rider, it'll show up here.</p>
          </div>`;
        return;
      }

      const availGroups = riderGroupByZone(available);
      listEl.innerHTML = availGroups.map(g => {
        const zoneLabel = g.key === 'Pickup' ? '🏪 In-Person Pickup' : '📍 ' + g.key;
        const batchBanner = g.orders.length >= 2
          ? `<div style="background:#DCEEE1;border:1px solid #1A4731;border-radius:10px;padding:10px 14px;margin:10px 0;font-size:12px;color:#1A4731;font-weight:700;display:flex;justify-content:space-between;align-items:center;gap:10px;">
               <span>📦 ${g.orders.length} orders in ${g.key} — grab them together in one trip</span>
               <button class="adm-btn" style="background:#1A4731;color:#fff;flex-shrink:0;padding:8px 12px;" onclick="window.riderClaimBatch('${g.orders.map(o=>o.id).join(',')}')">Claim All</button>
             </div>`
          : '';
        const groupHeader = availGroups.length > 1
          ? `<div style="font-size:11px;font-weight:800;color:#1A4731;text-transform:uppercase;letter-spacing:.03em;margin:14px 0 4px;">${zoneLabel}</div>`
          : '';
        return groupHeader + batchBanner + g.orders.map(o => {
          const itemsText = (o.items || []).map(i => `${i.qty}× ${i.productName}`).join(', ');
          return `
          <div class="adm-order-card">
            <div class="adm-order-card-head">
              <div class="adm-order-head-left">
                <div>
                  <div class="adm-order-id">${o.id}</div>
                  <div class="adm-order-buyer">👤 ${o.buyerName || 'Buyer'} · ${o.buyerPhone || ''}</div>
                </div>
              </div>
              <span style="background:#DCEEE1;color:#1A4731;font-size:11px;font-weight:800;padding:5px 10px;border-radius:12px;">OPEN</span>
            </div>
            <div class="adm-order-body">
              <div class="adm-order-items">🛍️ ${itemsText || 'No items'}</div>
              <div class="adm-order-meta">
                <span>${o.address === 'In-person pickup' ? '🏪 Pickup' : '🚚 ' + (o.zone || o.address || 'Delivery')}</span>
                <span>${o.payment === 'momo' ? '📱 MoMo' : '💵 Pay on Delivery'}</span>
              </div>
              <div class="adm-order-actions">
                <button class="adm-btn" style="background:#f1f3f5;color:#333;" onclick="window.showWaybill('${o.id}')">🧾 Waybill</button>
                <button class="adm-btn adm-btn-status" onclick="window.riderClaimDelivery('${o.id}')">✋ Claim This Delivery</button>
              </div>
            </div>
          </div>`;
        }).join('');
      }).join('');
      return;
    }

    if (riderActiveTab === 'history') {
      const delivered = (window.SL.getOrders() || [])
        .filter(o => o.deliveryProof && o.deliveryProof.riderId === u.id)
        .sort((a, b) => b.deliveryProof.confirmedAt - a.deliveryProof.confirmedAt);

      if (delivered.length === 0) {
        listEl.innerHTML = `
          <div class="adm-empty">
            <div class="adm-empty-icon">📋</div>
            <h4>No delivery history yet</h4>
            <p>Orders you've delivered will show up here.</p>
          </div>`;
        return;
      }

      listEl.innerHTML = delivered.map(o => `
        <div class="adm-order-card">
          <div class="adm-order-card-head">
            <div class="adm-order-head-left">
              <div>
                <div class="adm-order-id">${o.id}</div>
                <div class="adm-order-buyer">👤 ${o.buyerName || 'Buyer'} · GH₵${(o.total||0).toFixed(2)}</div>
              </div>
            </div>
          </div>
          <div class="adm-order-body">
            <div class="adm-order-meta">
              <span>✓ Delivered ${new Date(o.deliveryProof.confirmedAt).toLocaleString('en-GH',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</span>
              <span>${o.payment === 'momo' ? '📱 MoMo' : '💵 Cash Collected'}</span>
            </div>
          </div>
        </div>`).join('');
      return;
    }

    const orders = (window.SL.getOrders() || [])
      .filter(o => o.status === 'out' && o.riderId === u.id);

    if (orders.length === 0) {
      listEl.innerHTML = `
        <div class="adm-empty">
          <div class="adm-empty-icon">🛵</div>
          <h4>No deliveries assigned right now</h4>
          <p>Orders Admin assigns to you will show up here once they're Out for Delivery.</p>
        </div>`;
      return;
    }

    const zoneGroups = riderGroupByZone(orders);
    const navAllBtn = orders.length >= 2
      ? `<div style="margin-bottom:12px;"><button class="adm-btn adm-btn-status" style="width:100%;" onclick="window.riderNavigateAll()">🧭 Navigate All (${orders.length} stops, closest zone first)</button></div>`
      : '';
    const groupHeadersHTML = zoneGroups.map(g => {
      const zoneLabel = g.key === 'Pickup' ? '🏪 In-Person Pickup' : '📍 ' + g.key;
      const groupHeader = zoneGroups.length > 1
        ? `<div style="font-size:11px;font-weight:800;color:#1A4731;text-transform:uppercase;letter-spacing:.03em;margin:14px 0 8px;">${zoneLabel}${g.orders.length > 1 ? ` · ${g.orders.length} stops here — grab them together` : ''}</div>`
        : '';
      return groupHeader + g.orders.map(o => riderRenderActiveCard(o)).join('');
    }).join('');

    listEl.innerHTML = navAllBtn + groupHeadersHTML;
    return;
  }

  function riderRenderActiveCard(o) {
      const itemsText = (o.items || []).map(i => `${i.qty}× ${i.productName}`).join(', ');
      const urgency = riderOrderUrgency(o);
      const mapsUrl = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(o.address || o.zone || '');
      const telUrl = 'tel:' + (o.buyerPhone || '').replace(/\s+/g, '');

      const actionsHTML = o.deliveryIssue
        ? `<div style="background:#FDECEC;border:1px solid #E74C3C;border-radius:8px;padding:10px 12px;font-size:12px;color:#a12727;font-weight:600;">⚠️ Issue reported — waiting on Admin (${o.deliveryIssue.reasonLabel})</div>`
        : `<div class="adm-order-actions">
              <button class="adm-btn" style="background:#f1f3f5;color:#333;" onclick="window.showWaybill('${o.id}')">🧾 Waybill</button>
              <button class="adm-btn adm-btn-status" onclick="window.riderOpenConfirmDelivery('${o.id}')">✓ Confirm Delivery</button>
              <button class="adm-btn" style="background:#FDECEC;color:#c0392b;" onclick="window.riderOpenIssueModal('${o.id}')">⚠️ Report Issue</button>
            </div>`;

      return `
        <div class="adm-order-card" style="${urgency.level === 'overdue' ? 'border:1.5px solid #E74C3C;' : ''}">
          <div class="adm-order-card-head">
            <div class="adm-order-head-left">
              <div>
                <div class="adm-order-id">${o.id}</div>
                <div class="adm-order-buyer">👤 ${o.buyerName || 'Buyer'} · ${o.buyerPhone || ''}</div>
              </div>
            </div>
            <span style="background:${urgency.bg};color:${urgency.color};font-size:11px;font-weight:800;padding:5px 10px;border-radius:12px;white-space:nowrap;">${urgency.tagText}</span>
          </div>
          <div class="adm-order-body">
            <div class="adm-order-items">🛍️ ${itemsText || 'No items'}</div>
            <div class="adm-order-meta">
              <span>${o.address === 'In-person pickup' ? '🏪 Pickup' : '🚚 ' + (o.zone || o.address || 'Delivery')}</span>
              <span>${o.payment === 'momo' ? '📱 MoMo' : '💵 Pay on Delivery'}</span>
              <span style="font-weight:700;color:${urgency.level === 'overdue' ? '#c0392b' : urgency.level === 'late' ? '#7a4f00' : '#888'};">⏱️ Out for ${urgency.label}</span>
            </div>
            <div class="adm-order-actions" style="margin-bottom:8px;">
              <a class="adm-btn" style="background:#1A4731;color:#fff;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;" href="${mapsUrl}" target="_blank" rel="noopener">🧭 Navigate</a>
              <a class="adm-btn" style="background:#f1f3f5;color:#333;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;" href="${telUrl}">📞 Call Buyer</a>
            </div>
            ${actionsHTML}
          </div>
        </div>`;
  }

  /* Elapsed time + overdue flag since "Out for Delivery" — Express threshold
     mirrors the buyer-facing refund policy window (3hr promise + 1hr buffer),
     Normal mirrors 8hr promise + 3hr buffer. */
  function riderOrderUrgency(order) {
    const outAt = order.outAt || order.createdAt || Date.now();
    const elapsedMs = Date.now() - outAt;
    const elapsedHrs = elapsedMs / 3600000;
    const isExpress = (order.supplierBreakdown || []).length > 0 &&
      order.supplierBreakdown.every(sb => sb.speed === 'express');
    const thresholdHrs = isExpress ? 4 : 11;
    const h = Math.floor(elapsedHrs);
    const m = Math.round((elapsedHrs - h) * 60);
    const label = h > 0 ? `${h}h ${m}m` : `${m}m`;
    const pct = elapsedHrs / thresholdHrs;

    let level, color, bg, tagText;
    if (pct >= 1) {
      level = 'overdue'; color = '#fff'; bg = '#E74C3C'; tagText = '🔴 OVERDUE';
    } else if (pct >= 0.6) {
      level = 'late'; color = '#7a4f00'; bg = '#F4A623'; tagText = '🟡 Getting Late';
    } else {
      level = 'ontime'; color = '#1A4731'; bg = '#DCEEE1'; tagText = '🟢 On Time';
    }
    return { elapsedHrs, overdue: level === 'overdue', level, color, bg, tagText, label };
  }

  window.riderClaimDelivery = function(orderId) {
    const u = window.SL.currentUser ? window.SL.currentUser() : null;
    if (!u) return;
    const orders = window.SL.getOrders() || [];
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx === -1) return;

    if (orders[idx].riderId) {
      alert('Someone already claimed this delivery.');
      riderRenderDeliveries();
      return;
    }
    orders[idx].riderId = u.id;
    orders[idx].riderName = u.name;
    localStorage.setItem('sl_orders', JSON.stringify(orders));
    riderRenderDeliveries();
  };

  /* Claims every order in a same-zone batch in one write, so a rider
     grabbing 3 orders in Adum doesn't have to tap Claim 3 separate times
     (and risk someone else claiming #2 in between). */
  window.riderClaimBatch = function(orderIdsCsv) {
    const u = window.SL.currentUser ? window.SL.currentUser() : null;
    if (!u) return;
    const ids = orderIdsCsv.split(',');
    const orders = window.SL.getOrders() || [];
    let claimedCount = 0;
    ids.forEach(id => {
      const idx = orders.findIndex(o => o.id === id);
      if (idx !== -1 && !orders[idx].riderId) {
        orders[idx].riderId = u.id;
        orders[idx].riderName = u.name;
        claimedCount++;
      }
    });
    localStorage.setItem('sl_orders', JSON.stringify(orders));
    if (claimedCount < ids.length) alert('Some of these were already claimed by another rider — you got ' + claimedCount + ' of ' + ids.length + '.');
    riderRenderDeliveries();
  };

  window.riderOpenConfirmDelivery = function(orderId) {
    const order = (window.SL.getOrders() || []).find(o => o.id === orderId);
    if (!order) return;
    const existing = document.getElementById('riderProofModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'riderProofModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:4100;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:22px;max-width:420px;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-height:92vh;overflow-y:auto;">
        <div style="font-size:16px;font-weight:700;margin-bottom:2px;">Confirm Delivery — ${order.id}</div>
        <div style="font-size:13px;color:#777;margin-bottom:16px;">Capture proof of handoff before this order is marked Delivered.</div>

        <label style="font-size:12px;font-weight:700;color:#333;">Received By</label>
        <input type="text" id="riderProofRecipient" value="${(order.buyerName || '').replace(/"/g,'')}" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:10px;font-size:13px;margin:6px 0 14px;box-sizing:border-box;">

        <label style="font-size:12px;font-weight:700;color:#333;">Signature</label>
        <div style="border:1px solid #ddd;border-radius:10px;margin:6px 0 4px;overflow:hidden;">
          <canvas id="riderProofCanvas" style="width:100%;height:140px;display:block;touch-action:none;background:#fafafa;"></canvas>
        </div>
        <button type="button" style="background:none;border:none;color:#1A4731;font-size:12px;font-weight:700;cursor:pointer;padding:0 0 12px;" onclick="window.__riderClearSignature()">↺ Clear signature</button>

        <label style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:#333;margin:8px 0 14px;">
          <input type="checkbox" id="riderProofConfirmCb" style="margin-top:2px;">
          <span>I confirm this order was physically handed over to the recipient above.</span>
        </label>

        <label style="font-size:12px;font-weight:700;color:#333;">Photo at drop-off (optional)</label>
        <input type="file" id="riderProofPhotoInput" accept="image/*" capture="environment" style="display:block;margin:6px 0 12px;font-size:12px;" onchange="window.__riderPhotoChanged(this.files)">
        <div id="riderProofPhotoPreview"></div>

        <div style="display:flex;gap:10px;margin-top:6px;">
          <button style="flex:1;background:#f1f3f5;color:#333;border:none;padding:12px;border-radius:10px;font-weight:700;cursor:pointer;" onclick="document.getElementById('riderProofModal').remove()">Cancel</button>
          <button id="riderProofConfirmBtn" style="flex:1;background:#1A4731;color:#fff;border:none;padding:12px;border-radius:10px;font-weight:700;cursor:pointer;" onclick="window.__riderConfirmDelivery('${orderId}')">✓ Confirm Delivery</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    riderSetupSignaturePad();
    riderConfirmPhoto = null;
  };

  window.__riderPhotoChanged = async function(fileList) {
    const file = (fileList || [])[0];
    if (!file) return;
    try {
      riderConfirmPhoto = await window.SL.uploadImage(file, { maxWidth: 700, quality: 0.55 }, 'delivery-proofs');
      document.getElementById('riderProofPhotoPreview').innerHTML =
        `<img src="${riderConfirmPhoto}" style="max-width:100%;border-radius:8px;margin-top:6px;">`;
    } catch (uploadErr) {
      // Cloud upload failed — fall back to local-only base64 so the rider
      // can still finish confirming delivery; photo just won't sync until
      // re-uploaded elsewhere with a connection.
      try {
        riderConfirmPhoto = await window.SL.compressImage(file, { maxWidth: 700, quality: 0.55 });
        document.getElementById('riderProofPhotoPreview').innerHTML =
          `<img src="${riderConfirmPhoto}" style="max-width:100%;border-radius:8px;margin-top:6px;">`;
      } catch (e) { /* photo is optional — silently skip on failure */ }
    }
  };

  function riderSetupSignaturePad() {
    const canvas = document.getElementById('riderProofCanvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    riderSigCtx = canvas.getContext('2d');
    riderSigCtx.strokeStyle = '#1A4731';
    riderSigCtx.lineWidth = 2.2;
    riderSigCtx.lineJoin = 'round';
    riderSigCtx.lineCap = 'round';
    riderSigDrawing = false;
    riderSigHasDrawn = false;

    function pos(e) {
      const r = canvas.getBoundingClientRect();
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: cx - r.left, y: cy - r.top };
    }
    function start(e) { riderSigDrawing = true; riderSigHasDrawn = true; const p = pos(e); riderSigCtx.beginPath(); riderSigCtx.moveTo(p.x, p.y); e.preventDefault(); }
    function move(e)  { if (!riderSigDrawing) return; const p = pos(e); riderSigCtx.lineTo(p.x, p.y); riderSigCtx.stroke(); e.preventDefault(); }
    function end()    { riderSigDrawing = false; }

    canvas.onmousedown = start; canvas.onmousemove = move; canvas.onmouseup = end; canvas.onmouseleave = end;
    canvas.ontouchstart = start; canvas.ontouchmove = move; canvas.ontouchend = end;
  }

  window.__riderClearSignature = function() {
    const canvas = document.getElementById('riderProofCanvas');
    if (!canvas || !riderSigCtx) return;
    riderSigCtx.clearRect(0, 0, canvas.width, canvas.height);
    riderSigHasDrawn = false;
  };

  window.__riderConfirmDelivery = async function(orderId) {
    const recipientEl = document.getElementById('riderProofRecipient');
    const confirmCb = document.getElementById('riderProofConfirmCb');
    const recipient = (recipientEl.value || '').trim();

    if (!recipient) { alert('Please enter who received the order.'); return; }
    if (!riderSigHasDrawn) { alert('Please capture a signature before confirming.'); return; }
    if (!confirmCb.checked) { alert('Please tick the confirmation checkbox.'); return; }

    const canvas = document.getElementById('riderProofCanvas');
    const signatureDataUrl = canvas.toDataURL('image/png');

    // Same Storage-upload-with-fallback approach as the admin proof flow —
    // signature stays local-only (base64) if the upload fails, order still
    // confirms either way.
    const btn = document.getElementById('riderProofConfirmBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Confirming…'; }
    let signature = signatureDataUrl;
    try {
      signature = await window.SL.uploadDataUrlImage(signatureDataUrl, 'delivery-proofs');
    } catch (e) { /* keep the base64 fallback already assigned above */ }

    const orders = window.SL.getOrders() || [];
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx === -1) return;

    const rider = window.SL.currentUser ? window.SL.currentUser() : null;
    orders[idx].deliveryProof = {
      recipientName: recipient,
      signature,
      photo: riderConfirmPhoto || null,
      confirmedAt: Date.now(),
      confirmedBy: rider ? rider.name : 'Rider',
      riderId: rider ? rider.id : null
    };
    window.admChangeOrderStatus(orders, idx, 'delivered');
    localStorage.setItem('sl_orders', JSON.stringify(orders));

    const modal = document.getElementById('riderProofModal');
    if (modal) modal.remove();
    riderConfirmPhoto = null;
    window.__riderShowSuccess(recipient);
    riderRenderDeliveries();
  };

  /* Brief, satisfying confirmation screen — a rider standing at someone's
     door wants a clear "done" moment, not a silently-refreshing list. */
  window.__riderShowSuccess = function(recipientName) {
    const existing = document.getElementById('riderSuccessOverlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'riderSuccessOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:4200;background:rgba(26,71,42,.97);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;text-align:center;';
    overlay.innerHTML = `
      <div style="width:84px;height:84px;border-radius:50%;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;font-size:44px;margin-bottom:18px;">✅</div>
      <div style="color:#fff;font-size:20px;font-weight:800;margin-bottom:6px;">Delivered!</div>
      <div style="color:rgba(255,255,255,.8);font-size:14px;margin-bottom:28px;">Confirmed received by ${recipientName}</div>
      <button style="background:#F4A623;color:#1A4731;border:none;padding:13px 28px;border-radius:10px;font-weight:800;cursor:pointer;font-size:14px;" onclick="document.getElementById('riderSuccessOverlay').remove()">Continue</button>`;
    document.body.appendChild(overlay);
    setTimeout(() => { const el = document.getElementById('riderSuccessOverlay'); if (el) el.remove(); }, 2200);
  };

  /* ══ REPORT DELIVERY ISSUE ══ */
  const RIDER_ISSUE_REASONS = {
    not_reachable:    'Buyer not reachable',
    wrong_address:    'Wrong / incomplete address',
    refused:          'Buyer refused delivery',
    other:            'Other issue'
  };

  window.riderOpenIssueModal = function(orderId) {
    const order = (window.SL.getOrders() || []).find(o => o.id === orderId);
    if (!order) return;
    const existing = document.getElementById('riderIssueModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'riderIssueModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:4100;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:22px;max-width:420px;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-height:88vh;overflow-y:auto;">
        <div style="font-size:16px;font-weight:700;margin-bottom:2px;">Report an Issue — ${order.id}</div>
        <div style="font-size:13px;color:#777;margin-bottom:16px;">This lets Admin know delivery couldn't be completed as planned.</div>

        <label style="font-size:12px;font-weight:700;color:#333;">What happened?</label>
        <select id="riderIssueReason" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:10px;font-size:13px;margin:6px 0 14px;box-sizing:border-box;">
          ${Object.entries(RIDER_ISSUE_REASONS).map(([k,v]) => `<option value="${k}">${v}</option>`).join('')}
        </select>

        <label style="font-size:12px;font-weight:700;color:#333;">Details</label>
        <textarea id="riderIssueNote" placeholder="Anything Admin should know..." style="width:100%;min-height:70px;border:1px solid #ddd;border-radius:10px;padding:10px;font-size:13px;font-family:inherit;box-sizing:border-box;margin:6px 0 16px;"></textarea>

        <div style="display:flex;gap:10px;">
          <button style="flex:1;background:#f1f3f5;color:#333;border:none;padding:12px;border-radius:10px;font-weight:700;cursor:pointer;" onclick="document.getElementById('riderIssueModal').remove()">Cancel</button>
          <button style="flex:1;background:#c0392b;color:#fff;border:none;padding:12px;border-radius:10px;font-weight:700;cursor:pointer;" onclick="window.__riderSubmitIssue('${orderId}')">⚠️ Submit</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  };

  window.__riderSubmitIssue = function(orderId) {
    const reason = document.getElementById('riderIssueReason').value;
    const note = (document.getElementById('riderIssueNote').value || '').trim();
    const rider = window.SL.currentUser ? window.SL.currentUser() : null;

    const orders = window.SL.getOrders() || [];
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx === -1) return;

    orders[idx].deliveryIssue = {
      reason, reasonLabel: RIDER_ISSUE_REASONS[reason],
      note,
      riderId: rider ? rider.id : null,
      riderName: rider ? rider.name : 'Rider',
      reportedAt: Date.now()
    };
    localStorage.setItem('sl_orders', JSON.stringify(orders));

    const admins = (window.SL.getUsers() || []).filter(u => u.role === 'admin');
    admins.forEach(a => window.SL.addNotification({
      userId: a.id,
      message: `⚠️ Delivery issue on ${orderId}: ${RIDER_ISSUE_REASONS[reason]}${note ? ' — ' + note : ''} (reported by ${rider ? rider.name : 'rider'})`,
      orderId, type: 'delivery_issue'
    }));

    const modal = document.getElementById('riderIssueModal');
    if (modal) modal.remove();
    riderRenderDeliveries();
  };

  let riderPollInterval = null;
  let riderKnownActiveCount = null;

  function riderRefreshBellBadge() {
    const u = window.SL.currentUser ? window.SL.currentUser() : null;
    const badge = document.getElementById('rider-bell-badge');
    if (!u || !badge || !window.SL.unreadNotificationCount) return;
    const count = window.SL.unreadNotificationCount(u.id);
    if (count > 0) {
      badge.textContent = count > 9 ? '9+' : String(count);
      badge.style.display = 'flex';
      badge.style.alignItems = 'center';
      badge.style.justifyContent = 'center';
    } else {
      badge.style.display = 'none';
    }
  }

  function riderPollForUpdates() {
    const u = window.SL.currentUser ? window.SL.currentUser() : null;
    if (!u || u.role !== 'rider') { clearInterval(riderPollInterval); riderPollInterval = null; return; }
    const activeCount = (window.SL.getOrders() || []).filter(o => o.status === 'out' && o.riderId === u.id).length;
    if (riderKnownActiveCount !== null && activeCount > riderKnownActiveCount) {
      const toast = document.createElement('div');
      toast.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);background:#1A4731;color:#fff;padding:12px 20px;border-radius:10px;font-size:13px;font-weight:700;z-index:5000;box-shadow:0 4px 14px rgba(0,0,0,.25);';
      toast.textContent = '🔔 New delivery assigned!';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    }
    riderKnownActiveCount = activeCount;
    riderRefreshBellBadge();
    if (riderActiveTab === 'active' || riderActiveTab === 'available') riderRenderDeliveries();
  }

  window.SL.registerInit('rider-portal', function() {
    riderActiveTab = 'active';
    document.querySelectorAll('#view-rider-portal .rider-bottom-nav .bn-link').forEach(c => c.classList.remove('active'));
    const activeBnLink = document.getElementById('rbn-active');
    if (activeBnLink) activeBnLink.classList.add('active');
    const listEl = document.getElementById('rider-delivery-list');
    const statsEl = document.getElementById('rider-stats-panel');
    if (listEl) listEl.style.display = 'block';
    if (statsEl) statsEl.style.display = 'none';

    const u = window.SL.currentUser ? window.SL.currentUser() : null;
    riderKnownActiveCount = u ? (window.SL.getOrders() || []).filter(o => o.status === 'out' && o.riderId === u.id).length : null;

    riderRenderDeliveries();
    riderRefreshBellBadge();

    if (riderPollInterval) clearInterval(riderPollInterval);
    riderPollInterval = setInterval(riderPollForUpdates, 20000);

    // Ticks the "On shift Xh Ym" label once a minute — cheap, and avoids
    // it looking frozen if a rider leaves the tab open all day.
    if (riderShiftTickInterval) clearInterval(riderShiftTickInterval);
    riderShiftTickInterval = setInterval(riderUpdateOnlineToggleUI, 60000);
  });

})();
