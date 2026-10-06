// ---------------------------------------------------------------------------
// nightlife.js — Frenchmen Street: OrleaRouge's bars and clubs.
//
// Four clubs on the French District block by the boulevard (orlearouge.js hands
// the block over through main.js's `lots`), two facing each street:
//
//   THE PINK PELICAN     gay bar — go-go boys on the boxes
//   BAYOU BELLES         lesbian bar — go-go girls
//   CLUB BOUNCE          strip club — women on the pole, everybody welcome
//   BIG EASY BEEFCAKE    male revue — men on the pole, everybody welcome
//
// Walk in the door — no loading screen: while you're inside, the roof lifts off
// and the walls drop to knee height so the camera sees in. Two things to do,
// both heal (and cost):
//   the TIP RAIL at the stage    $10 — make it rain; a dancer twerks for you, +15 HP
//   the VIP CHAIR in the corner  $40 — a lap dance, NOLA bounce all the way down
//                                      and a kiss to finish, +45 HP
// Inside, a bounce beat plays (synthesized — no audio files) and the soundtrack
// ducks under it. The regulars have things to say if you bump into them.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { makeDancer, makeStripper, makeHoodrat, randomGayMan, randomLesbian, randomHoodrat } from "./characters.js";
import { neonSignTexture, aspectOf } from "./neonsign.js";

export const PRICES = Object.freeze({ tip: 10, lapDance: 40 });
const HEAL = { tip: 15, lapDance: 45 };

const CLUBS = [
  { name: "THE PINK PELICAN", kind: "gay bar", ink: "#ff4fb3", glow: 0xff4fb3, pole: false, dancers: ["m", "m"],
    crowd: ["gayman", "gayman", "gayman"], blurb: "Gay bar. Go-go boys, cheap well drinks, and a disco ball older than you." },
  { name: "BAYOU BELLES", kind: "lesbian bar", ink: "#b28cff", glow: 0x9b5de5, pole: false, dancers: ["f", "f"],
    crowd: ["lesbian", "lesbian", "lesbian"], blurb: "Lesbian bar. Pool table, go-go girls, and trivia on Tuesdays." },
  { name: "CLUB BOUNCE", kind: "strip club", ink: "#ffd23a", glow: 0xffb13a, pole: true, dancers: ["f", "f"],
    crowd: ["hoodrat", "gayman", "lesbian"], blurb: "Strip club. NOLA bounce on the pole — everybody's welcome." },
  { name: "BIG EASY BEEFCAKE", kind: "male revue", ink: "#3ae0ff", glow: 0x2ee6d6, pole: true, dancers: ["m", "m"],
    crowd: ["hoodratF", "gayman", "lesbian"], blurb: "Male revue. Men on the pole — everybody's welcome." },
];
const LABELS = { gayman: "Gay Guy", lesbian: "Lesbian", hoodrat: "Hoodrat", hoodratF: "Hoodrat" };

const W = 12, D = 12, H = 4.4, T = 0.3;       // a club, door on local +z
const DROP = 0.22;                             // walls cut to this fraction while you're inside
// How many of the paying public are in the room (human request, 2026-09-30).
// Three was a set with people in it: the room is 12 × 12 and the bar, the rail
// and the floor hold a dozen easily, and the tip rail only means anything if
// there is somebody watching you do it.
const PATRONS = 12;
// Where they stand, in club-local coordinates: a row at the front of the stage,
// a knot out on the floor, and the ones who never leave the bar stools.
const PATRON_SPOTS = [
  [-4.4, -2.7], [-3.0, -2.9], [-1.6, -2.7], [-0.2, -2.9],
  [-4.6, 0.4], [-1.2, 0.9], [1.4, 0.2], [-2.6, 2.4], [0.4, 2.9], [2.6, 2.2],
  [3.3, -2.4], [3.3, -0.6], [3.3, 1.2],
];
const BAR_SPOTS = new Set([10, 11, 12]);
// The lighting, the same two ideas the Crown Strip's halls hang off their
// trusses with (interiors.js `lightRig` / `laserBar`): a row of par cans that
// sweeps, and a fan that cuts across the floor. Additive geometry, not lights.
const RIG_COLOURS = [0xff2e93, 0x3ae0ff, 0xffd23a, 0x9b5de5];

function basic(color, extra = {}) {
  const m = new THREE.MeshBasicMaterial({ color, ...extra });
  m.userData.gtbRealized = true;
  return m;
}
function std(name, color, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ name, color, roughness: 0.75, ...extra });
  m.userData.gtbRealized = true;
  return m;
}
// the lighting rig's hardware: matte black, so the only thing you see of a par
// can is its lens and its beam
function rigMetal() {
  const m = new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.55, metalness: 0.45 });
  m.userData.gtbRealized = true;
  return m;
}
// A club's name board. The plane it is mapped onto is (W - 1) x 2.2 m, so the
// canvas is built at that ratio, and the font is measured and shrunk to fit — a
// long name like BIG EASY BEEFCAKE is never clipped. See neonsign.js.
function signTexture(text, ink) {
  return neonSignTexture({
    text, ink, bg: "#0c0710",
    aspect: aspectOf(W - 1, 2.2),
    padding: 0.07, glow: 28, lineWidth: 6,
  });
}
function floorTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d");
  const cols = ["#ff2e93", "#2ee6d6", "#ffd23a", "#9b5de5"];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    x.fillStyle = cols[(i + j * 3) % 4]; x.fillRect(i * 64 + 2, j * 64 + 2, 60, 60);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- the bounce beat
