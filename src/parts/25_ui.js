/* ============================================================
   Vega Strike web port - UI: flight HUD, station dialogs
   (market / shipyard / missions), galaxy map, help
   ============================================================ */

const UI = { hits: [], hover: null, dockTab: "market", marketScroll: 0, boardScroll: 0,
             hudShake: 0, flashTarget: 0, mapOpen: false, helpOpen: false, aboutOpen: false };

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

function fmtCr(n) {
  n = Math.round(n);
  return n.toLocaleString("en-US");
}
function fmtDist(km) {
  if (km < 1e4) return km.toFixed(0) + " km";
  return (km / 1000).toFixed(1) + " Mm";
}
function goodName(gf) { return gf.split("/").pop().replace(/_/g, " "); }

function btn(x, y, w, h, label, cb, opts = {}) {
  const hov = UI.hover && UI.hover.x === x && UI.hover.y === y;
  ctx.fillStyle = opts.dark ? (hov ? "#2c3454" : "#1a2038") : (hov ? "#2e3654" : "#20263e");
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = opts.active ? "#ffb400" : (opts.dark ? "#3a4468" : "#4a5478");
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = opts.active ? "#ffb400" : opts.col || "#c8d0e8";
  ctx.font = (opts.big ? "bold 12" : "11") + "px 'Lucida Console', monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, y + h / 2 + 0.5);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  UI.hits.push({ x, y, w, h, cb });
}

