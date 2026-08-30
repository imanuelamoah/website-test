
(function() {
  'use strict';

  /* ── BUYER profile fields ── */
  const BUYER_FIELDS = [
    { key: 'name',    label: 'Full Name',         type: 'text',  editable: true  },
    { key: 'phone',   label: 'Phone Number',       type: 'tel',   editable: false, note: 'Contact SupplyLink to change' },
    { key: 'email',   label: 'Email (optional)',   type: 'email', editable: true,  note: 'Adds a secure email code option for password resets.' },
    { key: 'address', label: 'Delivery Address',   type: 'text',  editable: true  },
    { key: 'bizName', label: 'Business Name',      type: 'text',  editable: true,  showIf: u => u.buyerType === 'business' },
  ];

  /* ── SUPPLIER profile fields ── */
  const SUPPLIER_FIELDS = [
    { key: 'name',     label: 'Full Name',        type: 'text',  editable: true  },
    { key: 'phone',    label: 'Phone Number',      type: 'tel',   editable: false, note: 'Contact SupplyLink to change' },
    { key: 'email',    label: 'Email (optional)',  type: 'email', editable: true,  note: 'Adds a secure email code option for password resets.' },
    { key: 'location', label: 'Location / Town',  type: 'text',  editable: true  },
    { key: 'bizType',  label: 'Business Type',    type: 'text',  editable: false },
    { key: 'momo',     label: 'MoMo Number',      type: 'tel',   editable: true  },
  ];

  function getFields() {
    const u = window.SL.currentUser();
    if (!u) return [];
    return u.role === 'supplier' ? SUPPLIER_FIELDS : BUYER_FIELDS;
  }

  function getActiveFields() {
    const u = window.SL.currentUser();
    return getFields().filter(f => !f.showIf || f.showIf(u));
  }

  /* ── Initials for avatar ── */
  function initials(name) {
    if (!name) return '👤';
    const parts = name.trim().split(' ');
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }

  /* ── Open panel ── */
  /* ── Refund & Cancellation Policy panel ── */
  window.openPolicyPanel = function() {
    document.getElementById('slPolicyPanel').style.display = 'block';
    window.slPushOverlay(window.closePolicyPanel);
  };
  window.closePolicyPanel = function() {
    document.getElementById('slPolicyPanel').style.display = 'none';
    window.slPopOverlay();
  };

  /* ── Terms of Service panel ── */
  window.openTermsPanel = function() {
    document.getElementById('slTermsPanel').style.display = 'block';
    window.slPushOverlay(window.closeTermsPanel);
  };
  window.closeTermsPanel = function() {
    document.getElementById('slTermsPanel').style.display = 'none';
    window.slPopOverlay();
  };

  /* ── Privacy Policy panel ── */
  window.openPrivacyPanel = function() {
    document.getElementById('slPrivacyPanel').style.display = 'block';
    window.slPushOverlay(window.closePrivacyPanel);
  };
  window.closePrivacyPanel = function() {
    document.getElementById('slPrivacyPanel').style.display = 'none';
    window.slPopOverlay();
  };

  window.openProfilePanel = function() {
    const u = window.SL.currentUser();
    if (!u) return;

    // Header: avatar, name, role tag
    document.getElementById('slProfileAvatarBig').textContent = initials(u.name);
    document.getElementById('slProfileNameBig').textContent = u.name || '—';
    const roleTag = u.role === 'buyer'
      ? (u.buyerType === 'business' ? 'Business Buyer' : 'Household Buyer')
      : 'Supplier';
    document.getElementById('slProfileRoleTag').textContent = roleTag;

    renderProfileView();

    document.getElementById('slProfilePanel').style.display   = 'block';
    document.getElementById('slProfileView').style.display    = 'block';
    document.getElementById('slProfileEdit').style.display    = 'none';
    window.slPushOverlay(window.closeProfilePanel);
  };

  /* ── Close panel ── */
  window.closeProfilePanel = function() {
    document.getElementById('slProfilePanel').style.display   = 'none';
    window.slPopOverlay();
  };

  /* ── Render VIEW mode ── */
  function renderProfileView() {
    const u = window.SL.currentUser();
    const fields = getActiveFields();

    const lockIconSvg = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style="display:inline-block;vertical-align:-1px;margin-right:4px;"><path d="M12 1a5 5 0 00-5 5v3H6a2 2 0 00-2 2v9a2 2 0 002 2h12a2 2 0 002-2v-9a2 2 0 00-2-2h-1V6a5 5 0 00-5-5zm0 2a3 3 0 013 3v3H9V6a3 3 0 013-3zm0 10a1.5 1.5 0 011.5 1.5c0 .6-.35 1.1-.85 1.35l.35 1.65h-2l.35-1.65a1.494 1.494 0 01-.85-1.35A1.5 1.5 0 0112 13z"/></svg>';
    document.getElementById('slProfileRows').innerHTML = fields.map(f => {
      const val = u[f.key] || '—';
      const shown = (f.key === 'momo' || f.key === 'phone') ? lockIconSvg + val : val;
      return `<div class="profile-info-item">
        <div class="info-label">${f.label}</div>
        <div class="info-val">${shown}</div>
      </div>`;
    }).join('');

    // Quick Actions (Orders/Liked/Messages) only make sense for buyers —
    // suppliers/admins have their own equivalents elsewhere in the app.
    const qa = document.getElementById('slProfileQuickActions');
    if (qa) qa.style.display = (u.role === 'buyer') ? 'grid' : 'none';

    // Suppliers get their own Messages entry point since they don't have
    // the buyer's Quick Actions row.
    const supMsgRow = document.getElementById('slSupplierMsgRow');
    if (supMsgRow) supMsgRow.style.display = (u.role === 'supplier') ? 'flex' : 'none';

    // Tutorial replay + refund policy are hidden for admins, same as before.
    document.querySelectorAll('.profile-list-section').forEach(el => {
      el.style.display = (u.role !== 'admin') ? 'block' : 'none';
    });

    // Update avatars in headers
    const av = initials(u.name);
    const b3av = document.getElementById('b3-profile-avatar');
    const b5av = document.getElementById('b5-profile-avatar');
    if (b3av) { b3av.textContent = av; b3av.style.fontSize = '13px'; }
    if (b5av) b5av.textContent = av;

    renderReferralCard(u);
    if (typeof window.renderLikedItemsCard === 'function') window.renderLikedItemsCard(u); // cleans up any legacy card
    if (typeof window.refreshMessagesBadge === 'function') window.refreshMessagesBadge();
  }

  /* ── Referral & Wallet card (buyers only) ── */
  function renderReferralCard(u) {
    let card = document.getElementById('slReferralCard');
    if (u.role !== 'buyer') { if (card) card.remove(); return; }

    if (!card) {
      card = document.createElement('div');
      card.id = 'slReferralCard';
      card.className = 'panel';
      card.style.marginTop = '16px';
      card.style.padding = '16px 18px 18px';
      document.getElementById('slProfileView').insertBefore(card, document.getElementById('slProfileView').children[1] || null);
    }

    const balance = window.SL.getWalletBalance ? window.SL.getWalletBalance(u.id) : (u.walletBalance || 0);
    const code = u.referralCode || '—';
    const shareMsg = `Hey! I use SupplyLink Market to order fresh produce & supplies in Kumasi with delivery to my door. Sign up with my code ${code} and we both get GH₵20 credit: https://supplylinkgh.com`;
    const waLink = 'https://wa.me/?text=' + encodeURIComponent(shareMsg);

    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:7px;font-weight:700;font-size:14px;color:#1A4731;min-width:0;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-1h-1v-2h4v-1h-3c-.55 0-1-.45-1-1V9c0-.55.45-1 1-1h1V7h2v1h1v2h-4v1h3c.55 0 1 .45 1 1v3c0 .55-.45 1-1 1h-1v1z"/></svg>
          <span style="white-space:nowrap;">SupplyLink Credit</span>
        </div>
        <div style="font-weight:800;font-size:16px;color:#1A4731;white-space:nowrap;flex-shrink:0;">GH₵${balance.toFixed(2)}</div>
      </div>
      <p style="font-size:12px;color:#777;margin-bottom:12px;">Credit is applied automatically at checkout.</p>
      <div style="background:#f5f7f5;border-radius:10px;padding:12px;text-align:center;margin-bottom:10px;">
        <div style="font-size:11px;color:#888;margin-bottom:4px;">Your Referral Code</div>
        <div style="font-size:20px;font-weight:800;letter-spacing:2px;color:#1A4731;">${code}</div>
      </div>
      <a href="${waLink}" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:7px;text-align:center;background:#25D366;color:#fff;padding:12px;border-radius:10px;font-weight:700;text-decoration:none;font-size:14px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l1.65-4.95A9.969 9.969 0 012 12C2 6.48 6.48 2 12 2s10 4.48 10 10-4.48 10-10 10a9.969 9.969 0 01-4.05-.85L2 21zm5.13-4.42l.3.19A8.014 8.014 0 0012 18c4.41 0 8-3.59 8-8s-3.59-8-8-8-8 3.59-8 8c0 1.5.41 2.91 1.19 4.15l.22.36-.94 2.82 2.66-.75z"/></svg>
        Invite Friends — Earn GH₵20 Each
      </a>`;
  }

  /* ── Liked / Saved Items card (buyers only, v11.94) ──
     Mirrors renderReferralCard's pattern: a lazily-created panel inserted
     into the profile view. Reads straight from window.SL.getProducts()
     rather than Block 3's buyer-catalogue PRODUCTS array, since this
     script runs in a separate IIFE and Block 3's transformed list isn't
     in scope here — this keeps the two features decoupled. */
  /* ── Liked / Saved Items — retired inline card (v11.103) ──
     This used to render a preview list of liked products directly inside
     the Profile screen. It now has its own dedicated page (see
     showLikedItemsPanel in Block 3), matching how Messages works — one
     place to see it, not a duplicate summary here too. This function is
     kept only so it safely removes any leftover card a returning session
     might still have in the DOM; it no longer renders anything. */
  function renderLikedItemsCard(u) {
    const card = document.getElementById('slLikedItemsCard');
    if (card) card.remove();
  }
  window.renderLikedItemsCard = renderLikedItemsCard;


  window.openProfileEdit = function() {
    const u = window.SL.currentUser();
    const fields = getActiveFields().filter(f => f.editable);

    document.getElementById('slProfileEditFields').innerHTML = fields.map(f => `
      <div class="field-group">
        <label class="field-label">${f.label}</label>
        <input id="pf-${f.key}" class="field-input" type="${f.type || 'text'}" value="${u[f.key] || ''}" placeholder="${f.label}" />
        ${f.note ? `<p style="font-size:11px;color:#888;margin-top:4px;">${f.note}</p>` : ''}
      </div>`).join('');

    document.getElementById('slProfileView').style.display = 'none';
    document.getElementById('slProfileEdit').style.display = 'block';
    document.getElementById('slProfileEditMsg').style.display = 'none';
  };

  /* ── Cancel edit ── */
  window.cancelProfileEdit = function() {
    document.getElementById('slProfileView').style.display = 'block';
    document.getElementById('slProfileEdit').style.display = 'none';
  };

  /* ── Save edits ── */
  window.saveProfileEdit = function() {
    const u = window.SL.currentUser();
    const users = JSON.parse(localStorage.getItem('sl_users') || '[]');
    const fields = getActiveFields().filter(f => f.editable);
    const msg = document.getElementById('slProfileEditMsg');

    const emailEl = document.getElementById('pf-email');
    if (emailEl && emailEl.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEl.value.trim())) {
      msg.style.display = 'block';
      msg.style.color = '#c0392b';
      msg.textContent = 'That doesn\'t look like a valid email address.';
      return;
    }

    fields.forEach(f => {
      const el = document.getElementById('pf-' + f.key);
      if (el) u[f.key] = el.value.trim();
    });

    // Update in users array
    const idx = users.findIndex(x => x.id === u.id);
    if (idx !== -1) users[idx] = Object.assign(users[idx], u);
    localStorage.setItem('sl_users', JSON.stringify(users));
    window.SL.setCurrentUser(u);

    // Update topbar
    window.slUpdateTopbar();

    // Show success
    msg.style.display = 'block';
    msg.style.color = '#2D6A4F';
    msg.textContent = '✅ Profile saved! Your checkout will auto-fill with these details.';

    renderProfileView();
    setTimeout(() => {
      document.getElementById('slProfileView').style.display = 'block';
      document.getElementById('slProfileEdit').style.display = 'none';
      msg.style.display = 'none';
    }, 1800);
  };

  /* ── Update avatar initials on page load and whenever profile panel closes ── */
  function refreshAvatars() {
    const u = window.SL.currentUser();
    if (!u) return;
    const av = initials(u.name);
    const b3av = document.getElementById('b3-profile-avatar');
    const b5av = document.getElementById('b5-profile-avatar');
    if (b3av) { b3av.textContent = av; b3av.style.fontSize = '13px'; }
    if (b5av) b5av.textContent = av;
  }

  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(refreshAvatars, 100); // slight delay to let auth init settle
  });

  /* Patch slShowView to refresh avatars on catalogue/supplier load */
  const _origShowView = window.slShowView;
  window.slShowView = function(viewName) {
    _origShowView(viewName);
    if (viewName === 'buyer-catalogue' || viewName === 'supplier-portal') {
      setTimeout(refreshAvatars, 50);
    }
  };

})();
