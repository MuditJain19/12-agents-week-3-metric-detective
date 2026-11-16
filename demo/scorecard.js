// Runs the agent on every day that has 4 weeks of history and scores it against the planted problems:
// business incidents (find the right cause), data problems (call them data problems, not business ones),
// a planned sale (stay quiet) and normal days (stay quiet). Then runs the same days with data checks OFF.
const fs = require('fs');
const path = require('path');
const G = require('../src/generate.js'), R = require('../src/rca.js'), { LOGIC } = require('../src/logic.js');
const D = G.generate(42);
const expect = {
  upi_failure: { days: [61, 62], ok: f => f.drivers.some(d => d.metric === 'upi_success' && d.top[0].segment === 'Bengaluru' && d.top[0].rate_now < 0.7) },
  dairy_stockout: { days: [70, 71], ok: f => f.scope.city === 'Delhi' && f.categories[0].category === 'dairy' && ['Saket', 'Dwarka', 'Rohini'].every(s => f.stores_also_alerting.includes(s)) },
  new_user_campaign: { days: [78, 79, 80], ok: f => f.verdicts.aov === 'mix_shift' && f.verdicts.conversion === 'mix_shift' }
};
const dataDay = {};
G.DATA_INCIDENTS.forEach(di => { dataDay[di.day] = di; });
const incidentDay = {};
Object.entries(expect).forEach(([k, v]) => v.days.forEach(d => { incidentDay[d] = k; }));
const off = JSON.parse(JSON.stringify(LOGIC)); off.data_checks.enabled = false;
const rows = [];
let falseAlarms = 0, normalDays = 0, calcFails = 0, offFalse = 0;
for (let d = 28; d < G.DAYS; d++) {
  const o = R.run(D, G.dateOf(d));
  const noChecks = R.run(D, G.dateOf(d), off);
  o.findings.forEach(f => { if (!f.calc_ok) calcFails++; });
  const inc = incidentDay[d], di = dataDay[d];
  let result;
  if (d === 84) result = o.findings.length === 0 && o.event ? 'quiet on planned sale (correct)' : 'alerted on planned sale (wrong)';
  else if (inc) result = o.findings.length && o.findings.some(expect[inc].ok) ? 'caught, right cause' : (o.findings.length ? 'alerted, wrong cause' : 'missed');
  else if (di) {
    const flagged = o.data.set_aside.includes(di.store) && o.data.issues.some(i => i.date === G.dateOf(d) && i.store === di.store);
    result = flagged && !o.findings.length ? 'called a data problem (correct)' : (flagged ? 'data problem found, but also a business alert' : 'missed the data problem');
    if (noChecks.findings.length) offFalse++;
  } else { normalDays++; if (o.findings.length) { falseAlarms++; result = 'false alarm'; } else result = 'quiet (correct)'; if (noChecks.findings.length) offFalse++; }
  rows.push({ day: d, date: o.date, incident: inc || (di ? di.id : '') || (d === 84 ? 'anniversary_sale' : ''), findings: o.findings.length, set_aside: o.data.set_aside, result, without_data_checks: noChecks.findings.map(f => (f.scope.store || f.scope.city || 'all cities') + ': ' + f.alerts.map(a => a.kpi + ' ' + (a.pct * 100).toFixed(1) + '%').join(', ')) });
}
const summary = {
  days_scored: rows.length,
  incident_days: rows.filter(r => incidentDay[r.day]).length,
  incident_days_caught_with_right_cause: rows.filter(r => r.result === 'caught, right cause').length,
  data_problem_days: G.DATA_INCIDENTS.length,
  data_problems_called_correctly: rows.filter(r => r.result === 'called a data problem (correct)').length,
  planned_sale_quiet: rows.find(r => r.day === 84).result.includes('correct'),
  normal_days: normalDays,
  false_alarms: falseAlarms,
  calculation_check_failures: calcFails,
  without_data_checks_false_alarms_on_data_and_normal_days: offFalse
};
fs.writeFileSync(path.join(__dirname, 'scorecard.json'), JSON.stringify({ summary, rows }, null, 2));
console.log(summary);
rows.filter(r => r.incident || r.result !== 'quiet (correct)').forEach(r => console.log(r.day, r.date, r.incident, '->', r.result, r.without_data_checks.length ? '| without data checks: ' + r.without_data_checks.join(' / ') : ''));
