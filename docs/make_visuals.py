# Renders the post walkthrough for Metric Detective (Agent 3): docs/flow/*.png (1080x1350) and docs/flow/walkthrough.pdf.
# Every number comes from demo/ outputs or a fresh run of the engine on the sample data (fictional brand).
import html, json, pathlib, subprocess
from playwright.sync_api import sync_playwright

root = pathlib.Path(__file__).resolve().parent.parent
out = root / "docs/flow"; out.mkdir(parents=True, exist_ok=True)
emails = {e["date"]: e for e in json.loads((root / "demo/emails/emails.json").read_text())["emails"]}
sc = json.loads((root / "demo/scorecard.json").read_text())
S, rows = sc["summary"], {r["day"]: r for r in sc["rows"]}
st = json.loads((root / "demo/stress_test.json").read_text())
# Numbers for the KPI tree and mix slides, straight from the engine.
nums = json.loads(subprocess.check_output(["node", "-e", """
const G=require('./src/generate.js'),R=require('./src/rca.js');const D=G.generate(42);
const f=R.run(D,'2026-08-31').findings[0], c=R.run(D,'2026-09-17').findings[0];
const pc=x=>(x*100).toFixed(1);
const walk=Object.fromEntries(f.kpi_walk.steps.flatMap(s=>[[s.kpi,pc(s.change)],...s.parts.map(p=>[p.kpi,pc(p.change)])]));
const upi=f.drivers.find(d=>d.metric==='upi_success').top.map(t=>[t.segment,pc(t.rate_before),pc(t.rate_now)]);
const aov=c.drivers.find(d=>d.metric==='aov'&&d.dim==='user_type'), cv=c.drivers.find(d=>d.metric==='conversion'&&d.dim==='user_type');
const seg=d=>Object.fromEntries(d.top.map(t=>[t.segment,{b:t.rate_before,n:t.rate_now,sb:pc(t.share_before),sn:pc(t.share_now)}]));
console.log(JSON.stringify({walk,path:f.kpi_walk.path,upi,aov:{b:Math.round(aov.before),n:Math.round(aov.now),seg:seg(aov)},cv:{b:pc(cv.before),n:pc(cv.now),seg:seg(cv)}}));
"""], cwd=root).decode())
E = html.escape

CSS = """*{box-sizing:border-box}body{margin:0;width:1080px;height:1350px;background:#f6f3ee;font-family:'Helvetica Neue',Arial,sans-serif;color:#1c1b19;padding:64px 68px;display:flex;flex-direction:column}
.kick{font-size:22px;letter-spacing:.14em;text-transform:uppercase;color:#a1502a;font-weight:700}
h1{font-size:54px;line-height:1.08;margin:12px 0 30px;font-weight:800;letter-spacing:-.01em}
.card{background:#fff;border-radius:22px;padding:28px 32px}
.foot{margin-top:auto;font-size:19px;color:#8a857b;display:flex;justify-content:space-between}
.z{display:flex;flex-direction:column}.ok{color:#1a7f4b;font-weight:800}.bad{color:#b5442a;font-weight:800}"""

def page(body, step, note="Sample data · fictional brand"):
    return f'<html><head><meta charset="utf-8"><style>{CSS}</style></head><body><div class="z" style="zoom:__Z__">{body}</div><div class="foot"><span>Metric Detective · 12 Agents in 12 Weeks · {step}</span><span>{note}</span></div></body></html>'

slides = []

# 0. Cover
slides.append(page(f'''<div style="flex:1;display:flex;flex-direction:column;justify-content:center;min-height:1100px">
<div class="kick">Agent 3 of 12</div>
<div style="background:#fff;border-radius:22px;padding:30px 34px;margin:26px 0 40px;max-width:760px;box-shadow:0 10px 30px rgba(0,0,0,.08)">
<div style="font-size:20px;color:#8a857b;margin-bottom:10px">9:02 AM · from the CEO</div>
<div style="font-size:40px;font-weight:700;line-height:1.25">"Conversion is down 5%. Why?"</div></div>
<div style="font-size:84px;line-height:1.03;font-weight:800;letter-spacing:-.02em">Metric<br>Detective</div>
<div style="font-size:32px;line-height:1.4;color:#3a3834;margin-top:26px;max-width:860px">Checks the data, walks the KPI tree, finds where it broke, and writes a hypothesis backed by data. <b>Before the message arrives.</b></div>
<div style="margin-top:40px;font-size:24px;color:#5b574f">Swipe: 5 steps, each one checked →</div></div>''', "Agent 3", "Free to copy · repo in comments"))

