#!/usr/bin/env python3
"""Extract authentic Vega Strike data (GPL, vegastrike/Assets-Production)
into a compact JSON for the browser port. v2.

Fixes v1: units.csv header has a phantom leading field (data col i = header col i+1);
regex with DOTALL (gemini system files wrap tags across lines); jump resolution
case-insensitive on basename; sector map from repo tree; ship prices joined from
master_part_list.csv starship rows.
Output: /tmp/vsdata/port_data.json
"""
import csv, json, os, re, glob

SRC = "/tmp/vsdata"
OUT = os.path.join(SRC, "port_data.json")

TAG_RE = re.compile(r'<(Planet|Moon|Unit|Jump)\b([^>]*?)/?>', re.S | re.I)
ATTR_RE = re.compile(r'(\w+)\s*=\s*"([^"]*)"')
def attrs(s): return dict(ATTR_RE.findall(s))
def num(s, default=0.0):
    try: return float(re.sub(r"\s+", "", s or ""))
    except ValueError: return default

# sector map: basename -> "sector_dir/name"
tree = json.load(open("/tmp/vs_tree.json"))
secmap = {}
for e in tree["tree"]:
    p = e["path"]
    if p.endswith(".system") and "/" in p:
        base = p.split("/")[-1][:-7]
        secmap.setdefault(base.lower(), p.rsplit("/", 1)[-2] + "/" + base)

# ---------- 1. systems ----------
systems = {}
for path in sorted(glob.glob(os.path.join(SRC, "systems", "*.system"))):
    key = os.path.basename(path)[:-7]
    text = open(path, encoding="utf-8", errors="replace").read()
    s = {"sector": secmap.get(key.lower(), "?").split("/")[0],
         "planets": [], "bases": [], "jumps": [], "star": None}
    planets = []
    for m in TAG_RE.finditer(text):
        tag, raw = m.group(1).lower(), m.group(2)
        a = attrs(raw)
        name, f = a.get("name", ""), a.get("file", "")
        x, y, z = num(a.get("x")), num(a.get("y")), num(a.get("z"))
        rad = num(a.get("radius"))
        if ("jump" in f.lower() or name.lower().startswith("jumpto")) and a.get("destination"):
            s["jumps"].append({"name": name or "jumppoint", "dest": a.get("destination") or "",
                               "x": x, "y": y, "z": z})
        elif tag in ("planet", "moon") and name:
            p = {"name": name, "tex": f, "radius": rad, "x": x, "y": y, "z": z}
            s["planets"].append(p); planets.append(p)
        elif tag == "unit" and f:
            s["bases"].append({"file": f, "faction": a.get("faction") or "", "planet": "",
                               "x": x, "y": y, "z": z})
    for b in s["bases"]:
        if planets:
            best, bd = None, None
            for p in planets:
                d = (p["x"]-b["x"])**2 + (p["y"]-b["y"])**2 + (p["z"]-b["z"])**2
                if bd is None or d < bd: bd, best = d, p
            b["planet"] = best["name"]
    for p in list(s["planets"]):
        if "star" in p["tex"].lower() or "sun" in p["tex"].lower():
            s["star"] = p; s["planets"].remove(p); break
    systems[key] = s

# resolve jumps case-insensitively by basename
def resolve(dest):
    base = dest.split("/")[-1].lower()
    return base if base in systems else None
links = set()
for name, s in systems.items():
    for j in s["jumps"]:
        t = resolve(j["dest"])
        if t and t != name:
            links.add(tuple(sorted((name, t))))
print("systems:", len(systems), "| undirected jump links resolved:", len(links))
for a, b in sorted(links): print(f"   {a} <-> {b}")

# ---------- 2. ships (units.csv, shifted columns) ----------
with open(os.path.join(SRC, "units.csv"), newline="", encoding="utf-8", errors="replace") as f:
    lines = f.read().splitlines()
cols = next(csv.reader([lines[0]]))
cols = [c.strip() for c in cols]
def col_idx(name): return cols.index(name) - 1   # shift!
IDX = {k: col_idx(k) for k in ["Name", "Combat_Role", "Textual_Description", "Mass",
                               "Fuel_Capacity", "Hull", "Object_Type"]}
