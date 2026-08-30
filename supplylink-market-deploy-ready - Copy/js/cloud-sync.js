
  (function() {
    'use strict';

    var SUPABASE_URL = 'https://fgmlwopvbdzgjclyekmd.supabase.co';
    var SUPABASE_KEY = 'sb_publishable_4PtZ7MRzxpan9WaBke32jA_CyS4wQnn';
    var TABLES = {
      sl_users:    'users',
      sl_products: 'products',
      sl_orders:   'orders',
      sl_sms_log:  'sms_log',
      sl_reviews:  'reviews',
      sl_messages: 'messages',
      sl_rider_shifts:   'rider_shifts',
      sl_remit_requests: 'remit_requests',
      sl_settings:       'settings',
      sl_cash_remit:     'cash_remit',
      sl_payouts:        'payouts',
      sl_refunds:        'refunds'
    };

    /* Exact columns that exist in each Supabase table right now. Any other
       keys on a local object (app-only fields not yet given a column) are
       stripped before upserting, so a stray field never breaks the sync
       for an entire table's worth of rows. */
    var TABLE_COLUMNS = {
      users:    ['id','name','phone','email','password_hash','password_salt','role','status','buyerType','bizType','location','momo','address','bizName','createdAt','likedItems','addresses'],
      products: ['id','name','category','unit','weightKg','description','supplierPrice','buyerPrice','stockQty','supplierId','supplierName','isAvailable','createdAt','images','sourceType','deleted','lowStockSince'],
      orders:   ['id','buyerId','buyerName','buyerPhone','address','note','zone','deliveryFee','slot','payment','items','subtotal','total','status','createdAt','assignedSupplierId','assignedSupplier','autoAssigned','supplierBreakdown','supplierNote','riderId','riderName','outAt','deliveredAt','deliveryProof','deliveryIssue'],
      sms_log:  ['id','to','message','event','orderId','sentAt','status'],
      reviews:  ['id','orderId','supplierId','buyerId','rating','comment','createdAt'],
      messages: ['id','senderId','senderName','recipientId','message','createdAt','read'],
      rider_shifts:   ['id','riderId','startedAt','endedAt'],
      remit_requests: ['id','riderId','riderName','amount','note','status','requestedAt','resolvedAt'],
      settings:       ['id','riderRatePerDelivery'],
      cash_remit:     ['id','riderId','amount','note','recordedAt'],
      payouts:        ['id','status','paidAt','method','provider','transferReference','errorReason','initiatedAt','failedAt'],
      refunds:        ['id','orderId','buyerId','buyerName','reason','reasonLabel','note','photo','wholeOrder','items','amountRequested','supplierAmounts','status','method','adminNote','createdAt','resolvedAt']
    };

    function pickColumns(row, table) {
      var cols = TABLE_COLUMNS[table];
      if (!cols) return row;
      var out = {};
      cols.forEach(function(c) { if (row[c] !== undefined) out[c] = row[c]; });
      return out;
    }

    var sb = null;
    try {
      if (window.supabase && window.supabase.createClient) {
        sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      }
    } catch (e) { console.warn('Supabase init failed:', e); }
    if (!sb) setSyncStatus('offline');
    window.SL_sb = sb;

    function hideOverlay() {
      var el = document.getElementById('sl-cloud-overlay');
      if (el) el.style.display = 'none';
    }

    function setSyncStatus(status) {
      sessionStorage.setItem('sl_sync_status', status);
      if (typeof window.slUpdateTopbar === 'function') {
        try { window.slUpdateTopbar(); } catch (e) {}
      }
    }

    /* ── Pending-sync tracker (v11.94) ──
       Registration/orders/reviews save to localStorage instantly, then try
       to push to Supabase in the background. If that push fails (dropped
       wifi, tab closed early, project briefly idle), the old code left no
       record that anything was unconfirmed — and the next hydrate/poll
       would then overwrite localStorage with cloud data, silently erasing
       the never-synced rows for good. This tracker remembers, per table,
       which row ids are still unconfirmed, so:
         1. hydrate()/pollCloud() can preserve those rows instead of wiping
            them when they pull cloud data down, and
         2. a retry loop can keep re-attempting the push until it succeeds.
       Stored under its own key (not in TABLES), so it's plain local state
       and never itself gets pushed to Supabase. */
    var PENDING_KEY = 'sl_pending_sync';
    function getPendingMap() {
      try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '{}') || {}; }
      catch (e) { return {}; }
    }
    function savePendingMap(map) {
      try { _origSetItem(PENDING_KEY, JSON.stringify(map)); } catch (e) {}
    }
    function markPending(lsKey, ids) {
      if (!ids.length) return;
      var map = getPendingMap();
      map[lsKey] = map[lsKey] || {};
      ids.forEach(function(id) { map[lsKey][id] = true; });
      savePendingMap(map);
      updatePendingStatus();
    }
    function clearPending(lsKey, ids) {
      var map = getPendingMap();
      if (!map[lsKey]) return;
      ids.forEach(function(id) { delete map[lsKey][id]; });
      if (Object.keys(map[lsKey]).length === 0) delete map[lsKey];
      savePendingMap(map);
      updatePendingStatus();
    }
    function getPendingIds(lsKey) {
      var map = getPendingMap();
      return map[lsKey] ? Object.keys(map[lsKey]) : [];
    }
    function totalPendingCount() {
      var map = getPendingMap();
      var n = 0;
      Object.keys(map).forEach(function(k) { n += Object.keys(map[k]).length; });
      return n;
    }
    function updatePendingStatus() {
      if (typeof window.slUpdateTopbar === 'function') {
        try { window.slUpdateTopbar(); } catch (e) {}
      }
    }
    window.SL_getPendingSyncCount = totalPendingCount;

    /* ── Patch localStorage.setItem so every existing write in the
       app (via window.SL.* or direct localStorage calls) also syncs
       to Supabase, with zero changes needed elsewhere in the file. ── */
    var _origSetItem = localStorage.setItem.bind(localStorage);
    var _origRemoveItem = localStorage.removeItem.bind(localStorage);

    function pushToCloud(lsKey, jsonValue) {
      if (!sb) return;
      var table = TABLES[lsKey];
      if (!table) return;
      var rows;
      try { rows = JSON.parse(jsonValue); } catch (e) { return; }
      if (!Array.isArray(rows)) return;

      var cleanRows = rows.map(function(r) { return pickColumns(r, table); });

      /* Defensive dedupe (v11.93): if two rows in this batch ever share
         the same id — e.g. a future bug reintroduces the kind of
         same-millisecond ID collision that broke sms_log — Postgres's
         "ON CONFLICT DO UPDATE" rejects the *entire* batch with
         "cannot affect row a second time". Rather than let one bad
         duplicate take down the whole sync, we dedupe by id here,
         keeping the last (most recent) copy of each. The real fix is
         generating collision-proof ids in the first place (done above
         for sms/reviews/etc.), but this keeps one future slip-up from
         becoming a full sync outage again. */
      var seenIds = {};
      var dedupedRows = [];
      for (var i = cleanRows.length - 1; i >= 0; i--) {
        var rid = cleanRows[i] && cleanRows[i].id;
        if (rid == null || seenIds[rid]) continue;
        seenIds[rid] = true;
        dedupedRows.unshift(cleanRows[i]);
      }
      cleanRows = dedupedRows;

      /* Upsert-only. We deliberately do NOT delete cloud rows that are
         "missing" from this local array — a local array can be briefly
         incomplete for harmless reasons (demo-seed running before the
         cloud pull finishes, a device that's never seen every record,
         etc.), and diffing against it to delete cloud rows turned a
         harmless timing quirk into permanent data loss. Real deletions
         are instead pushed explicitly, at the exact place in the app
         where something is actually deleted (see deleteFromCloud below). */
      if (cleanRows.length > 0) {
        var rowIds = cleanRows.map(function(r) { return r.id; }).filter(function(id) { return id != null; });
        markPending(lsKey, rowIds);
        sb.from(table).upsert(cleanRows, { onConflict: 'id' }).then(function(res) {
          if (res.error) {
            console.warn('Supabase upsert (' + table + ') failed:', res.error.message);
            /* Leave these ids marked pending — retrySyncPending() will keep
               re-attempting them, and hydrate()/pollCloud() will now know
               not to wipe them out with cloud data in the meantime. */
            if (!window.__slCloudSyncWarningShown) {
              window.__slCloudSyncWarningShown = true;
              var msg = res.error.message || '';
              var isNetworkIssue = /fetch|network|timeout/i.test(msg);
              var likelyCause = isNetworkIssue
                ? 'This looks like a connectivity blip (WiFi dropped, or the Supabase project may have gone idle) rather than a data problem — your local data is fine, and the app will keep retrying automatically until it goes through.'
                : 'This usually means the Supabase table is missing a column the app just tried to send.';
              alert('⚠️ Cloud sync failed for "' + table + '":\n\n' + msg +
                    '\n\n' + likelyCause +
                    '\n\nThis device\'s local data is fine and will keep trying to sync in the background — you don\'t need to redo anything. Please screenshot this if it keeps happening.');
            }
          } else {
            /* Confirmed in the cloud — safe to stop treating these as at-risk. */
            clearPending(lsKey, rowIds);
          }
        });
      }
    }

    /* ── Retry loop for anything still unconfirmed ──
       Re-pushes, per table, only the local rows whose ids are still
       marked pending — so a blip earlier in the session keeps getting
       retried until Supabase actually confirms it, instead of silently
       staying stuck on one device forever. */
    function retrySyncPending() {
      if (!sb) return;
      Object.keys(TABLES).forEach(function(lsKey) {
        var pendingIds = getPendingIds(lsKey);
        if (!pendingIds.length) return;
        var raw = localStorage.getItem(lsKey);
        if (!raw) return;
        var rows;
        try { rows = JSON.parse(raw); } catch (e) { return; }
        if (!Array.isArray(rows)) return;
        var pendingSet = {};
        pendingIds.forEach(function(id) { pendingSet[id] = true; });
        var rowsToRetry = rows.filter(function(r) { return r && pendingSet[r.id]; });
        if (rowsToRetry.length) pushToCloud(lsKey, JSON.stringify(rowsToRetry));
      });
    }
    window.SL_retrySyncPending = retrySyncPending;
    window.addEventListener('online', retrySyncPending);

    /* Explicit, precise deletion — call this at the exact moment the app
       deletes something locally, instead of inferring deletions by diffing
       arrays (which is what caused the data-loss bug above). */
    function deleteFromCloud(lsKey, id) {
      if (!sb || !id) return;
      var table = TABLES[lsKey];
      if (!table) return;
      sb.from(table).delete().eq('id', id).then(function(res) {
        if (res.error) console.warn('Supabase delete (' + table + ' ' + id + ') failed:', res.error.message);
      });
    }
    window.SL_deleteFromCloud = deleteFromCloud;

    localStorage.setItem = function(key, value) {
      _origSetItem(key, value);
      if (TABLES[key]) pushToCloud(key, value);
    };
    localStorage.removeItem = function(key) {
      _origRemoveItem(key);
      if (TABLES[key]) pushToCloud(key, '[]');
    };

    /* ── One-time-per-tab-session hydrate from Supabase ── */
    function hydrate() {
      if (!sb) { hideOverlay(); return; }
      var pulls = Object.keys(TABLES).map(function(lsKey) {
        var table = TABLES[lsKey];
        var q = sb.from(table).select(pullSelectString(table));
        return q.then(function(res) { return { lsKey: lsKey, res: res }; });
      });

      Promise.all(pulls).then(function(results) {
        var anyOk = false;
        results.forEach(function(r) {
          if (r.res.error) {
            console.warn('Supabase load (' + r.lsKey + ') failed:', r.res.error.message);
            return;
          }
          anyOk = true;
          var cloudRows = r.res.data || [];
          if (cloudRows.length > 0) {
            // Cloud is the source of truth — EXCEPT for any row still marked
            // pending (i.e. this device has a local write that never got
            // confirmed in Supabase). Those are merged in rather than wiped,
            // so a mid-registration connectivity blip can no longer silently
            // erase someone's account or review the next time this device
            // reconnects. retrySyncPending() will keep trying to push them.
            //
            // This has to cover two different cases: a pending row that's
            // brand new (not in cloudRows at all yet — e.g. a fresh
            // registration) AND a pending UPDATE to a row that already
            // exists in the cloud (e.g. a supplier marking an existing
            // order's items "prepared" — the order id is already in
            // cloudRows, just with the old data). The first version of this
            // only handled the brand-new case, so in-flight updates to
            // existing rows kept losing to the stale cloud copy on every
            // poll — exactly the "prepared items un-mark themselves after a
            // few seconds" bug reported in testing.
            var pendingIds = getPendingIds(r.lsKey);
            var merged = cloudRows;
            if (pendingIds.length) {
              var pendingSet = {};
              pendingIds.forEach(function(id) { pendingSet[id] = true; });
              var local = [];
              try { local = JSON.parse(localStorage.getItem(r.lsKey) || '[]'); } catch (e) {}
              var localById = {};
              local.forEach(function(row) { if (row && row.id != null) localById[row.id] = row; });
              // Swap in the local pending version for any cloud row that's
              // still awaiting confirmation of a local update.
              merged = cloudRows.map(function(row) {
                return (row && pendingSet[row.id] && localById[row.id]) ? localById[row.id] : row;
              });
              // Plus any pending rows the cloud doesn't have at all yet.
              var cloudIds = {};
              cloudRows.forEach(function(row) { if (row && row.id != null) cloudIds[row.id] = true; });
              var newLocalOnly = local.filter(function(row) { return row && pendingSet[row.id] && !cloudIds[row.id]; });
              if (newLocalOnly.length) merged = merged.concat(newLocalOnly);
            }
            _origSetItem(r.lsKey, JSON.stringify(merged));
          } else {
            // Cloud table is empty (first ever run) → seed it from whatever's local/demo
            var local2 = localStorage.getItem(r.lsKey);
            if (local2) pushToCloud(r.lsKey, local2);
          }
        });
        setSyncStatus(anyOk ? 'ok' : 'offline');
        sessionStorage.setItem('sl_hydrated', '1');
        hideOverlay();
        retrySyncPending();
        // Reload once so every block's top-level localStorage reads see fresh data
        if (!sessionStorage.getItem('sl_reloaded')) {
          sessionStorage.setItem('sl_reloaded', '1');
          location.reload();
        }
      }).catch(function(e) {
        console.warn('Supabase hydrate failed, using local data:', e);
        setSyncStatus('offline');
        hideOverlay();
      });
    }

    if (sessionStorage.getItem('sl_hydrated')) {
      // Already synced once this tab session — boot immediately
      hideOverlay();
    } else {
      hydrate();
    }

    /* ── Live-ish refresh for tabs left open (e.g. admin dashboard) ──
       Every 20s, quietly re-pull all 4 tables from Supabase straight
       into localStorage (bypassing the upsert patch, since we're just
       reading), then re-run whichever render functions are currently
       exposed on window so an already-open screen (new order arriving
       while admin has the tab open, etc.) updates without a manual
       reload. Missing render functions are skipped silently — this is
       best-effort freshness, not required for the app to work. ── */
    var REFRESH_FNS = ['admRender', 'admSupRender', 'admBuyRender', 'admPayRender',
                        'renderAdminUsersList', 'renderAdminDigest', 'renderProductList',
                        'refreshMessagesBadge', 'refreshSupplierRequestBadges'];
    function refreshVisibleScreens() {
      REFRESH_FNS.forEach(function(fn) {
        if (typeof window[fn] === 'function') {
          try { window[fn](); } catch (e) {}
        }
      });
    }
    function pullSelectString(table) {
      // The users table's password_hash/password_salt columns are intentionally
      // locked down at the DB level (see login RPC below) — the client should
      // never pull them back down, even though it's allowed to write them once
      // at registration.
      if (table === 'users') {
        return TABLE_COLUMNS.users.filter(function(c) {
          return c !== 'password_hash' && c !== 'password_salt';
        }).join(',');
      }
      return '*';
    }
    function pollCloud() {
      if (!sb) return;
      var pulls = Object.keys(TABLES).map(function(lsKey) {
        var table = TABLES[lsKey];
        return sb.from(table).select(pullSelectString(table)).then(function(res) { return { lsKey: lsKey, res: res }; });
      });
      Promise.all(pulls).then(function(results) {
        results.forEach(function(r) {
          if (r.res.error) return;
          var cloudRows = r.res.data || [];
          var pendingIds = getPendingIds(r.lsKey);
          var merged = cloudRows;
          if (pendingIds.length) {
            var pendingSet = {};
            pendingIds.forEach(function(id) { pendingSet[id] = true; });
            var local = [];
            try { local = JSON.parse(localStorage.getItem(r.lsKey) || '[]'); } catch (e) {}
            var localById = {};
            local.forEach(function(row) { if (row && row.id != null) localById[row.id] = row; });
            // Swap in the local pending version for any cloud row still
            // awaiting confirmation of a local update (not just rows the
            // cloud doesn't have yet at all) — this is what was missing
            // before, and is what let a supplier's "prepared" flag on an
            // already-existing order get silently reverted by this exact
            // 20-second poll before the Supabase upsert had confirmed.
            merged = cloudRows.map(function(row) {
              return (row && pendingSet[row.id] && localById[row.id]) ? localById[row.id] : row;
            });
            var cloudIds = {};
            cloudRows.forEach(function(row) { if (row && row.id != null) cloudIds[row.id] = true; });
            var newLocalOnly = local.filter(function(row) { return row && pendingSet[row.id] && !cloudIds[row.id]; });
            if (newLocalOnly.length) merged = merged.concat(newLocalOnly);
          }
          _origSetItem(r.lsKey, JSON.stringify(merged));
        });
        refreshVisibleScreens();
        retrySyncPending();
      }).catch(function() { /* offline blip — try again next interval */ });
    }
    /* One-time catch-up (v11.91): reviews were only just added to cloud
       sync. Any review submitted before this fix is still sitting
       local-only on whatever device/browser rated that order — it never
       had a reason to push since 'sl_reviews' wasn't in TABLES yet. This
       pushes this device's current local reviews up once, so they finally
       reach the cloud (and therefore the admin dashboard) instead of
       being silently stuck. Guarded so it only fires once per device. */
    if (sb && !localStorage.getItem('sl_reviews_catchup_v1191')) {
      try {
        var localReviews = localStorage.getItem('sl_reviews');
        if (localReviews) pushToCloud('sl_reviews', localReviews);
      } catch (e) { /* nothing to catch up, or read failed — safe to skip */ }
      localStorage.setItem('sl_reviews_catchup_v1191', '1');
    }

    if (sb) setInterval(pollCloud, 20000);
    /* Belt-and-braces: retry pending pushes on their own short interval too,
       independent of pollCloud, so a device that's mid-registration doesn't
       have to wait a full 20s cycle before its first retry attempt. */
    if (sb) setInterval(retrySyncPending, 8000);
  })();
  