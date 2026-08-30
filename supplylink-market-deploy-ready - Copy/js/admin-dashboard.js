
  (function() {
    'use strict';
    
// ── DEMO USERS (pre-loaded) ──────────────────────────────
// Single source of truth lives in the SL shared-store block above,
// exposed as window.SL_DEMO_USERS — referenced here instead of a
// separate copy so the two can never drift out of sync again.
const DEMO_USERS = window.SL_DEMO_USERS;

// ── STATE ────────────────────────────────────────────────
let users = JSON.parse(localStorage.getItem('sl_users') || 'null') || [...DEMO_USERS];
let currentUser = JSON.parse(localStorage.getItem('sl_current') || 'null');
let selectedRegRole = null;
let selectedBuyerType = 'household';

function saveUsers() { localStorage.setItem('sl_users', JSON.stringify(users)); }
function saveSession() { localStorage.setItem('sl_current', JSON.stringify(currentUser)); }
function clearSession() { localStorage.removeItem('sl_current'); currentUser = null; }

// ── SCREEN NAVIGATION ────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('#view-auth .screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

// ── ROLE SELECTION (register) ────────────────────────────
function selectRegRole(role) {
  selectedRegRole = role;
  document.querySelectorAll('.role-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('role-' + role).classList.add('selected');
}

function proceedRegister() {
  const err = document.getElementById('reg-role-error');
  if (!selectedRegRole) {
    err.textContent = 'Please choose an account type to continue.';
    err.style.display = 'block'; return;
  }
  err.style.display = 'none';
  showScreen(selectedRegRole === 'supplier' ? 'screen-register-supplier' : 'screen-register-buyer');
}

// ── BUYER TYPE TOGGLE ────────────────────────────────────
function selectBuyerType(type) {
  selectedBuyerType = type;
  document.getElementById('at-household').classList.toggle('selected', type === 'household');
  document.getElementById('at-business').classList.toggle('selected', type === 'business');
  document.getElementById('buyer-biz-name-group').style.display = type === 'business' ? 'block' : 'none';
}

// ── REGISTER SUPPLIER ────────────────────────────────────
async function registerSupplier() {
  const name     = document.getElementById('supp-name').value.trim();
  const phone    = document.getElementById('supp-phone').value.trim();
  const bizType  = document.getElementById('supp-biz-type').value;
  const location = document.getElementById('supp-location').value.trim();
  const momo     = document.getElementById('supp-momo').value.trim();
  const email    = document.getElementById('supp-email').value.trim();
  const pass     = document.getElementById('supp-password').value;
  const pass2    = document.getElementById('supp-password2').value;
  const err      = document.getElementById('supp-reg-error');

  if (!name || !phone || !bizType || !location || !momo || !pass || !email) {
    return showErr(err, 'Please fill in all fields.');
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) return showErr(err, 'Please enter a valid email address.');
  if (pass !== pass2) return showErr(err, 'Passwords do not match.');
  if (pass.length < 6) return showErr(err, 'Password must be at least 6 characters.');
  users = window.SL.getUsers() || users;
  if (users.find(u => u.phone === phone)) return showErr(err, 'This phone number is already registered.');

  err.style.display = 'none';
  const salt = window.SL.genSalt();
  const hash = await window.SL.hashPassword(pass, salt);
  users.push({
    id: 'u' + Date.now(),
    name, phone, email: email || null, password_hash: hash, password_salt: salt,
    role: 'supplier',
    status: 'pending',
    bizType, location, momo,
    createdAt: Date.now()
  });
  saveUsers();
  showScreen('screen-pending');
}

// ── REGISTER BUYER ───────────────────────────────────────
async function registerBuyer() {
  const name    = document.getElementById('buyer-name').value.trim();
  const phone   = document.getElementById('buyer-phone').value.trim();
  const address = document.getElementById('buyer-address').value.trim();
  const email   = document.getElementById('buyer-email').value.trim();
  const pass    = document.getElementById('buyer-password').value;
  const pass2   = document.getElementById('buyer-password2').value;
  const bizName = document.getElementById('buyer-biz-name').value.trim();
  const refCodeInput = (document.getElementById('buyer-referral-code').value || '').trim().toUpperCase();
  const err     = document.getElementById('buyer-reg-error');

  if (!name || !phone || !address || !pass || !email) return showErr(err, 'Please fill in all fields.');
  if (!/^\S+@\S+\.\S+$/.test(email)) return showErr(err, 'Please enter a valid email address.');
  if (selectedBuyerType === 'business' && !bizName) return showErr(err, 'Please enter your business name.');
  if (pass !== pass2) return showErr(err, 'Passwords do not match.');
  if (pass.length < 6) return showErr(err, 'Password must be at least 6 characters.');
  users = window.SL.getUsers() || users;
  if (users.find(u => u.phone === phone)) return showErr(err, 'This phone number is already registered.');

  let referrer = null;
  if (refCodeInput) {
    referrer = users.find(u => u.referralCode === refCodeInput);
    if (!referrer) return showErr(err, 'That referral code was not found. Please check it, or leave the field blank.');
  }

  err.style.display = 'none';
  const salt = window.SL.genSalt();
  const hash = await window.SL.hashPassword(pass, salt);
  const newUser = {
    id: 'u' + Date.now(),
    name, phone, email: email || null, password_hash: hash, password_salt: salt,
    role: 'buyer',
    buyerType: selectedBuyerType,
    bizName: selectedBuyerType === 'business' ? bizName : null,
    status: 'active',
    address,
    referralCode: window.SL.generateReferralCode(name),
    walletBalance: referrer ? window.SL.REFERRAL_REWARD : 0,
    createdAt: Date.now()
  };
  users.push(newUser);
  saveUsers();

  if (referrer) {
    window.SL.addReferral({ referrerUserId: referrer.id, referredUserId: newUser.id });
  }

  currentUser = users[users.length - 1];
  saveSession();
  routeToDashboard();
}

// ── LOGIN ────────────────────────────────────────────────
async function doLogin() {
  const phone = document.getElementById('login-phone').value.trim();
  const pass  = document.getElementById('login-password').value;
  const err   = document.getElementById('login-error');

  if (!phone || !pass) return showErr(err, 'Please enter your phone number and password.');

  /* Re-read the freshest users list right before checking — the page-load
     snapshot can be stale if an account was added/approved elsewhere
     (another tab, another device) since this tab was opened. */
  users = window.SL.getUsers() || users;

  let user = null;

  if (window.SL_sb) {
    /* Verified server-side via a Postgres RPC (verify_login). The client no
       longer has read access to password_hash/password_salt at all — those
       columns are locked down at the DB level — so this is the real check. */
    try {
      const { data, error } = await window.SL_sb.rpc('verify_login', { p_phone: phone, p_password: pass });
      if (error) throw error;
      if (data && data.length > 0) user = data[0];
    } catch (e) {
      console.warn('Login RPC failed, falling back to local check:', e);
    }
  }

  if (!user) {
    /* Offline fallback — only succeeds for accounts whose password_hash is
       still sitting in this browser's local cache (demo accounts, or right
       after registering on this same device, before the next cloud poll). */
    const candidate = users.find(u => u.phone === phone);
    const enteredHash = candidate && candidate.password_salt
      ? await window.SL.hashPassword(pass, candidate.password_salt)
      : null;
    user = (candidate && enteredHash && candidate.password_hash === enteredHash) ? candidate : null;
  }

  if (!user) return showErr(err, 'Incorrect phone number or password. Please try again.');
  if (user.status === 'pending') return showErr(err, 'Your account is pending approval by SupplyLink GH. Please check back soon.');
  if (user.status === 'suspended') return showErr(err, 'Your account has been suspended. Contact SupplyLink GH.');



  err.style.display = 'none';
  currentUser = user;
  if (currentUser.role === 'buyer' && !currentUser.referralCode) {
    currentUser.referralCode = window.SL.generateReferralCode(currentUser.name);
    if (typeof currentUser.walletBalance !== 'number') currentUser.walletBalance = 0;
    const idx = users.findIndex(u => u.id === currentUser.id);
    if (idx !== -1) { users[idx] = currentUser; saveUsers(); }
  }
  saveSession();
  routeToDashboard();
}


// ── FORGOT PASSWORD ───────────────────────────────────────
// Two paths, decided per-account after entering a phone number:
//  (a) account has an email on file  → emailed 6-digit code, real
//      verification via the request-email-reset / verify-email-reset
//      Edge Functions.
//  (b) no email on file → falls back to the old phone-only reset
//      (reset_password RPC). This only verifies phone-number ownership,
//      not a secret, so it's a known, weaker trade-off — kept only as
//      a fallback for accounts that haven't added an email yet.
//  If the email Edge Functions aren't deployed/reachable, we also fall
//  back to (b) so this never blocks someone from getting back in.
function openForgotPassword() {
  document.getElementById('forgot-phone').value = document.getElementById('login-phone').value || '';
  document.getElementById('forgot-otp').value = '';
  document.getElementById('forgot-email-password').value = '';
  document.getElementById('forgot-email-password2').value = '';
  document.getElementById('forgot-password').value = '';
  document.getElementById('forgot-password2').value = '';
  ['forgot-phone-error','forgot-email-error','forgot-error'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  ['forgot-email-success','forgot-success'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  document.getElementById('forgot-step-phone').style.display = 'block';
  document.getElementById('forgot-continue-btn').style.display = 'block';
  document.getElementById('forgot-step-phone-link').style.display = 'block';
  document.getElementById('forgot-step-email').style.display = 'none';
  document.getElementById('forgot-email-submit-btn').style.display = 'none';
  document.getElementById('forgot-step-fallback').style.display = 'none';
  document.getElementById('forgot-submit-btn').style.display = 'none';
  document.getElementById('forgot-step2-link').style.display = 'none';
  showScreen('screen-forgot-password');
}

function goToFallbackStep() {
  document.getElementById('forgot-step-phone').style.display = 'none';
  document.getElementById('forgot-continue-btn').style.display = 'none';
  document.getElementById('forgot-step-phone-link').style.display = 'none';
  document.getElementById('forgot-step-email').style.display = 'none';
  document.getElementById('forgot-email-submit-btn').style.display = 'none';
  document.getElementById('forgot-step-fallback').style.display = 'block';
  document.getElementById('forgot-submit-btn').style.display = 'block';
  document.getElementById('forgot-step2-link').style.display = 'block';
}

async function checkForgotPhone() {
  const phone = document.getElementById('forgot-phone').value.trim();
  const err = document.getElementById('forgot-phone-error');
  const btn = document.getElementById('forgot-continue-btn');
  if (!phone) return showErr(err, 'Please enter your phone number.');
  err.style.display = 'none';

  if (!window.SL_sb) {
    // Offline — can't check anything either way, go straight to the fallback.
    return goToFallbackStep();
  }

  btn.disabled = true;
  btn.textContent = 'Checking...';
  try {
    const { data, error } = await window.SL_sb.functions.invoke('request-email-reset', { body: { phone } });
    if (error) throw error;

    if (data && data.hasEmail) {
      document.getElementById('forgot-step-phone').style.display = 'none';
      document.getElementById('forgot-continue-btn').style.display = 'none';
      document.getElementById('forgot-step-phone-link').style.display = 'none';
      document.getElementById('forgot-step-email').style.display = 'block';
      document.getElementById('forgot-email-submit-btn').style.display = 'block';
      document.getElementById('forgot-step2-link').style.display = 'block';
      document.getElementById('forgot-masked-email').textContent =
        'We sent a 6-digit code to ' + (data.maskedEmail || 'your email') + '. It expires in 10 minutes.';
    } else {
      goToFallbackStep();
    }
  } catch (e) {
    // Edge Function missing/unreachable — degrade gracefully rather than block login recovery.
    console.warn('request-email-reset failed, falling back to phone-only reset:', e);
    goToFallbackStep();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Continue';
  }
}

async function doEmailReset() {
  const phone = document.getElementById('forgot-phone').value.trim();
  const otp   = document.getElementById('forgot-otp').value.trim();
  const pass  = document.getElementById('forgot-email-password').value;
  const pass2 = document.getElementById('forgot-email-password2').value;
  const err   = document.getElementById('forgot-email-error');
  const ok    = document.getElementById('forgot-email-success');
  const btn   = document.getElementById('forgot-email-submit-btn');

  ok.style.display = 'none';
  if (!otp || !pass) return showErr(err, 'Please enter the code and a new password.');
  if (pass.length < 6) return showErr(err, 'Password must be at least 6 characters.');
  if (pass !== pass2) return showErr(err, 'Passwords do not match.');

  err.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Resetting...';

  try {
    const { data, error } = await window.SL_sb.functions.invoke('verify-email-reset', {
      body: { phone, otp, newPassword: pass }
    });
    if (error) throw error;

    if (data && data.success) {
      ok.textContent = 'Password reset! You can now log in with your new password.';
      ok.style.display = 'block';
      document.getElementById('login-phone').value = phone;
      document.getElementById('login-password').value = '';
      setTimeout(() => showScreen('screen-login'), 1800);
    } else {
      showErr(err, (data && data.message) || 'That code is invalid or expired. Please try again.');
    }
  } catch (e) {
    console.warn('verify-email-reset failed:', e);
    showErr(err, 'Something went wrong. Please try again in a moment.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Reset Password';
  }
}

async function doForgotPassword() {
  const phone = document.getElementById('forgot-phone').value.trim();
  const pass  = document.getElementById('forgot-password').value;
  const pass2 = document.getElementById('forgot-password2').value;
  const err   = document.getElementById('forgot-error');
  const ok    = document.getElementById('forgot-success');
  const btn   = document.getElementById('forgot-submit-btn');

  ok.style.display = 'none';
  if (!phone || !pass) return showErr(err, 'Please enter your phone number and a new password.');
  if (pass.length < 6) return showErr(err, 'Password must be at least 6 characters.');
  if (pass !== pass2) return showErr(err, 'Passwords do not match.');

  if (!window.SL_sb) {
    return showErr(err, 'Password reset needs an internet connection. Please try again when you\'re online.');
  }

  err.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Resetting...';

  try {
    const { data, error } = await window.SL_sb.rpc('reset_password', { p_phone: phone, p_new_password: pass });
    if (error) throw error;

    if (data === true) {
      ok.textContent = 'Password reset! You can now log in with your new password.';
      ok.style.display = 'block';
      document.getElementById('login-phone').value = phone;
      document.getElementById('login-password').value = '';
      setTimeout(() => showScreen('screen-login'), 1800);
    } else {
      showErr(err, 'No account found with that phone number.');
    }
  } catch (e) {
    console.warn('reset_password RPC failed:', e);
    showErr(err, 'Something went wrong. Please try again in a moment.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Reset Password';
  }
}
// ── ROUTE TO DASHBOARD ───────────────────────────────────
window.admComingSoon = function(title, msg) {
  let el = document.getElementById('adm-coming-soon-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'adm-coming-soon-toast';
    el.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#1A4731;color:#fff;padding:14px 22px;border-radius:12px;font-size:13px;font-weight:600;z-index:9999;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.2);font-family:Plus Jakarta Sans,Inter,sans-serif;max-width:280px;line-height:1.5;transition:opacity .3s;';
    document.body.appendChild(el);
  }
  el.innerHTML = '<div style="font-size:15px;margin-bottom:4px;">' + title + '</div><div style="font-weight:400;opacity:.85;font-size:12px;">' + msg + '</div>';
  el.style.opacity = '1';
  clearTimeout(window._admCSTimer);
  window._admCSTimer = setTimeout(() => { el.style.opacity = '0'; }, 3000);
};

// ── Show/hide the legacy demo users list ──
window.__admToggleUsersList = function() {
  const el = document.getElementById('admin-users-list');
  if (!el) return;
  el.style.display = (el.style.display === 'none') ? 'block' : 'none';
};

// ── AUDIT LOG ──
// Lightweight admin action log, kept in localStorage (and best-effort
// mirrored to Supabase if a client is available) so a second admin
// (e.g. Joshua) or Emmanuel later can see who approved/rejected what.
window.logAdminAction = function(action, details) {
  try {
    const entry = {
      id: 'al_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      action: action,
      details: details || '',
      adminName: (window.currentUser && window.currentUser.name) || (typeof currentUser !== 'undefined' && currentUser && currentUser.name) || 'Admin',
      ts: Date.now()
    };
    const KEY = 'sl_admin_audit_log';
    let log = [];
    try { log = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { log = []; }
    log.unshift(entry);
    if (log.length > 500) log = log.slice(0, 500); // cap local growth
    localStorage.setItem(KEY, JSON.stringify(log));
    // Best-effort cloud mirror — never blocks or throws on failure
    try {
      if (window.sbClient && window.sbClient.from) {
        window.sbClient.from('admin_audit_log').insert([{
          action: entry.action, details: entry.details, admin_name: entry.adminName, created_at: new Date(entry.ts).toISOString()
        }]).then(() => {}).catch(() => {});
      }
    } catch (e) {}
  } catch (e) { console.warn('logAdminAction failed:', e); }
};

window.closeAdminAuditLog = function() {
  const el = document.getElementById('slAdminAuditLogPanel');
  if (el) el.remove();
  window.slPopOverlay();
};

window.showAdminAuditLog = function() {
  const existing = document.getElementById('slAdminAuditLogPanel');
  if (existing) existing.remove();
  let log = [];
  try { log = JSON.parse(localStorage.getItem('sl_admin_audit_log') || '[]'); } catch (e) {}

  const rowsHTML = log.length ? log.map(e => `
    <div style="background:#fff;border-radius:10px;padding:12px 14px;margin-bottom:8px;box-shadow:0 1px 4px rgba(0,0,0,.06);">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <strong style="font-size:13px;">${e.action}</strong>
        <span style="font-size:11px;color:#999;">${new Date(e.ts).toLocaleString('en-GH')}</span>
      </div>
      ${e.details ? `<div style="font-size:12px;color:#555;margin-top:4px;">${e.details}</div>` : ''}
      <div style="font-size:11px;color:#aaa;margin-top:4px;">by ${e.adminName}</div>
    </div>`).join('') : `
    <div class="empty-state" style="padding:40px 20px;text-align:center;">
      <div class="emoji" style="font-size:40px;margin-bottom:10px;">📜</div>
      <h3 style="font-size:15px;margin-bottom:6px;">No actions logged yet</h3>
      <p style="font-size:13px;color:#777;">Refund approvals/rejections and other admin actions will appear here.</p>
    </div>`;

  const panel = document.createElement('div');
  panel.id = 'slAdminAuditLogPanel';
  panel.style.cssText = 'position:fixed;inset:0;z-index:2000;background:#f5f7f5;overflow-y:auto;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
  panel.innerHTML = `
    <div style="background:#1A4731;color:#fff;padding:16px 20px;display:flex;align-items:center;gap:12px;position:sticky;top:0;">
      <button style="background:rgba(255,255,255,.15);border:none;color:#fff;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:14px;" onclick="window.closeAdminAuditLog()">← Back</button>
      <div style="font-size:18px;font-weight:700;">Audit Log</div>
    </div>
    <div style="padding:20px;max-width:560px;margin:0 auto;">${rowsHTML}</div>`;
  document.body.appendChild(panel);
  window.slPushOverlay(window.closeAdminAuditLog);
};

// ── GLOBAL ADMIN SEARCH ──
// Filters orders, suppliers, and buyers by name/phone/order id so admin
// doesn't have to open a tile first just to look someone up.
window.adminGlobalSearchRun = function(qRaw) {
  const box = document.getElementById('admGlobalSearchResults');
  if (!box) return;
  const q = (qRaw || '').trim().toLowerCase();
  if (q.length < 2) { box.style.display = 'none'; box.innerHTML = ''; return; }

  const results = [];
  try {
    // Always pull fresh from cloud sync rather than the page-scoped `users`
    // variable — that global is only reassigned when the admin visits the
    // Suppliers/Buyers screens, so on a fresh session (or straight from the
    // Dashboard) it can still hold whatever was cached at page load, or the
    // demo placeholder data, silently missing real buyers/suppliers.
    (window.SL.getUsers() || []).forEach(u => {
      if (u.role !== 'buyer' && u.role !== 'supplier') return;
      const hay = ((u.name || '') + ' ' + (u.phone || '')).toLowerCase();
      if (hay.includes(q)) {
        results.push({
          label: `${u.name || 'Unnamed'} · ${u.phone || ''}`,
          sub: u.role === 'supplier' ? 'Supplier' : 'Buyer',
          view: u.role === 'supplier' ? 'admin-suppliers' : 'admin-buyers'
        });
      }
    });
    (window.SL.getOrders() || []).forEach(o => {
      const hay = ((o.id || '') + ' ' + (o.buyerName || '')).toLowerCase();
      if (hay.includes(q)) {
        results.push({
          label: `Order ${o.id}`,
          sub: (o.buyerName || 'Order') + ' · ' + (o.status || ''),
          view: 'admin-orders'
        });
      }
    });
  } catch (e) {}

  if (!results.length) {
    box.style.display = 'block';
    box.innerHTML = '<div style="padding:14px;font-size:13px;color:#888;">No matches</div>';
    return;
  }
  box.style.display = 'block';
  box.innerHTML = results.slice(0, 8).map(r => `
    <div onclick="window.slShowView('${r.view}'); document.getElementById('admGlobalSearchResults').style.display='none'; document.getElementById('admGlobalSearch').value='';"
      style="padding:11px 14px;border-bottom:1px solid #f0f0f0;cursor:pointer;">
      <div style="font-size:13px;font-weight:600;color:#222;">${r.label}</div>
      <div style="font-size:11px;color:#999;">${r.sub}</div>
    </div>`).join('');
};

// ── NEEDS ATTENTION PANEL ──
// Pulls together the things a busy admin actually needs to act on today,
// so they don't have to open five tiles just to find out nothing's pending.
window.renderAdminNeedsAttention = function() {
  try {
    const panel = document.getElementById('admNeedsAttentionPanel');
    const list = document.getElementById('admNeedsAttentionList');
    if (!panel || !list || !window.SL) return;

    const orders = window.SL.getOrders() || [];
    const products = window.SL.getProducts() || [];
    const refunds = window.SL.getRefunds() || [];

    const pendingOrders = orders.filter(o => (o.status || 'pending') === 'pending').length;
    const lowStock = products.filter(p => !p.deleted && (p.stockQty || 0) <= 10).length;
    const pendingRefunds = refunds.filter(r => r.status === 'pending').length;

    // Refund-aware, same reasoning as renderAdminDigest's tile above — see
    // that comment. Both places used to double-count refunded lines as
    // still-pending payouts before this fix.
    const pendingPayouts = (typeof window.getPayoutLines === 'function')
      ? window.getPayoutLines().filter(l => l.status === 'unpaid').length
      : 0;

    // Keep the Payouts tile dot in sync here too.
    const payoutsDot = document.getElementById('admin-dash-payouts-dot');
    if (payoutsDot) payoutsDot.style.display = pendingPayouts > 0 ? 'inline-block' : 'none';

    const items = [
      pendingOrders   > 0 ? { icon: '🧾', text: `${pendingOrders} order${pendingOrders>1?'s':''} awaiting action`, view: 'admin-orders' } : null,
      pendingRefunds  > 0 ? { icon: '↩️', text: `${pendingRefunds} refund${pendingRefunds>1?'s':''} pending review`, view: null, fn: 'window.showAdminRefundsPanel()' } : null,
      pendingPayouts  > 0 ? { icon: '💵', text: `${pendingPayouts} supplier payout${pendingPayouts>1?'s':''} unpaid`, view: 'admin-payouts' } : null,
      lowStock        > 0 ? { icon: '⚠️', text: `${lowStock} product${lowStock>1?'s':''} low on stock`, view: 'admin-products', lowStock: true } : null
    ].filter(Boolean);

    if (!items.length) { panel.style.display = 'none'; list.innerHTML = ''; return; }
    panel.style.display = 'block';
    list.innerHTML = items.map(it => `
      <div onclick="${it.fn ? it.fn : `window.__slLowStockFilter=${!!it.lowStock}; window.slShowView('${it.view}')`}"
        style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #f2f2f2;cursor:pointer;">
        <div style="font-size:18px;">${it.icon}</div>
        <div style="font-size:13px;color:#333;font-weight:600;">${it.text}</div>
      </div>`).join('');
  } catch (e) { console.warn('renderAdminNeedsAttention failed:', e); }
};

function renderAdminDigest() {
  try {
    const grid = document.getElementById('admDigestGrid');
    if (!grid || !window.SL) return;
    const orders = window.SL.getOrders() || [];
    const products = window.SL.getProducts() || [];
    const allUsers = window.SL.getUsers() || [];
    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();

    const ordersToday = orders.filter(o => (now - (o.createdAt || 0)) < dayMs).length;
    const lowStock = products.filter(p => !p.deleted && (p.stockQty || 0) <= 10).length;

    // Refund-aware: delegates to the same getPayoutLines() the actual Payouts
    // screen uses, which nets out approved refunds before deciding what's
    // still owed. The old inline version here (and in the Needs Attention
    // panel below) counted every unpaid supplier-line regardless of refunds,
    // so a fully-refunded order could still show up as a "pending payout"
    // here even though the real Payouts screen wouldn't list it at all.
    const pendingPayouts = (typeof window.getPayoutLines === 'function')
      ? window.getPayoutLines().filter(l => l.status === 'unpaid').length
      : 0;

    const newSignups = allUsers.filter(u => u.createdAt && (now - u.createdAt) < dayMs).length;

    const tiles = [
      { icon: '📥', label: 'Orders Today',        val: ordersToday,    view: 'admin-orders',   lowStock: false },
      { icon: '⚠️', label: 'Low Stock Items',      val: lowStock,       view: 'admin-products', lowStock: true  },
      { icon: '💰', label: 'Pending Payouts',      val: pendingPayouts, view: 'admin-payouts',  lowStock: false },
      { icon: '🆕', label: 'New Signups Today',    val: newSignups,     view: 'admin-suppliers', lowStock: false }
    ];
    grid.innerHTML = tiles.map(t => `
      <div onclick="window.__slLowStockFilter=${t.lowStock}; window.slShowView('${t.view}')" style="background:#f7f9f7;border-radius:10px;padding:12px;cursor:pointer;">
        <div style="font-size:20px;">${t.icon}</div>
        <div style="font-size:20px;font-weight:800;color:#1a472a;margin-top:4px;">${t.val}</div>
        <div style="font-size:11px;color:#666;">${t.label}</div>
      </div>`).join('');

    /* Storage-usage readout — most browsers cap localStorage around 5MB
     * per site. Product photos are stored as base64 text, which is heavy,
     * so this is worth watching: if writes start silently failing (which
     * now shows a popup instead — see lsSet), this number is almost
     * certainly the reason. */
    let totalBytes = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        totalBytes += (k.length + (localStorage.getItem(k) || '').length) * 2; // UTF-16, ~2 bytes/char
      }
    } catch (e) {}
    const usedMB = (totalBytes / (1024 * 1024)).toFixed(2);
    const pctOfLimit = Math.min(100, Math.round((totalBytes / (5 * 1024 * 1024)) * 100));
    const storageColor = pctOfLimit > 85 ? '#c0392b' : (pctOfLimit > 60 ? '#8a6d1a' : '#666');
    const existingNote = document.getElementById('admStorageNote');
    if (existingNote) existingNote.remove();
    const note = document.createElement('div');
    note.id = 'admStorageNote';
    note.style.cssText = 'text-align:right;font-size:11px;color:' + storageColor + ';margin-top:6px;';
    note.textContent = '💾 Storage used: ' + usedMB + ' MB (~' + pctOfLimit + '% of typical 5MB limit)';
    grid.parentNode.insertBefore(note, grid.nextSibling);
  } catch (e) { console.warn('renderAdminDigest failed:', e); }
  if (typeof window.renderAdminNeedsAttention === 'function') { try { window.renderAdminNeedsAttention(); } catch (e) {} }
}

/* Keep the dashboard digest tiles live while admin is actually sitting on
 * that screen — previously this only refreshed when navigating TO the
 * dashboard, or via the 20-second cloud poll, so a signup/order that came
 * in while admin was already parked on the dashboard could sit stale for
 * a while with no visible way to know new data had arrived. */
setInterval(function() {
  const dashScreen = document.getElementById('screen-dash-admin');
  if (dashScreen && dashScreen.classList.contains('active')) {
    renderAdminDigest();
    window.renderAdminNeedsAttention();
  }
}, 5000);

// ── ONBOARDING WALKTHROUGH (shown once per role on first login) ──
const ONBOARDING_SLIDES = {
  buyer: [
    { emoji: '🛒', title: 'Welcome to SupplyLink Market', desc: 'Fresh farm produce and wholesale goods, delivered straight to your door in Kumasi.' },
    { emoji: '✅', title: 'Shop with Confidence', desc: 'Look for the ✅ Verified badge and ⭐ ratings on products — these show suppliers with a proven delivery record.' },
    { emoji: '📦', title: 'Track Every Order', desc: 'Tap 📦 My Orders anytime to see delivery status, and 🔔 Notifications for live updates on your order.' }
  ],
  supplier: [
    { emoji: '🌾', title: 'Welcome, Supplier!', desc: 'List your products and reach buyers across Kumasi and beyond.' },
    { emoji: '📊', title: 'Manage Your Store', desc: 'Add products, update stock, and check your Analytics screen to see what is selling.' },
    { emoji: '💰', title: 'Get Paid Reliably', desc: 'Every delivered order is tracked automatically. Check your Payouts screen to see what you are owed and when it is paid.' }
  ]
};

function showOnboarding(role) {
  const slides = ONBOARDING_SLIDES[role];
  if (!slides) return;
  let idx = 0;
  const existing = document.getElementById('slOnboardingOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'slOnboardingOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:3010;background:#1a472a;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#fff;text-align:center;';

  function render() {
    const s = slides[idx];
    overlay.innerHTML = `
      <div style="font-size:64px;margin-bottom:20px;">${s.emoji}</div>
      <div style="font-size:22px;font-weight:700;margin-bottom:12px;max-width:320px;">${s.title}</div>
      <div style="font-size:14px;line-height:1.6;opacity:.9;max-width:320px;margin-bottom:28px;">${s.desc}</div>
      <div style="display:flex;gap:8px;margin-bottom:28px;">
        ${slides.map((_, i) => `<div style="width:${i === idx ? '20px' : '8px'};height:8px;border-radius:4px;background:${i === idx ? '#F59E0B' : 'rgba(255,255,255,.3)'};transition:all .2s;"></div>`).join('')}
      </div>
      <div style="display:flex;gap:12px;width:100%;max-width:320px;">
        ${idx < slides.length - 1 ? `
          <button id="slOnbSkip" style="flex:1;background:transparent;border:1px solid rgba(255,255,255,.4);color:#fff;padding:13px;border-radius:10px;font-weight:600;cursor:pointer;">Skip</button>
          <button id="slOnbNext" style="flex:1;background:#F59E0B;border:none;color:#1a1a1a;padding:13px;border-radius:10px;font-weight:700;cursor:pointer;">Next</button>
        ` : `
          <button id="slOnbDone" style="flex:1;background:#F59E0B;border:none;color:#1a1a1a;padding:13px;border-radius:10px;font-weight:700;cursor:pointer;">Get Started</button>
        `}
      </div>`;
    const skipBtn = overlay.querySelector('#slOnbSkip');
    const nextBtn = overlay.querySelector('#slOnbNext');
    const doneBtn = overlay.querySelector('#slOnbDone');
    if (skipBtn) skipBtn.onclick = finish;
    if (nextBtn) nextBtn.onclick = () => { idx++; render(); };
    if (doneBtn) doneBtn.onclick = finish;
  }
  function finish() {
    try { localStorage.setItem('sl_onboarding_done_' + role, '1'); } catch (e) {}
    overlay.remove();
    window.slPopOverlay();
  }
  document.body.appendChild(overlay);
  render();
  window.slPushOverlay(finish);
}

function maybeShowOnboarding(role) {
  try {
    if (localStorage.getItem('sl_onboarding_done_' + role)) return;
    showOnboarding(role);
  } catch (e) {}
}

// ── ROUTE TO DASHBOARD ───────────────────────────────────
function routeToDashboard() {
  if (!currentUser) return showScreen('screen-landing');

  if (currentUser.role === 'admin') {
    // Show the admin hub (screen-dash-admin is inside view-auth)
    window.slShowView('auth');
    showScreen('screen-dash-admin');
    document.getElementById('admin-welcome-name').textContent = 'Welcome, ' + currentUser.name + ' 👋';
    renderAdminUsersList();
    renderAdminDigest();
    window.renderAdminNeedsAttention();
  } else if (currentUser.role === 'supplier') {
    window.slShowView('supplier-portal');
    maybeShowOnboarding('supplier');
  } else if (currentUser.role === 'rider') {
    window.slShowView('rider-portal');
  } else if (currentUser.role === 'buyer') {
    window.slShowView('buyer-catalogue');
    maybeShowOnboarding('buyer');
  }
  window.slUpdateTopbar();
  if (typeof window.updateHelpWidgetVisibility === 'function') window.updateHelpWidgetVisibility();
}

// ── LOGOUT ───────────────────────────────────────────────
function doLogout() {
  if (typeof window.slCloseAllOverlays === 'function') window.slCloseAllOverlays();
  const stray = document.getElementById('slOnboardingOverlay');
  if (stray) { stray.remove(); }
  clearSession();
  showScreen('screen-landing');
  window.slShowView('auth');
  window.slUpdateTopbar();
  if (typeof window.updateHelpWidgetVisibility === 'function') window.updateHelpWidgetVisibility();
}

// ── RENDER HELPERS ───────────────────────────────────────
function renderAdminUsersList() {
  const el = document.getElementById('admin-users-list');
  const buyers   = users.filter(u => u.role === 'buyer').length;
  const suppliers = users.filter(u => u.role === 'supplier');
  const pending  = suppliers.filter(u => u.status === 'pending').length;

  document.getElementById('admin-stat-buyers').textContent = buyers;
  document.getElementById('admin-stat-suppliers').textContent = suppliers.filter(u=>u.status==='active').length;

  // ── Live order stats on admin dashboard ──
  try {
    const orders = window.SL.getOrders() || [];
    const pendingOrders = orders.filter(o => (o.status || 'pending') === 'pending').length;
    // Update Total Orders stat
    const statOrdersEl = document.querySelector('#screen-dash-admin .stat-card-value');
    if (statOrdersEl) statOrdersEl.textContent = orders.length;
    // Show pending dot on Orders tile
    const dot = document.getElementById('admin-dash-pending-dot');
    if (dot) dot.style.display = pendingOrders > 0 ? 'inline-block' : 'none';
    // Show pending dot on Refunds tile
    const pendingRefunds = (window.SL.getRefunds() || []).filter(r => r.status === 'pending').length;
    const refundDot = document.getElementById('admin-dash-refunds-dot');
    if (refundDot) refundDot.style.display = pendingRefunds > 0 ? 'inline-block' : 'none';
  } catch(e) {}

  let html = '';
  users.forEach(u => {
    const roleColor = u.role === 'admin' ? '#f4a623' : u.role === 'supplier' ? '#2D6A4F' : '#6C757D';
    const statusColor = u.status === 'active' ? '#2D6A4F' : u.status === 'pending' ? '#e67e00' : '#D62828';
    html += `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--grey-100);">
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--grey-800);">${u.name}</div>
          <div style="font-size:11px;color:var(--grey-600);">${u.phone}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:11px;font-weight:700;color:${roleColor};text-transform:uppercase;">${u.role}</div>
          <div style="font-size:10px;color:${statusColor};margin-top:2px;">${u.status}</div>
        </div>
      </div>`;
  });
  if (pending > 0) {
    html = `<div style="background:#fff8e6;padding:10px 12px;border-radius:8px;margin-bottom:12px;font-size:12px;color:#7a4f00;">
      ⚠️ <b>${pending}</b> supplier(s) pending approval</div>` + html;
  }
  el.innerHTML = html || '<p style="font-size:13px;color:var(--grey-400);text-align:center;">No users yet.</p>';
}

function renderSupplierProfile() {
  const u = currentUser;
  const rows = [
    ['Name', u.name],
    ['Phone', u.phone + ' (private)'],
    ['Business Type', capitalize(u.bizType || '')],
    ['Location', u.location || '—'],
    ['MoMo Number', u.momo + ' (admin only)'],
    ['Account Status', capitalize(u.status)]
  ];
  document.getElementById('supp-profile-rows').innerHTML = rows.map(([l,v]) =>
    `<div class="profile-row"><span class="p-label">${l}</span><span class="p-value">${v}</span></div>`
  ).join('');
}

function renderBuyerProfile() {
  const u = currentUser;
  const rows = [
    ['Name', u.name],
    ['Account Type', u.buyerType === 'business' ? 'Business' : 'Household'],
    ...(u.bizName ? [['Business Name', u.bizName]] : []),
    ['Phone', u.phone + ' (private)'],
    ['Delivery Address', u.address || '—']
  ];
  document.getElementById('buyer-profile-rows').innerHTML = rows.map(([l,v]) =>
    `<div class="profile-row"><span class="p-label">${l}</span><span class="p-value">${v}</span></div>`
  ).join('');
}

// ── UTILITIES ────────────────────────────────────────────
function showErr(el, msg) {
  el.textContent = msg;
  el.style.display = 'block';
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}
window.capitalize = capitalize; // shared across all script blocks (fixes profile page render bug)

// ── INIT — always require login on a fresh page load ─────
// (Session is intentionally not restored from storage here, so the
// user must log in each time the app is opened, even if they were
// logged in before. Logging out mid-session still works as before.)
(function init() {
  clearSession();
})();

    /* expose inline-onclick functions to global scope */
    window.doLogin=doLogin; window.doLogout=doLogout;
    window.renderAdminUsersList=renderAdminUsersList; window.renderAdminDigest=renderAdminDigest;
    window.maybeShowOnboarding=maybeShowOnboarding; window.showOnboarding=showOnboarding;
    window.proceedRegister=proceedRegister; window.registerBuyer=registerBuyer;
    window.registerSupplier=registerSupplier; window.selectBuyerType=selectBuyerType;
    window.selectRegRole=selectRegRole; window.showScreen=showScreen;
    window.openForgotPassword=openForgotPassword; window.checkForgotPhone=checkForgotPhone;
    window.doEmailReset=doEmailReset; window.doForgotPassword=doForgotPassword;
    window.goToFallbackStep=goToFallbackStep;
  })();
  