// A NOLA bounce loop at ~102 BPM: the "Triggerman" boom-boom kick, claps on two
// and four, sixteenth hats, and a brassy stab. Scheduled ahead on WebAudio.
function createBounceBeat() {
  let ac = null, out = null, noise = null, timer = null, nextT = 0, step = 0, level = 0;
  const STEP = 60 / 102 / 4;
  const KICK = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  const CLAP = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1];
  const STAB = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0];
  function init() {
    if (ac) return true;
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return false; }
    out = ac.createGain(); out.gain.value = 0; out.connect(ac.destination);
    noise = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    nextT = ac.currentTime + 0.05;
    timer = setInterval(schedule, 40);
    return true;
  }
  function env(t, peak, decay) {
    const g = ac.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    g.connect(out);
    return g;
  }
  function kick(t) {
    const o = ac.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.16);
    o.connect(env(t, 0.9, 0.22));
    o.start(t); o.stop(t + 0.25);
  }
  function burst(t, type, freq, peak, decay) {
    const s = ac.createBufferSource(); s.buffer = noise;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    s.connect(f); f.connect(env(t, peak, decay));
    s.start(t); s.stop(t + decay + 0.02);
  }
  function stab(t) {
    for (const hz of [466, 587, 698]) {
      const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.value = hz;
      const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1800;
      o.connect(f); f.connect(env(t, 0.09, 0.2));
      o.start(t); o.stop(t + 0.22);
    }
  }
  function schedule() {
    if (!ac || level <= 0.001) { if (ac) nextT = ac.currentTime + 0.05; return; }
    while (nextT < ac.currentTime + 0.16) {
      if (KICK[step]) kick(nextT);
      if (CLAP[step]) burst(nextT, "bandpass", 1500, 0.5, 0.12);
      burst(nextT, "highpass", 7500, step % 2 ? 0.05 : 0.09, 0.035);
      if (STAB[step]) stab(nextT);
      nextT += STEP;
      step = (step + 1) % 16;
    }
  }
  return {
    set level(v) {
      level = v;
      if (v > 0.001 && !init()) return;
      if (!ac) return;
      if (ac.state === "suspended") ac.resume().catch(() => {});
      out.gain.setTargetAtTime(v * 0.55, ac.currentTime, 0.25);
    },
    get level() { return level; },
    stop() { if (timer) clearInterval(timer); if (ac) ac.close(); ac = null; },
  };
}

/**
 * @param {object} ctx  scene, state, playerPos, cine, getPlayer(), setPlayerPos(x, z),
 *   flashObjective, syncHUD(), poolLight(color, power, range, x, y, z), addBlocker(x, z, r),
 *   bark(type, label, female), music (the soundtrack <audio>, ducked inside)
 */
