/* ============================================================
   Vega Strike web port - core: vec math, seeded RNG, market
   model with stock dynamics, ship config, save/load
   Units: 1 engine unit = 1 Mm = 1000 km. Credits = VS credits.
   ============================================================ */
"use strict";

const V = {
  add:(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],
  sub:(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],
  scale:(a,k)=>[a[0]*k,a[1]*k,a[2]*k],
  dot:(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],
  cross:(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],
  len:(a)=>Math.sqrt(a[0]*a[0]+a[1]*a[1]+a[2]*a[2]),
  norm:(a)=>{const l=V.len(a)||1;return [a[0]/l,a[1]/l,a[2]/l];},
  clone:(a)=>[a[0],a[1],a[2]],
};
const RAD = (d)=>d*Math.PI/180, DEG = (r)=>r*180/Math.PI;
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const RAD2 = (d)=>d*Math.PI/180;

function mulberry32(seed) {
  let s = seed >>> 0;
  return function() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) & 0xFFFFFFFF;
  return h >>> 0;
}

/* ---------- universe lookups ---------- */
const SYS = {};
for (const s of VS_DATA.systems) {
  if (s.star) s.star.pos = [s.star.x, s.star.y, s.star.z];
  for (const p of s.planets) p.pos = [p.x, p.y, p.z];
  for (const b of s.bases) b.pos = [b.x, b.y, b.z];
  for (const j of s.jumps) j.pos = [j.x, j.y, j.z];
  SYS[s.name] = s;
}
const SYS_NAMES = VS_DATA.systems.map(s => s.name);
const GOOD_BY_FILE = {};
for (const g of VS_DATA.goods) GOOD_BY_FILE[g.file] = g;
const SHIP_BY_NAME = {};
for (const s of VS_DATA.ships) SHIP_BY_NAME[s.name] = s;

function baseId(sname, bname) { return sname + "::" + bname; }
function findBase(bid) {
  const [sn, bn] = bid.split("::");
  const s = SYS[sn];
  if (!s) return null;
  return s.bases.find(b => b.name === bn) || null;
}
function jumpsFrom(sname) { return SYS[sname].jumps; }

/* ---------- economy (verified in scripts/vsport/verify_game.py) ----------
   price(base, good, day) = good.price * mult
   mult = seeded variation in [0.75,1.35] * stock response
   stock response: x = (s0 - stock)/s0  ->  * clamp(1 + 0.35*x, 0.6, 1.6)
   selling fills stock (price drops), buying empties it (price rises),
   restock toward s0 at 0.8%/s. Contraband only traded at pirate bases. */
const DAY_SEC = 600;
function marketMult0(bid, gf, day) {
  const rng = mulberry32(hashStr(bid + "|" + gf + "|" + day));
  return 0.75 + 0.6 * rng();
}
function baseStock0(bid, gf) {
  const rng = mulberry32(hashStr("stock|" + bid + "|" + gf));
  const g = GOOD_BY_FILE[gf];
  return Math.round(40 + rng() * 260 * (60 / Math.max(1, g.price)));
}
function goodPrice(bid, gf) {
  const g = GOOD_BY_FILE[gf];
  const st = ECON.stock[bid] && ECON.stock[bid][gf] !== undefined ? ECON.stock[bid][gf] : baseStock0(bid, gf);
  const s0 = baseStock0(bid, gf);
  const day = Math.floor(GAME.t / DAY_SEC);
  let m = marketMult0(bid, gf, day);
  m *= clamp(1 + 0.35 * (s0 - st) / s0, 0.6, 1.6);
  return Math.max(1, Math.round(g.price * m));
}
const ECON = { stock: {}, day: 0 };
function econInit() {
  for (const s of VS_DATA.systems) for (const b of s.bases) {
    const bid = baseId(s.name, b.name);
    ECON.stock[bid] = {};
    for (const g of VS_DATA.goods) ECON.stock[bid][g.file] = baseStock0(bid, g.file);
  }
}
function econTick(dt) {
  for (const bid in ECON.stock) {
    const row = ECON.stock[bid];
    for (const gf in row) {
      const s0 = baseStock0(bid, gf);
      row[gf] += (s0 - row[gf]) * 0.008 * dt;
    }
  }
}
function baseSellsContraband(bid) {
  const b = findBase(bid);
  return b && b.type === "pirate_base";
}

/* ---------- ship configs ---------- */
function shipCfg(type) {
  const s = SHIP_BY_NAME[type];
  return {
    type, desc: s.desc, role: s.role,
    mass: s.mass, hullMax: s.hull, fuelMax: Math.max(25, s.fuel * 20),
    holdMax: (type === "Llama.begin" || type === "Llama") ? 20000 :
             (type === "Mule" || type === "Hidalgo") ? 800000 : 45000,
    accel: type === "Llama.begin" || type === "Llama" ? 0.55 :
           type === "Quicksilver" ? 0.95 :
           type === "Dostoevsky" ? 0.75 :
           type === "Admonisher" ? 0.85 : 0.35,
    turn: RAD(100),
    price: s.price,
  };
}
function gunDmg(file) {
  const p = { "laser":8, "Ion_Burster":12, "Micro_Driver":14, "Mini_Driver":16,
              "Disruptor":22, "Pugilist":26 }[file] || 8;
  return p;
}
function gunRof(file) { return 2.2; } // shots/s

