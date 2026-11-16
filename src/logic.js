// ===== ANALYST-OWNED LOGIC =====
// This is the only file you should need to edit. The code does the legwork; you own the meaning.
// KPI tree, what counts as normal, the business calendar, data-check tolerances and the context
// the write-up is allowed to cite all live here.

const LOGIC = {
  // KPIs the agent watches every day. Primary first; secondary are the levers underneath.
  kpis: {
    primary: ['gmv'],
    secondary: ['orders', 'aov', 'sessions', 'conversion']
  },

  // How the KPIs break down. Every parent must equal the product of its children,
  // and the calculation check proves it every run. If you edit this, the check tells you
  // when a definition doesn't add up.
  kpi_tree: {
    gmv: ['orders', 'aov'],                           // GMV = orders x average order value
    orders: ['sessions', 'conversion'],               // orders = sessions x conversion
    conversion: ['checkout_rate', 'checkout_completion'], // conversion = checkout rate x share of checkouts that become orders
    aov: ['items_per_order', 'price_per_item']        // AOV = items per order x price per item
  },

  // What counts as a real move (per scope): at least this % change AND at least Z_MIN robust
  // standard deviations away from the same weekday over the previous BASELINE_WEEKS weeks.
  baseline_weeks: 4,
  thresholds: { total: 0.05, city: 0.08, store: 0.15 },
  z_min: 3,
  noise_floor: { total: 0.015, city: 0.025, store: 0.04 }, // minimum noise assumed, so quiet weeks don't make tiny moves look huge

  // Splits the agent drills into when something moves.
  splits: ['user_type', 'payment', 'city', 'store', 'category'],

  // Known events: the numbers are expected to break, so no alert.
  calendar: [
    { date: '2026-09-23', name: 'ZipBasket Anniversary Sale (planned, all cities)' }
  ],

  // Data checks run before any analysis. A store that fails one is set aside for the day
  // (and from the comparison weeks), and the email reports a data problem instead of a business cause.
  data_checks: {
    last_event_hour_min: 22,        // data for a day should run until at least 10 PM
    cross_table_tolerance: 0.02,    // items in the orders table vs the category table may differ by 2% at most
    max_stores_set_aside: 0.25      // if more than 25% of stores fail, don't analyse at all today
  },

  // Business context the write-up may cite. Tags decide when a note is relevant.
  // Fictional, for the ZipBasket demo: replace with what you know about your business.
  context: [
    { tags: ['upi_success', 'payment'], note: 'All UPI payments go through one payment gateway partner. A city-level UPI drop usually means a gateway or bank issue, not an app release.' },
    { tags: ['dairy'], note: 'Dairy is restocked twice a day by one supplier per city. More than 6 out-of-stock hours means a missed delivery.' },
    { tags: ['user_type'], note: 'Growth runs new-user campaigns without telling analytics. If the new-user share jumps, ask the growth team first.' }
  ]
};

if (typeof module !== 'undefined') module.exports = { LOGIC };
