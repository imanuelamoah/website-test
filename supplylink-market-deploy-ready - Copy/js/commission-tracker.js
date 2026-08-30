
  (function() {
    'use strict';
    
/* Live orders from shared SL store, flattened to per-item commission rows.
   Called fresh every render (not cached) so this screen reflects orders
   that arrive from cloud sync while it's sitting open. */
function loadOrders() {
  const TODAY_ISO = new Date().toISOString().slice(0, 10);
  return window.SL.getOrders().flatMap(o => {
    const date = o.createdAt
      ? new Date(o.createdAt).toISOString().slice(0, 10)
      : TODAY_ISO;
    return (o.items || []).map(item => ({
      id: o.id,
      date,
      product: item.productName || "Unknown",
      supplier: item.supplierName || "Unknown",
      supplierPrice: item.supplierPrice || 0,
      buyerPrice: item.buyerPrice || 0,
      qty: item.qty || 1,
      status: o.status || "pending"
    }));
  });
}

const TODAY = new Date().toISOString().slice(0, 10);
const STATUS_LABELS = { pending: 'Pending', confirmed: 'Confirmed', preparing: 'Being Prepared', out: 'Out for Delivery', delivered: 'Delivered', cancelled: 'Cancelled' };

function fmt(n) { return "GH\u20B5 " + (n || 0).toFixed(2); }
function commission(o) { return (o.buyerPrice - o.supplierPrice) * o.qty; }
function margin(o) {
  // Guards against a GH₵0 supplier price (promo/data-glitch item) producing
  // Infinity/NaN and quietly corrupting the average-margin calculation.
  if (!o.supplierPrice) return "0.0";
  return (((o.buyerPrice - o.supplierPrice) / o.supplierPrice) * 100).toFixed(1);
}

function filterByDate(orders, range) {
  return orders.filter(o => {
    if (range === "Today") return o.date === TODAY;
    if (range === "This Week") {
      const diff = (new Date(TODAY) - new Date(o.date)) / 86400000;
      return diff >= 0 && diff < 7;
    }
    if (range === "This Month") {
      const d = new Date(o.date); const t = new Date(TODAY);
      return d.getMonth() === t.getMonth() && d.getFullYear() === t.getFullYear();
    }
    if (range === "Last 30 Days") {
      const diff = (new Date(TODAY) - new Date(o.date)) / 86400000;
      return diff >= 0 && diff < 30;
    }
    if (range === "Last 90 Days") {
      const diff = (new Date(TODAY) - new Date(o.date)) / 86400000;
      return diff >= 0 && diff < 90;
    }
    return true;
  });
}

let activeRange = "This Month";
let activeTab = "orders";

function getFiltered() {
  const supplier = document.getElementById("supplier-filter").value;
  const status = document.getElementById("status-filter").value;
  const sortBy = document.getElementById("sort-by").value;
  let rows = filterByDate(loadOrders(), activeRange);
  if (supplier !== "All Suppliers") rows = rows.filter(o => o.supplier === supplier);
  if (status !== "All") rows = rows.filter(o => o.status === status);
  rows = [...rows].sort((a,b) => {
    if (sortBy === "date_desc") return new Date(b.date) - new Date(a.date);
    if (sortBy === "date_asc") return new Date(a.date) - new Date(b.date);
    if (sortBy === "commission_desc") return commission(b) - commission(a);
    if (sortBy === "commission_asc") return commission(a) - commission(b);
    return 0;
  });
  return rows;
}

function render() {
  const filtered = getFiltered();
  // Cancelled orders stay visible in the raw order-log table below (it's
  // meant to be a complete audit trail) but are excluded from every
  // monetary total and breakdown — counting commission on an order that
  // never actually happened would overstate real earnings. Their value is
  // still surfaced separately via the "Lost to Cancellations" card.
  const activeFiltered = filtered.filter(o => o.status !== "cancelled");
  const cancelledFiltered = filtered.filter(o => o.status === "cancelled");
  const delivered = activeFiltered.filter(o => o.status === "delivered");
  const totalComm = activeFiltered.reduce((s,o) => s + commission(o), 0);
  const confirmedComm = delivered.reduce((s,o) => s + commission(o), 0);
  const totalRev = activeFiltered.reduce((s,o) => s + o.buyerPrice * o.qty, 0);
  const avgMgn = activeFiltered.length ? (activeFiltered.reduce((s,o) => s + parseFloat(margin(o)), 0) / activeFiltered.length).toFixed(1) : "0.0";
  const cancelledComm = cancelledFiltered.reduce((s,o) => s + commission(o), 0);

  // Header
  document.getElementById("confirmed-amount").textContent = fmt(confirmedComm);
  // Stats
  document.getElementById("total-commission").textContent = fmt(totalComm);
  document.getElementById("total-orders").textContent = activeFiltered.length + " orders";
  document.getElementById("confirmed-commission").textContent = fmt(confirmedComm);
  document.getElementById("delivered-count").textContent = delivered.length + " delivered";
  document.getElementById("avg-margin").textContent = avgMgn + "%";
  document.getElementById("buyer-revenue").textContent = fmt(totalRev);
  document.getElementById("cancelled-commission").textContent = fmt(cancelledComm);
  document.getElementById("cancelled-count").textContent = cancelledFiltered.length + " cancelled";

  // Order table
  document.getElementById("order-count-label").textContent = "All Orders (" + filtered.length + ")";
  const tbody = document.getElementById("orders-tbody");
  tbody.innerHTML = "";
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty">No orders match this filter.</td></tr>';
  } else {
    filtered.forEach((o, i) => {
      const comm = commission(o);
      const mgn = margin(o);
      const barW = Math.min(100, parseFloat(mgn));
      tbody.innerHTML += `<tr style="background:${i%2===0?'#fff':'#F8FAF9'}">
        <td class="order-id">${o.id}</td>
        <td class="muted">${o.date}</td>
        <td>${o.product}</td>
        <td class="muted">${o.supplier}</td>
        <td style="text-align:center">${o.qty}</td>
        <td>${fmt(o.supplierPrice)}</td>
        <td class="bold">${fmt(o.buyerPrice)}</td>
        <td><span class="margin-val">${mgn}%</span><span class="mini-bar-wrap"><span class="mini-bar-fill" style="width:${barW}%"></span></span></td>
        <td class="commission">${fmt(comm)}</td>
        <td><span class="badge ${o.status}">${STATUS_LABELS[o.status] || (o.status.charAt(0).toUpperCase()+o.status.slice(1))}</span></td>
      </tr>`;
    });
  }
  const tfoot = document.getElementById("orders-tfoot");
  tfoot.innerHTML = activeFiltered.length > 0
    ? `<tr><td colspan="8" class="total-label">Total Commission (${activeFiltered.length} orders${cancelledFiltered.length ? `, excludes ${cancelledFiltered.length} cancelled` : ''})</td><td class="total-val">${fmt(totalComm)}</td><td></td></tr>`
    : "";

  // Supplier breakdown
  const supMap = {};
  activeFiltered.forEach(o => {
    if (!supMap[o.supplier]) supMap[o.supplier] = { orders:0, commission:0 };
    supMap[o.supplier].orders++;
    supMap[o.supplier].commission += commission(o);
  });
  const supRows = Object.entries(supMap).sort((a,b) => b[1].commission - a[1].commission);
  const supEl = document.getElementById("supplier-rows");
  supEl.innerHTML = supRows.length === 0 ? '<div class="empty">No data for this filter.</div>' :
    supRows.map(([name, data]) => {
      const pct = totalComm > 0 ? ((data.commission / totalComm)*100).toFixed(1) : 0;
      return `<div class="breakdown-row">
        <div class="breakdown-avatar">${name[0]}</div>
        <div class="breakdown-info">
          <div class="breakdown-name">${name}</div>
          <div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="breakdown-right">
          <div class="breakdown-amount">${fmt(data.commission)}</div>
          <div class="breakdown-meta">${data.orders} orders · ${pct}% of total</div>
        </div>
      </div>`;
    }).join("");

  // Product breakdown
  const prodMap = {};
  activeFiltered.forEach(o => {
    if (!prodMap[o.product]) prodMap[o.product] = { orders:0, commission:0, margin: parseFloat(margin(o)) };
    prodMap[o.product].orders++;
    prodMap[o.product].commission += commission(o);
  });
  const prodRows = Object.entries(prodMap).sort((a,b) => b[1].commission - a[1].commission);
  const prodEl = document.getElementById("product-rows");
  prodEl.innerHTML = prodRows.length === 0 ? '<div class="empty">No data for this filter.</div>' :
    prodRows.map(([name, data], i) => {
      const pct = totalComm > 0 ? ((data.commission / totalComm)*100).toFixed(1) : 0;
      return `<div class="breakdown-row">
        <div class="breakdown-avatar product">${i+1}</div>
        <div class="breakdown-info">
          <div class="breakdown-name">${name}</div>
          <div class="breakdown-sub">Avg margin: ${data.margin}%</div>
          <div class="bar-bg"><div class="bar-fill green" style="width:${pct}%"></div></div>
        </div>
        <div class="breakdown-right">
          <div class="breakdown-amount">${fmt(data.commission)}</div>
          <div class="breakdown-meta">${data.orders} orders · ${pct}% of total</div>
        </div>
      </div>`;
    }).join("");
}

// Events — scoped to #view-commission to avoid cross-block conflicts
function initCommissionEvents() {
  const root = document.getElementById('view-commission');
  if (!root) return;
  root.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      root.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeRange = btn.dataset.range;
      render();
    });
  });
  root.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      root.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeTab = btn.dataset.tab;
      ["orders","suppliers","products"].forEach(t => {
        document.getElementById("tab-"+t).style.display = t === activeTab ? "block" : "none";
      });
      render();
    });
  });
  document.getElementById("supplier-filter").addEventListener("change", render);
  document.getElementById("status-filter").addEventListener("change", render);
  document.getElementById("sort-by").addEventListener("change", render);
}

/* Populate supplier filter with real supplier names seen in orders,
   replacing the old hardcoded fake names that never matched real data */
function populateSupplierFilter() {
  const sel = document.getElementById("supplier-filter");
  const names = [...new Set(loadOrders().map(r => r.supplier).filter(Boolean))].sort();
  const current = sel.value;
  sel.innerHTML = '<option>All Suppliers</option>' + names.map(n => `<option>${n}</option>`).join('');
  if (names.includes(current)) sel.value = current;
}

window.SL.registerInit('commission-tracker', function() {
  ORDERS = loadOrders();
  activeRange = "This Month";
  activeTab = "orders";
  populateSupplierFilter();
  initCommissionEvents();
  render();
});

  })();
  