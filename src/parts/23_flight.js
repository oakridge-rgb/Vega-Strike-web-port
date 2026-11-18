/* ============================================================
   Vega Strike web port - flight & combat: thrust, flight
   assist, SPEC drive, docking, jump points, projectiles, NPC AI
   ============================================================ */

const SPEC_MULT = 200;
const ASSIST_K = 0.5;        // flight-assist drag (1/s)
const DOCK_RANGE = 6;        // Mm
const DOCK_SPEED = 3;        // Mm/s
const JUMP_RANGE = 10;       // Mm

function rotateBasis(ship, axis, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const rot = (vec) => V.add(V.add(V.scale(vec, c), V.scale(V.cross(axis, vec), s)), V.scale(axis, V.dot(axis, vec) * (1 - c)));
  ship.fwd = V.norm(rot(ship.fwd));
  const r = V.norm(V.cross(ship.fwd, ship.up));
  ship.up = V.norm(V.cross(r, ship.fwd));
  ship.right = r;
}
function ensureBasis(ship) {
  if (!ship.right) ship.right = V.norm(V.cross(ship.fwd, ship.up));
  ship.fwd = V.norm(ship.fwd);
  const r = V.norm(V.cross(ship.fwd, ship.up));
  ship.up = V.norm(V.cross(r, ship.fwd));
  ship.right = r;
}

function flyShip(ship, input, dt) {
  // input: {pitch, yaw, roll, thrust(0..1), boost}
  ensureBasis(ship);
  ship.cooldown = Math.max(0, ship.cooldown - dt);
  const rate = ship.cfg.turn * dt;
  if (input.pitch) rotateBasis(ship, ship.right, input.pitch * rate);
  if (input.yaw)   rotateBasis(ship, ship.up, -input.yaw * rate);
  if (input.roll)  rotateBasis(ship, ship.fwd, input.roll * rate);
  const T = thrustAccel(ship) * (input.boost ? 2.2 : 1) * input.thrust;
  if (T > 0) {
    ship.vel = V.add(ship.vel, V.scale(ship.fwd, T * dt));
    ship.fuel = Math.max(0, ship.fuel - 0.02 * dt * input.thrust);
  }
  if (ship.assist) {
    const k = 1 - Math.exp(-ASSIST_K * dt);
    ship.vel = V.sub(ship.vel, V.scale(ship.vel, k));
  }
  if (ship.spec && ship.fuel > 0) {
    ship.vel = V.scale(ship.vel, 1 + (SPEC_MULT - 1) * Math.min(1, dt * 3));
    ship.fuel = Math.max(0, ship.fuel - 0.25 * dt);
    if (ship.fuel <= 0) { ship.spec = false; if (ship.player) simMsg("SPEC offline - fuel exhausted"); }
  }
  ship.pos = V.add(ship.pos, V.scale(ship.vel, dt));
}

/* ---------- gunnery ---------- */
function fireGun(ship) {
  if (ship.cooldown > 0 || GAME.docked) return;
  const dmg = gunDmg(ship.gun) * (1 + (ship.reactorLevel || 0) * 0.15);
  const right = ship.right || V.cross(ship.fwd, ship.up);
  for (const off of [-0.14, 0.14]) {  // twin mounts, converged at 6 Mm
    const spawn = V.add(ship.pos, V.add(V.scale(ship.fwd, 0.15), V.scale(right, off)));
    const aim = V.add(ship.pos, V.scale(ship.fwd, 6));  // convergence point
    const dir = V.norm(V.sub(aim, spawn));
    GAME.projectiles.push({
      pos: spawn,
      vel: V.add(ship.vel, V.scale(dir, 6)),
      owner: ship.id, dmg, life: 1.2, col: ship.player ? "#7fff9f" : "#ff9f7f",
    });
  }
  ship.cooldown = 1 / gunRof(ship.gun);
  if (ship.player) sfx.zap();
}

function stepProjectiles(dt) {
  const ships = [GAME.ship, ...GAME.npcs].filter(s => s && !s.dead && !s.gone);
  for (const p of GAME.projectiles) {
    p.pos = V.add(p.pos, V.scale(p.vel, dt));
    p.life -= dt;
    for (const s of ships) {
      if (p.owner === s.id) continue;
      if (V.len(V.sub(p.pos, s.pos)) < 0.25) {
        applyDamage(s, p.dmg);
        p.life = 0;
        p.hit = s.id;
        if (p.owner === "player" && !s.player) {
          // attacking a ship makes its faction hostile to you
          s.hostileToPlayer = true;
          if (GAME.target === s.id) UI.flashTarget = 0.2;
        }
        if (s.player) { UI.hudShake = 0.25; sfx.hit(); }
        break;
      }
    }
  }
  GAME.projectiles = GAME.projectiles.filter(p => p.life > 0);
}