# 1. Data checks first
checks = ["Every store reported, in every table", "No duplicate rows", "No impossible values", "Data runs to the end of the day", "Orders and category tables agree"]
clist = "".join(f'<div style="display:flex;justify-content:space-between;font-size:24px;padding:12px 0;border-bottom:1px solid #eee7dc"><span>{c}</span><span class="{"bad" if i == 3 else "ok"}">{"✕ Powai" if i == 3 else "✓"}</span></div>' for i, c in enumerate(checks))
off66 = rows[66]["without_data_checks"][0]
slides.append(page(f'''<div class="kick">Step 1 · Check the data first</div><h1>A store whose data stopped<br>looks like a store that crashed.</h1>
<div class="card" style="margin-bottom:24px"><div style="font-size:19px;color:#8a857b;margin-bottom:8px">5 Sep · data checks, before any analysis</div>{clist}
<div style="margin-top:18px;font-size:23px;line-height:1.4">Powai's data stops at <b>13:00</b>. Powai is set aside from today <i>and</i> the comparison weeks, so the other 19 stores are compared like for like.</div></div>
<div style="display:flex;gap:18px">
<div style="flex:1;background:#f3dfd5;border-radius:20px;padding:24px 26px"><div style="font-size:18px;letter-spacing:.1em;font-weight:800;color:#b5442a">CHECKS OFF</div><div style="font-size:26px;font-weight:700;margin-top:8px">False alarm:<br>"{E(off66)}"</div></div>
<div style="flex:1;background:#dfeee4;border-radius:20px;padding:24px 26px"><div style="font-size:18px;letter-spacing:.1em;font-weight:800;color:#1a7f4b">CHECKS ON</div><div style="font-size:26px;font-weight:700;margin-top:8px">"Data problem, no business alerts. Reload Powai."</div><div style="font-size:19px;color:#4d4a44;margin-top:6px">Fixed email. No AI.</div></div></div>''', "Step 1"))

# 2. KPI tree walk (UPI day)
w = nums["walk"]
def node(label, v, hot=False, small=False):
    col = "#b5442a" if float(v) < -1 else ("#1a7f4b" if float(v) > 1 else "#8a857b")
    return f'<div style="background:{"#1c1b19" if hot else "#fff"};color:{"#f6f3ee" if hot else "#1c1b19"};border-radius:16px;padding:{"12px 16px" if small else "16px 20px"};text-align:center;min-width:{"180px" if small else "220px"}"><div style="font-size:{"18px" if small else "21px"};opacity:.8">{label}</div><div style="font-size:{"26px" if small else "32px"};font-weight:800;color:{"#e8a77f" if hot else col}">{"+" if float(v) > 0 else ""}{v}%</div></div>'
def arrow(col):  # col: 0 = left, 1 = right, None = centre
    if col is None: return '<div style="text-align:center;font-size:26px;color:#a1502a;line-height:1">▼</div>'
    cells = ['<div style="text-align:center;font-size:26px;color:#a1502a;line-height:1">▼</div>' if i == col else '<div></div>' for i in (0, 1)]
    return '<div style="display:grid;grid-template-columns:260px 260px;gap:18px">' + ''.join(cells) + '</div>'
