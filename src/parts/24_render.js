/* ============================================================
   Vega Strike web port - render: chase-cam 3D projection,
   procedural planets, vector ships, projectiles, radar, HUD
   ============================================================ */

const VIEW = { fov: 420, shake: 0 };

/* ---------- procedural planet textures ---------- */
const TEX = {};
function makeTextures() {
  const defs = {
    sun:  ["#ffd060", "sun"], earthlike: ["#4f7bd9", "earth"],
    rock: ["#a9907b", "rock"], ice: ["#cfe0ee", "rock"],
    gas:  ["#d8b48c", "gas"], dark: ["#5a6478", "rock"],
  };
  for (const s of VS_DATA.systems) {
    const list = [];
    if (s.star) list.push([s.star, "sun"]);
    for (const p of s.planets) {
      const t = p.tex.toLowerCase();
      let k = "rock";
      if (t.includes("earth") || t.includes("forest") || t.includes("m_class")) k = "earthlike";
      else if (t.includes("gas") || t.includes("jupiter") || t.includes("saturn") || t.includes("neptune") || t.includes("uranus")) k = "gas";
      else if (t.includes("ice") || t.includes("snow")) k = "ice";
      else if (t.includes("dirt") || t.includes("rock")) k = "rock";
      list.push([p, k]);
    }
    for (const [obj, k] of list) {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 64;
      const c = cv.getContext("2d");
      const rng = mulberry32(hashStr(s.name + obj.name));
      c.fillStyle = defs[k][0]; c.fillRect(0, 0, 64, 64);
      if (k === "sun") {
        for (let i = 0; i < 380; i++) {
          c.fillStyle = rng() < 0.5 ? "rgba(255,230,120,0.3)" : "rgba(255,120,20,0.3)";
          c.fillRect(rng() * 64, rng() * 64, 2, 2);
        }
      } else if (k === "gas") {
        let y = 0;
        while (y < 64) {
          const h = 3 + rng() * 8;
          c.globalAlpha = 0.5 + rng() * 0.3;
          c.fillStyle = rng() < 0.5 ? "#c9a97e" : "#e8d9b8";
          c.fillRect(0, y, 64, h); y += h;
        }
        c.globalAlpha = 1;
      } else if (k === "earthlike") {
        for (let i = 0; i < 12; i++) {
          c.fillStyle = "#3f9e44";
          c.beginPath();
          c.ellipse(rng() * 64, rng() * 64, 3 + rng() * 10, 2 + rng() * 6, rng() * 3, 0, 7);
          c.fill();
        }
        for (let i = 0; i < 10; i++) {
          c.fillStyle = "rgba(255,255,255,0.5)";
          c.beginPath();
          c.ellipse(rng() * 64, rng() * 64, 4 + rng() * 8, 2 + rng() * 2, 0, 0, 7);
          c.fill();
        }
      } else {
        for (let i = 0; i < 45; i++) {
          const x = rng() * 64, y = rng() * 64, rr = 1 + rng() * 3.4;
          c.fillStyle = "rgba(30,25,20,0.4)";
          c.beginPath(); c.arc(x, y, rr, 0, 7); c.fill();
        }
      }
      TEX[s.name + "/" + obj.name] = cv;
    }
  }
}

/* ---------- projection ---------- */
const CAM = { pos: [0,0,0], fwd: [1,0,0], up: [0,0,1], right: [0,1,0] };
function project(p, cx, cy, vw, vh) {
  const rel = V.sub(p, CAM.pos);
  const z = V.dot(rel, CAM.fwd);
  if (z <= 0.2) return null;
  const x = V.dot(rel, CAM.right), y = V.dot(rel, CAM.up);
  return { x: cx + VIEW.fov * x / z, y: cy - VIEW.fov * y / z, z, sx: VIEW.fov / z };
}

/* ---------- starfield ---------- */
const STARS = [];
function makeStars() {
  const rng = mulberry32(42);
  for (let k = 0; k < 520; k++) {
    const z = rng() * 2 - 1, th = rng() * Math.PI * 2, rr = Math.sqrt(1 - z * z);
    STARS.push({ d: [rr * Math.cos(th), rr * Math.sin(th), z], m: rng() });
  }
}

