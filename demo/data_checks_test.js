// Breaks a clean day of data in each way the data checks look for, and shows each check catching it.
const fs = require('fs'), path = require('path');
const G = require('../src/generate.js'), R = require('../src/rca.js');
const day = '2026-08-27';
const cases = {
  'clean day (no change)': D => D,
  'a store missing from the orders table': D => { D.orders = D.orders.filter(r => !(r.date === day && r.store === 'Bandra')); return D; },
  'duplicate rows': D => { D.cats.filter(r => r.date === day && r.store === 'Saket').forEach(r => D.cats.push(Object.assign({}, r))); return D; },
  'a negative GMV value': D => { D.orders.find(r => r.date === day && r.store === 'Thane').gmv = -500; return D; },
  'more orders than payment attempts': D => { const r = D.orders.find(x => x.date === day && x.store === 'Madhapur'); r.orders = r.checkouts + 40; return D; },
  'data that stops at 4 PM': D => { D.funnel.filter(r => r.date === day && r.store === 'Jayanagar').forEach(r => { r.last_event_hour = 16; }); return D; },
  'orders and category tables disagree': D => { D.cats.filter(r => r.date === day && r.store === 'Andheri').forEach(r => { r.items = Math.round(r.items * 0.8); }); return D; },
  'a whole day missing': D => { ['funnel', 'orders', 'cats'].forEach(t => { D[t] = D[t].filter(r => r.date !== day); }); return D; },
  'too many stores broken (6 of 20)': D => { ['Koramangala', 'Saket', 'Andheri', 'Gachibowli', 'Powai', 'Dadar'].forEach(s => D.funnel.filter(r => r.date === day && r.store === s).forEach(r => { r.last_event_hour = 9; })); return D; }
};
const out = [];
for (const [name, breakIt] of Object.entries(cases)) {
  const o = R.run(breakIt(G.generate(42)), day);
  out.push({ case: name, status: o.data.status, set_aside: o.data.set_aside, issues: o.data.issues.filter(i => i.date === day).map(i => i.check + ': ' + i.detail), business_findings: o.findings.length });
  console.log(`${name.padEnd(40)} -> ${o.data.status}${o.data.set_aside.length ? ' (' + o.data.set_aside.join(', ') + ')' : ''}; ${o.data.issues.filter(i => i.date === day).map(i => i.check).join(', ') || 'no issues'}; business findings: ${o.findings.length}`);
}
fs.writeFileSync(path.join(__dirname, 'data_checks_test.json'), JSON.stringify(out, null, 2));
