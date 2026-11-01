// Turns a run result into plain-English fact lines with fixed, pre-formatted numbers.
// The AI may only use these numbers; the checker compares against them.

const pct = x => (x * 100).toFixed(1) + '%';
const chg = x => (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
const inr = x => 'Rs ' + Math.round(x).toLocaleString('en-IN');
const n0 = x => Math.round(x).toLocaleString('en-IN');
const NAMES = { gmv: 'GMV', orders: 'orders', aov: 'average order value', sessions: 'app sessions', conversion: 'conversion (orders per session)' };
const fmtKpi = (k, v) => k === 'gmv' || k === 'aov' ? inr(v) : (k === 'conversion' ? pct(v) : n0(v));
const DIM = { user_type: 'user type', payment: 'payment method', city: 'city', store: 'store' };
const METRIC = { conversion: 'conversion', payment_success: 'payment success rate', aov: 'average order value', upi_success: 'UPI payment success rate' };
const fmtRate = (m, v) => m === 'aov' ? inr(v) : pct(v);

function facts(result) {
  const lines = [];
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
  });
  return lines;
}

// Numbers allowed in the email = numbers in the fact lines (plus the date parts).
function numbersIn(s) {
  return (String(s).replace(/(\d),(?=\d)/g, '$1').match(/\d+(?:\.\d+)?/g) || []);
}

function checkNumbers(text, factLines) {
  const allowed = new Set(numbersIn(factLines.join(' ')));
  const bad = numbersIn(text).filter(n => !allowed.has(n));
  return { ok: bad.length === 0, bad: [...new Set(bad)] };
}

if (typeof module !== 'undefined') module.exports = { facts, checkNumbers };
