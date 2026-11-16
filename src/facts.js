// Turns a run result into plain-English fact lines with fixed, pre-formatted numbers.
// The AI may only use these numbers; the checker compares against them.

const pct = x => (x * 100).toFixed(1) + '%';
const chg = x => (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
const inr = x => 'Rs ' + Math.round(x).toLocaleString('en-IN');
const n0 = x => Math.round(x).toLocaleString('en-IN');
const NAMES = { gmv: 'GMV', orders: 'orders', aov: 'average order value', sessions: 'app sessions', conversion: 'conversion (orders per session)' };
const TREE_NAMES = { gmv: 'GMV', orders: 'orders', aov: 'average order value', sessions: 'sessions', conversion: 'conversion', checkout_rate: 'checkout rate', checkout_completion: 'checkout completion (checkouts that became orders)', items_per_order: 'items per order', price_per_item: 'price per item' };
const fmtKpi = (k, v) => k === 'gmv' || k === 'aov' ? inr(v) : (k === 'conversion' ? pct(v) : n0(v));
const DIM = { user_type: 'user type', payment: 'payment method', city: 'city', store: 'store' };
const METRIC = { conversion: 'conversion', payment_success: 'payment success rate', aov: 'average order value', upi_success: 'UPI payment success rate' };
const fmtRate = (m, v) => m === 'aov' ? inr(v) : pct(v);

function dataLines(result) {
  const d = result.data;
  if (!d || d.status === 'no_baseline') return [];
  if (d.status === 'ok') return [`Data checks passed for ${result.date}: all ${d.stores_checked} stores, on today and the 4 comparison days (${d.checks.join('; ')}).`];
  const groups = {}, out = [];
  d.issues.forEach(i => {
    // A duplicate load also makes the tables disagree; report the cause, not the symptom.
    if (i.check === 'tables_disagree' && d.issues.some(j => j.store === i.store && j.date === i.date && j.check === 'duplicate_rows')) return;
    const k = i.date + '|' + i.store + '|' + i.check;
    (groups[k] = groups[k] || []).push(i);
  });
  Object.values(groups).forEach(g => {
    const i = g[0];
    const detail = i.check === 'duplicate_rows' && g.length > 1
      ? `${i.store} has duplicate rows (the same data loaded twice): ${g.map(x => x.detail.match(/has (\d+) duplicate rows in the (\w+) table/)).map(m => m[1] + ' in the ' + m[2] + ' table').join(', ')}.`
      : g.map(x => x.detail).join(' ');
    out.push(`DATA PROBLEM${i.date !== result.date ? ` (on ${i.date}, one of the comparison days)` : ''}: ${detail}`);
  });
  if (d.status === 'no_data') out.push('No analysis today: there is no data to analyse.');
  else if (d.status === 'too_much_bad_data') out.push(`No analysis today: ${d.set_aside.length} of ${d.stores_checked} stores failed a data check, too many for a fair comparison.`);
  else out.push(`Set aside: ${d.set_aside.join(', ')}. Left out of today and the comparison days, so the other ${d.stores_checked - d.set_aside.length} stores are compared like for like.`);
  return out;
}

function facts(result, logic) {
  const lines = dataLines(result);
  if (result.event) lines.push(`Known event today: ${result.event}. ${result.suppressed_alerts} alerts were suppressed because the business calendar expects unusual numbers.`);
  result.findings.forEach((f, i) => {
    const where = f.scope.store ? `${f.scope.store} store (${f.scope.city})` : (f.scope.city ? f.scope.city : 'all cities');
    lines.push(`FINDING ${i + 1}: ${where}, ${result.date}, compared with the average of the same weekday over the previous 4 weeks.`);
    const t = f.tree;
    f.alerts.forEach(a => { const u = t[a.kpi].before, v = t[a.kpi].now; lines.push(`- ${NAMES[a.kpi]}: usual ${fmtKpi(a.kpi, u)}, today ${fmtKpi(a.kpi, v)} (${chg(v / u - 1)}).`); });
    lines.push(`- Funnel, usual vs today: app sessions ${n0(t.sessions.before)} vs ${n0(t.sessions.now)}; checkout rate ${pct(t.checkout_rate.before)} vs ${pct(t.checkout_rate.now)}; payment success ${pct(t.payment_success.before)} vs ${pct(t.payment_success.now)}; items per order ${t.items_per_order.before.toFixed(2)} vs ${t.items_per_order.now.toFixed(2)}.`);
    f.drivers.forEach(d => {
      const big = Math.abs(d.rate_effect) + Math.abs(d.mix_effect);
      const rel = big / (d.metric === 'aov' ? d.before : Math.max(d.before, 1e-9));
      if (rel < 0.02) return;
      if (['city', 'store'].includes(d.dim) && d.concentration < 0.5) return; // spread evenly across places: not a local cause
      const s = d.top[0];
      const kind = Math.abs(d.mix_effect) > 2 * Math.abs(d.rate_effect) ? 'MIX (the share of each group changed, not their behaviour)' : 'BEHAVIOUR (a group behaved differently)';
      lines.push(`- ${METRIC[d.metric]} by ${DIM[d.dim]}: overall ${fmtRate(d.metric, d.before)} -> ${fmtRate(d.metric, d.now)}; driver type ${kind}. Biggest segment: ${s.segment}, ${fmtRate(d.metric, s.rate_before)} -> ${fmtRate(d.metric, s.rate_now)}, share ${pct(s.share_before)} -> ${pct(s.share_now)}.`);
    });
    const itemsChange = (t.orders.now * t.items_per_order.now) / (t.orders.before * t.items_per_order.before) - 1;
    f.categories.filter(c => Math.abs((1 + c.change) / (1 + itemsChange) - 1) >= 0.15 || c.stockout_hours_now >= 6).forEach(c =>
      lines.push(`- Category ${c.category}: items ${n0(c.items_before)} usual vs ${n0(c.items_now)} today (${chg(c.change)}); out-of-stock hours today across stores ${c.stockout_hours_now}.`));
    Object.entries(f.verdicts || {}).forEach(([k, v]) => lines.push(`- Verdict for ${NAMES[k]}: ${v === 'mix_shift' ? 'MIX SHIFT. Each user group behaved normally; the drop comes from more low-spend or low-converting users in the mix. Not a problem in itself.' : 'BEHAVIOUR CHANGE. Something changed for a specific group.'}`));
    const st = f.stores_also_alerting;
    if (st.length) lines.push(st.length > 5 ? `- ${st.length} of 20 stores also moved beyond their own thresholds.` : `- Stores also alerting: ${st.join(', ')}.`);
    // KPI tree walk, from the primary KPI down.
    if (f.kpi_walk) {
      f.kpi_walk.steps.forEach(stp => lines.push(`- KPI tree: ${TREE_NAMES[stp.kpi]} ${chg(stp.change)} = ${stp.parts.map(p => `${TREE_NAMES[p.kpi]} ${chg(p.change)}`).join(' x ')}. Bigger mover: ${TREE_NAMES[stp.main]}.`));
      lines.push(`- Main path down the KPI tree: ${f.kpi_walk.path.map(k => TREE_NAMES[k]).join(' -> ')}.`);
    }
    // Calculation checks.
    if (f.calc_checks) {
      const failed = f.calc_checks.filter(c => !c.ok);
      lines.push(failed.length ? `- CALCULATION CHECK FAILED: ${failed.map(c => c.detail).join('; ')}.` : `- Calculation checks passed: ${f.calc_checks.map(c => c.detail).join('; ')}.`);
    }
    // Analyst context that applies to this finding.
    const L = logic || defaultLogic();
    const tags = new Set(f.alerts.map(a => a.kpi));
    f.drivers.forEach(dd => { tags.add(dd.metric); tags.add(dd.dim); });
    const allItems = (t.orders.now * t.items_per_order.now) / (t.orders.before * t.items_per_order.before) - 1;
    f.categories.filter(c => Math.abs((1 + c.change) / (1 + allItems) - 1) >= 0.15 || c.stockout_hours_now >= 6).forEach(c => tags.add(c.category));
    (L.context || []).filter(c => c.tags.some(t => tags.has(t) && relevant(t, f))).forEach(c => lines.push(`- Analyst context: ${c.note}`));
  });
  return lines;
}

function defaultLogic() { try { return LOGIC; } catch (e) { return require('./logic.js').LOGIC; } }

// A context note only applies if its tag is part of what actually moved.
function relevant(tag, f) {
  if (tag === 'upi_success' || tag === 'payment') return f.drivers.some(d => (d.metric === 'upi_success' || d.metric === 'payment_success') && Math.abs(d.change) / Math.max(d.before, 1e-9) >= 0.02);
  if (tag === 'user_type') return Object.values(f.verdicts || {}).includes('mix_shift');
  return true;
}

// Days with no business finding but a data problem get a fixed email: no AI, no cost.
function templateEmail(result) {
  const d = result.data || {};
  const issues = dataLines(result);
  if (d.status === 'no_data' || d.status === 'too_much_bad_data')
    return { subject: `Data problem: no analysis for ${result.date}`, body: issues.join('\n') + '\n\nFix the data pipeline, then re-run. No business conclusions were drawn.' };
  if (result.findings.length && result.findings.some(f => !f.calc_ok))
    return { subject: `Alert held back: a calculation check failed on ${result.date}`, body: facts(result).filter(l => /CALCULATION|DATA PROBLEM/.test(l)).join('\n') + '\n\nThe numbers did not add back up, so no explanation was sent. Check the KPI tree in logic.js.' };
  if (!result.findings.length && d.status === 'stores_set_aside' && d.issues.some(i => i.date === result.date))
    return { subject: `Data problem, no business alerts: ${d.set_aside.join(', ')} set aside on ${result.date}`, body: issues.join('\n') + `\n\nThe other ${d.stores_checked - d.set_aside.length} stores look normal. Ask the data team to reload ${d.set_aside.join(', ')} before anyone reads that store's numbers.` };
  return null; // either nothing to say, or a business alert that the AI writes up
}

const needsAI = result => result.findings.length > 0 && result.findings.every(f => f.calc_ok);

// Numbers allowed in the email = numbers in the fact lines (plus the date parts).
function numbersIn(s) {
  return (String(s).replace(/(\d),(?=\d)/g, '$1').match(/\d+(?:\.\d+)?/g) || []);
}

function checkNumbers(text, factLines) {
  const allowed = new Set(numbersIn(factLines.join(' ')));
  const bad = numbersIn(text).filter(n => !allowed.has(n));
  return { ok: bad.length === 0, bad: [...new Set(bad)] };
}

if (typeof module !== 'undefined') module.exports = { facts, checkNumbers, templateEmail, needsAI };
