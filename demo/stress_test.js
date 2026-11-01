// Same planted incidents, 20 different random datasets (seeds 1-20), to check the result isn't a lucky draw.
const fs = require('fs'), path = require('path');
const G = require('../src/generate.js'), R = require('../src/rca.js');
let caught = 0, inc = 0, fa = 0, normal = 0, saleQuiet = 0;
for (let seed = 1; seed <= 20; seed++) {
  const D = G.generate(seed);
  for (let d = 28; d < G.DAYS; d++) {
    const f = R.run(D, G.dateOf(d)).findings;
    if ([61, 62, 70, 71, 78, 79, 80].includes(d)) {
      inc++;
      const ok = d < 63 ? f.some(x => x.drivers.some(y => y.metric === 'upi_success' && y.top[0].segment === 'Bengaluru'))
        : d < 72 ? f.some(x => x.scope.city === 'Delhi' && x.categories[0].category === 'dairy')
        : f.some(x => x.verdicts && x.verdicts.aov === 'mix_shift');
      if (ok) caught++;
    } else if (d === 84) { if (!f.length) saleQuiet++; }
    else { normal++; if (f.length) fa++; }
  }
}
const out = { datasets: 20, incident_days: inc, caught_with_right_cause: caught, normal_days: normal, false_alarm_days: fa, planned_sale_quiet: saleQuiet };
fs.writeFileSync(path.join(__dirname, 'stress_test.json'), JSON.stringify(out, null, 2));
console.log(out);
