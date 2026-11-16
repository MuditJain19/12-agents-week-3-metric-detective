// ZipBasket (fictional 10-minute grocery app): deterministic sample data with planted incidents.
// Pure JS, no dependencies, so the same code runs inside an n8n Code node.

function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const START = '2026-07-01';
const DAYS = 90;
const CITIES = {
  Bengaluru: { base: 4200, stores: ['Koramangala', 'Indiranagar', 'HSR Layout', 'Whitefield', 'Jayanagar'] },
  Delhi: { base: 4000, stores: ['Saket', 'Dwarka', 'Rohini', 'Lajpat Nagar', 'Karol Bagh'] },
  Mumbai: { base: 3800, stores: ['Andheri', 'Bandra', 'Powai', 'Thane', 'Dadar'] },
  Hyderabad: { base: 3000, stores: ['Gachibowli', 'Madhapur', 'Kondapur', 'Banjara Hills', 'Kukatpally'] }
};
const WEEKDAY = [1.15, 0.92, 0.90, 0.93, 0.95, 1.05, 1.18]; // Sun..Sat
const USERS = {
  new: { share: 0.15, checkout: 0.115, items: 3.6 },
  repeat: { share: 0.85, checkout: 0.17, items: 5.4 }
};
const PAYMENTS = { UPI: { share: 0.70, success: 0.94 }, Card: { share: 0.15, success: 0.92 }, COD: { share: 0.15, success: 0.99 } };
const CATEGORIES = {
  dairy: { share: 0.22, price: 55 }, fruits_veg: { share: 0.25, price: 60 }, snacks: { share: 0.18, price: 90 },
  beverages: { share: 0.12, price: 85 }, staples: { share: 0.15, price: 110 }, personal_care: { share: 0.08, price: 150 }
};
const NEW_USER_PRICE_FACTOR = 0.92; // new users buy slightly cheaper baskets

// Business calendar the agent is told about (known events are not alerts).
const CALENDAR = [{ day: 84, name: 'ZipBasket Anniversary Sale (planned, all cities)' }];

// Planted incidents (the agent is NOT told about these).
const INCIDENTS = [
  { id: 'upi_failure', days: [61, 62], city: 'Bengaluru', note: 'UPI success rate collapses in Bengaluru; some users retry with card' },
  { id: 'dairy_stockout', days: [70, 71], city: 'Delhi', stores: ['Saket', 'Dwarka', 'Rohini'], note: 'Dairy out of stock most of the day in 3 Delhi stores' },
  { id: 'new_user_campaign', days: [78, 79, 80], note: 'Acquisition campaign triples new-user traffic; every segment behaves normally (mix shift)' },
  { id: 'anniversary_sale', days: [84], note: 'Planned sale, in the business calendar; should not alert' }
];

// Planted DATA problems (pipeline faults, not business events). The agent should call these data problems.
const DATA_INCIDENTS = [
  { id: 'store_stops_reporting', day: 66, store: 'Powai', last_hour: 13, share_of_day: 0.45, note: 'Powai data stops at 1 PM; only 45% of the day arrives' },
  { id: 'duplicate_load', day: 75, store: 'Gachibowli', note: 'Gachibowli rows loaded twice' }
];