/* ---------- flight HUD ---------- */
function renderHUD(vw, vh) {
  const s = GAME.ship;
  const spd = V.len(s.vel) * 1000; // km/s
  ctx.font = "11px 'Lucida Console', monospace";
  // top-left: credits, cargo, fuel
  ctx.fillStyle = "#9aa4c0";
  ctx.fillText("CREDITS  " + fmtCr(PLAYER.credits), 12, 20);
  ctx.fillText("CARGO    " + Math.round(holdUsed(s)).toLocaleString("en-US") + " / " + holdMax(s).toLocaleString("en-US") + " L", 12, 34);
  ctx.fillText("FUEL     " + s.fuel.toFixed(1) + " / " + s.cfg.fuelMax.toFixed(0), 12, 48);
  ctx.fillText("SYSTEM   " + GAME.system, 12, 62);
  // hull/shield bars
  bar(12, 70, 130, 7, s.hull / hullMaxEff(s), s.hull / hullMaxEff(s) < 0.3 ? "#e04030" : "#00b000");
  bar(12, 80, 130, 7, s.shield / shieldMax(s), "#3f7fe0");
  // speed + assist + spec
  ctx.fillStyle = "#e8ecff";
  ctx.fillText(spd.toFixed(0) + " km/s" + (s.spec ? "  [SPEC x" + SPEC_MULT + "]" : "") + (s.assist ? "" : "  [NEWTONIAN]"), 12, vh - 12);
  // hint
  ctx.fillStyle = "#5a6488";
  ctx.fillText("W/S throttle \u00b7 arrows turn \u00b7 Q/E roll \u00b7 F fire \u00b7 T target enemy \u00b7 V spec \u00b7 N assist \u00b7 D dock \u00b7 J jump \u00b7 M map \u00b7 H help", 12, vh - 26);
  // message
  if (GAME.msgT > 0) {
    ctx.fillStyle = "#ffe27f"; ctx.font = "bold 13px 'Lucida Console', monospace";
    ctx.textAlign = "center";
    ctx.fillText(GAME.msg, vw / 2, 108);
    ctx.textAlign = "left";
  }
  // dock/jump prompts
  const { b, d } = nearestBase();
  if (b && d < DOCK_RANGE * 2) {
    ctx.fillStyle = d < DOCK_RANGE && V.len(s.vel) < DOCK_SPEED ? "#7fff9f" : "#c8d0e8";
    ctx.font = "bold 12px 'Lucida Console', monospace";
    ctx.textAlign = "center";
    ctx.fillText((d < DOCK_RANGE && V.len(s.vel) < DOCK_SPEED ? "[D] DOCK " : "") + b.name + "  " + fmtDist(d * 1000), vw / 2, vh / 2 + 90);
    ctx.textAlign = "left";
  }
  const { j, d: jd } = nearestJump();
  if (j && jd < JUMP_RANGE * 2) {
    ctx.fillStyle = jd < JUMP_RANGE ? "#c07fff" : "#8a93b8";
    ctx.font = "bold 12px 'Lucida Console', monospace";
    ctx.textAlign = "center";
    ctx.fillText((jd < JUMP_RANGE ? "[J] JUMP -> " : "jump point: ") + j.dest.split("/")[1] + "  " + fmtDist(jd * 1000), vw / 2, vh / 2 + 106);
    ctx.textAlign = "left";
  }
  // target panel top-right
  const tgt = GAME.npcs.find(n => n.id === GAME.target);
  if (tgt && !tgt.dead) {
    const x = vw - 190;
    ctx.fillStyle = facCol(tgt.faction); ctx.font = "bold 12px 'Lucida Console', monospace";
    ctx.fillText(tgt.name, x, 20);
    ctx.fillStyle = "#8a93b8"; ctx.font = "11px 'Lucida Console', monospace";
    ctx.fillText(tgt.faction + " / " + tgt.type, x, 34);
    const dist = fmtDist(V.len(V.sub(tgt.pos, s.pos)) * 1000);
    ctx.fillText(dist, x, 48);
    bar(x, 54, 170, 6, tgt.shield / tgt.shieldMax, "#3f7fe0");
    bar(x, 62, 170, 6, tgt.hull / tgt.hullMax, "#e04030");
  }
  // radar bottom-left
  renderRadar(70, vh - 90, 58);
  // jump tunnel overlay
  if (GAME.jumpT !== undefined) {
    ctx.fillStyle = "rgba(90,40,140,0.35)";
    ctx.fillRect(0, 0, vw, vh);
    ctx.fillStyle = "#e8d4ff"; ctx.font = "bold 16px 'Lucida Console', monospace";
    ctx.textAlign = "center";
    ctx.fillText("JUMPING TO " + GAME.jumpTo.toUpperCase(), vw / 2, vh / 2);
    ctx.textAlign = "left";
  }
}
function bar(x, y, w, h, frac, col) {
  frac = clamp(frac, 0, 1);
  ctx.fillStyle = "#20263e"; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = col; ctx.fillRect(x + 1, y + 1, (w - 2) * frac, h - 2);
  ctx.strokeStyle = "#3a4468"; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

/* ---------- station dialog ---------- */
function renderStation(vw, vh) {
  const bid = GAME.docked;
  const b = findBase(bid);
  if (!b) return;
  const x = 60, y = 30, w = 680, h = 540;
  ctx.fillStyle = "rgba(2,4,12,0.92)"; ctx.fillRect(0, 0, vw, vh);
  ctx.fillStyle = "#0c1124"; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#4a5478"; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = "#000080"; ctx.fillRect(x + 2, y + 2, w - 4, 22);
  ctx.fillStyle = "#e8ecff"; ctx.font = "bold 12px 'Lucida Console', monospace";
  ctx.fillText(b.name.toUpperCase() + "  \u00b7  " + GAME.system + "  \u00b7  " + b.faction.toUpperCase(), x + 12, y + 17);
  ctx.textAlign = "right";
  ctx.fillText(fmtCr(PLAYER.credits) + " cr", x + w - 12, y + 17);
  ctx.textAlign = "left";
  // tabs
  const tabs = [["market", "MARKET"], ["shipyard", "SHIPYARD"], ["missions", "MISSIONS"], ["bar", "INFO"]];
  let tx = x + 12;
  for (const [id, label] of tabs) {
    btn(tx, y + 32, 108, 24, label, () => { UI.dockTab = id; UI.marketScroll = 0; }, { active: UI.dockTab === id, dark: true });
    tx += 114;
  }
  btn(x + w - 100, y + 32, 88, 24, "LAUNCH", () => undock(), { active: true, dark: true });
  const py = y + 66;
  if (UI.dockTab === "market") renderMarket(x + 12, py, w - 24, h - 100, bid, b);
  else if (UI.dockTab === "shipyard") renderShipyard(x + 12, py, w - 24, h - 100, bid);
  else if (UI.dockTab === "missions") renderBoard(x + 12, py, w - 24, h - 100, bid);
  else renderInfo(x + 12, py, w - 24, h - 100, b);
}

function renderMarket(x, y, w, h, bid, b) {
  const s = GAME.ship;
  ctx.font = "11px 'Lucida Console', monospace";
  ctx.fillStyle = "#5a6488";
  ctx.fillText("GOOD" + " ".repeat(26) + "PRICE      STOCK     CARGO        BUY     SELL", x, y + 4);
  const goods = VS_DATA.goods.filter(g => !g.cat.startsWith("Contraband") || baseSellsContraband(bid));
  const rowH = 17, vis = Math.floor((h - 24) / rowH);
  UI.marketScroll = clamp(UI.marketScroll, 0, Math.max(0, goods.length - vis));
  let yy = y + 20;
  for (let k = UI.marketScroll; k < Math.min(goods.length, UI.marketScroll + vis); k++) {
    const g = goods[k];
    const price = goodPrice(bid, g.file);
    const stock = ECON.stock[bid][g.file];
    const have = s.cargo[g.file] || 0;
    const y0 = yy - 10;
    if (k % 2 === 0) { ctx.fillStyle = "rgba(40,48,80,0.35)"; ctx.fillRect(x, y0, w, rowH); }
    ctx.fillStyle = g.cat.startsWith("Contraband") ? "#ff9f7f" : "#c8d0e8";
    ctx.fillText(goodName(g.file).slice(0, 26), x, yy);
    ctx.fillStyle = "#7fff9f";
    ctx.fillText(String(price).padStart(7), x + 210, yy);
    ctx.fillStyle = "#8a93b8";
    ctx.fillText(String(Math.round(stock)).padStart(6), x + 296, yy);
    ctx.fillStyle = have > 0 ? "#ffb400" : "#5a6488";
    ctx.fillText(String(have).padStart(6), x + 380, yy);
    const canBuy = PLAYER.credits >= price && holdUsed(s) + g.volume <= holdMax(s) && stock > 0;
    btn(x + w - 116, y0 + 2, 52, 13, "BUY", () => trade(bid, g.file, 1, price), { dark: true, col: canBuy ? "#7fff9f" : "#5a6488" });
    btn(x + w - 58, y0 + 2, 52, 13, "SELL", () => trade(bid, g.file, -1, price), { dark: true, col: have > 0 ? "#ffb400" : "#5a6488" });
    yy += rowH;
  }
  // scroll buttons + buy/sell 10
  btn(x, y + h - 18, 60, 14, "\u25b2 UP", () => { UI.marketScroll -= 5; }, { dark: true });
  btn(x + 66, y + h - 18, 60, 14, "\u25bc DOWN", () => { UI.marketScroll += 5; }, { dark: true });
  ctx.fillStyle = "#5a6488";
  ctx.fillText("hold volume " + (holdUsed(s)/1000).toFixed(1) + "k / " + (holdMax(s)/1000).toFixed(0) + " L \u00b7 prices respond to stock (buy up = dearer, dump = cheaper)", x + 140, y + h - 7);
}

function trade(bid, gf, dir, price) {
  const s = GAME.ship;
  if (dir > 0) {
    const g = GOOD_BY_FILE[gf];
    const space = Math.floor((holdMax(s) - holdUsed(s)) / g.volume);
    const afford = Math.floor(PLAYER.credits / price);
    const stock = ECON.stock[bid][gf];
    const qty = Math.min(1, space, afford, stock);
    if (qty <= 0) { simMsg(space <= 0 ? "Cargo hold full" : afford <= 0 ? "Not enough credits" : "No stock"); return; }
    s.cargo[gf] = (s.cargo[gf] || 0) + qty;
    PLAYER.credits -= price * qty;
    ECON.stock[bid][gf] -= qty;
    sfx.beep();
  } else {
    const have = s.cargo[gf] || 0;
    if (have <= 0) { simMsg("Nothing to sell"); return; }
    s.cargo[gf] -= 1;
    if (s.cargo[gf] <= 0) delete s.cargo[gf];
    PLAYER.credits += price;
    ECON.stock[bid][gf] += 1;
    sfx.beep();
  }
}

function renderShipyard(x, y, w, h, bid) {
  ctx.font = "11px 'Lucida Console', monospace";
  ctx.fillStyle = "#5a6488";
  ctx.fillText("UPGRADE" + " ".repeat(21) + "EFFECT       PRICE       INSTALL", x, y + 4);
  const s = GAME.ship;
  const effect = (p) => {
    switch (p.kind) {
      case "gun": return "+" + gunDmg(p.file) + " dmg/gun";
      case "shield": return "+250 shield";
      case "armor": return "+25% hull";
      case "reactor": return "+15% dmg, +regen";
      case "engine": return "+40% thrust";
      case "spec": return "+25 SPEC fuel cap";
      case "cargo": return "+60000 L hold";
    }
  };
  const parts = VS_DATA.parts;
  const rowH = 20, vis = Math.floor((h - 30) / rowH);
  UI.marketScroll = clamp(UI.marketScroll, 0, Math.max(0, parts.length - vis));
  let yy = y + 20;
  for (let k = UI.marketScroll; k < Math.min(parts.length, UI.marketScroll + vis); k++) {
    const p = parts[k];
    const y0 = yy - 12;
    if (k % 2 === 0) { ctx.fillStyle = "rgba(40,48,80,0.35)"; ctx.fillRect(x, y0, w, rowH); }
    ctx.fillStyle = "#c8d0e8";
    ctx.fillText(p.file.replace(/_/g, " ").slice(0, 28), x, yy);
    ctx.fillStyle = "#7fbfff";
    ctx.fillText(effect(p), x + 220, yy);
    ctx.fillStyle = "#7fff9f";
    ctx.fillText(fmtCr(p.price), x + 370, yy);
    const owned = (p.kind === "gun" && s.gun === p.file) ||
      (p.kind === "shield" && s.shieldLevel >= k + 1) ||
      (p.kind === "armor" && s.armorLevel >= k + 1) ||
      (p.kind === "reactor" && s.reactorLevel >= k + 1) ||
      (p.kind === "engine" && s.overdrive >= k + 1) ||
      (p.kind === "spec" && s.specCap >= k + 1) ||
      (p.kind === "cargo" && s.cargoAdd > 0);
    btn(x + w - 80, y0 + 3, 72, 14, owned ? "OWNED" : "INSTALL",
        () => buyPart(p, k, bid), { dark: true, active: !owned, col: owned ? "#5a6488" : "#7fff9f" });
    yy += rowH;
  }
  btn(x, y + h - 18, 60, 14, "\u25b2 UP", () => { UI.marketScroll -= 5; }, { dark: true });
  btn(x + 66, y + h - 18, 60, 14, "\u25bc DOWN", () => { UI.marketScroll += 5; }, { dark: true });
  // repair + refuel line
  const repCost = Math.ceil((hullMaxEff(s) - s.hull) * 4);
  const fuelNeed = Math.ceil(s.cfg.fuelMax * (1 + s.specCap * 0.5) - s.fuel);
  const refuelCost = Math.ceil(fuelNeed * 5);
  btn(x + 140, y + h - 20, 150, 16, "REPAIR (" + fmtCr(repCost) + " cr)", () => {
    const c = Math.min(repCost, PLAYER.credits);
    PLAYER.credits -= Math.ceil((hullMaxEff(s) - s.hull) * 4);
    s.hull = hullMaxEff(s);
    simMsg("Hull repaired"); sfx.beep();
  }, { dark: true, col: repCost > 0 && PLAYER.credits >= repCost ? "#7fff9f" : "#5a6488" });
  btn(x + 300, y + h - 20, 160, 16, "REFUEL (" + fmtCr(refuelCost) + " cr)", () => {
    PLAYER.credits -= refuelCost;
    s.fuel = s.cfg.fuelMax * (1 + s.specCap * 0.5);
    simMsg("Tanks topped up"); sfx.beep();
  }, { dark: true, col: refuelCost > 0 && PLAYER.credits >= refuelCost ? "#7fff9f" : "#5a6488" });
}

function buyPart(p, k, bid) {
  const s = GAME.ship;
  if (PLAYER.credits < p.price) { simMsg("Not enough credits"); sfx.bad(); return; }
  PLAYER.credits -= p.price;
  switch (p.kind) {
    case "gun": s.gun = p.file; break;
    case "shield": s.shieldLevel = k + 1; s.shield = shieldMax(s); break;
    case "armor": s.armorLevel = k + 1; break;
    case "reactor": s.reactorLevel = k + 1; break;
    case "engine": s.overdrive = k + 1; break;
    case "spec": s.specCap = k + 1; break;
    case "cargo": s.cargoAdd = 1; break;
  }
  simMsg(p.file.replace(/_/g, " ") + " installed");
  sfx.win();
}

function renderBoard(x, y, w, h, bid) {
  ctx.font = "11px 'Lucida Console', monospace";
  // active missions
  let yy = y + 4;
  ctx.fillStyle = "#ffb400"; ctx.font = "bold 11px 'Lucida Console', monospace";
  ctx.fillText("ACTIVE MISSIONS", x, yy); yy += 16;
  ctx.font = "11px 'Lucida Console', monospace";
  const active = GAME.missions.filter(m => !m.done);
  if (!active.length) { ctx.fillStyle = "#5a6488"; ctx.fillText("none - accept work below", x, yy); yy += 16; }
  for (const m of active) {
    ctx.fillStyle = "#c8d0e8";
    ctx.fillText((m.kind === "bounty" ? "[" + m.killed + "/" + m.count + "] " : "") + m.title, x, yy);
    ctx.fillStyle = "#7fff9f";
    ctx.fillText(fmtCr(m.pay) + " cr", x + w - 90, yy);
    yy += 15;
  }
  yy += 8;
  ctx.fillStyle = "#ffb400"; ctx.font = "bold 11px 'Lucida Console', monospace";
  ctx.fillText("AVAILABLE WORK", x, yy); yy += 16;
  ctx.font = "11px 'Lucida Console', monospace";
  if (!GAME.boardCache || GAME.boardCache.bid !== bid) {
    GAME.boardCache = { bid, offers: [genMission(bid), genMission(bid + "|" + Math.floor(GAME.t)), genMission(bid + "||" + Math.floor(GAME.t))] };
  }
  for (const m of GAME.boardCache.offers) {
    ctx.fillStyle = "#c8d0e8";
    ctx.fillText(m.title.slice(0, 66), x, yy);
    ctx.fillStyle = "#7fff9f";
    ctx.fillText(fmtCr(m.pay) + " cr", x + w - 90, yy);
    btn(x + w - 160, yy - 12, 64, 15, "ACCEPT", () => {
      if (GAME.missions.filter(m2 => !m2.done).length >= 2) { simMsg("Mission computer: max 2 active jobs"); return; }
      GAME.missions.push(m);
      if (m.kind === "bounty") GAME.bountyActive = true;
      GAME.boardCache.offers = GAME.boardCache.offers.filter(o => o !== m);
      simMsg("Mission accepted"); sfx.beep();
    }, { dark: true, active: true });
    yy += 22;
  }
  yy += 6;
  ctx.fillStyle = "#5a6488";
  ctx.fillText("cargo jobs: be at the destination station with the goods loaded \u00b7 bounties: kill pirates, then dock anywhere", x, yy);
}

function renderInfo(x, y, w, h, b) {
  const lines = [
    ["Station", b.name + " (" + b.faction + ")"],
    ["System", GAME.system + " - " + SYS[GAME.system].planets.length + " planets, " + SYS[GAME.system].bases.length + " stations"],
    ["Jump links", SYS[GAME.system].jumps.map(j => j.dest.split("/")[1]).join(", ")],
    ["Ship", GAME.ship.type + " - " + GAME.ship.cfg.role],
    ["", GAME.ship.cfg.desc || ""],
    ["Funds", fmtCr(PLAYER.credits) + " cr"],
    ["Hull", Math.round(GAME.ship.hull) + " / " + Math.round(hullMaxEff(GAME.ship))],
    ["", ""],
    ["Local news", "pirate activity: " + (pirateDensity(GAME.system) ? "REPORTED - travel armed" : "none in this system")],
    ["", "confed customs inspect cargo at lawful stations"],
    ["", "the Gemini sector remembers: fly safe, trader"],
  ];
  ctx.font = "12px 'Lucida Console', monospace";
  let yy = y + 14;
  for (const [k, v] of lines) {
    if (k) { ctx.fillStyle = "#8a93b8"; ctx.fillText(k.toUpperCase(), x, yy); }
    ctx.fillStyle = v.startsWith("pirate") ? "#ff9f7f" : "#e8ecff";
    ctx.fillText(v, x + 130, yy);
    yy += 20;
  }
}

/* ---------- galaxy map ---------- */
function renderMap(vw, vh) {
  ctx.fillStyle = "#020208"; ctx.fillRect(0, 0, vw, vh);
  ctx.fillStyle = "#e8ecff"; ctx.font = "bold 14px 'Lucida Console', monospace";
  ctx.fillText("GEMINI SECTOR - 14 SYSTEMS OF THE WEB PORT", 20, 28);
  ctx.font = "11px 'Lucida Console', monospace";
  ctx.fillStyle = "#8a93b8";
  ctx.fillText("green = your position \u00b7 red = pirate-reported systems \u00b7 lines = jump links", 20, 46);
  const pos = {};
  VS_DATA.systems.forEach((s, i) => {
    const rng = mulberry32(hashStr(s.name));
    pos[s.name] = [80 + rng() * 640, 80 + rng() * 460];
  });
  ctx.strokeStyle = "#3a4468";
  for (const [a, b] of VS_DATA.links) {
    ctx.beginPath();
    ctx.moveTo(pos[a][0], pos[a][1]); ctx.lineTo(pos[b][0], pos[b][1]);
    ctx.stroke();
  }
  for (const s of VS_DATA.systems) {
    const [x, y] = pos[s.name];
    const cur = s.name === GAME.system;
    const pir = pirateDensity(s.name) > 1;
    ctx.fillStyle = cur ? "#7fff9f" : pir ? "#ff6a5a" : "#7fa8ff";
    ctx.beginPath(); ctx.arc(x, y, cur ? 6 : 4, 0, 7); ctx.fill();
    ctx.fillStyle = cur ? "#7fff9f" : "#c8d0e8";
    ctx.font = "11px 'Lucida Console', monospace";
    ctx.fillText(s.name + (pir ? " !" : ""), x + 7, y + 3);
  }
  btn(vw - 110, vh - 40, 90, 24, "CLOSE", () => { UI.mapOpen = false; }, { active: true });
}
