
  (function() {
    'use strict';

    /* ── Demo seed data (used only when localStorage is empty) ──
       This is the ONE canonical copy — matches the demo credentials
       shown on the login screen (0200000001-4). Other script blocks
       reference window.SL_DEMO_USERS / window.SL_DEMO_PRODUCTS below
       instead of keeping their own copies, so this never drifts out
       of sync again. ── */
    const DEMO_USERS = [
      { id:'u001', name:'Emmanuel Amoah',      phone:'0200000001', password:'Slk#Adm9x4Vq',    role:'admin',  status:'active' },
      { id:'u002', name:'Kwame Asante',        phone:'0200000002', password:'Slk#Sup7hRt2',    role:'supplier', status:'active',
        bizType:'farmer', location:'Ejura, Ashanti', momo:'0200000002', momoNetwork:'mtn', createdAt:Date.now()-86400000*90 },
      { id:'u003', name:'Abena Mensah',        phone:'0200000003', password:'Slk#Byh3Wm8',    role:'buyer', buyerType:'household', status:'active', address:'Ahodwo, Kumasi' },
      { id:'u004', name:'Mensah Catering Ltd', phone:'0200000004', password:'Slk#Byb5Ln6',    role:'buyer', buyerType:'business', bizName:'Mensah Catering Ltd', status:'active', address:'Suame, Kumasi' },
    ];

    const DEMO_PRODUCTS = [
      { id:'p1', name:'Tomatoes',   category:'Vegetables',     unit:'per crate (10kg)',  weightKg:10, supplierPrice:70,  buyerPrice:90,  stockQty:20, supplierId:'u002', supplierName:'Kwame Asante', isAvailable:true, createdAt:Date.now()-86400000*5 },
      { id:'p2', name:'Onions',     category:'Vegetables',     unit:'per bag (25kg)',    weightKg:25, supplierPrice:95,  buyerPrice:125, stockQty:15, supplierId:'u002', supplierName:'Kwame Asante', isAvailable:true, createdAt:Date.now()-86400000*4 },
      { id:'p3', name:'Plantain',   category:'Fruits',         unit:'per bunch (~5kg)',  weightKg:5,  supplierPrice:35,  buyerPrice:48,  stockQty:30, supplierId:'u002', supplierName:'Kwame Asante', isAvailable:true, createdAt:Date.now()-86400000*3 },
      { id:'p4', name:'Yam',        category:'Tubers',         unit:'per tuber (3–5kg)', weightKg:4,  supplierPrice:20,  buyerPrice:30,  stockQty:50, supplierId:'u002', supplierName:'Kwame Asante', isAvailable:true, createdAt:Date.now()-86400000*2 },
      { id:'p5', name:'Rice',       category:'Grains & Cereals',unit:'per 50kg sack',    supplierPrice:260, buyerPrice:320, stockQty:10, supplierId:'u002', supplierName:'Kwame Asante', isAvailable:true, createdAt:Date.now()-86400000*1 },
      { id:'p6', name:'Ginger',     category:'Spices & Herbs', unit:'per kg',            supplierPrice:28,  buyerPrice:38,  stockQty:25, supplierId:'u002', supplierName:'Kwame Asante', isAvailable:true, createdAt:Date.now()            },
    ];

    window.SL_DEMO_USERS = DEMO_USERS;
    window.SL_DEMO_PRODUCTS = DEMO_PRODUCTS;

    /* ── Storage helpers ── */
    function lsGet(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
      catch(e) { return fallback; }
    }
    function lsSet(key, val) {
      try {
        localStorage.setItem(key, JSON.stringify(val));
      } catch(e) {
        console.error('STORAGE WRITE FAILED for key "' + key + '":', e);
        if (!window.__slStorageWarningShown) {
          window.__slStorageWarningShown = true;
          alert('⚠️ Storage is full — this save did NOT go through.\n\n' +
                'Key: ' + key + '\n' +
                'Error: ' + e.message + '\n\n' +
                'This is very likely why recent orders/products aren\'t showing up. ' +
                'Product photos take up a lot of space — removing some, or freeing up ' +
                'storage, should fix this. Please screenshot this message.');
        }
      }
    }

    /* ── Seed on first load ── */
    if (!localStorage.getItem('sl_users'))    lsSet('sl_users',    DEMO_USERS);
    if (!localStorage.getItem('sl_products')) lsSet('sl_products', DEMO_PRODUCTS);
    if (!localStorage.getItem('sl_orders'))   lsSet('sl_orders',   []);

    /* ── PASSWORD HASHING ──
       Passwords used to be stored as plain text (both locally and in the
       Supabase 'users' table) — anyone with DB access could read every
       account's real password. This salts + SHA-256-hashes them instead.
       Note this is a client-side improvement, not full server-grade auth:
       the hash is still computed and compared in the browser, so it's a
       real step up from plain text but not equivalent to a proper backend
       auth service. That's a bigger migration (Supabase Auth) for later. */
    function genSalt() {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    async function hashPassword(password, salt) {
      const enc = new TextEncoder().encode(salt + ':' + password);
      const digest = await crypto.subtle.digest('SHA-256', enc);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    /* One-time-per-account migration: any user still holding a plaintext
       `password` field gets it hashed and the plaintext field removed.
       Runs on every load but is a no-op once everyone's migrated, so it's
       safe to leave in permanently as a self-healing safety net. */
    async function migratePasswordsIfNeeded() {
      const users = lsGet('sl_users', DEMO_USERS);
      let changed = false;
      for (const u of users) {
        if (u.password && !u.password_hash) {
          u.password_salt = genSalt();
          u.password_hash = await hashPassword(u.password, u.password_salt);
          delete u.password;
          changed = true;
        }
      }
      if (changed) lsSet('sl_users', users);
    }
    migratePasswordsIfNeeded();

    /* ── View registry: view name → init callback ── */
    const _initRegistry = {};

    /* ── The SL shared API ── */
    window.SL = {
      registerInit(viewName, fn) { _initRegistry[viewName] = fn; },
      hashPassword, genSalt,

      /* Users */
      getUsers()       { return lsGet('sl_users', DEMO_USERS); },
      saveUsers(users) { lsSet('sl_users', users); },
      updateUser(id, patch) {
        const list = window.SL.getUsers();
        const idx = list.findIndex(u => u.id === id);
        if (idx === -1) return null;
        list[idx] = Object.assign({}, list[idx], patch);
        lsSet('sl_users', list);
        const cu = window.SL.currentUser();
        if (cu && cu.id === id) {
          const updated = Object.assign({}, cu, patch);
          window.SL.setCurrentUser(updated);
        }
        return list[idx];
      },

      /* ── Liked / saved items (v11.94) ──
         Buyer-facing wishlist. Stored as an array of product ids on the
         user record itself (synced to Supabase like everything else on
         users), rather than a separate table — a buyer's likes are small,
         personal, and always looked up by their own id, so there's no
         real benefit to a join, and this keeps it working offline for
         free via the existing users sync path. */
      toggleLikedItem(userId, productId) {
        const u = window.SL.getUsers().find(x => x.id === userId);
        const cur = (u && Array.isArray(u.likedItems)) ? u.likedItems.slice() : [];
        const pos = cur.indexOf(productId);
        if (pos === -1) cur.push(productId); else cur.splice(pos, 1);
        window.SL.updateUser(userId, { likedItems: cur });
        return cur;
      },
      isLikedByUser(userId, productId) {
        const u = window.SL.getUsers().find(x => x.id === userId);
        return !!(u && Array.isArray(u.likedItems) && u.likedItems.indexOf(productId) !== -1);
      },
      getLikedItems(userId) {
        const u = window.SL.getUsers().find(x => x.id === userId);
        return (u && Array.isArray(u.likedItems)) ? u.likedItems : [];
      },

      /* ── Saved delivery addresses (v11.104) ──
         Small address book — a buyer with a shop and a home no longer has
         to retype an address every checkout. Kept simple: label + text,
         no geocoding. The single legacy "address" field stays untouched
         as a fallback for buyers who never open the address book. */
      getAddresses(userId) {
        const u = window.SL.getUsers().find(x => x.id === userId);
        return (u && Array.isArray(u.addresses)) ? u.addresses : [];
      },
      addAddress(userId, label, address) {
        const list = window.SL.getAddresses(userId).slice();
        const entry = { id: 'ADDR-' + Date.now().toString(36).toUpperCase(), label, address };
        list.push(entry);
        window.SL.updateUser(userId, { addresses: list });
        return entry;
      },
      updateAddress(userId, addressId, patch) {
        const list = window.SL.getAddresses(userId).slice();
        const idx = list.findIndex(a => a.id === addressId);
        if (idx === -1) return null;
        list[idx] = Object.assign({}, list[idx], patch);
        window.SL.updateUser(userId, { addresses: list });
        return list[idx];
      },
      removeAddress(userId, addressId) {
        const list = window.SL.getAddresses(userId).filter(a => a.id !== addressId);
        window.SL.updateUser(userId, { addresses: list });
        return list;
      },

      /* Products */
      getProducts()    { return lsGet('sl_products', DEMO_PRODUCTS); },
      saveProducts(ps) { lsSet('sl_products', ps); },
      addProduct(p) {
        const ps = window.SL.getProducts();
        if (typeof p.stockQty === 'number' && p.stockQty > 0 && p.stockQty <= 10) {
          p = Object.assign({}, p, { lowStockSince: p.lowStockSince || Date.now() });
        }
        ps.unshift(p);
        lsSet('sl_products', ps);
      },
      /* Tracks how long a product has sat at/below the low-stock threshold,
         set/cleared automatically whenever stockQty changes through here —
         regardless of which feature (bulk edit, single edit, CSV import)
         triggered the change. Powers the "still low after N days" nudge,
         since a banner that's been sitting unread easily becomes wallpaper. */
      updateProduct(id, patch) {
        const ps = window.SL.getProducts().map(p => {
          if (p.id !== id) return p;
          const merged = Object.assign({}, p, patch);
          if (Object.prototype.hasOwnProperty.call(patch, 'stockQty')) {
            const isLow = (patch.stockQty || 0) > 0 && (patch.stockQty || 0) <= 10;
            merged.lowStockSince = isLow ? (p.lowStockSince || Date.now()) : null;
          }
          return merged;
        });
        lsSet('sl_products', ps);
      },

      /* Orders */
      getOrders()        { return lsGet('sl_orders', []); },
      saveOrder(order) {
        const orders = window.SL.getOrders();
        orders.unshift(order);
        lsSet('sl_orders', orders);
      },
      updateOrderStatus(id, status) {
        const orders = window.SL.getOrders().map(o => o.id === id ? Object.assign({}, o, {status}) : o);
        lsSet('sl_orders', orders);
      },
      /* Marks specific line items within an order as "prepared" — scoped to
         one supplier's own items on a (possibly split) order, so it never
         touches another supplier's portion of the same order. */
      markOrderItemsPrepared(orderId, supplierId, productIds) {
        return window.SL.markMultipleOrderItemsPrepared(supplierId, { [orderId]: productIds });
      },
      /* Bulk version — takes { orderId: [productId, ...], ... } and does
         ONE read, ONE set of in-memory mutations across every affected
         order, and ONE write. Originally this just batched the local write
         (v11.104), which fixed same-device races but not the real-world
         bug: EVERY order write in this app pushes the device's entire
         local sl_orders array to the cloud, not just the row that
         changed. If Admin is active in another tab/device and their local
         copy hasn't yet polled in this exact order's "prepared" update,
         the very next thing Admin's screen writes — even to a totally
         different order — re-uploads Admin's stale copy of THIS order and
         silently erases the flag the supplier just set, typically inside
         the ~20s poll window. That's the "reappears within 10 seconds"
         bug reported in testing.
         Fix: before writing, pull a fresh copy of just the affected order
         rows straight from Supabase (not from this device's possibly-stale
         localStorage) and apply the "prepared" change on top of THAT, so
         this device's resulting push can't clobber some other concurrent
         change to these same orders. Falls back to the old local-only
         merge if the device is offline. Returns a Promise so callers can
         wait for it (previous version was fire-and-forget). */
      async markMultipleOrderItemsPrepared(supplierId, byOrderProductIds) {
        const orderIds = Object.keys(byOrderProductIds);
        const orders = window.SL.getOrders();
        let freshById = {};
        if (window.SL_sb) {
          try {
            const { data, error } = await window.SL_sb.from('orders').select('*').in('id', orderIds);
            if (!error && Array.isArray(data)) {
              data.forEach(row => { if (row && row.id) freshById[row.id] = row; });
            }
          } catch (e) { /* offline or request failed — fall back to local copy below */ }
        }
        orderIds.forEach(orderId => {
          const idx = orders.findIndex(o => o.id === orderId);
          // Prefer the just-fetched cloud row (freshest possible state for
          // this specific order) over whatever this device had locally;
          // only fall back to the local copy if the cloud fetch didn't
          // return this order (offline, or a brand-new local-only order).
          const base = freshById[orderId] || (idx !== -1 ? orders[idx] : null);
          if (!base || !Array.isArray(base.items)) return;
          const order = idx !== -1 ? Object.assign(orders[idx], base) : base;
          const productIds = byOrderProductIds[orderId];
          order.items.forEach(it => {
            if (it.supplierId === supplierId && productIds.indexOf(it.productId) !== -1) {
              it.prepared = true;
            }
          });
          // Once every item on the order (across however many suppliers it
          // spans) is prepared, auto-advance status: pending -> confirmed.
          // Reuses admChangeOrderStatus so the buyer gets the exact same
          // SMS/notification an admin manually confirming the order would
          // trigger — only fires from 'pending' so it never overrides an
          // admin who has already moved the order further along, or a
          // cancelled order.
          if ((order.status || 'pending') === 'pending' && order.items.length > 0 && order.items.every(i => i.prepared)) {
            if (idx !== -1 && typeof window.admChangeOrderStatus === 'function') {
              window.admChangeOrderStatus(orders, idx, 'confirmed');
            } else {
              order.status = 'confirmed';
            }
          }
          if (idx !== -1) orders[idx] = order; else orders.push(order);
        });
        lsSet('sl_orders', orders);
        return true;
      },

      /* Cash remittances — Pay-on-Delivery orders leave cash in a rider's
         hand. This ledger tracks cash they've handed back to SupplyLink,
         so outstanding = collected - remitted per rider. */
      getCashRemittances() { return lsGet('sl_cash_remit', []); },
      addCashRemittance({ riderId, amount, note }) {
        const list = window.SL.getCashRemittances();
        list.unshift({
          id: 'CR-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
          riderId, amount, note: note || '',
          recordedAt: Date.now()
        });
        lsSet('sl_cash_remit', list);
        return list[0];
      },

      /* Rider-initiated remittance requests — a rider logs "I handed over
         GH₵X" from their phone, but it stays pending until Admin confirms
         it actually landed in their hand. Only on confirm does it turn
         into a real ledger entry via addCashRemittance above, so the
         cash-outstanding number stays admin-authoritative and can't be
         zeroed out by a rider's own say-so. */
      getRemitRequests() { return lsGet('sl_remit_requests', []); },
      addRemitRequest({ riderId, riderName, amount, note }) {
        const list = window.SL.getRemitRequests();
        const entry = {
          id: 'RR-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
          riderId, riderName: riderName || '', amount, note: note || '',
          status: 'pending', // pending | confirmed | rejected
          requestedAt: Date.now(),
          resolvedAt: null
        };
        list.unshift(entry);
        lsSet('sl_remit_requests', list);
        return entry;
      },
      resolveRemitRequest(id, status) {
        const list = window.SL.getRemitRequests();
        const idx = list.findIndex(r => r.id === id);
        if (idx === -1) return null;
        list[idx] = Object.assign({}, list[idx], { status, resolvedAt: Date.now() });
        lsSet('sl_remit_requests', list);
        if (status === 'confirmed') {
          window.SL.addCashRemittance({ riderId: list[idx].riderId, amount: list[idx].amount, note: 'Confirmed from rider handover request ' + id });
        }
        return list[idx];
      },

      /* Rider shifts — doubles as the Online/Offline toggle: going online
         opens a shift, going offline closes it. Feeds both dispatch
         visibility (who's active right now) and utilization stats (hours
         worked, shift count) for things like the Prudential pitch. */
      getRiderShifts() { return lsGet('sl_rider_shifts', []); },
      getActiveShift(riderId) {
        return window.SL.getRiderShifts().find(s => s.riderId === riderId && !s.endedAt) || null;
      },
      startRiderShift(riderId) {
        if (window.SL.getActiveShift(riderId)) return window.SL.getActiveShift(riderId);
        const list = window.SL.getRiderShifts();
        const entry = { id: 'SH-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(), riderId, startedAt: Date.now(), endedAt: null };
        list.unshift(entry);
        lsSet('sl_rider_shifts', list);
        return entry;
      },
      endRiderShift(riderId) {
        const list = window.SL.getRiderShifts();
        const idx = list.findIndex(s => s.riderId === riderId && !s.endedAt);
        if (idx === -1) return null;
        list[idx] = Object.assign({}, list[idx], { endedAt: Date.now() });
        lsSet('sl_rider_shifts', list);
        return list[idx];
      },
      isRiderOnline(riderId) { return !!window.SL.getActiveShift(riderId); },

      /* App-wide settings — small key/value bag, e.g. per-delivery rider pay.
         Stored as a one-row array (id:'global') rather than a bare object,
         because the cloud sync engine (pushToCloud/hydrate) works on arrays
         of rows for every table — a raw object here would silently fail to
         sync (Array.isArray check) the same way sl_cash_remit's records do
         work today only because they're already an array. */
      getSettings() {
        const rows = lsGet('sl_settings', []);
        return (Array.isArray(rows) && rows[0]) ? rows[0] : {};
      },
      saveSettings(patch) {
        const merged = Object.assign({ id: 'global' }, window.SL.getSettings(), patch);
        lsSet('sl_settings', [merged]);
        return merged;
      },

      /* Payout status per (orderId::supplierId) line — who's been paid,
         when, by what method. Stored as an array of rows (id = the
         orderId::supplierId key) rather than a bare object, for the same
         reason sl_settings is: the cloud sync engine only syncs arrays,
         so a plain object here silently never left the device it was
         written on — every "Mark Paid"/"Pay via MoMo" was phone-local
         only until this fix. A one-time transparent migration below
         converts anyone's existing legacy object-shaped local data. */
      getPayouts() {
        const raw = lsGet('sl_payouts', []);
        let arr;
        if (Array.isArray(raw)) {
          arr = raw;
        } else {
          arr = Object.keys(raw || {}).map(k => Object.assign({ id: k }, raw[k]));
          lsSet('sl_payouts', arr);
        }
        const obj = {};
        arr.forEach(r => { obj[r.id] = r; });
        return obj;
      },
      setPayoutStatus(key, patch) {
        const raw = lsGet('sl_payouts', []);
        const arr = Array.isArray(raw) ? raw : Object.keys(raw || {}).map(k => Object.assign({ id: k }, raw[k]));
        const idx = arr.findIndex(r => r.id === key);
        if (idx === -1) arr.push(Object.assign({ id: key }, patch));
        else arr[idx] = Object.assign({}, arr[idx], patch);
        lsSet('sl_payouts', arr);
      },

      /* Refunds — buyer-submitted issue/refund requests, admin-reviewed.
         One refund record per order (buyer can submit once per order in this version). */
      getRefunds()      { return lsGet('sl_refunds', []); },
      addRefundRequest(req) {
        const list = window.SL.getRefunds();
        const entry = Object.assign({
          id: 'RF-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
          status: 'pending',        // pending | approved | rejected
          method: null,             // wallet | momo_reversal
          supplierAmounts: {},      // { supplierId: amountToDeductFromPayout }
          adminNote: '',
          createdAt: Date.now(),
          resolvedAt: null
        }, req);
        list.unshift(entry);
        lsSet('sl_refunds', list);
        return entry;
      },
      getRefundForOrder(orderId) {
        return window.SL.getRefunds().find(r => r.orderId === orderId) || null;
      },
      resolveRefund(id, patch) {
        const list = window.SL.getRefunds();
        const idx = list.findIndex(r => r.id === id);
        if (idx === -1) return null;
        list[idx] = Object.assign({}, list[idx], patch, { resolvedAt: Date.now() });
        lsSet('sl_refunds', list);
        return list[idx];
      },
      /* Amount already deducted from a given supplier's payout for a given order,
         due to an approved refund. Used so payout screens never double-pay a
         supplier for goods that were refunded to the buyer. */
      getRefundedAmountForOrderSupplier(orderId, supplierId) {
        const r = window.SL.getRefunds().find(x => x.orderId === orderId && x.status === 'approved');
        if (!r || !r.supplierAmounts) return 0;
        return r.supplierAmounts[supplierId] || 0;
      },

      /* Reviews & Ratings — one review per (orderId, supplierId) pair */
      getReviews()      { return lsGet('sl_reviews', []); },
      /* Reliable "which suppliers were in this order" lookup. Prefers
         supplierBreakdown (set at checkout), but falls back to deriving
         it from order.items for older orders placed before that field
         existed — otherwise rating/refund UI silently has nothing to show. */
      getOrderSupplierGroups(order) {
        if (!order) return [];
        if (order.supplierBreakdown && order.supplierBreakdown.length) return order.supplierBreakdown;
        const ids = [...new Set((order.items || []).map(it => it.supplierId).filter(Boolean))];
        const users = lsGet('sl_users', DEMO_USERS);
        return ids.map(id => {
          const u = users.find(x => x.id === id);
          return { supplierId: id, supplierName: u ? u.name : 'Supplier' };
        });
      },
      /* 'farm' | 'wholesale' — a product's own sourcing choice, set by
         whoever lists it. Falls back to the supplier account's bizType
         for products listed before this per-product field existed, so
         nothing already in the catalogue silently disappears/misfiles. */
      getProductTier(product) {
        if (!product) return 'wholesale';
        if (product.sourceType === 'farm') return 'farm';
        if (product.sourceType === 'wholesale') return 'wholesale';
        const users = lsGet('sl_users', DEMO_USERS);
        const supplier = users.find(u => u.id === product.supplierId);
        return (supplier && supplier.bizType === 'farmer') ? 'farm' : 'wholesale';
      },
      addReview(review) {
        const list = window.SL.getReviews();
        const entry = Object.assign({
          id: 'RV-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
          createdAt: Date.now()
        }, review);
        list.unshift(entry);
        lsSet('sl_reviews', list);
        return entry;
      },
      hasReviewed(orderId, supplierId) {
        return window.SL.getReviews().some(r => r.orderId === orderId && r.supplierId === supplierId);
      },

      /* ── Admin → Buyer direct messages (v11.98) ──
         Deliberately one-directional (admin sends, buyer reads) rather
         than a full two-way chat — matches what was actually asked for,
         and keeps the surface area small. Synced through the same
         localStorage → Supabase pipeline as everything else. */
      getMessages()      { return lsGet('sl_messages', []); },
      sendMessage(recipientId, message, senderName) {
        const list = window.SL.getMessages();
        const entry = {
          id: 'MSG-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
          senderId: 'admin',
          senderName: senderName || 'SupplyLink Team',
          recipientId,
          message,
          createdAt: Date.now(),
          read: false
        };
        list.unshift(entry);
        lsSet('sl_messages', list);
        return entry;
      },
      getMessagesForUser(userId) {
        return window.SL.getMessages()
          .filter(m => m.recipientId === userId)
          .sort((a, b) => b.createdAt - a.createdAt);
      },
      unreadMessageCount(userId) {
        return window.SL.getMessagesForUser(userId).filter(m => !m.read).length;
      },
      markMessagesRead(userId) {
        const list = window.SL.getMessages();
        let changed = false;
        list.forEach(m => { if (m.recipientId === userId && !m.read) { m.read = true; changed = true; } });
        if (changed) lsSet('sl_messages', list);
      },
      getSupplierRating(supplierId) {
        const list = window.SL.getReviews().filter(r => r.supplierId === supplierId);
        if (!list.length) return { avg: 0, count: 0 };
        const sum = list.reduce((s, r) => s + (r.rating || 0), 0);
        return { avg: sum / list.length, count: list.length };
      },
      getSupplierDeliveredCount(supplierId) {
        const orders = window.SL.getOrders();
        return orders.filter(o => o.status === 'delivered' &&
          (o.supplierBreakdown || []).some(sb => sb.supplierId === supplierId)).length;
      },
      isSupplierVerified(supplierId) {
        return window.SL.getSupplierDeliveredCount(supplierId) >= 5;
      },

      /* In-app notifications (bell icon) — per-user, no SMS/backend required */
      getNotifications(userId) {
        const all = lsGet('sl_notifications', []);
        return userId ? all.filter(n => n.userId === userId) : all;
      },
      addNotification({ userId, message, orderId, type }) {
        if (!userId || !message) return;
        const all = lsGet('sl_notifications', []);
        all.unshift({
          id: 'N-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
          userId, message, orderId: orderId || null, type: type || 'info',
          read: false, createdAt: Date.now()
        });
        if (all.length > 300) all.length = 300;
        lsSet('sl_notifications', all);
      },
      markNotificationsRead(userId) {
        const all = lsGet('sl_notifications', []);
        all.forEach(n => { if (n.userId === userId) n.read = true; });
        lsSet('sl_notifications', all);
      },
      unreadNotificationCount(userId) {
        return window.SL.getNotifications(userId).filter(n => !n.read).length;
      },

      /* ── Wallet (SupplyLink Credit) — used for referral rewards, etc. ── */
      getWalletBalance(userId) {
        const u = (window.SL.getUsers() || []).find(x => x.id === userId);
        return (u && typeof u.walletBalance === 'number') ? u.walletBalance : 0;
      },
      adjustWallet(userId, amount) {
        const users = window.SL.getUsers() || [];
        const idx = users.findIndex(x => x.id === userId);
        if (idx === -1) return;
        users[idx].walletBalance = Math.max(0, (users[idx].walletBalance || 0) + amount);
        window.SL.saveUsers(users);
        const cu = window.SL.currentUser();
        if (cu && cu.id === userId) {
          cu.walletBalance = users[idx].walletBalance;
          window.SL.setCurrentUser(cu);
        }
      },

      /* ── Referrals ──
         sl_referrals entries: { id, referrerUserId, referredUserId, status: 'pending'|'rewarded', createdAt, rewardedAt }
         The referred buyer gets their signup bonus instantly (handled at registration).
         The referrer only gets rewarded once the referred buyer's first order is
         marked "delivered" — this keeps the reward tied to a real, completed order. */
      REFERRAL_REWARD: 20,
      getReferrals() { return lsGet('sl_referrals', []); },
      addReferral(r) {
        const list = window.SL.getReferrals();
        list.unshift(Object.assign({
          id: 'REF-' + Date.now().toString(36).toUpperCase(),
          status: 'pending', createdAt: Date.now()
        }, r));
        lsSet('sl_referrals', list);
      },
      generateReferralCode(name) {
        const base = (name || 'SLM').replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase() || 'SLM';
        const users = window.SL.getUsers() || [];
        let code, tries = 0;
        do {
          code = base + Math.floor(100 + Math.random() * 900);
          tries++;
        } while (users.some(u => u.referralCode === code) && tries < 20);
        return code;
      },
      rewardReferralIfEligible(buyerId) {
        const referrals = window.SL.getReferrals();
        const ref = referrals.find(r => r.referredUserId === buyerId && r.status === 'pending');
        if (!ref) return;
        ref.status = 'rewarded';
        ref.rewardedAt = Date.now();
        lsSet('sl_referrals', referrals);
        window.SL.adjustWallet(ref.referrerUserId, window.SL.REFERRAL_REWARD);
        window.SL.addNotification({
          userId: ref.referrerUserId,
          message: `🎉 You earned GH₵${window.SL.REFERRAL_REWARD.toFixed(2)} SupplyLink Credit — a friend you referred just completed their first order!`,
          type: 'referral'
        });
      },

      /* Session */
      currentUser()    { return lsGet('sl_current', null); },
      setCurrentUser(u){ lsSet('sl_current', u); },
      clearSession()   { localStorage.removeItem('sl_current'); },

      /* ── SMS ENGINE ─────────────────────────────────────────────
         Simulates Hubtel SMS. When backend is ready, replace the
         localStorage write with a real API call:
           POST https://smsc.hubtel.com/v1/messages/send
         with your Hubtel clientId, clientSecret, from, to, content.
      ─────────────────────────────────────────────────────────── */
      sms({ to, message, event, orderId }) {
        if (!to || !message) return;
        const log = lsGet('sl_sms_log', []);
        const entry = {
          /* Random suffix added (v11.93) — Date.now() alone isn't
             enough here because split orders send one SMS per supplier
             in a tight loop, and two calls landing in the same
             millisecond produced two rows with an identical id. When
             both landed in the same cloud upsert batch, Postgres's
             ON CONFLICT DO UPDATE rejected the batch outright with
             "cannot affect row a second time" — which is the exact
             error you saw. */
          id: 'SMS-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
          to, message, event,
          orderId: orderId || null,
          sentAt: Date.now(),
          status: 'simulated'
        };
        log.unshift(entry);
        if (log.length > 100) log.length = 100;
        lsSet('sl_sms_log', log);
        window.SL._showSmsToast(to, message);
        return entry;
      },

      getSmsLog()  { return lsGet('sl_sms_log', []); },
      clearSmsLog(){ lsSet('sl_sms_log', []); },

      _showSmsToast(to, message) {
        let el = document.getElementById('sl-sms-toast');
        if (!el) {
          el = document.createElement('div');
          el.id = 'sl-sms-toast';
          el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%) translateY(16px);background:#0a3d20;color:#fff;padding:12px 16px;border-radius:14px;font-size:12px;font-family:Plus Jakarta Sans,Inter,sans-serif;z-index:99999;opacity:0;transition:all .35s;max-width:300px;width:90%;box-shadow:0 6px 24px rgba(0,0,0,.28);pointer-events:none;';
          document.body.appendChild(el);
        }
        const short = message.length > 90 ? message.slice(0, 90) + '...' : message;
        el.innerHTML = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;"><span style="font-size:15px;">📱</span><span style="font-weight:700;font-size:11px;opacity:.75;letter-spacing:.5px;">SMS SENT · SIMULATION</span></div><div style="font-weight:600;font-size:11px;opacity:.7;margin-bottom:3px;">To: ' + to + '</div><div style="font-size:12px;line-height:1.5;opacity:.92;">' + short + '</div>';
        el.style.opacity = '1';
        el.style.transform = 'translateX(-50%) translateY(0)';
        clearTimeout(window._slSmsToastTimer);
        window._slSmsToastTimer = setTimeout(function() {
          el.style.opacity = '0';
          el.style.transform = 'translateX(-50%) translateY(16px)';
        }, 4500);
      },

      /* ── Image compression (Phase 2 photo uploads) ──
         Resizes+recompresses a raw File/Blob in the browser before it's ever
         stored, so a multi-MB phone photo becomes a small JPEG data URL
         suitable for localStorage + Supabase sync. Returns a Promise<string>. */
      compressImage(file, opts) {
        const maxWidth = (opts && opts.maxWidth) || 1200;
        const quality  = (opts && opts.quality)  || 0.72;
        return new Promise((resolve, reject) => {
          if (!file || !file.type || file.type.indexOf('image/') !== 0) {
            reject(new Error('Not an image file')); return;
          }
          const reader = new FileReader();
          reader.onerror = () => reject(new Error('Could not read file'));
          reader.onload = (e) => {
            const img = new Image();
            img.onerror = () => reject(new Error('Could not decode image'));
            img.onload = () => {
              let w = img.width, h = img.height;
              if (w > maxWidth) { h = Math.round(h * (maxWidth / w)); w = maxWidth; }
              const canvas = document.createElement('canvas');
              canvas.width = w; canvas.height = h;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, w, h);
              try {
                resolve(canvas.toDataURL('image/jpeg', quality));
              } catch (err) { reject(err); }
            };
            img.src = e.target.result;
          };
          reader.readAsDataURL(file);
        });
      },

      /* ── Product photo upload (v11.89) ──
         Compresses the same way as compressImage(), but uploads the result
         to the 'product-images' Supabase Storage bucket and returns a short
         public URL instead of a giant base64 string. This is what actually
         fixes the "Storage used" ceiling — base64 photos in localStorage
         were the entire problem.
         Falls back to the old base64 behavior (stored only in this browser's
         localStorage) if the cloud upload fails for any reason — e.g. no
         internet — so an admin isn't fully blocked from adding a product
         photo while offline. The caller should still warn the user in that
         case since the photo won't be visible to buyers on other devices. */
      async uploadProductImage(file, opts) {
        const maxWidth = (opts && opts.maxWidth) || 1200;
        const quality  = (opts && opts.quality)  || 0.72;
        if (!file || !file.type || file.type.indexOf('image/') !== 0) {
          throw new Error('Not an image file');
        }
        const blob = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error('Could not read file'));
          reader.onload = (e) => {
            const img = new Image();
            img.onerror = () => reject(new Error('Could not decode image'));
            img.onload = () => {
              let w = img.width, h = img.height;
              if (w > maxWidth) { h = Math.round(h * (maxWidth / w)); w = maxWidth; }
              const canvas = document.createElement('canvas');
              canvas.width = w; canvas.height = h;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, w, h);
              canvas.toBlob((b) => {
                if (b) resolve(b); else reject(new Error('Could not compress image'));
              }, 'image/jpeg', quality);
            };
            img.src = e.target.result;
          };
          reader.readAsDataURL(file);
        });

        const sb = window.SL_sb;
        if (!sb) throw new Error('Cloud storage unavailable (offline)');

        const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
        const { error: uploadError } = await sb.storage
          .from('product-images')
          .upload(fileName, blob, { contentType: 'image/jpeg', cacheControl: '3600', upsert: false });
        if (uploadError) throw uploadError;

        const { data } = sb.storage.from('product-images').getPublicUrl(fileName);
        if (!data || !data.publicUrl) throw new Error('Could not get public URL for uploaded image');
        return data.publicUrl;
      },

      /* ── Generic photo upload (Storage-migration, v11.133) ──
         Same compress-then-upload approach as uploadProductImage, but for
         any bucket — used by refund evidence photos and rider/delivery
         confirmation photos, which previously stayed as base64 forever
         (never migrated when product photos were). Same graceful-fallback
         contract: throws on failure so the caller can fall back to
         compressImage()'s local base64 result. */
      async uploadImage(file, opts, bucket) {
        const maxWidth = (opts && opts.maxWidth) || 1200;
        const quality  = (opts && opts.quality)  || 0.72;
        if (!file || !file.type || file.type.indexOf('image/') !== 0) {
          throw new Error('Not an image file');
        }
        const blob = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error('Could not read file'));
          reader.onload = (e) => {
            const img = new Image();
            img.onerror = () => reject(new Error('Could not decode image'));
            img.onload = () => {
              let w = img.width, h = img.height;
              if (w > maxWidth) { h = Math.round(h * (maxWidth / w)); w = maxWidth; }
              const canvas = document.createElement('canvas');
              canvas.width = w; canvas.height = h;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, w, h);
              canvas.toBlob((b) => {
                if (b) resolve(b); else reject(new Error('Could not compress image'));
              }, 'image/jpeg', quality);
            };
            img.src = e.target.result;
          };
          reader.readAsDataURL(file);
        });

        const sb = window.SL_sb;
        if (!sb) throw new Error('Cloud storage unavailable (offline)');

        const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
        const { error: uploadError } = await sb.storage
          .from(bucket)
          .upload(fileName, blob, { contentType: 'image/jpeg', cacheControl: '3600', upsert: false });
        if (uploadError) throw uploadError;

        const { data } = sb.storage.from(bucket).getPublicUrl(fileName);
        if (!data || !data.publicUrl) throw new Error('Could not get public URL for uploaded image');
        return data.publicUrl;
      },

      /* ── Signature upload (Storage-migration, v11.133) ──
         Signatures come from a <canvas>.toDataURL() call, not a File, so
         they skip the FileReader/compress step entirely — just convert the
         existing PNG data URL to a Blob and upload it as-is (signatures are
         already tiny; no need to recompress). Same throw-on-failure contract
         as uploadImage/uploadProductImage. */
      async uploadDataUrlImage(dataUrl, bucket) {
        const sb = window.SL_sb;
        if (!sb) throw new Error('Cloud storage unavailable (offline)');
        const blob = await (await fetch(dataUrl)).blob();
        const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
        const { error: uploadError } = await sb.storage
          .from(bucket)
          .upload(fileName, blob, { contentType: 'image/png', cacheControl: '3600', upsert: false });
        if (uploadError) throw uploadError;

        const { data } = sb.storage.from(bucket).getPublicUrl(fileName);
        if (!data || !data.publicUrl) throw new Error('Could not get public URL for uploaded signature');
        return data.publicUrl;
      },
    };

    /* ── View names → div IDs ── */
    const VIEW_MAP = {
      'auth':              'view-auth',
      'admin-products':    'view-admin-products',
      'buyer-catalogue':   'view-catalogue',
      'checkout':          'view-checkout',
      'supplier-portal':   'view-supplier',
      'commission-tracker':'view-commission',
      'admin-orders':      'view-admin-orders',
      'admin-suppliers':   'view-admin-suppliers',
      'admin-buyers':      'view-admin-buyers',
      'admin-analytics':   'view-admin-analytics',
      'admin-payouts':     'view-admin-payouts',
      'admin-riders':      'view-admin-riders',
      'admin-export':      'view-admin-export',
      'rider-portal':      'view-rider-portal',
    };

    /* ── Router ── */
    window.slShowView = function(viewName) {
      Object.values(VIEW_MAP).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
      });
      const targetId = VIEW_MAP[viewName];
      if (!targetId) { console.warn('Unknown view:', viewName); return; }
      const target = document.getElementById(targetId);
      if (target) target.classList.add('active');
      /* Run the block's init/refresh callback if registered */
      if (_initRegistry[viewName]) _initRegistry[viewName]();
    };

    /* ── Back to Admin Dashboard ── */
    window.goToAdminDash = function() {
      /* 1. Hide every top-level view */
      document.querySelectorAll('.sl-view').forEach(function(v) { v.classList.remove('active'); });
      /* 2. Show view-auth */
      var authView = document.getElementById('view-auth');
      if (authView) authView.classList.add('active');
      /* 3. Hide every screen inside view-auth, then activate only admin dashboard */
      document.querySelectorAll('#view-auth .screen').forEach(function(s) { s.classList.remove('active'); });
      var admScreen = document.getElementById('screen-dash-admin');
      if (admScreen) admScreen.classList.add('active');
      /* 3b. Refresh live digest/user stats */
      if (typeof window.renderAdminUsersList === 'function') { try { window.renderAdminUsersList(); } catch(e) {} }
      if (typeof window.renderAdminDigest === 'function') { try { window.renderAdminDigest(); } catch(e) {} }
      /* 4. Scroll to top */
      window.scrollTo(0, 0);
    };

    /* ── Topbar update ──
       Every role now gets identity/sync/logout from its own screen (the
       dashboard header for Admin/Supplier/Buyer, or the catalogue nav's
       profile panel for buyers deeper in the app) — and every admin
       sub-view has a "back to dashboard" button leading to one. So the
       universal green bar was duplicating a header that already exists
       on every screen, which is exactly what caused the doubled-up,
       crowded header on mobile. It now stays hidden for all roles. ── */
    window.slUpdateTopbar = function() {
      const u = window.SL.currentUser();
      const bar = document.getElementById('sl-topbar');
      if (!bar) return;
      bar.classList.remove('visible');
      const pill = document.getElementById('sl-sync-status');
      const st = sessionStorage.getItem('sl_sync_status');
      const pendingCount = (typeof window.SL_getPendingSyncCount === 'function') ? window.SL_getPendingSyncCount() : 0;
      let syncText = '⏳ connecting…';
      if (pendingCount > 0) syncText = '🔄 syncing ' + pendingCount + '…';
      else if (st === 'ok') syncText = '☁️ synced';
      else if (st === 'offline') syncText = '📴 local only';
      if (pill) {
        pill.classList.remove('sl-sync-ok', 'sl-sync-offline', 'sl-sync-pending');
        if (pendingCount > 0) pill.classList.add('sl-sync-pending');
        else if (st === 'ok') pill.classList.add('sl-sync-ok');
        else if (st === 'offline') pill.classList.add('sl-sync-offline');
        pill.textContent = syncText;
      }
      const profileDot = document.getElementById('slProfileSyncDot');
      if (profileDot) profileDot.textContent = syncText;
    };

    /* ── Global logout ── */
    window.slLogout = function() {
      if (typeof window.slCloseAllOverlays === 'function') window.slCloseAllOverlays();
      window.SL.clearSession();
      window.slShowView('auth');
      window.slUpdateTopbar();
    };

    /* ── ADMIN: Refunds review panel ── */
    window.closeAdminRefundsPanel = function() {
      const el = document.getElementById('slAdminRefundsPanel');
      if (el) el.remove();
      window.slPopOverlay();
    };

    window.showAdminRefundsPanel = function() {
      const alreadyOpen = !!document.getElementById('slAdminRefundsPanel');
      const existing = document.getElementById('slAdminRefundsPanel');
      if (existing) existing.remove();

      const refunds = window.SL.getRefunds() || [];
      const orders = window.SL.getOrders() || [];
      const sorted = refunds.slice().sort((a, b) => {
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (a.status !== 'pending' && b.status === 'pending') return 1;
        return (b.createdAt || 0) - (a.createdAt || 0);
      });

      const STATUS_COLOR = { pending: '#F59E0B', approved: '#1a472a', rejected: '#c0392b' };

      const rowsHTML = sorted.length ? sorted.map(r => {
        const order = orders.find(o => o.id === r.orderId);
        const color = STATUS_COLOR[r.status];
        const scopeLabel = r.wholeOrder ? 'Whole order' : (r.items || []).map(it => `${it.qty}× ${it.productName}`).join(', ');
        const photoHTML = r.photo ? `<img src="${r.photo}" style="max-width:120px;border-radius:8px;margin-top:8px;display:block;">` : '';
        const actionsHTML = r.status === 'pending' ? `
          <div style="display:flex;gap:8px;margin-top:10px;">
            <button style="flex:1;background:#1a472a;color:#fff;border:none;padding:9px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;" onclick="window.__admApproveRefund('${r.id}')">✓ Approve</button>
            <button style="flex:1;background:#f1f3f5;color:#333;border:none;padding:9px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;" onclick="window.__admRejectRefund('${r.id}')">✕ Reject</button>
          </div>` : `<div style="margin-top:8px;font-size:12px;color:${color};font-weight:700;">
            ${r.status === 'approved' ? '✓ Approved' : '✕ Rejected'}${r.adminNote ? ' — ' + r.adminNote : ''}
            ${r.method ? ' · ' + (r.method === 'wallet' ? 'Wallet credit' : 'MoMo reversal') : ''}
          </div>`;

        return `
          <div style="background:#fff;border-radius:12px;padding:14px;margin-bottom:10px;box-shadow:0 1px 4px rgba(0,0,0,.06);">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <strong style="font-size:14px;">${r.orderId}</strong>
              <span style="font-size:12px;font-weight:700;color:${color};">${r.status.toUpperCase()}</span>
            </div>
            <div style="font-size:12px;color:#777;margin-top:4px;">${r.buyerName || 'Buyer'} · ${new Date(r.createdAt).toLocaleString('en-GH')}</div>
            <div style="font-size:13px;margin-top:8px;"><strong>${r.reasonLabel}</strong></div>
            <div style="font-size:12px;color:#555;margin-top:2px;">${scopeLabel}</div>
            ${r.note ? `<div style="font-size:13px;color:#333;margin-top:6px;background:#f9f9f7;padding:8px;border-radius:8px;">${r.note}</div>` : ''}
            ${photoHTML}
            <div style="font-size:13px;font-weight:700;margin-top:8px;">Amount requested: GH₵ ${(r.amountRequested || 0).toFixed(2)}</div>
            ${order && order.deliveredAt ? `<div style="font-size:11px;color:#999;margin-top:2px;">Delivered: ${new Date(order.deliveredAt).toLocaleString('en-GH')}</div>` : ''}
            ${actionsHTML}
          </div>`;
      }).join('') : `
        <div class="empty-state" style="padding:40px 20px;text-align:center;">
          <div class="emoji" style="font-size:40px;margin-bottom:10px;">↩️</div>
          <h3 style="font-size:15px;margin-bottom:6px;">No refund requests</h3>
          <p style="font-size:13px;color:#777;">Buyer refund/issue reports will show up here.</p>
        </div>`;

      const panel = document.createElement('div');
      panel.id = 'slAdminRefundsPanel';
      panel.style.cssText = 'position:fixed;inset:0;z-index:2000;background:#f5f7f5;overflow-y:auto;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
      panel.innerHTML = `
        <div style="background:#1A4731;color:#fff;padding:16px 20px;display:flex;align-items:center;gap:12px;position:sticky;top:0;">
          <button style="background:rgba(255,255,255,.15);border:none;color:#fff;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:14px;" onclick="window.closeAdminRefundsPanel()">← Back</button>
          <div style="font-size:18px;font-weight:700;">Refund Requests</div>
        </div>
        <div style="padding:20px;max-width:560px;margin:0 auto;">${rowsHTML}</div>`;
      document.body.appendChild(panel);
      if (!alreadyOpen) window.slPushOverlay(window.closeAdminRefundsPanel);
    };

    window.__admApproveRefund = function(id) {
      const refund = (window.SL.getRefunds() || []).find(r => r.id === id);
      if (!refund) return;
      const method = confirm(
        'Approve GH₵' + (refund.amountRequested || 0).toFixed(2) + ' refund for ' + refund.orderId + '?\n\n' +
        'Click OK to credit SupplyLink Wallet (instant), or Cancel to record it as a MoMo reversal instead.'
      ) ? 'wallet' : 'momo_reversal';

      if (method === 'wallet') {
        window.SL.adjustWallet(refund.buyerId, refund.amountRequested || 0);
      }
      window.SL.resolveRefund(id, { status: 'approved', method });

      window.SL.addNotification({
        userId: refund.buyerId,
        message: `Your refund request for order ${refund.orderId} was approved — GH₵${(refund.amountRequested||0).toFixed(2)} ${method === 'wallet' ? 'has been credited to your SupplyLink Wallet.' : 'will be sent to your MoMo shortly.'}`,
        orderId: refund.orderId,
        type: 'refund'
      });

      if (typeof window.logAdminAction === 'function') {
        window.logAdminAction('Approved refund', `Order ${refund.orderId} — GH₵${(refund.amountRequested||0).toFixed(2)} via ${method === 'wallet' ? 'wallet credit' : 'MoMo reversal'}`);
      }
      window.showAdminRefundsPanel();
      if (typeof window.renderAdminUsersList === 'function') { try { window.renderAdminUsersList(); } catch(e) {} }
    };

    window.__admRejectRefund = function(id) {
      const refund = (window.SL.getRefunds() || []).find(r => r.id === id);
      if (!refund) return;
      const note = prompt('Reason for declining this refund (shown to the buyer):', '');
      if (note === null) return; // cancelled
      window.SL.resolveRefund(id, { status: 'rejected', adminNote: note.trim() });
      if (typeof window.logAdminAction === 'function') {
        window.logAdminAction('Rejected refund', `Order ${refund.orderId}${note.trim() ? ' — ' + note.trim() : ''}`);
      }

      window.SL.addNotification({
        userId: refund.buyerId,
        message: `Your refund request for order ${refund.orderId} was declined.${note ? ' Reason: ' + note.trim() : ''}`,
        orderId: refund.orderId,
        type: 'refund'
      });

      window.showAdminRefundsPanel();
      if (typeof window.renderAdminUsersList === 'function') { try { window.renderAdminUsersList(); } catch(e) {} }
    };

    /* ── WAYBILL / PACKING SLIP ──
       Printable summary of what's in the package, who it's for, and where it's
       going — shown to admin/supplier during preparation so the right order
       reaches the right buyer. Callable from any view (Admin Orders, Supplier
       Fulfillments) since it only depends on window.SL. ── */
    window.closeWaybillPanel = function() {
      const el = document.getElementById('slWaybillPanel');
      if (el) el.remove();
      window.slPopOverlay();
    };

    window.showWaybill = function(orderId) {
      const order = (window.SL.getOrders() || []).find(o => o.id === orderId);
      if (!order) return;
      const existing = document.getElementById('slWaybillPanel');
      if (existing) existing.remove();

      /* ── Privacy: suppliers see a stripped-down waybill (v11.106) ──
         Suppliers need to know WHAT to prepare and that it's confirmed
         for pickup — not WHO it's going to, WHERE, or WHAT it's worth.
         Full buyer contact/address and order value stay visible only to
         admin and riders, who actually need them to complete delivery. */
      const currentUser = window.SL.currentUser ? window.SL.currentUser() : null;
      const isSupplierView = !!(currentUser && currentUser.role === 'supplier');

      const products = window.SL.getProducts() || [];
      const hasFarmItems = (order.supplierBreakdown || []).some(sb => sb.tier === 'farm');

      const itemsHTML = (order.items || []).map(it => {
        const prod = products.find(p => p.id === it.productId);
        return `
          <tr>
            <td style="padding:8px 6px;border-bottom:1px solid #eee;">${it.productName}</td>
            <td style="padding:8px 6px;border-bottom:1px solid #eee;text-align:center;">${it.qty}</td>
            <td style="padding:8px 6px;border-bottom:1px solid #eee;">${prod ? prod.unit : ''}</td>
            <td style="padding:8px 6px;border-bottom:1px solid #eee;">${it.supplierName || (order.supplierBreakdown.find(sb=>sb.supplierId===it.supplierId)||{}).supplierName || '—'}</td>
          </tr>`;
      }).join('');

      const deliverToHTML = isSupplierView
        ? `
            <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Pickup</div>
            <div style="border:1px solid #eee;border-radius:10px;padding:12px 14px;margin-bottom:16px;background:#f9fafb;">
              <div style="font-size:13px;color:#555;">🔒 Delivery is handled by SupplyLink — buyer contact and address aren't shown here.</div>
              <div style="font-size:13px;color:#555;margin-top:6px;">A rider will collect this once it's marked ready for pickup.</div>
            </div>`
        : `
            <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Deliver To</div>
            <div style="border:1px solid #eee;border-radius:10px;padding:12px 14px;margin-bottom:16px;">
              <div style="font-size:15px;font-weight:700;">${order.buyerName || 'Buyer'}</div>
              <div style="font-size:13px;color:#555;margin-top:2px;">📞 ${order.buyerPhone || '—'}</div>
              <div style="font-size:13px;color:#555;margin-top:2px;">📍 ${order.address === 'In-person pickup' ? 'In-person pickup' : (order.address || '—')}${order.zone ? ' · ' + order.zone : ''}</div>
              ${order.slot ? `<div style="font-size:13px;color:#555;margin-top:2px;">⏰ ${order.slot}</div>` : ''}
              ${order.note ? `<div style="font-size:12px;color:#777;margin-top:6px;font-style:italic;">Note: "${order.note}"</div>` : ''}
            </div>`;

      const totalHTML = isSupplierView
        ? `<div style="font-size:12px;color:#888;padding-top:10px;border-top:1px solid #eee;">🔒 Order value isn't shown to suppliers.</div>`
        : `
            <div style="display:flex;justify-content:space-between;padding-top:10px;border-top:1px solid #eee;font-size:14px;font-weight:700;">
              <span>Total</span>
              <span>GH₵ ${(order.total || 0).toFixed(2)}</span>
            </div>
            <div style="font-size:12px;color:#777;margin-top:4px;">${order.payment === 'momo' ? '📱 Paid via MoMo' : '💵 Pay on Delivery'}</div>`;

      const panel = document.createElement('div');
      panel.id = 'slWaybillPanel';
      panel.style.cssText = 'position:fixed;inset:0;z-index:4000;background:rgba(0,0,0,.55);display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto;';
      panel.innerHTML = `
        <style>
          @media print {
            body * { visibility:hidden; }
            #slWaybillPanel, #slWaybillPanel * { visibility:visible; }
            #slWaybillPanel { position:absolute; inset:0; background:#fff !important; padding:0 !important; }
            #slWaybillDoc { box-shadow:none !important; }
            .slWaybillNoPrint { display:none !important; }
          }
        </style>
        <div id="slWaybillDoc" style="background:#fff;border-radius:12px;max-width:520px;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;overflow:hidden;">
          <div style="background:#1A4731;color:#fff;padding:18px 22px;">
            <div style="font-size:18px;font-weight:700;">SupplyLink Market</div>
            <div style="font-size:13px;opacity:.85;">Delivery Waybill</div>
          </div>
          <div style="padding:22px;">
            <div style="display:flex;justify-content:space-between;align-items:center;background:#f5f7f5;border-radius:10px;padding:12px 14px;margin-bottom:16px;">
              <div>
                <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;">Transaction ID</div>
                <div style="font-size:16px;font-weight:700;font-family:monospace;">${order.id}</div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;">Order Date</div>
                <div style="font-size:13px;font-weight:600;">${new Date(order.createdAt || Date.now()).toLocaleDateString('en-GH',{day:'numeric',month:'short',year:'numeric'})}</div>
              </div>
            </div>

            ${deliverToHTML}

            <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Package Contents</div>
            <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:10px;">
              <thead>
                <tr style="background:#f5f7f5;">
                  <th style="text-align:left;padding:8px 6px;">Item</th>
                  <th style="text-align:center;padding:8px 6px;">Qty</th>
                  <th style="text-align:left;padding:8px 6px;">Unit</th>
                  <th style="text-align:left;padding:8px 6px;">Supplier</th>
                </tr>
              </thead>
              <tbody>${itemsHTML}</tbody>
            </table>

            ${hasFarmItems ? '<div style="background:#FEF3DC;border:1px solid #F4A623;border-radius:8px;padding:10px 12px;font-size:12px;color:#7a4f00;margin-bottom:16px;">🌾 Contains farm-fresh produce — handle with care.</div>' : ''}

            ${totalHTML}

            <div class="slWaybillNoPrint" style="display:flex;gap:10px;margin-top:20px;">
              <button style="flex:1;background:#f1f3f5;color:#333;border:none;padding:12px;border-radius:10px;font-weight:700;cursor:pointer;" onclick="window.closeWaybillPanel()">Close</button>
              <button style="flex:1;background:#1A4731;color:#fff;border:none;padding:12px;border-radius:10px;font-weight:700;cursor:pointer;" onclick="window.print()">🖨️ Print Waybill</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(panel);
      window.slPushOverlay(window.closeWaybillPanel);
    };

    /* ── Init topbar on page load ── */
    document.addEventListener('DOMContentLoaded', function() {
      window.slUpdateTopbar();
      /* If already logged in, route to correct dashboard */
      const u = window.SL.currentUser();
      if (u) {
        if (u.role === 'admin') {
          // Show admin hub — screen-dash-admin lives inside view-auth
          window.slShowView('auth');
          const admScreen = document.getElementById('screen-dash-admin');
          if (admScreen) {
            document.querySelectorAll('#view-auth .screen').forEach(s => s.classList.remove('active'));
            admScreen.classList.add('active');
          }
        } else if (u.role === 'supplier') {
          window.slShowView('supplier-portal');
        } else if (u.role === 'rider') {
          window.slShowView('rider-portal');
        } else {
          window.slShowView('buyer-catalogue');
        }
      }
    });
  })();
  