/* ---------- NPCs ---------- */
let NPC_SEQ = 1;
function spawnNPC(kind, sname, nearPos) {
  const rng = mulberry32((hashStr(sname) + NPC_SEQ * 7919) >>> 0);
  NPC_SEQ++;
  let type, faction, name;
  if (kind === "pirate") {
    type = rng() < 0.75 ? "Dostoevsky" : "Hidalgo";
    faction = "pirates";
    name = "raider " + (100 + Math.floor(rng() * 900));
  } else if (kind === "merchant") {
    type = rng() < 0.6 ? "Llama" : (rng() < 0.5 ? "Mule" : "Quicksilver");
    faction = rng() < 0.5 ? "merchant_guild" : "confed";
    name = faction === "confed" ? "confed patrol " + (10 + Math.floor(rng() * 90)) : "trader " + (10 + Math.floor(rng() * 900));
  } else {
    type = "Admonisher";
    faction = "confed";
    name = "confed patrol " + (10 + Math.floor(rng() * 90));
  }
  const cfg = shipCfg(type);
  const sys = SYS[sname];
  const b = sys.bases[Math.floor(rng() * sys.bases.length)];
  const pos = nearPos || V.add(b.pos, [(rng()-0.5)*40, (rng()-0.5)*40, (rng()-0.5)*40]);
  const hullMax = cfg.hullMax * (faction === "pirates" && type === "Dostoevsky" ? 0.6 : 1);
  const shieldMax = faction === "pirates" ? (type === "Hidalgo" ? 500 : 100) : (faction === "confed" ? 300 : 100);
  return {
    player: false, id: "npc" + NPC_SEQ, name, faction, type, cfg,
    pos, vel: [(rng()-0.5)*0.6, (rng()-0.5)*0.6, (rng()-0.5)*0.6],
    fwd: V.norm([(rng()-0.5), (rng()-0.5), (rng()-0.5)]), up: [0,0,1],
    hull: hullMax, hullMax, shield: shieldMax, shieldMax,
    fuel: 100, cargo: {}, cooldown: 0,
    kind, behavior: kind === "pirate" ? "hunt" : (faction === "confed" ? "patrol" : "trade"),
    hostileToPlayer: false, state: "cruise", targetPos: null, stateT: 0,
  };
}
function npcHostilesIn(sname) {
  return GAME.npcs.filter(n => !n.dead && n.kind === "pirate" && (n.hostileToPlayer || n.behavior === "hunt"));
}
function pirateDensity(sname) {
  return ["saxtogue","nd-57","rikel","44-p-im"].includes(sname) ? 3 :
         ["junction","aldebran","varnus"].includes(sname) ? 1 : 0;
}
function spawnSystemNPCs(sname) {
  GAME.npcs = [];
  GAME.projectiles = [];
  const rng = mulberry32(hashStr("npcs|" + sname + "|" + Math.floor(GAME.t / 120)));
  const np = pirateDensity(sname);
  for (let k = 0; k < np; k++) GAME.npcs.push(spawnNPC("pirate", sname));
  const merchants = 3 + Math.floor(rng() * 2);
  for (let k = 0; k < merchants; k++) GAME.npcs.push(spawnNPC("merchant", sname));
  if (pirateDensity(sname) > 1) GAME.npcs.push(spawnNPC("patrol", sname));
}

