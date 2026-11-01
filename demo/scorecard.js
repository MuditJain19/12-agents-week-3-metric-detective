// Runs the detector on every day that has 4 weeks of history and scores it against the planted incidents.
const fs = require('fs');
const path = require('path');
const G = require('../src/generate.js'), R = require('../src/rca.js');
const D = G.generate(42);
const expect = {
  upi_failure: { days: [61, 62], ok: f => f.drivers.some(d => d.metric === 'upi_success' && d.top[0].segment === 'Bengaluru' && d.top[0].rate_now < 0.7) },
  dairy_stockout: { days: [70, 71], ok: f => f.scope.city === 'Delhi' && f.categories[0].category === 'dairy' && ['Saket', 'Dwarka', 'Rohini'].every(s => f.stores_also_alerting.includes(s)) },
  new_user_campaign: { days: [78, 79, 80], ok: f => f.verdicts.aov === 'mix_shift' && f.verdicts.conversion === 'mix_shift' }
};
const incidentDay = {};
Object.entries(expect).forEach(([k, v]) => v.days.forEach(d => { incidentDay[d] = k; }));
const rows = [];
let falseAlarms = 0, normalDays = 0;
for (let d = 28; d < G.DAYS; d++) {
  const o = R.run(D, G.dateOf(d));
  const inc = incidentDay[d];
  let result;
  if (d === 84) result = o.findings.length === 0 && o.event ? 'quiet on planned sale (correct)' : 'alerted on planned sale (wrong)';
  else if (inc) result = o.findings.length && o.findings.some(expect[inc].ok) ? 'caught, right cause' : (o.findings.length ? 'alerted, wrong cause' : 'missed');
  else { normalDays++; if (o.findings.length) { falseAlarms++; result = 'false alarm'; } else result = 'quiet (correct)'; }
  rows.push({ day: d, date: o.date, incident: inc || (d === 84 ? 'anniversary_sale' : ''), findings: o.findings.length, result });
}
const summary = {
  days_scored: rows.length,
  incident_days: rows.filter(r => incidentDay[r.day]).length,
  incident_days_caught_with_right_cause: rows.filter(r => r.result === 'caught, right cause').length,
  planned_sale_quiet: rows.find(r => r.day === 84).result.includes('correct'),
  normal_days: normalDays,
  false_alarms: falseAlarms
};
fs.writeFileSync(path.join(__dirname, 'scorecard.json'), JSON.stringify({ summary, rows }, null, 2));
console.log(summary);
rows.filter(r => r.incident || r.result !== 'quiet (correct)').forEach(r => console.log(r.day, r.date, r.incident, r.result));
