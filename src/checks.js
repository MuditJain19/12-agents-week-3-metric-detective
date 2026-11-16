// Sanity checks. Two kinds:
// 1. Data checks, on the raw pull, before any analysis: is the data complete and believable?
// 2. Calculation checks, after the analysis: do the numbers add back up?
// No AI, no dependencies.

const NUMERIC = ['sessions', 'checkouts', 'orders', 'gmv', 'items', 'stockout_hours'];

// Data checks for one date. Returns a list of issues: { date, store, check, detail, numbers }.
function dataChecks(day, date, masterStores, cfg) {
  const issues = [];
  const add = (store, check, detail) => issues.push({ date, store, check, detail });
  if (!day || !day.funnel.length) { add('*', 'missing_day', `No data at all for ${date}.`); return issues; }

  // 1. Every store reported, in every table.
  for (const [table, rows] of Object.entries({ funnel: day.funnel, orders: day.orders, categories: day.cats })) {
    const seen = new Set(rows.map(r => r.store));
    masterStores.forEach(s => { if (!seen.has(s)) add(s, 'store_missing', `${s} has no rows in the ${table} table.`); });
  }

  // 2. No duplicate rows (a pipeline that loaded the same data twice).
  const keys = { funnel: r => r.store + '|' + r.user_type, orders: r => r.store + '|' + r.user_type + '|' + r.payment, categories: r => r.store + '|' + r.category };
  for (const [table, rows] of Object.entries({ funnel: day.funnel, orders: day.orders, categories: day.cats })) {
    const count = {};
    rows.forEach(r => { const k = keys[table](r); count[k] = (count[k] || 0) + 1; });
    const dupStores = {};
    Object.entries(count).forEach(([k, n]) => { if (n > 1) { const s = k.split('|')[0]; dupStores[s] = (dupStores[s] || 0) + n - 1; } });
    Object.entries(dupStores).forEach(([s, n]) => add(s, 'duplicate_rows', `${s} has ${n} duplicate rows in the ${table} table (the same data loaded twice).`));
  }

  // 3. No impossible values.
  const bad = {};
  const flag = (s, why) => { (bad[s] = bad[s] || new Set()).add(why); };
  [...day.funnel, ...day.orders, ...day.cats].forEach(r => NUMERIC.forEach(k => { if (k in r && !(r[k] >= 0)) flag(r.store, `negative or missing ${k}`); }));
  day.funnel.forEach(r => { if (r.checkouts > r.sessions) flag(r.store, 'more checkouts than sessions'); });
  day.orders.forEach(r => {
    if (r.orders > r.checkouts) flag(r.store, 'more orders than payment attempts');
    if (r.orders > 0 && !(r.gmv > 0)) flag(r.store, 'orders with no GMV');
    if (r.items < r.orders) flag(r.store, 'fewer items than orders');
  });
  Object.entries(bad).forEach(([s, why]) => add(s, 'impossible_values', `${s} has impossible values: ${[...why].join(', ')}.`));

  // 4. Data runs to the end of the day (a pipeline that stopped mid-day looks like a business crash).
  if (day.funnel.some(r => 'last_event_hour' in r)) {
    const last = {};
    day.funnel.forEach(r => { last[r.store] = Math.max(last[r.store] == null ? -1 : last[r.store], r.last_event_hour); });
    Object.entries(last).forEach(([s, h]) => { if (h < cfg.last_event_hour_min) add(s, 'data_stops_early', `${s} data stops at ${h}:00 on ${date}; a full day runs to 23:00.`); });
  }

  // 5. Tables agree with each other: items in the orders table vs items in the category table.
  const itemsO = {}, itemsC = {};
  day.orders.forEach(r => { itemsO[r.store] = (itemsO[r.store] || 0) + r.items; });
  day.cats.forEach(r => { itemsC[r.store] = (itemsC[r.store] || 0) + r.items; });
  Object.keys(itemsO).forEach(s => {
    if (itemsC[s] == null) return; // already reported as missing
    const gap = Math.abs(itemsO[s] - itemsC[s]) / Math.max(itemsO[s], 1);
    if (gap > cfg.cross_table_tolerance) add(s, 'tables_disagree', `${s}: items in the orders table (${itemsO[s]}) and the category table (${itemsC[s]}) differ by ${(gap * 100).toFixed(1)}%.`);
  });
  return issues;
}

const DATA_CHECK_NAMES = ['every store reported in every table', 'no duplicate rows', 'no impossible values', 'data runs to the end of the day', 'orders and category tables agree'];

// Calculation checks for one finding. Returns [{ check, ok, detail }].
function calcChecks(f, tree, cityTotals, total) {
  const out = [];
  const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-9);
  // 1. Each KPI equals the product of the KPIs under it, today and in the comparison weeks.
  const bad = [];
  Object.entries(tree).forEach(([p, kids]) => ['before', 'now'].forEach(w => {
    const prod = kids.reduce((a, k) => a * f.tree[k][w], 1);
    if (rel(prod, f.tree[p][w]) > 1e-6) bad.push(`${p} (${w}) is ${f.tree[p][w].toFixed(4)} but ${kids.join(' x ')} gives ${prod.toFixed(4)}`);
  }));
  out.push({ check: 'kpi_tree_multiplies_back', ok: !bad.length, detail: bad.length ? bad.join('; ') : 'each KPI equals the product of the KPIs under it' });
  // 2. Cities add up to the company total (only checked on company-wide findings).
  if (cityTotals && total) {
    const miss = ['sessions', 'orders', 'gmv'].filter(k => rel(cityTotals.reduce((a, c) => a + c[k], 0), total[k]) > 1e-9);
    out.push({ check: 'cities_add_to_total', ok: !miss.length, detail: miss.length ? `cities don't add up to the total for ${miss.join(', ')}` : 'cities add up to the company total' });
  }
  // 3. Mix and behaviour effects add up to each change.
  const off = f.drivers.filter(d => rel(d.mix_effect + d.rate_effect, d.change) > 1e-6 && Math.abs(d.change) > 1e-9);
  out.push({ check: 'mix_plus_behaviour_equals_change', ok: !off.length, detail: off.length ? `split by ${off.map(d => d.dim).join(', ')} doesn't add back up` : 'mix and behaviour effects add up to each change' });
  return out;
}

if (typeof module !== 'undefined') module.exports = { dataChecks, calcChecks, DATA_CHECK_NAMES };
