// ---------------------------------------------------------------------------
// characters.js — the HOODRATS.
//
// Two crews, red and blue, built to the GTA San Andreas-style reference sheets:
//   men    paisley crew bandana (over the crown for red, a brow band over
//          cornrows for blue), goatee, white tank, leather belt, the crew
//          bandana hanging long from a front pocket, baggy stacked jeans, arm
//          tattoos; all-white low-tops (red) or white-and-navy high-tops (blue)
//   women  paisley headband, long hair (straight for red, spiral curls for
//          blue), gold hoops and a cross on a gold chain, white cropped tank,
//          bright crew leggings, colour-blocked crew high-tops
// Story characters pass their own palette object (opts.crew = {...}) and keep
// the classic look, so the cast doesn't change with the crew sheets.
//
// The same rig also dresses Rednecks (`randomRedneck`): flannel (`opts.plaid`),
// a trucker cap (`headwear: "cap"`) and work boots (`opts.shoe = "boots"`)
// instead of the crew's paisley / high-tops. It's one body builder shared by
// both factions plus the police (`makeDeputy`) and every named story
// character — only the palette and props change.
//
// Built procedurally rather than loaded: the packs have no character that looks
// anything like this, and code lets one builder cover both sexes, both crews
// and per-spawn variation (skin tone, build, hair) from a seed.
//
// A Hoodrat is a drop-in replacement for an `AnimatedSprite` in the enemy
// system — same `play` / `update` / `setFlip` / `finished` / `material.opacity`
// surface — so `updateEnemy()` drives it without knowing it is 3D.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { roundedBox } from "./geo.js";
import { microSurface } from "./graphics.js";
import { mergeRigid } from "./merge.js";

// --------------------------------------------------------------- palette
export const CREWS = {
  red:  { name: "Red",  cloth: 0xb3242c, accent: 0xd2434b, chain: 0xd4af37, shoe: 0xc0282e, legging: 0xc4292d,
          belt: 0x4a2c1c, maleShoe: "low", headStyle: "wrap", pocket: -1 },
  blue: { name: "Blue", cloth: 0x223f94, accent: 0x3a63c6, chain: 0xd4af37, shoe: 0x223f94, legging: 0x2946b8,
          belt: 0x141414, maleShoe: "high", headStyle: "cornrows", pocket: 1 },
};
export const CREW_NAMES = Object.keys(CREWS);

const SKIN_TONES = [0x7a4f35, 0x633d28, 0x8b6044, 0x512f1f, 0x946c4c, 0x452718];
const DENIM = [0x5d7ea6, 0x53718f, 0x6b8cb2, 0x47607d];

