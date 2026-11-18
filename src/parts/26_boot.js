/* ============================================================
   Vega Strike web port - boot: input, audio, main loop,
   new game, self-test, help
   ============================================================ */

/* ---------- audio ---------- */
const SOUND = { on: true, ac: null, engGain: null };
function audioCtx() {
  if (!SOUND.on) return null;
  if (!SOUND.ac) {
    try { SOUND.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
  }
  if (SOUND.ac.state === "suspended") SOUND.ac.resume();
  return SOUND.ac;
}
function blip(freq, dur, vol, type, slideTo) {
  const ac = audioCtx(); if (!ac) return;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type || "square"; o.frequency.value = freq;
  if (slideTo) o.frequency.linearRampToValueAtTime(slideTo, ac.currentTime + dur / 1000);
  g.gain.setValueAtTime(vol || 0.05, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur / 1000);
  o.connect(g).connect(ac.destination);
  o.start(); o.stop(ac.currentTime + dur / 1000 + 0.02);
}
function startEngLoop() {
  const ac = audioCtx();
  if (!ac || SOUND.engGain) return;
  const len = ac.sampleRate * 2;
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const dd = buf.getChannelData(0);
  for (let k = 0; k < len; k++) dd[k] = (Math.random() * 2 - 1) * 0.5;
  const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
  const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 140;
  const g = ac.createGain(); g.gain.value = 0;
  src.connect(lp).connect(g).connect(ac.destination);
  src.start();
  SOUND.engGain = g;
}
const sfx = {
  beep:  () => blip(660, 40, 0.04),
  bad:   () => blip(180, 150, 0.06, "sawtooth"),
  zap:   () => blip(940, 60, 0.05, "square", 240),
  hit:   () => blip(140, 120, 0.08, "sawtooth"),
  jump:  () => { blip(200, 500, 0.07, "sine", 1400); },
  win:   () => [523, 659, 784].forEach((f, i) => setTimeout(() => blip(f, 100, 0.06), i * 90)),
  update(dt) {
    const ac = audioCtx();
    if (!ac) return;
    startEngLoop();
    const want = (!GAME.docked && GAME.started && !UI.mapOpen && GAME.ship && GAME.ship.fuel > 0)
      ? 0.03 + 0.05 * (GAME.input ? GAME.input.thrust : 0) : 0;
    if (SOUND.engGain) SOUND.engGain.gain.value += (want - SOUND.engGain.gain.value) * Math.min(1, dt * 6);
  },
};

/* ---------- new game ---------- */
function newGame() {
  GAME.t = 0;
  GAME.system = "newconstantinople";
  GAME.docked = null; GAME.dockedOpen = false;
  GAME.missions = []; GAME.missionLog = [];
  GAME.over = null; GAME.jumpT = undefined; GAME.jumpTo = null;
  GAME.target = null; GAME.bountyActive = false;
  PLAYER.credits = 6000;
  econInit();
  const nc = SYS["newconstantinople"];
  const home = nc.bases[0];
  GAME.ship = newShip("Llama.begin", GAME.system, V.add(home.pos, [22, 6, 14]));
  ensureBasis(GAME.ship);
  GAME.ship.fwd = V.norm(V.sub(home.pos, GAME.ship.pos));
  spawnSystemNPCs(GAME.system);
  GAME.started = true;
  simMsg("With Lauktk's death, ownership of this vessel has passed on to you. Make it count.");
  GAME.msgT = 8;
}

/* ---------- input ---------- */
const KEYS = {};
GAME.input = { pitch: 0, yaw: 0, roll: 0, thrust: 0, boost: false };
document.addEventListener("keydown", (e) => {
  if (e.key === "Tab") e.preventDefault();
  if (UI.mapOpen || UI.helpOpen || UI.aboutOpen) {
    if (e.key === "Escape" || e.key === "m" || e.key === "M" || e.key === "h" || e.key === "H") {
      UI.mapOpen = UI.helpOpen = UI.aboutOpen = false;
    }
    return;
  }
  if (GAME.docked) {
    if (e.key === "Escape") undock();
    return;
  }
  KEYS[e.key] = true;
  switch (e.key) {
    case "f": case "F": fireGun(GAME.ship); break;
    case "t": case "T": cycleTarget(); break;
    case "v": case "V":
      if (GAME.ship.fuel > 0.5) {
        GAME.ship.spec = !GAME.ship.spec;
        simMsg(GAME.ship.spec ? "SPEC drive engaged" : "SPEC disengaged");
        sfx.beep();
      } else { simMsg("No fuel for SPEC"); }
      break;
    case "n": case "N":
      GAME.ship.assist = !GAME.ship.assist;
      simMsg(GAME.ship.assist ? "Flight assist ON" : "Flight assist OFF - Newtonian flight");
      break;
    case "d": case "D": tryDock(); break;
    case "j": case "J": tryJump(); break;
    case "m": case "M": UI.mapOpen = true; break;
    case "h": case "H": UI.helpOpen = true; break;
    case "F5": e.preventDefault(); saveGame(); break;
  }
});
document.addEventListener("keyup", (e) => { delete KEYS[e.key]; });
function cycleTarget() {
  const enemies = GAME.npcs.filter(n => !n.dead);
  if (!enemies.length) { GAME.target = null; return; }
  let k = enemies.findIndex(n => n.id === GAME.target);
  GAME.target = enemies[(k + 1) % enemies.length].id;
  sfx.beep();
}
canvas.addEventListener("wheel", (e) => {
  if (GAME.docked) {
    UI.marketScroll += e.deltaY > 0 ? 3 : -3;
    e.preventDefault();
  }
}, { passive: false });
canvas.addEventListener("click", (e) => {
  const rc = canvas.getBoundingClientRect();
  const mx = (e.clientX - rc.left) * (800 / rc.width), my = (e.clientY - rc.top) * (600 / rc.height);
  audioCtx();
  for (const h of UI.hits) {
    if (mx >= h.x && mx <= h.x + h.w && my >= h.y && my <= h.y + h.h) { h.cb(); return; }
  }
});

/* ---------- continuous input ---------- */
function gatherInput(dt) {
  const inp = GAME.input;
  inp.pitch = (KEYS["ArrowUp"] ? -1 : 0) + (KEYS["ArrowDown"] ? 1 : 0);
  inp.yaw = (KEYS["ArrowLeft"] ? -1 : 0) + (KEYS["ArrowRight"] ? 1 : 0);
  inp.roll = (KEYS["q"] || KEYS["Q"] ? 1 : 0) + (KEYS["e"] || KEYS["E"] ? -1 : 0);
  if (KEYS["w"] || KEYS["W"]) inp.thrust = Math.min(1, inp.thrust + dt * 1.5);
  if (KEYS["s"] || KEYS["S"]) inp.thrust = Math.max(0, inp.thrust - dt * 2);
  if (KEYS[" "]) inp.boost = true; else inp.boost = false;
  return inp;
}

/* ---------- mission hooks for kills ---------- */
function onNpcKilled(n) {
  if (n.kind === "pirate") {
    PLAYER.credits += 700;
    simMsg("Pirate destroyed - bounty +700 cr");
    for (const m of GAME.missions) if (m.kind === "bounty" && !m.done) m.killed++;
    sfx.hit();
  }
}

/* ---------- main loop ---------- */
var lastTs = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
  lastTs = ts;
  UI.hits = [];
  UI.hudShake = Math.max(0, UI.hudShake - dt);
  const vw = 800, vh = 600;

  if (GAME.started && !GAME.over && !GAME.paused) {
    const simDt = dt;
    GAME.t += simDt;
    if (GAME.msgT > 0) GAME.msgT -= dt;
    if (!GAME.docked) {
      const inp = gatherInput(dt);
      flyShip(GAME.ship, inp, simDt);
      for (const n of GAME.npcs) npcTick(n, simDt);
      stepProjectiles(simDt);
      const dead = GAME.npcs.filter(n => n.dead);
      if (dead.length) {
        for (const n of dead) onNpcKilled(n);
        GAME.npcs = GAME.npcs.filter(n => !n.dead);
      }
      stepJump(simDt);
    }
    econTick(simDt);
  }
  sfx.update(dt);

  // render
  ctx.save();
  if (GAME.started) {
    renderScene(400, 300, vw, vh);
    renderHUD(vw, vh);
    if (GAME.docked && GAME.dockedOpen) renderStation(vw, vh);
    if (UI.mapOpen) renderMap(vw, vh);
    if (UI.helpOpen) renderHelp(vw, vh);
    if (GAME.over) renderOver(vw, vh);
  } else {
    renderTitle(vw, vh);
  }
  ctx.restore();
}