row = lambda a, b: f'<div style="display:grid;grid-template-columns:260px 260px;gap:18px;justify-items:center">{a}{b}</div>'
upi = {s: (b, n) for s, b, n in nums["upi"]}
tree = f'''<div style="display:flex;flex-direction:column;gap:10px;align-items:center">
{node("GMV", w["gmv"], True)}{arrow(0)}
{row(node("Orders", w["orders"], True), node("Order value", w["aov"]))}{arrow(1)}
{row(node("Sessions", w["sessions"]), node("Conversion", w["conversion"], True))}{arrow(1)}
{row(node("Checkout rate", w["checkout_rate"], small=True), node("Checkout completion", w["checkout_completion"], True, True))}{arrow(None)}
<div style="background:#f3dfd5;border-radius:16px;padding:16px 24px;font-size:24px;text-align:center"><b>Split by city:</b> UPI success in Bengaluru <b>{upi["Bengaluru"][0]}% → {upi["Bengaluru"][1]}%</b><br><span style="font-size:20px;color:#4d4a44">Delhi {upi["Delhi"][1]}% · Mumbai {upi["Mumbai"][1]}%, normal</span></div></div>'''
slides.append(page(f'''<div class="kick">Step 2 · Walk the KPI tree</div><h1>Follow the biggest mover<br>down, then pin down where.</h1>
<div class="card" style="padding:30px 24px">{tree}</div>
<div style="margin-top:22px;font-size:23px;color:#3a3834;line-height:1.4">31 Aug, all cities. Every step is code. The check proves each KPI equals the product of the ones under it.</div>''', "Step 2"))

# 3. The email
e = emails["2026-08-31"]
body = E(e["body"]).replace("\n\n", "<div style='height:10px'></div>").replace("\n", "<br>")
for h in ["Hypothesis:", "Evidence:", "Context:", "Checks for today:"]:
    body = body.replace(h, f"<b>{h}</b>")
slides.append(page(f'''<div class="kick">Step 3 · The email</div><h1>A hypothesis backed by data,<br>not a guess.</h1>
<div class="card" style="font-size:18.5px;line-height:1.42;padding:26px 30px">
<div style="font-size:15px;color:#8a857b">Metric Detective · 31 Aug · written by Claude from computed facts</div>
<div style="font-size:23px;font-weight:800;margin:6px 0 14px">{E(e["subject"])}</div>{body}
<div style="margin-top:14px;font-size:16px;color:#1f6f4a">✔ Data checks passed for every store<br>✔ Calculations add back up: KPI tree, city totals, mix and behaviour<br>✔ Every number matched against the computed facts before sending</div></div>''', "Step 3", "Sample email · fictional brand"))

# 4. Mix or behaviour (campaign day)
a, c = nums["aov"], nums["cv"]
def bar(label, sb, sn):
    return f'''<div style="display:flex;align-items:center;gap:14px;margin:8px 0"><div style="width:120px;font-size:20px;color:#5b574f">{label}</div>
<div style="flex:1;height:30px;background:#eee7dc;border-radius:8px;overflow:hidden;display:flex"><div style="width:{sb}%;background:#a1502a"></div></div><div style="width:150px;font-size:21px;font-weight:700">{sb}% new</div></div>'''
slides.append(page(f'''<div class="kick">Step 4 · Real problem, or different people?</div><h1>Order value fell. Nobody<br>behaved differently.</h1>
<div class="card" style="margin-bottom:22px"><div style="font-size:19px;color:#8a857b;margin-bottom:10px">17 Sep · a campaign brings in new users</div>
{bar("Usual", c["seg"]["new"]["sb"], 0)}{bar("Today", c["seg"]["new"]["sn"], 0)}
<div style="display:flex;gap:18px;margin-top:22px">
<div style="flex:1;background:#f6f3ee;border-radius:16px;padding:18px 20px"><div style="font-size:19px;color:#5b574f">New users spend</div><div style="font-size:30px;font-weight:800">Rs {round(a["seg"]["new"]["b"])} → Rs {round(a["seg"]["new"]["n"])}</div></div>
<div style="flex:1;background:#f6f3ee;border-radius:16px;padding:18px 20px"><div style="font-size:19px;color:#5b574f">Repeat users spend</div><div style="font-size:30px;font-weight:800">Rs {round(a["seg"]["repeat"]["b"])} → Rs {round(a["seg"]["repeat"]["n"])}</div></div></div>
<div style="margin-top:20px;font-size:25px">Average order value: <b>Rs {a["b"]} → Rs {a["n"]}</b>. Every group spent the same. More low-spend users showed up.</div></div>
<div style="background:#1c1b19;color:#f6f3ee;border-radius:20px;padding:24px 30px;font-size:27px;line-height:1.35"><b style="color:#e8a77f">Verdict: mix shift.</b> Nothing is broken. Ask growth why new users jumped.</div>''', "Step 4"))