function steerToward(n, desired, dt, rateScale) {
  const cur = n.fwd;
  const dotv = clamp(V.dot(cur, desired), -1, 1);
  const ang = Math.acos(dotv);
  const step = Math.min(ang, n.cfg.turn * (rateScale || 0.5) * dt);
  if (ang > 1e-4) {
    const axis = V.norm(V.cross(cur, desired));
    rotateBasis(n, axis, step);
  }
}
function npcTick(n, dt) {
  if (n.dead) return;
  ensureBasis(n);
  n.stateT -= dt;
  n.cooldown = Math.max(0, n.cooldown - dt);
  const player = GAME.ship;
  const distP = V.len(V.sub(player.pos, n.pos));
  let desired = n.fwd, thrust = 0.85;

  if (n.behavior === "trade") {
    if (!n.targetPos || n.stateT <= 0) {
      const b = SYS[GAME.system].bases[Math.floor(Math.random() * SYS[GAME.system].bases.length)];
      n.targetPos = V.add(b.pos, [(Math.random()-0.5)*6, (Math.random()-0.5)*6, (Math.random()-0.5)*6]);
      n.stateT = 25 + Math.random() * 20;
    }
    const d = V.sub(n.targetPos, n.pos);
    if (V.len(d) < 8) { n.vel = V.scale(n.vel, 1 - Math.min(1, dt * 2)); thrust = 0.15; }
    desired = V.norm(d);
  } else if (n.behavior === "patrol") {
    // hunt pirates; otherwise cruise
    const pirates = GAME.npcs.filter(x => x.kind === "pirate" && !x.dead);
    let tgt = null, bd = 1e9;
    for (const p of pirates) {
      const d = V.len(V.sub(p.pos, n.pos));
      if (d < bd) { bd = d; tgt = p; }
    }
    if (tgt && bd < 60) {
      desired = V.norm(V.sub(tgt.pos, n.pos));
      if (bd < 5 && n.cooldown <= 0) fireGunNPC(n, tgt);
      thrust = bd > 3 ? 1 : 0.2;
    } else if (!n.targetPos || n.stateT <= 0) {
      n.targetPos = V.add(SYS[GAME.system].star ? SYS[GAME.system].star.pos || [0,0,0] : [0,0,0], [(Math.random()-0.5)*300, (Math.random()-0.5)*200, (Math.random()-0.5)*300]);
      n.stateT = 20 + Math.random() * 15;
    } else desired = V.norm(V.sub(n.targetPos, n.pos));
  } else { // pirate hunt
    if (distP < 90 && (n.hostileToPlayer || pirateHostileByDefault())) {
      desired = V.norm(V.sub(player.pos, n.pos));
      if (distP < 6.5 && n.cooldown <= 0) fireGunNPC(n, player);
      thrust = distP > 2.5 ? 1 : 0.3;
      if (distP < 1.5) desired = V.scale(V.norm(V.sub(player.pos, n.pos)), -0.3);
    } else if (!n.targetPos || n.stateT <= 0) {
      const b = SYS[GAME.system].bases[Math.floor(Math.random() * SYS[GAME.system].bases.length)];
      n.targetPos = V.add(b.pos, [(Math.random()-0.5)*50, (Math.random()-0.5)*50, (Math.random()-0.5)*50]);
      n.stateT = 18 + Math.random() * 15;
    } else desired = V.norm(V.sub(n.targetPos, n.pos));
  }
  steerToward(n, desired, dt);
  // integrate (assist-style)
  n.vel = V.add(n.vel, V.scale(n.fwd, thrust * n.cfg.accel * dt));
  n.vel = V.sub(n.vel, V.scale(n.vel, Math.min(1, ASSIST_K * dt)));
  n.pos = V.add(n.pos, V.scale(n.vel, dt));
}
function pirateHostileByDefault() {
  return GAME.npcs.filter(n => n.kind === "pirate").every(n => n.hostileToPlayer) || GAME.bountyActive === true;
}
function fireGunNPC(n, tgt) {
  const dmg = gunDmg("laser") * 0.8;
  const dir = V.norm(V.sub(tgt.pos, n.pos));
  GAME.projectiles.push({
    pos: V.add(n.pos, V.scale(dir, 0.2)),
    vel: V.add(n.vel, V.scale(dir, 5.5)),
    owner: n.id, dmg, life: 1.3, col: "#ff9f7f",
  });
  n.cooldown = 0.8;
}

