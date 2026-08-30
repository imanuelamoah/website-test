
  (function() {
    'use strict';

    const MAX_LOCAL_LOG = 50;
    const MAX_PER_SESSION = 20; // safety valve against error-loop spam
    let errorCountThisSession = 0;
    let lastToastAt = 0;

    function safeGetUserContext() {
      try {
        const raw = localStorage.getItem('sl_current');
        const u = raw ? JSON.parse(raw) : null;
        return { role: (u && u.role) || 'guest', phone: (u && u.phone) || null };
      } catch (e) { return { role: 'unknown', phone: null }; }
    }

    function logLocally(entry) {
      try {
        const key = 'sl_error_log';
        const existing = JSON.parse(localStorage.getItem(key) || '[]');
        existing.push(entry);
        while (existing.length > MAX_LOCAL_LOG) existing.shift();
        localStorage.setItem(key, JSON.stringify(existing));
      } catch (e) { /* localStorage full or unavailable — nothing more we can do */ }
    }

    function pushToSupabase(entry) {
      // Best-effort only. The Supabase client (window.SL_sb) is created
      // later in the page, so this may not exist yet for very early
      // errors — that's fine, the local log still captured it.
      try {
        if (window.SL_sb && typeof window.SL_sb.from === 'function') {
          window.SL_sb.from('client_error_logs').insert({
            message: entry.message,
            stack: entry.stack,
            source_url: entry.source,
            line: entry.lineno,
            col: entry.colno,
            role: entry.role,
            phone: entry.phone,
            user_agent: navigator.userAgent,
            app_url: location.href
          }).then(function(){}, function(){});
        }
      } catch (e) { /* never let logging itself throw */ }
    }

    function showFriendlyBanner() {
      const now = Date.now();
      if (now - lastToastAt < 4000) return; // don't stack multiple toasts for one burst of errors
      lastToastAt = now;

      try {
        let el = document.getElementById('slGlobalErrorToast');
        if (!el) {
          el = document.createElement('div');
          el.id = 'slGlobalErrorToast';
          el.style.cssText = [
            'position:fixed', 'left:50%', 'bottom:24px', 'transform:translateX(-50%)',
            'background:#2B2B2B', 'color:#fff', 'padding:12px 18px', 'border-radius:10px',
            'font-size:14px', 'z-index:99999', 'max-width:88vw', 'text-align:center',
            'box-shadow:0 4px 14px rgba(0,0,0,0.3)', 'font-family:sans-serif'
          ].join(';');
          el.textContent = "Something didn't work as expected. Please try again.";
          (document.body || document.documentElement).appendChild(el);
        }
        el.style.display = 'block';
        clearTimeout(el._hideTimer);
        el._hideTimer = setTimeout(function() { el.style.display = 'none'; }, 4000);
      } catch (e) { /* if even the banner fails, fail silently rather than compound the error */ }
    }

    function handleError(message, source, lineno, colno, errorObj) {
      errorCountThisSession++;
      if (errorCountThisSession > MAX_PER_SESSION) return; // stop if something's looping

      const ctx = safeGetUserContext();
      const entry = {
        ts: new Date().toISOString(),
        message: String(message).slice(0, 500),
        source: source || '',
        lineno: lineno || 0,
        colno: colno || 0,
        stack: (errorObj && errorObj.stack) ? String(errorObj.stack).slice(0, 2000) : '',
        role: ctx.role,
        phone: ctx.phone
      };

      logLocally(entry);
      pushToSupabase(entry);
      showFriendlyBanner();
    }

    window.addEventListener('error', function(e) {
      handleError(e.message, e.filename, e.lineno, e.colno, e.error);
    });

    window.addEventListener('unhandledrejection', function(e) {
      const reason = e.reason;
      const message = (reason && reason.message) ? reason.message : String(reason);
      handleError('Unhandled promise rejection: ' + message, location.href, 0, 0, reason);
    });
  })();
  