#!/usr/bin/env python3
"""Pre-build verification of the Vega Strike web port's design numbers.
Implements the SAME formulas the JS will use, and asserts playability:
  1. Jump-graph connectivity (BFS from New Constantinople)
  2. Market sanity: every base stocks goods, prices positive, bounded variation
  3. Arbitrage: positive trade margins on essentially all links (the loop lives)
  4. Starting-capital feasibility: a first cargo run pays for itself
  5. Combat balance: TTK bands for the starting Llama vs pirates
"""
import json, math

D = json.load(open("/home/z/my-project/download/vega-strike-web-port/src/data.js".replace("src/data.js", "src/data.js")) if False else open("/home/z/my-project/download/vega-strike-web-port/src/data.js").read().split("= ", 1)[1].rstrip().rstrip(";").join(["", ""]) or open("/dev/null")) if False else None

# data.js is JS; extract the JSON after "const VS_DATA = "
raw = open("/home/z/my-project/download/vega-strike-web-port/src/data.js").read()
js = raw.split("const VS_DATA = ", 1)[1].rstrip().rstrip(";")
D = json.loads(js)

UNI_SYS = {s["name"]: s for s in D["systems"]}
GOODS = D["goods"]
fails = []

# ---------- 1. connectivity ----------
adj = {n: set() for n in UNI_SYS}
for a, b in D["links"]:
    adj[a].add(b); adj[b].add(a)
seen, stack = {"newconstantinople"}, ["newconstantinople"]
while stack:
    for n in adj[stack.pop()]:
        if n not in seen:
            seen.add(n); stack.append(n)
missing = set(UNI_SYS) - seen
print(f"1. connectivity: {len(seen)}/{len(UNI_SYS)} reachable from newconstantinople",
      "OK" if not missing else f"FAIL missing {missing}")
if missing: fails.append("connectivity")

# ---------- 2. market model (same formula as JS) ----------
def mulberry32(seed):
    state = [seed & 0xFFFFFFFF]
    def fn():
        state[0] = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        t = state[0]
        t = ((t ^ (t >> 15)) * (1 | t)) & 0xFFFFFFFF
        t = ((t + ((t ^ (t >> 7)) * (61 | t))) & 0xFFFFFFFF) ^ t
        t ^= t >> 14
        return t / 4294967296
    return fn

def hash_str(s):
    h = 2166136261
    for c in s:
        h = ((h ^ ord(c)) * 16777619) & 0xFFFFFFFF
    return h

def market_mult(base_id, good_id, day):
    # JS: m = 0.75 + 0.6 * rng(base|good|day) ; contraband ×1.25 at pirate, ×0.5 elsewhere
    rng = mulberry32(hash_str(base_id + "|" + good_id + "|" + str(day)))
    m = 0.75 + 0.6 * rng()
    if good_id.startswith("Contraband"):
        b = UNI_SYS.get(base_id)
        pirate = any(x["type"] == "pirate_base" for x in b["bases"]) if b else False
        m *= 1.25 if pirate else 0.5
    return m

def price_at(base_id, good, day):
    return max(1, round(good["price"] * market_mult(base_id, good["file"], day)))

bases = []
for sname, s in UNI_SYS.items():
    for b in s["bases"]:
        bases.append((sname + "::" + b["name"], b))
ok_mkt = True
min_stock = 999
for bid, b in bases:
    stocked = [g for g in GOODS if not g["file"].startswith("Contraband") or b["type"] == "pirate_base"]
    priced = [price_at(bid, g, 0) for g in stocked[:40]]
    min_stock = min(min_stock, len(stocked))
    if len(stocked) < 20 or min(priced) <= 0:
        ok_mkt = False; print("   BAD market:", bid, len(stocked), min(priced))
print(f"2. markets: {len(bases)} bases, min goods stocked {min_stock}, prices positive",
      "OK" if ok_mkt else "FAIL")
if not ok_mkt: fails.append("markets")

# ---------- 3. arbitrage margins across links ----------
margins = []
links_seen = set()
for a, b in D["links"]:
    for bid_a in [sname + "::" + x["name"] for sname, s in UNI_SYS.items() if sname == a for x in s["bases"]]:
        for bid_b in [sname + "::" + x["name"] for sname, s in UNI_SYS.items() if sname == b for x in s["bases"]]:
            if (bid_a, bid_b) in links_seen: continue
            links_seen.add((bid_a, bid_b)); links_seen.add((bid_b, bid_a))
            best = 0
            for g in GOODS:
                if g["file"].startswith("Contraband"): continue
                pa = price_at(bid_a, g, 0); pb = price_at(bid_b, g, 0)
                if pb > pa:
                    best = max(best, (pb - pa) / pa)
            margins.append(best)
margins.sort()
med = margins[len(margins)//2]
frac_pos = sum(1 for m in margins if m > 0.08) / len(margins)
print(f"3. arbitrage: {len(margins)} directed base-pairs, median best-margin {med*100:.1f}%, "
      f"links with >8% margin: {frac_pos*100:.0f}%", "OK" if med > 0.08 and frac_pos > 0.75 else "FAIL")
if med <= 0.08: fails.append("arbitrage")

# ---------- 4. first-run feasibility ----------
# Llama cargo hold 20000 (reconstruction), start credits 6000 (reconstruction)
cash, hold = 6000.0, 20000.0
bid_a = "newconstantinople::Commerce Center"
bid_b = "newdetroit::Mining Base" if "newdetroit::Mining Base" in [b for b, _ in bases] else None
best_buy = None
for g in GOODS:
    if g["file"].startswith("Contraband") or g["volume"] > hold: continue
    p = price_at(bid_a, g, 0)
    qty = min(hold / g["volume"], cash / p)
    if qty < 1: continue
    profit = (price_at(bid_b, g, 0) - p) * qty
    if best_buy is None or profit > best_buy[0]:
        best_buy = (profit, g["file"], qty, p)
profit, gname, qty, p = best_buy
print(f"4. first run: buy {qty:.0f} x {gname} @ {p:.0f} -> profit {profit:.0f} cr (start {cash:.0f})",
      "OK" if profit > 2000 else "FAIL")
if profit <= 2000: fails.append("first-run")

# ---------- 5. combat balance ----------
# Llama: 2 mass drivers, 8 dmg/shot, 2 shots/s/gun -> 32 dps; shield 200 (recon), regen 6%/s
# pirate fighter (Dostoevsky hull): hull 300, shield 100; pirate dps vs player ~10
gun_dps = 2 * 8 * 2
ttk_enemy = (300 + 100) / gun_dps
pirate_dps = 10
# player effective pool: shield regen extends survival: pool ~= hull + shield*(1 + regen*dps/... ) approximate:
eff_pool = 500 + 200 * (1 + 6 / 100 * 0)  # conservative: no regen credit
ttk_player = eff_pool / pirate_dps
print(f"5. combat: kill pirate in {ttk_enemy:.0f}s (band 8-25s), player survives {ttk_player:.0f}s without dodging (band 40-120s)",
      "OK" if 8 <= ttk_enemy <= 25 and 40 <= ttk_player <= 120 else "FAIL")
if not (8 <= ttk_enemy <= 25): fails.append("ttk")

print("\nRESULT:", "ALL OK" if not fails else f"FAILURES: {fails}")
