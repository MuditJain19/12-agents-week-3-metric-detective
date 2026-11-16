# Metric Detective

**Every morning it checks the data, then the business numbers. When something moves more than it should, it walks down the KPI tree, finds where it happened (city, store, payment method, user type, category) and emails a hypothesis backed by data. Every number in the email has been checked.**

Agent 3 of *12 Agents in 12 Weeks*. Demo on sample data for **ZipBasket**, a fictional 10-minute grocery app.

```
daily data
   ▼
1. DATA CHECKS (code)       every store reported · no duplicates · no impossible values
                            data runs to the end of the day · tables agree with each other
                            a store that fails is set aside, from today AND the comparison weeks
   ▼
2. DETECT (code)            each KPI vs the same weekday over the last 4 weeks (company, city, store)
                            known events in the calendar → stay quiet
   ▼
3. WALK THE KPI TREE (code) GMV = orders × order value; orders = sessions × conversion;
                            conversion = checkout rate × checkout completion; order value = items × price
   ▼
4. PIN IT DOWN (code)       splits by user type, payment, city, store, category
                            "mix" (who showed up changed) vs "behaviour" (what a group did changed)
   ▼
5. CALCULATION CHECKS       each KPI = product of the KPIs under it · cities add up to the total
   (code)                   mix + behaviour = the full change. If anything doesn't add up, nothing is sent.
   ▼
6. WRITE (Claude)           hypothesis + evidence, only on days with a real alert
   ▼
7. NUMBER CHECK (code)      every number in the email must appear in the computed facts,
                            or the facts are sent instead
```

Data-problem days get a fixed email ("Powai data stops at 13:00, set aside, the other 19 stores look normal"). No AI, no guessing a business cause.

## The analyst owns the logic, the agent does the legwork

Everything that needs judgement lives in one file, `src/logic.js` (the **LOGIC** block at the top of the n8n code node):

| Setting | What it decides |
|---|---|
| `kpis` | The primary KPI and the secondary KPIs underneath it |
| `kpi_tree` | How each KPI breaks down. The calculation check proves every parent equals the product of its children, every run |
| `thresholds`, `z_min`, `noise_floor` | What counts as a real move, per company, city and store |
| `calendar` | Planned events that shouldn't alert |
| `data_checks` | Tolerances: how late data may stop, how far tables may disagree, how many bad stores is too many |
| `context` | Business knowledge the write-up may cite, e.g. "all UPI goes through one gateway partner" |

The checks earned their place while I was building this. The KPI-tree check rejected my first tree, "conversion = checkout rate × payment success". That's wrong, because shoppers retry failed payments, so payment success is per attempt, not per checkout. The data checks then caught a bug in my own sample data: on stockout days the category table didn't add up to the orders table.

## Why it's built this way

- **Code does the maths, all of it.** Detection, the KPI tree, splits and verdicts are plain code: reproducible and free.
- **Check the data before trusting it.** A store whose data stopped at 1 PM looks exactly like a store whose sales crashed. Without the data checks, this agent raised two false business alarms on the sample data. With them, it raised none.
- **Mix vs behaviour is the step most dashboards skip.** Order value can fall because more new users showed up while every group spent exactly as before. The agent says "mix shift, no action needed" instead of raising a false alarm.
- **The AI only writes**, and only on days with a real alert. Normal days and data-problem days cost nothing; an alert day costs a few cents.

## Planted problems in the sample data

| Days | What happened (hidden from the agent) | What a good analyst should say |
|---|---|---|
| 31 Aug to 1 Sep | UPI payments fail in Bengaluru; some users retry with card | Orders down; UPI success in Bengaluru collapsed; check the payment gateway |
| 5 Sep | **Data problem:** Powai's data stops at 1 PM | Not a business problem: set Powai aside, reload its data |
| 9 to 10 Sep | Dairy out of stock in 3 Delhi dark stores | Delhi order value down; smaller baskets; dairy stockouts in Saket, Dwarka, Rohini |
| 14 Sep | **Data problem:** Gachibowli's data loaded twice | Not a business problem: set Gachibowli aside, remove the duplicates |
| 17 to 19 Sep | A campaign triples new-user traffic | Order value and conversion down, but it's a **mix shift**: each group behaved normally |
| 23 Sep | Planned anniversary sale (in the calendar) | Nothing: it was expected |

## Results

| Test | Result |
|---|---|
| Business incident days caught with the right cause | **7 of 7** |
| Data problems called data problems (no false business alert) | **2 of 2** |
| False alarms on normal days | **0 of 52** |
| Planned sale | stayed quiet |
| Calculation-check failures | **0** |
| Same agent with the data checks switched off | **2 false business alarms** ("Mumbai orders -8.1%", "company sessions +7.2%") |
| Same problems on 20 different random datasets | **139 of 140** incident days caught with the right cause; **40 of 40** data problems found; **10 of 1,040** normal days falsely flagged (1%) |
| Data checks against deliberately broken data | missing store, duplicates, negative values, impossible ratios, data stopping early, tables disagreeing, a missing day, too many bad stores: **all caught** |

These numbers come from data I generated, with problems I planted. Real data is messier: holidays, tracking changes, several things going wrong at once. Treat this as proof that the method works, not as a promised accuracy.

Reproduce: `node demo/scorecard.js`, `node demo/stress_test.js`, `node demo/data_checks_test.js`, `node demo/checker_test.js`.

## Use it on your own data

1. Import `n8n/metric-detective.json` into n8n.
2. In **Detect and Explain**, replace `generate()` with your own daily data, in the same three shapes:
   - funnel by store and user type (with `last_event_hour`, the hour of the last event that day, if you have it)
   - orders by store, user type and payment method
   - items by store and category
3. Edit the **LOGIC** block: KPI tree, thresholds, calendar, data-check tolerances, context.
4. Connect Anthropic for the write-up and Gmail for sending. Enable **Send Alert Email**.

## Files

| Path | What it is |
|---|---|
| `src/logic.js` | The analyst-owned logic: KPI tree, thresholds, calendar, data-check tolerances, context |
| `src/checks.js` | Data checks and calculation checks |
| `src/rca.js` | Detection, KPI tree walk, splits, mix vs behaviour, verdicts |
| `src/facts.js` | Computed facts the AI may use, the number checker, the fixed data-problem email |
| `src/generate.js` | Sample data generator with the planted problems |
| `n8n/metric-detective.json` | Import-ready workflow: demo replay, daily schedule, Claude write-up, number check, data-problem email |
| `demo/` | Scorecard, stress test, data-check test, number-check test, sample emails |

## Limitations

- The comparison uses the same weekday over the previous 4 weeks. New stores and the first weeks of data have no comparison.
- A store with a data problem is set aside for 4 weeks of comparisons, because its bad day is one of the comparison days. Reload the data to bring it back.
- It splits one level at a time. Two problems on the same day are reported separately, not untangled.
- The mix vs behaviour verdict checks the new-vs-repeat split; other mix shifts show up in the breakdown but get no verdict.
- The data checks catch broken pipelines, not wrong definitions. If "orders" is counted wrongly everywhere, the numbers will still add up.
- The number check matches numbers, not meaning. A small invented number that happens to appear elsewhere in the facts (say "4") would slip through.
- "Why" stops at the data: it can say UPI in Bengaluru broke, not why the payment gateway failed. That's where the analyst's context comes in.

All brands, stores and numbers are fictional.