/* ---------- docking & jumping ---------- */
function nearestBase() {
  const s = SYS[GAME.system];
  let best = null, bd = 1e9;
  for (const b of s.bases) {
    const d = V.len(V.sub(b.pos, GAME.ship.pos));
    if (d < bd) { bd = d; best = b; }
  }
  return { b: best, d: bd };
}
function nearestJump() {
  const s = SYS[GAME.system];
  let best = null, bd = 1e9, bi = -1;
  s.jumps.forEach((j, i) => {
    const d = V.len(V.sub(j.pos, GAME.ship.pos));
    if (d < bd) { bd = d; best = j; bi = i; }
  });
  return { j: best, d: bd, i: bi };
}
function tryDock() {
  const { b, d } = nearestBase();
  if (!b || d > DOCK_RANGE) { simMsg("No station in range (" + (b ? d.toFixed(1) : "-") + " Mm, need < " + DOCK_RANGE + ")"); return; }
  if (V.len(GAME.ship.vel) > DOCK_SPEED) { simMsg("Too fast to dock - slow to under " + DOCK_SPEED + " Mm/s"); return; }
  GAME.docked = baseId(GAME.system, b.name);
  GAME.dockedOpen = true;
  UI.dockTab = "market";
  GAME.ship.vel = [0,0,0]; GAME.ship.spec = false;
  GAME.bountyActive = false;
  // confed customs: contraband check (documented VS mechanic)
  const bid = GAME.docked;
  const hasContraband = Object.keys(GAME.ship.cargo).some(gf => gf.startsWith("Contraband/") || GOOD_BY_FILE[gf] && GOOD_BY_FILE[gf].cat.startsWith("Contraband"));
  const bfac = b.faction;
  if (hasContraband && (bfac === "confed" || bfac === "merchant_guild")) {
    let seized = 0, fines = 0;
    for (const gf in GAME.ship.cargo) {
      if (GOOD_BY_FILE[gf].cat.startsWith("Contraband")) {
        seized += GAME.ship.cargo[gf];
        fines += goodPrice(bid, gf) * GAME.ship.cargo[gf];
        delete GAME.ship.cargo[gf];
      }
    }
    PLAYER.credits = Math.max(0, PLAYER.credits - Math.round(fines * 0.5));
    simMsg("Customs: " + seized + " units of contraband seized, fined " + Math.round(fines * 0.5) + " cr");
    sfx.bad();
  } else {
    simMsg("Docked at " + b.name);
    sfx.beep();
  }
  checkMissions();
  saveGame();
}
function undock() {
  if (GAME.docked === null) return;
  const b = findBase(GAME.docked);
  GAME.docked = null; GAME.dockedOpen = false;
  GAME.ship.pos = V.add(b.pos, V.scale(V.norm([1, 0.2, 0.4]), DOCK_RANGE * 1.3));
  GAME.ship.vel = [0.6, 0.12, 0.24];
  ensureBasis(GAME.ship);
  simMsg("Undocked - good hunting");
}
function tryJump() {
  if (GAME.jumpT !== undefined) return;
  const { j, d, i } = nearestJump();
  if (!j || d > JUMP_RANGE) { simMsg("No jump point in range"); return; }
  GAME.jumpT = 0; GAME.jumpTo = j.dest;
  sfx.jump();
}
function stepJump(dt) {
  if (GAME.jumpT === undefined) return;
  GAME.jumpT += dt;
  if (GAME.jumpT > 2.5) {
    GAME.system = GAME.jumpTo;
    const dest = SYS[GAME.system];
    if (dest.jumps.length) {
      // arrive near the first jump point back
      GAME.ship.pos = V.add(dest.jumps[0].pos, [3, 1, 2]);
      GAME.ship.vel = [0.4, 0.1, 0.2];
    } else GAME.ship.pos = [0, 0, 0];
    ensureBasis(GAME.ship);
    spawnSystemNPCs(GAME.system);
    GAME.jumpT = undefined; GAME.jumpTo = null;
    simMsg("Arrived in " + GAME.system);
  }
}

/* ---------- missions ---------- */
function genMission(bid) {
  const rng = mulberry32(hashStr("miss|" + bid + "|" + Math.floor(GAME.t / 300)));
  const [sn] = bid.split("::");
  const s = SYS[sn];
  const links = [...new Set(VS_DATA.links.filter(l => l.includes(sn)).map(l => l[0] === sn ? l[1] : l[0]))];
  if (rng() < 0.6 && links.length) {
    // cargo delivery
    const legal = VS_DATA.goods.filter(g => !g.cat.startsWith("Contraband"));
    const g = legal[Math.floor(rng() * legal.length)];
    const qty = 8 + Math.floor(rng() * 25);
    const destSn = links[Math.floor(rng() * links.length)];
    const destBase = SYS[destSn].bases[Math.floor(rng() * SYS[destSn].bases.length)];
    const pay = Math.round(qty * g.price * (0.35 + rng() * 0.5) + 800);
    return { kind: "cargo", good: g.file, qty, from: bid, to: baseId(destSn, destBase.name), pay,
             title: "Cargo: " + qty + " " + g.file.replace(/_/g, " ") + " to " + destBase.name + " (" + destSn + ")",
             done: false };
  } else {
    const n = 2 + Math.floor(rng() * 3);
    const pay = n * 1500 + Math.round(rng() * 800);
    return { kind: "bounty", count: n, killed: 0, pay,
             title: "Bounty: destroy " + n + " pirates", done: false };
  }
}
function checkMissions() {
  for (const m of GAME.missions) {
    if (m.done) continue;
    if (m.kind === "cargo" && GAME.docked === m.to) {
      const have = GAME.ship.cargo[m.good] || 0;
      if (have >= m.qty) {
        GAME.ship.cargo[m.good] = have - m.qty;
        PLAYER.credits += m.pay;
        m.done = true;
        GAME.missionLog.push("Delivered " + m.qty + " x " + m.good + " - paid " + m.pay + " cr");
        simMsg("Mission complete: +" + m.pay + " cr");
        sfx.win();
      } else simMsg("Delivery needs " + m.qty + " x " + m.good + " (have " + have + ")");
    }
    if (m.kind === "bounty" && GAME.docked && m.killed >= m.count) {
      PLAYER.credits += m.pay;
      m.done = true;
      GAME.missionLog.push("Bounty fulfilled - paid " + m.pay + " cr");
      simMsg("Bounty paid: +" + m.pay + " cr");
      sfx.win();
    }
  }
  GAME.missions = GAME.missions.filter(m => !m.done || m.keep);
}
