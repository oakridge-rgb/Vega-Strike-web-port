#!/usr/bin/env python3
"""Build the port's universe data (data.js) from the authentic extraction.

- 14-system Gemini-sector cluster around the canonical VS start
  (New Constantinople), jump links from the real .system files.
- Bases: authentic parsed bases + procedural fill (documented reconstruction)
  to give every system a working market.
- Goods: all 204 authentic master_part_list trade goods.
- Ships: 7 authentic units.csv rows (Mass/Fuel/Hull verified per-row).
- Sector labels: gemini_sector (testsystems layout).
"""
import json, os, math

SRC = "/tmp/vsdata"

def hashStr(s):
    h = 2166136261
    for c in s:
        h = ((h ^ ord(c)) * 16777619) & 0xFFFFFFFF
    return h
d = json.load(open(os.path.join(SRC, "port_data.json")))
systems, ships, goods, facs = d["systems"], d["ships"], d["goods"], d["factions"]

CLUSTER = ["newconstantinople","newdetroit","perry","newcastle","xxn-1927","varnus",
           "rikel","manchester","nd-57","saxtogue","raxis","44-p-im","junction","aldebran"]

# ship stat assignment (fields verified per-row in units.csv):
# row[19]=Mass, row[21]=Fuel_Capacity, row[22]=Hull (see scripts/vsport notes)
SHIP_STATS = {
  "Llama.begin": {"mass": 250,   "fuel": 25,     "hull": 500,   "price": 1,        "role": "SHUTTLE"},
  "Llama":       {"mass": 336,   "fuel": 25,     "hull": 500,   "price": 900000,   "role": "SHUTTLE"},
  "Dostoevsky":  {"mass": 42,    "fuel": 3.5,    "hull": 300,   "price": 360000,   "role": "FIGHTER"},
  "Quicksilver": {"mass": 33.6,  "fuel": 3.5,    "hull": 90,    "price": 145000,   "role": "SUPPORT"},
  "Admonisher":  {"mass": 360,   "fuel": 22.92,  "hull": 700,   "price": 3000000,  "role": "FIGHTER"},
  "Hidalgo":     {"mass": 60000, "fuel": 2333,   "hull": 14000, "price": 7500000,  "role": "SUPPORT"},
  "Mule":        {"mass": 32000, "fuel": 2333,   "hull": 14000, "price": 8000000,  "role": "SUPPORT"},
}
ship_desc = {s["name"]: s["desc"] for s in ships}
ship_roles = {s["name"]: s["role"] for s in ships}

# base types for procedural fill, per economy flavor
PIRATE_SYS = {"saxtogue", "nd-57", "rikel"}
BASE_TYPES = {
  "commerce_center":  {"goods": 1.00, "name": "Commerce Center",  "fac": "merchant_guild"},
  "miningbase":       {"goods": 1.00, "name": "Mining Base",       "fac": "confed"},
  "agricultural_station": {"name": "Agricultural Station", "fac": "confed"},
  "factory":          {"name": "Factory Station",      "fac": "confed"},
  "refinery":         {"name": "Refinery",             "fac": "confed"},
  "medical":          {"name": "Medical Station",      "fac": "confed"},
  "starfortress":     {"name": "Star Fortress",        "fac": "confed"},
  "pirate_base":      {"name": "Smuggler's Den",       "fac": "pirates"},
}

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

# dedupe goods by file (master_part_list.csv repeats some rows)
_seen_g = set(); _goods_u = []
for _g in goods:
    if _g["file"] in _seen_g: continue
    _seen_g.add(_g["file"]); _goods_u.append(_g)
goods = _goods_u

UNI = {"systems": [], "links": [], "ships": [], "goods": goods, "factions": facs[:16]}

