// Metric Detective: anomaly detection + root cause (mix vs rate) on daily data. No AI, no dependencies.

const KPIS = ['gmv', 'orders', 'aov', 'sessions', 'conversion'];
const THRESH = { total: 0.05, city: 0.08, store: 0.15 }; // minimum % move to alert, per scope
const Z_MIN = 3;
const FLOOR = { total: 0.015, city: 0.025, store: 0.04 }; // minimum noise level assumed, per scope

function buildIndex(D) {
  const byDate = {};
  const add = (date, key, row) => { (byDate[date] = byDate[date] || { funnel: [], orders: [], cats: [] })[key].push(row); };
  D.funnel.forEach(r => add(r.date, 'funnel', r));
  D.orders.forEach(r => add(r.date, 'orders', r));
  D.cats.forEach(r => add(r.date, 'cats', r));
  return { byDate, dates: Object.keys(byDate).sort(), calendar: D.calendar || [] };
}

const inScope = (r, scope) => !scope || ((!scope.city || r.city === scope.city) && (!scope.store || r.store === scope.store));

function totals(idx, dates, scope) {
  const t = { sessions: 0, checkouts: 0, pay_checkouts: 0, orders: 0, gmv: 0, items: 0 };
  for (const d of dates) {
    const b = idx.byDate[d];
    b.funnel.forEach(r => { if (inScope(r, scope)) { t.sessions += r.sessions; t.checkouts += r.checkouts; } });
    b.orders.forEach(r => { if (inScope(r, scope)) { t.pay_checkouts += r.checkouts; t.orders += r.orders; t.gmv += r.gmv; t.items += r.items; } });
  }
  const n = dates.length;
  Object.keys(t).forEach(k => { t[k] /= n; });
  t.aov = t.gmv / t.orders; t.conversion = t.orders / t.sessions; t.checkout_rate = t.checkouts / t.sessions;
  t.payment_success = t.orders / t.pay_checkouts; t.items_per_order = t.items / t.orders; t.price_per_item = t.gmv / t.items;
  return t;
}

function baselineDates(idx, date) {
  const i = idx.dates.indexOf(date);
  const out = [];
  for (let k = 1; k <= 4; k++) if (i - 7 * k >= 0) out.push(idx.dates[i - 7 * k]);
  return out.length === 4 ? out : null;
}

