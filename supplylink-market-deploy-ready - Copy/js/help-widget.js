
(function() {
  'use strict';

  // ── Knowledge base ──────────────────────────────────────
  // Each entry: keywords used for matching (lowercase), the answer
  // shown, and which role(s) it applies to. Add more over time as
  // real questions come in via "Report an Issue".
  const HELP_FAQS = [
    {
      roles: ['buyer'],
      chip: 'Delivery pricing',
      keywords: ['delivery fee','delivery cost','delivery price','how much delivery','shipping cost','distance fee'],
      answer: "Delivery cost depends on distance from our depot and your order's weight. It's calculated automatically at checkout using your delivery address, so the price you see there is the final delivery fee — no surprises after."
    },
    {
      roles: ['buyer'],
      chip: 'Farm vs warehouse delivery',
      keywords: ['farm delivery','farm produce','wednesday','cutoff','weekend delivery','split order','two orders','separate orders'],
      answer: "Some products come straight from farms and follow a weekly cycle: orders placed before Wednesday 5pm are delivered Friday–Sunday. Warehouse items ship faster (Express or Normal speed). If your cart mixes both types, we automatically split it into two orders so each part can move on its own schedule."
    },
    {
      roles: ['buyer'],
      chip: 'Refunds & cancellations',
      keywords: ['refund','cancel order','cancellation','damaged','wrong item','return'],
      answer: "If something arrives damaged, wrong, or doesn't show up, open the order in My Orders and tap \"Report an Issue / Refund.\" This starts your refund request directly — our refund policy is also available from your Profile if you'd like the full details first."
    },
    {
      roles: ['buyer','supplier'],
      chip: 'Reset my password',
      keywords: ['forgot password','reset password','can\'t log in','cant log in','change password','login issue'],
      answer: "On the login screen, tap \"Forgot Password?\" and enter your phone number. If you've added an email to your profile, we'll send a 6-digit code there; otherwise you can reset directly by phone. Either way, your phone number stays your login."
    },
    {
      roles: ['buyer','supplier'],
      chip: 'Add an email',
      keywords: ['add email','secure reset','email code','change email'],
      answer: "Go to your Profile → Edit My Info, and add an email address (it's optional). This gives you a more secure password-reset option — a code sent to your email — instead of relying on phone number alone."
    },
    {
      roles: ['supplier'],
      chip: 'When do I get paid?',
      keywords: ['payout','get paid','momo payment','when paid','payment schedule'],
      answer: "Payouts are tracked in your Supplier dashboard under your payout ledger, based on completed, delivered orders. If a payout looks delayed or incorrect, use the Requests tab to flag the specific order, or contact SupplyLink GH directly below."
    },
    {
      roles: ['supplier'],
      chip: 'Low stock nudge',
      keywords: ['low stock','out of stock','stock alert','inventory warning'],
      answer: "We'll nudge you automatically when a product's stock runs low, so buyers don't order something you can't fulfill. You can update stock anytime from Products → edit the item."
    },
    {
      roles: ['supplier'],
      chip: 'Verification badge',
      keywords: ['verified','verification','badge','trusted supplier'],
      answer: "Verified badges are awarded by SupplyLink admin after reviewing your account and order history. Keep fulfilling orders reliably — if you believe you're eligible and don't have one yet, reach out below."
    },
    {
      roles: ['buyer'],
      chip: 'Track my order',
      keywords: ['track order','where is my order','order status','delivery status'],
      answer: "Tap 📦 My Orders to see live status on anything you've ordered, and check 🔔 Notifications for updates as your order moves along."
    },
    {
      roles: ['buyer'],
      chip: 'Compare prices',
      keywords: ['compare price','compare prices','cheapest','best price','different sellers','multiple suppliers','price comparison','who is cheaper'],
      answer: "When more than one supplier sells the same item, you'll see a \"🔍 X sellers · from GH₵...\" badge on that product — tap it to see every seller for that exact item side by side, sorted cheapest first, so you can pick the best deal in one tap."
    },
    {
      roles: ['buyer'],
      chip: 'Saved / liked items',
      keywords: ['liked items','save item','saved items','wishlist','favorite','favourite','heart icon','bookmark item'],
      answer: "Tap the ❤️ heart on any product (on its card or inside the product page) to save it. Your saved items show up in Profile → ❤️ Liked Items, so you can find them again quickly without re-searching."
    },
    {
      roles: ['buyer'],
      chip: 'Order history',
      keywords: ['order history','past orders','previous orders','purchase history','my past purchases','order list'],
      answer: "Your full order history — past and current — is in 📦 My Orders. Each order shows what you bought, when, and its status, and you can reorder straight from there."
    },
    {
      roles: ['buyer'],
      chip: 'Reorder',
      keywords: ['reorder','buy again','order again','repeat order','same order again'],
      answer: "Open 📦 My Orders, find the order you want to repeat, and tap \"🔁 Reorder.\" It adds the same items back to your cart so you don't have to search for each one again."
    },
    {
      roles: ['buyer'],
      chip: 'Referral rewards',
      keywords: ['referral','refer a friend','invite friends','referral code','earn credit','free credit','supplylink credit'],
      answer: "Your personal referral code is in Profile → SupplyLink Credit. Share it with a friend — when they sign up and complete their first order, you both earn GH₵20 SupplyLink Credit, applied automatically at your next checkout."
    },
  ];

  const FALLBACK_MSG = "I couldn't find an exact answer to that. Here are ways to reach a real person:";

  let helpThreadEl, helpChipsEl, helpInputEl;

  function currentRole() {
    try {
      const u = window.SL && window.SL.currentUser ? window.SL.currentUser() : null;
      return u && u.role;
    } catch (e) { return null; }
  }

  window.updateHelpWidgetVisibility = function() {
    const fab = document.getElementById('slHelpFab');
    if (!fab) return;
    const role = currentRole();
    fab.classList.toggle('visible', role === 'buyer' || role === 'supplier');
  };

  window.openHelpWidget = function() {
    helpThreadEl = document.getElementById('slHelpThread');
    helpChipsEl = document.getElementById('slHelpChips');
    helpInputEl = document.getElementById('slHelpInput');

    const role = currentRole();
    document.getElementById('slHelpSubtitle').textContent =
      role === 'supplier' ? 'Ask a question, or pick one below' : 'Ask a question, or pick one below';

    if (!helpThreadEl.dataset.started) {
      helpThreadEl.innerHTML = '';
      addHelpBotMessage("Hi! I'm SupplyLink's help assistant. Ask me something below, or tap a topic to get started.");
      helpThreadEl.dataset.started = '1';
    }

    renderHelpChips(role);
    document.getElementById('slHelpPanel').classList.add('open');
    setTimeout(() => helpInputEl && helpInputEl.focus(), 100);
  };

  window.closeHelpWidget = function() {
    document.getElementById('slHelpPanel').classList.remove('open');
  };

  function renderHelpChips(role) {
    const chips = HELP_FAQS.filter(f => f.roles.includes(role)).slice(0, 11);
    helpChipsEl.innerHTML = chips.map((f, i) =>
      `<div class="slHelpChip" onclick="answerHelpChip(${HELP_FAQS.indexOf(f)})">${f.chip}</div>`
    ).join('');
  }

  window.answerHelpChip = function(idx) {
    const faq = HELP_FAQS[idx];
    if (!faq) return;
    addHelpUserMessage(faq.chip);
    addHelpBotMessage(faq.answer);
  };

  function addHelpUserMessage(text) {
    const el = document.createElement('div');
    el.className = 'slHelpMsg user';
    el.textContent = text;
    helpThreadEl.appendChild(el);
    helpThreadEl.scrollTop = helpThreadEl.scrollHeight;
  }

  function addHelpBotMessage(text) {
    const el = document.createElement('div');
    el.className = 'slHelpMsg bot';
    el.textContent = text;
    helpThreadEl.appendChild(el);
    helpThreadEl.scrollTop = helpThreadEl.scrollHeight;
  }

  function addHelpEscalateOptions() {
    const role = currentRole();
    const wrap = document.createElement('div');
    wrap.className = 'slHelpEscalate';

    const ordersBtn = document.createElement('button');
    ordersBtn.className = 'slHelpEscalateBtn';
    ordersBtn.textContent = role === 'supplier' ? '📋 Go to Requests' : '📦 Go to My Orders';
    ordersBtn.onclick = function() {
      closeHelpWidget();
      if (role === 'supplier' && typeof window.goTo === 'function') window.goTo('fulfillments');
      else if (typeof window.showMyOrdersPanel === 'function') window.showMyOrdersPanel();
    };

    const callBtn = document.createElement('button');
    callBtn.className = 'slHelpEscalateBtn';
    callBtn.textContent = '📞 Call SupplyLink GH';
    callBtn.onclick = function() { window.location.href = 'tel:+233200000000'; };

    wrap.appendChild(ordersBtn);
    wrap.appendChild(callBtn);
    helpThreadEl.appendChild(wrap);
    helpThreadEl.scrollTop = helpThreadEl.scrollHeight;
  }

  function matchHelpFaq(input, role) {
    const q = input.toLowerCase();
    let best = null, bestScore = 0;
    HELP_FAQS.forEach(f => {
      if (!f.roles.includes(role)) return;
      let score = 0;
      f.keywords.forEach(k => { if (q.indexOf(k) !== -1) score += k.split(' ').length; });
      if (score > bestScore) { bestScore = score; best = f; }
    });
    return bestScore > 0 ? best : null;
  }

  window.sendHelpMessage = function() {
    const input = document.getElementById('slHelpInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    addHelpUserMessage(text);
    const role = currentRole();
    const match = matchHelpFaq(text, role);

    if (match) {
      addHelpBotMessage(match.answer);
    } else {
      addHelpBotMessage(FALLBACK_MSG);
      addHelpEscalateOptions();
    }
  };
})();