/* ---------- ship sprite drawing ---------- */
const SHIP_SHAPES = {
  Llama:      [[0,-0.6],[0.35,0.15],[0.12,0.5],[-0.12,0.5],[-0.35,0.15]],
  Dostoevsky: [[0,-0.7],[0.3,-0.2],[0.42,0.35],[0,0.6],[-0.42,0.35],[-0.3,-0.2]],
  Mule:       [[-0.5,-0.5],[0.5,-0.5],[0.5,0.35],[0.2,0.5],[-0.2,0.5],[-0.5,0.35]],
  Quicksilver:[[0,-0.75],[0.22,0.2],[0.08,0.55],[-0.08,0.55],[-0.22,0.2]],
  Admonisher: [[0,-0.75],[0.28,-0.3],[0.55,0.1],[0.3,0.55],[-0.3,0.55],[-0.55,0.1],[-0.28,-0.3]],
  Hidalgo:    [[0,-0.65],[0.5,-0.1],[0.5,0.4],[-0.5,0.4],[-0.5,-0.1]],
};
const FAC_COLOR = {
  pirates: "#ff6a5a", confed: "#7fa8ff", merchant_guild: "#7fffd4",
  merchants: "#7fffd4", LIHW: "#ffd47f", ISO: "#e07fff",
};
function facCol(f) { return FAC_COLOR[f] || "#c8c8d4"; }

function drawShipSprite(ctx, ship, X, Y, px, col) {
  const shape = SHIP_SHAPES[ship.type] || SHIP_SHAPES.Llama;
  // orient by projecting fwd/right onto screen plane
  const fw = V.sub(ship.fwd, V.scale(CAM.fwd, V.dot(ship.fwd, CAM.fwd)));
  const rt = V.sub(ship.right || V.cross(ship.fwd, ship.up), V.scale(CAM.fwd, V.dot(ship.right || [0,1,0], CAM.fwd)));
  let ang = 0;
  if (V.len(fw) > 1e-5) ang = Math.atan2(V.dot(fw, CAM.up), V.dot(fw, CAM.right));
  else if (V.len(rt) > 1e-5) ang = Math.atan2(V.dot(rt, CAM.up), V.dot(rt, CAM.right)) + Math.PI / 2;
  ctx.save();
  ctx.translate(X, Y);
  ctx.rotate(ang);
  const s = Math.max(4, px);
  ctx.strokeStyle = col; ctx.lineWidth = 1.4;
  ctx.beginPath();
  shape.forEach((pt, i) => {
    const pxp = pt[0] * s, pyp = -pt[1] * s;
    if (i === 0) ctx.moveTo(pxp, pyp); else ctx.lineTo(pxp, pyp);
  });
  ctx.closePath(); ctx.stroke();
  if (ship.player) { ctx.fillStyle = "rgba(127,255,159,0.25)"; ctx.fill(); }
  ctx.restore();
}

