
  (function() {
    'use strict';
    
  /* Cart loaded from Block 3 via sessionStorage */
  let cart = JSON.parse(localStorage.getItem(window.getCartStorageKey()) || '{}');

  /* Live product catalogue from shared SL store */
  const CATEGORY_EMOJI = {
    "Vegetables":"🥦","Fruits":"🍊","Grains & Cereals":"🌾","Grains":"🌾",
    "Tubers":"🍠","Proteins":"🥩","Meat & Poultry":"🍗","Fish & Seafood":"🐟",
    "Cooking Oil":"🛢️","Spices & Herbs":"🧄","Spices":"🧄","Biscuits & Snacks":"🍪",
    "Drinks & Beverages":"🥤","Groceries":"🛒","Packaged Goods":"📦","Other":"📋"
  };
  let PRODUCTS = window.SL.getProducts().map(p => ({
    id: p.id,
    name: p.name,
    emoji: CATEGORY_EMOJI[p.category] || "🛒",
    unit: p.unit,
    weightKg: p.weightKg,
    markedUpPrice: p.buyerPrice,
    supplierId: p.supplierId,
    supplierPrice: p.supplierPrice,
    sourceType: p.sourceType,
    images: p.images || []
  }));

  /* ── DELIVERY MODE ── */
  /* "pickup" = in-person collection (no fee).
   * "delivery" = distance-based fee, auto-calculated (see below). */
  let deliveryMode = null; // "pickup" | "delivery"

  /* ── BASE LOCATION (Sunyani Road depot) ── */
  const BASE_COORDS = { lat: 6.7000752, lng: -1.7114136 };

  /* ── DISTANCE-BASED DELIVERY ZONES ──
   * Zones represent km bands (driving distance) from the Kumasi depot.
   * Two speeds: Normal (6-8hr fulfillment) and Express (1-3hr fulfillment).
   * The buyer never sees these bands directly — distance is auto-calculated
   * from their address (geocode + routing) and mapped silently to a price.
   */
  const ZONES = [
    { id:"zone1",  name:"0 – 5 km",   minKm:0,  maxKm:5,  normal:35,  express:60  },
    { id:"zone2",  name:"6 – 10 km",  minKm:5,  maxKm:10, normal:50,  express:80 },
    { id:"zone3",  name:"11 – 15 km", minKm:10, maxKm:15, normal:65,  express:100 },
    { id:"zone4",  name:"16 – 20 km", minKm:15, maxKm:20, normal:80,  express:120 },
    { id:"zone5",  name:"21 – 25 km", minKm:20, maxKm:25, normal:95,  express:140 },
    { id:"zone6",  name:"26 – 30 km", minKm:25, maxKm:30, normal:110, express:160 },
  ];

  /* Farm-sourced produce used to be a flat GH₵35 regardless of distance or
   * quantity — unfair both ways: a buyer 3km away paid the same as one 25km
   * away, and a 5kg order paid the same as a 25kg + 20-tuber order. Farm
   * deliveries now use the SAME distance bands as warehouse "Normal" speed
   * (farm only ever runs at Normal speed — one weekly collection run, no
   * Express option), plus a small weight surcharge above a base allowance
   * so heavier orders contribute more toward fuel/loading. */
  const FARM_WEIGHT_ALLOWANCE_KG = 10;    // included in the base distance fee
  const FARM_WEIGHT_INCREMENT_KG = 10;    // each additional block of this size...
  const FARM_WEIGHT_INCREMENT_FEE = 10;   // ...adds this many cedis

  /* Best-effort kg extraction from a unit label like "per bag (25kg)",
   * "per tuber (3–5kg)" (ranges are averaged), or "per kg" (=1). Falls back
   * to 1kg for labels with no parseable weight, so an order is never
   * under-priced by returning 0. This reads Emmanuel's existing unit-label
   * convention rather than requiring a brand-new product field — if a
   * supplier's unit label doesn't mention kg, add one (e.g. "per basket
   * (8kg)") so this stays accurate. */
  function parseUnitWeightKg(unitLabel) {
    if (!unitLabel) return 1;
    const matches = String(unitLabel).match(/(\d+(?:\.\d+)?)\s*kg/gi);
    if (!matches || !matches.length) return 1;
    const nums = matches.map(m => parseFloat(m));
    const avg = nums.reduce((s, n) => s + n, 0) / nums.length;
    return avg > 0 ? avg : 1;
  }
  window.parseUnitWeightKg = parseUnitWeightKg;

  /* Prefer an explicit weightKg set on the product (via the "Weight per
   * unit (kg)" field in the product form) — falls back to reading the
   * unit label for products added before that field existed. */
  function getProductWeightKg(product) {
    if (product && product.weightKg && product.weightKg > 0) return product.weightKg;
    return parseUnitWeightKg(product ? product.unit : null);
  }
  window.getProductWeightKg = getProductWeightKg;

  /* ── AUTO DISTANCE ENGINE ──
   * Geocodes the buyer's typed address (Nominatim), gets driving distance from
   * the depot (OSRM), and maps it to a zone. Buyer only ever sees the resulting price.
   * Result is cached in localStorage so it's reused across the whole session/future visits.
   */
  async function geocodeAddress(query) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=gh&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !data.length) return null;
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    } catch (e) { return null; }
  }

  async function getDrivingDistanceKm(lat, lng) {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${BASE_COORDS.lng},${BASE_COORDS.lat};${lng},${lat}?overview=false`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.routes || !data.routes.length) return null;
      return data.routes[0].distance / 1000;
    } catch (e) { return null; }
  }

  function getZoneForDistance(km) {
    return ZONES.find(z => km >= z.minKm && km <= z.maxKm) || null;
  }

  function loadSavedBuyerLocation() {
    try {
      const raw = localStorage.getItem("slm_buyer_location");
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  let buyerLocation = loadSavedBuyerLocation(); // { address, lat, lng, distanceKm, zoneId } | null

  /* Resolves + saves the buyer's delivery location. Returns:
   *   { ok:true, zone, distanceKm }
   *   { ok:false, reason:'geocode_failed' | 'route_failed' | 'out_of_range', distanceKm? }
   */
  async function resolveBuyerLocation(addressText) {
    const coords = await geocodeAddress(addressText + ", Kumasi, Ghana");
    if (!coords) return { ok: false, reason: "geocode_failed" };
    const km = await getDrivingDistanceKm(coords.lat, coords.lng);
    if (km == null) return { ok: false, reason: "route_failed" };
    const zone = getZoneForDistance(km);
    if (!zone) return { ok: false, reason: "out_of_range", distanceKm: km };
    buyerLocation = { address: addressText, lat: coords.lat, lng: coords.lng, distanceKm: km, zoneId: zone.id };
    try { localStorage.setItem("slm_buyer_location", JSON.stringify(buyerLocation)); } catch (e) {}
    return { ok: true, zone, distanceKm: km };
  }

  /* ── PER-SUPPLIER DELIVERY SPEED ──
   * Speed (express/normal) is chosen per supplier — usually set from the product
   * modal while browsing — since one rider trip per supplier can't be split. */
  let supplierSpeeds = JSON.parse(sessionStorage.getItem("slm_supplier_speeds") || "{}");
  function getSupplierSpeed(supplierId) { return supplierSpeeds[supplierId] || null; }
  function setSupplierSpeed(supplierId, speed) {
    supplierSpeeds[supplierId] = speed;
    sessionStorage.setItem("slm_supplier_speeds", JSON.stringify(supplierSpeeds));
  }

  /* ── PER-SUPPLIER DELIVERY SLOT (Normal speed only) ──
   * Normal used to be a single fixed 6–8hr window with no choice. This lets
   * the buyer pick a morning/afternoon/evening band on whichever day Normal
   * resolves to, instead of just being told when it's arriving. */
  let supplierSlots = JSON.parse(sessionStorage.getItem("slm_supplier_slots") || "{}");
  function getSupplierSlot(supplierId) { return supplierSlots[supplierId] || null; }
  function setSupplierSlot(supplierId, slotId) {
    supplierSlots[supplierId] = slotId;
    sessionStorage.setItem("slm_supplier_slots", JSON.stringify(supplierSlots));
  }

  /* ── PER-SUPPLIER TIER ── farm (farmer bizType) vs wholesale */
  function getSupplierTier(supplierId) {
    const allUsers = (window.SL.getUsers && window.SL.getUsers()) || [];
    const supplier = allUsers.find(u => u.id === supplierId);
    return (supplier && supplier.bizType === "farmer") ? "farm" : "wholesale";
  }

  /* ── DELIVERY TIMING RULES ──
   * Suppliers only hand off stock 7am-5pm, so all timing is built around that.
   * - Orders before 7am are treated as placed at 7am (suppliers aren't open yet anyway).
   * - Express = order time + 1 to 3 hours.
   * - Normal  = order time + 6 to 8 hours. Not offered 3pm-5pm (would land very late at night).
   * - Orders placed after 5pm roll to 7am the next day (both speeds available again).
   */
  /* Whole-hour clock label, no minutes: "12pm", "2pm", "9am". */
  function fmtClock(d) {
    let h = d.getHours() % 12;
    if (h === 0) h = 12;
    return `${h}${d.getHours() >= 12 ? 'pm' : 'am'}`;
  }
  function fmtLongDate(d) {
    return d.toLocaleDateString('en-GH', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  /* Same as fmtLongDate but without the comma — matches the "Sunday 12 July"
   * style used in delivery-window messaging. */
  function fmtOrderDate(d) {
    const weekday = d.toLocaleDateString('en-GH', { weekday: 'long' });
    const month = d.toLocaleDateString('en-GH', { month: 'long' });
    return `${weekday} ${d.getDate()} ${month}`;
  }
  function addHrs(d, h) {
    const nd = new Date(d);
    nd.setTime(nd.getTime() + h * 3600000);
    return nd;
  }
  /* Rounds a timestamp UP to the next whole hour whenever it has any minutes/
   * seconds past the hour — an order at 10:13 is treated as 11:00, an order
   * placed exactly on the hour (10:00) stays at 10:00. Keeps every delivery
   * window on clean, easy-to-read hour boundaries. */
  function ceilToHour(d) {
    const nd = new Date(d);
    if (nd.getMinutes() > 0 || nd.getSeconds() > 0 || nd.getMilliseconds() > 0) {
      nd.setHours(nd.getHours() + 1, 0, 0, 0);
    } else {
      nd.setMinutes(0, 0, 0);
    }
    return nd;
  }

  /* Business hours the depot operates within (24h clock). */
  const BUSINESS_OPEN_HOUR  = 7;  // work starts at 7am — matches supplier handoff hours
  const BUSINESS_CLOSE_HOUR = 17; // 5pm — suppliers close, no more same-day pickup after this
  const NORMAL_CUTOFF_HOUR  = 15; // 3pm — after this, Normal rolls to next day

  function getWholesaleDeliveryOptions(now) {
    now = now || new Date();
    let base = ceilToHour(now);
    if (base.getHours() < BUSINESS_OPEN_HOUR) base.setHours(BUSINESS_OPEN_HOUR, 0, 0, 0);

    // Past closing time -> both speeds roll to next day's opening hour.
    let isNextDay = false;
    if (base.getHours() >= BUSINESS_CLOSE_HOUR) {
      base.setDate(base.getDate() + 1);
      base.setHours(BUSINESS_OPEN_HOUR, 0, 0, 0);
      isNextDay = true;
    }

    const expressBase = base;

    // Normal uses "base" too, UNLESS it's past the 3pm cutoff (and we haven't
    // already rolled to tomorrow) — then Normal alone rolls to the next
    // working day's opening hour, so it's never hidden, just rescheduled.
    let normalBase = base;
    if (!isNextDay && base.getHours() >= NORMAL_CUTOFF_HOUR) {
      normalBase = new Date(base);
      normalBase.setDate(normalBase.getDate() + 1);
      normalBase.setHours(BUSINESS_OPEN_HOUR, 0, 0, 0);
    }

    const expressStart = addHrs(expressBase, 1), expressEnd = addHrs(expressBase, 3);
    const normalStart  = addHrs(normalBase, 6),  normalEnd  = addHrs(normalBase, 8);

    return [
      {
        speed: 'express',
        windowLabel: `${fmtOrderDate(expressStart)} ${fmtClock(expressStart)} to ${fmtClock(expressEnd)}`
      },
      {
        speed: 'normal',
        windowLabel: `${fmtOrderDate(normalStart)} ${fmtClock(normalStart)} to ${fmtClock(normalEnd)}`
      }
    ];
  }

  /* ── NORMAL-SPEED TIME-BAND SLOTS ──
   * Resolves the same eligible day Normal delivery already lands on (same
   * business-hours/cutoff rules as getWholesaleDeliveryOptions above), then
   * splits that day into three pickable bands instead of one fixed window. */
  function getNormalDaySlots(now) {
    now = now || new Date();
    let base = ceilToHour(now);
    if (base.getHours() < BUSINESS_OPEN_HOUR) base.setHours(BUSINESS_OPEN_HOUR, 0, 0, 0);
    let isNextDay = false;
    if (base.getHours() >= BUSINESS_CLOSE_HOUR) {
      base.setDate(base.getDate() + 1);
      base.setHours(BUSINESS_OPEN_HOUR, 0, 0, 0);
      isNextDay = true;
    }
    let normalBase = base;
    let cutoffRolled = false;
    if (!isNextDay && base.getHours() >= NORMAL_CUTOFF_HOUR) {
      normalBase = new Date(base);
      normalBase.setDate(normalBase.getDate() + 1);
      normalBase.setHours(BUSINESS_OPEN_HOUR, 0, 0, 0);
      cutoffRolled = true;
    }
    const day = new Date(normalBase);
    day.setHours(0, 0, 0, 0);
    const dateLabel = fmtOrderDate(day);
    const mk = (h1, h2) => {
      const s = new Date(day); s.setHours(h1, 0, 0, 0);
      const e = new Date(day); e.setHours(h2, 0, 0, 0);
      return { start: s, windowLabel: `${dateLabel} ${fmtClock(s)} to ${fmtClock(e)}` };
    };
    const bands = [
      { id: 'morning',   label: '🌅 Morning',   ...mk(8, 12) },
      { id: 'afternoon', label: '☀️ Afternoon', ...mk(12, 16) },
      { id: 'evening',   label: '🌆 Evening',   ...mk(16, 19) }
    ];

    // If we already rolled to a future day (order placed after closing, or
    // after the same-day cutoff), every band on that resolved day sits
    // comfortably more than 6 hours out — no further filtering needed.
    if (isNextDay || cutoffRolled) {
      return bands.map(({ id, label, windowLabel }) => ({ id, label, windowLabel }));
    }

    // Otherwise we're still looking at TODAY. Normal's own promise is a
    // minimum ~6-hour lead time (same threshold the single-window
    // Express/Normal calculation already uses below), so any band whose
    // start time is earlier than that has already effectively passed and
    // must not be offered. This was the actual bug: an order placed at
    // 1pm was still showing an 8am-12pm "Morning" slot for today, hours
    // after that window had already become unfulfillable.
    const earliestFeasible = addHrs(normalBase, 6);
    const feasibleToday = bands.filter(b => b.start >= earliestFeasible);
    if (feasibleToday.length > 0) {
      return feasibleToday.map(({ id, label, windowLabel }) => ({ id, label, windowLabel }));
    }

    // No band left today clears the minimum lead time — roll entirely to
    // tomorrow, where every band trivially does.
    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextLabel = fmtOrderDate(nextDay);
    const mkNext = (h1, h2) => {
      const s = new Date(nextDay); s.setHours(h1, 0, 0, 0);
      const e = new Date(nextDay); e.setHours(h2, 0, 0, 0);
      return `${nextLabel} ${fmtClock(s)} to ${fmtClock(e)}`;
    };
    return [
      { id: 'morning',   label: '🌅 Morning',   windowLabel: mkNext(8, 12) },
      { id: 'afternoon', label: '☀️ Afternoon', windowLabel: mkNext(12, 16) },
      { id: 'evening',   label: '🌆 Evening',   windowLabel: mkNext(16, 19) }
    ];
  }
  /* Resolves the buyer's chosen band to its window label, defaulting to
     morning if they haven't picked one yet (keeps existing flows working). */
  function getEffectiveNormalWindowLabel(supplierId) {
    const slots = getNormalDaySlots();
    const chosenId = getSupplierSlot(supplierId) || 'morning';
    const slot = slots.find(s => s.id === chosenId) || slots[0];
    return slot.windowLabel;
  }

  /* ── FARM PRODUCE (Tier 2) WEEKLY WINDOW ──
   * Orders taken all week, cutoff Wednesday 5pm (when we go collect from farmers).
   * Delivered Friday through Sunday of the batch that follows the cutoff.
   */
  function getFarmDeliveryWindowLabel(now) {
    now = now || new Date();
    const d = new Date(now);
    const sunday = new Date(d);
    sunday.setDate(d.getDate() - d.getDay());
    sunday.setHours(0, 0, 0, 0);

    let wed = new Date(sunday);
    wed.setDate(sunday.getDate() + 3);
    wed.setHours(17, 0, 0, 0);

    if (d.getTime() > wed.getTime()) wed.setDate(wed.getDate() + 7);

    const friday = new Date(wed); friday.setDate(wed.getDate() + 2);
    const sunday2 = new Date(wed); sunday2.setDate(wed.getDate() + 4);

    return `${fmtLongDate(friday)} – ${fmtLongDate(sunday2)}`;
  }

  /* ── CART TIER DETECTION ──
   * A cart is "farm" tier if any item's supplier is a farmer (bizType === 'farmer').
   * Mixed carts (farm + wholesale items together) are treated as farm-tier for now,
   * since farm produce genuinely can't move faster than the weekly collection run —
   * flag to Emmanuel: might be worth splitting mixed carts into two deliveries later.
   */
  /* Whole-cart helper: does ANY supplier in the cart need a distance-based
   * price? Both tiers do now — farm uses the same distance bands as
   * warehouse Normal speed, just without an Express option. */
  function cartNeedsDistance() {
    return getSupplierGroups().length > 0;
  }

  /* ── FORM STATE ── */
  let selectedPayment = null;
  let selectedNetwork = "mtn";
  let currentStep = 1;

  /* ── INIT ── */
  function init() {
    renderSupplierDeliveryPanels();
    renderSummary();
    goToStep(1);
  }

  /* ── PER-SUPPLIER DELIVERY PANELS ──
   * One panel per supplier in the cart:
   * - Farm tier: fixed weekly collection window, flat fee, no speed choice.
   * - Wholesale tier: live Express/Normal windows (real computed times), speed
   *   choice syncs with whatever was picked on the product page, if anything.
   */
  function renderSupplierDeliveryPanels() {
    const panel = document.getElementById("supplierDeliveryPanels");
    if (!panel) return;
    const groups = getSupplierGroups();

    panel.innerHTML = groups.map(g => {
      if (g.tier === "farm") {
        const windowLabel = getFarmDeliveryWindowLabel();
        const farmFee = getFarmGroupFee(g);
        const feeLine = farmFee != null
          ? `Delivery fee: <strong>GH₵ ${farmFee.toFixed(2)}</strong> (based on your distance and order weight).`
          : `Delivery fee: <a href="#" onclick="promptSetLocation();return false;" style="color:var(--green-dark);font-weight:700;">set your delivery location</a> to see the price.`;
        return `
          <div style="background:var(--green-pale);border:1px solid var(--green-light);border-radius:10px;padding:14px;font-size:13px;color:var(--green-dark);line-height:1.5;margin-bottom:10px;">
            🌾 <strong>${g.supplierName}</strong> (farm-sourced)<br/>
            We collect directly from farmers weekly, so orders placed by <strong>Wednesday 5pm</strong> are delivered
            <strong>${windowLabel}</strong>. ${feeLine}
          </div>`;
      }
      const options = getWholesaleDeliveryOptions();
      const chosenSpeed = getSupplierSpeed(g.supplierId);
      const slotChips = chosenSpeed === 'normal' ? `
          <div style="font-size:12px;color:var(--ink-3);margin:10px 0 6px;">Choose a time band:</div>
          <div class="zone-grid">
            ${getNormalDaySlots().map(s => `
              <div class="zone-card ${getSupplierSlot(g.supplierId) === s.id || (!getSupplierSlot(g.supplierId) && s.id === 'morning') ? 'selected' : ''}" onclick="selectSupplierSlot('${g.supplierId}','${s.id}')">
                <div class="zone-name">${s.label}</div>
                <div class="zone-fee" style="font-weight:600;">${s.windowLabel}</div>
              </div>`).join("")}
          </div>` : '';

      return `
        <div style="border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:10px;">
          <div style="font-size:13px;font-weight:700;margin-bottom:8px;">🏬 ${g.supplierName} (warehouse-sourced)</div>
          <div class="zone-grid" style="margin-bottom:4px;">
            ${options.map(o => `
              <div class="zone-card ${chosenSpeed === o.speed ? 'selected' : ''}" onclick="selectSupplierSpeed('${g.supplierId}','${o.speed}')">
                <div class="zone-name">${o.speed === 'express' ? '⚡ Express' : '🚚 Normal'}</div>
                <div class="zone-fee" style="font-weight:600;">${o.speed === 'normal' ? getEffectiveNormalWindowLabel(g.supplierId) : o.windowLabel}</div>
              </div>`).join("")}
          </div>
          ${slotChips}
        </div>`;
    }).join("");

    // Show/hide the distance checker depending on whether any wholesale supplier needs it
    const distanceWrapper = document.getElementById("distanceCheckWrapper");
    if (distanceWrapper) {
      if (cartNeedsDistance()) {
        distanceWrapper.style.display = "block";
        renderDistanceStatus();
      } else {
        distanceWrapper.style.display = "none";
      }
    }
  }

  function selectSupplierSpeed(supplierId, speed) {
    setSupplierSpeed(supplierId, speed);
    renderSupplierDeliveryPanels();
    renderSummary();
    clearErr("slot");
  }

  function selectSupplierSlot(supplierId, slotId) {
    setSupplierSlot(supplierId, slotId);
    renderSupplierDeliveryPanels();
    renderSummary();
  }

  /* ── DISTANCE STATUS DISPLAY ── */
  function renderDistanceStatus() {
    const statusEl = document.getElementById("distanceStatus");
    if (!statusEl) return;
    if (buyerLocation && buyerLocation.zoneId) {
      const zone = ZONES.find(z => z.id === buyerLocation.zoneId);
      statusEl.innerHTML = zone
        ? `<span style="color:var(--green-mid);font-weight:700;">✓ Delivery distance confirmed</span> — ${buyerLocation.manual ? 'manually selected range' : Math.round(buyerLocation.distanceKm) + ' km from our base'}`
        : "";
    } else {
      statusEl.innerHTML = `<span style="color:var(--ink-3);">Tap the button above so we can calculate your delivery price.</span>`;
    }
  }

  /* ── CHECK DELIVERY PRICE (auto distance via address) ──
   * Geocodes the typed address + gets driving distance from the depot, then
   * silently maps it to a price band. Falls back to a manual range picker
   * if the address can't be resolved automatically.
   */
  async function checkDeliveryPrice() {
    const addressInput = document.getElementById("address");
    const address = addressInput ? addressInput.value.trim() : "";
    const statusEl = document.getElementById("distanceStatus");
    const fallbackEl = document.getElementById("manualZoneFallback");
    if (!address) {
      clearErr("address");
      document.getElementById("address-err").classList.add("show");
      return;
    }
    fallbackEl.style.display = "none";
    statusEl.innerHTML = `<span style="color:var(--ink-3);">📍 Calculating distance from your address…</span>`;

    const result = await resolveBuyerLocation(address);
    if (result.ok) {
      renderDistanceStatus();
      renderSummary();
      clearErr("zone");
    } else {
      let msg = "We couldn't automatically work out your distance from that address.";
      if (result.reason === "out_of_range") {
        msg = `That's about ${Math.round(result.distanceKm)} km away — a little beyond our normal delivery radius. Please pick the closest range below, or contact us to confirm we can reach you.`;
      }
      statusEl.innerHTML = `<span style="color:#b45309;">⚠ ${msg}</span>`;
      fallbackEl.style.display = "block";
      fallbackEl.innerHTML = `
        <div style="font-size:12px;color:var(--ink-3);margin-bottom:6px;">Select the closest range to your location:</div>
        <div class="zone-grid">
          ${ZONES.map(z => `
            <div class="zone-card ${buyerLocation && buyerLocation.zoneId === z.id && buyerLocation.manual ? 'selected' : ''}" onclick="selectManualZone('${z.id}')">
              <div class="zone-name">${z.name}</div>
            </div>`).join("")}
        </div>`;
    }
  }

  function selectManualZone(zoneId) {
    buyerLocation = { manual: true, zoneId };
    renderDistanceStatus();
    renderSummary();
    clearErr("zone");
    const fallbackEl = document.getElementById("manualZoneFallback");
    if (fallbackEl) {
      fallbackEl.querySelectorAll(".zone-card").forEach(el => el.classList.remove("selected"));
      event.currentTarget.classList.add("selected");
    }
  }

  function selectDeliveryMode(mode) {
    deliveryMode = mode;

    // Show/hide zone/delivery-panel section
    const zoneSection = document.getElementById("zoneSectionWrapper");
    const addressSection = document.getElementById("addressField");
    const noteSection = document.getElementById("noteField");

    if (mode === "delivery") {
      zoneSection.style.display = "block";
      addressSection.style.display = "block";
      noteSection.style.display = "block";
    } else {
      // pickup — no address or distance needed
      zoneSection.style.display = "none";
      addressSection.style.display = "none";
      noteSection.style.display = "none";
    }

    // Highlight selected mode card
    document.getElementById("mode-delivery").classList.toggle("selected", mode === "delivery");
    document.getElementById("mode-pickup").classList.toggle("selected", mode === "pickup");

    clearErr("deliveryMode");
    renderSupplierDeliveryPanels();
    renderSummary();
  }

  /* ── PAYMENT ── */
  function selectPayment(method) {
    selectedPayment = method;
    document.querySelectorAll(".payment-option").forEach(el => el.classList.remove("selected"));
    document.getElementById("pay-" + method).classList.add("selected");
    document.getElementById("momoFields").classList.toggle("show", method === "momo");
    clearErr("payment");
  }

  function selectNetwork(net) {
    selectedNetwork = net;
    ["mtn","voda","airteltigo"].forEach(n => {
      document.getElementById("tab-" + n).classList.toggle("active", n === net);
    });
  }

  /* ── ORDER SUMMARY ── */
  function getCartItems() {
    return Object.keys(cart)
      .filter(id => cart[id] > 0)
      .map(id => ({ product: PRODUCTS.find(p => String(p.id) === String(id)), qty: cart[id] }))
      .filter(x => x.product);
  }

  /* ── SUPPLIER GROUPING (per-supplier delivery fee) ──
   * One delivery fee is charged per unique supplier in the cart, not per item/quantity —
   * buying 3 units from the same supplier is still one pickup stop, so it's one fee.
   * Buying from 2 different suppliers means 2 separate pickup stops, so it's 2 fees.
   * This mirrors how Jumia splits orders by seller/pickup station.
   */
  function getSupplierGroups() {
    const items = getCartItems();
    const allUsers = (window.SL.getUsers && window.SL.getUsers()) || [];
    const groups = {};
    const order = [];
    items.forEach(x => {
      const supId = x.product.supplierId;
      const tier = window.SL.getProductTier(x.product); // per-product now, not per-supplier-account
      const groupKey = supId + '::' + tier;
      if (!groups[groupKey]) {
        const supplier = allUsers.find(u => u.id === supId);
        groups[groupKey] = {
          supplierId: supId,
          supplierName: supplier ? (supplier.name || supplier.phone) : "Unknown supplier",
          tier: tier,
          items: [],
          subtotal: 0
        };
        order.push(groupKey);
      }
      groups[groupKey].items.push(x);
      groups[groupKey].subtotal += x.product.markedUpPrice * x.qty;
    });
    return order.map(id => groups[id]);
  }

  /* Fee for one farm-tier supplier group: distance band (same table as
   * warehouse Normal speed) + weight surcharge above the allowance.
   * Returns null if the buyer's delivery distance isn't resolved yet. */
  function getFarmGroupFee(g) {
    if (!buyerLocation || !buyerLocation.zoneId) return null;
    const zone = ZONES.find(z => z.id === buyerLocation.zoneId);
    if (!zone) return null;
    const totalWeightKg = (g.items || []).reduce((s, x) => s + getProductWeightKg(x.product) * x.qty, 0);
    const extraKg = Math.max(0, totalWeightKg - FARM_WEIGHT_ALLOWANCE_KG);
    const surcharge = Math.ceil(extraKg / FARM_WEIGHT_INCREMENT_KG) * FARM_WEIGHT_INCREMENT_FEE;
    return zone.normal + surcharge;
  }
  window.getFarmGroupFee = getFarmGroupFee;

  /* Fee for one supplier group. Returns a number, or null if it can't be
   * determined yet (speed not chosen, or distance not resolved). */
  function getGroupFee(g) {
    if (g.tier === "farm") return getFarmGroupFee(g);
    const speed = getSupplierSpeed(g.supplierId);
    if (!speed) return null;
    if (!buyerLocation || !buyerLocation.zoneId) return null;
    const zone = ZONES.find(z => z.id === buyerLocation.zoneId);
    return zone ? zone[speed] : null;
  }

  function getTotals() {
    const items = getCartItems();
    const subtotal = items.reduce((s, x) => s + x.product.markedUpPrice * x.qty, 0);
    const supplierGroups = getSupplierGroups();
    let delivery = 0;
    let pending = false;

    if (deliveryMode === "delivery") {
      supplierGroups.forEach(g => {
        const fee = getGroupFee(g);
        g.fee = fee;
        if (fee == null) pending = true;
        else delivery += fee;
      });
    } else if (deliveryMode === "pickup") {
      supplierGroups.forEach(g => { g.fee = 0; });
    } else {
      pending = true; // delivery mode not chosen yet
    }

    const preCreditTotal = subtotal + delivery;
    const cu = window.SL.currentUser ? window.SL.currentUser() : null;
    const walletBalance = (cu && window.SL.getWalletBalance) ? window.SL.getWalletBalance(cu.id) : 0;
    const wantsCredit = document.getElementById("useWalletCredit") ? document.getElementById("useWalletCredit").checked : true;
    const creditApplied = (walletBalance > 0 && wantsCredit) ? Math.min(walletBalance, preCreditTotal) : 0;

    return { subtotal, delivery, total: preCreditTotal - creditApplied, pending, supplierGroups, walletBalance, creditApplied };
  }

  function renderSummary() {
    const items = getCartItems();
    const { subtotal, delivery, total, pending, supplierGroups, walletBalance, creditApplied } = getTotals();

    document.getElementById("summaryItems").innerHTML = items.map(x => `
      <div class="summary-item">
        <div class="summary-emoji${(x.product.images && x.product.images.length) ? ' has-photo' : ''}">${(x.product.images && x.product.images.length) ? `<img src="${x.product.images[0]}" alt="${x.product.name}">` : x.product.emoji}</div>
        <div class="summary-item-name">${x.product.name}<br/><span class="summary-item-qty">× ${x.qty}</span></div>
        <div class="summary-item-price">GH₵ ${(x.product.markedUpPrice * x.qty).toFixed(2)}</div>
      </div>`).join("");

    const creditBox = document.getElementById("walletCreditBox");
    if (creditBox) {
      if (walletBalance > 0) {
        creditBox.style.display = "block";
        document.getElementById("walletCreditAmount").textContent = "GH₵" + walletBalance.toFixed(2);
      } else {
        creditBox.style.display = "none";
      }
    }

    const multiSupplier = supplierGroups.length > 1;
    const deliveryBreakdownHtml = (deliveryMode === "delivery" && multiSupplier && !pending)
      ? supplierGroups.map(g => `
          <div class="total-row" style="font-size:12px;color:var(--ink-3);">
            <span>&nbsp;&nbsp;↳ ${g.supplierName}${g.tier === 'farm' ? ' (farm)' : ''}</span><span>GH₵ ${g.fee.toFixed(2)}</span>
          </div>`).join("")
      : "";
    const deliveryValueHtml = pending
      ? '<span style="color:var(--ink-3);font-style:italic;">Select delivery options</span>'
      : (delivery === 0
          ? '<span style="color:var(--green-mid);font-weight:700;">' + (deliveryMode === 'pickup' ? 'Pickup (Free)' : 'Free') + '</span>'
          : 'GH₵ ' + delivery.toFixed(2));
    const creditRowHtml = creditApplied > 0
      ? `<div class="total-row" style="color:var(--green-mid);"><span>💰 SupplyLink Credit</span><span>− GH₵ ${creditApplied.toFixed(2)}</span></div>`
      : "";

    document.getElementById("summaryTotals").innerHTML = `
      <div class="total-row"><span>Subtotal</span><span>GH₵ ${subtotal.toFixed(2)}</span></div>
      <div class="total-row"><span>Delivery${multiSupplier && !pending ? ` <span style="font-weight:400;color:var(--ink-3);">(${supplierGroups.length} suppliers)</span>` : ''}</span><span>${deliveryValueHtml}</span></div>
      ${deliveryBreakdownHtml}
      ${creditRowHtml}
      <div class="total-row grand"><span>Total</span><span>GH₵ ${pending ? '—' : total.toFixed(2)}</span></div>`;
  }

  /* ── STEP NAVIGATION ── */
  function goToStep(n) {
    currentStep = n;
    document.querySelectorAll("#view-checkout .checkout-step").forEach((el, i) => {
      el.classList.toggle("active", i + 1 === n);
    });
    [1,2,3].forEach(i => {
      const indicator = document.getElementById("step-indicator-" + i);
      if (!indicator) return;
      indicator.classList.remove("active","done");
      if (i < n) indicator.classList.add("done");
      if (i === n) indicator.classList.add("active");
      // tick mark for done steps
      const dot = indicator.querySelector(".step-dot");
      if (dot) dot.textContent = i < n ? "✓" : i;
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goBack() {
    /* Only leaving checkout entirely needs to pop the history entry
     * pushed in proceedToCheckout — stepping backward within the wizard
     * is just a visual change, no history involved. The phone's back
     * button always exits checkout back to the catalogue in one press,
     * regardless of which step it's on — in-app "← Back"/"Edit" links
     * handle step-by-step navigation directly. */
    if (currentStep > 1) goToStep(currentStep - 1);
    else window.backToCatalogueFromCheckout();
  }

  /* ── VALIDATION ── */
  function showErr(id, msg) {
    const input = document.getElementById(id);
    const err   = document.getElementById(id + "-err");
    if (input)  input.classList.add("error");
    if (err)  { err.textContent = msg || err.textContent; err.classList.add("show"); }
  }

  function clearErr(id) {
    const input = document.getElementById(id);
    const err   = document.getElementById(id + "-err");
    if (input) input.classList.remove("error");
    if (err)   err.classList.remove("show");
  }

  function isValidGhanaPhone(num) {
    return /^(0[235678]\d{8})$/.test(num.trim());
  }

  /* ── STEP 1 SUBMIT ── */
  function submitStep1() {
    let valid = true;

    const name  = document.getElementById("fullName").value.trim();
    const phone = document.getElementById("phone").value.trim();

    if (!name)  { showErr("fullName"); valid = false; }
    if (!isValidGhanaPhone(phone)) { showErr("phone"); valid = false; }

    if (!deliveryMode) { showErr("deliveryMode", "Choose delivery or pickup"); valid = false; }

    if (deliveryMode === "delivery") {
      const address = document.getElementById("address").value.trim();
      if (!address) { showErr("address"); valid = false; }

      const groups = getSupplierGroups();
      const missingSpeed = groups.some(g => g.tier === "wholesale" && !getSupplierSpeed(g.supplierId));
      if (missingSpeed) { showErr("slot", "Choose a delivery speed for each supplier above"); valid = false; }

      if (cartNeedsDistance() && (!buyerLocation || !buyerLocation.zoneId)) {
        showErr("zone", "We need your delivery distance to calculate the price"); valid = false;
      }
    }

    if (!valid) return;
    goToStep(2);
  }

  /* ── STEP 2 SUBMIT ── */
  function submitStep2() {
    let valid = true;

    if (!selectedPayment) { showErr("payment", "Select a payment method"); valid = false; }

    if (selectedPayment === "momo") {
      const momoNum  = document.getElementById("momoNumber").value.trim();
      const momoName = document.getElementById("momoName").value.trim();
      if (!isValidGhanaPhone(momoNum)) { showErr("momoNumber"); valid = false; }
      if (!momoName) { showErr("momoName"); valid = false; }
    }

    if (!valid) return;
    populateReview();
    goToStep(3);
  }

  /* ── POPULATE REVIEW ── */
  function populateReview() {
    const name    = document.getElementById("fullName").value.trim();
    const phone   = document.getElementById("phone").value.trim();
    const address = deliveryMode === "delivery" ? document.getElementById("address").value.trim() : "In-person pickup";
    const note    = deliveryMode === "delivery" ? document.getElementById("deliveryNote").value.trim() : "";
    const { supplierGroups } = getTotals();

    // Build one delivery-window line per supplier
    const windowLines = deliveryMode !== "delivery" ? [] : supplierGroups.map(g => {
      if (g.tier === "farm") {
        return `🌾 ${g.supplierName}: arriving ${getFarmDeliveryWindowLabel()}`;
      }
      const speed = getSupplierSpeed(g.supplierId);
      const opt = getWholesaleDeliveryOptions().find(o => o.speed === speed);
      return opt ? `🏬 ${g.supplierName}: ${speed === 'express' ? '⚡ Express' : '🚚 Normal'} · ${speed === 'normal' ? getEffectiveNormalWindowLabel(g.supplierId) : opt.windowLabel}` : `🏬 ${g.supplierName}: pending`;
    });

    document.getElementById("review-name").textContent    = name;
    document.getElementById("review-phone").textContent   = phone;
    document.getElementById("review-address").textContent = address + (note ? ` · ${note}` : "");
    document.getElementById("review-zone").textContent    = deliveryMode === "pickup"
      ? "🏪 In-person pickup · Free"
      : (buyerLocation && buyerLocation.zoneId ? (ZONES.find(z => z.id === buyerLocation.zoneId) || {}).name || "" : "");
    document.getElementById("review-slot").textContent    = windowLines.join(" · ");

    let payText = "";
    if (selectedPayment === "momo") {
      const net = { mtn:"MTN MoMo", voda:"Vodafone Cash", airteltigo:"AirtelTigo Money" }[selectedNetwork];
      const momoNum = document.getElementById("momoNumber").value.trim();
      payText = `📱 ${net} · ${momoNum}`;
    } else {
      payText = "💵 Pay on Delivery";
    }
    document.getElementById("review-payment").textContent = payText;

    const items = getCartItems();
    document.getElementById("review-items").innerHTML = items.map(x => `
      <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px;">
        <span>${x.product.emoji} ${x.product.name} × ${x.qty}</span>
        <span style="font-family:var(--font-mono);font-weight:700;color:var(--green-deep);">GH₵ ${(x.product.markedUpPrice * x.qty).toFixed(2)}</span>
      </div>`).join("") +
      (() => {
        const { total, supplierGroups } = getTotals();
        const breakdown = (deliveryMode === "delivery" && supplierGroups.length > 1)
          ? `<div style="padding:4px 0 2px;font-size:12px;color:var(--ink-3);">
              Delivery breakdown:
              ${supplierGroups.map(g => `<br/>&nbsp;&nbsp;↳ ${g.supplierName} — GH₵ ${(g.fee || 0).toFixed(2)}`).join("")}
            </div>`
          : "";
        return breakdown + `<div style="display:flex;justify-content:space-between;padding:10px 0 4px;font-size:15px;font-weight:800;border-top:1px solid var(--border);margin-top:4px;">
          <span>Total</span>
          <span style="font-family:var(--font-mono);color:var(--green-deep);">GH₵ ${total.toFixed(2)}</span>
        </div>`;
      })();
  }

  /* ── ATOMIC STOCK RESERVATION ──
     Runs BEFORE the order is created. Each item is decremented one at a
     time via a Postgres function that only succeeds if enough stock is
     still available at the moment the database processes it — this is
     what actually prevents two buyers from both winning the last unit,
     since the check-and-decrement happens as one atomic step on the
     server, not as a read-then-write in the browser. If any item in the
     cart fails, everything that DID succeed gets put back (rolled back)
     and the whole checkout is rejected — better a false "please retry"
     than a real oversold order. */
  async function reserveStockForCheckout(supplierGroups) {
    const allItems = supplierGroups.reduce((acc, g) => acc.concat(g.items), []);
    if (!window.SL_sb) {
      // Offline / no cloud connection — fall back to the old best-effort
      // local check. Can't be made atomic without a live DB, so this path
      // still carries the original race risk, but only when truly offline.
      return { ok: true, updates: [] };
    }
    const reserved = [];
    const failed = [];
    for (const x of allItems) {
      try {
        const { data, error } = await window.SL_sb.rpc('decrement_stock', { p_product_id: x.product.id, p_qty: x.qty });
        if (error) throw error;
        const row = data && data[0];
        if (row && row.success) {
          reserved.push({ id: x.product.id, qty: x.qty, newStock: row.new_stock, name: x.product.name });
        } else {
          failed.push({ name: x.product.name, available: row ? row.new_stock : 0 });
        }
      } catch (e) {
        console.error('Stock reservation failed for', x.product.id, e);
        failed.push({ name: x.product.name, available: null });
      }
    }
    if (failed.length > 0) {
      for (const r of reserved) {
        try { await window.SL_sb.rpc('increment_stock', { p_product_id: r.id, p_qty: r.qty }); }
        catch (e) { console.error('Stock rollback failed for', r.id, e); }
      }
      return { ok: false, failed };
    }
    return { ok: true, updates: reserved };
  }

  /* ── PLACE ORDER ── */
  function placeOrder() {
    const { total, delivery, supplierGroups, creditApplied, subtotal } = getTotals();
    const name     = document.getElementById("fullName").value.trim();
    const phone    = document.getElementById("phone").value.trim();
    const address  = deliveryMode === "delivery" ? document.getElementById("address").value.trim() : "In-person pickup";
    const note     = deliveryMode === "delivery" ? document.getElementById("deliveryNote").value.trim() : "";
    const zone     = (deliveryMode === "delivery" && buyerLocation && buyerLocation.zoneId) ? ZONES.find(z => z.id === buyerLocation.zoneId) : null;

    const payload = { name, phone, address, note, zone, total, delivery, supplierGroups, creditApplied, subtotal };

    if (selectedPayment === "momo") {
      /* 
       * INTEGRATION NOTE (Paystack MoMo):
       * Replace this block with actual Paystack initialization.
       * See comment in Step 2 for the full code snippet.
       * For now, we simulate a successful payment.
       */
      showProcessing("Sending MoMo prompt…");
      setTimeout(async () => {
        hideProcessing();
        const stockResult = await reserveStockForCheckout(supplierGroups);
        if (!stockResult.ok) {
          const lines = stockResult.failed.map(f => `• ${f.name} — only ${f.available ?? 0} left`).join('\n');
          alert('Sorry — some items sold out while you were checking out:\n\n' + lines + '\n\nPlease adjust your cart and try again. You have not been charged.');
          return;
        }
        window.__slReservedStockUpdates = stockResult.updates;
        try {
          showConfirmation(payload);
        } catch (e) {
          console.error('showConfirmation failed:', e);
          alert('Something went wrong placing your order:\n\n' + e.message + '\n\nYour cart has NOT been cleared. Please screenshot this and share it with support before retrying.');
        }
      }, 2200);
    } else {
      /* Pay on Delivery — no payment gateway needed */
      showProcessing("Placing your order…");
      setTimeout(async () => {
        hideProcessing();
        const stockResult = await reserveStockForCheckout(supplierGroups);
        if (!stockResult.ok) {
          const lines = stockResult.failed.map(f => `• ${f.name} — only ${f.available ?? 0} left`).join('\n');
          alert('Sorry — some items sold out while you were checking out:\n\n' + lines + '\n\nPlease adjust your cart and try again.');
          return;
        }
        window.__slReservedStockUpdates = stockResult.updates;
        try {
          showConfirmation(payload);
        } catch (e) {
          console.error('showConfirmation failed:', e);
          alert('Something went wrong placing your order:\n\n' + e.message + '\n\nYour cart has NOT been cleared. Please screenshot this and share it with support before retrying.');
        }
      }, 1400);
    }
  }

  /* Builds the human-readable delivery slot string for a set of supplier groups. */
  function buildSlotForGroups(groups) {
    if (deliveryMode !== "delivery") return "";
    return groups.map(g => {
      if (g.tier === "farm") return `${g.supplierName}: arriving ${getFarmDeliveryWindowLabel()}`;
      const speed = getSupplierSpeed(g.supplierId);
      const opt = getWholesaleDeliveryOptions().find(o => o.speed === speed);
      return opt ? `${g.supplierName}: ${speed === 'express' ? 'Express' : 'Normal'} · ${speed === 'normal' ? getEffectiveNormalWindowLabel(g.supplierId) : opt.windowLabel}` : `${g.supplierName}: pending`;
    }).join(" | ");
  }

  /* Builds one order record ready for window.SL.saveOrder(). Shared by both the
     single-order path and each half of a split (mixed farm + warehouse) order. */
  function buildOrderRecord({ id, name, phone, address, note, zone, groups, items, delivery, subtotal, total, creditApplied }) {
    /* Auto-assign to the supplier who actually listed the product(s) in
     * this order, instead of always leaving it "unassigned" for admin to
     * manually pick — the correct supplier is already known from the
     * cart data, so there's no reason to make admin do that lookup by
     * hand for the common case of one supplier per order. Only genuinely
     * ambiguous orders (items from more than one supplier) are left for
     * admin to resolve, same as before. Admin can still reassign either
     * way if the original supplier can't fulfill it. */
    const uniqueSuppliers = [...new Map(groups.map(g => [g.supplierId, g.supplierName])).entries()];
    const autoAssign = uniqueSuppliers.length === 1 ? uniqueSuppliers[0] : null;

    return {
      id,
      buyerId: window.SL.currentUser() ? window.SL.currentUser().id : null,
      buyerName: name,
      buyerPhone: phone,
      address, note,
      zone: zone ? zone.name : null,
      deliveryFee: delivery,
      creditApplied: creditApplied || 0,
      assignedSupplierId: autoAssign ? autoAssign[0] : null,
      assignedSupplier: autoAssign ? autoAssign[1] : null,
      autoAssigned: !!autoAssign,
      supplierBreakdown: groups.map(g => ({
        supplierId: g.supplierId,
        supplierName: g.supplierName,
        tier: g.tier,
        speed: g.tier === "farm" ? "normal" : getSupplierSpeed(g.supplierId),
        fee: g.fee
      })),
      slot: buildSlotForGroups(groups),
      payment: selectedPayment,
      items: items.map(x => ({
        productId: x.product.id,
        productName: x.product.name,
        supplierId: x.product.supplierId,
        supplierPrice: x.product.supplierPrice,
        buyerPrice: x.product.markedUpPrice,
        qty: x.qty
      })),
      subtotal, total,
      status: "pending",
      createdAt: Date.now()
    };
  }

  /* ── CONFIRMATION ──
     Mixed carts (farm-sourced + warehouse items together) genuinely can't move
     on one timeline — farm produce follows the weekly Wed-5pm-cutoff batch,
     warehouse goods can go out same/next day. Rather than force one artificial
     status onto both, a mixed cart becomes TWO independent orders here, each
     with its own id, delivery window, fee, status, rating and payout — so a
     fast warehouse delivery is never held hostage by the farm run, and vice versa. */
  /* Every unique supplier in the cart now gets its own separate order —
   * this used to only split farm-vs-warehouse into 2 orders, leaving
   * multiple warehouse suppliers tangled together in one order with no
   * single correct "assigned supplier". Since delivery fees were already
   * itemized per supplier even when combined, this costs the buyer
   * nothing extra — it's purely a re-organization so every order has
   * exactly one supplier, always, making auto-assignment fully reliable. */
  function showConfirmation({ name, phone, address, note, zone, total, delivery, supplierGroups, creditApplied, subtotal }) {
    /* Order's done — clear the step-by-step back history we built up
     * (checkout entry, step 2, step 3) so a back-press from here doesn't
     * replay old checkout screens with now-stale data. Uses the SILENT
     * cleanup (not slCloseAllOverlays) because that version calls the
     * pushed closeFn — which for checkout entry is
     * backToCatalogueFromCheckout(), i.e. it would immediately switch
     * the view back to the product page and hide the entire checkout
     * view (confirmation screen included) before anything below ever
     * got a chance to show. That was the actual bug: everything below
     * this line was running successfully — order saved, stock updated,
     * cart cleared — but invisibly, because the view had already been
     * swapped away by this cleanup call. */
    if (typeof window.slClearOverlayHistorySilently === 'function') window.slClearOverlayHistorySilently();
    document.getElementById("checkoutWrap").style.display = "none";
    document.getElementById("progressBar").style.display  = "none";

    const payLabel = selectedPayment === "momo"
      ? `MoMo · ${document.getElementById("momoNumber").value.trim()}`
      : "Pay on Delivery";

    const baseId = "SLM-" + Date.now().toString(36).toUpperCase();
    const isSplit = supplierGroups.length > 1;

    // Each group's pre-credit total (its own subtotal + its own delivery fee)
    const preTotals = supplierGroups.map(g => g.subtotal + (g.fee || 0));
    const preGrandTotal = preTotals.reduce((s, v) => s + v, 0);

    // Distribute any wallet credit used proportionally across the orders,
    // so they still add up exactly to what's actually charged. The last
    // group absorbs any rounding remainder rather than letting cents drift.
    let creditRemaining = creditApplied;
    const credits = supplierGroups.map((g, i) => {
      if (i === supplierGroups.length - 1) return Math.round(creditRemaining * 100) / 100;
      const c = preGrandTotal > 0 ? Math.round(creditApplied * preTotals[i] / preGrandTotal * 100) / 100 : 0;
      creditRemaining = Math.round((creditRemaining - c) * 100) / 100;
      return c;
    });

    const orderRecords = supplierGroups.map((g, i) => {
      const id = isSplit ? `${baseId}-${i + 1}` : baseId;
      const groupTotal = Math.max(0, preTotals[i] - credits[i]);
      return buildOrderRecord({
        id, name, phone, address, note, zone,
        groups: [g], items: g.items, delivery: g.fee || 0,
        subtotal: g.subtotal, total: groupTotal, creditApplied: credits[i]
      });
    });

    const grandTotal = orderRecords.reduce((s, r) => s + r.total, 0);

    /* ── CRITICAL PATH — must always run, even if anything below (UI
     * rendering, SMS, wallet) has a problem. Previously these ran last,
     * so any error earlier in this function (rendering, SMS, etc.) could
     * silently prevent the order from ever being saved or the cart from
     * ever being cleared — which is exactly backwards for the parts that
     * actually matter most. Each step is also individually wrapped so
     * one bad record (e.g. a stale product reference) can't take the
     * rest of the order — or the cart-clearing below — down with it. */
    orderRecords.forEach(rec => {
      try { window.SL.saveOrder(rec); }
      catch (e) { console.error('Failed to save order', rec.id, e); }
    });

    /* Remember exactly which order(s) this checkout just created, so the
     * "Track My Order" button on the confirmation screen can jump straight
     * to them instead of guessing from the full orders list (which was
     * showing stale/unrelated orders when array order didn't match recency). */
    window.lastPlacedOrderIds = orderRecords.map(rec => rec.id);

    // Stock was already atomically reserved (decremented) server-side in
    // reserveStockForCheckout(), before this function was ever called — this
    // just syncs the local cache to the authoritative numbers the DB gave
    // back, so the UI reflects it immediately without waiting for the next
    // 20s poll.
    const reservedUpdates = window.__slReservedStockUpdates || [];
    reservedUpdates.forEach(u => {
      try { window.SL.updateProduct(u.id, { stockQty: u.newStock }); }
      catch (e) { console.error('Failed to sync reserved stock for', u.id, e); }
    });
    window.__slReservedStockUpdates = null;

    try {
      const buyerForCredit = window.SL.currentUser ? window.SL.currentUser() : null;
      if (creditApplied > 0 && buyerForCredit && window.SL.adjustWallet) {
        window.SL.adjustWallet(buyerForCredit.id, -creditApplied);
      }
    } catch (e) { console.error('Failed to deduct wallet credit', e); }

    localStorage.removeItem(window.getCartStorageKey());
    sessionStorage.removeItem('slm_supplier_speeds');
    if (typeof window.resetCatalogueCartState === 'function') window.resetCatalogueCartState();
    /* ── END CRITICAL PATH ── */

    document.getElementById("confirmOrderId").textContent = isSplit
      ? `${orderRecords.length} orders created: ${orderRecords.map(r => r.id).join(', ')}`
      : `Order ID: ${orderRecords[0].id}`;

    let confirmHtml = "";
    if (isSplit) {
      confirmHtml += `
        <div style="background:#fff3cd;color:#8a6d1a;border-radius:10px;padding:10px 12px;font-size:12px;font-weight:600;margin-bottom:14px;">
          📦 Your cart had items from ${orderRecords.length} different suppliers, so we've split it into ${orderRecords.length} separate deliveries — each tracked and delivered independently.
        </div>`;
    }
    confirmHtml += `
      <div class="confirm-row"><span>Name</span><span>${name}</span></div>
      <div class="confirm-row"><span>Phone</span><span>${phone}</span></div>
      <div class="confirm-row"><span>Address</span><span>${address}</span></div>
      ${note ? `<div class="confirm-row"><span>Note</span><span>${note}</span></div>` : ''}
      <div class="confirm-row"><span>Payment</span><span>${payLabel}</span></div>`;

    supplierGroups.forEach((g, i) => {
      const rec = orderRecords[i];
      const itemSummary = g.items.map(x => x.qty + 'x ' + x.product.name).join(', ');
      const slot = buildSlotForGroups([g]);
      const tierEmoji = g.tier === 'farm' ? '🌾' : '🏬';
      confirmHtml += `
        <div style="border-top:1px dashed #ccc;margin:14px 0 10px;padding-top:10px;font-weight:700;">${tierEmoji} ${isSplit ? `Order ${i + 1} — ` : ''}${g.supplierName} (${rec.id})</div>
        <div class="confirm-row"><span>Items</span><span>${itemSummary}</span></div>
        <div class="confirm-row"><span>Arrives</span><span>${slot}</span></div>
        <div class="confirm-row"><span>Delivery</span><span>GH₵ ${(g.fee || 0).toFixed(2)}</span></div>
        ${credits[i] > 0 ? `<div class="confirm-row"><span>SupplyLink Credit</span><span>− GH₵ ${credits[i].toFixed(2)}</span></div>` : ''}
        <div class="confirm-row"><span style="font-weight:700;">${isSplit ? `Order ${i + 1} Total` : 'Total'}</span><span style="color:var(--green-deep);font-weight:700;">GH₵ ${rec.total.toFixed(2)}</span></div>`;
    });

    if (isSplit) {
      confirmHtml += `<div class="confirm-row" style="border-top:2px solid #1a472a;margin-top:14px;padding-top:10px;"><span style="font-weight:800;">Total Charged</span><span style="font-weight:800;color:var(--green-deep);">GH₵ ${grandTotal.toFixed(2)}</span></div>`;
    }

    document.getElementById("confirmDetails").innerHTML = confirmHtml;
    document.getElementById("confirmationScreen").classList.add("show");
    window.scrollTo({ top: 0, behavior: "smooth" });

    /* ── SMS: order confirmation (to buyer) — wrapped so a problem here
     * (e.g. a bad phone number) can never affect the order itself, which
     * is already safely saved by this point. ── */
    try {
      const buyerId = window.SL.currentUser ? (window.SL.currentUser() || {}).id : null;
      if (isSplit) {
        const slotLines = supplierGroups.map((g, i) =>
          `${orderRecords[i].id} (${g.supplierName}): ${buildSlotForGroups([g])}`).join('. ');
        const msg = 'Your order has been split into ' + orderRecords.length +
                   ' deliveries. ' + slotLines + '. Total charged: GH\u20B5' + grandTotal.toFixed(2) +
                   '. Thank you for shopping with us!';
        window.SL.sms({ to: phone, message: 'SupplyLink GH: Hi ' + name + ', ' + msg, event: 'order_placed_split', orderId: orderRecords[0].id });
        if (buyerId && window.SL.addNotification) {
          orderRecords.forEach(rec => window.SL.addNotification({ userId: buyerId, message: 'Order ' + rec.id + ' placed — arrives ' + rec.slot + '.', orderId: rec.id, type: 'order_placed' }));
        }
      } else {
        const itemSummary = supplierGroups[0].items.map(x => x.qty + 'x ' + x.product.name).join(', ');
        const msg = 'your order ' + orderRecords[0].id + ' has been received! ' +
                   'Items: ' + itemSummary + '. Total: GH\u20B5' + grandTotal.toFixed(2) + '. ' +
                   'We will confirm shortly. Thank you for shopping with us!';
        window.SL.sms({ to: phone, message: 'SupplyLink GH: Hi ' + name + ', ' + msg, event: 'order_placed', orderId: orderRecords[0].id });
        if (buyerId && window.SL.addNotification) {
          window.SL.addNotification({ userId: buyerId, message: 'Order ' + orderRecords[0].id + ' placed! Total: GH\u20B5' + grandTotal.toFixed(2) + '.', orderId: orderRecords[0].id, type: 'order_placed' });
        }
      }
    } catch (e) { console.warn('Buyer confirmation SMS/notification failed:', e); }

    /* ── WhatsApp share text ── */
    let shareLines = ['🛒 *SupplyLink Market — Order Confirmation*', ''];
    if (isSplit) {
      shareLines.push(`Your order was split into ${orderRecords.length} deliveries:`, '');
      supplierGroups.forEach((g, i) => {
        const itemSummary = g.items.map(x => x.qty + 'x ' + x.product.name).join(', ');
        shareLines.push(
          (g.tier === 'farm' ? '🌾 ' : '🏬 ') + orderRecords[i].id + ' — ' + g.supplierName,
          'Items: ' + itemSummary,
          'Arrives: ' + buildSlotForGroups([g]), ''
        );
      });
      shareLines.push('Total: GH\u20B5' + grandTotal.toFixed(2), 'Payment: ' + payLabel, '',
        'Thank you for shopping with SupplyLink Market! 🌿');
    } else {
      const itemSummary = supplierGroups[0].items.map(x => x.qty + 'x ' + x.product.name).join(', ');
      shareLines.push(
        'Order ID: ' + orderRecords[0].id,
        'Name: ' + name,
        'Items: ' + itemSummary,
        'Total: GH\u20B5' + grandTotal.toFixed(2),
        'Delivery: ' + (zone ? zone.name : 'Pickup') + ' · ' + buildSlotForGroups(supplierGroups),
        'Payment: ' + payLabel, '',
        'Thank you for shopping with SupplyLink Market! 🌿'
      );
    }

    /* ── Notify each auto-assigned supplier right away — same message
     * pattern as the admin's manual "Assign Supplier" action, just
     * triggered the moment the order comes in. Wrapped so a notification
     * problem for one supplier can never affect the others, or the order
     * itself (already saved above). ── */
    orderRecords.forEach(rec => {
      try {
        if (!rec.autoAssigned || !rec.assignedSupplierId) return;
        const allUsers = window.SL.getUsers() || [];
        const supplierUser = allUsers.find(u => u.id === rec.assignedSupplierId);
        if (supplierUser && supplierUser.phone) {
          const itemSummary = (rec.items || []).map(i => i.qty + 'x ' + i.productName).join(', ');
          window.SL.sms({
            to: supplierUser.phone,
            message: 'SupplyLink GH [SUPPLIER ALERT]: Hi ' + (supplierUser.name || '') + ', new order ' +
                     rec.id + '. Items needed: ' + itemSummary + '. Delivery slot: ' + (rec.slot || 'N/A') +
                     '. Please prepare ASAP.',
            event: 'supplier_auto_assigned',
            orderId: rec.id
          });
        }
        if (window.SL.addNotification) {
          window.SL.addNotification({
            userId: rec.assignedSupplierId,
            message: 'New order ' + rec.id + ' assigned to you — prepare ASAP.',
            orderId: rec.id,
            type: 'supplier_new_order'
          });
        }
      } catch (e) { console.warn('Supplier notification failed for', rec.id, e); }
    });

    lastOrderShareText = shareLines.join('\n');
  }

  let lastOrderShareText = "";
  function shareOrderWhatsApp() {
    if (!lastOrderShareText) { showToast("No order to share yet"); return; }
    window.open('https://wa.me/?text=' + encodeURIComponent(lastOrderShareText), '_blank');
  }

  function continueShopping() {
    window.slShowView('buyer-catalogue');
  }

  function trackOrder() {
    const orders = window.SL.getOrders();
    if (!orders || orders.length === 0) {
      showTrackingPanel(null);
      return;
    }

    /* Prefer the order(s) that were just created by the checkout that led
     * to this confirmation screen — this is the fix for the bug where
     * Track My Order showed a stale, unrelated order. Falling back to a
     * date-sort only if that reference is missing (e.g. panel reopened
     * from somewhere else in the app later). */
    if (window.lastPlacedOrderIds && window.lastPlacedOrderIds.length) {
      const justPlaced = window.lastPlacedOrderIds
        .map(id => orders.find(o => o.id === id))
        .filter(Boolean);
      if (justPlaced.length) {
        showTrackingPanel(justPlaced[0], false, window.lastPlacedOrderIds);
        return;
      }
    }

    const u = window.SL.currentUser();
    const myOrders = (u
      ? orders.filter(o => o.buyerId === u.id)
      : orders.slice()
    ).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    showTrackingPanel(myOrders[0] || null);
  }

  function closeTrackingPanel() {
    const el = document.getElementById('slTrackingPanel');
    if (el) el.remove();
    window.slPopOverlay();
  }
  window.closeTrackingPanel = closeTrackingPanel;

  /* Given any order, finds the other order(s) it was split from in the same
   * checkout (id pattern "SLM-XXXX-1", "SLM-XXXX-2", ...), so the tracking
   * panel can offer tabs to switch between them regardless of where it was
   * opened from (confirmation screen, Order History, etc). Returns just
   * [order.id] if the order wasn't part of a split checkout. */
  function getSiblingOrderIds(order) {
    if (!order || !order.id) return [];
    const m = /^(.+)-(\d+)$/.exec(order.id);
    if (!m) return [order.id];
    const prefix = m[1];
    const all = (window.SL.getOrders() || [])
      .filter(o => new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-\\d+$').test(o.id))
      .sort((a, b) => {
        const na = parseInt(/-(\d+)$/.exec(a.id)[1], 10);
        const nb = parseInt(/-(\d+)$/.exec(b.id)[1], 10);
        return na - nb;
      });
    return all.length ? all.map(o => o.id) : [order.id];
  }
  window.getSiblingOrderIds = getSiblingOrderIds;

  let currentTrackingSiblingIds = [];

  function showTrackingPanel(order, isSwap, siblingIds) {
    const alreadyOpen = !!document.getElementById('slTrackingPanel');
    const resolvedSiblings = (siblingIds && siblingIds.length) ? siblingIds : getSiblingOrderIds(order);
    renderTrackingPanel(order, resolvedSiblings);
    if (isSwap) window.slSwapOverlay(closeTrackingPanel);
    else if (!alreadyOpen) window.slPushOverlay(closeTrackingPanel);
  }

  /* Re-renders the panel in place (used when switching tabs between split
   * orders) without touching the back-button/overlay history stack, since
   * the panel itself isn't closing — the user is just looking at a
   * different order within the same checkout. */
  function switchTrackedOrder(orderId) {
    const order = (window.SL.getOrders() || []).find(o => o.id === orderId);
    renderTrackingPanel(order, currentTrackingSiblingIds);
  }
  window.switchTrackedOrder = switchTrackedOrder;

  function renderTrackingPanel(order, siblingIds) {
    /* Build a full-screen tracking overlay */
    const existing = document.getElementById('slTrackingPanel');
    if (existing) existing.remove();

    currentTrackingSiblingIds = (siblingIds && siblingIds.length > 1) ? siblingIds : [];

    const STATUS_STEPS = [
      { key: 'pending',    label: 'Order Placed',      icon: '📋', desc: 'Your order has been received and is awaiting confirmation.' },
      { key: 'confirmed',  label: 'Confirmed',          icon: '✅', desc: 'SupplyLink has confirmed your order with the supplier.' },
      { key: 'preparing',  label: 'Being Prepared',     icon: '📦', desc: 'Your items are being packed and prepared for delivery.' },
      { key: 'out',        label: 'Out for Delivery',   icon: '🚚', desc: 'Your order is on its way to you!' },
      { key: 'delivered',  label: 'Delivered',          icon: '🏠', desc: 'Your order has been delivered. Enjoy!' },
    ];

    const currentStatus = order ? (order.status || 'pending') : null;
    const currentIdx = STATUS_STEPS.findIndex(s => s.key === currentStatus);
    const activeIdx = currentIdx >= 0 ? currentIdx : 0;

    const stepsHTML = STATUS_STEPS.map((s, i) => {
      const done    = i < activeIdx;
      const active  = i === activeIdx;
      const pending = i > activeIdx;
      return `
        <div class="track-step ${done ? 'done' : ''} ${active ? 'active' : ''} ${pending ? 'pending' : ''}">
          <div class="track-step-icon">${done ? '✓' : s.icon}</div>
          <div class="track-step-info">
            <div class="track-step-label">${s.label}</div>
            ${active ? `<div class="track-step-desc">${s.desc}</div>` : ''}
          </div>
        </div>`;
    }).join('');

    const orderInfo = order ? `
      <div class="track-order-meta">
        <div class="track-meta-row"><span>Order ID</span><strong>${order.id}</strong></div>
        <div class="track-meta-row"><span>Date</span><strong>${new Date(order.createdAt || Date.now()).toLocaleDateString('en-GH', {day:'numeric',month:'short',year:'numeric'})}</strong></div>
        <div class="track-meta-row"><span>Total</span><strong style="color:var(--green-deep)">GH₵ ${(order.total || 0).toFixed(2)}</strong></div>
        <div class="track-meta-row"><span>Payment</span><strong>${order.payment === 'momo' ? '📱 MoMo' : '💵 Pay on Delivery'}</strong></div>
        <div class="track-meta-row"><span>Delivery</span><strong>${order.address === 'In-person pickup' ? '🏪 Pickup' : '🚚 ' + (order.zone || 'Zone TBD')}</strong></div>
      </div>` : '<p style="text-align:center;color:#888;padding:20px 0">No orders found yet.</p>';

    const tabsHTML = (order && currentTrackingSiblingIds.length > 1) ? `
      <div class="track-order-tabs">
        ${currentTrackingSiblingIds.map((id, i) => {
          const sibling = (window.SL.getOrders() || []).find(o => o.id === id);
          const isActive = id === order.id;
          const supplierName = sibling && window.SL.getOrderSupplierGroups
            ? (window.SL.getOrderSupplierGroups(sibling)[0] || {}).supplierName
            : null;
          return `<button class="track-order-tab ${isActive ? 'active' : ''}"
            onclick="window.switchTrackedOrder('${id}')">
            Order ${i + 1}${supplierName ? ' · ' + supplierName : ''}
          </button>`;
        }).join('')}
      </div>` : '';

    const panel = document.createElement('div');
    panel.id = 'slTrackingPanel';
    panel.style.cssText = `
      position:fixed; inset:0; z-index:2000;
      background:#f5f7f5; overflow-y:auto;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;`;
    panel.innerHTML = `
      <style>
        #slTrackingPanel .track-header {
          background:#1a472a; color:#fff; padding:16px 20px;
          display:flex; align-items:center; gap:12px; position:sticky; top:0; z-index:1;
        }
        #slTrackingPanel .track-back {
          background:rgba(255,255,255,.15); border:none; color:#fff;
          padding:8px 14px; border-radius:8px; cursor:pointer; font-size:14px;
        }
        #slTrackingPanel .track-title { font-size:18px; font-weight:700; }
        #slTrackingPanel .track-body  { padding:20px; max-width:520px; margin:0 auto; }
        #slTrackingPanel .track-step  {
          display:flex; gap:14px; padding:14px 0;
          border-left:3px solid #e0e0e0; margin-left:18px; padding-left:20px;
          position:relative;
        }
        #slTrackingPanel .track-step:last-child { border-left:3px solid transparent; }
        #slTrackingPanel .track-step-icon {
          position:absolute; left:-18px; width:32px; height:32px;
          background:#f0f0f0; border-radius:50%;
          display:flex; align-items:center; justify-content:center;
          font-size:14px; border:2px solid #e0e0e0; flex-shrink:0;
        }
        #slTrackingPanel .track-step.done .track-step-icon  { background:#1a472a; color:#fff; border-color:#1a472a; font-size:13px; font-weight:700; }
        #slTrackingPanel .track-step.active .track-step-icon{ background:#F59E0B; border-color:#F59E0B; font-size:16px; }
        #slTrackingPanel .track-step.done  { border-left-color:#1a472a; }
        #slTrackingPanel .track-step.active{ border-left-color:#F59E0B; }
        #slTrackingPanel .track-step-label { font-weight:600; font-size:15px; color:#1a1a1a; }
        #slTrackingPanel .track-step.pending .track-step-label { color:#aaa; }
        #slTrackingPanel .track-step-desc  { font-size:13px; color:#555; margin-top:4px; }
        #slTrackingPanel .track-order-meta { background:#fff; border-radius:12px; padding:16px; margin-bottom:20px; box-shadow:0 1px 4px rgba(0,0,0,.08); }
        #slTrackingPanel .track-order-tabs { display:flex; gap:8px; margin-bottom:14px; overflow-x:auto; -webkit-overflow-scrolling:touch; }
        #slTrackingPanel .track-order-tab {
          flex:0 0 auto; background:#fff; border:1.5px solid #e0e0e0; color:#555;
          padding:8px 14px; border-radius:20px; font-size:12.5px; font-weight:600;
          cursor:pointer; white-space:nowrap;
        }
        #slTrackingPanel .track-order-tab.active { background:#1a472a; border-color:#1a472a; color:#fff; }
        #slTrackingPanel .track-meta-row   { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #f0f0f0; font-size:14px; }
        #slTrackingPanel .track-meta-row:last-child { border-bottom:none; }
        #slTrackingPanel .track-section-label { font-size:11px; font-weight:700; color:#888; letter-spacing:1px; text-transform:uppercase; margin:20px 0 10px; }
        #slTrackingPanel .track-contact { background:#fff; border-radius:12px; padding:16px; margin-top:20px; text-align:center; box-shadow:0 1px 4px rgba(0,0,0,.08); }
        #slTrackingPanel .track-contact p { font-size:13px; color:#555; margin-bottom:12px; }
        #slTrackingPanel .track-call-btn { background:#1a472a; color:#fff; border:none; padding:12px 28px; border-radius:8px; font-size:14px; font-weight:600; cursor:pointer; }
      </style>
      <div class="track-header">
        <button class="track-back" onclick="window.closeTrackingPanel()">← Back</button>
        <div class="track-title">Track My Order</div>
      </div>
      <div class="track-body">
        <div class="track-section-label">Order Details</div>
        ${tabsHTML}
        ${orderInfo}
        ${order ? `
        <div class="track-section-label">Delivery Status</div>
        <div style="padding:10px 0 0">${stepsHTML}</div>
        ${order.status === 'delivered' && order.deliveryProof ? `
        <div class="track-order-meta" style="margin-top:16px;">
          <div style="font-size:13px;font-weight:700;margin-bottom:6px;">✓ Delivery Confirmed</div>
          <div style="font-size:12px;color:#555;">Received by <strong>${order.deliveryProof.recipientName}</strong> on ${new Date(order.deliveryProof.confirmedAt).toLocaleString('en-GH')}</div>
        </div>` : ''}
        ${(() => {
          if (order.status !== 'delivered') return '';
          const groups = window.SL.getOrderSupplierGroups(order);
          const unreviewed = groups.filter(sb => !window.SL.hasReviewed(order.id, sb.supplierId));
          if (!unreviewed.length) return '';
          return `<div class="track-order-meta" style="margin-top:20px;">
            <div style="font-size:14px;font-weight:700;margin-bottom:10px;">⭐ How was your order?</div>
            ${unreviewed.map(sb => `
              <button style="width:100%;margin-bottom:8px;background:#F59E0B;color:#fff;border:none;padding:11px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;"
                onclick="openRatingModal('${order.id}','${sb.supplierId}','${(sb.supplierName||'Supplier').replace(/'/g,"")}')">
                Rate ${sb.supplierName || 'Supplier'}
              </button>`).join('')}
          </div>`;
        })()}
        ${(() => {
          if (order.status === 'cancelled') return '';
          const refund = window.SL.getRefundForOrder(order.id);
          if (refund) {
            const rColor = refund.status === 'approved' ? '#1a472a' : refund.status === 'rejected' ? '#c0392b' : '#F59E0B';
            const rLabel = refund.status === 'approved'
              ? `✓ Refund approved · GH₵ ${(refund.amountRequested || 0).toFixed(2)} ${refund.method === 'wallet' ? 'credited to wallet' : 'refunded via MoMo'}`
              : refund.status === 'rejected'
                ? '✕ Refund request declined' + (refund.adminNote ? ' — ' + refund.adminNote : '')
                : '⏳ Refund request pending review';
            return `<div class="track-order-meta" style="margin-top:16px;font-size:13px;font-weight:600;color:${rColor};">${rLabel}</div>`;
          }
          return `<div style="margin-top:16px;">
            <button style="width:100%;background:#f1f3f5;color:#333;border:none;padding:12px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;"
              onclick="openRefundModal('${order.id}')">⚠️ Report an Issue / Refund</button>
          </div>`;
        })()}
        <div class="track-contact">
          <p>Need help with your order? Our delivery team is available 7am – 6pm daily.</p>
          <button class="track-call-btn" onclick="window.location.href='tel:+233200000000'">📞 Call Delivery Team</button>
        </div>` : ''}
      </div>`;
    document.body.appendChild(panel);
  }

  /* ── PROCESSING OVERLAY ── */
  function showProcessing(msg) {
    document.getElementById("processingText").textContent = msg || "Processing…";
    document.getElementById("processingOverlay").classList.add("show");
  }
  function hideProcessing() {
    document.getElementById("processingOverlay").classList.remove("show");
  }

  /* ── START ── */
  window.SL.registerInit('checkout', function() {
    // Reload cart from sessionStorage on every view entry
    cart = JSON.parse(localStorage.getItem(window.getCartStorageKey()) || '{}');

    // Reload live products from SL store
    const EMOJI_MAP = {"Vegetables":"🥦","Fruits":"🍊","Grains & Cereals":"🌾","Grains":"🌾",
               "Tubers":"🍠","Proteins":"🥩","Meat & Poultry":"🍗","Fish & Seafood":"🐟",
               "Cooking Oil":"🛢️","Spices & Herbs":"🧄","Spices":"🧄","Biscuits & Snacks":"🍪",
               "Drinks & Beverages":"🥤","Groceries":"🛒","Packaged Goods":"📦","Other":"📋"};
    PRODUCTS = window.SL.getProducts().map(p => ({
      id: p.id, name: p.name,
      emoji: EMOJI_MAP[p.category] || "🛒",
      unit: p.unit, weightKg: p.weightKg, markedUpPrice: p.buyerPrice,
      supplierId: p.supplierId, supplierPrice: p.supplierPrice,
      sourceType: p.sourceType
    }));

    // Reset step state
    selectedPayment = null;
    currentStep = 1;
    deliveryMode = null;
    supplierSpeeds = {};
    sessionStorage.removeItem('slm_supplier_speeds');

    // Undo whatever showConfirmation() hid/showed last time, so a fresh
    // order doesn't land back on the previous order's confirmation screen
    document.getElementById("checkoutWrap").style.display = "";
    document.getElementById("progressBar").style.display  = "";
    document.getElementById("confirmationScreen").classList.remove("show");

    // Guard: if cart is empty send back to catalogue
    const cartIds = Object.keys(cart).filter(id => cart[id] > 0);
    if (cartIds.length === 0) {
      window.slShowView('buyer-catalogue');
      return;
    }

    // ── AUTO-FILL from logged-in buyer profile ──
    // This ensures household and business buyers always get THEIR OWN data,
    // never each other's, and saves them from typing the same info repeatedly.
    const u = window.SL.currentUser();
    if (u && u.role === 'buyer') {
      const nameEl    = document.getElementById("fullName");
      const phoneEl   = document.getElementById("phone");
      const addressEl = document.getElementById("address");
      if (nameEl    && !nameEl.value)    nameEl.value    = u.name    || '';
      if (phoneEl   && !phoneEl.value)   phoneEl.value   = u.phone   || '';
      if (addressEl && !addressEl.value) addressEl.value = u.address || '';
    }

    // Safe init — null-check every element before touching it
    const deliveryPanels = document.getElementById("supplierDeliveryPanels");
    const summaryItems = document.getElementById("summaryItems");

    if (deliveryPanels) renderSupplierDeliveryPanels();
    if (summaryItems) renderSummary();
    goToStep(1);
  });

    /* expose inline-onclick functions to global scope */
    window.clearErr=clearErr; window.continueShopping=continueShopping;
    window.goBack=goBack; window.goToStep=goToStep; window.placeOrder=placeOrder;
    window.selectDeliveryMode=selectDeliveryMode; window.selectNetwork=selectNetwork;
    window.selectPayment=selectPayment; window.selectSupplierSpeed=selectSupplierSpeed; window.selectSupplierSlot=selectSupplierSlot;
    window.checkDeliveryPrice=checkDeliveryPrice; window.selectManualZone=selectManualZone;
    window.submitStep1=submitStep1;
    window.submitStep2=submitStep2; window.trackOrder=trackOrder;
    window.showTrackingPanel=showTrackingPanel; window.shareOrderWhatsApp=shareOrderWhatsApp;
    /* expose for reuse by Block 3 (product modal) */
    window.getSupplierTier=getSupplierTier; window.getWholesaleDeliveryOptions=getWholesaleDeliveryOptions;
    window.getFarmDeliveryWindowLabel=getFarmDeliveryWindowLabel; window.ZONES=ZONES;
    window.getSupplierSpeed=getSupplierSpeed; window.setSupplierSpeedGlobal=setSupplierSpeed;
    window.getBuyerLocation=function(){ return buyerLocation; };
    window.resolveBuyerLocation=resolveBuyerLocation;
    window.getFarmGroupFee=getFarmGroupFee;
  })();
  