/* ---------- game state ---------- */
const GAME = {
  t: 0, system: "newconstantinople",
  ship: null,            // player
  npcs: [], projectiles: [],
  target: null,          // npc id or "base:<bid>" or "jump:<idx>"
  docked: null,          // bid while docked
  missions: [], missionLog: [],
  msg: "", msgT: 0,
  paused: false, view: "chase", over: null, started: false,
};
function simMsg(m) { GAME.msg = m; GAME.msgT = 4.5; }

/* ---------- player ship ---------- */
function newShip(type, sys, pos) {
  const cfg = shipCfg(type);
  return {
    player: true, id: "player", name: "your vessel", faction: "merchant_guild",
    type, cfg,
    pos: V.clone(pos), vel: [0,0,0],
    fwd: [0.8,0.2,0.4], up: [0,0,1],
    hull: cfg.hullMax, hullMax: cfg.hullMax,
    shield: 100, shieldMax: 100,
    fuel: cfg.fuelMax * 0.75,
    gun: "laser", armorLevel: 0, reactorLevel: 0, overdrive: 0, specCap: 0, cargoAdd: 0,
    assist: true, spec: false,
    cargo: {},
    cooldown: 0,
    hostileTo: {},
  };
}
function holdMax(ship) { return ship.cfg.holdMax + (ship.cargoAdd ? 60000 : 0); }
function holdUsed(ship) {
  let u = 0;
  for (const gf in ship.cargo) u += ship.cargo[gf] * GOOD_BY_FILE[gf].volume;
  return u;
}
function shieldMax(ship) { return 100 + ship.shieldLevel * 250; }
function hullMaxEff(ship) { return ship.hullMax * (1 + ship.armorLevel * 0.25); }
function thrustAccel(ship) { return ship.cfg.accel * (1 + ship.overdrive * 0.4); }

/* ---------- damage ---------- */
function applyDamage(ship, dmg) {
  if (ship.shield > 0) {
    const a = Math.min(ship.shield, dmg);
    ship.shield -= a; dmg -= a;
  }
  if (dmg > 0) ship.hull -= dmg;
  if (ship.hull <= 0) {
    ship.hull = 0;
    if (ship.player) { GAME.over = "destroyed"; }
    else { ship.dead = true; }
  }
}

/* ---------- save/load (localStorage) ---------- */
function saveGame() {
  if (GAME.docked === null) { simMsg("Save available at stations only"); return false; }
  const s = GAME.ship;
  const data = {
    v: 1, t: GAME.t, system: GAME.system, docked: GAME.docked,
    credits: PLAYER.credits,
    ship: {
      type: s.type, hull: s.hull, fuel: s.fuel, gun: s.gun,
      armorLevel: s.armorLevel, reactorLevel: s.reactorLevel, shieldLevel: s.shieldLevel,
      overdrive: s.overdrive, specCap: s.specCap, cargoAdd: s.cargoAdd,
      cargo: s.cargo, assist: s.assist,
    },
    econ: ECON.stock, missions: GAME.missions, log: GAME.missionLog.slice(-40),
  };
  try {
    localStorage.setItem("vs_web_save", JSON.stringify(data));
    simMsg("Game saved");
    sfx.beep();
    return true;
  } catch (e) { simMsg("Save failed: " + e.message); return false; }
}
function loadGame() {
  const raw = localStorage.getItem("vs_web_save");
  if (!raw) { simMsg("No saved game found"); return false; }
  try {
    const d = JSON.parse(raw);
    newGame();
    GAME.t = d.t; GAME.system = d.system; GAME.docked = d.docked;
    PLAYER.credits = d.credits;
    ECON.stock = d.econ || ECON.stock;
    GAME.missions = d.missions || []; GAME.missionLog = d.log || [];
    const s = GAME.ship;
    Object.assign(s, d.ship);
    s.cfg = shipCfg(d.ship.type);
    s.hullMax = s.cfg.hullMax;
    s.shield = shieldMax(s);
    s.pos = V.add(findBase(GAME.docked).pos ? findBase(GAME.docked).pos : [0,0,0], [3.5,0,0]);
    GAME.started = true; GAME.dockedOpen = true;
    simMsg("Game loaded - docked at " + GAME.docked.split("::")[1]);
    return true;
  } catch (e) { simMsg("Load failed: " + e.message); return false; }
}
const PLAYER = { credits: 6000 };