/* ---------- main scene render ---------- */
function renderScene(cx, cy, vw, vh) {
  ctx.fillStyle = "#020208";
  ctx.fillRect(0, 0, vw, vh);
  const ship = GAME.ship;
  // camera
  const shake = UI.hudShake > 0 ? (Math.random()-0.5) * 6 * UI.hudShake : 0;
  const camBack = 2.2, camUp = 0.7;
  CAM.pos = V.sub(ship.pos, V.scale(ship.fwd, camBack));
  CAM.pos = V.add(CAM.pos, V.scale(ship.up, camUp));
  CAM.fwd = ship.fwd; CAM.up = ship.up; CAM.right = ship.right;
  // stars
  for (const st of STARS) {
    const dz = V.dot(st.d, CAM.fwd);
    if (dz < 0.06) continue;
    const X = cx + VIEW.fov * (V.dot(st.d, CAM.right) / dz) + shake;
    const Y = cy - VIEW.fov * (V.dot(st.d, CAM.up) / dz) + shake;
    if (X < 0 || X > vw || Y < 0 || Y > vh) continue;
    ctx.globalAlpha = 0.3 + st.m * 0.7;
    ctx.fillStyle = "#dfe4ff";
    ctx.fillRect(X, Y, st.m > 0.85 ? 2 : 1, st.m > 0.85 ? 2 : 1);
  }
  ctx.globalAlpha = 1;
  const sys = SYS[GAME.system];
  const drawList = [];
  if (sys.star) drawList.push({ kind: "planet", obj: sys.star });
  for (const p of sys.planets) drawList.push({ kind: "planet", obj: p });
  for (const b of sys.bases) drawList.push({ kind: "base", obj: b });
  for (const j of sys.jumps) drawList.push({ kind: "jump", obj: j });
  for (const n of GAME.npcs) if (!n.dead) drawList.push({ kind: "ship", obj: n });
  for (const p of GAME.projectiles) drawList.push({ kind: "proj", obj: p });
  // depth sort
  for (const d of drawList) d.z = V.dot(V.sub(d.obj.pos, CAM.pos), CAM.fwd);
  drawList.sort((a, b) => b.z - a.z);

  for (const d of drawList) {
    const pr = project(d.obj.pos, cx, cy, vw, vh);
    if (!pr) continue;
    if (d.kind === "planet") {
      const o = d.obj;
      const px = Math.max(2, o.r * pr.sx);
      if (pr.x < -px || pr.x > vw + px || pr.y < -px || pr.y > vh + px) continue;
      const tex = TEX[GAME.system + "/" + o.name];
      ctx.save();
      ctx.beginPath(); ctx.arc(pr.x, pr.y, px, 0, 7); ctx.clip();
      if (px < 6 || !tex) {
        ctx.fillStyle = o === sys.star ? "#ffd060" : "#8898b8";
        ctx.fillRect(pr.x - px, pr.y - px, px * 2, px * 2);
      } else ctx.drawImage(tex, pr.x - px, pr.y - px, px * 2, px * 2);
      // shading toward star
      const sunDir = sys.star ? V.norm(V.sub(o.pos, sys.star.pos)) : [1,0,0];
      const lx = V.dot(sunDir, CAM.right), ly = V.dot(sunDir, CAM.up);
      const g = ctx.createRadialGradient(pr.x - lx * px * 0.9, pr.y + ly * px * 0.9, px * 0.15, pr.x, pr.y, px * 1.5);
      g.addColorStop(0, "rgba(255,255,255,0.16)");
      g.addColorStop(0.5, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,8,0.9)");
      ctx.fillStyle = g; ctx.fillRect(pr.x - px, pr.y - px, px * 2 + 1, px * 2 + 1);
      ctx.restore();
      if (px > 14) {
        ctx.fillStyle = "#8a93b8"; ctx.font = "10px 'Lucida Console', monospace";
        ctx.fillText(o.name, pr.x + px + 4, pr.y + 3);
      }
    } else if (d.kind === "base") {
      const px = Math.max(3, 0.5 * pr.sx);
      ctx.strokeStyle = "#c8d4e8"; ctx.lineWidth = 1.2;
      ctx.strokeRect(pr.x - px, pr.y - px, px * 2, px * 2);
      ctx.beginPath(); ctx.moveTo(pr.x - px, pr.y); ctx.lineTo(pr.x + px, pr.y);
      ctx.moveTo(pr.x, pr.y - px); ctx.lineTo(pr.x, pr.y + px); ctx.stroke();
      if (px > 8 || d.z < 20) {
        ctx.fillStyle = facCol(d.obj.faction);
        ctx.font = "10px 'Lucida Console', monospace";
        ctx.fillText(d.obj.name, pr.x + px + 3, pr.y + 3);
      }
    } else if (d.kind === "jump") {
      const px = Math.max(3, 0.6 * pr.sx);
      ctx.strokeStyle = "#c07fff"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(pr.x, pr.y, px, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(pr.x, pr.y, px * 0.5, 0, 7); ctx.stroke();
      if (d.z < 40) {
        ctx.fillStyle = "#c07fff"; ctx.font = "10px 'Lucida Console', monospace";
        ctx.fillText("jump: " + d.obj.dest.split("/")[1], pr.x + px + 3, pr.y + 3);
      }
    } else if (d.kind === "ship") {
      const n = d.obj;
      const px = clamp(1.1 * pr.sx, 3, 26);
      drawShipSprite(ctx, n, pr.x, pr.y, px, facCol(n.faction));
      if (GAME.target === n.id) {
        ctx.strokeStyle = "#ffb400"; ctx.lineWidth = 1;
        const r = px + 6;
        ctx.beginPath();
        ctx.moveTo(pr.x - r, pr.y - r + 4); ctx.lineTo(pr.x - r, pr.y - r); ctx.lineTo(pr.x - r + 4, pr.y - r);
        ctx.moveTo(pr.x + r - 4, pr.y - r); ctx.lineTo(pr.x + r, pr.y - r); ctx.lineTo(pr.x + r, pr.y - r + 4);
        ctx.moveTo(pr.x + r, pr.y + r - 4); ctx.lineTo(pr.x + r, pr.y + r); ctx.lineTo(pr.x + r - 4, pr.y + r);
        ctx.moveTo(pr.x - r + 4, pr.y + r); ctx.lineTo(pr.x - r, pr.y + r); ctx.lineTo(pr.x - r, pr.y + r - 4);
        ctx.stroke();
      }
      if (d.z < 30) {
        ctx.fillStyle = facCol(n.faction); ctx.font = "9px 'Lucida Console', monospace";
        ctx.fillText(n.name + " " + d.z.toFixed(1) + " Mm", pr.x + px + 3, pr.y - 3);
      }
    } else if (d.kind === "proj") {
      ctx.fillStyle = d.obj.col;
      ctx.fillRect(pr.x - 1.5, pr.y - 1.5, 3, 3);
    }
  }

  // crosshair + lead reticle for targeted ship
  const tgt = GAME.npcs.find(n => n.id === GAME.target);
  if (tgt && !tgt.dead) {
    const rel = V.sub(tgt.pos, ship.pos);
    const closing = V.len(V.sub(tgt.vel, ship.vel));
    const t = V.len(rel) / 6;
    const lead = V.add(tgt.pos, V.scale(V.sub(tgt.vel, ship.vel), t));
    const prl = project(lead, cx, cy, vw, vh);
    if (prl) {
      ctx.strokeStyle = "#ffb400";
      ctx.beginPath(); ctx.arc(prl.x, prl.y, 4, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(prl.x - 7, prl.y); ctx.lineTo(prl.x - 3, prl.y);
      ctx.moveTo(prl.x + 3, prl.y); ctx.lineTo(prl.x + 7, prl.y); ctx.stroke();
    }
  }
}

/* ---------- radar ---------- */
function renderRadar(cx, cy, R) {
  ctx.strokeStyle = "#28304a"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.55, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
  ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
  const ship = GAME.ship;
  const blip = (pos, col, kind) => {
    const rel = V.sub(pos, ship.pos);
    let z = V.dot(rel, ship.fwd);
    const x = V.dot(rel, ship.right), y = V.dot(rel, ship.up);
    const rng = 160;
    const k = R / rng;
    const front = z >= 0;
    if (Math.abs(z) > rng || Math.abs(x) > rng || Math.abs(y) > rng) {
      const mx = Math.max(Math.abs(z), Math.abs(x), Math.abs(y)) / rng;
      z /= mx; var xx = x / mx; var yy = y / mx;
    } else { var xx = x, yy = y; }
    const bx = cx + xx * k, by = cy - yy * k;
    ctx.fillStyle = col;
    if (!front) {
      ctx.strokeStyle = col;
      ctx.strokeRect(bx - 1.5, by - 1.5, 3, 3);
    } else ctx.fillRect(bx - 1.5, by - 1.5, 3, 3);
  };
  for (const n of GAME.npcs) if (!n.dead) blip(n.pos, facCol(n.faction), "ship");
  const sys = SYS[GAME.system];
  for (const b of sys.bases) blip(b.pos, "#c8d4e8", "base");
  for (const j of sys.jumps) blip(j.pos, "#c07fff", "jump");
  if (sys.star) blip(sys.star.pos, "#ffd060", "sun");
  for (const p of sys.planets) blip(p.pos, "#8898b8", "planet");
}
