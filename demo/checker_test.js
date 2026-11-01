// Shows the number check rejecting a draft that invents a figure.
const G = require('../src/generate.js'), R = require('../src/rca.js'), F = require('../src/facts.js');
const facts = F.facts(R.run(G.generate(42), '2026-08-31'));
const honest = 'UPI payment success in Bengaluru fell to 53.1% from 94.0%.';
const invented = 'UPI payment success in Bengaluru fell to 53.1% from 94.0%, costing about 900 orders and Rs 4 lakh.';
console.log('honest draft  ', F.checkNumbers(honest, facts));
console.log('invented draft', F.checkNumbers(invented, facts));
