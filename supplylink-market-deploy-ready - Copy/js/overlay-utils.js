
  /* ══════════════════════════════════════════════════════════════
     SHARED OVERLAY / BACK-BUTTON / SCROLL-LOCK UTILITY
     ══════════════════════════════════════════════════════════════
     Problem this solves: the app has ~15 different modals/panels
     (Edit Product, Refund, Rating, Notifications, My Orders, Track
     Order, Cart, Product modal, MoMo modal, etc.), and previously
     none of them did two things a real mobile web app needs:
       1. Lock background scroll while open (otherwise the page
          behind a modal drifts around during a touch-scroll, which
          also drags the sticky header/back-button out of view).
       2. Register a browser history entry, so the phone's back
          button/gesture closes the open overlay instead of exiting
          the whole app (there was zero use of the History API
          anywhere before this).
     This is placed in its own script tag, loaded before every other
     block, and attaches everything to `window` so any later IIFE
     can call it directly (e.g. `window.slPushOverlay(closeFn)`)
     without needing to share scope. ── */
  (function() {
    'use strict';
    let overlayStack = [];   // stack of close-callbacks, one per currently-open overlay
    let scrollLockCount = 0;
    let suppressNextPopstate = false;

    function lockScroll() {
      scrollLockCount++;
      if (scrollLockCount === 1) document.body.style.overflow = 'hidden';
    }
    function unlockScroll() {
      scrollLockCount = Math.max(0, scrollLockCount - 1);
      if (scrollLockCount === 0) document.body.style.overflow = '';
    }

    /* Call when OPENING any modal/panel/overlay. Pass the function that
       actually hides/removes it (whatever that overlay's own close
       function already does) — nothing about that function needs to
       change. */
    window.slPushOverlay = function(closeFn) {
      overlayStack.push(closeFn);
      lockScroll();
      history.pushState({ slOverlay: true, depth: overlayStack.length }, '');
    };

    /* Call from INSIDE an overlay's own close function (in-app "X"/
       "Cancel"/"Back" button path) — NOT from the popstate handler.
       Safe to call even if this overlay was never pushed (no-op). */
    window.slPopOverlay = function() {
      if (overlayStack.length === 0) return;
      overlayStack.pop();
      unlockScroll();
      if (history.state && history.state.slOverlay) {
        suppressNextPopstate = true;
        history.back();
      }
    };

    /* Call when directly replacing one open overlay with another in the same
       gesture (e.g. tapping a notification closes the notification list and
       immediately opens the order's tracking screen). Using this instead of
       slPopOverlay()+slPushOverlay() avoids racing an async history.back()
       against a synchronous pushState() in the same tick — it just relabels
       what the current history entry means, via replaceState. */
    window.slSwapOverlay = function(newCloseFn) {
      if (overlayStack.length > 0) overlayStack.pop();
      overlayStack.push(newCloseFn);
      if (scrollLockCount === 0) lockScroll(); // stay locked; only needed if somehow unlocked
      history.replaceState({ slOverlay: true, depth: overlayStack.length }, '');
    };

    /* Call to forcibly close every currently-open overlay at once (e.g.
       before logout) — hides each overlay's DOM top-down, then rewinds
       history in a single step so the address bar / back-button state
       matches "no overlays open". Safe to call with zero overlays open. */
    window.slCloseAllOverlays = function() {
      const n = overlayStack.length;
      if (n === 0) return;
      const closers = overlayStack.slice().reverse(); // top (most-recently opened) first
      overlayStack = []; // clear now so each closeFn's internal slPopOverlay() no-ops safely
      scrollLockCount = 0;
      document.body.style.overflow = '';
      closers.forEach(function(closeFn) {
        if (typeof closeFn === 'function') { try { closeFn(); } catch (e) {} }
      });
      if (history.state && history.state.slOverlay) {
        history.go(-n);
      }
    };

    /* Same history/bookkeeping cleanup as slCloseAllOverlays, but WITHOUT
     * calling each closeFn — used when we want to stop old back-button
     * entries from lingering (so they can't later replay a stale screen)
     * while deliberately staying exactly where we are right now, rather
     * than triggering whatever "close" would otherwise do (e.g. showing
     * an order confirmation shouldn't itself trigger checkout's own
     * "back to catalogue" callback as a side effect). */
    window.slClearOverlayHistorySilently = function() {
      const n = overlayStack.length;
      if (n === 0) return;
      overlayStack = [];
      scrollLockCount = 0;
      document.body.style.overflow = '';
      if (history.state && history.state.slOverlay) {
        history.go(-n);
      }
    };

    window.addEventListener('popstate', function() {
      if (suppressNextPopstate) { suppressNextPopstate = false; return; }
      if (overlayStack.length > 0) {
        const closeFn = overlayStack[overlayStack.length - 1];
        if (typeof closeFn === 'function') {
          try { closeFn(); } catch (e) {}
        } else {
          overlayStack.pop();
          unlockScroll();
        }
      }
      // If the stack is empty, this is a real "leave the app" back-press —
      // let the browser handle it natively (nothing to intercept).
    });

    // Baseline history entry so the very first popstate has something to land on.
    history.replaceState({ slOverlay: false }, '');
  })();
  