export function createNightlife(ctx) {
  const { scene, state, playerPos } = ctx;
  const flash = (t) => ctx.flashObjective(t);
  const clubs = [];
  const props = [];
  const bills = [];              // tip money and hearts, falling
  const beat = createBounceBeat();
  let busy = false, prompt = null, inside = null, barkCd = 0, t = 0, musicVol = null;

  const css = document.createElement("style");
  css.textContent = `#clubPrompt { position: fixed; left: 50%; bottom: 132px; transform: translateX(-50%); z-index: 22;
      background: rgba(20,6,22,.86); color: #fbe9f6; font: 600 15px/1.35 system-ui, sans-serif; padding: 8px 16px;
      border-radius: 8px; border: 1px solid #ff4fb3; pointer-events: none; }
    #clubPrompt b { color: #ff9ad5; }
    body.letterbox #clubPrompt { display: none; }`;
  document.head.appendChild(css);
  const promptEl = document.createElement("div");
  promptEl.id = "clubPrompt";
  promptEl.hidden = true;
  document.body.appendChild(promptEl);

  const floorTex = floorTexture();

  // ---------------------------------------------------------------- a club
  function build(def, cx, cz, rot) {
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.rotation.y = rot;
    scene.add(g);
    props.push(g);
    const c = { def, g, cx, cz, rot, walls: [], crowd: [], dancers: [] };
    const toWorld = (lx, lz) => new THREE.Vector3(lx, 0, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot).add(new THREE.Vector3(cx, 0, cz));
    const yawOf = (localYaw) => localYaw + rot;
    c.toWorld = toWorld; c.yawOf = yawOf;

    const glow = def.glow;
    const wallMat = std("club wall paint", 0x1c1224);
    const trimMat = basic(new THREE.Color(glow).multiplyScalar(1.6));
    // walls hinge at the floor, so cutting them down is a y-scale
    const wall = (w, d, x, z) => {
      const geo = new THREE.BoxGeometry(w, H, d);
      geo.translate(0, H / 2, 0);
      const m = new THREE.Mesh(geo, wallMat);
      m.position.set(x, 0, z); m.castShadow = true; m.receiveShadow = true;
      g.add(m); c.walls.push(m);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.1, d + 0.02), trimMat);
      strip.position.set(x, H - 0.3, z);
      g.add(strip); c.walls.push(strip);
      strip.userData.fixedY = H - 0.3;
      return m;
    };
    const DOOR = 2.6;
    wall(W, T, 0, -D / 2);
    wall(T, D, -W / 2, 0);
    wall(T, D, W / 2, 0);
    const side = (W - DOOR) / 2;
    wall(side, T, -(DOOR / 2 + side / 2), D / 2);
    wall(side, T, DOOR / 2 + side / 2, D / 2);
    // the header over the door, and the roof — both lift off while you're inside
    c.roof = new THREE.Group();
    const header = new THREE.Mesh(new THREE.BoxGeometry(DOOR, 1.1, T), wallMat);
    header.position.set(0, H - 0.55, D / 2);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 0.5, 0.3, D + 0.5), std("club roof", 0x241a2c));
    roof.position.set(0, H + 0.15, 0); roof.castShadow = true;
    c.roof.add(header, roof);
    g.add(c.roof);

    // the sign over the door, and the floor
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(W - 1, 2.2),
      new THREE.MeshStandardMaterial({ map: signTexture(def.name, def.ink), emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0, name: "club neon sign" }));
    sign.material.emissiveMap = sign.material.map; sign.material.emissiveIntensity = 1.1;
    sign.material.userData.gtbRealized = true;
    sign.position.set(0, H + 1.45, D / 2 + 0.2);
    g.add(sign);
    c.sign = sign;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W - T, D - T), std("club floor", 0x120a18, { roughness: 0.35 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.03; floor.receiveShadow = true;
    g.add(floor);
    const dance = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 4.2),
      new THREE.MeshBasicMaterial({ map: floorTex, color: 0x888888 }));
    dance.material.userData.gtbRealized = true;
    dance.rotation.x = -Math.PI / 2; dance.position.set(1.2, 0.04, 0.4);
    g.add(dance);
    c.dance = dance;

    // the stage along the back wall: a pole (clubs) or two go-go boxes (bars)
    const stage = new THREE.Mesh(new THREE.BoxGeometry(6, 0.6, 2.7), std("stage lacquer", 0x2a0f2c, { roughness: 0.25 }));
    stage.position.set(-2, 0.3, -4.5); stage.castShadow = true; stage.receiveShadow = true;
    g.add(stage);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(6.05, 0.08, 0.08), trimMat);
    edge.position.set(-2, 0.62, -3.12);
    g.add(edge);
    const chrome = new THREE.MeshStandardMaterial({ name: "chrome pole", color: 0xe8e8ee, metalness: 1, roughness: 0.12 });
    chrome.userData.gtbRealized = true;
    if (def.pole) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, H - 0.6, 10), chrome);
      pole.position.set(-2, 0.6 + (H - 0.6) / 2, -4.4);
      g.add(pole);
    } else {
      for (const bx of [-3.6, -0.4]) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 1.1), std("go-go box", 0x111111, { emissive: glow, emissiveIntensity: 0.5 }));
        box.position.set(bx, 0.85, -4.6);
        g.add(box);
      }
    }
    // the bar down the right wall, bottles glowing on the shelf behind it
    const counter = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 5.6), std("bar counter wood", 0x3a2418));
    counter.position.set(4.3, 0.55, -0.6); counter.castShadow = true;
    g.add(counter);
    const topM = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, 5.8), trimMat);
    topM.position.set(4.3, 1.13, -0.6);
    g.add(topM);
    const bottleCols = [0x3aff9a, 0xffd23a, 0xff4fb3, 0x3ae0ff, 0xff7a1a];
    for (let i = 0; i < 12; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.34, 6), basic(new THREE.Color(bottleCols[i % 5]).multiplyScalar(1.3)));
      b.position.set(5.6, 1.45 + (i % 2) * 0.55, -3 + (i >> 1) * 0.9);
      g.add(b);
    }
    // the VIP chair in the front-left corner, facing into the room
    const chair = new THREE.Group();
    const velvet = std("velvet chair", 0x8a0f3c, { roughness: 0.9 });
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.45, 0.9), velvet); seat.position.y = 0.225;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.1, 0.9), velvet); back.position.set(-0.45, 0.75, 0);
    chair.add(seat, back);
    chair.position.set(-4.6, 0, 3.6);
    g.add(chair);
    // a disco ball
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), chrome);
    ball.position.set(1.2, H - 0.8, 0.4);
    g.add(ball);
    c.ball = ball;

    // ---- THE RIG: par cans on a bar over the floor, and a laser fan off the
    //      back wall. A club whose light never changes is a lit room, not a
    //      club; these are the two cheapest ways to make it move.
    const beamMat = (color, opacity) => {
      const m = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide,
      });
      m.userData.gtbRealized = true;
      return m;
    };
    const metal = rigMetal();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(9.0, 0.08, 0.08), metal);
    bar.position.set(0, H - 0.45, 0.6);
    g.add(bar);
    const cans = [];
    for (let i = 0; i < 4; i++) {
      const can = new THREE.Group();
      can.position.set(-3.3 + i * 2.2, H - 0.5, 0.6);
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.36, 8), metal);
      shell.position.y = 0.18;
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.13, 10), basic(RIG_COLOURS[i]));
      lens.rotation.x = -Math.PI / 2;
      lens.position.y = 0.0;
      const beam = new THREE.Mesh(new THREE.ConeGeometry(0.7, H - 0.6, 8, 1, true), beamMat(RIG_COLOURS[i], 0.09));
      beam.position.y = -(H - 0.6) / 2;
      can.add(shell, lens, beam);
      g.add(can);
      cans.push({ can, phase: i * 1.3, speed: 0.55 + i * 0.16 });
    }
    c.cans = cans;
    const fan = new THREE.Group();
    fan.position.set(-2, 2.2, -D / 2 + 0.35);
    g.add(fan);
    const projector = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.26, 0.3), metal);
    projector.position.set(0, 0, 0.1);
    fan.add(projector);
    for (let i = 0; i < 5; i++) {
      const arm = new THREE.Group();
      arm.rotation.y = (i - 2) * 0.19;
      const beam = new THREE.Mesh(new THREE.ConeGeometry(0.16, 7.5, 6, 1, true), beamMat(RIG_COLOURS[(i + 1) % RIG_COLOURS.length], 0.14));
      // apex at the lens, fan out across the floor: rolling the cone -90° about
      // x points its +y apex down the arm, so the offset lands the apex on the
      // projector instead of 7.5 m behind it
      beam.rotation.x = -Math.PI / 2;
      beam.position.z = 3.75;
      arm.add(beam);
      fan.add(arm);
    }
    c.fan = fan;

    // collision: the walls (door gap left open), the bar, the stage front
    g.updateMatrixWorld(true);
    const block = (lx, lz, r) => { const p = toWorld(lx, lz); ctx.addBlocker(p.x, p.z, r); };
    for (let s = -W / 2; s <= W / 2 + 0.01; s += 1.2) {
      block(s, -D / 2, 0.5);
      block(-W / 2, s, 0.5);
      block(W / 2, s, 0.5);
      if (Math.abs(s) > DOOR / 2 + 0.3) block(s, D / 2, 0.5);
    }
    // door posts: people fit through, cars don't
    block(-(DOOR / 2 + 0.2), D / 2, 0.35);
    block(DOOR / 2 + 0.2, D / 2, 0.35);
    for (let z = -3.2; z <= 2; z += 1.2) block(4.3, z, 0.6);
    for (let x = -4.6; x <= 0.6; x += 1.3) block(x, -4.1, 0.6);

    // light: one pooled light in the club colour (main.js hands out the real lights)
    const lp = toWorld(0, 0);
    ctx.poolLight(glow, 90, 13, lp.x, H - 0.5, lp.z);
    const door = toWorld(0, D / 2 + 1);
    ctx.poolLight(glow, 40, 9, door.x, 3.2, door.z);

    // the people: three dancers on the stage, and a room full of the people they
    // are working for
    const actors = new THREE.Group();
    g.add(actors);
    c.actorGroup = actors;
    const STAGE_SPOTS = [[-3.8, -4.6], [-2.0, -4.2], [-0.2, -4.6]];
    def.dancers.concat(def.dancers[0]).forEach((sex, i) => {
      // The stage is billed on more than the sheet's own chest, and the women
      // wear the house costume (bikini + gstring + bare legs) rather than a top
      // and shorts: this is the same rig the Crown Strip's poles and the
      // franchise stages use, and the tip rail is priced off it.
      const d = sex === "f"
        ? makeStripper({ sex: "f", seed: Math.round(cx * 31 + cz * 7 + i * 101), height: 1.80, bust: 1.55, stripper: true })
        : makeDancer({ sex: "m", seed: Math.round(cx * 31 + cz * 7 + i * 101), height: 1.80, shirtless: true });
      d.name = sex === "f" ? ["Mercedes", "Jazmine", "Porsha", "Angel"][(clubs.length + i) % 4] : ["Dante", "Rico", "Marquis", "Beau"][(clubs.length + i) % 4];
      c.dancers.push({ a: d, home: STAGE_SPOTS[i % STAGE_SPOTS.length], y: 0.6, hp: 4, dead: false });
    });
    for (let i = 0; i < PATRONS; i++) {
      const type = def.crowd[i % def.crowd.length];
      const rng = mulberry(Math.round(cx * 13 + cz * 17 + i * 7));
      const a = type === "gayman" ? randomGayMan(rng, 1.86) : type === "lesbian" ? randomLesbian(rng, 1.78)
        : type === "hoodratF" ? makeHoodrat({ sex: "f", crew: rng() < 0.5 ? "red" : "blue", seed: (rng() * 1e9) | 0, height: 1.78 })
        : randomHoodrat(rng, 1.88);
      const spot = PATRON_SPOTS[i % PATRON_SPOTS.length];
      c.crowd.push({ a, type: type === "hoodratF" ? "hoodrat" : type, home: spot, atBar: BAR_SPOTS.has(i % PATRON_SPOTS.length), hp: 4, dead: false });
    }
    const bartender = randomHoodrat(mulberry(Math.round(cx + cz)), 1.84);
    c.crowd.push({ a: bartender, type: "hoodrat", home: [5.3, -0.6], still: true, hp: 4, dead: false });
    for (const d of c.dancers) actors.add(d.a);
    for (const p of c.crowd) actors.add(p.a);
    home(c);

    // the two spots you can use, in club-local coordinates
    c.rail = { lx: -2, lz: -2.4 };
    c.vip = { lx: -3.4, lz: 3.2 };
    for (const spot of [c.rail, c.vip]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.8, 32), basic(glow, { transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(spot.lx, 0.06, spot.lz);
      g.add(ring);
      spot.ring = ring;
    }
    clubs.push(c);
    return c;
  }

  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let q = Math.imul(a ^ (a >>> 15), 1 | a);
      q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
      return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
    };
  }

  // put an actor somewhere in a club's local space, facing a local yaw
  function place(c, a, lx, y, lz, localYaw) {
    a.position.set(lx, y, lz);            // actors live in the club group
    a.baseY = y;
    if (a._last) a._last.copy(a.position);
    a._yaw = localYaw;
    a.rotation.y = localYaw;
  }
  function home(c) {
    c.dancers.forEach((d, i) => { place(c, d.a, d.home[0], d.y, d.home[1], i ? 0.2 : -0.2); d.a.play(i ? "dance" : "twerk", { force: true }); if (i === 0) d.a._yaw = Math.PI; });
    c.dancers[0].a.rotation.y = Math.PI;       // the lead twerks to the room: back to the crowd
    c.crowd.forEach((p) => {
      // at the bar they face the counter and stay; the rest face the room and
      // dance, changing clip on a slow bar of their own so the floor is not one
      // person repeating one move in front of an empty stage
      const yaw = p.atBar ? -Math.PI / 2 : Math.PI + (p.home[0] - 0) * 0.12;
      place(c, p.a, p.home[0], 0, p.home[1], yaw);
      p.a.play(p.atBar ? "idle" : ["dance", "dance", "twerk", "grind"][(((Math.floor(p.home[1] * 2 + 4) % 4) + 4) % 4)], { force: true });
    });
  }

  // ---------------------------------------------------------------- on the block
  /** Build the four clubs on a city block ({x0, x1, z0, z1}); two face each street. */
  function buildBlock(b) {
    const xs = [b.x0 + W / 2 + 0.3, b.x1 - W / 2 - 0.3];
    CLUBS.forEach((def, i) => {
      const north = i < 2;
      build(def, xs[i % 2], north ? b.z0 + D / 2 + 0.4 : b.z1 - D / 2 - 0.4, north ? Math.PI : 0);
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(b.x1 - b.x0, b.z1 - b.z0), std("sidewalk slab", 0x3a3638, { roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set((b.x0 + b.x1) / 2, 0.013, (b.z0 + b.z1) / 2);
    floor.receiveShadow = true;
    scene.add(floor);
  }

  // ---------------------------------------------------------------- money and hearts
  const billGeo = new THREE.PlaneGeometry(0.16, 0.07);
  const billMat = basic(0x7fd88a, { side: THREE.DoubleSide });
  const heartMat = basic(0xff4fb3, { side: THREE.DoubleSide });
  function shower(at, n, heart = false) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(heart ? new THREE.CircleGeometry(0.06, 8) : billGeo, heart ? heartMat : billMat);
      m.position.set(at.x + (Math.random() - 0.5) * 1.2, at.y + Math.random() * 0.8, at.z + (Math.random() - 0.5) * 1.2);
      m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      scene.add(m);
      bills.push({ m, vy: heart ? 0.7 : -0.2, spin: (Math.random() - 0.5) * 8, life: 2.2 });
    }
  }

  // ---------------------------------------------------------------- the two jobs
  function pay(price, what) {
    if (state.cash >= price) return true;
    flash(`${what}: $${price}. You've got $${state.cash}. No money, no honey.`);
    return false;
  }

  async function tipRail(c) {
    if (c.dancers[0].dead) { flash(`${c.dancers[0].a.name || "She"}'s not going to be dancing for anybody.`); return; }
    if (!pay(PRICES.tip, "Make it rain")) return;
    busy = true;
    state.cinematic = true;
    const d = c.dancers[0];
    const eye = c.toWorld(c.rail.lx + 2.6, c.rail.lz + 3.2);
    const stageW = c.toWorld(-2, -3.6);
    await ctx.cine.scene(async (k) => {
      // the lead comes down front and turns her back to you
      place(c, d.a, -2, d.y, -3.5, Math.PI);
      d.a.play("twerk", { force: true });
      k.shot({ from: [eye.x, 2.6, eye.z], look: [stageW.x, 1.3, stageW.z], dur: 5 });
      shower(new THREE.Vector3(stageW.x, 2.2, stageW.z), 18);
      await k.caption("You make it rain. Dollar bills everywhere.", 2);
      await k.caption(`${d.a.name} drops it low — NOLA bounce, just for you.`, 2.4);
    });
    home(c);
    state.cash -= PRICES.tip;
    state.hp = Math.min(100, state.hp + HEAL.tip);
    ctx.syncHUD();
    state.cinematic = false;
    busy = false;
    prompt = null;
    flash(`Tipped ${d.a.name}. That bounce did something for you. +${HEAL.tip} HP, -$${PRICES.tip}`);
  }

  async function lapDance(c) {
    if (c.dancers[0].dead) { flash(`${c.dancers[0].a.name || "She"}'s not going to be dancing for anybody.`); return; }
    if (!pay(PRICES.lapDance, "A lap dance")) return;
    const P = ctx.getPlayer();
    if (!P) return;
    busy = true;
    state.cinematic = true;
    const d = c.dancers[0];
    // the chair at local (-4.6, 3.6) faces +x (into the room)
    const seatW = c.toWorld(-4.45, 3.6);
    const cam1 = c.toWorld(-1.6, 6.2), cam2 = c.toWorld(-2.2, 1.2);
    const mid = c.toWorld(-3.9, 3.6);
    const seatYaw = c.yawOf(Math.PI / 2);          // facing local +x
    await ctx.cine.scene(async (k) => {
      k.letterbox(true);
      await k.black(true, 0.35);
      ctx.setPlayerPos(seatW.x, seatW.z);
      P._yaw = seatYaw; P.rotation.y = seatYaw;
      P.play("sit", { force: true });
      // her back to you for the bounce (local +x = away from the chair)
      place(c, d.a, -3.55, 0, 3.6, Math.PI / 2);
      d.a.play("twerk", { force: true });
      k.shot({ from: [cam1.x, 2.2, cam1.z], look: [mid.x, 0.9, mid.z], dur: 6 });
      await k.black(false, 0.35);
      shower(new THREE.Vector3(mid.x, 2.4, mid.z), 10);
      await k.caption(`${d.a.name} puts the bounce on — all the way down.`, 2.6);
      await k.wait(1.2);
      // turn around, and grind
      d.a._yaw = -Math.PI / 2; d.a.rotation.y = -Math.PI / 2;
      place(c, d.a, -3.75, 0, 3.6, -Math.PI / 2);
      d.a.play("grind", { force: true });
      k.shot({ from: [cam2.x, 1.7, cam2.z], look: [mid.x, 1.0, mid.z], dur: 5 });
      await k.caption("A slow grind. The room disappears.", 2.4);
      await k.wait(0.8);
      d.a.play("kiss", { force: true });
      shower(new THREE.Vector3(mid.x, 1.6, mid.z), 12, true);
      await k.caption(`A kiss to finish. "Come back and see me, baby."`, 2.4);
      await k.black(true, 0.3);
      home(c);
      const out = c.toWorld(c.vip.lx + 0.6, c.vip.lz - 0.4);
      ctx.setPlayerPos(out.x, out.z);
      P.play("idle", { force: true });
      await k.black(false, 0.3);
      k.letterbox(false);
    });
    state.cash -= PRICES.lapDance;
    state.hp = Math.min(100, state.hp + HEAL.lapDance);
    ctx.syncHUD();
    state.cinematic = false;
    busy = false;
    prompt = null;
    flash(`Lap dance from ${d.a.name} at ${c.def.name}. You feel brand new. +${HEAL.lapDance} HP, -$${PRICES.lapDance}`);
  }

  // ---------------------------------------------------------------- per frame
  const _l = new THREE.Vector3();
  function local(c, p) {
    _l.set(p.x - c.cx, 0, p.z - c.cz).applyAxisAngle(new THREE.Vector3(0, 1, 0), -c.rot);
    return _l;
  }

  function update(dt) {
    t += dt;
    barkCd = Math.max(0, barkCd - dt);
    const P = ctx.getPlayer();
    let nearest = Infinity;
    inside = null;
    for (const c of clubs) {
      const d = Math.hypot(playerPos.x - c.cx, playerPos.z - c.cz);
      nearest = Math.min(nearest, d);
      const near = d < 70;
      c.actorGroup.visible = near;
      const l = local(c, playerPos);
      const isIn = !state.veh && Math.abs(l.x) < W / 2 - 0.1 && Math.abs(l.z) < D / 2 - 0.1;
      if (isIn) inside = c;
      // the cutaway: roof off while you're inside (but leave walls full height to enclose the room)
      c.roof.visible = !isIn;
      c.sign.visible = !isIn;               // it hangs over the door, right between the camera and the stage
      for (const w of c.walls) {
        if (w.userData.fixedY != null) w.visible = !isIn;
        else w.scale.y = 1;
      }
      if (!near) continue;
      c.ball.rotation.y += dt * 0.8;
      c.dance.material.color.setHSL((t * 0.15 + c.cx * 0.01) % 1, 0.6, 0.55);
      // the rig, on the same clock as the beat: the cans sweep, the fan turns
      for (const { can, phase, speed } of c.cans) {
        can.rotation.z = Math.sin(t * speed + phase) * 0.7;
        can.rotation.x = 0.25 + Math.cos(t * speed * 0.7 + phase) * 0.25;
      }
      c.fan.rotation.y = t * 0.5;
      for (const x of c.dancers) x.a.update(dt);
      for (const x of c.crowd) {
        x.a.update(dt);
        // the ones who are not at the bar shift their weight and look around,
        // so a dozen people are not twelve statues on the same frame
        if (!x.atBar && x.a.torso) x.a.torso.rotation.y = Math.sin(t * 0.5 + x.home[0]) * 0.4;
      }
      for (const s of [c.rail, c.vip]) s.ring.material.opacity = 0.55 + Math.sin(t * 4) * 0.25;
      c.sign.material.emissiveIntensity = 1.1 + (Math.sin(t * 11 + c.cx) > 0.96 ? -0.7 : 0);
    }
    // somebody always walks into the regulars
    if (inside && !busy && !state.cinematic && barkCd === 0) {
      for (const p of inside.crowd) {
        const w = p.a.getWorldPosition(new THREE.Vector3());
        if (Math.hypot(w.x - playerPos.x, w.z - playerPos.z) < 1.1) {
          ctx.bark(p.type, LABELS[p.type] || "Regular", !!p.a.female);
          barkCd = 2.4;
          break;
        }
      }
    }
    // the beat: full inside, fading down the street; the soundtrack ducks under it
    const muted = ctx.music && ctx.music.muted;
    const lvl = muted ? 0 : inside ? 1 : Math.max(0, 1 - (nearest - 8) / 45) * 0.35;
    beat.level = lvl;
    if (ctx.music) {
      if (lvl > 0.5 && musicVol == null) { musicVol = ctx.music.volume; ctx.music.volume = Math.min(musicVol, 0.1); }
      else if (lvl <= 0.5 && musicVol != null) { ctx.music.volume = musicVol; musicVol = null; }
    }
    // money and hearts
    for (let i = bills.length - 1; i >= 0; i--) {
      const b = bills[i];
      b.life -= dt;
      b.vy -= dt * (b.m.material === heartMat ? 0.2 : 1.6);
      b.m.position.y += b.vy * dt;
      b.m.rotation.x += b.spin * dt; b.m.rotation.y += b.spin * 0.6 * dt;
      if (b.life <= 0 || b.m.position.y < 0.05) { scene.remove(b.m); if (b.m.geometry !== billGeo) b.m.geometry.dispose(); bills.splice(i, 1); }
    }
    // during a job, the player and the dancer are driven here (the sim is paused)
    if (busy && P) P.update(dt, ctx.camera);

    // the prompt: standing on a ring
    if (busy || state.cinematic || !inside) { prompt = null; promptEl.hidden = true; return; }
    const l = local(inside, playerPos);
    prompt = null;
    if (inside.dancers[0].dead) { promptEl.hidden = true; return; }   // no rail tip, no VIP dance — she's down
    if (Math.hypot(l.x - inside.rail.lx, l.z - inside.rail.lz) < 0.9) {
      // E, not F: nightlife.interact() runs on the `interact` press = KeyE.
      prompt = { c: inside, job: "tip", text: `<b>E</b> · Make it rain on ${inside.dancers[0].a.name}: $${PRICES.tip} (+${HEAL.tip} HP)` };
    } else if (Math.hypot(l.x - inside.vip.lx, l.z - inside.vip.lz) < 0.9) {
      prompt = { c: inside, job: "lap", text: `<b>E</b> · VIP lap dance with ${inside.dancers[0].a.name}: $${PRICES.lapDance} (+${HEAL.lapDance} HP)` };
    }
    if (prompt) { promptEl.innerHTML = prompt.text; promptEl.hidden = false; }
    else promptEl.hidden = true;
  }

  /** F pressed: true if a club job took it. */
  function interact() {
    if (busy || !prompt || state.veh) return false;
    if (prompt.job === "tip") tipRail(prompt.c);
    else lapDance(prompt.c);
    return true;
  }

  return {
    buildBlock,
    update,
    interact,
    get props() { return props; },
    get busy() { return busy; },
    /** The club the player is standing in, or null. */
    get inside() { return inside ? { name: inside.def.name, kind: inside.def.kind } : null; },
    get clubs() { return clubs.map((c) => ({ name: c.def.name, kind: c.def.kind, x: c.cx, z: c.cz, door: c.toWorld(0, D / 2 + 1.5) })); },
    /** Radar blips: one per club door. */
    blips() { return clubs.map((c) => { const p = c.toWorld(0, D / 2 + 1.5); return { kind: "club", x: p.x, z: p.z }; }); },
    /** Where people hang out on the street outside (main.js adds them to NPC_POIS). */
    get pois() { return clubs.map((c) => { const p = c.toWorld(0, D / 2 + 4); return { x: p.x, z: p.z, r: 4 }; }); },
    /**
     * Every dancer/crowd/bartender worth shooting at, in world space, in a
     * club near enough to be ticking (`c.actorGroup.visible`) — same shape as
     * crownstrip.js's `hittable()`, so main.js's fire() handles both with
     * one loop. `rec` is the live club record: mutate its `hp`/`dead` and the
     * per-frame `update()` above keeps animating it, same as everyone else.
     */
    hittable(playerPos, maxDist = 45) {
      const out = [];
      for (const c of clubs) {
        if (!c.actorGroup.visible) continue;
        for (const rec of [...c.dancers, ...c.crowd]) {
          if (rec.dead) continue;
          const p = rec.a.getWorldPosition(new THREE.Vector3());
          const dx = p.x - playerPos.x, dz = p.z - playerPos.z;
          if (dx * dx + dz * dz > maxDist * maxDist) continue;
          out.push({ x: p.x, y: p.y, z: p.z, rec });
        }
      }
      return out;
    },
    /**
     * The cast, for dialogue.js. These four clubs predate the dialogue system
     * and are the one place in the game that is *about* being talked to, so a
     * player who walked up to a dancer got nothing. main.js's peopleNearby()
     * flattens this into the same shape as its other three sources, which is
     * the only thing that keeps dialogue.js from having to know a club is a
     * club.
     *
     * Cheaper than `hittable()` in the one way that matters here: this runs
     * EVERY frame, because the E prompt is polled rather than event-driven,
     * where hittable() only runs when the player pulls a trigger. So it culls
     * on the club box before reaching into a room.
     *
     * `age` is not invented: `characters.js` stamps every rig with
     * `userData.age` (25 unless a caller says otherwise) and dialogue.js gates
     * its adult branch on `>= 25`, so the answer comes off the rig. That is the
     * same check franchiseClubs.js makes, and the same reason it exists.
     */
    castNear(px, pz, r = 6) {
      const out = [], r2 = r * r;
      for (const c of clubs) {
        if (!c.actorGroup.visible) continue;            // a culled room has nobody in it
        // a rotated box; its circumscribed circle is the cheap version and errs
        // towards offering a person just outside the wall rather than hiding
        // one who is standing in the doorway
        const rr = r + Math.hypot(D, W) / 2;
        if ((c.cx - px) ** 2 + (c.cz - pz) ** 2 > rr * rr) continue;
        const push = (rec, role, name) => {
          if (rec.dead) return;
          const p = rec.a.getWorldPosition(_castV);
          const dx = p.x - px, dz = p.z - pz;
          if (dx * dx + dz * dz > r2) return;
          out.push({
            role, name, x: p.x, z: p.z, venue: c.def.name,
            // a stable identity per person, not per frame: the same dancer is
            // the same dancer all night, so her greeting line and her rumours do
            // not reroll every time the player shifts their weight
            seed: `${c.def.name}:${role}:${Math.round(rec.home[0])},${Math.round(rec.home[1])}`,
            adult: !!rec.a.userData && rec.a.userData.age >= 25,
          });
        };
        for (const d of c.dancers) push(d, "performer", d.a.name || null);
        for (const g of c.crowd) push(g, g.still ? "barkeep" : "guest", null);
      }
      return out;
    },
    /**
     * The club whose tip rail or VIP corner the player is standing on — the one
     * place in these four rooms where E is NOT dialogue's. The ring is 0.9 m and
     * the dialogue prompt reaches 2.6 m, so without this the conversation
     * swallows the key press that pays for the lap dance. Step a metre back off
     * the ring and she is an ordinary talkant again.
     */
    get eOwner() { return prompt ? prompt.c.def.name : null; },

    /** QA: the jobs and a spot, directly. */
    debug: { tipRail: (i = 0) => tipRail(clubs[i]), lapDance: (i = 0) => lapDance(clubs[i]),
      spot(i = 0, which = "vip") { const c = clubs[i]; const s = which === "vip" ? c.vip : c.rail; return c.toWorld(s.lx, s.lz); } },
  };
}
const _castV = new THREE.Vector3();