# 5. Scorecard + analyst owns the logic
stat = lambda n, l: f'<div style="flex:1;background:#fff;border-radius:18px;padding:20px 18px;text-align:center"><div style="font-size:46px;font-weight:800">{n}</div><div style="font-size:18px;color:#5b574f;line-height:1.3">{l}</div></div>'
slides.append(page(f'''<div class="kick">Step 5 · Proof, and who owns what</div><h1>Tested on 90 days with<br>problems I hid.</h1>
<div style="display:flex;gap:14px;margin-bottom:14px">{stat(f'{S["incident_days_caught_with_right_cause"]}/{S["incident_days"]}', "problem days caught, right cause")}{stat(f'{S["data_problems_called_correctly"]}/{S["data_problem_days"]}', "data problems called data problems")}{stat(f'{S["false_alarms"]}/{S["normal_days"]}', "false alarms on normal days")}</div>
<div style="display:flex;gap:14px;margin-bottom:26px">{stat(str(S["calculation_check_failures"]), "calculation-check failures")}{stat(str(S["without_data_checks_false_alarms_on_data_and_normal_days"]), "false alarms with the data checks OFF")}{stat(f'{st["caught_with_right_cause"]}/{st["incident_days"]}', "caught on 20 random datasets")}</div>
<div style="display:flex;gap:18px">
<div style="flex:1;background:#1c1b19;color:#f6f3ee;border-radius:20px;padding:24px 26px"><div style="font-size:18px;letter-spacing:.1em;font-weight:800;color:#e8a77f">THE ANALYST OWNS</div><div style="font-size:23px;line-height:1.5;margin-top:8px">The KPI tree<br>What counts as normal<br>The calendar<br>The business context</div></div>
<div style="flex:1;background:#fff;border-radius:20px;padding:24px 26px"><div style="font-size:18px;letter-spacing:.1em;font-weight:800;color:#1a7f4b">THE AGENT DOES</div><div style="font-size:23px;line-height:1.5;margin-top:8px">Data checks<br>The tree walk and splits<br>The maths checks<br>The first draft</div></div></div>
<div style="margin-top:20px;font-size:19px;color:#8a857b">Problems planted by me in generated data. Real data is messier.</div>''', "Step 5", "Repo in the comments"))

with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1080, "height": 1350})
    names = ["0_cover", "1_data_checks", "2_kpi_tree", "3_email", "4_mix_shift", "5_scorecard"]
    fitted = []
    for n, s in zip(names, slides):
        # Largest zoom that still fits the canvas, so no slide is left half empty.
        for z in [1.4, 1.35, 1.3, 1.25, 1.2, 1.15, 1.1, 1.05, 1.0]:
            pg.set_content(s.replace("__Z__", str(z)))
            if pg.evaluate("document.documentElement.scrollHeight") <= 1350 and pg.evaluate("document.querySelector('.z').getBoundingClientRect().bottom") <= 1190: break
        fitted.append(s.replace("__Z__", str(z)))
        print(n, "zoom", z)
        pg.screenshot(path=str(out / f"{n}.png"))
    pages = "".join(f'<div class="pg">{s.split("<body>")[1].split("</body>")[0]}</div>' for s in fitted)
    pg.set_content(f'<html><head><meta charset="utf-8"><style>{CSS.replace("body{margin:0;width:1080px;height:1350px;", "body{margin:0;width:1080px;")} .pg{{width:1080px;height:1350px;padding:64px 68px;display:flex;flex-direction:column;page-break-after:always;overflow:hidden;background:#f6f3ee}}</style></head><body style="padding:0;display:block">{pages}</body></html>')
    pg.pdf(path=str(out / "walkthrough.pdf"), width="1080px", height="1350px", print_background=True)
    b.close()
print("ok")