function dateOf(d) {
  const t = new Date(START + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
}

function generate(seed) {
  const rnd = makeRng(seed || 42);
  const noise = sd => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return Math.exp((s - 3) * Math.sqrt(2) * sd); };
  const funnel = [];   // date, city, store, user_type: sessions, checkouts
  const orders = [];   // date, city, store, user_type, payment: checkouts, orders, gmv, items
  const cats = [];     // date, city, store, category: items, gmv, stockout_hours
  const storeFactor = {};
  for (const [city, c] of Object.entries(CITIES)) c.stores.forEach(s => { storeFactor[s] = 0.8 + 0.4 * rnd(); });

  for (let d = 0; d < DAYS; d++) {
    const date = dateOf(d);
    const wd = new Date(date + 'T00:00:00Z').getUTCDay();
    const trend = 1 + 0.0015 * d;
    const sale = d === 84;
    const campaign = [78, 79, 80].includes(d);
    for (const [city, c] of Object.entries(CITIES)) {
      for (const store of c.stores) {
        const storeSessions = c.base * storeFactor[store] * WEEKDAY[wd] * trend * noise(0.022) * (sale ? 1.7 : 1);
        const stockout = INCIDENTS[1].days.includes(d) && city === 'Delhi' && INCIDENTS[1].stores.includes(store);
        const upiDown = INCIDENTS[0].days.includes(d) && city === 'Bengaluru';
        const catItems = {};
        for (const [ut, u] of Object.entries(USERS)) {
          const sessions = Math.round(storeSessions * u.share * (campaign && ut === 'new' ? 3.2 : 1) * noise(0.012));
          const checkoutRate = u.checkout * noise(0.012) * (sale ? 1.1 : 1) * (stockout ? 0.94 : 1);
          const checkouts = Math.round(sessions * checkoutRate);
          funnel.push({ date, city, store, user_type: ut, sessions, checkouts, last_event_hour: 23 });
          let retryToCard = 0;
          for (const [pm, p] of Object.entries(PAYMENTS)) {
            let pmCheckouts = Math.round(checkouts * p.share * noise(0.008));
            let success = p.success * noise(0.006);
            if (pm === 'UPI' && upiDown) { success = 0.52 * noise(0.03); retryToCard = Math.round(pmCheckouts * (1 - success) * 0.35); }
            if (pm === 'Card') pmCheckouts += retryToCard;
            const ords = Math.min(pmCheckouts, Math.round(pmCheckouts * Math.min(success, 0.995)));
            const itemsPerOrder = u.items * noise(0.012) * (stockout ? 0.80 : 1);
            const rawItems = ords * itemsPerOrder;
            let gmv = 0, shareSum = 0;
            for (const [cat, cc] of Object.entries(CATEGORIES)) {
              let share = cc.share;
              if (stockout) share = cat === 'dairy' ? cc.share * 0.12 : cc.share * (1 + (0.22 * 0.88 * 0.3) / 0.78);
              shareSum += share;
              const ci = Math.round(rawItems) * share;
              const cg = ci * cc.price * (ut === 'new' ? NEW_USER_PRICE_FACTOR : 1) * noise(0.01);
              catItems[cat] = catItems[cat] || { items: 0, gmv: 0 };
              catItems[cat].items += ci; catItems[cat].gmv += cg; gmv += cg;
            }
            // Items in the orders table = items across categories (on stockout days the lost dairy items are gone from both).
            const items = Math.round(Math.round(rawItems) * shareSum);
            orders.push({ date, city, store, user_type: ut, payment: pm, checkouts: pmCheckouts, orders: ords, gmv: Math.round(gmv), items });
          }
        }
        for (const [cat, v] of Object.entries(catItems)) {
          const so = stockout && cat === 'dairy' ? 14 + Math.round(rnd() * 4) : (rnd() < 0.03 ? 1 + Math.round(rnd() * 2) : 0);
          cats.push({ date, city, store, category: cat, items: Math.round(v.items), gmv: Math.round(v.gmv), stockout_hours: so });
        }
      }
    }
  }
  // Data problems are applied after the business data, so every other number stays the same.
  for (const di of DATA_INCIDENTS) {
    const date = dateOf(di.day), hit = r => r.date === date && r.store === di.store;
    if (di.id === 'store_stops_reporting') {
      const cut = r => { ['sessions', 'checkouts', 'orders', 'gmv', 'items'].forEach(k => { if (k in r) r[k] = Math.round(r[k] * di.share_of_day); }); };
      funnel.filter(hit).forEach(r => { cut(r); r.last_event_hour = di.last_hour; });
      orders.filter(hit).forEach(cut);
      cats.filter(hit).forEach(cut);
    }
    if (di.id === 'duplicate_load') {
      [funnel, orders, cats].forEach(t => t.filter(hit).forEach(r => t.push(Object.assign({}, r))));
    }
  }
  return { start: START, days: DAYS, funnel, orders, cats, calendar: CALENDAR.map(e => ({ date: dateOf(e.day), name: e.name })) };
}

if (typeof module !== 'undefined') module.exports = { generate, dateOf, INCIDENTS, DATA_INCIDENTS, DAYS };