/* ---------- title ---------- */
function renderTitle(vw, vh) {
  ctx.fillStyle = "#020208"; ctx.fillRect(0, 0, vw, vh);
  const rng = mulberry32(1);
  for (const st of STARS) {
    ctx.globalAlpha = 0.3 + st.m * 0.7;
    ctx.fillStyle = "#dfe4ff";
    ctx.fillRect((st.d[0] * 0.5 + 0.5) * vw, (st.d[1] * 0.5 + 0.5) * vh, st.m > 0.85 ? 2 : 1, st.m > 0.85 ? 2 : 1);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffb400"; ctx.font = "bold 34px 'Lucida Console', monospace";
  ctx.fillText("VEGA STRIKE", vw / 2, 180);
  ctx.fillStyle = "#8a93b8"; ctx.font = "12px 'Lucida Console', monospace";
  ctx.fillText("WEB PORT", vw / 2, 204);
  ctx.fillStyle = "#c8d0e8"; ctx.font = "12px 'Lucida Console', monospace";
  ctx.fillText("A clean-room browser tribute to the open-source space sim", vw / 2, 250);
  ctx.fillText("engine & assets: GPL (vegastrike) \u00b7 this port: no original engine code", vw / 2, 268);
  ctx.fillText("trade \u00b7 explore \u00b7 fight \u00b7 upgrade - in the Gemini sector", vw / 2, 286);
  btn(vw / 2 - 70, 330, 140, 34, "START GAME", () => { audioCtx(); newGame(); }, { active: true });
  btn(vw / 2 - 70, 376, 140, 30, "LOAD SAVE", () => { audioCtx(); if (loadGame()) {} }, { dark: true });
  ctx.fillStyle = "#5a6488"; ctx.font = "11px 'Lucida Console', monospace";
  ctx.fillText("you inherit a Llama and 6,000 credits at New Constantinople", vw / 2, 430);
  ctx.textAlign = "left";
}

function renderHelp(vw, vh) {
  ctx.fillStyle = "rgba(2,4,12,0.92)"; ctx.fillRect(0, 0, vw, vh);
  ctx.fillStyle = "#0c1124"; ctx.fillRect(150, 40, 500, 510);
  ctx.strokeStyle = "#4a5478"; ctx.strokeRect(150.5, 40.5, 499, 509);
  ctx.fillStyle = "#ffb400"; ctx.font = "bold 13px 'Lucida Console', monospace";
  ctx.fillText("FLIGHT CONTROLS", 170, 66);
  ctx.font = "11px 'Lucida Console', monospace";
  const L = [
    ["W / S", "throttle up / down"],
    ["Arrow keys", "pitch & yaw \u00b7 Q / E roll"],
    ["Space", "boost (2.2x thrust)"],
    ["F", "fire twin guns"],
    ["T", "cycle target \u00b7 V SPEC drive \u00b7 N flight assist"],
    ["D", "dock (near station, under 3 Mm/s)"],
    ["J", "jump (near violet jump point)"],
    ["M", "galaxy map \u00b7 H this help \u00b7 F5 save (stations)"],
    ["", ""],
    ["LOOP", "dock -> market: buy low -> jump/fly -> sell high"],
    ["", "missions board pays cargo & bounty jobs"],
    ["", "shipyard: guns, shields, armor, overdrive, SPEC caps"],
    ["", "pirates hunt in saxtogue, nd-57, rikel, 44-p-im"],
    ["", "confed customs seize contraband (pirate dens sell it)"],
  ];
  let yy = 90;
  for (const [k, v] of L) {
    ctx.fillStyle = "#7fbfff"; ctx.fillText(k, 170, yy);
    ctx.fillStyle = "#c8d0e8"; ctx.fillText(v, 280, yy);
    yy += 20;
  }
  btn(360, 510, 90, 24, "CLOSE", () => { UI.helpOpen = false; }, { active: true });
}

function renderOver(vw, vh) {
  ctx.fillStyle = "rgba(60,0,0,0.75)"; ctx.fillRect(0, 0, vw, vh);
  ctx.textAlign = "center";
  ctx.fillStyle = "#ff6a5a"; ctx.font = "bold 26px 'Lucida Console', monospace";
  ctx.fillText("YOUR HULL IS GONE", vw / 2, 260);
  ctx.fillStyle = "#c8d0e8"; ctx.font = "12px 'Lucida Console', monospace";
  ctx.fillText("The Gemini sector will write your name in the ledger anyway.", vw / 2, 292);
  ctx.textAlign = "left";
  btn(vw / 2 - 120, 330, 110, 28, "RESTART", () => { newGame(); }, { active: true });
  btn(vw / 2 + 10, 330, 110, 28, "TITLE", () => { GAME.started = false; GAME.over = null; }, { dark: true });
}

/* ---------- JS self-test (same checks as verify_game.py) ---------- */
function simSelfTest() {
  const okConn = (() => {
    const adj = {}; VS_DATA.systems.forEach(s => adj[s.name] = []);
    VS_DATA.links.forEach(([a, b]) => { adj[a].push(b); adj[b].push(a); });
    const seen = new Set(["newconstantinople"]), st = ["newconstantinople"];
    while (st.length) for (const n of adj[st.pop()]) if (!seen.has(n)) { seen.add(n); st.push(n); }
    return seen.size === VS_DATA.systems.length;
  })();
  const bid = "newconstantinople::" + SYS["newconstantinople"].bases[0].name;
  econInit();
  const g = VS_DATA.goods.find(g => !g.cat.startsWith("Contraband"));
  const okMarket = goodPrice(bid, g.file) > 0 && baseStock0(bid, g.file) > 0;
  const ok = okConn && okMarket;
  console.log("[VS self-test] connectivity:", okConn, "| market:", okMarket, "|", ok ? "PASSED" : "FAILED");
  return ok;
}

/* ---------- boot ---------- */
makeTextures();
makeStars();
econInit();
UI.coreOK = simSelfTest();
requestAnimationFrame(frame);
// manual single-frame paint (headless test harness / debugging)
window.renderOne = function() { frame(performance.now()); GAME.msgT = Math.max(0, GAME.msgT - 0.05); };