function median(a) { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

function check(idx, date, scope, level) {
  const base = baselineDates(idx, date);
  if (!base) return [];
  const now = totals(idx, [date], scope);
  const hist = base.map(d => totals(idx, [d], scope));
  const out = [];
  for (const k of KPIS) {
    const vals = hist.map(h => h[k]);
    const med = median(vals);
    const mad = median(vals.map(v => Math.abs(v - med))) * 1.4826;
    const scale = Math.max(mad, FLOOR[level] * Math.abs(med));
    const pct = (now[k] - med) / med;
    const z = (now[k] - med) / scale;
    if (Math.abs(pct) >= THRESH[level] && Math.abs(z) >= Z_MIN) out.push({ level, scope: scope || {}, kpi: k, now: now[k], usual: med, pct, z });
  }
  return out;
}

function detect(idx, date) {
  const cityOf = {};
  idx.byDate[date].funnel.forEach(r => { cityOf[r.store] = r.city; });
  const cities = [...new Set(Object.values(cityOf))];
  let alerts = check(idx, date, null, 'total');
  cities.forEach(c => { alerts = alerts.concat(check(idx, date, { city: c }, 'city')); });
  Object.keys(cityOf).forEach(s => { alerts = alerts.concat(check(idx, date, { city: cityOf[s], store: s }, 'store')); });
  const event = idx.calendar.find(e => e.date === date);
  return { date, event: event ? event.name : null, alerts: event ? [] : alerts, suppressed: event ? alerts.length : 0 };
}

// Mix vs rate for a ratio metric R = sum(num) / sum(den) split by a dimension.
function mixRate(rows0, rows1, dim, num, den, n0) {
  const seg = {};
  const put = (rows, which, div) => rows.forEach(r => {
    const k = r[dim]; seg[k] = seg[k] || { n0: 0, d0: 0, n1: 0, d1: 0 };
    seg[k][which === 0 ? 'n0' : 'n1'] += r[num] / div; seg[k][which === 0 ? 'd0' : 'd1'] += r[den] / div;
  });
  put(rows0, 0, n0); put(rows1, 1, 1);
  const D0 = Object.values(seg).reduce((a, s) => a + s.d0, 0), D1 = Object.values(seg).reduce((a, s) => a + s.d1, 0);
  const N0 = Object.values(seg).reduce((a, s) => a + s.n0, 0), N1 = Object.values(seg).reduce((a, s) => a + s.n1, 0);
  const R0 = N0 / D0, R1 = N1 / D1;
  let mix = 0, rate = 0;
  const segs = Object.entries(seg).map(([k, s]) => {
    const w0 = s.d0 / D0, w1 = s.d1 / D1, r0 = s.d0 ? s.n0 / s.d0 : 0, r1 = s.d1 ? s.n1 / s.d1 : 0;
    const m = (w1 - w0) * (r0 - R0), rt = w1 * (r1 - r0);
    mix += (w1 - w0) * r0; rate += rt;
    return { segment: k, share_before: w0, share_now: w1, rate_before: r0, rate_now: r1, mix_effect: m, rate_effect: rt };
  });
  segs.sort((a, b) => Math.abs(b.rate_effect) + Math.abs(b.mix_effect) - Math.abs(a.rate_effect) - Math.abs(a.mix_effect));
  const totalAbsRate = segs.reduce((a, x) => a + Math.abs(x.rate_effect), 0) || 1;
  return { dim, before: R0, now: R1, change: R1 - R0, mix_effect: mix, rate_effect: rate, concentration: Math.abs(segs[0].rate_effect) / totalAbsRate, segments: segs.length, top: segs.slice(0, 3) };
}

function rowsFor(idx, dates, scope, key) {
  let out = [];
  dates.forEach(d => { out = out.concat(idx.byDate[d][key].filter(r => inScope(r, scope))); });
  return out;
}

// Join funnel + orders at store x user_type so conversion can be split by user type, city or store.
function userRows(idx, dates, scope) {
  const m = {};
  rowsFor(idx, dates, scope, 'funnel').forEach(r => { const k = r.date + r.store + r.user_type; m[k] = Object.assign({ orders: 0, gmv: 0, items: 0 }, r); });
  rowsFor(idx, dates, scope, 'orders').forEach(r => { const k = r.date + r.store + r.user_type; m[k].orders += r.orders; m[k].gmv += r.gmv; m[k].items += r.items; });
  return Object.values(m);
}

function explain(idx, date, alerts) {
  const alert = alerts[0];
  const scope = alert.scope && alert.scope.city ? alert.scope : null;
  const base = baselineDates(idx, date);
  const b = totals(idx, base, scope), n = totals(idx, [date], scope);
  const ln = (x, y) => Math.log(x / y);
  const gmvL = ln(n.gmv, b.gmv);
  const tree = {
    gmv: { before: b.gmv, now: n.gmv },
    orders: { before: b.orders, now: n.orders, share_of_gmv_change: ln(n.orders, b.orders) / gmvL },
    aov: { before: b.aov, now: n.aov, share_of_gmv_change: ln(n.aov, b.aov) / gmvL },
    sessions: { before: b.sessions, now: n.sessions },
    conversion: { before: b.conversion, now: n.conversion },
    checkout_rate: { before: b.checkout_rate, now: n.checkout_rate },
    payment_success: { before: b.payment_success, now: n.payment_success },
    items_per_order: { before: b.items_per_order, now: n.items_per_order },
    price_per_item: { before: b.price_per_item, now: n.price_per_item }
  };
  const u0 = userRows(idx, base, scope), u1 = userRows(idx, [date], scope);
  const p0 = rowsFor(idx, base, scope, 'orders'), p1 = rowsFor(idx, [date], scope, 'orders');
  const dims = [
    mixRate(u0, u1, 'user_type', 'orders', 'sessions', base.length),
    mixRate(p0, p1, 'payment', 'orders', 'checkouts', base.length),
    mixRate(u0, u1, 'user_type', 'gmv', 'orders', base.length)
  ];
  dims[0].metric = 'conversion'; dims[1].metric = 'payment_success'; dims[2].metric = 'aov';
  if (!scope || !scope.store) {
    const geo = scope ? 'store' : 'city';
    const a = mixRate(u0, u1, geo, 'orders', 'sessions', base.length); a.metric = 'conversion'; dims.push(a);
    const c = mixRate(u0, u1, geo, 'gmv', 'orders', base.length); c.metric = 'aov'; dims.push(c);
    const pg = mixRate(p0.filter(r => r.payment === 'UPI'), p1.filter(r => r.payment === 'UPI'), geo, 'orders', 'checkouts', base.length); pg.metric = 'upi_success'; dims.push(pg);
  }
  const c0 = rowsFor(idx, base, scope, 'cats'), c1 = rowsFor(idx, [date], scope, 'cats');
  const cat = {};
  c0.forEach(r => { cat[r.category] = cat[r.category] || { items_before: 0, items_now: 0, stockout_hours_now: 0 }; cat[r.category].items_before += r.items / base.length; });
  c1.forEach(r => { cat[r.category].items_now += r.items; cat[r.category].stockout_hours_now += r.stockout_hours; });
  const categories = Object.entries(cat).map(([k, v]) => ({ category: k, items_before: v.items_before, items_now: v.items_now, change: v.items_now / v.items_before - 1, stockout_hours_now: v.stockout_hours_now }))
    .sort((x, y) => Math.abs(y.change) - Math.abs(x.change)).slice(0, 3);
  // Verdict: is the alerting ratio metric moved by mix or by behaviour?
  // Verdict per ratio metric that alerted: moved by mix (who showed up) or by behaviour (what they did)?
  const verdicts = {};
  alerts.filter(a => ['aov', 'conversion'].includes(a.kpi)).forEach(a => {
    const userSplit = dims.find(d => d.metric === a.kpi && d.dim === 'user_type');
    verdicts[a.kpi] = userSplit && Math.abs(userSplit.mix_effect) > 2 * Math.abs(userSplit.rate_effect) ? 'mix_shift' : 'behaviour_change';
  });
  return { date, scope: alert.scope, alerts: alerts.map(a => ({ kpi: a.kpi, now: a.now, usual: a.usual, pct: a.pct })), baseline_days: base, tree, drivers: dims, categories, verdicts };
}

// One run: detect, keep the most important alerts, explain each distinct scope.
function run(D, date) {
  const idx = buildIndex(D);
  const det = detect(idx, date);
  const rank = { total: 0, city: 1, store: 2 };
  const scopeKey = a => (a.scope.city || 'all') + '/' + (a.scope.store || '');
  const seen = {};
  const picked = [];
  det.alerts.sort((a, b) => rank[a.level] - rank[b.level] || Math.abs(b.z) - Math.abs(a.z)).forEach(a => {
    const k = scopeKey(a);
    const coveredByCity = a.level === 'store' && seen[a.scope.city + '/'];
    const coveredByTotal = a.level !== 'total' && seen['all/'];
    if (seen[k] || coveredByCity || coveredByTotal) return;
    seen[k] = true; picked.push(a);
  });
  const allFor = a => det.alerts.filter(x => scopeKey(x) === scopeKey(a)).sort((p, q) => Math.abs(q.z) - Math.abs(p.z));
  const findings = picked.map(a => {
    const f = explain(idx, date, allFor(a));
    f.level = a.level;
    f.stores_also_alerting = [...new Set(det.alerts.filter(x => x.level === 'store' && (a.level === 'total' || x.scope.city === a.scope.city)).map(x => x.scope.store))];
    return f;
  });
  return { date, event: det.event, suppressed_alerts: det.suppressed, alert_count: det.alerts.length, alerts: det.alerts.map(a => ({ level: a.level, scope: a.scope, kpi: a.kpi, pct: a.pct })), findings };
}

if (typeof module !== 'undefined') module.exports = { run, buildIndex, detect, explain };
