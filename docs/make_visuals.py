import json, html, pathlib
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
emails = json.loads((root / "demo/emails/emails.json").read_text())
sc = json.loads((root / "demo/scorecard.json").read_text())["summary"]
st = json.loads((root / "demo/stress_test.json").read_text())
BASE = """<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;width:1080px;height:1350px;background:#f6f3ee;font-family:'Helvetica Neue',Arial,sans-serif;color:#1c1b19;padding:72px 68px;display:flex;flex-direction:column}
.kick{font-size:22px;letter-spacing:.14em;text-transform:uppercase;color:#a1502a;font-weight:700}
h1{font-size:56px;line-height:1.08;margin:14px 0 26px;font-weight:800;letter-spacing:-.01em}
.foot{margin-top:auto;font-size:19px;color:#8a857b;display:flex;justify-content:space-between}
</style></head><body>{body}<div class="foot"><span>Metric Detective · 12 Agents in 12 Weeks · Week 2</span><span>{note}</span></div></body></html>"""
page = lambda b, n="Sample data, fictional brand": BASE.replace("{body}", b).replace("{note}", n)

steps = [("1", "Code compares every number", "Each city and store vs the same weekday over the last 4 weeks. Planned sales in the calendar are ignored.", "#e9e2d6"),
         ("2", "Code finds the cause", "Breaks the move into traffic, conversion, payments and basket, then by city, store, payment method, user type and category.", "#dfe8e1"),
         ("3", "Code asks: real problem or mix?", "Fewer rupees per order can just mean more new users showed up. That's not a problem.", "#e3e3ef"),
         ("4", "Claude writes the email", "Only on days with an alert. A few cents, not a monthly bill.", "#e9e2d6"),
         ("5", "Code checks every number", "If the email has a number the code didn't compute, the draft is thrown out.", "#f3dfd5")]
cards = "".join(f'<div style="display:flex;gap:26px;background:{c};border-radius:18px;padding:24px 28px;margin-bottom:16px"><div style="font-size:40px;font-weight:800;color:#a1502a;width:40px">{n}</div><div><div style="font-size:30px;font-weight:700;margin-bottom:6px">{t}</div><div style="font-size:22px;color:#4d4a44;line-height:1.35">{d}</div></div></div>' for n, t, d, c in steps)
v1 = page(f'<div class="kick">How it works</div><h1>Your numbers dropped.<br>It tells you why before your 10 AM standup.</h1>{cards}', "AI writes, code decides")

e = emails[0]
body = "".join(f'<p style="margin:0 0 12px">{html.escape(l)}</p>' if l.strip() else "" for l in e["body"].split("\n"))
mail = f'''<div class="kick">Monday 8 AM, in your inbox</div><h1 style="font-size:46px">A small dip in conversion, traced to UPI failing in one city.</h1>
<div style="background:#fff;border-radius:18px;box-shadow:0 2px 0 #e5ded2;padding:30px 34px;font-size:20.5px;line-height:1.42">
<div style="font-size:16px;color:#8a857b;margin-bottom:6px">From: Metric Detective · 31 Aug (sample data)</div>
<div style="font-size:24px;font-weight:700;margin-bottom:18px">{html.escape(e["subject"])}</div>{body}
<div style="color:#1f6f4a;font-size:17px;margin-top:6px">✔ Every number above was matched against the computed table before sending.</div></div>'''
v2 = page(mail)

stat = lambda big, small, dark=True: f'<div style="flex:1;background:{"#1c1b19" if dark else "#fffdf9"};color:{"#f6f3ee" if dark else "#1c1b19"};border-radius:18px;padding:24px 26px"><div style="font-size:50px;font-weight:800">{big}</div><div style="font-size:20px;color:{"#cfc8bb" if dark else "#5b574f"};line-height:1.3">{small}</div></div>'
v3 = page(f'''<div class="kick">The trap it didn't fall into</div><h1 style="font-size:50px">Order value fell 6.2%.<br>The right answer was: relax.</h1>
<div style="background:#fffdf9;border-radius:18px;padding:26px 30px;font-size:23px;line-height:1.45;margin-bottom:22px">
A campaign brought in more than twice the usual share of new users. New users spend less, so the <b>average</b> fell.<br><br>
But new users still spent Rs 269 → Rs 271, and converted at 10.9% → 10.9%.<br><br>
<b style="color:#1f6f4a">Verdict: mix shift. Nobody's behaviour changed. No fix needed.</b></div>
<div style="font-size:24px;font-weight:700;margin:6px 0 14px">Scorecard on the sample data</div>
<div style="display:flex;gap:16px;margin-bottom:16px">{stat(f"{sc['incident_days_caught_with_right_cause']} / {sc['incident_days']}", "incident days caught with the right cause")}{stat(f"0 / {sc['normal_days']}", "false alarms on normal days")}</div>
<div style="display:flex;gap:16px">{stat(f"{st['caught_with_right_cause']} / {st['incident_days']}", "caught across 20 random datasets", False)}{stat("1%", f"false alarm days across 20 datasets ({st['false_alarm_days']} of {st['normal_days']:,})", False)}</div>''', "Data I generated, incidents I planted")
with sync_playwright() as p:
    b = p.chromium.launch()
    for n, d in [("1_how_it_works", v1), ("2_email", v2), ("3_mix_shift_and_scorecard", v3)]:
        pg = b.new_page(viewport={"width": 1080, "height": 1350}); pg.set_content(d); pg.screenshot(path=str(root / f"docs/{n}.png")); pg.close()
    b.close()
print("ok")
