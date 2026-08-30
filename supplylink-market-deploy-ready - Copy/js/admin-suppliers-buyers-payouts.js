
(function() {
  'use strict';

  function fmtGHS2(n) { return 'GH₵' + (n || 0).toFixed(2); }
  function capFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function initials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }

  /* ══════════════════ SUPPLIERS DIRECTORY ══════════════════ */
  let admSupFilter = 'all';

  function admEscapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }
  function admTimeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.floor(h / 24);
    if (d < 30) return d + 'd ago';
    return new Date(ts).toLocaleDateString();
  }
  /* Full review list for one supplier — rendered lazily (only when the
     admin actually opens it) since a supplier could accumulate a lot of
     reviews over time and there's no need to build this HTML for every
     card on every render. */
  function admSupReviewsHtml(supplierId) {
    const reviews = (window.SL.getReviews ? window.SL.getReviews() : [])
      .filter(r => r.supplierId === supplierId)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!reviews.length) return '<div style="font-size:12px;color:#999;padding:6px 0;">No reviews yet.</div>';
    const users = window.SL.getUsers() || [];
    return reviews.map(r => {
      const stars = '★'.repeat(r.rating || 0) + '☆'.repeat(5 - (r.rating || 0));
      const buyer = users.find(x => x.id === r.buyerId);
      const name = buyer ? buyer.name : 'Buyer';
      const when = admTimeAgo(r.createdAt);
      const commentHtml = (r.comment && r.comment.trim())
        ? `<div style="font-size:13px;color:#333;margin:3px 0;line-height:1.4;">${admEscapeHtml(r.comment.trim())}</div>`
        : '<div style="font-size:12px;color:#aaa;font-style:italic;margin:3px 0;">No written comment</div>';
      return `<div style="padding:8px 0;border-top:1px solid #eee;">
        <div style="font-size:12px;color:#F59E0B;letter-spacing:1px;">${stars}</div>
        ${commentHtml}
        <div style="font-size:11px;color:#999;">${admEscapeHtml(name)}${when ? ' · ' + when : ''}</div>
      </div>`;
    }).join('');
  }
  window.admSupToggleReviews = function(id) {
    const box = document.getElementById('admSupReviews-' + id);
    if (!box) return;
    if (box.style.display === 'none') {
      box.innerHTML = admSupReviewsHtml(id);
      box.style.display = 'block';
    } else {
      box.style.display = 'none';
    }
  };

  function supplierStats(supplierId) {
    const orders = window.SL.getOrders() || [];
    const products = window.SL.getProducts() || [];
    let revenue = 0;
    const orderIds = new Set();
    orders.forEach(o => {
      (o.items || []).forEach(it => {
        if (it.supplierId !== supplierId) return;
        revenue += (it.supplierPrice || 0) * (it.qty || 0);
        orderIds.add(o.id);
      });
    });
    const activeProducts = products.filter(p => p.supplierId === supplierId && p.isAvailable).length;
    return { revenue, orders: orderIds.size, activeProducts };
  }

  function admSupRender() {
    const users = window.SL.getUsers() || [];
    const suppliers = users.filter(u => u.role === 'supplier');
    const active = suppliers.filter(u => (u.status||'active') === 'active').length;
    const pending = suppliers.filter(u => u.status === 'pending').length;
    const suspended = suppliers.filter(u => u.status === 'suspended').length;

    document.getElementById('adm-sup-count').textContent = suppliers.length + ' Total';
    document.getElementById('adm-sup-stat-total').textContent = suppliers.length;
    document.getElementById('adm-sup-stat-active').textContent = active;
    document.getElementById('adm-sup-stat-pending').textContent = pending;
    document.getElementById('adm-sup-stat-suspended').textContent = suspended;

    let list = suppliers;
    if (admSupFilter !== 'all') list = list.filter(u => (u.status||'active') === admSupFilter);
    const priority = { pending: 0, active: 1, suspended: 2 };
    list = list.slice().sort((a,b) => (priority[a.status||'active']??1) - (priority[b.status||'active']??1));

    const listEl = document.getElementById('adm-supplier-list');
    if (list.length === 0) {
      listEl.innerHTML = '<div class="adm-dir-empty">No suppliers match this filter.</div>';
      return;
    }

    listEl.innerHTML = list.map(u => {
      const stats = supplierStats(u.id);
      const status = u.status || 'active';
      let actionsHtml = '';
      const contactHtml = `<a class="adm-dir-btn call" href="tel:${u.phone || ''}">📞 Call</a><button class="adm-dir-btn message" onclick="admOpenMessageModal('${u.id}')">✉️ Message</button>`;
      if (status === 'pending') {
        actionsHtml = `<div class="adm-dir-actions">
          <button class="adm-dir-btn approve" onclick="admSupApprove('${u.id}')">✓ Approve</button>
          <button class="adm-dir-btn suspend" onclick="admSupSuspend('${u.id}')">✕ Reject</button>
        </div>
        <div class="adm-dir-actions" style="margin-top:8px;">${contactHtml}</div>`;
      } else if (status === 'active') {
        actionsHtml = `<div class="adm-dir-actions">
          <button class="adm-dir-btn suspend" onclick="admSupSuspend('${u.id}')">Suspend</button>
        </div>
        <div class="adm-dir-actions" style="margin-top:8px;">${contactHtml}</div>`;
      } else {
        actionsHtml = `<div class="adm-dir-actions">
          <button class="adm-dir-btn reactivate" onclick="admSupReactivate('${u.id}')">Reactivate</button>
        </div>
        <div class="adm-dir-actions" style="margin-top:8px;">${contactHtml}</div>`;
      }
      const verified = window.SL.isSupplierVerified ? window.SL.isSupplierVerified(u.id) : false;
      const rating = window.SL.getSupplierRating ? window.SL.getSupplierRating(u.id) : { avg: 0, count: 0 };
      const verifiedBadge = verified
        ? `<span style="display:inline-block;margin-top:4px;font-size:11px;font-weight:700;color:#1a472a;">✅ Verified</span>`
        : `<span style="display:inline-block;margin-top:4px;font-size:11px;color:#999;">New supplier</span>`;
      return `
        <div class="adm-dir-card">
          <div class="adm-dir-top">
            <div class="adm-dir-avatar">${initials(u.name)}</div>
            <div>
              <div class="adm-dir-name">${u.name}</div>
              <div class="adm-dir-sub">${capFirst(u.bizType) || 'Supplier'} · ${u.location || '—'}</div>
              ${verifiedBadge}
            </div>
            <span class="adm-dir-badge st-${status}">${status}</span>
          </div>
          <div class="adm-dir-stats">
            <div class="adm-dir-stat"><div class="adm-dir-stat-val">${stats.activeProducts}</div><div class="adm-dir-stat-lbl">Products</div></div>
            <div class="adm-dir-stat"><div class="adm-dir-stat-val">${stats.orders}</div><div class="adm-dir-stat-lbl">Orders</div></div>
            <div class="adm-dir-stat"><div class="adm-dir-stat-val">${fmtGHS2(stats.revenue)}</div><div class="adm-dir-stat-lbl">Revenue</div></div>
            <div class="adm-dir-stat"><div class="adm-dir-stat-val">${rating.count ? '★ ' + rating.avg.toFixed(1) : '—'}</div><div class="adm-dir-stat-lbl">${rating.count ? rating.count + ' review' + (rating.count===1?'':'s') : 'Rating'}</div></div>
          </div>
          ${rating.count ? `<div style="margin-top:8px;">
            <button type="button" onclick="admSupToggleReviews('${u.id}')" style="background:none;border:none;color:#1a472a;font-size:12px;font-weight:700;cursor:pointer;padding:0;">View reviews (${rating.count})</button>
            <div id="admSupReviews-${u.id}" style="display:none;margin-top:4px;"></div>
          </div>` : ''}
          ${actionsHtml}
        </div>`;
    }).join('');
  }

  window.admSupSetFilter = function(f, btn) {
    admSupFilter = f;
    document.querySelectorAll('#view-admin-suppliers .adm-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    admSupRender();
  };

  window.admSupApprove = function(id) {
    const users = window.SL.getUsers() || [];
    const idx = users.findIndex(u => u.id === id);
    if (idx === -1) return;
    users[idx].status = 'active';
    window.SL.saveUsers(users);
    const u = users[idx];
    if (u.phone) {
      window.SL.sms({
        to: u.phone,
        message: 'SupplyLink GH: Congratulations ' + u.name + '! Your supplier account has been APPROVED. You can now list products on SupplyLink Market.',
        event: 'supplier_approved'
      });
    }
    admSupRender();
  };

  window.admSupSuspend = function(id) {
    const users = window.SL.getUsers() || [];
    const u = users.find(x => x.id === id);
    if (!confirm('Suspend ' + (u ? u.name : 'this supplier') + '? They will not be able to log in or sell until reactivated.')) return;
    const idx = users.findIndex(x => x.id === id);
    if (idx === -1) return;
    users[idx].status = 'suspended';
    window.SL.saveUsers(users);
    admSupRender();
  };

  window.admSupReactivate = function(id) {
    const users = window.SL.getUsers() || [];
    const idx = users.findIndex(u => u.id === id);
    if (idx === -1) return;
    users[idx].status = 'active';
    window.SL.saveUsers(users);
    admSupRender();
  };

  window.SL.registerInit('admin-suppliers', function() {
    admSupFilter = 'all';
    document.querySelectorAll('#view-admin-suppliers .adm-chip').forEach(c => c.classList.remove('active'));
    const allChip = document.querySelector('#view-admin-suppliers .adm-chip[data-filter="all"]');
    if (allChip) allChip.classList.add('active');
    admSupRender();
  });

  /* ══════════════════ BUYERS DIRECTORY ══════════════════ */
  let admBuyFilter = 'all';

  function buyerStats(buyerId) {
    const orders = (window.SL.getOrders() || []).filter(o => o.buyerId === buyerId);
    const totalSpent = orders.reduce((s,o) => s + (o.total || 0), 0);
    return { orderCount: orders.length, totalSpent };
  }

  function admBuyRender() {
    const users = window.SL.getUsers() || [];
    const buyers = users.filter(u => u.role === 'buyer');
    const household = buyers.filter(u => u.buyerType === 'household').length;
    const business = buyers.filter(u => u.buyerType === 'business').length;
    const suspended = buyers.filter(u => u.status === 'suspended').length;

    document.getElementById('adm-buy-count').textContent = buyers.length + ' Total';
    document.getElementById('adm-buy-stat-total').textContent = buyers.length;
    document.getElementById('adm-buy-stat-household').textContent = household;
    document.getElementById('adm-buy-stat-business').textContent = business;
    document.getElementById('adm-buy-stat-suspended').textContent = suspended;

    let list = buyers;
    if (admBuyFilter === 'household' || admBuyFilter === 'business') list = list.filter(u => u.buyerType === admBuyFilter);
    else if (admBuyFilter === 'suspended') list = list.filter(u => u.status === 'suspended');

    list = list.slice().sort((a,b) => buyerStats(b.id).totalSpent - buyerStats(a.id).totalSpent);

    const listEl = document.getElementById('adm-buyer-list');
    if (list.length === 0) {
      listEl.innerHTML = '<div class="adm-dir-empty">No buyers match this filter.</div>';
      return;
    }

    listEl.innerHTML = list.map(u => {
      const stats = buyerStats(u.id);
      const status = u.status || 'active';
      const displayName = u.bizName || u.name;
      const actionsHtml = status === 'suspended'
        ? `<div class="adm-dir-actions"><button class="adm-dir-btn reactivate" onclick="admBuyReactivate('${u.id}')">Reactivate</button><button class="adm-dir-btn message" onclick="admOpenMessageModal('${u.id}')">Message</button></div>`
        : `<div class="adm-dir-actions"><button class="adm-dir-btn suspend" onclick="admBuySuspend('${u.id}')">Suspend</button><button class="adm-dir-btn message" onclick="admOpenMessageModal('${u.id}')">Message</button></div>`;
      return `
        <div class="adm-dir-card">
          <div class="adm-dir-top">
            <div class="adm-dir-avatar">${initials(displayName)}</div>
            <div>
              <div class="adm-dir-name">${displayName}</div>
              <div class="adm-dir-sub">${u.buyerType === 'business' ? '🏢 Business' : '🏠 Household'} · ${u.address || '—'}</div>
            </div>
            <span class="adm-dir-badge st-${status === 'suspended' ? 'suspended' : 'active'}">${status === 'suspended' ? 'suspended' : 'active'}</span>
          </div>
          <div class="adm-dir-stats">
            <div class="adm-dir-stat"><div class="adm-dir-stat-val">${stats.orderCount}</div><div class="adm-dir-stat-lbl">Orders</div></div>
            <div class="adm-dir-stat"><div class="adm-dir-stat-val">${fmtGHS2(stats.totalSpent)}</div><div class="adm-dir-stat-lbl">Total Spent</div></div>
          </div>
          ${actionsHtml}
        </div>`;
    }).join('');
  }

  window.admBuySetFilter = function(f, btn) {
    admBuyFilter = f;
    document.querySelectorAll('#view-admin-buyers .adm-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    admBuyRender();
  };

  window.admBuySuspend = function(id) {
    const users = window.SL.getUsers() || [];
    const u = users.find(x => x.id === id);
    if (!confirm('Suspend ' + (u ? (u.bizName||u.name) : 'this buyer') + '? They will not be able to log in or place orders until reactivated.')) return;
    const idx = users.findIndex(x => x.id === id);
    if (idx === -1) return;
    users[idx].status = 'suspended';
    window.SL.saveUsers(users);
    admBuyRender();
  };

  window.admBuyReactivate = function(id) {
    const users = window.SL.getUsers() || [];
    const idx = users.findIndex(u => u.id === id);
    if (idx === -1) return;
    users[idx].status = 'active';
    window.SL.saveUsers(users);
    admBuyRender();
  };

  /* ── Message Buyer (v11.98) — admin composes, buyer reads in-app ── */
  let admMessageTargetId = null;
  window.admOpenMessageModal = function(buyerId) {
    const users = window.SL.getUsers() || [];
    const u = users.find(x => x.id === buyerId);
    if (!u) return;
    admMessageTargetId = buyerId;
    document.getElementById('adm-message-buyer-name').textContent = 'To: ' + (u.bizName || u.name);
    document.getElementById('adm-message-text').value = '';
    openAdmModal('message');
  };
  window.admSendMessage = function() {
    const text = (document.getElementById('adm-message-text').value || '').trim();
    if (!text) { admShowToast('Type a message first.'); return; }
    if (!admMessageTargetId) return;
    window.SL.sendMessage(admMessageTargetId, text, 'SupplyLink Team');
    closeAdmModal('message');
    admShowToast('✅ Message sent!');
    admMessageTargetId = null;
  };

  window.SL.registerInit('admin-buyers', function() {
    admBuyFilter = 'all';
    document.querySelectorAll('#view-admin-buyers .adm-chip').forEach(c => c.classList.remove('active'));
    const allChip = document.querySelector('#view-admin-buyers .adm-chip[data-filter="all"]');
    if (allChip) allChip.classList.add('active');
    admBuyRender();
  });

  /* ══════════════════ BUSINESS ANALYTICS ══════════════════ */
  function bizCommission(order) {
    return (order.items || []).reduce((s, it) => s + (((it.buyerPrice||0) - (it.supplierPrice||0)) * (it.qty||0)), 0);
  }
  function bizOrderValue(order) {
    return (order.items || []).reduce((s, it) => s + ((it.buyerPrice||0) * (it.qty||0)), 0);
  }

  let admAnalyticsPeriodDays = 7; // a number of days, or the string 'all'

  window.admAnalyticsSetPeriod = function(period, el) {
    admAnalyticsPeriodDays = period;
    document.querySelectorAll('#view-admin-analytics .adm-chip').forEach(c => c.classList.remove('active'));
    if (el) el.classList.add('active');
    admAnalyticsRender();
  };

  function admAnalyticsRender() {
    const orders = window.SL.getOrders() || [];
    const users = window.SL.getUsers() || [];

    // Resolve the period boundary once, then filter EVERYTHING below —
    // including the headline tiles — against it. Previously the tiles
    // stayed all-time regardless of the period toggle while the charts
    // beneath them didn't, which was the reported inconsistency.
    let periodDays = admAnalyticsPeriodDays;
    let periodStart;
    if (periodDays === 'all') {
      const earliest = orders.length ? orders.reduce((min, o) => Math.min(min, o.createdAt || Date.now()), Date.now()) : Date.now();
      periodStart = new Date(earliest);
      periodStart.setHours(0, 0, 0, 0);
      periodDays = Math.max(1, Math.ceil((Date.now() - periodStart.getTime()) / 86400000) + 1);
    } else {
      periodStart = new Date();
      periodStart.setDate(periodStart.getDate() - (periodDays - 1));
      periodStart.setHours(0, 0, 0, 0);
    }
    const periodStartMs = periodStart.getTime();

    const periodOrders = orders.filter(o => (o.createdAt || 0) >= periodStartMs);
    const activeOrders = periodOrders.filter(o => o.status !== 'cancelled');
    const cancelledOrders = periodOrders.filter(o => o.status === 'cancelled');

    const totalCommission = activeOrders.reduce((s, o) => s + bizCommission(o), 0);
    const gmv = activeOrders.reduce((s, o) => s + bizOrderValue(o), 0);
    const aov = activeOrders.length > 0 ? gmv / activeOrders.length : 0;
    const cancelRate = periodOrders.length > 0 ? (cancelledOrders.length / periodOrders.length) * 100 : 0;

    // "Active" here means transacted in this period, not lifetime account
    // status — this is what makes these tiles genuinely period-scoped
    // instead of frozen totals.
    const supplierIdsInPeriod = new Set();
    activeOrders.forEach(o => (o.items || []).forEach(it => { if (it.supplierId) supplierIdsInPeriod.add(it.supplierId); }));
    const buyerIdsInPeriod = new Set(activeOrders.map(o => o.buyerId).filter(Boolean));

    document.getElementById('biz-an-total-revenue').textContent = fmtGHS2(totalCommission);
    document.getElementById('biz-an-gmv').textContent = fmtGHS2(gmv);
    document.getElementById('biz-an-total-orders').textContent = periodOrders.length;
    document.getElementById('biz-an-aov').textContent = fmtGHS2(aov);
    document.getElementById('biz-an-active-suppliers').textContent = supplierIdsInPeriod.size;
    document.getElementById('biz-an-active-buyers').textContent = buyerIdsInPeriod.size;
    document.getElementById('biz-an-cancelled').textContent = cancelledOrders.length;
    document.getElementById('biz-an-cancel-rate').textContent = cancelRate.toFixed(1) + '%';

    // ── Charts: daily buckets up to 31 days, weekly beyond that so a
    // 90-day or All-time view doesn't try to cram dozens of daily bars
    // into one screen. ──
    const useWeekly = periodDays > 31;
    const buckets = [];
    if (!useWeekly) {
      for (let i = periodDays - 1; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
        const label = periodDays > 7
          ? d.toLocaleDateString('en-GH', { day: 'numeric', month: 'short' })
          : d.toLocaleDateString('en-GH', { weekday: 'short' });
        buckets.push({ start: d.getTime(), end: d.getTime() + 86400000, label, commission: 0, orderCount: 0 });
      }
    } else {
      const numWeeks = Math.ceil(periodDays / 7);
      for (let i = numWeeks - 1; i >= 0; i--) {
        const end = new Date(); end.setHours(0, 0, 0, 0); end.setDate(end.getDate() - i * 7 + 1);
        const start = new Date(end); start.setDate(start.getDate() - 7);
        const label = start.toLocaleDateString('en-GH', { day: 'numeric', month: 'short' });
        buckets.push({ start: start.getTime(), end: end.getTime(), label, commission: 0, orderCount: 0 });
      }
    }
    activeOrders.forEach(o => {
      const t = o.createdAt || Date.now();
      const b = buckets.find(bb => t >= bb.start && t < bb.end);
      if (b) { b.commission += bizCommission(o); b.orderCount += 1; }
    });

    const maxCommission = Math.max(1, ...buckets.map(b => b.commission));
    document.getElementById('biz-an-chart').innerHTML = buckets.map(b => `
      <div class="biz-an-bar-col">
        <div class="biz-an-bar" style="height:${Math.max(4,(b.commission/maxCommission)*100)}px" title="${fmtGHS2(b.commission)}"></div>
        <div class="biz-an-bar-label">${b.label}</div>
      </div>`).join('');

    const maxOrders = Math.max(1, ...buckets.map(b => b.orderCount));
    document.getElementById('biz-an-orders-chart').innerHTML = buckets.map(b => `
      <div class="biz-an-bar-col">
        <div class="biz-an-bar orders-bar" style="height:${Math.max(4,(b.orderCount/maxOrders)*100)}px" title="${b.orderCount} order${b.orderCount===1?'':'s'}"></div>
        <div class="biz-an-bar-label">${b.label}</div>
      </div>`).join('');

    // ── Payment method split ──
    const momoOrders = activeOrders.filter(o => o.payment === 'momo');
    const podOrders = activeOrders.filter(o => o.payment === 'pod');
    const momoVal = momoOrders.reduce((s, o) => s + bizOrderValue(o), 0);
    const podVal = podOrders.reduce((s, o) => s + bizOrderValue(o), 0);
    const totalVal = momoVal + podVal;
    const momoPct = totalVal > 0 ? (momoVal / totalVal) * 100 : 0;
    const podPct = totalVal > 0 ? 100 - momoPct : 0;
    const splitEl = document.getElementById('biz-an-payment-split');
    splitEl.innerHTML = activeOrders.length === 0
      ? '<p style="text-align:center;color:#adb5bd;padding:16px 0;font-size:13px;">No orders yet.</p>'
      : `
        <div class="biz-an-split-row">
          <div class="biz-an-split-track">
            <div class="biz-an-split-fill momo" style="width:${momoPct}%;"></div>
            <div class="biz-an-split-fill pod" style="width:${podPct}%;"></div>
          </div>
        </div>
        <div class="biz-an-split-legend">
          <span>📱 MoMo — <b>${fmtGHS2(momoVal)}</b> (${momoOrders.length})</span>
          <span>💵 Cash on Delivery — <b>${fmtGHS2(podVal)}</b> (${podOrders.length})</span>
        </div>`;

    // ── Delivery zone breakdown ──
    const byZone = {};
    activeOrders.forEach(o => {
      const key = o.zone || (o.address === 'In-person pickup' ? 'In-person pickup' : 'Unspecified');
      if (!byZone[key]) byZone[key] = { orders: 0, value: 0 };
      byZone[key].orders += 1;
      byZone[key].value += bizOrderValue(o);
    });
    const zoneList = Object.entries(byZone).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.orders - a.orders);
    const zoneEl = document.getElementById('biz-an-zones');
    zoneEl.innerHTML = zoneList.length === 0
      ? '<p style="text-align:center;color:#adb5bd;padding:16px 0;font-size:13px;">No orders yet.</p>'
      : zoneList.map((z, i) => `
        <div class="biz-an-top-row">
          <span class="biz-an-top-rank">${i+1}</span>
          <span class="biz-an-top-name">${z.name}<div class="biz-an-top-sub">${z.orders} order${z.orders===1?'':'s'}</div></span>
          <span class="biz-an-top-val">${fmtGHS2(z.value)}</span>
        </div>`).join('');

    // ── Buyer activity: new vs returning within the period. "New" is
    // determined against the buyer's very first order ever (including
    // cancelled ones — a cancelled attempt still means they're not new
    // to the platform), not just within the visible order list. ──
    const buyerFirstOrderMs = {};
    orders.forEach(o => {
      if (!o.buyerId) return;
      const t = o.createdAt || Date.now();
      if (buyerFirstOrderMs[o.buyerId] === undefined || t < buyerFirstOrderMs[o.buyerId]) buyerFirstOrderMs[o.buyerId] = t;
    });
    let newBuyers = 0, returningBuyers = 0;
    buyerIdsInPeriod.forEach(bid => {
      if (buyerFirstOrderMs[bid] >= periodStartMs) newBuyers++; else returningBuyers++;
    });
    const retEl = document.getElementById('biz-an-retention');
    retEl.innerHTML = buyerIdsInPeriod.size === 0
      ? '<p style="text-align:center;color:#adb5bd;padding:16px 0;font-size:13px;">No buyer activity yet.</p>'
      : `
        <div class="biz-an-top-row">
          <span class="biz-an-top-name">🆕 New buyers (first order this period)</span>
          <span class="biz-an-top-val">${newBuyers}</span>
        </div>
        <div class="biz-an-top-row">
          <span class="biz-an-top-name">🔁 Returning buyers</span>
          <span class="biz-an-top-val">${returningBuyers}</span>
        </div>
        <div class="biz-an-note">Small numbers are expected while the buyer base is still growing — this becomes more meaningful as order volume increases.</div>`;

    // ── Estimated rider payouts — only shown once a rate is actually set,
    // rather than displaying a misleading GH₵0 before that's configured. ──
    const rate = (window.SL.getSettings() || {}).riderRatePerDelivery || 0;
    const deliveredInPeriod = periodOrders.filter(o => o.status === 'delivered');
    const riderCostEl = document.getElementById('biz-an-rider-cost');
    riderCostEl.innerHTML = rate > 0
      ? `
        <div class="biz-an-top-row">
          <span class="biz-an-top-name">${deliveredInPeriod.length} delivered order${deliveredInPeriod.length===1?'':'s'} × GH₵${rate.toFixed(2)}/delivery</span>
          <span class="biz-an-top-val">${fmtGHS2(deliveredInPeriod.length * rate)}</span>
        </div>
        <div class="biz-an-note">Estimate only, based on the flat per-delivery rate set in Riders.</div>`
      : '<p style="text-align:center;color:#adb5bd;padding:16px 0;font-size:13px;">Set a rider pay rate in the Riders screen to see estimated payout cost here.</p>';

    // ── Top products / suppliers — same logic as before, now correctly
    // scoped to the selected period like everything else on this page. ──
    const byProduct = {};
    activeOrders.forEach(o => (o.items||[]).forEach(it => {
      if (!byProduct[it.productName]) byProduct[it.productName] = { qty:0, commission:0 };
      byProduct[it.productName].qty += (it.qty||0);
      byProduct[it.productName].commission += ((it.buyerPrice||0)-(it.supplierPrice||0))*(it.qty||0);
    }));
    const topProducts = Object.entries(byProduct).map(([name,v]) => ({ name, qty: v.qty, commission: v.commission }))
      .sort((a,b) => b.commission - a.commission).slice(0,5);
    const prodEl = document.getElementById('biz-an-top-products');
    prodEl.innerHTML = topProducts.length === 0
      ? '<p style="text-align:center;color:#adb5bd;padding:16px 0;font-size:13px;">No sales yet.</p>'
      : topProducts.map((p,i) => `
        <div class="biz-an-top-row">
          <span class="biz-an-top-rank">${i+1}</span>
          <span class="biz-an-top-name">${p.name}<div class="biz-an-top-sub">${p.qty} units sold</div></span>
          <span class="biz-an-top-val">${fmtGHS2(p.commission)}</span>
        </div>`).join('');

    const bySupplier = {};
    activeOrders.forEach(o => (o.items||[]).forEach(it => {
      const key = it.supplierId || 'unknown';
      if (!bySupplier[key]) bySupplier[key] = { name: null, revenue: 0 };
      bySupplier[key].revenue += (it.supplierPrice||0)*(it.qty||0);
    }));
    users.filter(u=>u.role==='supplier').forEach(u => { if (bySupplier[u.id]) bySupplier[u.id].name = u.name; });
    const topSuppliers = Object.entries(bySupplier)
      .map(([id,v]) => ({ id, name: v.name || 'Unknown supplier', revenue: v.revenue }))
      .sort((a,b) => b.revenue - a.revenue).slice(0,5);
    const supEl = document.getElementById('biz-an-top-suppliers');
    supEl.innerHTML = topSuppliers.length === 0
      ? '<p style="text-align:center;color:#adb5bd;padding:16px 0;font-size:13px;">No sales yet.</p>'
      : topSuppliers.map((s,i) => `
        <div class="biz-an-top-row">
          <span class="biz-an-top-rank">${i+1}</span>
          <span class="biz-an-top-name">${s.name}</span>
          <span class="biz-an-top-val">${fmtGHS2(s.revenue)}</span>
        </div>`).join('');
  }

  window.SL.registerInit('admin-analytics', function() {
    admAnalyticsRender();
  });

  /* ══════════════════ SUPPLIER PAYOUTS LEDGER ══════════════════ */
  let admPayFilter = 'unpaid';

  /* ── PAYOUT CONFIG ──────────────────────────────────────────
     'simulate' fakes a MoMo transfer (no real money moves) so the
     full flow can be built and tested before a Paystack account and
     RGD business registration are in place. Flip to 'live' and set
     PAYOUT_FUNCTION_URL once the real Supabase Edge Function is
     deployed (see /supabase/functions/initiate-payout). ── */
  const PAYOUT_MODE = 'simulate'; // 'simulate' | 'live'
  const PAYOUT_FUNCTION_URL = ''; // e.g. 'https://fgmlwopvbdzgjclyekmd.supabase.co/functions/v1/initiate-payout'

  function runPayoutTransfer(payload) {
    if (PAYOUT_MODE === 'simulate') {
      return new Promise(resolve => {
        setTimeout(() => {
          const ok = Math.random() > 0.12; // occasional simulated failure so the retry path is visible/testable
          resolve(ok
            ? { success: true, reference: 'SIM-' + Date.now().toString(36).toUpperCase() }
            : { success: false, reason: 'Simulated network timeout (test mode — no real transfer was attempted)' });
        }, 1400);
      });
    }
    if (!PAYOUT_FUNCTION_URL) {
      return Promise.resolve({ success: false, reason: 'PAYOUT_FUNCTION_URL is not set yet — cannot go live.' });
    }
    return fetch(PAYOUT_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(r => r.json()).catch(() => ({ success: false, reason: 'Could not reach the payout service.' }));
  }

  function getPayoutLines() {
    const orders = (window.SL.getOrders() || []).filter(o => o.status === 'delivered');
    const payouts = window.SL.getPayouts();
    const users = window.SL.getUsers() || [];
    const lines = [];
    orders.forEach(o => {
      const bySupplier = {};
      (o.items || []).forEach(it => {
        const sid = it.supplierId;
        if (!sid) return;
        bySupplier[sid] = (bySupplier[sid] || 0) + ((it.supplierPrice || 0) * (it.qty || 0));
      });
      Object.entries(bySupplier).forEach(([supplierId, amount]) => {
        const key = o.id + '::' + supplierId;
        const rec = payouts[key] || {};
        const supplier = users.find(u => u.id === supplierId);
        const refunded = window.SL.getRefundedAmountForOrderSupplier(o.id, supplierId);
        const netAmount = Math.max(0, amount - refunded);
        if (netAmount === 0) return;
        lines.push({
          key, orderId: o.id, supplierId,
          supplierName: supplier ? supplier.name : 'Unknown supplier',
          momo: supplier ? supplier.momo : null,
          momoNetwork: supplier ? supplier.momoNetwork : null,
          amount: netAmount,
          deliveredAt: o.createdAt,
          status: rec.status || 'unpaid',
          paidAt: rec.paidAt || null,
          method: rec.method || null,
          transferReference: rec.transferReference || null,
          errorReason: rec.errorReason || null
        });
      });
    });
    return lines;
  }

  function admPayRender() {
    const banner = document.getElementById('pay-mode-banner');
    if (banner) {
      banner.innerHTML = PAYOUT_MODE === 'simulate'
        ? `<div style="background:#fff3cd;color:#8a6d1a;border-radius:10px;padding:10px 12px;font-size:12px;font-weight:600;margin-bottom:12px;">🧪 SIMULATE MODE — "Pay via MoMo" fakes a transfer for testing. No real money moves until this is switched to live with a real Paystack account.</div>`
        : '';
    }
    const allLines = getPayoutLines();
    const totalUnpaid = allLines.filter(l => l.status !== 'paid').reduce((s,l) => s + l.amount, 0);
    const totalPaid = allLines.filter(l => l.status === 'paid').reduce((s,l) => s + l.amount, 0);
    const suppliersOwed = new Set(allLines.filter(l => l.status !== 'paid').map(l => l.supplierId)).size;

    document.getElementById('pay-stat-unpaid').textContent = fmtGHS2(totalUnpaid);
    document.getElementById('pay-stat-paid').textContent = fmtGHS2(totalPaid);
    document.getElementById('pay-stat-suppliers').textContent = suppliersOwed;
    document.getElementById('pay-owed-count').textContent = suppliersOwed + ' Owed';

    let lines = allLines;
    if (admPayFilter === 'unpaid') lines = lines.filter(l => l.status !== 'paid');
    else if (admPayFilter !== 'all') lines = lines.filter(l => l.status === admPayFilter);

    const listEl = document.getElementById('pay-list');
    if (lines.length === 0) {
      listEl.innerHTML = '<div class="pay-empty">No ' + (admPayFilter === 'all' ? '' : admPayFilter + ' ') + 'payouts to show.</div>';
      return;
    }

    /* Group by supplier */
    const groups = {};
    lines.forEach(l => {
      if (!groups[l.supplierId]) groups[l.supplierId] = { name: l.supplierName, momo: l.momo, lines: [] };
      groups[l.supplierId].lines.push(l);
    });
    /* Sort groups: highest unpaid balance first */
    const groupArr = Object.entries(groups).map(([id, g]) => ({
      id, name: g.name, momo: g.momo, lines: g.lines,
      unpaidTotal: g.lines.filter(l => l.status === 'unpaid').reduce((s,l) => s + l.amount, 0)
    })).sort((a,b) => b.unpaidTotal - a.unpaidTotal);

    listEl.innerHTML = groupArr.map(g => {
      const hasUnpaid = g.lines.some(l => l.status === 'unpaid');
      const isUnknown = !(window.SL.getUsers() || []).find(u => u.id === g.id);
      const linesHtml = g.lines
        .slice()
        .sort((a,b) => (b.deliveredAt||0) - (a.deliveredAt||0))
        .map(l => {
          let actionHtml;
          if (l.status === 'paid') {
            actionHtml = `<span class="pay-badge paid">Paid${l.method === 'MoMo (Auto)' ? ' · Auto' : ''}</span>`;
          } else if (l.status === 'processing') {
            actionHtml = `<span class="pay-badge" style="background:#fff3cd;color:#8a6d1a;">⏳ Sending…</span>`;
          } else if (l.status === 'failed') {
            actionHtml = `<button class="pay-line-btn" style="background:#c0392b;" onclick="admPayAutoPay('${l.key}')" title="${(l.errorReason||'').replace(/"/g,'&quot;')}">⚠️ Failed — Retry</button>`;
          } else {
            actionHtml = `
              <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;">
                ${g.momo ? `<button class="pay-line-btn" onclick="admPayAutoPay('${l.key}')">⚡ Pay via MoMo</button>` : ''}
                <button class="pay-line-btn" style="background:#888;font-size:11px;padding:6px 10px;" onclick="admPayMarkPaid('${l.key}')">Mark Paid manually</button>
              </div>`;
          }
          return `
          <div class="pay-line">
            <div class="pay-line-info">
              <div class="pay-line-order">Order ${l.orderId}</div>
              <div class="pay-line-date">${l.deliveredAt ? new Date(l.deliveredAt).toLocaleDateString('en-GH', {day:'numeric',month:'short',year:'numeric'}) : '—'}${l.status === 'failed' && l.errorReason ? ' · ' + l.errorReason : ''}</div>
            </div>
            <span class="pay-line-amount">${fmtGHS2(l.amount)}</span>
            ${actionHtml}
          </div>`;
        }).join('');
      return `
        <div class="pay-group">
          <div class="pay-group-header">
            <div class="pay-group-avatar">${initials(g.name)}</div>
            <div>
              <div class="pay-group-name">${g.name}</div>
              <div class="pay-group-momo">${g.momo ? 'MoMo: ' + g.momo : 'No MoMo number on file'}</div>
            </div>
            <div class="pay-group-balance">
              <div class="pay-group-balance-val">${fmtGHS2(g.unpaidTotal)}</div>
              <div class="pay-group-balance-lbl">Unpaid</div>
            </div>
          </div>
          ${isUnknown ? `<button class="pay-mark-all-btn" style="background:#fff3cd;color:#8a6d1a;" onclick="openReassignSupplierModal('${g.id}')">⚠️ Reassign to a real supplier</button>` : ''}
          ${hasUnpaid && g.momo ? `<button class="pay-mark-all-btn" onclick="admPayAutoPayAll('${g.id}')">⚡ Pay All via MoMo for ${g.name}</button>` : ''}
          ${hasUnpaid ? `<button class="pay-mark-all-btn" style="background:#888;" onclick="admPayMarkAllPaid('${g.id}')">✓ Mark All Paid manually</button>` : ''}
          ${linesHtml}
        </div>`;
    }).join('');
  }

  /* ── FIX ORPHANED SUPPLIER IDS ──────────────────────────────
     Products (and the orders built from them) can end up with a
     supplierId that no longer matches any registered user — usually
     a product added through an older admin tool that used placeholder
     supplier data. This lets admin permanently reassign every product
     and order line carrying that bad id to a real supplier account. */
  function closeReassignSupplierModal() {
    const el = document.getElementById('slReassignModal');
    if (el) el.remove();
    window.slPopOverlay();
  }
  window.closeReassignSupplierModal = closeReassignSupplierModal;

  function openReassignSupplierModal(badId) {
    const existing = document.getElementById('slReassignModal');
    if (existing) existing.remove();

    const realSuppliers = (window.SL.getUsers() || []).filter(u => u.role === 'supplier' && u.status === 'active');
    const products = window.SL.getProducts() || [];
    const affectedProducts = products.filter(p => p.supplierId === badId);
    const orders = window.SL.getOrders() || [];
    const affectedOrderCount = orders.filter(o => (o.items||[]).some(it => it.supplierId === badId)).length;

    const modal = document.createElement('div');
    modal.id = 'slReassignModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:2100;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:24px;max-width:420px;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-height:90vh;overflow-y:auto;">
        <div style="font-size:16px;font-weight:700;margin-bottom:4px;">Reassign Supplier</div>
        <div style="font-size:13px;color:#777;margin-bottom:16px;">
          This affects ${affectedProducts.length} product${affectedProducts.length === 1 ? '' : 's'} and ${affectedOrderCount} order${affectedOrderCount === 1 ? '' : 's'} currently linked to id <code>${badId}</code>.
          Picking the correct supplier below will permanently relink them so payouts and analytics show the right name going forward.
        </div>
        ${realSuppliers.length === 0 ? `
          <div style="font-size:13px;color:#c0392b;margin-bottom:12px;">No active supplier accounts found yet. Register or approve the correct supplier first, then come back here.</div>
          <button style="width:100%;background:#f0f0f0;border:none;padding:12px;border-radius:10px;font-weight:700;cursor:pointer;" onclick="window.closeReassignSupplierModal()">Close</button>
        ` : `
          <label style="font-size:12px;font-weight:700;color:#333;">Which supplier are these actually from?</label>
          <select id="slReassignSelect" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:10px;font-size:13px;margin:6px 0 16px;box-sizing:border-box;">
            <option value="">Select supplier…</option>
            ${realSuppliers.map(s => `<option value="${s.id}">${s.name}${s.location ? ' — ' + s.location : ''}</option>`).join('')}
          </select>
          <div style="display:flex;gap:10px;">
            <button style="flex:1;background:#f0f0f0;border:none;padding:12px;border-radius:10px;font-weight:700;cursor:pointer;" onclick="window.closeReassignSupplierModal()">Cancel</button>
            <button style="flex:1;background:#1a472a;color:#fff;border:none;padding:12px;border-radius:10px;font-weight:700;cursor:pointer;" onclick="confirmReassignSupplier('${badId}')">Reassign</button>
          </div>
        `}
      </div>`;
    document.body.appendChild(modal);
    window.slPushOverlay(closeReassignSupplierModal);
  }

  function confirmReassignSupplier(badId) {
    const sel = document.getElementById('slReassignSelect');
    const newId = sel ? sel.value : '';
    if (!newId) { alert('Please select a supplier.'); return; }
    const newSupplier = (window.SL.getUsers() || []).find(u => u.id === newId);
    if (!newSupplier) return;

    // Fix products
    const products = window.SL.getProducts() || [];
    let productsFixed = 0;
    products.forEach(p => {
      if (p.supplierId === badId) {
        p.supplierId = newId;
        p.supplierName = newSupplier.name;
        productsFixed++;
      }
    });
    localStorage.setItem('sl_products', JSON.stringify(products));

    // Fix orders (items + supplierBreakdown)
    const orders = window.SL.getOrders() || [];
    let ordersFixed = 0;
    orders.forEach(o => {
      let touched = false;
      (o.items || []).forEach(it => {
        if (it.supplierId === badId) { it.supplierId = newId; it.supplierName = newSupplier.name; touched = true; }
      });
      (o.supplierBreakdown || []).forEach(g => {
        if (g.supplierId === badId) { g.supplierId = newId; g.supplierName = newSupplier.name; touched = true; }
      });
      if (touched) ordersFixed++;
    });
    localStorage.setItem('sl_orders', JSON.stringify(orders));

    closeReassignSupplierModal();
    if (typeof admPayRender === 'function') admPayRender();
    alert(`Done — ${productsFixed} product(s) and ${ordersFixed} order(s) reassigned to ${newSupplier.name}.`);
  }
  window.openReassignSupplierModal = openReassignSupplierModal;
  window.confirmReassignSupplier = confirmReassignSupplier;

  window.admPaySetFilter = function(f, btn) {
    admPayFilter = f;
    document.querySelectorAll('#view-admin-payouts .adm-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    admPayRender();
  };

  window.admPayMarkPaid = function(key) {
    const line = getPayoutLines().find(l => l.key === key);
    if (!line) return;
    if (!confirm('Confirm you have sent ' + fmtGHS2(line.amount) + ' to ' + line.supplierName + ' via MoMo' + (line.momo ? ' (' + line.momo + ')' : '') + '?')) return;
    window.SL.setPayoutStatus(key, { status: 'paid', paidAt: Date.now(), method: 'MoMo' });
    const users = window.SL.getUsers() || [];
    const supplier = users.find(u => u.id === line.supplierId);
    if (supplier && supplier.phone) {
      window.SL.sms({
        to: supplier.phone,
        message: 'SupplyLink GH: Payment sent! ' + fmtGHS2(line.amount) + ' for order ' + line.orderId + ' has been sent to your MoMo. Thank you for supplying with us!',
        event: 'payout_paid',
        orderId: line.orderId
      });
    }
    admPayRender();
  };

  window.admPayMarkAllPaid = function(supplierId) {
    const lines = getPayoutLines().filter(l => l.supplierId === supplierId && l.status === 'unpaid');
    if (lines.length === 0) return;
    const total = lines.reduce((s,l) => s + l.amount, 0);
    const name = lines[0].supplierName;
    const momo = lines[0].momo;
    if (!confirm('Confirm you have sent a total of ' + fmtGHS2(total) + ' to ' + name + ' via MoMo' + (momo ? ' (' + momo + ')' : '') + ' for ' + lines.length + ' order(s)?')) return;
    lines.forEach(l => window.SL.setPayoutStatus(l.key, { status: 'paid', paidAt: Date.now(), method: 'MoMo' }));
    const users = window.SL.getUsers() || [];
    const supplier = users.find(u => u.id === supplierId);
    if (supplier && supplier.phone) {
      window.SL.sms({
        to: supplier.phone,
        message: 'SupplyLink GH: Payment sent! ' + fmtGHS2(total) + ' for ' + lines.length + ' delivered order(s) has been sent to your MoMo. Thank you for supplying with us!',
        event: 'payout_paid_bulk'
      });
    }
    admPayRender();
  };

  window.admPayAutoPay = async function(key) {
    const line = getPayoutLines().find(l => l.key === key);
    if (!line) return;
    const users = window.SL.getUsers() || [];
    const supplier = users.find(u => u.id === line.supplierId);
    if (!supplier || !supplier.momo) {
      alert('This supplier has no MoMo number on file yet. Ask them to add it in their profile, or use "Mark Paid manually" instead.');
      return;
    }
    const confirmMsg = 'Send ' + fmtGHS2(line.amount) + ' to ' + line.supplierName + ' (' + supplier.momo + ') via MoMo automatically?' +
      (PAYOUT_MODE === 'simulate' ? '\n\n🧪 SIMULATE MODE — no real money will move.' : '');
    if (!confirm(confirmMsg)) return;

    window.SL.setPayoutStatus(key, { status: 'processing', initiatedAt: Date.now(), errorReason: null });
    admPayRender();

    const result = await runPayoutTransfer({
      supplierId: supplier.id, momo: supplier.momo, network: supplier.momoNetwork || 'mtn',
      amount: line.amount, reference: key
    });

    if (result.success && result.pending) {
      // Live mode: Paystack accepted the transfer but hasn't confirmed it landed yet.
      // Stays 'processing' — the webhook (server-side) flips this to 'paid' once confirmed.
      window.SL.setPayoutStatus(key, {
        status: 'processing', method: 'MoMo (Auto)', provider: 'paystack',
        transferReference: result.reference, errorReason: null
      });
    } else if (result.success) {
      window.SL.setPayoutStatus(key, {
        status: 'paid', paidAt: Date.now(), method: 'MoMo (Auto)',
        provider: 'paystack', transferReference: result.reference, errorReason: null
      });
      if (supplier.phone) {
        window.SL.sms({
          to: supplier.phone,
          message: 'SupplyLink GH: Payment sent! ' + fmtGHS2(line.amount) + ' for order ' + line.orderId + ' has been sent to your MoMo. Thank you for supplying with us!',
          event: 'payout_paid', orderId: line.orderId
        });
      }
    } else {
      window.SL.setPayoutStatus(key, { status: 'failed', failedAt: Date.now(), errorReason: result.reason || 'Transfer failed' });
    }
    admPayRender();
  };

  window.admPayAutoPayAll = async function(supplierId) {
    const lines = getPayoutLines().filter(l => l.supplierId === supplierId && l.status === 'unpaid');
    if (lines.length === 0) return;
    const users = window.SL.getUsers() || [];
    const supplier = users.find(u => u.id === supplierId);
    if (!supplier || !supplier.momo) {
      alert('This supplier has no MoMo number on file yet.');
      return;
    }
    const total = lines.reduce((s,l) => s + l.amount, 0);
    const confirmMsg = 'Send a total of ' + fmtGHS2(total) + ' to ' + supplier.name + ' (' + supplier.momo + ') across ' + lines.length + ' order(s) via MoMo automatically?' +
      (PAYOUT_MODE === 'simulate' ? '\n\n🧪 SIMULATE MODE — no real money will move.' : '');
    if (!confirm(confirmMsg)) return;

    for (const line of lines) {
      window.SL.setPayoutStatus(line.key, { status: 'processing', initiatedAt: Date.now(), errorReason: null });
    }
    admPayRender();

    let paidTotal = 0, failedCount = 0;
    for (const line of lines) {
      const result = await runPayoutTransfer({
        supplierId: supplier.id, momo: supplier.momo, network: supplier.momoNetwork || 'mtn',
        amount: line.amount, reference: line.key
      });
      if (result.success && result.pending) {
        window.SL.setPayoutStatus(line.key, {
          status: 'processing', method: 'MoMo (Auto)', provider: 'paystack',
          transferReference: result.reference, errorReason: null
        });
      } else if (result.success) {
        window.SL.setPayoutStatus(line.key, {
          status: 'paid', paidAt: Date.now(), method: 'MoMo (Auto)',
          provider: 'paystack', transferReference: result.reference, errorReason: null
        });
        paidTotal += line.amount;
      } else {
        window.SL.setPayoutStatus(line.key, { status: 'failed', failedAt: Date.now(), errorReason: result.reason || 'Transfer failed' });
        failedCount++;
      }
      admPayRender();
    }

    if (paidTotal > 0 && supplier.phone) {
      window.SL.sms({
        to: supplier.phone,
        message: 'SupplyLink GH: Payment sent! ' + fmtGHS2(paidTotal) + ' for delivered order(s) has been sent to your MoMo. Thank you for supplying with us!',
        event: 'payout_paid_bulk'
      });
    }
    if (failedCount > 0) {
      alert(failedCount + ' of ' + lines.length + ' transfer(s) failed and can be retried individually below.');
    }
  };

  window.SL.registerInit('admin-payouts', function() {
    admPayFilter = 'unpaid';
    document.querySelectorAll('#view-admin-payouts .adm-chip').forEach(c => c.classList.remove('active'));
    const unpaidChip = document.querySelector('#view-admin-payouts .adm-chip[data-filter="unpaid"]');
    if (unpaidChip) unpaidChip.classList.add('active');
    admPayRender();
  });

  window.admSupRender = admSupRender;
  window.admBuyRender = admBuyRender;
  window.admPayRender = admPayRender;
  window.getPayoutLines = getPayoutLines;

})();
