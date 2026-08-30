
  (function() {
    'use strict';
    
  /* ── DATA ── */
  /* 
   * INTEGRATION NOTE:
   * Replace this static array with a fetch() call to your backend API.
   * Expected shape per product:
   *   { id, name, category, emoji, unit, markedUpPrice, description }
   * markedUpPrice is the buyer-facing price (supplier base + your commission).
   * Never expose the base price here.
   */
  const CATEGORY_EMOJI = {
    "Vegetables":"🥦","Fruits":"🍊","Grains & Cereals":"🌾","Grains":"🌾",
    "Tubers":"🍠","Proteins":"🥩","Meat & Poultry":"🍗","Fish & Seafood":"🐟",
    "Cooking Oil":"🛢️","Spices & Herbs":"🧄","Spices":"🧄","Biscuits & Snacks":"🍪",
    "Drinks & Beverages":"🥤","Groceries":"🛒","Packaged Goods":"📦","Other":"📋"
  };

  let PRODUCTS = [];
  let CATEGORIES = ["All"];

  function loadProductsFromSL() {
    const live = window.SL.getProducts().filter(p => p.isAvailable !== false && p.stockQty > 0);
    const allUsers = (window.SL.getUsers && window.SL.getUsers()) || [];
    PRODUCTS = live.map(p => {
      const supplier = allUsers.find(u => u.id === p.supplierId);
      const tier = window.SL.getProductTier(p);
      return {
        id: p.id,
        name: p.name,
        category: p.category,
        emoji: CATEGORY_EMOJI[p.category] || "🛒",
        unit: p.unit,
        weightKg: p.weightKg,
        markedUpPrice: p.buyerPrice,
        description: p.description || "",
        stock: p.stockQty,
        supplierId: p.supplierId,
        supplierName: supplier ? (supplier.name || supplier.phone) : "Unknown supplier",
        tier,
        images: p.images || [],
        createdAt: p.createdAt || 0
      };
    });
    CATEGORIES = ["All", ...new Set(PRODUCTS.map(p => p.category))];
  }

  /* ── STATE ── */
  let cart = {}; // { productId: quantity }
  let activeCategory = "All";
  let searchQuery = "";
  let modalProduct = null;
  let modalQtyVal = 1;

  /* ── INIT ── */
  function init() {
    loadProductsFromSL();
    cart = loadPersistedCart();
    renderCategories();
    renderFilterBar();
    renderProducts();
    updateCartBadge();
    renderLocationBanner();
    refreshBellBadge();
    refreshOrdersBadge();
    refreshMessagesBadge();
    renderUsualOrderRow();
  }

  /* Cart persistence: previously the cart only got saved to storage at the
   * moment "Proceed to Checkout" was clicked, and re-entering this view
   * always reset it to empty regardless — so going back to browse more
   * products (or a page refresh) wiped out whatever was in the cart. Now
   * every add/remove/qty-change saves immediately, and this view loads
   * from that saved copy instead of always starting blank. Uses
   * localStorage (not sessionStorage) so it also survives a full app
   * reload/re-login, not just in-tab navigation.
   *
   * Scoped per logged-in buyer (by phone number) — otherwise buyer B
   * logging in on the same device would see buyer A's leftover cart,
   * since a single shared key doesn't know who it belongs to. */
  function getCartStorageKey() {
    const u = window.SL.currentUser();
    return 'slm_cart_' + (u && u.phone ? u.phone : 'guest');
  }
  window.getCartStorageKey = getCartStorageKey;
  function loadPersistedCart() {
    try { return JSON.parse(localStorage.getItem(getCartStorageKey()) || '{}'); }
    catch (e) { return {}; }
  }
  function persistCart() {
    localStorage.setItem(getCartStorageKey(), JSON.stringify(cart));
  }

  /* ── NOTIFICATION BELL ── */
  function refreshBellBadge() {
    const badge = document.getElementById('b3-bell-badge');
    const bbnBadge = document.getElementById('bbn-notif-badge');
    if (!window.SL) return;
    const u = window.SL.currentUser ? window.SL.currentUser() : null;
    const count = (u && window.SL.unreadNotificationCount) ? window.SL.unreadNotificationCount(u.id) : 0;
    [badge, bbnBadge].forEach(function(el) {
      if (!el) return;
      if (count > 0) {
        el.textContent = count > 9 ? '9+' : String(count);
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
      } else {
        el.style.display = 'none';
      }
    });
  }

  /* ── "ORDERS TO RATE" BADGE — surfaces the review flow that otherwise lives
     buried inside My Orders, so buyers actually notice it exists. ── */
  function refreshOrdersBadge() {
    const badge = document.getElementById('b3-orders-badge');
    const bbnBadge = document.getElementById('bbn-orders-badge');
    if (!badge || !window.SL) return;
    const u = window.SL.currentUser ? window.SL.currentUser() : null;
    if (!u) { badge.style.display = 'none'; if (bbnBadge) bbnBadge.style.display = 'none'; return; }
    const orders = (window.SL.getOrders() || []).filter(o => o.buyerId === u.id && o.status === 'delivered');
    const pendingReviews = orders.some(o => window.SL.getOrderSupplierGroups(o).some(sb => !window.SL.hasReviewed(o.id, sb.supplierId)));
    if (pendingReviews) {
      badge.textContent = '★';
      badge.style.display = 'flex';
      badge.style.alignItems = 'center';
      badge.style.justifyContent = 'center';
      if (bbnBadge) { bbnBadge.textContent = '★'; bbnBadge.style.display = 'flex'; bbnBadge.style.alignItems = 'center'; bbnBadge.style.justifyContent = 'center'; }
    } else {
      badge.style.display = 'none';
      if (bbnBadge) bbnBadge.style.display = 'none';
    }
  }

  function closeNotifPanel() {
    const el = document.getElementById('slNotifPanel');
    if (el) el.remove();
    window.slPopOverlay();
  }
  window.closeNotifPanel = closeNotifPanel;

  function goToOrderFromNotif(orderId) {
    const el = document.getElementById('slNotifPanel');
    if (el) el.remove();
    window.showTrackingPanel(window.SL.getOrders().find(x => x.id === orderId), true);
  }
  window.goToOrderFromNotif = goToOrderFromNotif;

  function showNotificationsPanel() {
    const u = window.SL.currentUser ? window.SL.currentUser() : null;
    const existing = document.getElementById('slNotifPanel');
    if (existing) existing.remove();
    const list = u && window.SL.getNotifications ? window.SL.getNotifications(u.id) : [];
    const rowsHTML = list.length ? list.map(n => {
      const clickable = !!n.orderId;
      return `
      <div style="background:#fff;border-radius:12px;padding:14px;margin-bottom:10px;box-shadow:0 1px 4px rgba(0,0,0,.06);${n.read ? '' : 'border-left:3px solid #F59E0B;'}${clickable ? 'cursor:pointer;' : ''}"
        ${clickable ? `onclick="window.goToOrderFromNotif('${n.orderId}')"` : ''}>
        <div style="font-size:13px;line-height:1.5;color:#222;">${n.message}</div>
        <div style="font-size:11px;color:#999;margin-top:6px;">${new Date(n.createdAt).toLocaleString('en-GH', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}${clickable ? ' · Tap to view order' : ''}</div>
      </div>`;
    }).join('') : `
      <div class="empty-state" style="padding:40px 20px;text-align:center;">
        <div class="emoji" style="font-size:40px;margin-bottom:10px;">🔔</div>
        <h3 style="font-size:15px;margin-bottom:6px;">No notifications yet</h3>
        <p style="font-size:13px;color:#777;">Updates about your orders will show up here.</p>
      </div>`;

    const panel = document.createElement('div');
    panel.id = 'slNotifPanel';
    panel.style.cssText = 'position:fixed;inset:0;z-index:3010;background:#f5f7f5;overflow-y:auto;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
    panel.innerHTML = `
      <div style="background:#1a472a;color:#fff;padding:16px 20px;display:flex;align-items:center;gap:12px;position:sticky;top:0;">
        <button style="background:rgba(255,255,255,.15);border:none;color:#fff;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:14px;" onclick="window.closeNotifPanel()">← Back</button>
        <div style="font-size:18px;font-weight:700;">Notifications</div>
      </div>
      <div style="padding:20px;max-width:520px;margin:0 auto;">${rowsHTML}</div>`;
    document.body.appendChild(panel);
    window.slPushOverlay(closeNotifPanel);
    if (u && window.SL.markNotificationsRead) {
      window.SL.markNotificationsRead(u.id);
      refreshBellBadge();
    }
  }

  /* ── MESSAGES from SupplyLink admin (v11.98) ──
     One-directional: admin sends, buyer reads here. Mirrors the
     notifications panel's structure and overlay handling exactly, so it
     behaves consistently with everything else in the app. */
  function closeMessagesPanel() {
    const el = document.getElementById('slMessagesPanel');
    if (el) el.remove();
    window.slPopOverlay();
  }
  window.closeMessagesPanel = closeMessagesPanel;

  function refreshMessagesBadge() {
    if (!window.SL || !window.SL.currentUser) return;
    const u = window.SL.currentUser();
    const count = u ? window.SL.unreadMessageCount(u.id) : 0;
    [document.getElementById('profileMsgBadge'), document.getElementById('supplierMsgBadge')].forEach(function(tileBadge) {
      if (!tileBadge) return;
      if (count > 0) {
        tileBadge.textContent = count > 9 ? '9+' : String(count);
        tileBadge.style.display = 'flex';
      } else {
        tileBadge.style.display = 'none';
      }
    });
    const bnBadge = document.getElementById('b5-bn-messages-badge');
    if (bnBadge) {
      bnBadge.textContent = count > 9 ? '9+' : String(count);
      bnBadge.style.display = count > 0 ? 'flex' : 'none';
    }
  }
  window.refreshMessagesBadge = refreshMessagesBadge;

  function showMessagesPanel() {
    const u = window.SL.currentUser ? window.SL.currentUser() : null;
    const existing = document.getElementById('slMessagesPanel');
    if (existing) existing.remove();
    const list = u && window.SL.getMessagesForUser ? window.SL.getMessagesForUser(u.id) : [];
    const rowsHTML = list.length ? list.map(m => `
      <div style="background:#fff;border-radius:12px;padding:14px;margin-bottom:10px;box-shadow:0 1px 4px rgba(0,0,0,.06);${m.read ? '' : 'border-left:3px solid #1A8A52;'}">
        <div style="font-size:11px;font-weight:700;color:#1A8A52;margin-bottom:4px;">${m.senderName || 'SupplyLink Team'}</div>
        <div style="font-size:13px;line-height:1.5;color:#222;">${m.message}</div>
        <div style="font-size:11px;color:#999;margin-top:6px;">${new Date(m.createdAt).toLocaleString('en-GH', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
      </div>`).join('') : `
      <div class="empty-state" style="padding:40px 20px;text-align:center;">
        <div class="emoji" style="font-size:40px;margin-bottom:10px;">✉️</div>
        <h3 style="font-size:15px;margin-bottom:6px;">No messages yet</h3>
        <p style="font-size:13px;color:#777;">Messages from the SupplyLink team will show up here.</p>
      </div>`;

    const panel = document.createElement('div');
    panel.id = 'slMessagesPanel';
    panel.style.cssText = 'position:fixed;inset:0;z-index:3010;background:#f5f7f5;overflow-y:auto;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
    panel.innerHTML = `
      <div style="background:#1a472a;color:#fff;padding:16px 20px;display:flex;align-items:center;gap:12px;position:sticky;top:0;">
        <button style="background:rgba(255,255,255,.15);border:none;color:#fff;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:14px;" onclick="window.closeMessagesPanel()">← Back</button>
        <div style="font-size:18px;font-weight:700;">Messages</div>
      </div>
      <div style="padding:20px;max-width:520px;margin:0 auto;">${rowsHTML}</div>`;
    document.body.appendChild(panel);
    window.slPushOverlay(closeMessagesPanel);
    if (u && window.SL.markMessagesRead) {
      window.SL.markMessagesRead(u.id);
      refreshMessagesBadge();
    }
  }
  window.showMessagesPanel = showMessagesPanel;

  /* ── LIKED ITEMS — dedicated page (v11.103) ──
     Previously "Liked" just opened the Profile screen and scrolled to a
     card inside it. Given its own full page here, matching the Messages
     panel's structure, so it behaves consistently and doesn't require
     detouring through Profile. Lives in this scope (not the profile
     block's separate IIFE) since it needs openModal() to let a buyer tap
     straight through to the product. */
  function closeLikedItemsPanel() {
    const el = document.getElementById('slLikedItemsPanel');
    if (el) el.remove();
    window.slPopOverlay();
  }
  window.closeLikedItemsPanel = closeLikedItemsPanel;

  function renderLikedItemsPanelBody() {
    const u = window.SL.currentUser ? window.SL.currentUser() : null;
    const likedIds = u && window.SL.getLikedItems ? window.SL.getLikedItems(u.id) : [];
    const allProducts = PRODUCTS.length ? PRODUCTS : (window.SL.getProducts() || []);
    const liked = likedIds
      .map(id => allProducts.find(p => p.id === id))
      .filter(Boolean);

    if (!liked.length) {
      return `
        <div class="empty-state" style="padding:40px 20px;text-align:center;">
          <div class="emoji" style="font-size:40px;margin-bottom:10px;">🤍</div>
          <h3 style="font-size:15px;margin-bottom:6px;">No liked items yet</h3>
          <p style="font-size:13px;color:#777;">Tap the heart on any product to save it here.</p>
        </div>`;
    }

    return liked.map(p => `
      <div style="display:flex;align-items:center;gap:12px;background:#fff;border-radius:12px;padding:12px;margin-bottom:10px;box-shadow:0 1px 4px rgba(0,0,0,.06);">
        <div onclick="window.closeLikedItemsPanel();window.openModal('${p.id}')" style="width:52px;height:52px;border-radius:9px;background:#eef6ee;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;overflow:hidden;cursor:pointer;">
          ${(p.images && p.images.length) ? `<img src="${p.images[0]}" style="width:100%;height:100%;object-fit:cover;">` : (p.emoji || '🛒')}
        </div>
        <div style="flex:1;min-width:0;cursor:pointer;" onclick="window.closeLikedItemsPanel();window.openModal('${p.id}')">
          <div style="font-weight:700;font-size:13.5px;color:#1A4731;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.name}</div>
          <div style="font-size:12.5px;color:#888;margin-top:1px;">GH₵ ${(p.markedUpPrice != null ? p.markedUpPrice : (p.buyerPrice || 0)).toFixed(2)}</div>
        </div>
        <button onclick="window.toggleLike(event,'${p.id}');window.refreshLikedItemsPanel();" style="background:none;border:none;cursor:pointer;flex-shrink:0;display:flex;align-items:center;">${heartIcon(true)}</button>
      </div>`).join('');
  }

  function refreshLikedItemsPanel() {
    const body = document.getElementById('slLikedItemsPanelBody');
    if (body) body.innerHTML = renderLikedItemsPanelBody();
  }
  window.refreshLikedItemsPanel = refreshLikedItemsPanel;

  function showLikedItemsPanel() {
    const existing = document.getElementById('slLikedItemsPanel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'slLikedItemsPanel';
    panel.style.cssText = 'position:fixed;inset:0;z-index:3010;background:#f5f7f5;overflow-y:auto;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
    panel.innerHTML = `
      <div style="background:#1a472a;color:#fff;padding:16px 20px;display:flex;align-items:center;gap:12px;position:sticky;top:0;">
        <button style="background:rgba(255,255,255,.15);border:none;color:#fff;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:14px;" onclick="window.closeLikedItemsPanel()">← Back</button>
        <div style="font-size:18px;font-weight:700;">Liked Items</div>
      </div>
      <div style="padding:20px;max-width:520px;margin:0 auto;" id="slLikedItemsPanelBody">${renderLikedItemsPanelBody()}</div>`;
    document.body.appendChild(panel);
    window.slPushOverlay(closeLikedItemsPanel);
  }
  window.showLikedItemsPanel = showLikedItemsPanel;

  /* ── MY ORDERS (order history + reviews) ── */
  function closeMyOrdersPanel() {
    const el = document.getElementById('slMyOrdersPanel');
    if (el) el.remove();
    window.slPopOverlay();
  }
  window.closeMyOrdersPanel = closeMyOrdersPanel;

  function showMyOrdersPanel() {
    const u = window.SL.currentUser ? window.SL.currentUser() : null;
    const alreadyOpen = !!document.getElementById('slMyOrdersPanel');
    const existing = document.getElementById('slMyOrdersPanel');
    if (existing) existing.remove();
    const allOrders = window.SL.getOrders ? window.SL.getOrders() : [];
    const myOrders = u ? allOrders.filter(o => o.buyerId === u.id) : allOrders;

    const STATUS_LABEL = { pending:'Order Placed', confirmed:'Confirmed', preparing:'Being Prepared', out:'Out for Delivery', delivered:'Delivered', cancelled:'Cancelled' };
    const STATUS_COLOR = { pending:'#999', confirmed:'#2f7d3d', preparing:'#F59E0B', out:'#1a72c4', delivered:'#1a472a', cancelled:'#c0392b' };

    const rowsHTML = myOrders.length ? myOrders.map(o => {
      const label = STATUS_LABEL[o.status] || o.status;
      const color = STATUS_COLOR[o.status] || '#999';
      let reviewBtn = '';
      const oSupplierGroups = window.SL.getOrderSupplierGroups(o);
      if (o.status === 'delivered' && oSupplierGroups.length) {
        const unreviewed = oSupplierGroups.filter(sb => !window.SL.hasReviewed(o.id, sb.supplierId));
        if (unreviewed.length) {
          reviewBtn = unreviewed.map(sb => `
            <button style="margin-top:8px;margin-right:6px;background:#F59E0B;color:#fff;border:none;padding:7px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;"
              onclick="event.stopPropagation(); openRatingModal('${o.id}','${sb.supplierId}','${(sb.supplierName||'Supplier').replace(/'/g,"")}')">
              ⭐ Rate ${sb.supplierName || 'Supplier'}
            </button>`).join('');
        }
      }

      /* Refund / issue status */
      let refundHTML = '';
      const refund = window.SL.getRefundForOrder(o.id);
      if (refund) {
        const rColor = refund.status === 'approved' ? '#1a472a' : refund.status === 'rejected' ? '#c0392b' : '#F59E0B';
        const rLabel = refund.status === 'approved'
          ? `✓ Refund approved · GH₵ ${(refund.amountRequested || 0).toFixed(2)} ${refund.method === 'wallet' ? 'credited to wallet' : 'refunded via MoMo'}`
          : refund.status === 'rejected'
            ? '✕ Refund request declined' + (refund.adminNote ? ' — ' + refund.adminNote : '')
            : '⏳ Refund request pending review';
        refundHTML = `<div style="margin-top:8px;font-size:12px;font-weight:600;color:${rColor};">${rLabel}</div>`;
      } else if (o.status !== 'cancelled') {
        refundHTML = `<button style="margin-top:8px;background:#f1f3f5;color:#333;border:none;padding:7px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;"
          onclick="event.stopPropagation(); openRefundModal('${o.id}')">⚠️ Report an Issue / Refund</button>`;
      }

      const reorderBtn = (o.items && o.items.length)
        ? `<button style="margin-top:8px;margin-right:6px;background:#1a472a;color:#fff;border:none;padding:7px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;"
            onclick="event.stopPropagation(); reorderOrder('${o.id}')">🔁 Reorder</button>`
        : '';

      return `
        <div style="background:#fff;border-radius:12px;padding:14px;margin-bottom:10px;box-shadow:0 1px 4px rgba(0,0,0,.06);cursor:pointer;" onclick="window.showTrackingPanel(window.SL.getOrders().find(x=>x.id==='${o.id}'))">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong style="font-size:14px;">${o.id}</strong>
            <span style="font-size:12px;font-weight:700;color:${color};">${label}</span>
          </div>
          <div style="font-size:12px;color:#777;margin-top:4px;">${new Date(o.createdAt || Date.now()).toLocaleDateString('en-GH',{day:'numeric',month:'short',year:'numeric'})} · GH₵ ${(o.total||0).toFixed(2)}</div>
          <div>${reviewBtn}${reorderBtn}</div>
          ${refundHTML}
        </div>`;
    }).join('') : `
      <div class="empty-state" style="padding:40px 20px;text-align:center;">
        <div class="emoji" style="font-size:40px;margin-bottom:10px;">📦</div>
        <h3 style="font-size:15px;margin-bottom:6px;">No orders yet</h3>
        <p style="font-size:13px;color:#777;">Your order history will show up here once you place an order.</p>
      </div>`;

    const panel = document.createElement('div');
    panel.id = 'slMyOrdersPanel';
    panel.style.cssText = 'position:fixed;inset:0;z-index:2000;background:#f5f7f5;overflow-y:auto;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
    panel.innerHTML = `
      <div style="background:#1a472a;color:#fff;padding:16px 20px;display:flex;align-items:center;gap:12px;position:sticky;top:0;">
        <button style="background:rgba(255,255,255,.15);border:none;color:#fff;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:14px;" onclick="window.closeMyOrdersPanel()">← Back</button>
        <div style="font-size:18px;font-weight:700;">My Orders</div>
      </div>
      <div style="padding:20px;max-width:520px;margin:0 auto;">${rowsHTML}</div>`;
    document.body.appendChild(panel);
    if (!alreadyOpen) window.slPushOverlay(closeMyOrdersPanel);
  }

  /* ── REORDER ── One-tap re-add of a past order's items to the current
     cart. Skips any item whose product no longer exists (deleted/
     discontinued since) rather than failing the whole reorder. */
  function reorderOrder(orderId) {
    const order = (window.SL.getOrders() || []).find(o => o.id === orderId);
    if (!order || !order.items || !order.items.length) return;
    let added = 0, skipped = 0;
    order.items.forEach(it => {
      const stillExists = PRODUCTS.find(p => p.id === it.productId);
      if (stillExists) {
        cart[it.productId] = (cart[it.productId] || 0) + (it.qty || 1);
        added++;
      } else {
        skipped++;
      }
    });
    persistCart();
    updateCartBadge();
    if (typeof closeMyOrdersPanel === 'function') closeMyOrdersPanel();
    showToast(skipped
      ? `${added} item(s) added to cart — ${skipped} no longer available`
      : `${added} item(s) added to cart from your past order`);
  }
  window.reorderOrder = reorderOrder;

  /* ── REFUND / REPORT AN ISSUE MODAL ── */
  const REFUND_REASONS = {
    not_fulfilled:          'Item(s) not fulfilled / out of stock',
    wrong_item:             'Wrong item or quantity delivered',
    damaged:                'Damaged or spoiled on arrival',
    late_delivery:          'Delivery was very late',
    cancel_before_dispatch: 'Cancel / I ordered the wrong item or size',
    other:                  'Other issue'
  };
  const ITEM_LEVEL_REASONS = ['wrong_item', 'damaged'];
  let refundModalPhoto = null;

  /* Rough eligibility hint shown to the buyer — admin still makes the final call. */
  function getRefundEligibilityHint(order, reason) {
    const now = Date.now();
    if (reason === 'late_delivery') {
      const isExpress = (order.supplierBreakdown || []).length > 0 &&
        order.supplierBreakdown.every(sb => sb.speed === 'express');
      const promisedHrs = isExpress ? 3 : 8;
      const bufferHrs = isExpress ? 1 : 3;
      const deadlineHrs = promisedHrs + bufferHrs;
      const elapsedHrs = (now - (order.createdAt || now)) / 3600000;
      if (order.status === 'delivered') return null; // already arrived, use damaged/wrong-item instead
      return elapsedHrs >= deadlineHrs
        ? `✓ This order is past the ${deadlineHrs}-hour window for ${isExpress ? 'Express' : 'Normal'} delivery — eligible for a delay refund.`
        : `Not yet past the ${deadlineHrs}-hour window for ${isExpress ? 'Express' : 'Normal'} delivery (${elapsedHrs.toFixed(1)}h elapsed). You can still submit — Admin will review.`;
    }
    if (reason === 'damaged' || reason === 'wrong_item') {
      const deliveredAt = order.deliveredAt || order.createdAt;
      const elapsedHrs = (now - deliveredAt) / 3600000;
      return elapsedHrs <= 2
        ? `✓ Within the 2-hour reporting window (${elapsedHrs.toFixed(1)}h since delivery).`
        : `⚠️ Past the usual 2-hour reporting window (${elapsedHrs.toFixed(1)}h since delivery) — you can still submit, but approval isn't guaranteed.`;
    }
    if (reason === 'cancel_before_dispatch') {
      const base = `Also use this if you meant to order something different (e.g. the wrong size or variant) — not just a change of mind.`;
      if (order.status === 'pending' || order.status === 'confirmed') {
        return `✓ Not yet prepared — this qualifies for a full, free cancellation. ${base}`;
      }
      if (order.status === 'preparing') {
        return `The supplier has already started preparing this — cancellation is still possible but reviewed case-by-case. ${base}`;
      }
      if (order.status === 'out' || order.status === 'delivered') {
        return `⚠️ This order is already ${order.status === 'delivered' ? 'delivered' : 'out for delivery'} — a free cancellation isn't available at this stage. ${base}`;
      }
      return base;
    }
    return null;
  }

  function closeRefundModal() {
    const modal = document.getElementById('slRefundModal');
    if (modal) modal.remove();
    window.slPopOverlay();
  }
  window.closeRefundModal = closeRefundModal;

  function openRefundModal(orderId) {
    const order = (window.SL.getOrders() || []).find(o => o.id === orderId);
    if (!order) return;
    const existing = document.getElementById('slRefundModal');
    if (existing) existing.remove();
    refundModalPhoto = null;

    const itemsHTML = (order.items || []).map((it, i) => `
      <label style="display:flex;align-items:center;gap:8px;padding:8px 0;font-size:13px;border-bottom:1px solid #f0f0f0;">
        <input type="checkbox" class="slRefundItemCb" value="${i}">
        ${it.productName} — ${it.qty} × GH₵${(it.buyerPrice||0).toFixed(2)}
      </label>`).join('');

    const modal = document.createElement('div');
    modal.id = 'slRefundModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:2100;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:24px;max-width:420px;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-height:90vh;overflow-y:auto;">
        <div style="font-size:16px;font-weight:700;margin-bottom:4px;">Report an Issue — ${order.id}</div>
        <div style="font-size:13px;color:#777;margin-bottom:16px;">We'll review this and get back to you. See our <a href="#" onclick="window.openPolicyPanel();return false;" style="color:#1A4731;font-weight:700;">Refund Policy</a> for what's eligible, or email <a href="mailto:refund@supplylinkgh.com" style="color:#1A4731;font-weight:700;">refund@supplylinkgh.com</a> directly.</div>

        <label style="font-size:12px;font-weight:700;color:#333;">What's the issue?</label>
        <select id="slRefundReason" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:10px;font-size:13px;margin:6px 0 12px;box-sizing:border-box;" onchange="window.__refundReasonChanged('${orderId}')">
          ${Object.entries(REFUND_REASONS).map(([k,v]) => `<option value="${k}">${v}</option>`).join('')}
        </select>
        <div id="slRefundEligibilityHint" style="font-size:12px;color:#555;margin-bottom:12px;"></div>

        <div id="slRefundItemsBox" style="display:none;margin-bottom:12px;">
          <label style="font-size:12px;font-weight:700;color:#333;">Which item(s)?</label>
          <div style="margin-top:6px;">${itemsHTML}</div>
        </div>

        <label style="font-size:12px;font-weight:700;color:#333;">Details</label>
        <textarea id="slRefundNote" placeholder="Tell us what happened..." style="width:100%;min-height:70px;border:1px solid #ddd;border-radius:10px;padding:10px;font-size:13px;font-family:inherit;box-sizing:border-box;margin:6px 0 12px;"></textarea>

        <label style="font-size:12px;font-weight:700;color:#333;">Photo (optional, helps us review faster)</label>
        <input type="file" id="slRefundPhotoInput" accept="image/*" style="display:block;margin:6px 0 12px;font-size:12px;" onchange="window.__refundPhotoChanged(this.files)">
        <div id="slRefundPhotoPreview"></div>

        <div style="display:flex;gap:10px;margin-top:6px;">
          <button style="flex:1;background:#f0f0f0;border:none;padding:12px;border-radius:10px;font-weight:700;cursor:pointer;" onclick="window.closeRefundModal()">Cancel</button>
          <button style="flex:1;background:#1a472a;color:#fff;border:none;padding:12px;border-radius:10px;font-weight:700;cursor:pointer;" onclick="submitRefundRequest('${orderId}')">Submit</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    window.slPushOverlay(closeRefundModal);
    window.__refundReasonChanged(orderId);
  }

  window.__refundReasonChanged = function(orderId) {
    const order = (window.SL.getOrders() || []).find(o => o.id === orderId);
    const reasonEl = document.getElementById('slRefundReason');
    if (!order || !reasonEl) return;
    const reason = reasonEl.value;
    document.getElementById('slRefundItemsBox').style.display = ITEM_LEVEL_REASONS.includes(reason) ? 'block' : 'none';
    const hint = getRefundEligibilityHint(order, reason);
    const hintEl = document.getElementById('slRefundEligibilityHint');
    hintEl.textContent = hint || '';
    hintEl.style.display = hint ? 'block' : 'none';
  };

  window.__refundPhotoChanged = async function(fileList) {
    const file = (fileList || [])[0];
    if (!file) return;
    try {
      refundModalPhoto = await window.SL.uploadImage(file, { maxWidth: 900, quality: 0.65 }, 'refund-photos');
      document.getElementById('slRefundPhotoPreview').innerHTML =
        `<img src="${refundModalPhoto}" style="max-width:100%;border-radius:8px;margin-top:6px;">`;
    } catch (uploadErr) {
      // Cloud upload failed (e.g. offline) — fall back to local-only base64,
      // same graceful-degradation contract as product photo uploads.
      try {
        refundModalPhoto = await window.SL.compressImage(file, { maxWidth: 900, quality: 0.65 });
        document.getElementById('slRefundPhotoPreview').innerHTML =
          `<img src="${refundModalPhoto}" style="max-width:100%;border-radius:8px;margin-top:6px;">`;
      } catch (e) {
        showToast && showToast('Could not process that photo — try another.');
      }
    }
  };

  function submitRefundRequest(orderId) {
    const order = (window.SL.getOrders() || []).find(o => o.id === orderId);
    const u = window.SL.currentUser ? window.SL.currentUser() : null;
    if (!order || !u) return;
    if (window.SL.getRefundForOrder(orderId)) {
      alert('A request has already been submitted for this order.');
      return;
    }

    const reason = document.getElementById('slRefundReason').value;
    const note = (document.getElementById('slRefundNote').value || '').trim();
    const wantsItemLevel = ITEM_LEVEL_REASONS.includes(reason);

    let selectedItems = order.items || [];
    if (wantsItemLevel) {
      const checked = Array.from(document.querySelectorAll('.slRefundItemCb:checked')).map(cb => parseInt(cb.value, 10));
      if (checked.length === 0) {
        alert('Please select at least one affected item.');
        return;
      }
      selectedItems = checked.map(i => order.items[i]);
    }

    const amountRequested = wantsItemLevel
      ? selectedItems.reduce((s, it) => s + (it.buyerPrice || 0) * (it.qty || 0), 0)
      : (order.total || 0);

    const supplierAmounts = {};
    selectedItems.forEach(it => {
      if (!it.supplierId) return;
      supplierAmounts[it.supplierId] = (supplierAmounts[it.supplierId] || 0) + (it.supplierPrice || 0) * (it.qty || 0);
    });

    window.SL.addRefundRequest({
      orderId,
      buyerId: u.id,
      buyerName: u.name,
      reason,
      reasonLabel: REFUND_REASONS[reason],
      note,
      photo: refundModalPhoto,
      wholeOrder: !wantsItemLevel,
      items: selectedItems.map(it => ({ productName: it.productName, supplierId: it.supplierId, qty: it.qty })),
      amountRequested,
      supplierAmounts
    });

    const ordersPanelWasOpen = !!document.getElementById('slMyOrdersPanel');
    if (ordersPanelWasOpen) showMyOrdersPanel(); // refreshes in place — panel was already open, so no new overlay is pushed
    closeRefundModal();
    showToast && showToast('Your request has been submitted — we\'ll review it shortly.', 'success');
  }

  /* ── RATE SUPPLIER MODAL ── */
  let ratingState = { orderId: null, supplierId: null, supplierName: null, value: 0 };

  function closeRatingModal() {
    const modal = document.getElementById('slRatingModal');
    if (modal) modal.remove();
    window.slPopOverlay();
  }
  window.closeRatingModal = closeRatingModal;

  function openRatingModal(orderId, supplierId, supplierName) {
    ratingState = { orderId, supplierId, supplierName, value: 0 };
    const existing = document.getElementById('slRatingModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'slRatingModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:2100;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:24px;max-width:360px;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
        <div style="font-size:16px;font-weight:700;margin-bottom:4px;">Rate ${supplierName || 'Supplier'}</div>
        <div style="font-size:13px;color:#777;margin-bottom:16px;">How was your experience with this order?</div>
        <div id="slStarRow" style="font-size:32px;text-align:center;margin-bottom:16px;">
          ${[1,2,3,4,5].map(n => `<span class="sl-star" data-val="${n}" style="cursor:pointer;padding:0 3px;">☆</span>`).join('')}
        </div>
        <textarea id="slRatingComment" placeholder="Add a comment (optional)" style="width:100%;min-height:70px;border:1px solid #ddd;border-radius:10px;padding:10px;font-size:13px;font-family:inherit;box-sizing:border-box;margin-bottom:16px;"></textarea>
        <div style="display:flex;gap:10px;">
          <button style="flex:1;background:#f0f0f0;border:none;padding:12px;border-radius:10px;font-weight:700;cursor:pointer;" onclick="window.closeRatingModal()">Cancel</button>
          <button style="flex:1;background:#1a472a;color:#fff;border:none;padding:12px;border-radius:10px;font-weight:700;cursor:pointer;" onclick="submitRating()">Submit</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    window.slPushOverlay(closeRatingModal);

    /* Each star is its own clickable element — no pixel-position math,
       so there's no risk of letter-spacing/rendering throwing off which
       star a tap lands on. This is what was silently capping ratings at
       4 stars before: the old version measured click position across a
       single "☆☆☆☆☆" text blob, and letter-spacing between characters
       meant the 5th star's real clickable area didn't line up with
       where the math expected it. */
    const starEls = Array.from(document.querySelectorAll('#slStarRow .sl-star'));
    function paintStars(value) {
      starEls.forEach(el => {
        const n = parseInt(el.dataset.val, 10);
        el.textContent = n <= value ? '★' : '☆';
        el.style.color = n <= value ? '#F59E0B' : '';
      });
    }
    starEls.forEach(el => {
      el.addEventListener('click', function() {
        const value = parseInt(el.dataset.val, 10);
        ratingState.value = value;
        paintStars(value);
      });
    });
  }

  function submitRating() {
    if (!ratingState.value) { showToast('Please select a star rating'); return; }
    const comment = (document.getElementById('slRatingComment') || {}).value || '';
    window.SL.addReview({
      orderId: ratingState.orderId,
      supplierId: ratingState.supplierId,
      buyerId: window.SL.currentUser() ? window.SL.currentUser().id : null,
      rating: ratingState.value,
      comment: comment.trim()
    });
    refreshOrdersBadge();
    // Refresh any panels underneath in place BEFORE closing (they were already
    // open, so this must not push a new overlay/history entry) — then close
    // the rating modal itself, which pops exactly one level.
    if (document.getElementById('slMyOrdersPanel')) showMyOrdersPanel();
    if (document.getElementById('slTrackingPanel')) window.showTrackingPanel(window.SL.getOrders().find(x => x.id === ratingState.orderId));
    closeRatingModal();
    showToast('Thank you for your review! ⭐');
  }

  /* ── DELIVERY LOCATION BANNER ──
   * Buyers set their delivery address once (persisted in localStorage via
   * Block 4's resolveBuyerLocation), so every product can show a real,
   * distance-based delivery price right on the catalogue/modal — not just at checkout.
   */
  function renderLocationBanner() {
    const banner = document.getElementById("locationBanner");
    if (!banner) return;
    const loc = window.getBuyerLocation ? window.getBuyerLocation() : null;
    const textEl = document.getElementById("locationBannerText");
    if (loc && loc.zoneId) {
      banner.style.display = "flex";
      textEl.textContent = `📍 Delivering to: ${loc.address || 'your saved location'} — tap to change`;
    } else {
      banner.style.display = "flex";
      textEl.textContent = "📍 Set your delivery location to see accurate prices below";
    }
  }

  async function promptSetLocation() {
    const current = (window.getBuyerLocation && window.getBuyerLocation()) || {};
    const address = window.prompt("Enter your delivery address or landmark (e.g. Ahodwo, near Methodist Church):", current.address || "");
    if (!address || !address.trim()) return;
    showToast("📍 Calculating your delivery distance…");
    const result = await window.resolveBuyerLocation(address.trim());
    if (result.ok) {
      showToast("✓ Delivery location set");
    } else if (result.reason === "out_of_range") {
      showToast(`That's about ${Math.round(result.distanceKm)} km away — outside our normal delivery radius. We'll confirm pricing at checkout.`);
    } else {
      showToast("Couldn't pin that address automatically — you can still set your distance range at checkout.");
    }
    renderLocationBanner();
    if (modalProduct) openModal(modalProduct.id); // refresh open modal's pricing
  }

  /* ── CATEGORIES ── */
  function renderCategories() {
    const strip = document.getElementById("categoryStrip");
    strip.innerHTML = CATEGORIES.map(cat => `
      <button class="cat-pill ${cat === activeCategory ? 'active' : ''}" onclick="selectCategory('${cat}')">${cat}</button>
    `).join("");
  }

  function selectCategory(cat) {
    activeCategory = cat;
    renderCategories();
    renderProducts();
  }

  /* ── TIER FILTER + SORT ── */
  let tierFilter = "all";
  let sortMode = "default";

  function renderFilterBar() {
    const bar = document.getElementById("filterBar");
    if (!bar) return;
    bar.innerHTML = `
      <button onclick="setTierFilter('all')" style="flex-shrink:0;border:1px solid ${tierFilter==='all'?'#1a472a':'#ddd'};background:${tierFilter==='all'?'#1a472a':'#fff'};color:${tierFilter==='all'?'#fff':'#333'};padding:5px 10px;border-radius:20px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">All</button>
      <button onclick="setTierFilter('farm')" style="flex-shrink:0;border:1px solid ${tierFilter==='farm'?'#1a472a':'#ddd'};background:${tierFilter==='farm'?'#1a472a':'#fff'};color:${tierFilter==='farm'?'#fff':'#333'};padding:5px 10px;border-radius:20px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">🌾 Farm Fresh</button>
      <button onclick="setTierFilter('wholesale')" style="flex-shrink:0;border:1px solid ${tierFilter==='wholesale'?'#1a472a':'#ddd'};background:${tierFilter==='wholesale'?'#1a472a':'#fff'};color:${tierFilter==='wholesale'?'#fff':'#333'};padding:5px 10px;border-radius:20px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">🏭 Warehouse</button>
      <select onchange="setSortMode(this.value)" style="flex-shrink:0;margin-left:auto;border:1px solid #ddd;border-radius:20px;padding:5px 8px;font-size:11px;background:#fff;color:#333;max-width:110px;">
        <option value="default" ${sortMode==='default'?'selected':''}>Sort: Featured</option>
        <option value="price_asc" ${sortMode==='price_asc'?'selected':''}>Price ↑</option>
        <option value="price_desc" ${sortMode==='price_desc'?'selected':''}>Price ↓</option>
        <option value="name_asc" ${sortMode==='name_asc'?'selected':''}>Name A–Z</option>
        <option value="newest" ${sortMode==='newest'?'selected':''}>Newest</option>
      </select>`;
  }

  function setTierFilter(t) { tierFilter = t; renderFilterBar(); renderProducts(); }
  function setSortMode(m) { sortMode = m; renderProducts(); }

  /* ── PRODUCTS ── */
  /* ── Price comparison groups (v11.94) ──
     Groups all currently-listed products by normalized name, so the
     catalogue/search can flag "3 sellers, from GH₵12.50" whenever more
     than one supplier lists the same item (e.g. "Royal Umbrella Rice
     5kg" from three different warehouses). Recomputed from the full
     PRODUCTS list (not just the filtered view) so a buyer searching one
     tier still sees that cheaper matches exist elsewhere. */
  function normalizeProductName(name) {
    return (name || '').trim().toLowerCase();
  }
  function getProductGroups() {
    const groups = {};
    PRODUCTS.forEach(p => {
      const key = normalizeProductName(p.name);
      (groups[key] = groups[key] || []).push(p);
    });
    return groups;
  }
  function getComparableGroup(product) {
    const groups = getProductGroups();
    const list = groups[normalizeProductName(product.name)] || [];
    return list.length > 1 ? list.slice().sort((a, b) => a.markedUpPrice - b.markedUpPrice) : null;
  }

  /* ── Merchandising signals (v11.97) ──
     Real data only — no fabricated "3 people bought this" urgency.
     Bestseller: aggregated straight from actual order history, and only
     awarded to a product once it has genuinely sold a meaningful amount
     (avoids labeling everything "bestseller" in a fresh/low-volume store). */
  function computeBestsellerIds() {
    try {
      const orders = (window.SL.getOrders && window.SL.getOrders()) || [];
      const totals = {};
      orders.forEach(o => {
        (o.items || []).forEach(it => {
          totals[it.productId] = (totals[it.productId] || 0) + (it.qty || 0);
        });
      });
      const ranked = Object.keys(totals)
        .map(id => ({ id, qty: totals[id] }))
        .filter(r => r.qty >= 3)
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 3);
      return new Set(ranked.map(r => r.id));
    } catch (e) {
      return new Set();
    }
  }
  function getMerchBadge(p, bestsellerIds) {
    if (bestsellerIds.has(p.id)) {
      return { label: 'Bestseller', bg: '#FEF3C7', color: '#92400E' };
    }
    if (typeof p.stock === 'number' && p.stock > 0 && p.stock <= 10) {
      return { label: 'Low Stock', bg: '#FEE2E2', color: '#B91C1C' };
    }
    if (p.createdAt && (Date.now() - p.createdAt) < 3 * 86400000) {
      return { label: 'New', bg: '#DBEAFE', color: '#1D4ED8' };
    }
    return null;
  }

  /* ── Heart icon (v11.96) ──
     Was using 🤍/❤️ emoji for the unliked/liked states. The white heart
     emoji (🤍) isn't supported by every device's font — on some Android/
     Windows browsers it renders as a blank "missing glyph" box instead of
     a heart. Switching to an inline SVG so both states render identically
     on every device, with no font/emoji-support dependency. */
  function heartIcon(liked) {
    return liked
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="#E63946" stroke="#E63946" stroke-width="1.5"><path d="M12 21s-6.7-4.35-9.33-8.02C.86 10.7 1.1 7.6 3.34 5.66 5.24 4 8.02 4.4 9.6 6.2L12 8.9l2.4-2.7c1.58-1.8 4.36-2.2 6.26-.54 2.24 1.94 2.48 5.04.67 7.32C18.7 16.65 12 21 12 21z"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8A9A91" stroke-width="2"><path d="M12 21s-6.7-4.35-9.33-8.02C.86 10.7 1.1 7.6 3.34 5.66 5.24 4 8.02 4.4 9.6 6.2L12 8.9l2.4-2.7c1.58-1.8 4.36-2.2 6.26-.54 2.24 1.94 2.48 5.04.67 7.32C18.7 16.65 12 21 12 21z"/></svg>';
  }

  /* ── "Your Usual Order" row (v11.104) ──
     Surfaces a buyer's most-bought products directly on the catalogue,
     rather than making them dig through Order History to reorder. Real
     data only: aggregated from their own past orders, and only shown once
     they have enough history (2+ orders) for the pattern to mean anything
     — a single order isn't a "usual" yet. */
  function renderUsualOrderRow() {
    const section = document.getElementById('usualOrderSection');
    const row = document.getElementById('usualOrderRow');
    if (!section || !row) return;
    const u = window.SL && window.SL.currentUser ? window.SL.currentUser() : null;
    if (!u) { section.style.display = 'none'; return; }

    const myOrders = (window.SL.getOrders() || []).filter(o => o.buyerId === u.id);
    if (myOrders.length < 2) { section.style.display = 'none'; return; }

    const totals = {};
    myOrders.forEach(o => {
      (o.items || []).forEach(it => {
        totals[it.productId] = (totals[it.productId] || 0) + (it.qty || 0);
      });
    });
    const topIds = Object.keys(totals).sort((a, b) => totals[b] - totals[a]).slice(0, 6);
    const usualProducts = topIds.map(id => PRODUCTS.find(p => p.id === id)).filter(Boolean);

    if (!usualProducts.length) { section.style.display = 'none'; return; }
    section.style.display = 'block';
    row.innerHTML = usualProducts.map(p => `
      <div class="usual-card" onclick="openModal('${p.id}')">
        <div class="usual-card-img">
          ${(p.images && p.images.length) ? `<img src="${p.images[0]}" alt="${p.name}">` : p.emoji}
          <div class="usual-card-add" onclick="quickAdd(event,'${p.id}')">+</div>
        </div>
        <div class="usual-card-name">${p.name}</div>
      </div>`).join('');
  }
  window.renderUsualOrderRow = renderUsualOrderRow;

  function getFilteredProducts() {
    let list = PRODUCTS.filter(p => {
      const matchCat = activeCategory === "All" || p.category === activeCategory;
      const matchSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          p.category.toLowerCase().includes(searchQuery.toLowerCase());
      const matchTier = tierFilter === "all" || p.tier === tierFilter;
      return matchCat && matchSearch && matchTier;
    });
    if (sortMode === "price_asc")       list = list.slice().sort((a,b) => a.markedUpPrice - b.markedUpPrice);
    else if (sortMode === "price_desc") list = list.slice().sort((a,b) => b.markedUpPrice - a.markedUpPrice);
    else if (sortMode === "name_asc")   list = list.slice().sort((a,b) => a.name.localeCompare(b.name));
    else if (sortMode === "newest")     list = list.slice().sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
    return list;
  }

  function filterProducts() {
    searchQuery = document.getElementById("searchInput").value;
    renderProducts();
  }

  function renderProducts() {
    const filtered = getFilteredProducts();
    const grid = document.getElementById("productGrid");
    const title = document.getElementById("sectionTitle");
    const count = document.getElementById("resultsCount");

    title.textContent = activeCategory === "All" ? "All Products" : activeCategory;
    count.textContent = `${filtered.length} item${filtered.length !== 1 ? "s" : ""}`;

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <div class="emoji">🔍</div>
          <h3>Nothing found</h3>
          <p>Try a different search or category.</p>
        </div>`;
      return;
    }

    const bestsellerIds = computeBestsellerIds();
    grid.innerHTML = filtered.map(p => {
      const inCart = cart[p.id] > 0;
      const u = window.SL && window.SL.currentUser ? window.SL.currentUser() : null;
      const liked = u ? window.SL.isLikedByUser(u.id, p.id) : false;
      const group = getComparableGroup(p);
      const compareBadge = group
        ? `<div class="compare-badge" onclick="event.stopPropagation();openCompareModal('${p.id}')">🔍 ${group.length} sellers · from GH₵${group[0].markedUpPrice.toFixed(2)}</div>`
        : '';
      const merch = getMerchBadge(p, bestsellerIds);
      const merchBadgeHtml = merch
        ? `<div class="merch-badge" style="background:${merch.bg};color:${merch.color};">${merch.label}</div>`
        : '';
      return `
        <div class="product-card" onclick="openModal('${p.id}')">
          <div class="product-img${(p.images && p.images.length) ? ' has-photo' : ''}">
            ${merchBadgeHtml}
            <button class="like-heart-btn" onclick="toggleLike(event,'${p.id}')" aria-label="Save item">${heartIcon(liked)}</button>
            ${(p.images && p.images.length) ? `<img src="${p.images[0]}" alt="${p.name}">` : p.emoji}
          </div>
          <div class="product-body">
            <div class="product-cat-tag">${p.category}</div>
            <div class="product-name">${p.name}</div>
            <div class="product-price-row">
              <div class="product-unit">${p.unit}</div>
              <div class="product-price">GH₵ ${p.markedUpPrice.toFixed(2)}</div>
            </div>
            ${cardTrustLine(p.supplierId)}
            ${compareBadge}
            <div class="add-btn">
              <button class="${inCart ? 'in-cart' : ''}" onclick="quickAdd(event, '${p.id}')">
                ${inCart ? `✓ In Cart (${cart[p.id]})` : '+ Add to Cart'}
              </button>
            </div>
          </div>
        </div>`;
    }).join("");
  }

  /* ── Like / save an item (v11.94) ── */
  function toggleLike(event, id) {
    if (event) event.stopPropagation();
    const u = window.SL && window.SL.currentUser ? window.SL.currentUser() : null;
    if (!u) {
      if (typeof window.slShowView === 'function') window.slShowView('auth');
      return;
    }
    window.SL.toggleLikedItem(u.id, id);
    renderProducts();
    if (typeof modalProduct !== 'undefined' && modalProduct && modalProduct.id === id && typeof updateModalLikeState === 'function') {
      updateModalLikeState();
    }
    if (typeof window.refreshLikedItemsPanel === 'function') {
      try { window.refreshLikedItemsPanel(); } catch (e) {}
    }
  }

  /* ── Price comparison modal (v11.94) ──
     Shows every supplier currently listing the same product name, sorted
     cheapest-first, so a buyer comparing e.g. "Royal Umbrella Rice 5kg"
     across warehouses doesn't have to eyeball-scan the whole grid. */
  function openCompareModal(productId) {
    const p = PRODUCTS.find(x => x.id === productId);
    if (!p) return;
    const group = getComparableGroup(p);
    if (!group) return;
    let panel = document.getElementById('compareModalOverlay');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'compareModalOverlay';
      panel.className = 'modal-overlay';
      panel.onclick = function(e) { if (e.target === panel) closeCompareModal(); };
      panel.innerHTML = `
        <div class="modal" style="max-width:480px;background:#fff;border-radius:16px;">
          <div class="modal-body" style="padding:20px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <div class="modal-name" id="compareModalTitle" style="margin:0;font-weight:800;font-size:16px;color:#111714;"></div>
              <button class="btn-close-modal" style="padding:6px 12px;background:#f2f2f2;border:none;border-radius:8px;cursor:pointer;" onclick="closeCompareModal()">✕</button>
            </div>
            <div style="font-size:12px;color:#7A8F84;margin-bottom:12px;">Same item, different sellers — sorted cheapest first.</div>
            <div id="compareModalList"></div>
          </div>
        </div>`;
      document.body.appendChild(panel);
    }
    document.getElementById('compareModalTitle').textContent = p.name;
    document.getElementById('compareModalList').innerHTML = group.map((item, i) => {
      const verified = window.SL.isSupplierVerified ? window.SL.isSupplierVerified(item.supplierId) : false;
      const rating = window.SL.getSupplierRating ? window.SL.getSupplierRating(item.supplierId) : { avg: 0, count: 0 };
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 0;${i > 0 ? 'border-top:1px solid #eee;' : ''}">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:13.5px;color:${i === 0 ? '#0A5C36' : '#111714'};">${item.supplierName || 'Supplier'}${i === 0 ? ' · Cheapest' : ''}</div>
            <div style="font-size:11.5px;color:#7A8F84;margin-top:2px;">
              ${verified ? '<span style="color:#1a472a;">✅ Verified</span> · ' : ''}${rating.count > 0 ? `★ ${rating.avg.toFixed(1)} (${rating.count})` : 'No reviews yet'} · ${item.tier === 'farm' ? '🌾 Farm' : '🏭 Warehouse'}
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-weight:800;font-family:'DM Mono',monospace;color:#0A5C36;">GH₵ ${item.markedUpPrice.toFixed(2)}</div>
            <button onclick="closeCompareModal();openModal('${item.id}');" style="margin-top:6px;background:#E6F4ED;color:#0A5C36;border:none;border-radius:8px;padding:6px 12px;font-size:11.5px;font-weight:700;cursor:pointer;">View</button>
          </div>
        </div>`;
    }).join('');
    panel.classList.add('open');
    if (typeof window.slPushOverlay === 'function') window.slPushOverlay(closeCompareModal);
  }
  function closeCompareModal() {
    const panel = document.getElementById('compareModalOverlay');
    if (panel) panel.classList.remove('open');
  }
  window.openCompareModal = openCompareModal;
  window.closeCompareModal = closeCompareModal;
  window.toggleLike = toggleLike;
  window.heartIcon = heartIcon;

  /* Compact one-line version for the product card (grid tiles are small) */
  function cardTrustLine(supplierId) {
    if (!supplierId || !window.SL) return "";
    const verified = window.SL.isSupplierVerified ? window.SL.isSupplierVerified(supplierId) : false;
    const rating = window.SL.getSupplierRating ? window.SL.getSupplierRating(supplierId) : { avg: 0, count: 0 };
    const parts = [];
    if (verified) parts.push('<span style="color:#1a472a;">✅ Verified</span>');
    if (rating.count > 0) parts.push(`<span style="color:#F59E0B;">★ ${rating.avg.toFixed(1)}</span>`);
    if (!parts.length) return "";
    return `<div style="font-size:11px;margin-top:2px;display:flex;gap:6px;">${parts.join(' · ')}</div>`;
  }

  /* ── SUPPLIER TRUST LINE (verification badge + star rating) ── */
  function renderSupplierTrustLine(supplierId, supplierName) {
    if (!supplierId || !window.SL) return "";
    const verified = window.SL.isSupplierVerified ? window.SL.isSupplierVerified(supplierId) : false;
    const rating = window.SL.getSupplierRating ? window.SL.getSupplierRating(supplierId) : { avg: 0, count: 0 };
    const badge = verified
      ? `<span style="color:#1a472a;font-weight:700;">✅ Verified Supplier</span>`
      : `<span style="color:#888;">New Supplier</span>`;
    const stars = rating.count > 0
      ? `<span style="color:#F59E0B;font-weight:700;">★ ${rating.avg.toFixed(1)}</span> <span style="color:#999;">(${rating.count})</span>`
      : `<span style="color:#999;">No reviews yet</span>`;
    return `<div style="font-size:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <span>Sold by <strong>${supplierName || 'Supplier'}</strong></span> · ${badge} · ${stars}
    </div>`;
  }

  /* ── PRODUCT REVIEWS (v11.90) ──
     Reviews with written comments were being collected via the star-rating
     modal (window.SL.addReview) but never shown anywhere in the app — a
     buyer's feedback just sat in the database. This surfaces the most
     recent comments for the product's supplier right in the product
     detail modal, since real written feedback is what actually builds
     buyer trust and drives referrals, not just an aggregate star number. */
  function reviewsEscapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }
  function reviewsTimeAgo(ts) {
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
  function renderProductReviews(supplierId) {
    if (!supplierId || !window.SL || !window.SL.getReviews) return '';
    const withComments = window.SL.getReviews()
      .filter(r => r.supplierId === supplierId && r.comment && r.comment.trim())
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!withComments.length) return '';

    const users = window.SL.getUsers ? window.SL.getUsers() : [];
    const shown = withComments.slice(0, 3);
    const items = shown.map(r => {
      const stars = '★'.repeat(r.rating || 0) + '☆'.repeat(5 - (r.rating || 0));
      const buyer = users.find(u => u.id === r.buyerId);
      const name = buyer ? buyer.name : 'Buyer';
      const when = reviewsTimeAgo(r.createdAt);
      return `<div style="padding:8px 0;border-top:1px solid var(--border,#eee);">
        <div style="font-size:12px;color:#F59E0B;letter-spacing:1px;">${stars}</div>
        <div style="font-size:13px;color:var(--ink,#222);margin:3px 0;line-height:1.4;">${reviewsEscapeHtml(r.comment.trim())}</div>
        <div style="font-size:11px;color:#999;">${reviewsEscapeHtml(name)}${when ? ' · ' + when : ''}</div>
      </div>`;
    }).join('');
    const remaining = withComments.length - shown.length;
    const more = remaining > 0
      ? `<div style="font-size:11px;color:#999;margin-top:4px;">+${remaining} more review${remaining > 1 ? 's' : ''}</div>`
      : '';
    return `<div style="margin-top:4px;">
      <div style="font-size:12px;font-weight:700;color:var(--ink,#222);margin-bottom:2px;">What buyers are saying</div>
      ${items}${more}
    </div>`;
  }

  /* ── QUICK ADD (from card without opening modal) ── */
  function quickAdd(e, id) {
    e.stopPropagation();
    const p = PRODUCTS.find(x => x.id === id);
    if (!p) return;
    cart[id] = (cart[id] || 0) + 1;
    persistCart();
    updateCartBadge();
    renderProducts();
    showToast(`${p.emoji} ${p.name} added to cart`);
  }

  /* ── MODAL ── */
  /* Shows the product's photo (or emoji fallback) in the modal, plus a
     clickable thumbnail strip when more than one photo was uploaded. */
  function setModalImage(index) {
    const p = modalProduct;
    if (!p) return;
    const imgEl = document.getElementById("modalImg");
    const strip = document.getElementById("modalPhotoStrip");
    const images = p.images || [];
    if (images.length) {
      imgEl.classList.add("has-photo");
      imgEl.innerHTML = `<img src="${images[index] || images[0]}" alt="${p.name}">`;
    } else {
      imgEl.classList.remove("has-photo");
      imgEl.innerHTML = "";
      imgEl.textContent = p.emoji;
    }
    if (images.length > 1) {
      strip.style.display = "flex";
      strip.innerHTML = images.map((src, i) =>
        `<img src="${src}" class="${i === index ? 'active' : ''}" onclick="setModalImage(${i})">`
      ).join("");
    } else {
      strip.style.display = "none";
      strip.innerHTML = "";
    }
  }

  /* Fix: same overriding .modal CSS rule (later <style> block, ~line 3462)
     that clipped the Edit Product modal also clips this buyer-facing
     product detail modal — overflow:hidden with no max-height hides the
     Add to Cart button below the fold on mobile. Force #productModal to
     be internally scrollable via an ID rule (wins the cascade regardless
     of source order). */
  (function() {
    const style = document.createElement('style');
    style.textContent = '#productModal { max-height: 90vh !important; overflow-y: auto !important; -webkit-overflow-scrolling: touch !important; }';
    document.head.appendChild(style);
  })();

  function openModal(id) {
    const p = PRODUCTS.find(x => x.id === id);
    if (!p) return;
    modalProduct = p;
    modalQtyVal = 1;

    setModalImage(0);
    document.getElementById("modalTag").textContent = p.category;
    document.getElementById("modalNameText").textContent = p.name;
    document.getElementById("modalUnit").textContent = p.unit;
    document.getElementById("modalDesc").textContent = p.description;
    document.getElementById("modalSupplierInfo").innerHTML = renderSupplierTrustLine(p.supplierId, p.supplierName);
    document.getElementById("modalReviews").innerHTML = renderProductReviews(p.supplierId);
    document.getElementById("modalPrice").innerHTML = `GH₵ ${p.markedUpPrice.toFixed(2)}`;
    document.getElementById("modalPriceNote").textContent = "";
    document.getElementById("modalQty").textContent = 1;
    document.getElementById("modalAddBtn").textContent = cart[p.id] ? `Add More to Cart` : "Add to Cart";

    updateModalLikeState();
    const group = getComparableGroup(p);
    const compareEl = document.getElementById("modalCompareLink");
    compareEl.innerHTML = group
      ? `<div class="compare-badge" onclick="openCompareModal('${p.id}')">🔍 ${group.length} sellers · from GH₵${group[0].markedUpPrice.toFixed(2)}</div>`
      : '';

    renderModalDelivery(p);

    document.getElementById("modalOverlay").classList.add("open");
    window.slPushOverlay(closeModal);
  }

  /* Refreshes the heart icon inside the product detail modal to match
     whether the current buyer has this product saved. */
  function updateModalLikeState() {
    const btn = document.getElementById("modalLikeBtn");
    if (!btn || !modalProduct) return;
    const u = window.SL && window.SL.currentUser ? window.SL.currentUser() : null;
    const liked = u ? window.SL.isLikedByUser(u.id, modalProduct.id) : false;
    btn.innerHTML = heartIcon(liked);
  }

  /* Tier-aware delivery info shown inside the product modal, before the buyer
   * even adds it to cart. Farm-sourced = fixed weekly batch window, flat fee.
   * Wholesale-sourced = live Express/Normal windows computed from right now,
   * with a real price once the buyer's delivery location is known. */
  function renderModalDelivery(p) {
    const el = document.getElementById("modalDeliverySection");
    if (!el || !window.getWholesaleDeliveryOptions) { if (el) el.innerHTML = ""; return; }

    if (p.tier === "farm") {
      const windowLabel = window.getFarmDeliveryWindowLabel();
      const loc = window.getBuyerLocation ? window.getBuyerLocation() : null;
      const zone = (loc && loc.zoneId && window.ZONES) ? window.ZONES.find(z => z.id === loc.zoneId) : null;
      const feeLine = zone
        ? `Delivery: <strong>from GH₵ ${zone.normal.toFixed(2)}</strong> for your distance (may add a small fee for heavier orders)`
        : `Delivery: priced by distance + order weight — <a href="#" onclick="promptSetLocation();return false;" style="color:var(--green-dark,#1f5c2a);font-weight:700;">set your location</a> for an exact price`;
      el.innerHTML = `
        <div style="background:var(--green-pale,#eef6ee);border:1px solid var(--green-light,#cde5cd);border-radius:10px;padding:10px 12px;font-size:12.5px;color:var(--green-dark,#1f5c2a);line-height:1.5;">
          🌾 <strong>Farm-sourced.</strong> If you order now, this arrives <strong>${windowLabel}</strong>.<br/>
          ${feeLine}
        </div>`;
      return;
    }

    const options = window.getWholesaleDeliveryOptions();
    const loc = window.getBuyerLocation ? window.getBuyerLocation() : null;
    const zone = (loc && loc.zoneId && window.ZONES) ? window.ZONES.find(z => z.id === loc.zoneId) : null;
    const currentSpeed = window.getSupplierSpeed ? window.getSupplierSpeed(p.supplierId) : null;

    el.innerHTML = `
      <div style="font-size:12px;color:var(--ink-3);margin-bottom:6px;">🏬 Warehouse-sourced — choose your delivery speed:</div>
      <div class="zone-grid" style="margin-bottom:2px;">
        ${options.map(o => {
          const price = zone ? zone[o.speed] : null;
          const fallback = (window.ZONES && window.ZONES[0]) ? window.ZONES[0][o.speed] : null;
          const priceLabel = price != null
            ? 'GH₵ ' + price.toFixed(2)
            : (fallback != null ? 'from GH₵ ' + fallback.toFixed(2) : '');
          return `
          <div class="zone-card ${currentSpeed === o.speed ? 'selected' : ''}" onclick="selectModalSpeed('${p.supplierId}','${o.speed}')">
            <div class="zone-name">${o.speed === 'express' ? '⚡ Express' : '🚚 Normal'}</div>
            <div class="zone-fee" style="font-size:11px;font-weight:600;">${o.windowLabel}</div>
            <div class="zone-fee">${priceLabel}</div>
          </div>`;
        }).join("")}
      </div>
      ${!zone ? `<div style="font-size:11px;color:var(--ink-3);margin-top:2px;">Set your delivery location for an exact price — <a href="#" onclick="promptSetLocation();return false;" style="color:var(--green-mid,#2f7d3d);font-weight:700;">tap here</a>.</div>` : ``}
    `;
  }

  function selectModalSpeed(supplierId, speed) {
    if (window.setSupplierSpeedGlobal) window.setSupplierSpeedGlobal(supplierId, speed);
    if (modalProduct) renderModalDelivery(modalProduct);
  }

  function closeModal() {
    document.getElementById("modalOverlay").classList.remove("open");
    modalProduct = null;
    window.slPopOverlay();
  }

  function handleOverlayClick(e) {
    if (e.target === document.getElementById("modalOverlay")) closeModal();
  }

  function changeModalQty(delta) {
    modalQtyVal = Math.max(1, modalQtyVal + delta);
    document.getElementById("modalQty").textContent = modalQtyVal;
  }

  function addFromModal() {
    if (!modalProduct) return;
    cart[modalProduct.id] = (cart[modalProduct.id] || 0) + modalQtyVal;
    persistCart();
    updateCartBadge();
    renderProducts();
    showToast(`${modalProduct.emoji} ${modalProduct.name} × ${modalQtyVal} added`);
    closeModal();
  }

  /* ── CART ── */
  function openCart() {
    document.getElementById("cartOverlay").classList.add("open");
    document.getElementById("cartDrawer").classList.add("open");
    window.slPushOverlay(closeCart);
    renderCart();
  }

  function closeCart() {
    document.getElementById("cartOverlay").classList.remove("open");
    document.getElementById("cartDrawer").classList.remove("open");
    window.slPopOverlay();
  }

  function updateCartBadge() {
    const total = Object.values(cart).reduce((a, b) => a + b, 0);
    const badge = document.getElementById("cartBadge");
    badge.textContent = total;
    badge.classList.toggle("visible", total > 0);
  }

  /* ── Bottom nav: Home / Liked shortcuts (v11.97) ──
     Home resets browsing back to the top of "All Products" — buyers
     often drill into a category or scroll deep into the grid, and
     there was previously no one-tap way back to the start. Liked opens
     the profile panel and scrolls straight to the Liked Items card,
     since that's the only place saved items currently live. */
  function bbnGoHome() {
    if (typeof closeModal === 'function') closeModal();
    if (typeof closeCart === 'function') closeCart();
    selectCategory('All');
    searchQuery = '';
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
    filterProducts();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  window.bbnGoHome = bbnGoHome;

  /* ── Bottom nav: hide on scroll down, reveal on scroll up (v11.98) ──
     Keeps the nav out of the way while a buyer is reading down through
     the catalogue, and brings it back the instant they start scrolling
     back up — the same pattern most shopping apps use. Small scroll
     deltas (jitter, momentum overshoot) are ignored via the threshold,
     and it never hides near the very top of the page. */
  (function() {
    let lastY = window.scrollY;
    let ticking = false;
    function onScroll() {
      const nav = document.getElementById('buyerBottomNav');
      if (!nav) { ticking = false; return; }
      const y = window.scrollY;
      const delta = y - lastY;
      if (y < 40) {
        nav.classList.remove('bbn-hidden');
      } else if (delta > 6) {
        nav.classList.add('bbn-hidden');
      } else if (delta < -6) {
        nav.classList.remove('bbn-hidden');
      }
      lastY = y;
      ticking = false;
    }
    window.addEventListener('scroll', function() {
      if (!ticking) {
        window.requestAnimationFrame(onScroll);
        ticking = true;
      }
    }, { passive: true });
  })();

  /* Checkout clearing the SAVED cart (localStorage) doesn't touch this
   * script's own in-memory `cart` object — they're separate copies in
   * separate scopes. Without this, the product page kept showing the
   * old cart/badge until the app fully reloaded (e.g. logging back in),
   * even though the order had actually gone through and storage was
   * correctly cleared. Called by checkout right after an order is placed. */
  window.resetCatalogueCartState = function() {
    cart = {};
    updateCartBadge();
    if (typeof renderProducts === 'function') renderProducts();
    if (typeof renderCart === 'function') renderCart();
  };

  function changeCartQty(id, delta) {
    const newQty = (cart[id] || 0) + delta;
    if (newQty <= 0) {
      delete cart[id];
    } else {
      cart[id] = newQty;
    }
    persistCart();
    updateCartBadge();
    renderProducts();
    renderCart();
  }

  function removeCartItem(id) {
    delete cart[id];
    updateCartBadge();
    renderProducts();
    renderCart();
  }

  function renderCart() {
    const itemsEl = document.getElementById("cartItems");
    const footerEl = document.getElementById("cartFooter");
    const cartIds = Object.keys(cart).filter(id => cart[id] > 0);

    if (cartIds.length === 0) {
      itemsEl.innerHTML = `
        <div class="cart-empty">
          <div class="emoji">🛒</div>
          <p>Your cart is empty.<br/>Add products to get started.</p>
        </div>`;
      footerEl.innerHTML = `
        <button class="checkout-btn" disabled>Proceed to Checkout</button>`;
      return;
    }

    let subtotal = 0;
    itemsEl.innerHTML = cartIds.map(id => {
      const p = PRODUCTS.find(x => x.id === id);
      const qty = cart[id];
      const lineTotal = p.markedUpPrice * qty;
      subtotal += lineTotal;
      return `
        <div class="cart-item">
          <div class="cart-item-emoji${(p.images && p.images.length) ? ' has-photo' : ''}">${(p.images && p.images.length) ? `<img src="${p.images[0]}" alt="${p.name}">` : p.emoji}</div>
          <div class="cart-item-info">
            <div class="cart-item-name">${p.name}</div>
            <div class="cart-item-unit">${p.unit}</div>
            <div class="cart-item-price">GH₵ ${lineTotal.toFixed(2)}</div>
          </div>
          <div class="cart-item-controls">
            <div class="mini-qty">
              <button class="mini-qty-btn" onclick="changeCartQty('${id}', -1)">−</button>
              <div class="mini-qty-val">${qty}</div>
              <button class="mini-qty-btn" onclick="changeCartQty('${id}', 1)">+</button>
            </div>
            <button class="remove-item-btn" onclick="removeCartItem('${id}')">Remove</button>
          </div>
        </div>`;
    }).join("");

    footerEl.innerHTML = `
      <div class="cart-summary">
        <div class="summary-row"><span>Subtotal (${cartIds.length} item${cartIds.length > 1 ? 's' : ''})</span><span>GH₵ ${subtotal.toFixed(2)}</span></div>
        <div class="summary-row"><span>Delivery fee</span><span style="color:var(--ink-3);font-style:italic;">Calculated at checkout</span></div>
        <div class="summary-row" style="font-size:11px;color:var(--ink-3);"><span>Based on your distance, delivery speed, and number of suppliers in your order</span></div>
      </div>
      <button class="checkout-btn" onclick="proceedToCheckout()">Proceed to Checkout →</button>`;
  }

  /* 
   * INTEGRATION NOTE:
   * proceedToCheckout() should pass cart state to Block 4 (Order Flow).
   * Suggested: store cart in sessionStorage or pass via URL params/state to the checkout page.
   * Cart structure: Object { productId: quantity }
   */
  function proceedToCheckout() {
    const ids = Object.keys(cart).filter(id => cart[id] > 0);
    if (ids.length === 0) { showToast("Your cart is empty."); return; }
    persistCart();
    /* Hide the cart drawer directly (not via closeCart()) — closeCart()
     * would trigger its own async history.back(), which races against
     * pushing a new entry for checkout in the same click and corrupts
     * the history stack. slSwapOverlay() below correctly relabels the
     * cart's already-open history entry as "checkout is open" instead,
     * with no race. */
    document.getElementById("cartOverlay").classList.remove("open");
    document.getElementById("cartDrawer").classList.remove("open");
    window.slShowView('checkout');
    window.slSwapOverlay(backToCatalogueFromCheckout);
    document.body.style.overflow = ''; // checkout is a normal scrolling page, not a floating overlay
    renderSavedAddressChips();
  }

  /* ── Saved delivery addresses at checkout (v11.104) ──
     A quick-picker above the address field, populated from the buyer's
     address book. Tapping a chip fills the field; a small link below lets
     them save whatever they just typed for next time. */
  function renderSavedAddressChips() {
    const wrap = document.getElementById('savedAddressChips');
    if (!wrap) return;
    const u = window.SL.currentUser ? window.SL.currentUser() : null;
    const addrs = u && window.SL.getAddresses ? window.SL.getAddresses(u.id) : [];
    if (!addrs.length) { wrap.innerHTML = ''; wrap.style.display = 'none'; return; }
    wrap.style.display = 'flex';
    wrap.innerHTML = addrs.map(a => `
      <button type="button" onclick="document.getElementById('address').value=${JSON.stringify(a.address)};clearErr('address');" style="flex-shrink:0;white-space:nowrap;background:var(--green-light,#eef6ee);color:var(--green-deep,#0A5C36);border:1px solid var(--green-mid,#2f9e5c);border-radius:20px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;">${a.label}</button>
    `).join('');
  }
  window.renderSavedAddressChips = renderSavedAddressChips;

  function saveCurrentCheckoutAddress() {
    const u = window.SL.currentUser ? window.SL.currentUser() : null;
    if (!u) return;
    const val = (document.getElementById('address').value || '').trim();
    if (!val) { showToast('Type an address first.'); return; }
    const label = window.prompt('Label this address (e.g. Home, Shop):', '');
    if (!label || !label.trim()) return;
    window.SL.addAddress(u.id, label.trim(), val);
    renderSavedAddressChips();
    showToast('✅ Address saved for next time');
  }
  window.saveCurrentCheckoutAddress = saveCurrentCheckoutAddress;

  /* ── Delivery Addresses — management page (v11.104) ──
     Full CRUD for the address book, reachable from Profile. Checkout's
     chip picker (above) is the fast path; this is where a buyer manages
     the underlying list. */
  function closeAddressBookPanel() {
    const el = document.getElementById('slAddressBookPanel');
    if (el) el.remove();
    window.slPopOverlay();
  }
  window.closeAddressBookPanel = closeAddressBookPanel;

  function renderAddressBookBody() {
    const u = window.SL.currentUser ? window.SL.currentUser() : null;
    const addrs = u && window.SL.getAddresses ? window.SL.getAddresses(u.id) : [];
    const rows = addrs.length ? addrs.map(a => `
      <div style="display:flex;align-items:center;gap:12px;background:#fff;border-radius:12px;padding:14px;margin-bottom:10px;box-shadow:0 1px 4px rgba(0,0,0,.06);">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:13.5px;color:#1A4731;">${a.label}</div>
          <div style="font-size:12.5px;color:#777;margin-top:2px;">${a.address}</div>
        </div>
        <button onclick="window.deleteBookedAddress('${a.id}')" style="background:#FEE2E2;color:#991B1B;border:none;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0;">Remove</button>
      </div>`).join('') : `
      <div class="empty-state" style="padding:30px 20px;text-align:center;">
        <div class="emoji" style="font-size:36px;margin-bottom:8px;">📍</div>
        <p style="font-size:13px;color:#777;">No saved addresses yet.</p>
      </div>`;
    return rows + `
      <button onclick="window.addBookedAddress()" style="width:100%;background:var(--green-light,#eef6ee);color:var(--green-deep,#0A5C36);border:1.5px dashed var(--green-mid,#2f9e5c);border-radius:12px;padding:14px;font-size:13.5px;font-weight:700;cursor:pointer;margin-top:4px;">+ Add New Address</button>`;
  }

  function refreshAddressBookPanel() {
    const body = document.getElementById('slAddressBookBody');
    if (body) body.innerHTML = renderAddressBookBody();
  }

  window.deleteBookedAddress = function(addressId) {
    const u = window.SL.currentUser ? window.SL.currentUser() : null;
    if (!u) return;
    window.SL.removeAddress(u.id, addressId);
    refreshAddressBookPanel();
    if (typeof renderSavedAddressChips === 'function') renderSavedAddressChips();
  };

  window.addBookedAddress = function() {
    const u = window.SL.currentUser ? window.SL.currentUser() : null;
    if (!u) return;
    const label = window.prompt('Label this address (e.g. Home, Shop):', '');
    if (!label || !label.trim()) return;
    const address = window.prompt('Enter the address or landmark:', '');
    if (!address || !address.trim()) return;
    window.SL.addAddress(u.id, label.trim(), address.trim());
    refreshAddressBookPanel();
    if (typeof renderSavedAddressChips === 'function') renderSavedAddressChips();
  };

  function showAddressBookPanel() {
    const existing = document.getElementById('slAddressBookPanel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'slAddressBookPanel';
    panel.style.cssText = 'position:fixed;inset:0;z-index:3010;background:#f5f7f5;overflow-y:auto;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
    panel.innerHTML = `
      <div style="background:#1a472a;color:#fff;padding:16px 20px;display:flex;align-items:center;gap:12px;position:sticky;top:0;">
        <button style="background:rgba(255,255,255,.15);border:none;color:#fff;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:14px;" onclick="window.closeAddressBookPanel()">← Back</button>
        <div style="font-size:18px;font-weight:700;">Delivery Addresses</div>
      </div>
      <div style="padding:20px;max-width:520px;margin:0 auto;" id="slAddressBookBody">${renderAddressBookBody()}</div>`;
    document.body.appendChild(panel);
    window.slPushOverlay(closeAddressBookPanel);
  }
  window.showAddressBookPanel = showAddressBookPanel;

  function backToCatalogueFromCheckout() {
    window.slShowView('buyer-catalogue');
    window.slPopOverlay();
  }

  /* ── TOAST ── */
  function showToast(msg) {
    const t = document.getElementById("b3-toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 2800);
  }

  /* ── START ── */
  window.SL.registerInit('buyer-catalogue', init);

    /* expose inline-onclick functions to global scope */
    window.addFromModal=addFromModal; window.changeCartQty=changeCartQty;
    window.backToCatalogueFromCheckout=backToCatalogueFromCheckout;
    window.changeModalQty=changeModalQty; window.closeCart=closeCart;
    window.closeModal=closeModal; window.filterProducts=filterProducts;
    window.handleOverlayClick=handleOverlayClick; window.openCart=openCart;
    window.openModal=openModal; window.proceedToCheckout=proceedToCheckout;
    window.setModalImage=setModalImage;
    window.quickAdd=quickAdd; window.removeCartItem=removeCartItem;
    window.selectCategory=selectCategory;
    window.setTierFilter=setTierFilter; window.setSortMode=setSortMode;
    window.promptSetLocation=promptSetLocation; window.selectModalSpeed=selectModalSpeed;
    window.showMyOrdersPanel=showMyOrdersPanel; window.showNotificationsPanel=showNotificationsPanel;
    window.openRatingModal=openRatingModal; window.submitRating=submitRating;
    window.refreshBellBadge=refreshBellBadge;
    window.openRefundModal=openRefundModal; window.submitRefundRequest=submitRefundRequest;
    window.refreshOrdersBadge=refreshOrdersBadge;
  })();
  