def cell(row, idx):
    if 0 <= idx < len(row) and row[idx] not in (None, ""):
        try: return float(row[idx])
        except ValueError: return None
    return None

WANT = ["Llama.begin", "Llama", "Dostoevsky", "Mule", "Gnosis", "Quicksilver", "Admonisher",
        "Hwyadoll", "Hidalgo", "Oraefir", "Sporjindil", "Garaughi", "Sindarvengen", "Allumarri",
        "Frankentype", "Pepperridge", "Gowda", "Britannia", "cphoenix", "Marauder", "Garrion",
        "Cunormdagger", "Honorary-Dostoevsky", "cadiz", "Cadiz", "Atlases", "Dignity"]
ships = {}
for ln in lines[3:]:
    if not ln.strip(): continue
    row = next(csv.reader([ln]), None)
    if not row: continue
    nm = row[0].strip() if row and row[0] else (row[2].strip() if len(row) > 2 and row[2] else "")
    if nm in WANT and nm not in ships:
        desc_i = IDX["Textual_Description"]
        ships[nm] = {
            "name": nm, "role": row[IDX["Combat_Role"]] if IDX["Combat_Role"] < len(row) else "",
            "desc": (row[desc_i] if desc_i < len(row) else "")[:200],
            "mass": cell(row, IDX["Mass"]) or 0,
            "fuel": cell(row, IDX["Fuel_Capacity"]) or 0,
            "hull": cell(row, IDX["Hull"]) or 0,
        }
print("\nships from units.csv:", len(ships))

# ---------- 3. prices + goods from master_part_list ----------
price_by_name = {}
goods = []
GOODCATS = ("Natural_Products","Raw_Materials","Refined_Materials","Industrially_Manufactured_Goods",
            "Consumer_and_Commercial_Goods","Specialty_Goods","Contraband","Passengers","Research")
with open(os.path.join(SRC, "master_part_list.csv"), newline="", encoding="utf-8", errors="replace") as f:
    for r in csv.DictReader(f):
        cat = (r.get("categoryname") or "").strip()
        fname = (r.get("file") or "").strip()
        try: price = float(r.get("price") or 0)
        except ValueError: price = 0
        if price <= 0 or not fname: continue
        if cat.startswith("starships"):
            price_by_name.setdefault(fname.split(".")[0], price)
            price_by_name.setdefault(fname, price)
        elif cat.split("/")[0] in GOODCATS:
            goods.append({"file": fname, "cat": cat, "price": price,
                          "volume": float(r.get("volume") or 1),
                          "desc": (r.get("description") or "")[:130]})
for nm, s in ships.items():
    s["price"] = price_by_name.get(nm, price_by_name.get(nm.split(".")[0], 0))
print("ships with price:", [(n, s["price"]) for n, s in ships.items() if s["price"]][:12])
print("goods:", len(goods))

# ---------- 4. factions ----------
import xml.etree.ElementTree as ET
try:
    facs = [c.get("name") for c in ET.parse(os.path.join(SRC, "factions.xml")).getroot() if c.get("name")]
except Exception:
    facs = re.findall(r'<Faction name="([^"]+)"', open(os.path.join(SRC, "factions.xml"), errors="replace").read())
print("factions:", len(facs))

json.dump({"systems": systems, "ships": list(ships.values()), "goods": goods,
           "factions": facs, "links": [list(l) for l in sorted(links)]}, open(OUT, "w"), indent=1)
print("\nwrote", OUT, os.path.getsize(OUT), "bytes")

for key in ["newconstantinople", "newdetroit", "perry", "junction", "xxn-1927"]:
    s = systems.get(key)
    if not s: continue
    print(f"\n== {s['sector']} / {key}:")
    for b in s["bases"][:8]: print(f"   base {b['file']:22} faction={b['faction']:9} around={b['planet']}")
    for j in s["jumps"][:10]: print(f"   jump {j['name']:20} -> {j['dest']}")
