// Metric Detective: data checks, anomaly detection, KPI-tree walk and root cause (mix vs behaviour)
// on daily data. No AI, no dependencies. The analyst-owned rules live in logic.js.

// In Node these come from the other files; inside the n8n Code node they are pasted in above this file.
function defaultLogic() { try { return LOGIC; } catch (e) { return require('./logic.js').LOGIC; } }
const CHK = (() => { try { return { dataChecks, calcChecks, DATA_CHECK_NAMES }; } catch (e) { return require('./checks.js'); } })();

const addDays = (s, n) => { const t = new Date(s + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

function buildIndex(D, skipStores) {
  const skip = skipStores && skipStores.size ? skipStores : null;
  const byDate = {};
  const add = (date, key, row) => { if (skip && skip.has(row.store)) return; (byDate[date] = byDate[date] || { funnel: [], orders: [], cats: [] })[key].push(row); };
  D.funnel.forEach(r => add(r.date, 'funnel', r));
  D.orders.forEach(r => add(r.date, 'orders', r));
  D.cats.forEach(r => add(r.date, 'cats', r));
  return { byDate, dates: Object.keys(byDate).sort() };
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
  t.checkout_completion = t.orders / t.checkouts; // share of checkouts that became orders
  t.payment_success = t.orders / t.pay_checkouts; // per payment attempt (includes retries), so it is not a tree node
  t.items_per_order = t.items / t.orders; t.price_per_item = t.gmv / t.items;
  return t;
}

// Same weekday over the previous N weeks, by calendar date (a missing day can't shift the weekday).
function baselineDates(idx, date, weeks) {
  const out = [];
  for (let k = 1; k <= weeks; k++) { const d = addDays(date, -7 * k); if (idx.byDate[d]) out.push(d); }
  return out.length === weeks ? out : null;
}

function median(a) { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

function check(idx, date, base, scope, level, L) {
  const now = totals(idx, [date], scope);
  const hist = base.map(d => totals(idx, [d], scope));
  const out = [];
  for (const k of L.kpis.primary.concat(L.kpis.secondary)) {
    const vals = hist.map(h => h[k]);
    const med = median(vals);
    const mad = median(vals.map(v => Math.abs(v - med))) * 1.4826;
    const scale = Math.max(mad, L.noise_floor[level] * Math.abs(med));
    const pct = (now[k] - med) / med;
    const z = (now[k] - med) / scale;
    if (Math.abs(pct) >= L.thresholds[level] && Math.abs(z) >= L.z_min) out.push({ level, scope: scope || {}, kpi: k, primary: L.kpis.primary.includes(k), now: now[k], usual: med, pct, z });
  }
  return out;
}

function detect(idx, date, base, L) {
  const cityOf = {};
  idx.byDate[date].funnel.forEach(r => { cityOf[r.store] = r.city; });
  const cities = [...new Set(Object.values(cityOf))];
  let alerts = check(idx, date, base, null, 'total', L);
  cities.forEach(c => { alerts = alerts.concat(check(idx, date, base, { city: c }, 'city', L)); });
  Object.keys(cityOf).forEach(s => { alerts = alerts.concat(check(idx, date, base, { city: cityOf[s], store: s }, 'store', L)); });
  const event = (L.calendar || []).find(e => e.date === date);
  return { date, event: event ? event.name : null, alerts: event ? [] : alerts, suppressed: event ? alerts.length : 0 };
}

// Mix vs behaviour for a ratio metric R = sum(num) / sum(den) split by a dimension.
// change = mix_effect + rate_effect exactly; the calculation check verifies it.
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

// Walk the KPI tree from the primary KPI: at every node, how much of the move each child explains.
function treeWalk(t, kpiTree, root) {
  const steps = [];
  const queue = [root];
  while (queue.length) {
    const p = queue.shift();
    const kids = kpiTree[p];
    if (!kids) continue;
    const lp = Math.log(t[p].now / t[p].before);
    const parts = kids.map(k => ({ kpi: k, change: t[k].now / t[k].before - 1, log: Math.log(t[k].now / t[k].before) }));
    const main = parts.slice().sort((a, b) => Math.abs(b.log) - Math.abs(a.log))[0].kpi;
    steps.push({ kpi: p, change: t[p].now / t[p].before - 1, log: lp, parts, main });
    kids.forEach(k => queue.push(k));
  }
  const path = [root];
  let cur = root;
  while (kpiTree[cur]) { cur = steps.find(s => s.kpi === cur).main; path.push(cur); }
  return { steps, path };
}

function explain(idx, date, base, alerts, L) {
  const alert = alerts[0];
  const scope = alert.scope && alert.scope.city ? alert.scope : null;
  const b = totals(idx, base, scope), n = totals(idx, [date], scope);
  const tree = {};
  ['gmv', 'orders', 'aov', 'sessions', 'conversion', 'checkout_rate', 'checkout_completion', 'payment_success', 'items_per_order', 'price_per_item']
    .forEach(k => { tree[k] = { before: b[k], now: n[k] }; });
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
  c1.forEach(r => { cat[r.category] = cat[r.category] || { items_before: 0, items_now: 0, stockout_hours_now: 0 }; cat[r.category].items_now += r.items; cat[r.category].stockout_hours_now += r.stockout_hours; });
  const categories = Object.entries(cat).map(([k, v]) => ({ category: k, items_before: v.items_before, items_now: v.items_now, change: v.items_now / v.items_before - 1, stockout_hours_now: v.stockout_hours_now }))
    .sort((x, y) => Math.abs(y.change) - Math.abs(x.change)).slice(0, 3);
  // Verdict per ratio metric that alerted: moved by mix (who showed up) or by behaviour (what they did)?
  const verdicts = {};
  alerts.filter(a => ['aov', 'conversion'].includes(a.kpi)).forEach(a => {
    const userSplit = dims.find(d => d.metric === a.kpi && d.dim === 'user_type');
    verdicts[a.kpi] = userSplit && Math.abs(userSplit.mix_effect) > 2 * Math.abs(userSplit.rate_effect) ? 'mix_shift' : 'behaviour_change';
  });
  const f = { date, scope: alert.scope, alerts: alerts.map(a => ({ kpi: a.kpi, primary: a.primary, now: a.now, usual: a.usual, pct: a.pct })), baseline_days: base, tree, drivers: dims, categories, verdicts };
  f.kpi_walk = treeWalk(tree, L.kpi_tree, L.kpis.primary[0]);
  // Calculation checks: the numbers must add back up before anyone sees them.
  let cityTotals = null, total = null;
  if (!scope) {
    const cities = [...new Set(idx.byDate[date].funnel.map(r => r.city))];
    cityTotals = cities.map(c => totals(idx, [date], { city: c }));
    total = n;
  }
  f.calc_checks = CHK.calcChecks(f, L.kpi_tree, cityTotals, total);
  f.calc_ok = f.calc_checks.every(c => c.ok);
  return f;
}

// Cache the raw index per dataset, so a 90-day replay doesn't rebuild it every day.
const RAW = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
function rawIndex(D) {
  if (RAW && RAW.has(D)) return RAW.get(D);
  const idx = buildIndex(D);
  if (RAW) RAW.set(D, idx);
  return idx;
}

// One run: check the data, set aside bad stores, detect, walk the KPI tree, explain, check the maths.
function run(D, date, logic) {
  const L = logic || defaultLogic();
  const raw = rawIndex(D);
  const cfg = L.data_checks || {};
  const checksOn = cfg.enabled !== false;
  const empty = { date, event: null, suppressed_alerts: 0, alert_count: 0, alerts: [], findings: [] };

  // 1. Data checks on today and on every comparison day.
  if (!raw.byDate[date]) return Object.assign(empty, { data: { status: 'no_data', issues: [{ date, store: '*', check: 'missing_day', detail: `No data at all for ${date}.` }], set_aside: [], stores_checked: 0, checks: CHK.DATA_CHECK_NAMES } });
  const base = baselineDates(raw, date, L.baseline_weeks);
  if (!base) return Object.assign(empty, { data: { status: 'no_baseline', issues: [], set_aside: [], stores_checked: 0, checks: CHK.DATA_CHECK_NAMES } });
  const master = [...new Set(base.concat([date]).flatMap(d => raw.byDate[d].funnel.map(r => r.store)))];
  const issues = checksOn ? base.concat([date]).flatMap(d => CHK.dataChecks(raw.byDate[d], d, master, cfg)) : [];
  if (issues.some(i => i.store === '*')) return Object.assign(empty, { data: { status: 'no_data', issues, set_aside: [], stores_checked: master.length, checks: CHK.DATA_CHECK_NAMES } });
  const setAside = new Set(issues.map(i => i.store));
  const data = { status: setAside.size ? 'stores_set_aside' : 'ok', issues, set_aside: [...setAside], stores_checked: master.length, checks: CHK.DATA_CHECK_NAMES };
  if (setAside.size / master.length > (cfg.max_stores_set_aside || 0.25)) return Object.assign(empty, { data: Object.assign(data, { status: 'too_much_bad_data' }) });

  // 2. Compare like with like: bad stores are left out of today AND the comparison weeks.
  const idx = setAside.size ? buildIndex(D, setAside) : raw;
  const det = detect(idx, date, base, L);
  const rank = { total: 0, city: 1, store: 2 };
  const scopeKey = a => (a.scope.city || 'all') + '/' + (a.scope.store || '');
  const seen = {};
  const picked = [];
  det.alerts.sort((a, b) => rank[a.level] - rank[b.level] || (b.primary - a.primary) || Math.abs(b.z) - Math.abs(a.z)).forEach(a => {
    const k = scopeKey(a);
    const coveredByCity = a.level === 'store' && seen[a.scope.city + '/'];
    const coveredByTotal = a.level !== 'total' && seen['all/'];
    if (seen[k] || coveredByCity || coveredByTotal) return;
    seen[k] = true; picked.push(a);
  });
  const allFor = a => det.alerts.filter(x => scopeKey(x) === scopeKey(a)).sort((p, q) => (q.primary - p.primary) || Math.abs(q.z) - Math.abs(p.z));
  const findings = picked.map(a => {
    const f = explain(idx, date, base, allFor(a), L);
    f.level = a.level;
    f.stores_also_alerting = [...new Set(det.alerts.filter(x => x.level === 'store' && (a.level === 'total' || x.scope.city === a.scope.city)).map(x => x.scope.store))];
    return f;
  });
  return { date, event: det.event, suppressed_alerts: det.suppressed, alert_count: det.alerts.length, alerts: det.alerts.map(a => ({ level: a.level, scope: a.scope, kpi: a.kpi, pct: a.pct })), findings, data, stores_analysed: master.length - setAside.size };
}

if (typeof module !== 'undefined') module.exports = { run, buildIndex, detect, explain, treeWalk, totals };
