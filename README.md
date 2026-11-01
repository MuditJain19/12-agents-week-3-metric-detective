# Metric Detective

**Every morning it checks the business numbers. When something moves more than it should, it works out why (which city, store, payment method, user type or category) and emails you a short explanation in which every number has been checked.**

Week 2 of *12 Agents in 12 Weeks*. Demo on sample data for **ZipBasket**, a fictional 10-minute grocery app.

```
daily data ──▶ code: compare with the same weekday over the last 4 weeks (company, city, store)
                │  known events in the business calendar → stay quiet
                ▼
          code: break the move down
                GMV = orders × order value; orders = sessions × conversion; conversion = checkout × payment success
                for each split (user type, payment, city, store, category):
                   "mix" (who showed up changed) vs "behaviour" (what a group did changed)
                ▼
          Claude: writes the email from those computed facts, and only on days with an alert
                ▼
          code: every number in the email must appear in the computed facts, or the facts are sent instead
                ▼
          email
```

## Why it's built this way

- **Plain code does the maths.** Detection and root cause are deterministic code with no AI, so the numbers are reproducible and free.
- **The AI only writes the email**, and only on alert days. Normal days cost nothing; an alert day costs a few cents.
- **Mix vs behaviour is the step most dashboards skip.** Average order value can fall because more new users showed up, even though every group spent exactly as before. The agent says "mix shift, no action needed" instead of raising a false alarm.
- **Calendar-aware.** A planned sale is expected to break every number, so it doesn't trigger an alert.
- **Every number is checked.** If the AI writes a number that isn't in the computed facts, its draft is thrown away and the facts are sent instead.

## Planted incidents in the sample data

| Days | What happened (hidden from the agent) | What a good analyst should say |
|---|---|---|
| 31 Aug to 1 Sep | UPI payments fail in Bengaluru, and some users retry with card | Orders down; UPI success in Bengaluru collapsed; check the payment gateway |
| 9 to 10 Sep | Dairy out of stock in 3 Delhi dark stores | Delhi order value down; dairy items halved; stockouts in Saket, Dwarka, Rohini |
| 17 to 19 Sep | A campaign triples new-user traffic | Order value and conversion down, but it's a **mix shift**: each group behaved normally |
| 23 Sep | Planned anniversary sale (in the calendar) | Nothing: it was expected |

## Results

| Test | Result |
|---|---|
| Incident days caught with the right cause (main dataset) | **7 of 7** |
| False alarms on normal days (main dataset) | **0 of 54** |
| Planned sale | stayed quiet |
| Same incidents on 20 different random datasets | **139 of 140** incident days caught with the right cause; **11 of 1,080** normal days falsely flagged (1%) |

These numbers come from data I generated, with incidents I planted. Real data is messier: holidays, tracking bugs, several things going wrong at once. Treat this as proof that the method works, not as a promised accuracy.

Reproduce: `node demo/scorecard.js` and `node demo/stress_test.js`.

## Use it on your own data

1. Import `n8n/metric-detective.json` into n8n.
2. In **Detect and Explain**, replace `generate()` with your own daily data, in the same three shapes:
   - funnel by store and user type
   - orders by store, user type and payment method
   - items by store and category
3. Edit `THRESH` (how big a move counts as an alert) and the business `CALENDAR`.
4. Connect Anthropic for the write-up and Gmail for sending. Enable **Send Alert Email**.

## Files

| Path | What it is |
|---|---|
| `src/generate.js` | Sample data generator with the planted incidents |
| `src/rca.js` | Detection, breakdown, mix vs behaviour, verdicts |
| `src/facts.js` | Computed facts the AI may use, and the number checker |
| `n8n/metric-detective.json` | Import-ready workflow: demo replay, daily schedule, Claude write-up, number check, email |
| `demo/` | Scorecard, stress test, sample emails |

## Limitations

- The comparison uses the same weekday over the previous 4 weeks. New stores and the first weeks of data have no comparison.
- It splits one level at a time. Two problems on the same day are reported separately, not untangled.
- The mix vs behaviour verdict checks the new-vs-repeat split; other mix shifts show up in the breakdown but get no verdict.
- The number check matches numbers, not meaning. A small invented number that happens to appear elsewhere in the facts (say "4") would slip through. It catches made-up totals and percentages, not every possible error.
- "Why" stops at the data: it can say UPI in Bengaluru broke, not why the payment gateway failed.

All brands, stores and numbers are fictional.