for name in CLUSTER:
    s = systems[name]
    scale = 1e6  # meters -> Mm (1000 km)
    sysout = {"name": name, "sector": "gemini_sector",
              "star": None, "planets": [], "bases": [], "jumps": []}
    if s["star"]:
        st = s["star"]
        sysout["star"] = {"name": st["name"], "r": max(4, st["radius"] / scale),
                          "x": st["x"]/scale, "y": st["y"]/scale, "z": st["z"]/scale,
                          "tex": st["tex"]}
    for p in s["planets"][:6]:
        sysout["planets"].append({"name": p["name"], "r": max(1, p["radius"] / scale),
                                  "x": p["x"]/scale, "y": p["y"]/scale, "z": p["z"]/scale,
                                  "tex": p["tex"]})
    rng = mulberry32(hash(name) & 0xFFFF)
    # authentic bases first
    seen = set()
    for b in s["bases"]:
        key = b["file"].lower()
        if key in seen: continue
        seen.add(key)
        bt = BASE_TYPES.get(key, {"name": b["file"].replace("_"," ").title(), "fac": b["faction"] or "confed"})
        fac = b["faction"] or bt.get("fac", "confed")
        px = py = pz = None
        # place near its planet if known
        for p in sysout["planets"]:
            if p["name"] == b["planet"]:
                px, py, pz = p["x"]*1.08, p["y"]*1.08, p["z"]*1.08
        if px is None:
            px, py, pz = (rng()-0.5)*600, (rng()-0.5)*400, (rng()-0.5)*600
        sysout["bases"].append({"name": bt["name"], "type": key if key in BASE_TYPES else "commerce_center",
                                "faction": fac, "x": px, "y": py, "z": pz, "authentic": True})
    # procedural fill to at least 2 bases (documented reconstruction)
    want = 2 if name in ("44-p-im", "aldebran") else 3
    flavor = ["miningbase", "agricultural_station", "factory", "commerce_center", "refinery"]
    while len(sysout["bases"]) < want:
        if name in PIRATE_SYS and len(sysout["bases"]) == want - 1:
            k = "pirate_base"
            bt = BASE_TYPES[k]
        else:
            k = flavor[len(sysout["bases"]) % len(flavor)]
            bt = BASE_TYPES[k]
        sysout["bases"].append({"name": bt["name"], "type": k,
                                "faction": bt.get("fac", "confed"),
                                "x": (rng()-0.5)*700, "y": (rng()-0.5)*500, "z": (rng()-0.5)*700,
                                "authentic": False})
    # jumps: destinations authentic; positions spread on a deterministic ring
    # for playability (authentic .system files cluster jump nodes together)
    seenj = set()
    for j in sorted(s["jumps"], key=lambda x: x["name"]):
        tgt = j["dest"].split("/")[-1].lower()
        if tgt in CLUSTER and tgt != name and tgt not in seenj:
            seenj.add(tgt)
            ang = (hashStr(name + tgt) % 360) * 3.14159265 / 180
            ring = 320 + (hashStr(tgt) % 120)
            sysout["jumps"].append({"name": j["name"], "dest": tgt,
                                    "x": ring * math.cos(ang), "y": (rng() - 0.5) * 120,
                                    "z": ring * math.sin(ang)})
    UNI["systems"].append(sysout)

# undirected links within cluster
for s in UNI["systems"]:
    for j in s["jumps"]:
        UNI["links"].append([s["name"], j["dest"]])

# ships (authentic stats)
for nm, st in SHIP_STATS.items():
    UNI["ships"].append({"name": nm, "mass": st["mass"], "fuel": st["fuel"],
                         "hull": st["hull"], "price": st["price"],
                         "role": ship_roles.get(nm, st["role"]),
                         "desc": ship_desc.get(nm, "")})

# shipyard parts: authentic master_part_list upgrade rows
import csv as _csv
PART_RULES = [
    ("upgrades/Weapons/Mounted_Guns_Light", "gun"),
    ("upgrades/Weapons/Mounted_Guns_Medium", "gun"),
    ("upgrades/Shield_Systems/Standard_Dual_Shields", "shield"),
    ("upgrades/Armor", "armor"),
    ("upgrades/Reactors/Standard", "reactor"),
    ("upgrades/Overdrive", "engine"),
    ("upgrades/SPEC_Capacitors", "spec"),
    ("upgrades/Cargo", "cargo"),
]
parts = []
with open(os.path.join(SRC, "master_part_list.csv"), newline="", encoding="utf-8", errors="replace") as f:
    for r in _csv.DictReader(f):
        cat = (r.get("categoryname") or "").strip()
        try: price = float(r.get("price") or 0)
        except ValueError: price = 0
        if price <= 0: continue
        for pref, kind in PART_RULES:
            if cat.startswith(pref):
                fnm = (r.get("file") or "").strip()
                if any(x in fnm for x in ("milspec", "Milspec", "Aera", "Rlaan", "aera", "rlaan")): continue
                parts.append({"file": fnm, "kind": kind, "cat": cat, "price": price,
                              "desc": (r.get("description") or "")[:110]})
                break
# keep it lean: sort by price per kind, keep a few tiers
keep = {}
for p in parts:
    keep.setdefault(p["kind"], []).append(p)
final_parts = []
for kind, lst in keep.items():
    lst.sort(key=lambda p: p["price"])
    n = {"gun": 6, "shield": 4, "armor": 3, "reactor": 3, "engine": 3, "spec": 3, "cargo": 1}.get(kind, 3)
    final_parts.extend(lst[:n])
UNI["parts"] = final_parts
print("shipyard parts:", len(final_parts))

OUTDIR = "/home/z/my-project/download/vega-strike-web-port/src"
os.makedirs(OUTDIR, exist_ok=True)
js = "// Vega Strike web port - universe data\n// Derived from vegastrike/Assets-Production (GPL): units.csv, master_part_list.csv,\n// and .system files (gemini_sector cluster around New Constantinople).\n// Base placement fill, market variation and pirate presence are documented reconstructions.\nconst VS_DATA = " + json.dumps(UNI, separators=(",", ":")) + ";\n"
open(os.path.join(OUTDIR, "data.js"), "w").write(js)

print("systems:", len(UNI["systems"]), "links:", len(UNI["links"]),
      "goods:", len(UNI["goods"]), "ships:", len(UNI["ships"]))
print("data.js size:", os.path.getsize(os.path.join(OUTDIR, "data.js")))
for s in UNI["systems"]:
    kinds = [b["type"] for b in s["bases"]]
    print(f"  {s['name']:20} planets={len(s['planets'])} bases={kinds} jumps={len(s['jumps'])}")