// --------------------------------------------------------------- shared assets
// Geometry is shared across every Hoodrat in the level — only the transforms
// differ. Materials are shared too, and only cloned for one individual when it
// starts to fade out on death.
const geoCache = new Map();
function geo(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}
// Every box in the cast is CHAMFERED, not raw BoxGeometry. A hard 90° edge on
// every limb, jaw and shoe is most of what made the people read as blockout
// primitives rather than people: the highlight that runs along an edge is what
// tells the eye a surface is curved. geo.js's roundedBox is cached and shared,
// so this costs geometry variety, not draw calls, and it is safe here because
// nothing in characters.js hand-computes UVs (bodies are flat colour plus
// realize()'s micro-detail normal, which is break-up noise, not a pattern).
const box = (w, h, d) => geo(`r${w}|${h}|${d}`, () => roundedBox(w, h, d));
const cyl = (rt, rb, h, seg = 10) =>
  geo(`c${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const sph = (r, w = 12, h = 10) => geo(`s${r}|${w}|${h}`, () => new THREE.SphereGeometry(r, w, h));
const cone = (r, h, seg = 12) => geo(`n${r}|${h}|${seg}`, () => new THREE.ConeGeometry(r, h, seg));
/** The top of a sphere, down to polar angle `theta` (a skull cap with a level rim). */
const capGeo = (r, theta) => geo(`cap${r}|${theta}`, () => new THREE.SphereGeometry(r, 14, 10, 0, Math.PI * 2, 0, theta));
const torus = (r, t, seg = 10, rings = 16) =>
  geo(`t${r}|${t}|${seg}|${rings}`, () => new THREE.TorusGeometry(r, t, seg, rings));

// Limb segments. These were 8 (arms) and 10 (legs), which is an octagon and a
// decagon: at conversation distance the facet edges are plainly visible and
// the arm reads as a faceted tube. 12 is the first number where the silhouette
// is round enough not to be noticed, and the rig merges to a handful of draw
// calls per character either way, so the extra triangles are the cheap part.
const ARM_SEG = 12;
const LEG_SEG = 12;

/**
 * A hand: palm, four fingers, a thumb. It used to be one sphere — a fist with
 * no fingers and no thumb, which is the single most conspicuous thing about the
 * hands from any distance, since they hang at the end of every arm.
 *
 * Built at the wrist socket and curling forward, because the character faces +z
 * and a hand that hangs straight down with no fingers reads as a mitten from
 * behind. Finger segments are 6-sided cylinders rather than 8: at 0.09 m across
 * they are the smallest thing on the model, so the silhouette is all that
 * survives anyway, and there are eight of them per character.
 *
 * @param {THREE.Object3D} wrist  the wrist joint — also the weapon socket, so
 *   this is where a grip is and the geometry is laid out around the origin
 * @param {THREE.Material} m       skin, or the glove
 * @param {number} bulk
 * @param {boolean} isGlove        a glove is bulkier and gets a cuff
 */
function buildHand(wrist, m, bulk, isGlove) {
  const y = 0;                                      // the socket, and where a grip is
  const w = 0.072 * bulk * (isGlove ? 1.16 : 1);
  // palm: a chamfered slab, slightly longer than it is wide
  add(wrist, box(w, 0.085 * bulk, 0.036 * bulk), m, 0, y + 0.035, 0.004);
  // four fingers, curled forward off the front of the palm. The middle two are
  // the long ones and the outer two shorter, which is the detail that stops a
  // hand reading as a rake.
  const lens = [0.052, 0.062, 0.06, 0.048];
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * (w / 4.4);
    const f = add(wrist, cyl(0.0085 * bulk, 0.0072 * bulk, lens[i] * bulk, 6), m, x, y - lens[i] * bulk * 0.42, 0.012);
    f.rotation.x = 0.55;                            // curled toward the palm
  }
  // the thumb, off to one side and angled across
  const th = add(wrist, cyl(0.0095 * bulk, 0.008 * bulk, 0.05 * bulk, 6), m, -w * 0.62, y + 0.012, 0.014);
  th.rotation.z = -0.7;
  th.rotation.x = 0.3;
  if (isGlove) add(wrist, cyl(0.05, 0.05, 0.05, 10), m, 0, y + 0.085, 0.004);   // the cuff
}

// Surface presets. Everything is tagged `gtbRealized` so the scene-wide PBR
// pass leaves it alone — these are already authored as the surface we want.
const SURFACES = {
  skin:    { roughness: 0.58, metalness: 0, env: 0.75, micro: 26, nScale: 0.35 },
  hair:    { roughness: 0.42, metalness: 0, env: 0.9,  micro: 30, nScale: 0.8 },
  cloth:   { roughness: 0.94, metalness: 0, env: 0.55, micro: 22, nScale: 1.1 },
  denim:   { roughness: 0.9,  metalness: 0, env: 0.5,  micro: 18, nScale: 1.3 },
  lycra:   { roughness: 0.46, metalness: 0, env: 1.0,  micro: 20, nScale: 0.5 },
  leather: { roughness: 0.48, metalness: 0, env: 1.1,  micro: 16, nScale: 0.6 },
  rubber:  { roughness: 0.95, metalness: 0, env: 0.45, micro: 24, nScale: 1.0 },
  metal:   { roughness: 0.24, metalness: 0.95, env: 2.0, micro: 8, nScale: 0.3 },
  plastic: { roughness: 0.34, metalness: 0, env: 1.0, micro: 12, nScale: 0.1 },      // hard hats
  glass:   { roughness: 0.08, metalness: 0, env: 1.8, micro: 12, nScale: 0.05 },     // sunglasses
};

const matCache = new Map();
function mat(kind, color) {
  const key = `${kind}:${color}`;
  if (matCache.has(key)) return matCache.get(key);
  const p = SURFACES[kind] || SURFACES.cloth;
  const m = new THREE.MeshStandardMaterial({
    color, roughness: p.roughness, metalness: p.metalness, envMapIntensity: p.env,
  });
  m.name = kind;                       // readable in the material audit
  const micro = microSurface(p.micro);
  if (micro) {
    m.normalMap = micro.normal;
    m.normalScale = new THREE.Vector2(p.nScale, p.nScale);
    m.roughnessMap = micro.orm;        // multiplies — break-up only
    m.aoMap = micro.orm;
    m.aoMapIntensity = 0.3;
  }
  m.userData.gtbRealized = true;
  matCache.set(key, m);
  return m;
}

// Paisley bandana print, per crew colour: white teardrops with a dot, rings of
// small dots, thin black outlines. Tiled twice across each bandana part.
const printCache = new Map();
function paisleyMat(color) {
  if (printCache.has(color)) return printCache.get(color);
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  const base = "#" + new THREE.Color(color).getHexString();
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  const drop = (x, y, s, rot) => {
    g.save();
    g.translate(x, y); g.rotate(rot); g.scale(s, s);
    g.beginPath();
    g.moveTo(0, -18);
    g.bezierCurveTo(17, -15, 18, 9, 0, 18);
    g.bezierCurveTo(-13, 14, -11, -2, 4, -6);
    g.bezierCurveTo(8, -9, 4, -16, 0, -18);
    g.closePath();
    g.fillStyle = "#f4efe6"; g.fill();
    g.lineWidth = 2; g.strokeStyle = "#101010"; g.stroke();
    g.beginPath(); g.arc(3, 7, 5, 0, Math.PI * 2); g.fillStyle = base; g.fill();
    g.restore();
  };
  const dots = (x, y, r) => {
    g.fillStyle = "#f4efe6";
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      g.beginPath(); g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, 2.2, 0, Math.PI * 2); g.fill();
    }
  };
  for (const [x, y, s, r] of [[44, 48, 1.3, 0.4], [178, 70, 1.1, -0.9], [108, 160, 1.4, 2.2], [226, 196, 1.0, 1.1], [30, 214, 1.0, -2.4]]) drop(x, y, s, r);
  for (const [x, y, r] of [[120, 50, 14], [60, 130, 11], [200, 130, 12], [150, 232, 10]]) dots(x, y, r);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  const m = new THREE.MeshStandardMaterial({ name: "cloth", map: t, roughness: 0.92, envMapIntensity: 0.55 });
  m.userData.gtbRealized = true;
  printCache.set(color, m);
  return m;
}

// Pride stripes: the rainbow do-rags, headbands and tops on Frenchmen Street
// (randomGayMan / randomLesbian / makeDancer). One shared material.
let rainbowCache = null;
function rainbowMat() {
  if (rainbowCache) return rainbowCache;
  const c = document.createElement("canvas");
  c.width = 16; c.height = 96;
  const g = c.getContext("2d");
  ["#e40303", "#ff8c00", "#ffed00", "#008026", "#004dff", "#750787"].forEach((col, i) => { g.fillStyle = col; g.fillRect(0, i * 16, 16, 16); });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 1.5);
  rainbowCache = new THREE.MeshStandardMaterial({ name: "cloth", map: t, roughness: 0.85, envMapIntensity: 0.6 });
  rainbowCache.userData.gtbRealized = true;
  return rainbowCache;
}

// Flannel/plaid print for redneck-styled shirts: a crosshatch of two accent
// lines over a base colour, the same tiling trick as the paisley bandana.
const plaidCache = new Map();
function plaidMat(base, line) {
  const key = `${base}:${line}`;
  if (plaidCache.has(key)) return plaidCache.get(key);
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  g.fillStyle = "#" + new THREE.Color(base).getHexString();
  g.fillRect(0, 0, S, S);
  g.strokeStyle = "#" + new THREE.Color(line).getHexString();
  g.globalAlpha = 0.85;
  for (const w of [10, 3]) {
    g.lineWidth = w;
    for (const off of [0, 64]) {
      g.beginPath(); g.moveTo(0, off); g.lineTo(S, off); g.stroke();
      g.beginPath(); g.moveTo(off, 0); g.lineTo(off, S); g.stroke();
    }
  }
  g.globalAlpha = 0.35;
  g.lineWidth = 1;
  for (const off of [32, 96]) {
    g.beginPath(); g.moveTo(0, off); g.lineTo(S, off); g.stroke();
    g.beginPath(); g.moveTo(off, 0); g.lineTo(off, S); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  const m = new THREE.MeshStandardMaterial({ name: "cloth", map: t, roughness: 0.9, envMapIntensity: 0.55 });
  m.userData.gtbRealized = true;
  plaidCache.set(key, m);
  return m;
}

// Arm-sleeve tattoos: dark ink drawn on white, multiplied by the skin tone, so
// one texture works on every skin. Script, a rose, praying hands, stars.
let tattooTex = null;
const inkCache = new Map();
function tattooMat(skinColor) {
  if (inkCache.has(skinColor)) return inkCache.get(skinColor);
  if (!tattooTex) {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 512;
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, 256, 512);
    g.strokeStyle = g.fillStyle = "rgba(34,26,22,.88)";
    g.lineWidth = 5;
    g.font = "italic bold 40px Georgia, serif";
    g.fillText("Family", 20, 70); g.fillText("First", 60, 118);
    g.font = "italic bold 30px Georgia, serif";
    g.fillText("Good Men", 20, 300); g.fillText("Still Exist", 30, 338);
    // a rose: spiral petals and two leaves
    g.beginPath();
    for (let a = 0; a < Math.PI * 6; a += 0.2) g.lineTo(150 + Math.cos(a) * a * 3.2, 200 + Math.sin(a) * a * 3.2);
    g.stroke();
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(150 + s * 50, 240, 26, 10, s * 0.6, 0, Math.PI * 2); g.fill(); }
    // praying hands, simplified
    g.beginPath(); g.ellipse(90, 430, 22, 60, -0.15, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(118, 430, 22, 60, 0.15, 0, Math.PI * 2); g.fill();
    // stars
    for (const [x, y] of [[210, 40], [30, 170], [220, 440], [200, 380]]) {
      g.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 7 : 16, a = (i / 10) * Math.PI * 2 - Math.PI / 2; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
      g.closePath(); g.fill();
    }
    tattooTex = new THREE.CanvasTexture(c);
    tattooTex.colorSpace = THREE.SRGBColorSpace;
  }
  const m = mat("skin", skinColor).clone();
  m.map = tattooTex;
  m.userData.gtbRealized = true;
  inkCache.set(skinColor, m);
  return m;
}

let blobTex = null;
function contactShadow(radius) {
  if (!blobTex) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.45, "rgba(255,255,255,0.7)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    blobTex = new THREE.CanvasTexture(c);
    blobTex.colorSpace = THREE.SRGBColorSpace;
  }
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 20),
    new THREE.MeshBasicMaterial({
      map: blobTex, color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false,
    })
  );
  m.material.userData.gtbRealized = true;
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.02;
  return m;
}

function add(parent, geometry, material, x, y, z) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// The hold, per weapon class, carried and aimed. `hand` is where the GUN HAND
// goes, as an offset from the gun shoulder pivot in torso space — and nothing
// else in the game places a weapon, because the weapon hangs off that hand
// (weapons_3d.js). Two consequences worth stating, since they are the whole
// reason this is a target and not a pair of joint angles:
//
//   * the support hand is solved onto the weapon's actual foregrip, so it works
//     for any weapon length without a new entry here;
//   * because BOTH hands are placed from the same two numbers, a gun whose
//     foregrip is out of reach of the support shoulder is a measurable error at
//     build time rather than something that "looks a bit off" in the browser.
//     (tools/qa/weapon_hold_test.mjs measures exactly that.)
//
// Earlier this was hand-tuned `pivot`/`elbow` angles instead, and they put the
// gun hand 0.43 m out in front of the body — further than the support arm can
// reach, so the off hand floated about 0.4 m short of the foregrip on every
// two-handed weapon. Reaching across is what puts the gun near the centreline.
//
// `blade` turns the torso onto the target, and `pole` is where the elbow bulges
// (down and out, the way an arm actually holds a gun).
const HOLD_POSES = {
  pistol: {
    carry: { hand: [0.10, -0.24, 0.14], pole: [-0.7, -1, -0.2] },
    aim:   { hand: [0.20, -0.10, 0.30], pole: [-0.7, -1, -0.2] },
    blade: { carry: 0.20, aim: 0.10 },
  },
  long: {
    carry: { hand: [0.22, -0.20, 0.16], pole: [-0.8, -1, -0.1] },
    aim:   { hand: [0.24, -0.10, 0.22], pole: [-0.8, -1, -0.1] },
    blade: { carry: 0.34, aim: 0.18 },
  },
  melee: {
    // Bat cocked over the shoulder: elbow folded, fist just in front of and
    // beside the shoulder at shoulder height. The bat's own angle is set by
    // weapons_3d.js (`orient: "melee"`), so a bat is never sighted and never
    // tracks the camera — this only says where the fist is.
    carry: { hand: [0.10, 0.02, 0.10], pole: [-0.9, -1, 0.35] },
    aim:   { hand: [0.10, 0.02, 0.10], pole: [-0.9, -1, 0.35] },
    blade: { carry: 0.22, aim: 0.22 },
  },
};

// Scratch for the arm solver — the IK runs every frame for the support hand
// while a two-handed weapon is up, so it allocates nothing.
const _ikTarget = new THREE.Vector3(), _ikDir = new THREE.Vector3();
const _ikPerp = new THREE.Vector3(), _ikPole = new THREE.Vector3(), _ikX = new THREE.Vector3();
const _ikY = new THREE.Vector3(), _ikZ = new THREE.Vector3();
const _ikM = new THREE.Matrix4();
const clamp1 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

/**
 * Analytic two-bone IK: solve `arm` (shoulder → elbow → hand) so the hand lands
 * exactly on `target`, with the elbow bulging toward `pole`. Everything is in the
 * pivot's PARENT space (the torso).
 *
 * The construction is closed form, not iterative, and it is exact: the forearm
 * direction is derived from the target rather than from the angles, so the hand
 * cannot wind up near the target — it is on it. That is what puts the support
 * hand on a weapon's foregrip instead of somewhere beside it.
 *
 *   reach = |target − shoulder|, clamped into the chain's range
 *   β = the elbow's interior angle   (law of cosines on a, b, reach)
 *   α = how far the upper arm leaves the shoulder→target line, toward the pole
 *
 * Returns false if the pivot is degenerate (no length to solve).
 */
function solveArm(arm, target, pole) {
  const S = arm.pivot.position, a = arm.upper, b = arm.fore;
  const dx = target.x - S.x, dy = target.y - S.y, dz = target.z - S.z;
  const raw = Math.hypot(dx, dy, dz);
  if (raw < 1e-5) return false;
  const ux = dx / raw, uy = dy / raw, uz = dz / raw;
  const reach = Math.min(a + b - 0.01, Math.max(Math.abs(a - b) + 0.01, raw));
  const tx = S.x + ux * reach, ty = S.y + uy * reach, tz = S.z + uz * reach;

  const cosB = clamp1((a * a + b * b - reach * reach) / (2 * a * b));
  const beta = Math.acos(cosB);
  // elbow.rotation.x = β − π bends the forearm toward the pivot's +z
  arm.elbow.rotation.set(beta - Math.PI, 0, 0);

  const alpha = Math.acos(clamp1((a * a + reach * reach - b * b) / (2 * a * reach)));
  // orthogonalise the pole hint against the shoulder→target line
  _ikDir.set(ux, uy, uz);
  _ikPerp.set(pole.x, pole.y, pole.z).addScaledVector(_ikDir, -pole.dot(_ikDir));
  if (_ikPerp.lengthSq() < 1e-8) _ikPerp.set(-arm.side, -1, 0);   // degenerate: elbow down and out
  _ikPerp.normalize();

  const ca = Math.cos(alpha), sa = Math.sin(alpha);
  const ex = ux * ca + _ikPerp.x * sa;
  const ey = uy * ca + _ikPerp.y * sa;
  const ez = uz * ca + _ikPerp.z * sa;
  // the forearm's direction, read straight off the (clamped) target
  const fx = (tx - S.x - ex * a) / b, fy = (ty - S.y - ey * a) / b, fz = (tz - S.z - ez * a) / b;
  // basis: local −y runs down the upper arm, local +z is the side the forearm
  // swings to. Z = (f + cosβ·e) / sinβ is the component of f across e.
  _ikY.set(-ex, -ey, -ez);
  const sb = Math.sin(beta);
  _ikZ.set((fx + cosB * ex) / sb, (fy + cosB * ey) / sb, (fz + cosB * ez) / sb);
  _ikX.crossVectors(_ikY, _ikZ);
  _ikM.makeBasis(_ikX, _ikY, _ikZ);
  arm.pivot.quaternion.setFromRotationMatrix(_ikM);
  return true;
}

// --------------------------------------------------------------- the rig
// Joint layout, all in metres on a ~1.8 m body that is scaled to fit at the end:
//
//   root → hips → waist → torso → head → (bandana, hair, earrings)
//                            → shoulderL/R → upperArm → elbow → foreArm → hand
//         → hipL/R → thigh → knee → shin → foot
//
// Rotating the shoulder/hip pivots is all the walk cycle needs. `waist` and
// `hand` (the wrist) and `head` are joints in their own right, added for the
// poses rather than the locomotion: see the note on each.
class Hoodrat extends THREE.Object3D {
  constructor(opts = {}) {
    super();
    const rnd = mulberry(opts.seed != null ? opts.seed : (Math.random() * 1e9) | 0);
    const female = opts.sex === "f";
    // `crew` is a crew name, or a palette object for the story characters
    const crew = typeof opts.crew === "object"
      ? { ...CREWS.red, ...opts.crew }
      : CREWS[opts.crew] || CREWS.red;
    const headwear = opts.headwear || "band";      // "band" | "none" | "hat" | "cap"

    this.female = female;
    // How old this character is, as a fact about the rig rather than a claim
    // made about it afterwards. It used to be `opts.age`, which nothing read:
    // franchiseClubs.js passed `age: 25 + i` and then stamped
    // `userData.age = Math.max(25, userData.age || 25)`, so with no reader the
    // value was always undefined and the stamp always produced 25. The
    // "every performer is an adult" check downstream of that was a tautology
    // checking 25 >= 18, and would have passed for any actor at all.
    //
    // The whole cast is adult by design, so the default is an adult and the
    // floor is enforced rather than assumed. A caller that wants a minor says
    // so here, and `allowsAdultClip` then refuses to put them on a stage.
    this.userData.age = opts.age != null ? opts.age : 25;
    this.crew = typeof opts.crew === "object" ? "custom" : opts.crew || "red";
    this.crewInfo = crew;
    // crew members follow the reference sheets; story characters (a palette
    // object) keep the classic look, and their seeds build the same bodies
    const styled = typeof opts.crew !== "object";

    // draw both tones even when overridden, so a seed builds the same body
    const skinTone = SKIN_TONES[(rnd() * SKIN_TONES.length) | 0];
    const denimTone = DENIM[(rnd() * DENIM.length) | 0];
    const skin = mat("skin", opts.skin != null ? opts.skin : skinTone);
    // opts.plaid: a redneck-styled flannel shirt instead of a flat tank colour
    const white = opts.plaid
      ? plaidMat(opts.plaidBase != null ? opts.plaidBase : 0x8a2e2e, opts.plaidLine != null ? opts.plaidLine : 0x2c2c2c)
      : opts.top === "rainbow" ? rainbowMat()
      : mat("cloth", opts.top != null ? opts.top : 0xeceae4);
    const denim = mat("denim", opts.denim != null ? opts.denim : denimTone);
    const band = opts.rainbow ? rainbowMat() : styled ? paisleyMat(crew.cloth) : mat("cloth", crew.cloth);
    const legging = mat("lycra", styled && crew.legging != null ? crew.legging : crew.cloth);
    const chainMat = mat("metal", crew.chain);
    const hairMat = mat("hair", opts.hair != null ? opts.hair : 0x16100d);
    const shoeWhite = mat("leather", 0xf2f0ec);
    const shoeAccent = mat("leather", crew.shoe);
    const sole = mat("rubber", 0xe6e3dc);

    // build variation — the women in the reference are leaner, the men wider
    const bulk = female ? 0.86 + rnd() * 0.1 : 1 + rnd() * 0.14;
    const shoulder = female ? 0.19 : 0.25;

    // ---- hips ----------------------------------------------------------
    const hips = new THREE.Object3D();
    hips.position.y = 0.92;
    this.add(hips);
    this.hips = hips;

    // ---- torso ---------------------------------------------------------
    // opts.glam (female): bare legs, a mini skirt and heels — the street workers' and escorts' wardrobe (characters.js randomProstitute)
    const glam = female && !!opts.glam;
    // opts.topless (female): the sequined crop top is dropped for bare skin over
    // the same cylinder-and-two-spheres chest shape everyone else gets — no new
    // geometry, no anatomical detail added, just the existing low-poly bust read
    // in `skin` instead of cloth. Stylised, not explicit: there is nothing here
    // finer than the same primitives a clothed dancer already wears. Club stage
    // performers only (see franchiseClubs.js); everyone stays a fictional adult.
    const topless = female && !!opts.topless;
    // opts.stripper (female): the stage costume — a bikini top over the same
    // bust, a gstring in place of the leggings, bare legs and heels. Skimper
    // than `glam`'s mini skirt, and it is what the clubs' own performers work
    // in (crowd.js's `performer` / `gogo` roles, franchiseClubs.js's cast).
    // Stylised exactly like `topless`: the sheet's own low-poly bust, scaled,
    // with no anatomical detail added anywhere.
    const stripper = female && !!opts.stripper;
    // What can come off this body, and what it is made of (see `registerGarment`
    // at the foot of this file). Collected as the geometry is built, because by
    // the end of the constructor the materials are merged and the names are gone.
    const garments = [];
    // `glam` was the only bare-leg branch; a stripper is bare-legged too, but
    // with a gstring rather than a skirt, so the two are tracked separately.
    const bareLegs = glam || stripper;
    // opts.bust scales the chest (1 = the sheet's own read). The clubs pass
    // more than 1: nobody queues for the house standard.
    const bust = female && opts.bust != null ? opts.bust : 1;
    const sequin = stripper ? mat("lycra", opts.bikini != null ? opts.bikini : 0xff2e93) : null;
    const skirtMat = glam ? mat("lycra", opts.skirt != null ? opts.skirt : 0x111111) : null;
    const pelvis = add(hips, cyl(0.168 * bulk, 0.152 * bulk, 0.17, 12), glam ? skirtMat : stripper ? skin : female ? legging : denim, 0, -0.06, 0);
    pelvis.scale.z = 0.84;
    if (glam) {
      // a short flared skirt: hem well above mid-thigh
      const sk = add(hips, cyl(0.172 * bulk, 0.235 * bulk, 0.2, 16), skirtMat, 0, -0.16, 0);
      sk.scale.z = 0.9;
    }

    // ---- the spine -----------------------------------------------------
    // `waist` is a joint at the hips' own origin with `torso` hanging off it, so
    // it is the identity transform at rest and every existing clip — all of
    // which drive `r.torso.rotation` — is unchanged to the last decimal. What it
    // buys is a lower back: a clip can now arch from the waist and leave the
    // chest where the pose wants it, which is the difference between a body
    // bending and a body folding at the shoulder blades.
    const waist = new THREE.Object3D();
    hips.add(waist);
    this.waist = waist;

    const torso = new THREE.Object3D();
    waist.add(torso);
    this.torso = torso;

    if (female) {
      // cropped tank: bare midriff, so the waist is skin and the chest cloth
      add(torso, cyl(0.15 * bulk, 0.17 * bulk, 0.22, 12), skin, 0, 0.11, 0);
      const chestMat = topless || stripper ? skin : white;
      const chest = add(torso, cyl(0.19 * bulk, 0.158 * bulk, 0.3, 12), chestMat, 0, 0.37, 0);
      chest.scale.z = 0.84;
      for (const side of [-1, 1]) {
        // The bust is the sheet's two low-poly spheres — but the ribcage
        // cylinder is SOLID, and at the sheet's own numbers the spheres sat
        // entirely INSIDE it, so every woman in the game read as a smooth
        // mannequin. These are placed so the bust stands proud of the ribcage:
        // `proud` is the projection beyond the cylinder's face, and the centre
        // is solved backwards from it so any `bust` still lands where intended.
        const bustR = 0.062 * bust;
        const ribZ = 0.157 * bulk * 0.84;                    // ribcage face at bust height
        const proud = 0.026 + Math.max(0, bust - 1) * 0.085;
        const b = add(torso, sph(bustR), chestMat,
          side * (0.055 + Math.max(0, bust - 1) * 0.03),
          0.35 - Math.max(0, bust - 1) * 0.012,
          ribZ + proud - bustR * 0.55);
        b.scale.set(1, 0.85 - Math.max(0, bust - 1) * 0.12, 0.55);
        if (stripper) {
          // The bikini top: a narrow band UNDER the bust and a strap over each
          // shoulder. It is deliberately flat in z (0.6, not the ribcage's 0.84)
          // and sits below the bust rather than around it — as a full barrel it
          // was wider than the ribcage and swallowed the chest whole.
          const band = add(torso, cyl(0.202 * bulk, 0.202 * bulk, 0.07, 14), sequin, 0, 0.262, 0);
          band.scale.z = 0.6;
          const strap = add(torso, box(0.026, 0.2, 0.024), sequin, side * 0.1 * bulk, 0.47, 0.03);
          strap.rotation.z = side * 0.24;
        } else if (!topless) {
          // scoop-neck strap over the shoulder
          const strap = add(torso, box(0.042, 0.16, 0.03), white, side * 0.105 * bulk, 0.5, 0.02);
          strap.rotation.z = side * 0.2;
        }
        if (!topless && !stripper) registerGarment(garments, "top", white, skin);
      }
      if (stripper) {
        // the gstring: a narrow band at the hip line and a triangle at the front
        const g = add(torso, cyl(0.176 * bulk, 0.173 * bulk, 0.045, 14), sequin, 0, -0.02, 0);
        g.scale.z = 0.86;
        const front = add(torso, box(0.1, 0.12, 0.03), sequin, 0, -0.09, 0.1 * bulk);
        front.rotation.x = 0.2;
        // the whole costume is one material, so it comes off in one piece
        registerGarment(garments, "all", sequin, skin);
      } else {
        // high waistband of the leggings
        const wb = add(torso, cyl(0.172 * bulk, 0.168 * bulk, 0.1, 12), glam ? skirtMat : legging, 0, -0.03, 0);
        wb.scale.z = 0.86;
        registerGarment(garments, "bottom", glam ? skirtMat : legging, skin);
      }
    } else {
      // ribbed tank straight down over the waist, belt at the hips
      // opts.shirtless (male): the tank comes off — bare skin, same low-poly
      // chest everyone gets. Billy Jeans's dancers (the billys) and nothing
      // else (franchiseClubs.js); fictional adults, nothing detailed.
      if (opts.shirtless) {
        const chest = add(torso, cyl(0.2 * bulk, 0.185 * bulk, 0.56, 12), skin, 0, 0.28, 0);
        chest.scale.z = 0.8;
      } else {
      const chest = add(torso, cyl(0.2 * bulk, 0.185 * bulk, 0.56, 12), white, 0, 0.28, 0);
      chest.scale.z = 0.8;
      for (const side of [-1, 1]) {
        const strap = add(torso, box(0.05, 0.18, 0.032), white, side * 0.115 * bulk, 0.5, 0.015);
        strap.rotation.z = side * 0.17;
      }
      }
      // a collared shirt and a tie under the jacket (opts.shirt / opts.tie): the suit must read as a suit, not a black column
      if (opts.shirt != null) {
        const shirtM = mat("cloth", opts.shirt);
        add(torso, box(0.1 * bulk, 0.36, 0.022), shirtM, 0, 0.36, 0.158 * bulk);
        for (const side of [-1, 1]) {
          const lapel = add(torso, box(0.05, 0.3, 0.02), white, side * 0.075 * bulk, 0.37, 0.16 * bulk);
          lapel.rotation.z = side * -0.22;
          const collar = add(torso, box(0.05, 0.04, 0.03), shirtM, side * 0.035, 0.53, 0.1);
          collar.rotation.z = side * 0.5;
        }
        if (opts.tie != null) {
          const tieM = mat("cloth", opts.tie);
          add(torso, box(0.036, 0.3, 0.014), tieM, 0, 0.34, 0.172 * bulk);
          add(torso, box(0.046, 0.04, 0.02), tieM, 0, 0.5, 0.168 * bulk);
        }
      }
      // hi-vis: two bands of reflective tape round the chest and braces over the shoulders (opts.reflective)
      if (opts.reflective) {
        const tape = mat("cloth", 0xe6f23a);
        for (const y of [0.16, 0.4]) { const b = add(torso, cyl(0.206 * bulk, 0.19 * bulk, 0.04, 12), tape, 0, y, 0); b.scale.z = 0.8; }
        for (const side of [-1, 1]) { const b = add(torso, box(0.03, 0.18, 0.034), tape, side * 0.115 * bulk, 0.5, 0.017); b.rotation.z = side * 0.17; }
      }
      // the reference belts are plain leather with a silver buckle
      const belt = add(torso, cyl(0.19 * bulk, 0.19 * bulk, 0.07, 12), styled ? mat("leather", crew.belt) : band, 0, -0.02, 0);
      belt.scale.z = 0.74;
      add(torso, box(0.085, 0.06, 0.03), styled ? mat("metal", 0xcfd3da) : chainMat, 0, -0.02, 0.14 * bulk);
    }

    // chain at the neck: the women's sheet has a gold chain and cross; the men's
    // mostly go without (a third wear a plain chain)
    if (!styled || female || rnd() < 0.35) {
      const chain = add(torso, torus(0.082, 0.011, 6, 18), chainMat, 0, 0.49, 0.055);
      chain.rotation.x = Math.PI / 2 - 0.42;
      chain.scale.z = 0.7;
      if (!styled || female) {
        add(torso, box(0.022, 0.05, 0.012), chainMat, 0, 0.415, 0.135 * bulk);
        add(torso, box(0.042, 0.016, 0.012), chainMat, 0, 0.428, 0.135 * bulk);
      }
    }

    if (opts.police) {
      const badgeGold = mat("metal", 0xd4af37);
      add(torso, box(0.04, 0.045, 0.015), badgeGold, -0.075 * bulk, 0.38, 0.12 * bulk);
      const dutyBeltMat = mat("leather", 0x181818);
      const holsterMat = mat("leather", 0x101010);
      const radioMat = mat("rubber", 0x1f1f1f);
      add(torso, cyl(0.20 * bulk, 0.20 * bulk, 0.08, 12), dutyBeltMat, 0, -0.02, 0);
      add(torso, box(0.065, 0.11, 0.05), holsterMat, 0.16 * bulk, -0.04, 0);
      add(torso, box(0.04, 0.09, 0.035), radioMat, -0.15 * bulk, -0.02, 0);
    }

    // ---- head ----------------------------------------------------------
    const neck = add(torso, cyl(0.055, 0.06, 0.1, ARM_SEG), skin, 0, 0.58, 0);
    // The head IS a joint now. It used not to be: `head` was missing from
    // mergeRigid's list at the end of this constructor, so every mesh under it
    // was baked into the torso and the clips' `r.head.rotation` lines were
    // authoring intent rather than motion. Adding it costs one merge group and
    // buys back every head-turn the act has always been written with — the
    // showboat's chin, the twerk's look over the shoulder, the pole's head turn.
    const head = new THREE.Object3D();
    head.position.y = 0.66;
    torso.add(head);
    this.head = head;

    const skull = add(head, sph(0.115), skin, 0, 0.055, 0);
    skull.scale.set(1, 1.12, 1.04);
    add(head, box(0.1, 0.075, 0.05), skin, 0, 0.02, 0.095);   // jaw / chin

    // eyes — small, but without them the head reads as a mannequin
    const eyeW = mat("cloth", 0xe9e4da);
    const pupil = mat("hair", 0x120d0a);
    for (const side of [-1, 1]) {
      const e = add(head, sph(0.019, 8, 6), eyeW, side * 0.042, 0.062, 0.098);
      e.scale.set(1.15, 0.8, 0.6);
      add(head, sph(0.0095, 6, 5), pupil, side * 0.044, 0.06, 0.111);
      const brow = add(head, box(0.038, 0.011, 0.016), hairMat, side * 0.044, 0.089, 0.1);
      brow.rotation.z = side * -0.12;
    }

    // A hog wears no hair and no headwear: the head below is built off this same
    // skull, and a hairstyle underneath a snout would be a hairline sticking out
    // of a muzzle (see the `opts.hog` block after the hats).
    if (female && !opts.hog) {
      if (headwear === "band") {
        // tied headband, tails to one side
        const hb = add(head, cyl(0.121, 0.121, 0.075, 14), band, 0, 0.12, 0);
        hb.scale.z = 1.02;
        const knot = add(head, sph(0.036), band, 0.105, 0.125, -0.055);
        knot.scale.set(1, 0.8, 1);
        for (let i = 0; i < 2; i++) {
          const tail = add(head, box(0.05, 0.16, 0.016), band, 0.125 + i * 0.02, 0.04 - i * 0.03, -0.075);
          tail.rotation.z = 0.5 + i * 0.35;
        }
      }
      // Hair: a skull cap, one sheet falling down the back, and a slim strand
      // over each shoulder. The blue-crew reference is curly and the red is
      // straight, so the curly build gets a wider, wavier sheet.
      const curly = opts.curly != null ? opts.curly : this.crew === "blue";
      const cap = add(head, sph(0.126), hairMat, 0, 0.045, -0.012);
      cap.scale.set(1.02, 1.06, 1.05);
      let y = -0.03;
      // opts.hogMask: the Happy Hogs cast (franchiseClubs.js) — cartoon pig
      // snout mask and round ears over the usual hair, two stubby pig tails.
      // Sequins, heels, pig ears: the commitment IS the joke. Fictional adults.
      if (opts.hogMask) {
        const snout = add(head, cyl(0.055, 0.075, 0.075, 10), mat("leather", 0xf2a6b4), 0, 0.055, 0.125);
        snout.rotation.x = Math.PI / 2;
        add(head, cyl(0.014, 0.014, 0.012, 8), mat("leather", 0x6e3a44), 0, 0.055, 0.166).rotation.x = Math.PI / 2;
        for (const s of [-1, 1]) {
          const ear = add(head, sph(0.048, 8, 6), mat("leather", 0xf2a6b4), s * 0.1, 0.155, -0.01);
          ear.scale.set(1, 0.8, 0.55);
          const tail = add(head, box(0.05, 0.2, 0.05), hairMat, s * 0.11, -0.12, -0.07);
          tail.rotation.z = s * 0.5;
          tail.rotation.x = -0.25;
          const tip = add(head, sph(0.038, 6, 5), hairMat, s * 0.155, -0.21, -0.09);
          tip.scale.set(1.15, 1.15, 1.15);
        }
      }
      // opts.shortHair: a pixie / undercut — the cap alone, nothing down the back
      const lengths = opts.shortHair ? 0 : styled ? 5 : 4;   // the sheet's hair falls to the lower back
      for (let i = 0; i < lengths; i++) {
        const w = curly ? 0.2 - i * 0.012 : 0.17 - i * 0.018;
        const seg = add(head, box(w, 0.15, curly ? 0.075 : 0.055), hairMat,
          curly ? Math.sin(i * 2.3) * 0.016 : 0, y, -0.085 - i * 0.006);
        seg.rotation.z = curly ? Math.sin(i * 1.9) * 0.1 : 0;
        y -= 0.135;
      }
      for (const side of opts.shortHair ? [] : [-1, 1]) {
        const strand = add(head, box(0.05, 0.34, 0.05), hairMat, side * 0.105, -0.16, 0.005);
        strand.rotation.z = side * 0.05;
        if (curly) strand.scale.x = 1.3;
      }
      if (styled && curly && !opts.shortHair) {
        // spiral curls: bumps down the back and over the shoulders
        for (let i = 0; i < 16; i++) {
          add(head, sph(0.032, 6, 5), hairMat, ((i % 4) - 1.5) * 0.05, -0.02 - i * 0.042, -0.125 - (i % 3) * 0.012);
        }
        for (const side of [-1, 1]) {
          for (let i = 0; i < 5; i++) add(head, sph(0.03, 6, 5), hairMat, side * (0.115 + (i % 2) * 0.012), -0.04 - i * 0.07, 0.01);
        }
      }
      add(head, torus(0.042, 0.008, 6, 14), chainMat, 0.115, -0.01, 0.01);
      add(head, torus(0.042, 0.008, 6, 14), chainMat, -0.115, -0.01, 0.01);
    } else {
      // Hair and cloth cover the crown only. The skull tops out at y ≈ 0.184 and the
      // eyebrows reach y ≈ 0.095, so every cap follows the skull's shape down to a level
      // rim at y ≈ 0.105: the eyes and brows stay visible, as on the reference sheet.
      // (Full spheres centred at eye height used to bury the eyes.)
      // opts.hogMask (any sex): the Happy Hogs cast. A cartoon pig snout mask
      // with round ears, worn OVER the usual hair — plus two stubby pig tails
      // when female. The joke is the commitment: sequins, heels and pig ears.
      if (opts.hogMask) {
        const snout = add(head, cyl(0.055, 0.075, 0.075, 10), mat("leather", 0xf2a6b4), 0, 0.055, 0.125);
        snout.rotation.x = Math.PI / 2;
        add(head, cyl(0.014, 0.014, 0.012, 8), mat("leather", 0x6e3a44), 0, 0.055, 0.166).rotation.x = Math.PI / 2;
        for (const s of [-1, 1]) {
          const ear = add(head, sph(0.048, 8, 6), mat("leather", 0xf2a6b4), s * 0.1, 0.155, -0.01);
          ear.scale.set(1, 0.8, 0.55);
        }
        if (female) {
          for (const s of [-1, 1]) {
            const tail = add(head, box(0.05, 0.2, 0.05), hairMat, s * 0.11, -0.12, -0.07);
            tail.rotation.z = s * 0.5;
            tail.rotation.x = -0.25;
            const tip = add(head, sph(0.038, 6, 5), hairMat, s * 0.155, -0.21, -0.09);
            tip.scale.set(1.15, 1.15, 1.15);
          }
        }
      }
      const crown = (m, r) => {
        const c = add(head, capGeo(r, 1.2), m, 0, 0.055, 0);
        c.scale.set(1, 1.12, 1.04);
        return c;
      };
      if (headwear === "band" && styled) {
        // the men's sheet: a paisley bandana either over the whole crown
        // (red's usual) or folded into a brow band over cornrows (blue's usual)
        const style = rnd() < 0.7 ? crew.headStyle : crew.headStyle === "wrap" ? "cornrows" : "wrap";
        if (style === "cornrows") {
          crown(hairMat, 0.121);
          for (let i = -2; i <= 2; i++) {
            const row = add(head, box(0.02, 0.026, 0.25), hairMat, i * 0.04, 0.188 - Math.abs(i) * 0.03, -0.018);
            row.rotation.z = i * 0.3;
            row.rotation.x = 0.1;
          }
          const brow = add(head, cyl(0.096, 0.117, 0.042, 16), band, 0, 0.124, 0);   // high on the forehead
          brow.scale.z = 1.05;
        } else {
          crown(band, 0.124);
          const brow = add(head, cyl(0.1, 0.119, 0.04, 16), band, 0, 0.12, 0);       // the folded edge at the rim
          brow.scale.z = 1.05;
        }
        // knot and short tails at the back, just off-centre
        const knot = add(head, sph(0.034), band, -0.045, 0.12, -0.11);
        knot.scale.set(1, 0.8, 0.9);
        for (let i = 0; i < 2; i++) {
          const tail = add(head, box(0.045, 0.12, 0.014), band, -0.06 + i * 0.03, 0.06, -0.12);
          tail.rotation.z = -0.35 + i * 0.5;
          tail.rotation.x = -0.25;
        }
        if (rnd() < 0.5) {
          // small stud earrings
          for (const side of [-1, 1]) add(head, sph(0.011, 6, 5), mat("metal", 0xe8e2d0), side * 0.118, 0.02, 0.01);
        }
      } else if (headwear === "band") {
        // do-rag: a crown cap with the two tails hanging down the back
        crown(band, 0.122);
        const knot = add(head, sph(0.04), band, 0, 0.1, -0.11);
        knot.scale.set(0.9, 0.8, 1);
        for (const side of [-1, 1]) {
          const tail = add(head, box(0.055, 0.2, 0.016), band, side * 0.035, 0.0, -0.12);
          tail.rotation.z = side * 0.18;
          tail.rotation.x = -0.22;
        }
      } else if (!opts.hog) {
        // close-cropped hair
        crown(hairMat, 0.119);
      }
      if (opts.beard !== false) {
        // short beard / goatee
        add(head, box(0.085, 0.05, 0.035), hairMat, 0, -0.028, 0.1);
      }
    }

    if (headwear === "hat") {
      // wide-brimmed campaign hat: the sheriff's, or anyone's in the sun
      const felt = mat("leather", crew.hat != null ? crew.hat : 0x8a6a44);
      const brim = add(head, cyl(0.24, 0.24, 0.018, 20), felt, 0, 0.13, 0);
      brim.scale.z = 1.08;
      add(head, cyl(0.105, 0.13, 0.12, 16), felt, 0, 0.2, 0);
      add(head, cyl(0.133, 0.133, 0.03, 16), band, 0, 0.155, 0);
      if (opts.police) {
        const badgeGold = mat("metal", 0xd4af37);
        add(head, box(0.028, 0.032, 0.012), badgeGold, 0, 0.165, 0.138);
      }
    }

    if (headwear === "fedora") {
      // a narrow-brimmed felt hat, snapped down over one eye — the stage act's,
      // not the sheriff's (that is `"hat"`, a full 360° campaign brim), so the
      // silhouette is different at a glance from across the room
      const felt = mat("leather", crew.hat != null ? crew.hat : 0x1a1a1c);
      const brim = add(head, cyl(0.185, 0.185, 0.014, 20), felt, 0, 0.122, 0);
      brim.scale.z = 1.1;
      brim.rotation.x = -0.16;
      add(head, cyl(0.1, 0.112, 0.14, 16), felt, 0, 0.19, -0.012);
      add(head, cyl(0.116, 0.116, 0.03, 16), mat("leather", 0x0b0b0d), 0, 0.14, -0.012);
      const pinch = add(head, box(0.055, 0.02, 0.07), felt, 0, 0.26, -0.012);
      pinch.rotation.x = 0.22;
    }

    if (opts.hog) {
      // ---- the hog (HAPPY HOGS' house: its dancers and its barman) ----------
      // Anthropomorphic, on the *people rig* — so a hog dances on a podium,
      // cheers, walks and works a bar with the same clips and the same beats as
      // everybody else on the strip, and costs the same to draw. What makes it a
      // hog is the head, built here over the human skull:
      //
      //   * a dropped muzzle that swallows the jaw and chin (which are already at
      //     z 0.095, so there is nothing to hide) and hangs a little below them,
      //   * the snout disc on its end, with two nostrils, which is the shape that
      //     reads as a pig from the front, and the front is where the audience is,
      //   * two floppy ears flopped forward and outward, tapering wider than the
      //     skull the way a hog's do, and
      //   * a pair of small tusks, because HAPPY HOGS is a *show* bar.
      //
      // The body is the skin material the caller passed (`makeHog` hands the hog's
      // own hide colour in as `skin`), so no part of the rig needed a branch —
      // only this block, and the two `!opts.hog` guards above.
      const snoutMat = mat("hog snout", opts.snoutColor != null ? opts.snoutColor : 0xd98a86);
      const earMat = mat("hog ear", opts.earColor != null ? opts.earColor : 0xc47f78);
      const innerEar = mat("hog ear inner", 0xe9a9a4);
      const ivory = mat("hog tusk", 0xf2ead6);
      const nostril = mat("hog nostril", 0x6b403f);
      // Sized down from the first pass (0.115/0.15 box, 0.056 disc, out to z
      // 0.234) — read as a full snout swallowing the whole lower face rather
      // than a pig's nose on it. This projects about a third less far off the
      // skull (radius 0.115) and the disc is a smaller flat end, not the
      // widest part of the head.
      const muzzle = add(head, box(0.095, 0.088, 0.1), snoutMat, 0, -0.02, 0.115);
      muzzle.rotation.x = -0.06;
      const disc = add(head, cyl(0.042, 0.042, 0.02, 14), snoutMat, 0, -0.012, 0.168);
      disc.rotation.x = Math.PI / 2;         // the flat snout, facing the room
      for (const side of [-1, 1]) add(head, sph(0.013, 6, 5), nostril, side * 0.02, -0.008, 0.178);
      for (const side of [-1, 1]) {
        // the ear: rooted *inside* the skull (its inner end is buried at x 0.07,
        // where the skull is still 0.11 wide) and flopped out and forward, so a
        // hog reads as a hog from the side as well as the front
        const ear = add(head, box(0.03, 0.13, 0.085), earMat, side * 0.112, 0.138, -0.015);
        ear.rotation.z = side * -0.6;
        ear.rotation.x = -0.28;
        ear.scale.set(1, 1, 1.15);
        // the pink inside of it, parallel to the plate and just outboard
        const inner = add(head, box(0.024, 0.088, 0.052), innerEar, side * 0.126, 0.134, -0.015);
        inner.rotation.z = side * -0.6;
        inner.rotation.x = -0.28;
        const tusk = add(head, box(0.017, 0.05, 0.017), ivory, side * 0.04, -0.05, 0.172);
        tusk.rotation.x = -0.3;
        tusk.rotation.z = side * 0.22;
      }
      // ...and the curl, off the back of the hips
      const tail = add(hips, torus(0.045, 0.012, 5, 10), snoutMat, 0, 0.0, -0.15);
      tail.rotation.y = Math.PI / 2;
    }

    if (headwear === "hardhat") {
      // a site hard hat: a taller crown, a ridge along the top, and a brim all the way round
      const hatM = mat("plastic", opts.capColor != null ? opts.capColor : 0xf2c230);
      const dome = add(head, capGeo(0.132, 1.3), hatM, 0, 0.06, 0);
      dome.scale.set(1.04, 1.08, 1.08);
      add(head, cyl(0.158, 0.158, 0.014, 16), hatM, 0, 0.078, 0.01).scale.z = 1.12;
      add(head, box(0.03, 0.02, 0.24), hatM, 0, 0.212, 0);
    }
    if (opts.shades) {
      const lens = mat("glass", 0x0c0c10);
      add(head, box(0.19, 0.034, 0.02), lens, 0, 0.066, 0.108);
      for (const side of [-1, 1]) add(head, box(0.012, 0.012, 0.11), lens, side * 0.098, 0.068, 0.05);
    }
    if (headwear === "cap") {
      // redneck-styled trucker/baseball cap: a rounded crown and a flat brim
      // over the front only (unlike "hat"'s full 360° brim)
      const capMat = mat("cloth", opts.capColor != null ? opts.capColor : 0x2c2c2c);
      const dome = add(head, capGeo(0.128, 1.25), capMat, 0, 0.06, 0);
      dome.scale.set(1.03, 1.05, 1.06);
      const brim = add(head, box(0.16, 0.014, 0.11), capMat, 0, 0.09, 0.165);
      brim.rotation.x = -0.12;
      // a small snapback strap at the back
      add(head, box(0.06, 0.03, 0.012), mat("leather", 0x3a3a3a), 0, 0.045, -0.135);
    }

    // ---- arms ----------------------------------------------------------
    // most crew men have both arms sleeved in ink, like the sheet
    const inked = styled && !female && rnd() < 0.8 ? tattooMat(opts.skin != null ? opts.skin : skinTone) : null;
    this.arms = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Object3D();
      pivot.position.set(side * shoulder * bulk, 0.47, 0);
      torso.add(pivot);
      // sleeves: long (opts.sleeves: a jacket, a work shirt, coveralls) or short (opts.shortSleeves: the shirt's own colour over the upper arm)
      const sleeveM = opts.sleeves != null ? mat("cloth", opts.sleeves) : null;
      const shortM = opts.shortSleeves && opts.top != null && typeof opts.top === "number" ? mat("cloth", opts.top) : null;
      const upper = add(pivot, cyl(0.052 * bulk * (sleeveM || shortM ? 1.16 : 1), 0.045 * bulk * (sleeveM || shortM ? 1.16 : 1), 0.26, ARM_SEG), sleeveM || shortM || inked || skin, 0, -0.13, 0);
      const delt = add(pivot, sph(0.072 * bulk), skin, 0, 0.012, 0);   // deltoid
      delt.scale.set(1, 1.15, 1);
      const elbow = new THREE.Object3D();
      elbow.position.y = -0.26;
      pivot.add(elbow);
      // The elbow itself. Without a joint here the upper arm and the forearm
      // were two cylinders butting into each other, and the seam between them
      // is exactly what makes a limb read as two sticks rather than one arm.
      const elbowBall = add(elbow, sph(0.043 * bulk, 10, 8), sleeveM || inked || skin, 0, 0, 0);
      elbowBall.scale.set(1, 0.9, 1);
      add(elbow, cyl(0.042 * bulk * (sleeveM ? 1.16 : 1), 0.036 * bulk * (sleeveM ? 1.16 : 1), 0.24, ARM_SEG), sleeveM || inked || skin, 0, -0.12, 0);
      if (sleeveM && opts.shirt != null) add(elbow, cyl(0.046 * bulk, 0.046 * bulk, 0.03, 10), mat("cloth", opts.shirt), 0, -0.235, 0);   // a white cuff showing at the wrist
      // `opts.glove` puts the white one on the RIGHT hand (side -1) — the gun
      // hand, which is the hand an act holds the mic in, and the hand the
      // Crown Strip's stage prop is about (makeStar, below). A material swap on
      // the hand itself, so nothing about the rig or the IK changes.
      const glove = opts.glove && side === -1 ? mat("leather", opts.gloveColor != null ? opts.gloveColor : 0xf4f7ff) : null;
      // ---- the wrist, and the hand socket ----------------------------------
      // One node doing both jobs, and it is a real joint now rather than a bare
      // marker: the hand's own meshes hang off it and it is in mergeRigid's
      // list, so a clip can roll the wrist and the fist follows. It sits at the
      // middle of the fist rather than at the wrist joint, because that is where
      // a grip actually is — and it is where a weapon is attached
      // (weapons_3d.js), so the IK target and the wrist roll are the same node
      // and cannot drift apart. `upper`/`fore` are the bone lengths the
      // support-hand IK solves against.
      const hand = new THREE.Object3D();
      hand.position.set(0, -0.25, 0);
      elbow.add(hand);
      buildHand(hand, glove || skin, bulk, !!glove);
      this.arms.push({ pivot, elbow, hand, side, upper: 0.26, fore: 0.25 });
    }
    // Facing +z, the right-hand vector of a heading is -x (world.js), so arms[0]
    // (side -1) is the character's RIGHT arm: the gun hand. arms[1] supports.
    this.rightArm = this.arms.find((a) => a.side === -1);
    this.leftArm = this.arms.find((a) => a.side === 1);

    // ---- legs ----------------------------------------------------------
    this.legs = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Object3D();
      pivot.position.set(side * 0.105 * bulk, -0.02, 0);
      hips.add(pivot);

      const knee = new THREE.Object3D();
      knee.position.y = -0.44;
      pivot.add(knee);

      if (female) {
        // leggings: slim, continuous (glam / stripper: bare skin, or thigh-high
        // boots when opts.thighBoots)
        const legM = bareLegs ? skin : legging;
        add(pivot, cyl(0.132 * bulk, 0.092 * bulk, 0.46, LEG_SEG), legM, 0, -0.22, 0);
        add(knee, cyl(0.088 * bulk, 0.056 * bulk, 0.44, LEG_SEG), legM, 0, -0.22, 0);
        if (glam && opts.thighBoots) {
          const bm = mat("leather", opts.bootColor != null ? opts.bootColor : 0x0d0b0c);
          add(pivot, cyl(0.137 * bulk, 0.096 * bulk, 0.3, LEG_SEG), bm, 0, -0.32, 0);        // over the knee
          add(knee, cyl(0.092 * bulk, 0.062 * bulk, 0.44, LEG_SEG), bm, 0, -0.22, 0);
        }
      } else {
        // baggy jeans: wide all the way down, stacked over the shoe
        // (opts.slim: trousers that fit — a suit — instead of the crew's baggy stacked jeans)
        const fit = opts.slim ? 0.72 : 1;
        add(pivot, cyl(0.118 * bulk * fit, 0.126 * bulk * fit, 0.46, LEG_SEG), denim, 0, -0.22, 0);
        add(knee, cyl(0.126 * bulk * fit, 0.134 * bulk * fit, 0.46, LEG_SEG), denim, 0, -0.22, 0);
      }
      // The knee, like the elbow: a joint sphere so the thigh and shin are one
      // limb. Barely visible through denim, but it is what stops the leg
      // breaking into two cylinders at a hard corner.
      const kneeBall = add(knee, sph(0.062 * bulk, 10, 8), female ? (bareLegs ? skin : legging) : denim, 0, 0, 0);
      kneeBall.scale.set(1, 0.92, 1);

      const foot = new THREE.Object3D();
      foot.position.y = -0.44;
      knee.add(foot);
      const shoe = opts.shoe || (!styled ? "classic" : female ? "high" : crew.maleShoe);
      if (shoe === "heels") {
        // stilettos: a strap-and-sole platform on a spike heel, the arch tipped toe-down
        const hm = mat("leather", opts.heelColor != null ? opts.heelColor : crew.shoe);
        add(foot, box(0.09, 0.03, 0.2), hm, 0, -0.03, 0.06).rotation.x = 0.28;
        add(foot, box(0.085, 0.06, 0.08), hm, 0, 0.0, -0.04);                          // heel counter
        add(foot, cyl(0.011, 0.017, 0.06, 6), hm, 0, -0.056, -0.05);                     // the spike
      } else if (shoe === "boots") {
        // plain work boots: a taller leather shaft over a thick heel
        const bootMat = mat("leather", opts.bootColor != null ? opts.bootColor : 0x3d2b1c);
        add(foot, cyl(0.098, 0.11, 0.22, 10), bootMat, 0, 0.06, 0.01);   // shaft
        add(foot, box(0.12, 0.07, 0.26), bootMat, 0, -0.015, 0.045);    // upper/toe
        add(foot, box(0.128, 0.05, 0.27), sole, 0, -0.056, 0.05);       // thick heel
      } else if (shoe === "low") {
        // all-white low-tops (the red sheet)
        add(foot, box(0.115, 0.05, 0.12), shoeWhite, 0, 0.02, -0.005);   // low collar
        add(foot, box(0.12, 0.07, 0.26), shoeWhite, 0, -0.015, 0.045);   // upper
        add(foot, box(0.128, 0.042, 0.27), sole, 0, -0.052, 0.05);       // midsole
      } else if (shoe === "high") {
        // colour-blocked high-tops: crew collar, heel and side stripe on a white toe
        add(foot, box(0.118, 0.1, 0.13), shoeAccent, 0, 0.05, 0.005);   // collar
        add(foot, box(0.12, 0.07, 0.26), shoeWhite, 0, -0.015, 0.045);  // upper
        add(foot, box(0.124, 0.05, 0.11), shoeAccent, 0, -0.005, -0.03); // heel panel
        for (const s of [-1, 1]) {
          const stripe = add(foot, box(0.006, 0.026, 0.15), shoeAccent, s * 0.062, 0, 0.06);
          stripe.rotation.x = -0.35;                                     // the side stripe, roughly
        }
        add(foot, box(0.128, 0.042, 0.27), sole, 0, -0.052, 0.05);
      } else {
        // high-top sneaker: white upper, crew-coloured panel, pale sole
        add(foot, box(0.115, 0.09, 0.135), shoeWhite, 0, 0.045, 0.005);   // collar
        add(foot, box(0.12, 0.07, 0.26), shoeWhite, 0, -0.015, 0.045);    // upper
        add(foot, box(0.124, 0.035, 0.1), shoeAccent, 0, -0.012, -0.035); // heel panel
        add(foot, box(0.128, 0.042, 0.27), sole, 0, -0.052, 0.05);        // midsole
      }
      this.legs.push({ pivot, knee, foot, side });
    }

    // the bandana hanging off the back pocket, as in the reference
    if (!female && headwear === "band") {
      if (styled) {
        // hanging long from a front pocket: left for red, right for blue
        const s = crew.pocket || 1;
        // outside the baggy jeans (their radius is ~0.13 at the thigh), hanging to mid-thigh
        const rag = add(hips, box(0.11, 0.4, 0.02), band, s * 0.215 * bulk, -0.24, 0.05);
        rag.rotation.z = s * 0.08;
        rag.rotation.y = s * 0.45;
      } else {
        const rag = add(hips, box(0.11, 0.3, 0.02), band, 0.16 * bulk, -0.16, -0.055);
        rag.rotation.z = 0.14;
      }
    }

    // ---- the robe ------------------------------------------------------
    // opts.robe: a hooded robe pulled on over whatever the body is already
    // wearing (klan.js). Built here rather than bolted on afterwards so it goes
    // through mergeRigid below with everything else — a robed man is then the
    // same handful of draw calls as an unrobed one. The clothes underneath are
    // left in place: the robe is opaque and covers them, and not building them
    // would mean a second body branch to keep in step with this one forever.
    if (opts.robe) {
      const cloth = mat("cloth", opts.robeColor != null ? opts.robeColor : 0xe8e4d8);
      const slit = mat("cloth", 0x14110e);
      // body and skirt. The skirt hangs off the hips, not the legs, so it
      // swings with the walk instead of scissoring with it — and it stops above
      // the boots, which is what actually sells the stride.
      const chest = add(torso, cyl(0.245 * bulk, 0.305 * bulk, 0.64, 14), cloth, 0, 0.30, 0);
      chest.scale.z = 0.9;
      const skirt = add(hips, cyl(0.30 * bulk, 0.45 * bulk, 0.66, 14), cloth, 0, -0.36, 0);
      skirt.scale.z = 0.92;
      // the cape over the shoulders
      const cape = add(torso, cyl(0.215 * bulk, 0.315 * bulk, 0.2, 14), cloth, 0, 0.56, 0);
      cape.scale.z = 0.92;
      // wide sleeves, flaring at the cuff
      for (const a of this.arms) {
        add(a.pivot, cyl(0.085 * bulk, 0.1 * bulk, 0.29, 9), cloth, 0, -0.13, 0);
        add(a.elbow, cyl(0.092 * bulk, 0.125 * bulk, 0.27, 9), cloth, 0, -0.12, 0);
      }
      // the hood: a tall point over the whole head, and two slits where a face
      // would be. No emblem, no lettering — the anonymity is the costume.
      const hood = add(head, cone(0.163, 0.5, 12), cloth, 0, 0.17, 0);
      hood.scale.z = 0.94;
      add(head, cyl(0.15, 0.165, 0.12, 12), cloth, 0, -0.055, 0);        // the skirt of the hood
      for (const side of [-1, 1]) {
        const eye = add(head, box(0.036, 0.019, 0.02), slit, side * 0.043, 0.055, 0.129);
        eye.rotation.x = 0.08;
      }
    }

    // ---- finish --------------------------------------------------------
    this.blob = contactShadow(0.3);
    this.add(this.blob);

    // normalise to the requested height
    const target = opts.height || (female ? 1.82 : 1.95);
    const raw = 1.86;
    this.scale.setScalar(target / raw);

    // ~50 parts but only a dozen joints move: bake the parts riding each joint
    // into one mesh per material. Same silhouette, roughly a third of the draw
    // calls in every pass (shadows, main view, AO, road mirror).
    this.garments = garments;
    this.setGarment = (part, on) => {
      // `part` is "top", "bottom" or "all"; a costume registered as "all" comes
      // off with either of the first two, and `setGarment("all", …)` covers
      // everything registered. Returns how many merged meshes it actually
      // changed, so a clip can tell "she is bare" from "there was nothing to
      // take off" — which matters, because a rig whose chest IS skin has no
      // garment, and a clip that pretended otherwise would play a stripping
      // motion over a body that was already bare.
      const wanted = (g) => part === "all" || g.part === part;
      let changed = 0;
      this.traverse((o) => {
        if (!o.isMesh) return;
        for (const g of garments) {
          if (!wanted(g) || o.material !== g.material) continue;
          if (o.visible !== on) { o.visible = on; changed++; }
          break;
        }
      });
      return changed;
    };
    /** Put everything back on, whatever came off. */
    this.restoreWardrobe = () => { for (const g of garments) this.setGarment(g.part, true); };

    mergeRigid(this, [
      hips, waist, torso, head,
      ...this.arms.flatMap((a) => [a.pivot, a.elbow, a.hand]),
      ...this.legs.flatMap((l) => [l.pivot, l.knee, l.foot]),
    ]);

    this._meshes = [];
    this.traverse((o) => { if (o.isMesh && o !== this.blob) this._meshes.push(o); });

    // animation state
    this.anim = "idle";
    this.time = 0;
    this.phase = rnd() * Math.PI * 2;
    // A shared clock, for clips that are only meaningful in company: hand an
    // actor a `{ t }` somebody else owns and advances (a branch gives every
    // performer in the room the same one) and the `sync` number below runs off
    // that instead of its own `time`, which `play()` resets on every change.
    // Left null, `sync` is simply a solo number on its own clock.
    this.beatRef = null;
    // Set by a scene (act.js) that has laid this body down. `_poseClip` normally
    // zeroes the root's X and Z every frame so a clip can own them, which is
    // right standing up and quietly stood anybody lying down back up. A laid
    // body keeps its own root transform and the reset skips it.
    this.lie = false;
    this.finished = false;
    this.loop = true;
    // Set by weapons_3d.js every frame while something is in the hands:
    //   { kind: "pistol"|"long"|"melee", support: Vector3|null, aim: bool }
    // `support` is the weapon's foregrip in WORLD space — the left hand is
    // solved onto it. Null means "this weapon is carried one-handed".
    this.weaponHold = null;
    this._yaw = opts.yaw != null ? opts.yaw : 0;
    this.rotation.y = this._yaw;
    this._last = new THREE.Vector3().copy(this.position);
    this._speed = 0;
    this._faded = false;

    // `material.opacity = x` is how the enemy system fades a corpse out. Fan it
    // across every part — cloning first, so one dying Hoodrat doesn't fade the
    // whole crew through the shared material cache.
    const self = this;
    this._opacity = 1;
    this.material = {
      get opacity() { return self._opacity; },
      set opacity(v) {
        self._opacity = v;
        if (!self._faded) {
          self._faded = true;
          for (const m of self._meshes) {
            m.material = m.material.clone();
            m.material.transparent = true;
            m.material.depthWrite = false;
          }
        }
        for (const m of self._meshes) m.material.opacity = Math.max(0, v);
      },
    };
  }

  /** Sprite-compatible. The crew colour is already in the geometry. */
  setTint() {}

  /** Sprite-compatible no-op: a 3D actor turns to face where it is walking. */
  setFlip() {}

  /**
   * May an adult clip play on this actor? Two independent conditions, both
   * required: the rig knows how old this character is and it is past the floor,
   * AND the 18+ gate has been answered at the door. A caller cannot skip this by
   * setting `anim` directly — `play()` is the only way a clip is entered, and it
   * checks.
   */
  allowsAdultClip() {
    const age = this.userData && this.userData.age;
    if (typeof age !== "number" || !(age >= ADULT_CLIP_MIN_AGE)) return false;
    return typeof adultGate === "function" && adultGate() === true;
  }

  play(anim, { loop = true, force = false } = {}) {
    if (ADULT_CLIPS.has(anim) && !this.allowsAdultClip()) {
      // Fail closed and say so. An adult clip on an actor whose age is
      // unverified, or before the 18+ gate has been answered, is refused here
      // rather than trusted to every call site to have checked — the gate is a
      // property of the rig, not of the venue that happens to be casting.
      this.adultClipRefused = anim;
      return;
    }
    this.adultClipRefused = null;
    if (this.anim === anim && !force) return;
    this.anim = anim;
    this.loop = loop;
    this.time = 0;
    this.finished = false;
    if (anim === "death") this._deathKind = undefined;
  }

  update(dt) {
    this.time += dt;

    // measure our own travel so the gait matches the actual ground speed and
    // we face the way we are going — no changes needed in updateEnemy()
    const dx = this.position.x - this._last.x;
    const dz = this.position.z - this._last.z;
    const moved = Math.hypot(dx, dz);
    this._speed = dt > 0 ? moved / dt : 0;
    if (moved > 1e-4) {
      const want = Math.atan2(dx, dz);
      let d = want - this._yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this._yaw += d * Math.min(1, dt * 9);
    }
    this._last.copy(this.position);

    // The support-hand IK poses a shoulder with a quaternion (solveArm), while
    // every clip drives arms with Euler angles. Clear the quaternion before the
    // clip every frame, or a solve from a previous frame survives into one where
    // nothing re-solves it — a two-handed weapon swapped for a pistol, or the
    // weapon dropped entirely, would leave the off arm permanently warped.
    for (const a of this.arms) a.pivot.quaternion.identity();

    this._poseClip(dt);

    // ---- what the character is holding ----------------------------------
    // Runs AFTER the clip, never instead of it: walking, running and the dance
    // clips still drive the legs, hips and torso, and only the arms are taken
    // over so the weapon is held. This is the hook that makes a weapon part of
    // the character instead of a prop parked beside it.
    if (this.weaponHold) this.applyWeaponHold(dt);
  }

  /**
   * Every animation clip, one branch per `this.anim` — unchanged. Split out of
   * update() so the weapon hold can be layered on top of whatever pose the clip
   * produced, including the clips that return early.
   */
  _poseClip(dt) {
    const A = this.arms, L = this.legs;

    if (this.anim === "death") {
      // Nobody falls the same way twice: onto a side, backwards, or forwards onto the face — chosen once per body from its
      // own seed, and mirrored for the side fall. `finished` gates the fade in updateEnemy.
      // A hit lands first (the torso snaps back for a tenth of a second), the fall accelerates (ease-in, like a body, not a
      // door), the impact overshoots a hair and settles, and the corpse RESTS on the ground: the body pivots about its feet,
      // so it is lifted by its own thickness or it lies half under the floor.
      if (this._deathKind === undefined) {
        const r1 = (this.phase * 7.31) % 1, r2 = (this.phase * 3.17) % 1;
        this._deathKind = Math.floor(Math.abs(r1) * 3) % 3;
        this._deathSide = r2 < 0.5 ? 1 : -1;
      }
      const kind = this._deathKind, sd = this._deathSide;
      const tt = Math.min(1, this.time / 0.85);
      const fall = tt * tt * (3 - 2 * tt) * (0.35 + 0.65 * tt);                   // slow start, quick finish
      const settle = Math.sin(Math.min(1, Math.max(0, (this.time - 0.8) / 0.3)) * Math.PI) * 0.045;   // the bounce on impact
      const e = Math.min(1, fall) ;
      const flinch = Math.sin(Math.min(1, this.time / 0.12) * Math.PI) * (1 - e);
      this.rotation.y = this._yaw;
      this.rotation.order = kind === 0 ? "XYZ" : "YXZ";
      this.rotation.x = 0; this.rotation.z = 0;
      const ang = (Math.PI / 2) * 0.97 * e + settle;
      if (kind === 0) this.rotation.z = sd * ang;
      else this.rotation.x = (kind === 1 ? -1 : 1) * ang;
      this.position.y = (this.baseY || 0) + 0.15 * e;
      this.hips.position.y = 0.92 - e * 0.12;
      this.hips.rotation.set(0, 0, 0);
      this.torso.rotation.set(-flinch * 0.5 + (kind === 0 ? 0 : 0), e * 0.35 * sd, 0);
      L.forEach((l, i) => {
        const bent = i === (sd > 0 ? 0 : 1) ? 1 : 0.35;                             // one knee drawn up, the other trailing
        l.pivot.rotation.x = -e * (kind === 2 ? 0.1 : 0.55) * (i ? 0.7 : 1);
        l.pivot.rotation.z = (i ? 1 : -1) * e * 0.14;
        l.knee.rotation.x = e * (0.25 + 1.1 * bent);
        l.foot.rotation.x = 0;
      });
      A.forEach((a, i) => {
        if (kind === 1) { a.pivot.rotation.x = -e * 0.5; a.pivot.rotation.z = a.side * e * (0.7 + 0.25 * i); a.elbow.rotation.x = -e * 0.4; }   // sprawled on the back, palms up
        else if (kind === 2) { a.pivot.rotation.x = -e * (2.3 - 0.5 * i); a.pivot.rotation.z = a.side * e * 0.25; a.elbow.rotation.x = -e * 0.3; }   // reaching out ahead of the face
        else { a.pivot.rotation.x = e * (i === (sd > 0 ? 0 : 1) ? 1.1 : -0.7); a.pivot.rotation.z = a.side * e * 0.3; a.elbow.rotation.x = -e * 0.55; }
      });
      if (tt >= 1 && this.time > 1.05) this.finished = true;
      return;
    }

    // HAPPY HOGS' podium beat (crowd.js): drop onto hands and knees like the
    // animal, then hold it — a hog dancer working a pole is still a hog. Root
    // pitch does the tip-forward (the rig has no separate spine bone), knees
    // and elbows fold to plant "front legs," and the head comes back up level
    // so the snout faces the room instead of the floor.
    if (this.anim === "allfours") {
      const t = Math.min(1, this.time / 0.5);
      const e = t * t * (3 - 2 * t);
      this.rotation.order = "YXZ";
      this.rotation.x = e * 1.2;
      this.rotation.y = this._yaw;
      this.rotation.z = 0;
      this.hips.position.y = 0.92 - e * 0.5;
      this.hips.rotation.set(0, 0, 0);
      this.torso.rotation.set(0, 0, 0);
      this.head.rotation.x = -e * 0.4;
      for (const a of A) { a.pivot.rotation.x = e * 1.5; a.pivot.rotation.z = a.side * 0.1; a.elbow.rotation.x = -e * 0.8; }
      for (const l of L) { l.pivot.rotation.x = -e * 0.6; l.knee.rotation.x = e * 1.4; l.foot.rotation.x = 0; }
      
      if (t >= 1) {
        const crawl = this.time * 5.0;
        const s = Math.sin(crawl);
        const c = Math.cos(crawl);
        A[0].pivot.rotation.x += s * 0.3;
        A[1].pivot.rotation.x -= s * 0.3;
        L[0].pivot.rotation.x -= s * 0.3;
        L[1].pivot.rotation.x += s * 0.3;
        this.hips.position.y += Math.abs(c) * 0.05;
        this.torso.rotation.y = s * 0.1;
      }
      return;
    }

    this.rotation.order = "XYZ";
    if (!this.lie) { this.rotation.x = 0; this.rotation.z = 0; }
    this.rotation.y = this.lie ? (this.lieYaw != null ? this.lieYaw : this._yaw) : this._yaw;
    this.torso.rotation.z = 0;
    this.hips.position.y = 0.92;
    this.hips.rotation.set(0, 0, 0);       // only the dance clips below tip the pelvis
    this.head.rotation.set(0, 0, 0);

    if (this.anim === "attack") {
      // Improved bare-knuckle punch: winding up and throwing a hook, hip rotation
      const p = this.time * 6;
      const phase = p % Math.PI;
      const lead = Math.floor(p / Math.PI) % 2; // alternates arms
      const strike = Math.sin(phase);
      
      this.hips.rotation.y = (lead === 0 ? 0.3 : -0.3) * strike;
      this.head.rotation.y = -this.hips.rotation.y;
      
      A.forEach((a, i) => {
        const on = i === lead;
        // Winding up the hook, then throwing it
        a.pivot.rotation.x = on ? -1.0 * strike - 0.2 : -0.2;
        a.pivot.rotation.z = on ? a.side * (0.3 + strike * 0.4) : a.side * 0.2;
        a.pivot.rotation.y = on ? a.side * -0.5 * strike : 0;
        a.elbow.rotation.x = on ? -1.2 + strike * 0.6 : -1.0;
      });
      L.forEach((l) => { l.pivot.rotation.x = 0; l.knee.rotation.x = 0.08; });
    } else if (this.anim === "swing_bat") {
      // Two-handed baseball bat swing
      const p = Math.min(1, this.time * 2.5); // full swing takes ~0.4s
      // Windup -> Swing -> Follow through
      const swing = Math.sin(p * Math.PI);
      const follow = Math.max(0, p - 0.5) * 2; // 0 to 1 in second half
      
      this.hips.rotation.y = 0.8 - (p * 1.6);
      this.head.rotation.y = -this.hips.rotation.y * 0.5;
      
      // Both arms grab the bat on the right side and swing across to the left
      A.forEach((a) => {
        a.pivot.rotation.x = -1.2 + swing * 0.5;
        a.pivot.rotation.z = a.side * 0.3 - (p * 0.8);
        a.pivot.rotation.y = 1.0 - (p * 2.5);
        a.elbow.rotation.x = -0.5 - (1 - swing) * 0.5;
      });
      L.forEach((l) => { l.pivot.rotation.x = 0; l.knee.rotation.x = 0.1; });
      this.torso.rotation.y = this.hips.rotation.y * 0.5;
      return;
    }

    if (this.anim === "hurt") {
      const t = Math.min(1, this.time / 0.32);
      const k = Math.sin(t * Math.PI);
      this.torso.rotation.x = -k * 0.4;
      A.forEach((a) => { a.pivot.rotation.x = k * 0.7; a.elbow.rotation.x = -k * 1.1; });
      if (t >= 1 && !this.loop) this.finished = true;
      return;
    }

    this.torso.rotation.x = 0;

    if (this.anim === "twerk" || this.anim === "grind" || this.anim === "dance" || this.anim === "sit"
      || this.anim === "kiss" || this.anim === "ride" || this.anim === "moonwalk"
      || this.anim === "showboat" || this.anim === "cheer" || this.anim === "spin"
      || this.anim === "footwork" || this.anim === "lean" || this.anim === "pole"
      || this.anim === "pour" || this.anim === "polish" || this.anim === "serve"
      || this.anim === "barlean" || this.anim === "sync"
      // The adult set is listed by REGISTRY rather than by name, so a clip
      // added to ADULT_CLIPS cannot be silently left out of the dispatcher and
      // fall through to the idle pose — which is exactly what happened to all
      // ten of them the first time round.
      || ADULT_CLIPS.has(this.anim)) {
      this.position.y = this.baseY || 0;
      danceClip(this, dt);
      return;
    }

    if (this.anim === "aim" || this.anim === "shoot") {
      const recoil = this.anim === "shoot" ? Math.max(0, 1 - this.time / 0.15) : 0;
      this.torso.rotation.y = 0.4;
      
      // Right arm holds weapon
      A[1].pivot.rotation.x = -1.57 + recoil * 0.2;
      A[1].pivot.rotation.z = 0.1;
      A[1].elbow.rotation.x = -0.1 - recoil * 0.3;
      
      // Left arm supports
      A[0].pivot.rotation.x = -1.3;
      A[0].pivot.rotation.z = -0.4;
      A[0].elbow.rotation.x = -1.2;
      
      if (this._speed > 0.15) {
        const rate = THREE.MathUtils.clamp(this._speed * 1.9, 3, 13);
        this.phase += dt * rate;
        const s = Math.sin(this.phase);
        const c = Math.cos(this.phase);
        const amp = THREE.MathUtils.clamp(this._speed * 0.13, 0.18, 0.62);
        L.forEach((l, i) => {
          const d = i ? s : -s;
          l.pivot.rotation.x = d * amp;
          l.knee.rotation.x = Math.max(0, (i ? -c : c) * amp * 1.15) + 0.05;
          l.foot.rotation.x = -l.knee.rotation.x * 0.45;
        });
        this.position.y = (this.baseY || 0) + Math.abs(Math.sin(this.phase * 2)) * 0.022;
      } else {
        // Legs planted
        L.forEach((l) => { l.pivot.rotation.x = 0; l.knee.rotation.x = 0.1; l.foot.rotation.x = 0; });
        this.position.y = this.baseY || 0;
      }
      
      if (this.anim === "shoot" && this.time > 0.15) {
        this.anim = "aim"; // go back to aim after recoil
      }
      return;
    }

    if (this.anim === "walk" && this._speed > 0.15) {
      // stride scales with speed, so a wandering Hoodrat ambles and a charging
      // one runs, off the same clip
      const rate = THREE.MathUtils.clamp(this._speed * 1.9, 3, 13);
      this.phase += dt * rate;
      const s = Math.sin(this.phase);
      const c = Math.cos(this.phase);
      // A walk and a run are different gaits, not one clip played faster: as the ground speed climbs past ~3.6 m/s the body
      // pitches forward into it, the knees drive up, the elbows fold to ~90 degrees and the arms pump, the hips roll and the
      // shoulders counter-rotate, and the bounce gets bigger (`run` eases 0..1 so the change of gait is a lean, not a pop).
      const runT = THREE.MathUtils.clamp((this._speed - 3.6) / 3.4, 0, 1);
      this._run = (this._run || 0) + (runT - (this._run || 0)) * Math.min(1, dt * 6);
      const run = this._run;
      const amp = THREE.MathUtils.clamp(this._speed * 0.13, 0.18, 0.62) * (1 + run * 0.22);

      L.forEach((l, i) => {
        const d = i ? s : -s;
        l.pivot.rotation.x = d * amp;
        l.knee.rotation.x = Math.max(0, (i ? -c : c) * amp * (1.15 + run * 1.15)) + 0.05 + run * 0.12;
        l.foot.rotation.x = -l.knee.rotation.x * 0.45;
      });
      A.forEach((a, i) => {
        const d = i ? -s : s;
        a.pivot.rotation.x = d * amp * (0.75 + run * 0.55);
        a.pivot.rotation.z = a.side * (0.16 - run * 0.07);
        a.elbow.rotation.x = -0.3 - run * 0.95 - Math.max(0, d) * (0.45 + run * 0.35);
      });
      // weight: the hips roll over the planted foot (half the bob's frequency), the chest answers against them, and the body
      // sinks a touch at each footfall and rises through the passing pose
      this.hips.rotation.z = s * 0.045 * (1 - run * 0.4);
      this.hips.rotation.y = -s * 0.07 * (1 + run);
      this.torso.rotation.z = -this.hips.rotation.z * 1.15;
      this.torso.rotation.y = -s * 0.1 * (1 + run * 0.6) - this.hips.rotation.y * 0.5;
      this.torso.rotation.x = 0.03 + run * 0.24;
      this.hips.position.y = 0.92 - (1 - Math.abs(c)) * 0.02 * (1 + run * 1.5);
      // `baseY` is the floor this actor stands on (0 = the ground); story
      // scenes set it for rooms that aren't at ground level
      this.position.y = (this.baseY || 0) + Math.abs(c) * (0.012 + run * 0.03);
      return;
    }
    this._run = 0;

    // idle: slow breathing sway, arms loose, the reference's folded-arm stance
    const b = Math.sin(this.time * 1.6 + this.phase);
    L.forEach((l) => { l.pivot.rotation.x = 0; l.knee.rotation.x = 0.05; l.foot.rotation.x = 0; });
    A.forEach((a, i) => {
      a.pivot.rotation.x = -0.05 + b * 0.025;
      a.pivot.rotation.z = a.side * (0.13 + b * 0.015);
      a.elbow.rotation.x = -0.3 - (i ? 0.05 : 0);
    });
    this.torso.rotation.y = b * 0.045;
    this.position.y = this.baseY || 0;
  }

  /**
   * The weapon-hold overlay. Called after every clip (see update()) whenever
   * something is in the hands, so the character holds it in every state — idle,
   * walking, running, aiming — without a second copy of the walk cycle for each
   * weapon class.
   *
   * `this.weaponHold` is set by weapons_3d.js:
   *   kind     "pistol" (one hand), "long" (two hands), "melee"
   *   support  the weapon's foregrip in WORLD space, or null for one-handed
   *
   * The gun hand is posed by fixed numbers per kind — it is the anchor the
   * weapon hangs off. The support hand is solved onto the foregrip, so it lands
   * on the weapon whatever its length: a Tec-9 and a deer rifle hold differently
   * because the weapons are different sizes, not because anything is hardcoded
   * per weapon here.
   */
  applyWeaponHold(dt = 0) {
    const h = this.weaponHold;
    const right = this.rightArm, left = this.leftArm;
    if (!h || !right || !left) return;

    // Carry → aim is smoothed, so raising the weapon is a movement instead of a
    // pose swap. Melee never aims: a bat is not sighted.
    const want = h.aim && h.kind !== "melee" ? 1 : 0;
    if (this._holdAim == null) this._holdAim = want;
    this._holdAim += (want - this._holdAim) * Math.min(1, dt * 9);
    const a = this._holdAim;

    const pose = HOLD_POSES[h.kind] || HOLD_POSES.pistol;
    const carry = pose.carry, aim = pose.aim;
    let hx = carry.hand[0] + (aim.hand[0] - carry.hand[0]) * a;
    let hy = carry.hand[1] + (aim.hand[1] - carry.hand[1]) * a;
    let hz = carry.hand[2] + (aim.hand[2] - carry.hand[2]) * a;
    let blade = pose.blade.carry + (pose.blade.aim - pose.blade.carry) * a;

    // ---- the melee swing -------------------------------------------------
    // A bat swing is an ARM animation, not a weapon animation: the bat is
    // welded to the fist (weapons_3d.js), so driving the arm is what swings it,
    // and it cannot come loose halfway through no matter how fast the player
    // turns. This moves the FIST — the bat's own angle is swept in
    // weapons_3d.js, so the two together read as one swing.
    //
    // `attack` is the attack's progress, 0 → 1, shaped as two overlapping lobes
    // so the pose starts and ends at the shoulder with no pop: `windUp` cocks
    // it back, then `strike` drives it forward and down. (sin is 0 at both ends
    // of each lobe, so this is continuous with the idle hold that follows.)
    if (h.attack > 0) {
      const u = h.attack;
      const windUp = Math.sin(Math.min(1, u / 0.28) * Math.PI);
      const strike = u <= 0.28 ? 0 : Math.sin(((u - 0.28) / 0.72) * Math.PI);
      hx += -0.04 * windUp + 0.14 * strike;
      hy += 0.04 * windUp - 0.12 * strike;
      hz += -0.08 * windUp + 0.24 * strike;
      blade += -0.30 * windUp + 0.60 * strike;          // the whole torso turns into it
    }

    // A bladed stance: rotation.y positive swings the −x (right) side forward on
    // a body that faces +z, so the gun shoulder comes round toward the target.
    this.torso.rotation.y = blade;
    // keep the head on the target rather than the weapon
    this.head.rotation.y = -blade * 0.75;

    // The gun arm itself is SOLVED onto that hand target rather than posed by
    // angles: the weapon is attached to this hand, so putting the hand where the
    // pose says is the same thing as putting the weapon where it should be.
    const P = right.pivot.position;
    _ikTarget.set(P.x + hx, P.y + hy, P.z + hz);
    solveArm(right, _ikTarget, _ikPole.set(carry.pole[0], carry.pole[1], carry.pole[2]));

    if (h.kind === "long" && h.support) {
      // torso.worldToLocal needs the world matrices, which the caller refreshed
      // after posing the gun arm and placing the weapon.
      _ikTarget.copy(h.support);
      this.torso.worldToLocal(_ikTarget);
      solveArm(left, _ikTarget, _ikPole.set(left.side * 0.6, -1, -0.15));
    } else {
      // off hand: low and loose, or steadying nothing in particular
      left.pivot.rotation.set(-0.5, 0, left.side * 0.3);
      left.elbow.rotation.x = -1.05;
    }
  }
}

// --------------------------------------------------------------- club clips
// The nightlife clips (nightlife.js). Leg rig: the thighs hang from the hips, the
// shins from the knees (0.44 m each). A squat with the thigh `th` radians forward
// and the knee bent 2·th keeps the foot under the hip, and the hip drops// 0.88·(1 − cos th). When the pelvis is tipped (`h`), the thighs take −h so the
// legs don't swing with it, and the torso takes (lean − h) so the chest holds
// its angle while only the hips move — that isolation is the whole dance.
function squat(r, th, h) {
  r.hips.position.y = 0.92 - 0.88 * (1 - Math.cos(th));
  r.hips.rotation.x = h;
  for (const l of r.legs) {
    l.pivot.rotation.x = -th - h;
    l.knee.rotation.x = 2 * th;
    l.foot.rotation.x = -th;
  }
}
// ---- THE NUMBER (`sync`) -----------------------------------------------------
// Eight counts of group choreography, in seconds per count. Data, for the same
// reason crowd.js's ACT_SCRIPT is: re-choreographing a show is editing eight
// numbers, not rewriting a clip.
//
//   sq     thigh angle into `squat` (0 standing, 0.9 a deep squat)
//   hip    pelvis tilt out in front of the thighs
//   lean   torso pitch — positive is folded forward, negative is the arch
//   twist  torso yaw, the shoulders against the hips
//   arm    per side: [shoulder pitch, shoulder spread, elbow]
//   head / headY   the chin, and the look
//
// The order is the order a number is called: open, the sweep down, the roll,
// the dip, the twist, the arch, the turn, the freeze.
const SYNC_COUNT = 1.15;
const SYNC_POSES = [
  { sq: 0.14, hip: 0.02, lean: -0.10, twist: 0,     arm: [[-2.75, 0.5], [-2.75, 0.5]], head: -0.30, headY: 0 },      // 1 arms up, chest open
  { sq: 0.30, hip: 0.14, lean: 0.46,  twist: 0.10,  arm: [[-0.20, 0.75], [-0.20, 0.75]], head: 0.34, headY: 0 },    // 2 hands sweep down the body
  { sq: 0.44, hip: -0.22, lean: -0.34, twist: -0.20, arm: [[-0.85, 0.3], [-0.85, 0.3]], head: -0.44, headY: 0.2 },  // 3 the roll, back arched
  { sq: 0.86, hip: 0.06, lean: 0.60,  twist: 0,     arm: [[-0.40, 1.2], [-0.40, 1.2]], head: -0.12, headY: 0 },    // 4 the dip, arms wide
  { sq: 0.52, hip: 0.30, lean: 0.28,  twist: 0.46,  arm: [[-1.15, 0.18], [-1.15, 0.18]], head: 0.18, headY: -0.3 },  // 5 the twist, hips out
  { sq: 0.34, hip: -0.12, lean: -0.44, twist: 0.24, arm: [[-2.5, 0.15, -1.5], [-0.35, 1.0, -0.2]], head: -0.6, headY: 0.1 }, // 6 the arch, one hand behind the head
  { sq: 0.32, hip: 0, lean: 0.08, twist: 0,          arm: [[-1.0, 1.35], [-1.0, 1.35]], head: -0.10, headY: 0 },    // 7 the turn (whole revolution)
  { sq: 0.48, hip: 0.20, lean: -0.22, twist: 0.16,  arm: [[-1.55, 0.85, -0.9], [-1.55, 0.85, -0.9]], head: -0.5, headY: 0.25 }, // 8 the freeze, held
];
const SYNC_COUNT_POSES = SYNC_POSES.length;
// The strip is an eight-count like the number, so the two sit on the same clock
// and a stage running both keeps its timing.
const STRIP_COUNT = 1.15;

function danceClip(r, dt) {
  const A = r.arms, t = r.time;
  if (r.anim === "pole") {
    // THE POLE (the clubs' stage: crowd.js's `performer`, and anybody cast on a
    // stage with poles). Both hands up on the bar and locked, the body pressed
    // into it, the inside leg wrapped and hooked while the outside one points
    // and finds the floor: a slow climb, a freeze at the top, and the turn back
    // down — which is also the revolution, because the whole body goes round the
    // bar on the way. Nothing here walks her anywhere; `baseY` is the deck the
    // stage fixture put her on, and the climb is measured up from it.
    const p = t * Math.PI * 2 * 0.34 + r.phase;
    const climb = 0.5 - 0.5 * Math.cos(p);                 // 0 at the floor, 1 at the freeze
    const spin = Math.sin(p * 0.5);
    r.position.y = (r.baseY || 0) + climb * 0.3;            // she goes up the pole
    r.hips.position.y = 0.92;
    r.hips.rotation.set(0, spin * 0.4, 0);
    r.torso.rotation.set(0.1 - climb * 0.24, spin * 0.3, -spin * 0.14);
    // The head is a real joint now (it was baked into the torso until the rig
    // pass), so this line is visible for the first time: a mild chin-up that
    // opens as she climbs, looking out at the room rather than at the bar.
    // Worth a look in-game — it has never actually been seen before.
    r.head.rotation.set(-0.10 - climb * 0.10, spin * 0.22, 0);
    A.forEach((a) => {                                     // up on the bar, elbows soft
      a.pivot.rotation.x = -2.78 + climb * 0.2;
      a.pivot.rotation.z = a.side * (0.15 + climb * 0.09);
      a.elbow.rotation.x = -0.26 - climb * 0.4;
    });
    const wrap = 0.5 + climb * 0.9;                        // the wrapped leg, hooked
    r.legs[0].pivot.rotation.set(-wrap, 0, 0.24);
    r.legs[0].knee.rotation.x = wrap * 1.55;
    r.legs[0].foot.rotation.x = -0.55;
    r.legs[1].pivot.rotation.set(-climb * 0.6, 0, -0.14); // the free leg, pointing
    r.legs[1].knee.rotation.x = climb * 0.95;
    r.legs[1].foot.rotation.x = -climb * 0.75;
    // the turn. The rig turns to face its own travel (see `_yaw` in update), and
    // a dancer is not travelling, so the revolution is driven here — through
    // `_yaw` as well as `rotation.y`, so nothing snaps her back round when the
    // clip hands over to a walk.
    if (r._poleYaw === undefined) r._poleYaw = r._yaw;
    r._yaw = r._poleYaw + t * Math.PI * 2 * 0.2;
    r.rotation.y = r._yaw;
    return;
  }
  if (r.anim === "moonwalk") {
    // THE GLIDE (BILLY JEANS, the Crown Strip's act). The whole trick is that
    // the feet do not step: both stay flat on the floor while the body slides
    // *backwards*, the lead leg straight and skating, the trailing leg dragged
    // with the toe pointed. crowd.js moves the actor; this holds the pose, so it
    // reads as a moonwalk and not as walking backwards.
    const p = t * Math.PI * 2 * 1.15 + r.phase;
    squat(r, 0.06, 0);
    r.hips.rotation.z = 0;
    r.torso.rotation.set(0.15, Math.sin(p) * 0.16, 0);      // weight back, chest up
    r.head.rotation.set(-0.08, Math.sin(p * 0.5) * 0.28, 0);
    const kick = Math.sin(p) * 0.13;
    r.legs[0].pivot.rotation.x = -0.5 + kick;               // lead leg out in front
    r.legs[0].knee.rotation.x = 0.06;
    r.legs[0].foot.rotation.x = 0.42;                       // flat: it is sliding
    r.legs[1].pivot.rotation.x = 0.34 - kick;               // trailing leg dragged back
    r.legs[1].knee.rotation.x = 0.42;
    r.legs[1].foot.rotation.x = -0.6;                       // toe pointed down
    r.arms[0].pivot.rotation.set(-2.15, 0, 0.42);           // gloved hand at the mic
    r.arms[0].elbow.rotation.x = -1.35;
    r.arms[1].pivot.rotation.set(-0.4 + Math.sin(p) * 0.22, 0, 0.32);
    r.arms[1].elbow.rotation.x = -0.55;
    return;
  }
  if (r.anim === "showboat") {
    // the stage pose (makeStar): gloved hand up at the mouth, free hand out,
    // hips cocked, one heel up, chin up and working the crowd. Held — this is
    // the pose the act freezes in, and the one the crowd cheers at.
    const p = t * 1.15 + r.phase;
    r.hips.position.y = 0.92;
    r.hips.rotation.set(0, 0, 0.07);
    r.torso.rotation.set(0.02, Math.sin(p) * 0.22, -0.05);
    r.head.rotation.set(-0.14, Math.sin(p * 0.7) * 0.32, 0);
    r.legs[0].pivot.rotation.x = -0.05; r.legs[0].knee.rotation.x = 0.05; r.legs[0].foot.rotation.x = 0;
    r.legs[1].pivot.rotation.x = -0.2; r.legs[1].knee.rotation.x = 0.3; r.legs[1].foot.rotation.x = -0.34;
    r.arms[0].pivot.rotation.set(-2.55, 0, 0.5);
    r.arms[0].elbow.rotation.x = -1.3;
    r.arms[1].pivot.rotation.set(-0.5, 0, 0.55);
    r.arms[1].elbow.rotation.x = -0.7;
    return;
  }
  if (r.anim === "spin") {
    // the pirouette: weight on one foot, the other crossed behind it, arms out
    // level, chin up. The TURN is the act's (crowd.js drives `_yaw` through whole
    // revolutions); this is only the body that goes round.
    const p = t * 1.5;
    r.hips.position.y = 0.92 + Math.sin(p * 2) * 0.012;
    r.hips.rotation.z = 0;
    r.torso.rotation.set(0, 0, 0);
    r.head.rotation.set(-0.12, 0, 0.08);
    r.legs[0].pivot.rotation.x = -0.06; r.legs[0].knee.rotation.x = 0.2; r.legs[0].foot.rotation.x = -0.18;
    r.legs[1].pivot.rotation.x = 0.2; r.legs[1].knee.rotation.x = 0.62; r.legs[1].foot.rotation.x = -0.5;
    r.arms.forEach((a, i) => {
      a.pivot.rotation.set(-0.2, 0, a.side * (1.28 - i * 0.34));
      a.elbow.rotation.x = -0.12 - i * 0.1;
    });
    return;
  }
  if (r.anim === "footwork") {
    // the staccato: both feet doing small quick work under him, ~3.2 a second,
    // knees soft, weight low, hands tucked in and counter-swinging. Fast enough
    // that the eye reads it as a dance step rather than a walk.
    const p = t * Math.PI * 2 * 3.2 + r.phase;
    const s = Math.sin(p);
    squat(r, 0.3, 0.1);
    r.torso.rotation.set(0.3, s * 0.22, 0);
    r.head.rotation.set(-0.1, -s * 0.24, 0);
    r.legs[0].pivot.rotation.x = -0.3 - s * 0.42;
    r.legs[0].knee.rotation.x = 0.6 + Math.max(0, -s) * 0.55;
    r.legs[0].foot.rotation.x = -0.22 + Math.max(0, -s) * 0.5;
    r.legs[1].pivot.rotation.x = -0.3 + s * 0.42;
    r.legs[1].knee.rotation.x = 0.6 + Math.max(0, s) * 0.55;
    r.legs[1].foot.rotation.x = -0.22 + Math.max(0, s) * 0.5;
    r.arms.forEach((a, i) => {
      const d = i ? -s : s;
      a.pivot.rotation.set(-0.85 + d * 0.3, 0, a.side * 0.34);
      a.elbow.rotation.x = -1.15 - Math.max(0, d) * 0.35;
    });
    return;
  }
  if (r.anim === "lean") {
    // THE LEAN: heels down, pelvis driven out past the toes, chest 40° past
    // vertical and the head turned up at the crowd — the pose that made the
    // sequin jacket famous. Legs counter-rotate by exactly the pelvis angle
    // (the convention `squat` documents) so the feet stay under the body and
    // only the body goes over: an anti-gravity lean, not a stumble.
    const p = t * 1.4;
    r.hips.position.y = 0.9;
    r.hips.rotation.x = 0.42;
    for (const l of r.legs) { l.pivot.rotation.x = -0.42; l.knee.rotation.x = 0.1; l.foot.rotation.x = 0.42; }
    r.torso.rotation.set(0.34, 0, 0);
    r.head.rotation.set(-0.5, 0, 0.1);
    r.arms[1].pivot.rotation.set(-1.15, 0, r.arms[1].side * 1.18 + Math.sin(p) * 0.06);
    r.arms[1].elbow.rotation.x = 0.06;
    r.arms[0].pivot.rotation.set(-2.3, 0, r.arms[0].side * 0.32);       // gloved hand on the hat
    r.arms[0].elbow.rotation.x = -1.55;
    return;
  }
  if (r.anim === "pour") {
    // the bottle in the gun hand, the glass under it: the pouring wrist is the
    // elbow's roll, so the bottle tips over the glass and comes back up
    const p = t * 1.15 + r.phase;
    r.hips.position.y = 0.92;
    r.hips.rotation.set(0, 0, 0);
    r.torso.rotation.set(0.12, 0.24, 0);
    r.head.rotation.set(0.16, -0.18, 0);      // watching the glass, not the room
    r.legs[0].pivot.rotation.x = -0.05; r.legs[0].knee.rotation.x = 0.08; r.legs[0].foot.rotation.x = 0;
    r.legs[1].pivot.rotation.x = 0.05; r.legs[1].knee.rotation.x = 0.12; r.legs[1].foot.rotation.x = 0;
    r.arms[0].pivot.rotation.set(-1.15, 0, r.arms[0].side * 0.3);
    r.arms[0].elbow.rotation.set(-1.25, 0, -0.45 - Math.sin(p) * 0.3);
    r.arms[1].pivot.rotation.set(-0.95, 0, r.arms[1].side * 0.42);
    r.arms[1].elbow.rotation.set(-1.35, 0, Math.sin(p) * 0.12);
    return;
  }
  if (r.anim === "polish") {
    // the glass and the cloth: both hands on the bar top in a small circle
    const p = t * 2.6 + r.phase;
    r.hips.position.y = 0.92;
    r.hips.rotation.set(0, 0, 0);
    r.torso.rotation.set(0.16, 0, 0);
    r.head.rotation.set(-0.24, Math.sin(p * 0.5) * 0.2, 0);
    r.legs[0].pivot.rotation.x = 0; r.legs[0].knee.rotation.x = 0.06; r.legs[0].foot.rotation.x = 0;
    r.legs[1].pivot.rotation.x = 0; r.legs[1].knee.rotation.x = 0.06; r.legs[1].foot.rotation.x = 0;
    r.arms.forEach((a, i) => {
      a.pivot.rotation.set(-1.0 + Math.sin(p + i * 2.1) * 0.07, 0, a.side * 0.3 + Math.cos(p + i * 2.1) * 0.05);
      a.elbow.rotation.set(-1.3, 0, 0);
    });
    return;
  }
  if (r.anim === "serve") {
    // the drink goes across the counter, on the flat of the hand, and comes back
    const p = Math.max(0, Math.sin(t * 1.1)) * 0.55;
    r.hips.position.y = 0.92;
    r.hips.rotation.set(0, 0, 0);
    r.torso.rotation.set(0.08, 0.14, 0);
    r.head.rotation.set(-0.06, -0.1, 0);
    r.legs[0].pivot.rotation.x = 0; r.legs[0].knee.rotation.x = 0.06; r.legs[0].foot.rotation.x = 0;
    r.legs[1].pivot.rotation.x = 0; r.legs[1].knee.rotation.x = 0.06; r.legs[1].foot.rotation.x = 0;
    r.arms[0].pivot.rotation.set(-1.05 - p * 0.5, 0, r.arms[0].side * 0.22);
    r.arms[0].elbow.rotation.set(-0.85 + p * 0.6, 0, 0);
    r.arms[1].pivot.rotation.set(-0.6, 0, r.arms[1].side * 0.34);
    r.arms[1].elbow.rotation.set(-1.15, 0, 0);
    return;
  }
  if (r.anim === "barlean") {
    // elbows on the counter, chin on the fist, eyes on the room — the pose every
    // bar in the world has somebody in, and the break between two drinks
    const p = t * 0.7 + r.phase;
    r.hips.position.y = 0.92;
    r.hips.rotation.set(0, 0, 0);
    // the slow scan of the room is the *torso*'s: the head is not a merge joint,
    // so it cannot turn on its own (see the note at `this.head`)
    r.torso.rotation.set(0.26, Math.sin(p) * 0.34, 0);
    r.head.rotation.set(-0.1, Math.sin(p) * 0.42, 0.06);
    r.legs[0].pivot.rotation.x = -0.12; r.legs[0].knee.rotation.x = 0.3; r.legs[0].foot.rotation.x = -0.18;
    r.legs[1].pivot.rotation.x = 0.1; r.legs[1].knee.rotation.x = 0.14; r.legs[1].foot.rotation.x = 0;
    r.arms[0].pivot.rotation.set(-1.35, 0, r.arms[0].side * 0.34);
    r.arms[0].elbow.rotation.set(-1.5, 0, 0);
    r.arms[1].pivot.rotation.set(-0.95, 0, r.arms[1].side * 0.5);
    r.arms[1].elbow.rotation.set(-1.6, 0, 0);
    return;
  }
  if (r.anim === "cheer") {
    // the crowd, when the act lands a move: both arms up, bouncing on the beat
    const p = t * Math.PI * 2 * 1.7 + r.phase;
    const up = Math.abs(Math.sin(p));
    squat(r, 0.1 + up * 0.1, 0);
    r.torso.rotation.set(0, Math.sin(p * 0.5) * 0.2, 0);
    r.head.rotation.set(-0.24, 0, 0);
    r.arms.forEach((a) => {
      a.pivot.rotation.set(-2.7 + up * 0.25, 0, a.side * 0.4);
      a.elbow.rotation.x = -0.22;
    });
    r.position.y = (r.baseY || 0) + up * 0.045;
    return;
  }
  if (r.anim === "twerk") {
    // THE NOLA BOUNCE. Four pops to the bar and a drop on the one: the hips
    // lead every pop, the chest holds its angle over them (that isolation is
    // what `squat` exists to keep honest), and the hands go from the knees to
    // the floor on the drop so the low beat has a low shape under it. The
    // sideways travel underneath is the figure of eight — a bounce alone reads
    // as a squat, and a squat is what every other woman in the room is doing.
    const clock = r.beatRef && typeof r.beatRef.t === "number" ? r.beatRef.t : t;
    const POPS = 3.4;                                  // pops a second
    const q = clock * POPS;
    const onOne = Math.floor(q) % 4 === 0;
    const pop = Math.pow(Math.max(0, Math.sin(q * Math.PI)), 0.55);   // a hit, not a swell
    const eight = Math.sin(clock * Math.PI * 2 * 1.7);
    const h = 0.12 + pop * (onOne ? 0.5 : 0.3) + eight * 0.1;
    squat(r, 0.78 + pop * (onOne ? 0.3 : 0.1), h);
    r.hips.rotation.z = eight * 0.13;                 // the eight travels across
    r.torso.rotation.x = 0.72 - h;                     // chest stays out over the hips
    r.torso.rotation.y = eight * 0.16;
    r.torso.rotation.z = -eight * 0.08;
    A.forEach((a) => {
      // hands to the knees through the beat, and on the drop straight down past
      // them with the elbows out — the low beat has to have a low shape
      const knees = 0.95 + pop * 0.2;
      a.pivot.rotation.x = onOne ? -0.4 - pop * 0.15 : -knees;
      a.pivot.rotation.z = a.side * (onOne ? 0.5 : 0.12);
      a.elbow.rotation.x = -0.3 - pop * 0.25;
    });
    // the look: chin up, whipping over one shoulder and back, alternating bars
    r.head.rotation.x = -0.32;
    r.head.rotation.y = Math.sin(clock * Math.PI * 2 * 0.85) * 0.5;
    return;
  }
  if (r.anim === "grind") {
    // THE GRIND. Slow, deep and deliberate, where the twerk is fast and sharp:
    // a figure of eight at a quarter of the bounce's rate, the chest arching
    // back over it, one hand behind the head and the other out on the rail.
    const clock = r.beatRef && typeof r.beatRef.t === "number" ? r.beatRef.t : t;
    const p = clock * Math.PI * 2 * 0.8;
    const sway = Math.sin(p), depth = Math.cos(p);
    squat(r, 0.5 + Math.abs(sway) * 0.08, 0.06 + sway * 0.1);
    r.hips.rotation.z = sway * 0.2;                   // the eight, left to right
    r.hips.rotation.x = 0.1 + depth * 0.1;
    r.torso.rotation.x = -0.12 + depth * 0.2;          // arches back on the top
    r.torso.rotation.z = -sway * 0.15;
    r.torso.rotation.y = Math.sin(p * 0.5) * 0.12;
    A[0].pivot.rotation.x = -2.6;                      // one hand behind the head
    A[0].pivot.rotation.z = -0.45;
    A[0].elbow.rotation.x = -1.6;
    A[1].pivot.rotation.x = -0.45 + sway * 0.18;       // the other out on the rail
    A[1].pivot.rotation.z = 0.5;
    A[1].elbow.rotation.x = -0.35;
    r.head.rotation.x = -0.2 + depth * 0.1;
    r.head.rotation.z = sway * 0.2;
    return;
  }
  if (r.anim === "sync") {
    // THE NUMBER. Eight counts, every performer in the room on the same clock
    // (see `beatRef` in the constructor), so a whole cast moves as one body:
    // somebody who wanders onto the floor halfway through joins it mid-number
    // rather than starting a routine of their own.
    //
    // It is data for the reason ACT_SCRIPT is (crowd.js): re-choreographing a
    // show is editing eight numbers, not rewriting a clip. Each is a held pose,
    // hit exactly on the count and eased into over the first fifth of it — the
    // ease is what keeps it dance rather than a flip-book.
    const clock = r.beatRef && typeof r.beatRef.t === "number" ? r.beatRef.t : t;
    const n = clock / SYNC_COUNT;
    const count = ((Math.floor(n) % SYNC_COUNT_POSES) + SYNC_COUNT_POSES) % SYNC_COUNT_POSES;
    const u = n - Math.floor(n);
    const from = SYNC_POSES[count], to = SYNC_POSES[(count + 1) % SYNC_POSES.length];
    const e = u < 0.2 ? (u / 0.2) * (u / 0.2) * (3 - 2 * (u / 0.2)) : 1;
    const m = (a, b) => a + (b - a) * e;
    // ...and a groove underneath the count, so she is never a statue between
    // the numbers: a slow sway across the hips and a breath on the rise.
    const groove = Math.sin(clock * Math.PI * 2 * 1.7);
    squat(r, m(from.sq, to.sq) + Math.abs(groove) * 0.04, m(from.hip, to.hip));
    r.hips.rotation.z = groove * 0.11;
    r.torso.rotation.x = m(from.lean, to.lean);
    r.torso.rotation.y = m(from.twist, to.twist) + groove * 0.08;
    r.torso.rotation.z = -groove * 0.09;
    A.forEach((a, i) => {
      const f = from.arm[i], g = to.arm[i];
      a.pivot.rotation.x = m(f[0], g[0]);
      a.pivot.rotation.z = a.side * m(f[1], g[1]);
      a.elbow.rotation.x = m(f[2] || 0, g[2] || 0);
    });
    r.head.rotation.x = m(from.head, to.head);
    r.head.rotation.y = m(from.headY, to.headY) + groove * 0.12;
    r.position.y = (r.baseY || 0) + (groove * 0.5 + 0.5) * 0.02;
    // count 7 is the turn, and it is everybody's turn at the same moment: the
    // yaw is captured on the first frame of the count and driven a whole
    // revolution across it, exactly as the pole clip does (a dancer is not
    // travelling, so nothing else would turn her).
    if (count === 6) {
      if (r._syncCount !== 6) r._syncYaw = r._yaw;
      r._yaw = r._syncYaw + e * Math.PI * 2;
      r.rotation.y = r._yaw;
    }
    r._syncCount = count;
    return;
  }
  if (r.anim === "dance") {
    // the floor: knees bouncing on the beat, arms up and waving, a twist
    const p = t * Math.PI * 2 * 1.9 + r.phase;
    squat(r, 0.16 + Math.abs(Math.sin(p)) * 0.14, 0);
    r.torso.rotation.y = Math.sin(p * 0.5) * 0.35;
    A.forEach((a, i) => {
      const up = Math.sin(p + i * Math.PI) > 0;
      a.pivot.rotation.x = up ? -2.6 : -1.2;
      a.pivot.rotation.z = a.side * (0.3 + Math.sin(p * 0.5) * 0.15);
      a.elbow.rotation.x = up ? -0.3 : -1.1;
    });
    r.head.rotation.x = Math.sin(p) * 0.12;
    return;
  }
  if (r.anim === "ride") {
    // astride a bike (bikes.js): hips on the seat (main.js sets rideHip / rideLean
    // from the bike's definition), knees up to the pegs, hands on the bars
    r.hips.position.y = r.rideHip || 0.9;
    for (const l of r.legs) { l.pivot.rotation.x = -1.05; l.knee.rotation.x = 1.25; l.foot.rotation.x = -0.2; }
    r.torso.rotation.x = (r.rideLean != null ? r.rideLean : 0.3) + Math.sin(t * 1.9 + r.phase) * 0.012;
    r.torso.rotation.z = Math.sin(t * 0.8 + r.phase) * 0.02;
    r.hips.position.y += Math.sin(t * 3.1 + r.phase) * 0.004;
    A.forEach((a) => { a.pivot.rotation.x = -1.2 - (r.rideLean || 0) * 0.6; a.pivot.rotation.z = a.side * 0.16; a.elbow.rotation.x = -0.35; });
    return;
  }
  if (r.anim === "sit") {
    // in the chair (the lap-dance seat): thighs level, shins down, hands on the knees
    r.hips.position.y = 0.52;
    for (const l of r.legs) { l.pivot.rotation.x = -1.5; l.knee.rotation.x = 1.5; l.foot.rotation.x = 0; }
    r.torso.rotation.x = -0.12;
    A.forEach((a) => { a.pivot.rotation.x = -0.75; a.pivot.rotation.z = a.side * 0.18; a.elbow.rotation.x = -0.55; });
    return;
  }
  if (r.anim === "stripTease") {
    // THE STRIP. Eight counts: the hem, the pull, the garment over her head, and
    // the rest of the number danced bare. The hips never stop moving underneath
    // it — a strip that stops dancing is a strip that has stopped.
    //
    // The garment comes off on count 4 (`r.setGarment`, characters.js), which is
    // a visibility toggle on the merged mesh that carries its material: the rig
    // has no second body hidden underneath, and it does not need one, because
    // there is nothing under a bikini but the bust and the pelvis already there.
    const clock = r.beatRef && typeof r.beatRef.t === "number" ? r.beatRef.t : t;
    const n = (clock / STRIP_COUNT) % 8;
    const count = Math.floor(n), u = n - count;
    const groove = Math.sin(clock * Math.PI * 2 * 1.7);
    const pull = count < 4 ? 0 : count === 4 ? u : 1;      // 0 dressed, 1 bare
    squat(r, 0.42 + Math.abs(groove) * 0.08, groove * 0.12);
    r.hips.rotation.z = groove * 0.14;
    r.waist.rotation.y = groove * 0.16;                    // the new lower back
    r.torso.rotation.x = 0.1 - pull * 0.16 + groove * 0.06;
    r.torso.rotation.y = -groove * 0.12;
    r.head.rotation.x = -0.12 - pull * 0.2;
    r.head.rotation.y = groove * 0.2;
    A.forEach((a, i) => {
      const s = a.side;
      if (pull < 0.05) {
        // hands at the hem, one on each hip, working it loose
        a.pivot.rotation.set(-0.55, 0, s * (0.3 + groove * 0.08));
        a.elbow.rotation.x = -1.15;
        a.hand.rotation.set(0, 0, s * 0.3);
      } else if (pull < 0.98) {
        // both arms up and over: the garment goes over her head on the way
        const over = Math.sin(pull * Math.PI);
        a.pivot.rotation.set(-2.5 - pull * 0.35, 0, s * (0.5 - pull * 0.28));
        a.elbow.rotation.x = -0.5 - over * 0.8;
        a.hand.rotation.set(-0.5 * over, 0, 0);
      } else {
        // bare: both arms out and up, chest open, still moving
        a.pivot.rotation.set(-2.55, 0, s * (0.62 + groove * 0.1));
        a.elbow.rotation.x = -0.25;
        a.hand.rotation.set(0, 0, s * 0.2);
      }
    });
    if (count === 4 && u < 0.5) r.setGarment("all", false);
    return;
  }
  if (r.anim === "flash") {
    // THE FLASH. Both hands under the bust, lifting and presenting it on the
    // beat, chin down so the eyes come up over the top of it, and dropped at the
    // end of every phrase — the whole read is the hold, and a hold that never
    // releases is not a flash, it is a pose.
    const clock = r.beatRef && typeof r.beatRef.t === "number" ? r.beatRef.t : t;
    const p = clock * Math.PI * 2 * 1.7;
    const hold = Math.max(0, Math.sin(p));
    const lift = Math.pow(hold, 0.5);
    squat(r, 0.3 + lift * 0.14, 0);
    r.waist.rotation.x = -lift * 0.1;                      // a small arch under it
    r.hips.rotation.z = Math.sin(p * 0.5) * 0.1;
    r.torso.rotation.x = 0.04 - lift * 0.12;
    r.torso.rotation.y = Math.sin(p * 0.5) * 0.14;
    r.head.rotation.x = -0.08 - lift * 0.34;               // chin down, eyes up
    r.head.rotation.y = Math.sin(p * 0.5 + 1) * 0.2;
    A.forEach((a, i) => {
      const s = a.side;
      // hands come up under, and roll with the wrist so the palm stays cupped
      a.pivot.rotation.set(-0.95 - lift * 0.55, 0, s * (0.16 + lift * 0.1));
      a.elbow.rotation.x = -1.5 - lift * 0.35;
      a.hand.rotation.set(0.6 + lift * 0.5, 0, s * (0.35 - lift * 0.2));
    });
    r.legs[0].pivot.rotation.x = -0.06; r.legs[0].knee.rotation.x = 0.16; r.legs[0].foot.rotation.x = -0.1;
    r.legs[1].pivot.rotation.x = -0.02; r.legs[1].knee.rotation.x = 0.1; r.legs[1].foot.rotation.x = -0.06;
    return;
  }
  if (r.anim === "spreadTease") {
    // THE SPREAD. She turns her back on the room, bends at the waist, and pulls
    // herself open with both hands while looking back over her shoulder — which
    // is the whole shot, and the reason the neck is a joint now. The bend comes
    // from the new waist, not the chest, so the arch reads through the spine.
    const clock = r.beatRef && typeof r.beatRef.t === "number" ? r.beatRef.t : t;
    const p = clock * Math.PI * 2 * 1.7;
    const bend = 0.5 + Math.sin(p) * 0.12;                 // 0.38 .. 0.62
    r.hips.position.y = 0.86;
    r.hips.rotation.set(0, 0, 0);
    r.waist.rotation.x = bend * 0.9;                       // the lower back does it
    r.torso.rotation.x = bend * 0.34;
    r.torso.rotation.y = Math.sin(p * 0.5) * 0.18;
    r.head.rotation.set(-0.5 - bend * 0.2, 2.5, 0);         // ...looking back over it
    // feet planted, knees soft, weight back into the heels
    for (const l of r.legs) { l.pivot.rotation.x = -0.1; l.knee.rotation.x = 0.18; l.foot.rotation.x = -0.08; }
    A.forEach((a) => {
      // both hands out to the sides of the hips, palms in, pulling
      a.pivot.rotation.set(-0.35, 0, a.side * (0.72 + Math.sin(p * 0.5) * 0.06));
      a.elbow.rotation.x = -0.9;
      a.hand.rotation.set(0, a.side * -0.5, a.side * 0.4);
    });
    return;
  }
  if (r.anim === "stageRub") {
    // THE RUB. Wide, low, and slow: the hips rolling forward over one hand with
    // the other braced on the rail above, the head down and forward, working the
    // whole phrase. Crude by design — it is the one routine in the house that is
    // meant to be crude, and it is the only clip that hides its face.
    const clock = r.beatRef && typeof r.beatRef.t === "number" ? r.beatRef.t : t;
    const p = clock * Math.PI * 2 * 1.25;
    const roll = Math.sin(p);
    squat(r, 0.78, roll * 0.16);
    r.hips.rotation.z = roll * 0.18;
    r.waist.rotation.x = -0.12 + roll * 0.1;
    r.torso.rotation.x = 0.3 - roll * 0.16;
    r.head.rotation.x = 0.24 + roll * 0.08;                // looking down at it
    // wide: the splay is on the hip pivots' z, which is the only joint that can
    // open a stance on this rig
    r.legs[0].pivot.rotation.z = 0.3 + roll * 0.05;
    r.legs[1].pivot.rotation.z = -0.3 - roll * 0.05;
    // left hand down and between the legs, right hand up on the rail
    A[0].pivot.rotation.set(-0.5 + roll * 0.18, 0.35, -0.28);
    A[0].elbow.rotation.x = -0.7;
    A[0].hand.rotation.set(0.3, 0, 0);
    A[1].pivot.rotation.set(-2.3, 0, 0.55);
    A[1].elbow.rotation.x = -0.6;
    A[1].hand.rotation.set(0, 0, 0.2);
    return;
  }
  if (r.anim === "missionary" || r.anim === "doggystyle" || r.anim === "oral"
    || r.anim === "roughOral" || r.anim === "sixtyNine" || r.anim === "assToMouth") {
    coupleClip(r);
    return;
  }
  // kiss: lean in over the seat and tilt the head
  const k = Math.min(1, r.time / 0.6);
  const e = k * k * (3 - 2 * k);
  squat(r, 0.25 * e, 0);
  r.torso.rotation.x = 0.55 * e;
  r.head.rotation.x = 0.15 * e;
  r.head.rotation.z = 0.35 * e;
  A.forEach((a) => { a.pivot.rotation.x = -1.1 * e; a.pivot.rotation.z = a.side * 0.35; a.elbow.rotation.x = -0.9 * e; });
}

// ---------------------------------------------------------------- the couple
// The private scenes.
//
// These are half-poses, and the split is the point. A position is ONE name that
// two actors play, and each rig knows which half of it it is (`r.coupleRole`,
// set by the scene module in act.js, which owns where the two bodies are in the
// room and how they are oriented to each other). So "missionary" is one idea
// with two bodies in it, rather than two clips that can drift out of agreement
// the moment somebody re-times one of them.
//
// The scene module also lays them down — lying someone flat is a root
// transform, not a pose, and doing it here would mean every clip re-deriving
// where the floor is. So a table here is only the arch, the spread, the grip and
// the face, applied on top of a body that is already horizontal.
//
// It is a table rather than twelve functions for the same reason the eight-count
// is: re-choreographing a scene is editing numbers. `arm` and `leg` are indexed
// [left, right] and match the rig's own ordering.
const COUPLE_POSES = {
  missionary: {
    // underneath: on her back, knees up and apart, chin down
    lead: { hipY: 0.30, waistX: -0.22, chestX: -0.12, headX: 0.18, headY: 0,
      arm: [[-0.5, 1.05, -0.3], [-0.5, -1.05, -0.3]],
      leg: [[-0.5, 0.42, 0.95, 0.2], [-0.5, -0.34, 0.95, 0.2]] },
    // over the top, weight on the forearms
    partner: { hipY: 0.34, waistX: 0.34, chestX: 0.2, headX: -0.5, headY: 0,
      arm: [[-1.9, 0.5, -0.9], [-1.9, -0.5, -0.9]],
      leg: [[-0.15, 0.26, 0.5, 0], [-0.15, -0.26, 0.5, 0]] },
  },
  doggystyle: {
    // on hands and knees, hips back and up
    lead: { hipY: 0.86, waistX: -0.2, chestX: 0.24, headX: 0.22, headY: 0.5,
      arm: [[-2.55, 0.34, -0.35], [-2.55, -0.34, -0.35]],
      leg: [[-0.15, 0.24, 0.1, 0], [-0.15, -0.24, 0.1, 0]] },
    // behind, over the hips, one hand on a hip and one on the bed
    partner: { hipY: 0.8, waistX: 0.5, chestX: 0.42, headX: -0.34, headY: 0,
      arm: [[-1.3, 0.72, -0.5], [-1.55, -0.2, -0.9]],
      leg: [[-0.5, 0.3, 0.9, 0.1], [-0.5, -0.3, 0.9, 0.1]] },
  },
  oral: {
    // underneath, back arched off the bed, head tipped back
    lead: { hipY: 0.26, waistX: -0.34, chestX: -0.2, headX: 0.46, headY: 0,
      arm: [[-0.7, 1.2, -0.5], [-0.7, -1.2, -0.5]],
      leg: [[-0.35, 0.3, 0.7, 0.15], [-0.35, -0.3, 0.7, 0.15]] },
    // over her, both hands on the bed either side of her shoulders
    partner: { hipY: 0.32, waistX: 0.4, chestX: 0.3, headX: -0.62, headY: 0,
      arm: [[-2.5, 0.85, -0.3], [-2.5, -0.85, -0.3]],
      leg: [[-0.1, 0.34, 0.4, 0], [-0.1, -0.34, 0.4, 0]] },
  },
  roughOral: {
    // the same shape, taken faster and harder: deeper, tighter, no arch — the
    // difference between this and `oral` is amplitude and rate, which is the only
    // honest way to draw it on a rig with no faces to change
    lead: { hipY: 0.24, waistX: -0.16, chestX: -0.1, headX: 0.62, headY: 0,
      arm: [[-0.35, 0.9, -1.3], [-0.35, -0.9, -1.3]],
      leg: [[-0.2, 0.22, 0.42, 0.1], [-0.2, -0.22, 0.42, 0.1]] },
    partner: { hipY: 0.3, waistX: 0.26, chestX: 0.18, headX: -0.78, headY: 0,
      arm: [[-0.3, 0.34, -1.5], [-0.3, -0.34, -1.5]],
      leg: [[0.1, 0.2, 0.25, 0], [0.1, -0.2, 0.25, 0]] },
  },
  sixtyNine: {
    // head to head, both folded over each other
    lead: { hipY: 0.42, waistX: 0.5, chestX: 0.3, headX: -0.72, headY: 0,
      arm: [[-1.0, 0.5, -0.8], [-1.0, -0.5, -0.8]],
      leg: [[-0.3, 0.2, 1.15, 0], [-0.3, -0.2, 1.15, 0]] },
    partner: { hipY: 0.42, waistX: 0.5, chestX: 0.3, headX: -0.72, headY: 0,
      arm: [[-1.0, 0.5, -0.8], [-1.0, -0.5, -0.8]],
      leg: [[-0.3, 0.2, 1.15, 0], [-0.3, -0.2, 1.15, 0]] },
  },
  assToMouth: {
    // underneath on her back, legs up and over his shoulders
    lead: { hipY: 0.26, waistX: -0.4, chestX: -0.26, headX: 0.34, headY: 0,
      arm: [[-0.55, 1.15, -0.4], [-0.55, -1.15, -0.4]],
      leg: [[-1.15, 0.3, 0.35, 0], [-1.15, -0.3, 0.35, 0]] },
    // face down into her, both hands on her hips
    partner: { hipY: 0.36, waistX: 0.62, chestX: 0.46, headX: -0.5, headY: 0,
      arm: [[-1.15, 0.62, -0.7], [-1.15, -0.62, -0.7]],
      leg: [[-0.25, 0.3, 0.8, 0.1], [-0.25, -0.3, 0.8, 0.1]] },
  },
};

/**
 * Pose one half of a couple scene, and keep it alive.
 *
 * The base comes out of the table; on top of it goes a slow breath and the roll
 * of the hips at the rate the position runs at — `oral` is a different act at a
 * different rhythm from `doggystyle`, and the amplitude and frequency of that
 * motion is most of what separates the two on a rig that has no faces.
 */
function coupleClip(r) {
  const table = COUPLE_POSES[r.anim];
  const role = r.coupleRole === "partner" ? "partner" : "lead";
  const p = table ? table[role] : COUPLE_POSES.missionary.lead;
  const clock = r.beatRef && typeof r.beatRef.t === "number" ? r.beatRef.t : r.time;
  // the rate, and how far the body travels, per position: roughOral is fast and
  // short, oral slow and deep, sixtyNine barely moving at all
  const RATE = { roughOral: 2.4, oral: 1.1, doggystyle: 1.5, missionary: 1.3, sixtyNine: 0.9, assToMouth: 1.2 };
  const SWAY = { roughOral: 0.16, oral: 0.24, doggystyle: 0.18, missionary: 0.2, sixtyNine: 0.07, assToMouth: 0.15 };
  const rate = RATE[r.anim] || 1.2, sway = SWAY[r.anim] || 0.15;
  const w = clock * Math.PI * 2 * rate;
  const s = Math.sin(w), c = Math.cos(w);
  const breath = Math.sin(w * 0.5 + 0.7);

  r.hips.position.y = p.hipY;
  r.hips.rotation.set(0, 0, sway * 0.4 * s);
  r.waist.rotation.set(p.waistX + breath * 0.02, 0, sway * 0.3 * s);
  r.torso.rotation.set(p.chestX + breath * 0.015, 0, -sway * 0.35 * s);
  r.head.rotation.set(p.headX, p.headY + s * 0.1, s * 0.08);
  A_for(r, (a, i) => {
    const q = p.arm[i];
    a.pivot.rotation.set(q[0] + breath * 0.02, 0, q[1]);
    a.elbow.rotation.x = q[2];
    a.hand.rotation.set(breath * 0.1, 0, 0);
  });
  r.legs.forEach((l, i) => {
    const q = p.leg[i];
    l.pivot.rotation.set(q[0] + (i ? c : -c) * sway * 0.18, q[1] + (i ? 1 : -1) * sway * 0.12, 0);
    l.knee.rotation.x = q[2] + Math.max(0, (i ? c : -c)) * sway * 0.3;
    l.foot.rotation.x = q[3];
  });
}

/** `A_for` is `arms.forEach` with the index, hoisted because coupleClip calls it
 *  every frame and the other clips inline it. */
function A_for(r, fn) { for (let i = 0; i < r.arms.length; i++) fn(r.arms[i], i); }

// --------------------------------------------------------------- factory
function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- adult clips
// The clips that are only ever appropriate on a performer who is unambiguously
// an adult, and only once the player has answered the 18+ gate at the door.
// Listed by NAME here and refused in `play()`, so the rule is enforced at the
// rig rather than at each of the venues that cast dancers.
//
// The names are the set the choreography library uses: the stage business a
// dancer can work into a set, and the private scenes behind the back rooms.
// Nothing in this list plays on a walk cycle, an NPC on the street, a zombie or
// a bystander — a bystander is `patron` and has never been 25, whatever the
// rig's default says.
export const ADULT_CLIPS = new Set([
  // stage
  "stripTease", "flash", "spreadTease", "stageRub",
  // private scenes
  "missionary", "doggystyle", "oral", "roughOral", "sixtyNine", "assToMouth",
]);

/** The youngest actor any adult clip will play on. */
export const ADULT_CLIP_MIN_AGE = 18;

// The 18+ gate, installed by main.js at boot. `null` means nothing has claimed
// responsibility for it, and the guard fails CLOSED on null: an unwired gate is
// not an open gate. Tests install their own.
let adultGate = null;
export function setAdultGate(fn) { adultGate = typeof fn === "function" ? fn : null; }
export function adultGateInstalled() { return adultGate != null; }

/**
 * Build one Hoodrat.
 *
 * @param {object}  opts
 * @param {"m"|"f"} opts.sex     male / female build and outfit
 * @param {string}  opts.crew    "red" | "blue"
 * @param {number}  opts.seed    deterministic variation
 * @param {number}  opts.height  metres, head to heel
 * @param {number}  opts.age     years; the cast is adult, so this only ever
 *   needs setting DOWN, and only so a minor can be refused adult clips
 */
export function makeHoodrat(opts = {}) {
  return new Hoodrat(opts);
}

/** A random member of the crew — used by the enemy spawner. */
export function randomHoodrat(rng = Math.random, height) {
  return new Hoodrat({
    sex: rng() < 0.5 ? "f" : "m",
    crew: rng() < 0.5 ? "red" : "blue",
    seed: (rng() * 1e9) | 0,
    yaw: rng() * Math.PI * 2,
    height,
  });
}

const PLAID_PAIRS = [
  [0x8a2e2e, 0x2c2c2c], [0x2e4a2e, 0x1c1c1c], [0x2e3a6a, 0xd8d0c0],
  [0x6a4a2e, 0x2c2c2c], [0x3a3a3a, 0xb02020],
];
const REDNECK_DENIM = [0x3a3428, 0x4a4436, 0x2c281f];
const REDNECK_SKIN = [0xd8a878, 0xc79a74, 0xe0b48e, 0xb08258];

/**
 * A random redneck: same rig as `Hoodrat`, dressed for the other faction —
 * a flannel shirt, work jeans, a trucker cap or bare head, and boots.
 * Distinct clothing set, not a distinct class; palette overrides win, so
 * story characters (Mally, Bubba) can still take a specific look.
 */
export function randomRedneck(rng = Math.random, height, opts = {}) {
  const [plaidBase, plaidLine] = PLAID_PAIRS[(rng() * PLAID_PAIRS.length) | 0];
  return new Hoodrat({
    sex: rng() < 0.25 ? "f" : "m",
    crew: { cloth: 0x5a4a34, chain: 0xaaaaaa, shoe: 0x3d2b1c, hat: 0x4a3a28 },
    seed: (rng() * 1e9) | 0,
    yaw: rng() * Math.PI * 2,
    skin: REDNECK_SKIN[(rng() * REDNECK_SKIN.length) | 0],
    denim: REDNECK_DENIM[(rng() * REDNECK_DENIM.length) | 0],
    plaid: true,
    plaidBase, plaidLine,
    headwear: rng() < 0.6 ? "cap" : "none",
    shoe: "boots",
    height,
    ...opts,
  });
}

// Sickly, bloodless skin and clothes gone the same grey-brown — a reskin of
// the same rig, not a new one, per the human's ask (2026-09-23): "reskin an
// existing rig" for the zombie-mode horde. No plaid, no crew colours, no
// headwear: whatever they were wearing when they turned, it's filthy now.
const ZOMBIE_SKIN = [0x7c8f6e, 0x6f8560, 0x8a9878, 0x5e7454, 0x94a084];
const ZOMBIE_CLOTH = [0x4a4438, 0x40453a, 0x3c3830, 0x454034];

/** A random zombie: the Hoodrat rig under a corpse's palette. */
// Archetype looks (zombies.js): each reads at a glance, at distance, on a dark street. `h` scales the
// height, `skin`/`cloth` replace the corpse palette. Undefined = an ordinary shambler.
export function randomZombie(rng = Math.random, height, look = null) {
  const cloth = (look && look.cloth != null) ? look.cloth : ZOMBIE_CLOTH[(rng() * ZOMBIE_CLOTH.length) | 0];
  if (look && look.h) height = height * look.h;
  return new Hoodrat({
    sex: rng() < 0.5 ? "f" : "m",
    crew: { cloth, chain: 0x4a4a46, shoe: 0x2c281f, legging: cloth },
    seed: (rng() * 1e9) | 0,
    yaw: rng() * Math.PI * 2,
    skin: (look && look.skin != null) ? look.skin : ZOMBIE_SKIN[(rng() * ZOMBIE_SKIN.length) | 0],
    top: cloth,
    denim: 0x353128,
    hair: 0x1c1a16,
    headwear: "none",
    shoe: "boots",
    height,
  });
}

// Klan robe whites. Mostly the same laundered off-white, because a crowd of
// them is meant to read as one thing with no faces in it; the darker creams are
// robes that have seen more nights out. `officer` picks the crimson one — the
// one giving the orders, so a mission can point at him without a health bar.
const ROBE_WHITES = [0xeae6da, 0xe8e4d8, 0xe2ddcf, 0xdcd6c6, 0xefece2];
const ROBE_OFFICER = 0x7d1f22;

/**
 * A klansman: the redneck body under a hooded robe (see `opts.robe` in the
 * constructor). Same rig, same animations, same enemy interface as every other
 * NPC — main.js spawns and kills one exactly like a Redneck.
 *
 * They are built as a separate factory rather than a `randomRedneck` option so
 * the spawn tables can keep them out of ordinary daytime free roam: see
 * klan.js, which is the only thing that should be calling this.
 */
export function randomKlansman(rng = Math.random, height, opts = {}) {
  return new Hoodrat({
    sex: "m",
    crew: { cloth: 0x5a4a34, chain: 0x8a8a8a, shoe: 0x2b2018 },
    seed: (rng() * 1e9) | 0,
    yaw: rng() * Math.PI * 2,
    skin: REDNECK_SKIN[(rng() * REDNECK_SKIN.length) | 0],
    denim: REDNECK_DENIM[(rng() * REDNECK_DENIM.length) | 0],
    headwear: "none",
    shoe: "boots",
    beard: false,                 // nothing of him shows; the hood is the face
    robe: true,
    robeColor: opts.officer ? ROBE_OFFICER : ROBE_WHITES[(rng() * ROBE_WHITES.length) | 0],
    height,
    ...opts,
  });
}

/** Build a 3D Parish Deputy / Police Officer on foot. */
export function makeDeputy(opts = {}) {
  return new Hoodrat({
    sex: "m",
    seed: opts.seed != null ? opts.seed : 911,
    skin: opts.skin || 0xc79a74,
    top: 0x9c8660,           // khaki / tan deputy uniform shirt
    denim: 0x3d3a34,         // dark brown/navy trousers
    headwear: "hat",         // campaign hat
    police: true,            // star badge + duty belt + holster + radio
    beard: false,
    crew: { cloth: 0x2e2a22, chain: 0xaaaaaa, shoe: 0x1a1917, hat: 0x6b5a3e },
    ...opts,
  });
}

const PROSTITUTE_TOPS = [0xe62b7e, 0x9b27b0, 0xff5722, 0xe91e63, 0x00bcd4, 0xffeb3b];
const PROSTITUTE_BOTTOMS = [0x111111, 0x881144, 0x221144, 0xcc2277, 0xe62b7e, 0xf2f2f2];

/** A random prostitute walking the streets at night. */
export function randomProstitute(rng = Math.random, height, opts = {}) {
  const top = PROSTITUTE_TOPS[(rng() * PROSTITUTE_TOPS.length) | 0];
  const denim = PROSTITUTE_BOTTOMS[(rng() * PROSTITUTE_BOTTOMS.length) | 0];
  return new Hoodrat({
    sex: "f",
    seed: (rng() * 1e9) | 0,
    yaw: rng() * Math.PI * 2,
    skin: SKIN_TONES[(rng() * SKIN_TONES.length) | 0],
    top,
    denim,
    headwear: "none",
    curly: rng() < 0.5,
    glam: true,                                 // bare legs, a mini skirt, stilettos or thigh-high boots
    skirt: denim,
    thighBoots: rng() < 0.35,
    bootColor: [0x0d0b0c, 0x7a1030, 0xe62b7e][(rng() * 3) | 0],
    shoe: "heels",
    heelColor: rng() < 0.5 ? 0x0d0b0c : top,
    crew: { cloth: top, chain: 0xd4af37, shoe: top, legging: denim },
    height,
    ...opts,
  });
}
/** A higher-end escort variant for OrleaRouge's casino boulevard. */
export function randomHighEndEscort(rng = Math.random, height = 1.82, opts = {}) {
  return randomProstitute(rng, height, {
    top: [0x17151f, 0x7f173d, 0x24314f][(rng() * 3) | 0],
    denim: 0x17151f,
    skirt: [0x17151f, 0x7f173d, 0x24314f][(rng() * 3) | 0],   // a sleek short dress line rather than the street's neon
    thighBoots: false,
    heelColor: 0xd4af37,
    headwear: "none",
    crew: { cloth: 0x17151f, chain: 0xd4af37, shoe: 0xd4af37, legging: 0x17151f },
    ...opts,
  });
}

export function makeHobo(opts = {}) {
  const crew = { primary: 0x4a4a40, sec: 0x3d4133 }; // dirty, drab colors
  return new Hoodrat({ ...opts, crew, headwear: "hat" });
}

export function randomHobo(rng = Math.random, height) {
  return new Hoodrat({
    sex: rng() < 0.2 ? "f" : "m",
    crew: { primary: 0x504a40, sec: 0x353a30 },
    headwear: rng() < 0.5 ? "hat" : "cap",
    seed: (rng() * 1e9) | 0,
    yaw: rng() * Math.PI * 2,
    height,
  });
}

// --------------------------------------------------------------- Frenchmen Street
// OrleaRouge's out crowd (nightlife.js, and the city's sidewalks): same rig, their
// own wardrobe. Gay men run bright — crop tanks, pastel and rainbow, white or
// light-wash jeans, bleached or dyed hair or a rainbow do-rag, clean-shaven or a
// neat beard. Lesbians run flannel, denim and boots — short hair, a backwards cap
// or a rainbow headband. Palette overrides win, as for every other builder.
const pickOf = (rng, arr) => arr[(rng() * arr.length) | 0];
const ALL_SKIN = [...SKIN_TONES, ...REDNECK_SKIN];
const GAY_TOPS = ["rainbow", 0xff4fb3, 0x2ee6d6, 0xf4f1ea, 0x9b5de5, 0xffd23a, 0x151515, 0xff8a65];
const GAY_JEANS = [0xa9c1dc, 0xf2efe8, 0x161616, 0x6b8cb2, 0xd9b7d8];
const GAY_HAIR = [0x16100d, 0xeadcae, 0xff8fc8, 0x4a2c1a, 0xb8a9e8, 0xf4f1ea];

export function randomGayMan(rng = Math.random, height, opts = {}) {
  const top = pickOf(rng, GAY_TOPS);
  const accent = top === "rainbow" ? 0xff4fb3 : top;
  return new Hoodrat({
    sex: "m",
    seed: (rng() * 1e9) | 0,
    yaw: rng() * Math.PI * 2,
    skin: pickOf(rng, ALL_SKIN),
    top,
    denim: pickOf(rng, GAY_JEANS),
    hair: pickOf(rng, GAY_HAIR),
    headwear: rng() < 0.35 ? "band" : "none",
    rainbow: true,
    beard: rng() < 0.4,
    crew: { cloth: accent, accent, chain: rng() < 0.5 ? 0xd4af37 : 0xd8d8d8, shoe: 0xf2f0ec, belt: 0x141414, maleShoe: "low" },
    height,
    ...opts,
  });
}

const FLANNEL_PAIRS = [[0x2e4a6a, 0x151515], [0x7a2e3e, 0x151515], [0x2e5a3a, 0xd8d0c0], [0x5a2e7a, 0x151515], [0x8a5a2e, 0x2c2c2c]];
const LESBIAN_HAIR = [0x16100d, 0x4a2c1a, 0x8a2e2e, 0x2e5a8a, 0xeadcae, 0x6a3a8a];

export function randomLesbian(rng = Math.random, height, opts = {}) {
  const flannel = rng() < 0.6;
  const [plaidBase, plaidLine] = pickOf(rng, FLANNEL_PAIRS);
  const hw = rng();
  return new Hoodrat({
    sex: "f",
    seed: (rng() * 1e9) | 0,
    yaw: rng() * Math.PI * 2,
    skin: pickOf(rng, ALL_SKIN),
    plaid: flannel, plaidBase, plaidLine,
    top: flannel ? undefined : pickOf(rng, ["rainbow", 0x151515, 0xf4f1ea, 0x3a6ea5]),
    denim: pickOf(rng, [0x3a4a6a, 0x161616, 0x5d7ea6, 0x4a4436]),
    hair: pickOf(rng, LESBIAN_HAIR),
    shortHair: rng() < 0.7,
    headwear: hw < 0.3 ? "cap" : hw < 0.5 ? "band" : "none",
    capColor: pickOf(rng, [0x151515, 0x2e4a6a, 0x7a2e3e]),
    rainbow: true,
    shoe: "boots",
    crew: { cloth: 0x2e2e36, chain: 0xc0c0c0, shoe: 0x2a1c14, legging: 0x2e2e36 },
    height,
    ...opts,
  });
}

/** A pretentious OrleaRouge nightlife regular: black tux, white shirt and a
 * little too much gold. Kept on the shared pedestrian rig so the crowd still
 * benefits from the normal LOD and civilian behaviour. */
export function randomTuxedo(rng = Math.random, height = 1.86, opts = {}) {
  return new Hoodrat({
    sex: "m",
    seed: (rng() * 1e9) | 0,
    yaw: rng() * Math.PI * 2,
    skin: pickOf(rng, ALL_SKIN),
    top: 0x151515,
    denim: 0x151515,
    hair: pickOf(rng, [0x16100d, 0x4a2c1a, 0x2b211d]),
    headwear: "none",
    beard: rng() < 0.35,
    crew: { cloth: 0x151515, accent: 0xf4f1e8, chain: 0xd4af37, shoe: 0x0b0b0d, maleShoe: "low" },
    height,
    ...opts,
  });
}

/** A club dancer: sequins-bright top and short bottoms, glitter-gold chain. */
export function makeDancer(opts = {}) {
  const rng = mulberry(opts.seed != null ? opts.seed : (Math.random() * 1e9) | 0);
  const female = opts.sex !== "m";
  const top = opts.top != null ? opts.top : pickOf(rng, [0xff2e93, 0xffd23a, 0x2ee6d6, 0xe8e8e8, 0x9b27b0, "rainbow", 0x111111]);
  const bottom = pickOf(rng, [0x111111, 0xff2e93, 0x6a1b9a, 0xd4af37, 0x1a1a3a]);
  return new Hoodrat({
    sex: female ? "f" : "m",
    seed: (rng() * 1e9) | 0,
    skin: pickOf(rng, ALL_SKIN),
    top,
    denim: bottom,
    hair: pickOf(rng, female ? [0x16100d, 0x8a2e2e, 0xeadcae, 0xff8fc8, 0x4a2c1a] : [0x16100d, 0xeadcae, 0x4a2c1a]),
    headwear: female ? (rng() < 0.4 ? "band" : "none") : "none",
    rainbow: top === "rainbow",
    curly: rng() < 0.5,
    beard: false,
    crew: { cloth: top === "rainbow" ? 0xff2e93 : top, accent: top === "rainbow" ? 0xff2e93 : top, chain: 0xd4af37, shoe: bottom, legging: bottom, maleShoe: "low" },
    ...opts,
  });
}

/**
 * A club stage performer — the house's own dancers, and the people the player
 * pays at the door (crowd.js's `performer` / `gogo` roles, franchiseClubs.js's
 * cast). Fictional 25+ adults, on the same terms as `topless`: the sheet's own
 * low-poly bust, scaled, and nothing finer than the primitives a clothed dancer
 * already wears.
 *
 * What separates her from `makeDancer` is the wardrobe and the proportions, not
 * a new rig: `stripper` is the bikini top and gstring over bare legs, `bust`
 * scales the chest past the sheet default, and the height defaults to the
 * player's own 1.80 m rather than to a dancer's 1.72 — in heels, on a lit stage,
 * short enough reads as a child rather than a professional.
 */
// ------------------------------------------------------------------ wardrobe
// What can come off, and what it is made of.
//
// mergeRigid bakes a joint's meshes one-per-material, so a garment IS the merged
// mesh that carries its material. That is what makes "take it off" a visibility
// toggle rather than a second body hidden underneath: there is nothing under the
// bikini but the bust and the pelvis the rig already had.
//
// Skin is never in this list, and the check below is what enforces that. The skin
// material is shared across the entire cast, and on a topless rig the chest IS
// skin — so a garment registered as skin would take the body with it when hidden.
const registerGarment = (garments, part, material, skin) => {
  if (!material || material === skin) return;
  garments.push({ part, material });
};

export function makeStripper(opts = {}) {
  const rng = mulberry(opts.seed != null ? opts.seed : (Math.random() * 1e9) | 0);
  const female = opts.sex !== "m";
  const bikini = opts.bikini != null ? opts.bikini : pickOf(rng, [0xff2e93, 0xffd23a, 0x2ee6d6, 0xe8e8e8, 0x9b27b0, 0xff4fb3]);
  return new Hoodrat({
    sex: female ? "f" : "m",
    seed: (rng() * 1e9) | 0,
    height: opts.height ?? 1.80,
    skin: pickOf(rng, ALL_SKIN),
    top: bikini,
    denim: 0x141018,
    stripper: true,
    bust: opts.bust ?? 1.5,
    shoe: female ? "heels" : (opts.shoe || "high"),
    hair: pickOf(rng, female ? [0x16100d, 0x8a2e2e, 0xeadcae, 0xff8fc8, 0x4a2c1a, 0xd8b26a] : [0x16100d, 0xeadcae, 0x4a2c1a]),
    headwear: female ? (rng() < 0.4 ? "band" : "none") : "none",
    curly: rng() < 0.5,
    beard: false,
    crew: { cloth: bikini, accent: bikini, chain: 0xd4af37, shoe: 0x141018, legging: 0x141018, belt: 0x141018, maleShoe: "high" },
    ...opts,
  });
}

/** The hogs of HAPPY HOGS: hide and snout tones, in pairs. */
const HOG_HIDES = [
  [0xe8a49c, 0xd98a86], [0xd9948a, 0xc47f78], [0xf2bdb0, 0xdc9a94], [0xc98a80, 0xb06f6b],
];

/**
 * A HAPPY HOGS hog — the house's own staff, on the *people* rig.
 *
 * That is the whole point of building it here rather than as a mesh like the
 * boars out in the woods (`main.js`'s `buildHog` is the quadruped you shoot, and
 * it is a different animal): a hog on this rig dances on a podium, walks, leans on
 * a bar and gets batched by the same sweep as everybody else, and needs no clip
 * the crowd kit does not already run. What makes it a hog is the hide worn as
 * skin, the muzzle, the snout disc, the floppy ears, the tusks and the curl — one
 * block in the constructor (`opts.hog`), no new rig, no new materials.
 *
 * Two variants, because the venue needs both: `"dancer"` (the default) wears a
 * sequined top and does the podiums, and `"barman"` wears a dark vest and works
 * the counter all night (crowd.js's `work` beat cycles pour → polish → serve →
 * lean, so he is never a statue behind the bar).
 *
 * @param {object} opts
 * @param {"dancer"|"barman"} opts.variant
 * @param {"m"|"f"} opts.sex      dancers are either, the barman is a boar
 */
export function makeHog(opts = {}) {
  const rng = mulberry(opts.seed != null ? opts.seed : (Math.random() * 1e9) | 0);
  const barman = opts.variant === "barman";
  const tag = (h) => { h.userData.hog = true; return h; };
  const [hide, snout] = opts.hide ? [opts.hide, opts.snout ?? opts.hide] : pickOf(rng, HOG_HIDES);
  const female = opts.sex === "f";
  const top = opts.top != null ? opts.top
    : barman ? 0x1d1a20
      : pickOf(rng, [0xff2e93, 0xffd23a, 0x2ee6d6, 0x9b27b0, 0xf4f1ea]);
  const trim = barman ? 0x2b2730 : top;
  return tag(new Hoodrat({
    sex: female ? "f" : "m",
    seed: (opts.seed != null ? opts.seed : (rng() * 1e9) | 0),
    yaw: opts.yaw,
    height: opts.height ?? (barman ? 1.86 : 1.78),
    hog: true,
    skin: hide,
    hogColor: hide,
    snoutColor: snout,
    earColor: snout,
    headwear: "none",
    beard: false,
    top,
    // the house is a strip club, and the dancers are billed on more than the
    // sheet's own read — a great deal more, per the human (2026-09-30): the hog
    // dancers are the one cast everybody photographs, and at the old 1.18 they
    // were the same mannequin as the woman on the next stage over. The barman
    // works behind a counter and gets nothing.
    bust: barman ? 1 : 1.72,
    denim: barman ? 0x141216 : trim,
    hair: 0x16100d,
    shoe: barman ? "low" : "high",
    // a hog has a snout where a chain would hang, so the neckline stays bare and
    // the palette does the talking: sequins for the podiums, a dark vest and a
    // pale cuff for the bar
    crew: {
      cloth: trim,
      accent: 0xf4f1e8,
      chain: barman ? 0xcfd3da : 0xd4af37,
      belt: barman ? 0x141414 : trim,
      legging: barman ? 0x141216 : trim,
      shoe: barman ? 0x0b0b0d : trim,
      maleShoe: barman ? "low" : "high",
    },
    ...opts,
  }));
}

/** A random hog — the crowd kit's factory for the `mix`-style roles. */
export function randomHog(rng = Math.random, height, opts = {}) {
  return makeHog({ ...opts, seed: (rng() * 1e9) | 0, height });
}

/**
 * BILLY JEANS — the Crown Strip's act (crowd.js's `star` role, on the lounge's
 * stage). The rig is everybody else's, because he has to stand in the same room
 * as the crowd he plays to: what makes him a *named* performer is the palette
 * and the props, all of which already existed for this silhouette —
 *
 *   * the black fedora snapped down over one eye (`fedora`, whose comment says
 *     it is the stage act's rather than the sheriff's campaign `hat`),
 *   * the one white performance glove, on the RIGHT hand (side -1, `opts.glove`)
 *     — the gun hand, which is the hand the mic is in, and the hand the giant
 *     glove over the lounge's door is a portrait of,
 *   * all-white low-tops (`shoe: "low"`), because every step he does is a foot
 *     step and the feet have to be legible from the back of a dark room.
 *
 * No new geometry, no textures, no skinning and no mixer: the six stage clips he
 * performs are poses in `danceClip` (moonwalk, showboat, spin, footwork, lean,
 * cheer), driven by crowd.js's script. That is what keeps a named character
 * affordable on a strip that already has a hundred people on it.
 */
export function makeStar(opts = {}) {
  return new Hoodrat({
    sex: "m",
    seed: opts.seed != null ? opts.seed : 77,
    yaw: opts.yaw != null ? opts.yaw : 0,
    height: opts.height ?? 1.84,
    headwear: "fedora",
    glove: true,
    shoe: "low",
    top: 0x14141c,                     // the sequined jacket, dark until a light hits it
    denim: 0x0f0f14,                   // and the trousers, with the cuff showing
    hair: 0x16100d,
    beard: false,
    crew: { cloth: 0x0e0e14, accent: 0xf4f7ff, chain: 0xd4af37, shoe: 0x0b0b0d, belt: 0x141414, hat: 0x121216, maleShoe: "low" },
    ...opts,
  });
}
