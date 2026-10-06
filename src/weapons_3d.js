// ---------------------------------------------------------------------------
// weapons_3d.js — what the player is actually holding.
//
// WHAT WAS WRONG. The old version was a "view model": one shared pivot parked
// near the player's shoulder (`playerPos.y + 1.1`), aimed with `lookAt`, and a
// per-weapon hardcoded position like `activeWeapon.position.set(0.3, -0.2, 0.2)`.
// That is a weapon placed NEXT TO a character, not held by one — it does not
// know where the hands are, it is not a child of anything that animates, and the
// offsets that make it look reasonable in one pose are wrong in every other.
// That is why the bat floated beside the player and the shotgun read as
// detached.
//
// WHAT REPLACES IT. Three ideas, and every weapon in the game inherits all three:
//
//   1. PARENTING. Every weapon is a child of the character's HAND SOCKET —
//      `characters.js` builds one per arm at the middle of the fist. Position
//      comes from the hand, always: the weapon cannot float, drift, or fail to
//      follow the body through a walk, a turn, a dance clip or a melee swing,
//      because it is inside the arm that is doing all of that. Nothing here
//      knows or cares where the camera or the player's world position is.
//
//   2. A SOLVED ORIENTATION. A wrist's frame tumbles through every clip, so a gun
//      rigidly bolted to one would point wherever the wrist happened to be. The
//      grip node's LOCAL rotation is solved from a desired WORLD orientation each
//      frame instead:
//
//          gripLocal = handWorld⁻¹ · desiredWorld · modelOffset
//
//      `desiredWorld` puts the weapon's +Z (its barrel axis) along the aim
//      direction — or, for melee, leaves the weapon rigidly in the fist, which
//      is what a bat is. So: position from the hand, orientation from the aim.
//
//   3. A GRIP ORIGIN. Every model below is built GRIP-AT-ORIGIN: the point the
//      hand closes around is (0,0,0) and the barrel runs down +Z. Rotating the
//      weapon about its own origin is therefore rotating it about the grip, so
//      recoil kicks the muzzle while the grip stays put in the hand, and nothing
//      ever pivots around the middle of an image.
//
// The muzzle is a real node at the weapon's `muzzleOffset`, so tracers, flashes
// and shell effects can start at the end of the barrel instead of at the
// player's navel.
//
// Gameplay stays in weapons.js (damage, clip, cooldown, fireMode); everything
// about how a weapon SITS lives here. Both tables are keyed by the same id, and
// the one field they must agree on is `hold`.
//
// PER-WEAPON CONFIG (the data model the task asked for, in this codebase's idiom):
//
//   type            melee | pistol | smg | shotgun | rifle
//   hold            which arm pose the character uses: pistol | long | melee
//   orient          "aim"  — barrel solved onto the aim direction (firearms)
//                   "hand" — rigid in the fist (melee: a bat does not track a camera)
//   twoHanded       the support hand is solved onto `foregrip` (characters.js IK)
//   handOffset      where the grip sits inside the fist, in hand-socket space
//   gripOffset      where the hand's grip is in MODEL space (baked into the build
//                   so it is normally zero, but it is real per-weapon data)
//   rotationOffset  model alignment inside the grip node
//   scale           model scale
//   muzzleOffset    the muzzle, in model space
//   foregrip        the support hand's target, in grip-node space
//   recoil          { pitch, yaw, kick, time } — a rotation about the grip
//   layer           renderOrder, for anything that has to draw over the body
//
// On layering: this is a 3-D, fully depth-tested scene, so what puts the hand in
// front of the grip, or behind it, per pixel, is the depth buffer — the correct
// answer for free, and the reason parenting alone settles what used to be a
// sprite layering problem. `layer` is the hook for parts that must ignore depth:
// today every weapon material is opaque and a firearm sits at 1 and a bat at 2
// (in front of the character's merged meshes at 0), so it is a tiebreaker rather
// than a fix-up. Nothing here reaches for a screen-space offset, because there is
// no screen-space position to get wrong.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { SRGBColorSpace } from "three";

// ---------------------------------------------------------------- materials
function std(name, color, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ name, color, roughness: 0.6, ...extra });
  m.userData.gtbRealized = true;                 // keep the scene-wide realize pass off these
  return m;
}
const MAT = {
  wood: std("weapon wood", 0x6b4526, { roughness: 0.74 }),
  woodDark: std("weapon wood dark", 0x472c15, { roughness: 0.82 }),
  steel: std("weapon steel", 0x33383f, { roughness: 0.4, metalness: 0.75 }),
  black: std("weapon black", 0x15171b, { roughness: 0.52, metalness: 0.4 }),
  grip: std("weapon grip", 0x1b1d22, { roughness: 0.9 }),
  brass: std("weapon brass", 0xb99a4c, { roughness: 0.34, metalness: 0.85 }),
};

// geometry, shared across every weapon that repeats a size
const _geo = new Map();
const box = (w, h, d) => {
  const k = `b${w}|${h}|${d}`;
  if (!_geo.has(k)) _geo.set(k, new THREE.BoxGeometry(w, h, d));
  return _geo.get(k);
};
const cyl = (rt, rb, h, seg = 8) => {
  const k = `c${rt}|${rb}|${h}|${seg}`;
  if (!_geo.has(k)) _geo.set(k, new THREE.CylinderGeometry(rt, rb, h, seg));
  return _geo.get(k);
};

/**
 * Add a part to a weapon model. Every weapon part is culled off
 * (`frustumCulled = false`) and excluded from the static batcher
 * (`userData.noBatch`) — it is welded to a moving actor, so both of those
 * systems are wrong about it by definition.
 */
function part(parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (rx || ry || rz) m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = false;
  m.frustumCulled = false;
  m.userData.noBatch = true;
  parent.add(m);
  return m;
}

// ---------------------------------------------------------------- the models
// Every builder returns a Group whose ORIGIN IS THE GRIP POINT and whose +Z is
// the muzzle direction. Nothing else in the file has to know a weapon's size.
//
// These are all PROCEDURAL, and they were five boxes each — a slide, a frame, a
// grip, a trigger, and a hope. The measurement work that fixed the Tec-9's
// orientation (see GLB_SKINS and tools/qa/probe_weapons.mjs) made it obvious
// that the authored assets only cover two of the five weapons here, so the
// other three were never going to get better by waiting for a model: they are
// built in this file, and they are what the player looks at.
//
// So they are built like guns rather than like blocks. Barrels are CYLINDERS,
// not squares, because the single strongest cue that reads "gun" is a round
// barrel and its highlight. Stocks have a comb and a butt, not one box. The
// small parts — sights, the bolt handle, the trigger guard, the cut-off lever
// — are the difference between a weapon and a silhouette of one, and they are
// what a hand at 60 cm can actually resolve.
//
// The proportions are real ones (a 9 mm pistol is ~185 mm long overall, a
// deer rifle's barrel ~610 mm), because a weapon that is the right SHAPE and
// the wrong SIZE reads as wrong in the hand in a way no amount of detail
// fixes.

/** A cylinder lying along +Z — every barrel in this file. */
const tube = (r, len, seg = 10) => {
  const k = `t${r}|${len}|${seg}`;
  if (!_geo.has(k)) {
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    g.rotateX(Math.PI / 2);                 // the cylinder is built along +Y
    _geo.set(k, g);
  }
  return _geo.get(k);
};
/** A cone/taper lying along +Z — forends, grips and stocks that thin out. */
const taper = (rTip, rBase, len, seg = 8) => {
  const k = `p${rTip}|${rBase}|${len}|${seg}`;
  if (!_geo.has(k)) {
    const g = new THREE.CylinderGeometry(rTip, rBase, len, seg);
    g.rotateX(Math.PI / 2);
    _geo.set(k, g);
  }
  return _geo.get(k);
};
/** A wedge, for a grip that is deeper at the top than at the bottom. */
const wedge = (w, hTop, hBot, d) => {
  const k = `w${w}|${hTop}|${hBot}|${d}`;
  if (!_geo.has(k)) {
    const g = new THREE.BoxGeometry(w, hTop, d, 1, 1, 1);
    const pos = g.attributes.position;
    // taper the bottom face in, which is what a pistol grip does in section
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < 0) { pos.setX(i, pos.getX(i) * (hBot / hTop)); }
    }
    g.computeVertexNormals();
    _geo.set(k, g);
  }
  return _geo.get(k);
};
/** Checkering: shallow ribs on a grip panel, so it is not a smooth slab. */
function checkering(parent, w, h, d, x, y, z, n = 4) {
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    part(parent, box(w * 1.04, 0.004, d * 0.86), MAT.black, x, y - h / 2 + h * t, z);
  }
}

function makeBat() {
  const g = new THREE.Group();
  // A bat: thin handle in the fist, thickening to the barrel up +Z. The knob
  // below the origin is what the palm actually catches on, and it is what makes
  // the hand read as closed around the handle rather than floating at the end.
  part(g, box(0.05, 0.05, 0.045), MAT.woodDark, 0, 0, -0.035);
  const shaft = cyl(0.046, 0.021, 0.78, 8);
  shaft.translate(0, 0.39, 0);
  shaft.rotateX(Math.PI / 2);
  part(g, shaft, MAT.wood, 0, 0, 0);
  part(g, cyl(0.048, 0.048, 0.02, 8), MAT.woodDark, 0, 0, 0.72, Math.PI / 2, 0, 0);
  // grip tape: the wrapped section a used bat actually has, and the reason the
  // handle does not read as a length of dowel
  part(g, cyl(0.049, 0.047, 0.19, 8), MAT.black, 0, 0, 0.055, Math.PI / 2, 0, 0);
  for (let i = 0; i < 4; i++) {
    part(g, cyl(0.051, 0.051, 0.006, 8), MAT.woodDark, 0, 0, -0.02 + i * 0.045, Math.PI / 2, 0, 0);
  }
  // a worn scuff on the barrel, so it is not a perfect cylinder
  part(g, box(0.055, 0.004, 0.09), MAT.woodDark, 0, 0.042, 0.55);
  return g;
}

function makePistol() {
  const g = new THREE.Group();
  // --- slide: the top half, and the part the eye actually locks onto
  part(g, box(0.030, 0.036, 0.176), MAT.steel, 0, 0.038, 0.082);
  // the flat top of the slide, inset, so it is not one flat face
  part(g, box(0.022, 0.006, 0.170), MAT.black, 0, 0.056, 0.082);
  // cocking serrations at the rear — five grooves is what makes a slide a slide
  for (let i = 0; i < 5; i++) part(g, box(0.032, 0.026, 0.004), MAT.black, 0, 0.038, 0.028 + i * 0.007);
  // ejection port, and the chamber behind it
  part(g, box(0.006, 0.020, 0.036), MAT.black, 0.016, 0.042, 0.088);
  // --- frame below the slide
  part(g, box(0.028, 0.020, 0.168), MAT.black, 0, 0.014, 0.078);
  // dust cover / front strap
  part(g, box(0.026, 0.026, 0.030), MAT.black, 0, 0.008, 0.152);
  // The barrel is enclosed by the slide on a real pistol, so what you actually
  // see at the front is the CROWN — a dark round hole in a round face. Without
  // it the muzzle is a flat rectangle of steel, which is the one thing that
  // makes a low-poly gun read as a block with a grip.
  part(g, cyl(0.0105, 0.0105, 0.014, 10), MAT.steel, 0, 0.038, 0.168, Math.PI / 2);
  part(g, cyl(0.0055, 0.0055, 0.016, 8), MAT.black, 0, 0.038, 0.170, Math.PI / 2);
  // and the bushing at the base of the barrel, under the slide
  part(g, cyl(0.0125, 0.0125, 0.006, 10), MAT.black, 0, 0.038, 0.158, Math.PI / 2);
  // --- sights: a post at the front, a notch at the back. Two cubes the size
  // of a grain of rice, and the gun stops being a lump.
  part(g, box(0.005, 0.008, 0.006), MAT.black, 0, 0.062, 0.166);
  part(g, box(0.020, 0.008, 0.006), MAT.black, 0, 0.062, -0.002);
  part(g, box(0.006, 0.007, 0.007), MAT.brass, 0, 0.062, 0.166);
  // --- trigger guard, built as three pieces so it is a LOOP and the finger has
  // somewhere to go
  part(g, box(0.024, 0.010, 0.046), MAT.black, 0, -0.012, 0.026);
  part(g, box(0.024, 0.026, 0.008), MAT.black, 0, -0.001, 0.004);
  part(g, box(0.024, 0.020, 0.008), MAT.black, 0, -0.006, 0.047);
  part(g, box(0.010, 0.024, 0.007), MAT.steel, 0, -0.006, 0.026);       // the trigger
  // --- grip: wedge-section, angled back into the palm, checkered
  const grip = part(g, wedge(0.032, 0.120, 0.100, 0.046), MAT.grip, 0, -0.062, -0.030);
  grip.rotation.x = -0.30;
  checkering(grip, 0.034, 0.10, 0.05, 0, -0.05, 0.002, 4);
  // the magazine floor plate, proud of the grip: the detail that says
  // "service pistol" rather than "block with a hole"
  const plate = part(g, box(0.030, 0.008, 0.044), MAT.black, 0, -0.116, -0.048);
  plate.rotation.x = -0.30;
  // --- hammer, cocked back over the beavertail
  part(g, box(0.008, 0.016, 0.010), MAT.steel, 0, 0.030, -0.014, -0.5, 0, 0);
  part(g, box(0.020, 0.014, 0.014), MAT.black, 0, 0.020, -0.018);
  return g;
}

function makeTec9() {
  const g = new THREE.Group();
  // --- receiver: the long box the whole gun is built around
  part(g, box(0.044, 0.052, 0.250), MAT.black, 0, 0.042, 0.125);
  part(g, box(0.038, 0.008, 0.244), MAT.steel, 0, 0.068, 0.125);      // top cover
  // ejection port and the bolt visible through it
  part(g, box(0.006, 0.024, 0.044), MAT.steel, 0.023, 0.046, 0.130);
  // --- barrel shroud: a MAC-10's signature, and the reason it does not look
  // like a pistol with a stick on it. Vent holes are the whole point.
  part(g, box(0.034, 0.034, 0.115), MAT.black, 0, 0.044, 0.300);
  for (let i = 0; i < 4; i++) {
    part(g, box(0.036, 0.012, 0.010), MAT.steel, 0, 0.044, 0.262 + i * 0.024);
  }
  part(g, tube(0.008, 0.135, 8), MAT.steel, 0, 0.044, 0.300);        // the barrel inside
  part(g, cyl(0.013, 0.013, 0.012, 8), MAT.steel, 0, 0.044, 0.368, Math.PI / 2);  // muzzle
  // --- magazine: IN FRONT of the grip, which is the MAC-10's whole layout and
  // the thing the old 5-box build got visibly wrong
  part(g, box(0.030, 0.115, 0.044), MAT.black, 0, -0.048, 0.078);
  part(g, box(0.032, 0.008, 0.046), MAT.steel, 0, -0.108, 0.078);    // magazine floor
  // witness marks down the side of the mag
  for (let i = 0; i < 3; i++) part(g, box(0.032, 0.004, 0.020), MAT.steel, 0, -0.020 - i * 0.028, 0.070);
  // --- foregrip: the support hand's target, and the rig aims the left arm here
  part(g, box(0.030, 0.040, 0.052), MAT.grip, 0, -0.012, 0.205);
  checkering(part(g, box(0.031, 0.038, 0.050), MAT.grip, 0, -0.012, 0.205), 0.031, 0.036, 0.050, 0, 0, 0, 3);
  // --- pistol grip
  const grip = part(g, wedge(0.032, 0.100, 0.086, 0.044), MAT.grip, 0, -0.050, -0.022);
  grip.rotation.x = -0.26;
  checkering(grip, 0.034, 0.086, 0.046, 0, -0.04, 0.002, 4);
  // --- trigger and guard
  part(g, box(0.010, 0.024, 0.007), MAT.steel, 0, 0.004, 0.020);
  part(g, box(0.024, 0.010, 0.040), MAT.black, 0, -0.010, 0.020);
  // --- charging handle, on the left as it is on the real thing
  part(g, box(0.036, 0.010, 0.010), MAT.steel, 0, 0.062, -0.006);
  // --- sights
  part(g, box(0.020, 0.010, 0.008), MAT.black, 0, 0.076, 0.010);
  part(g, box(0.006, 0.012, 0.006), MAT.black, 0, 0.076, 0.336);
  part(g, box(0.007, 0.010, 0.007), MAT.brass, 0, 0.076, 0.336);
  // --- folding wire stock, folded back along the receiver
  for (const s of [-1, 1]) {
    part(g, tube(0.004, 0.145, 6), MAT.steel, s * 0.019, 0.030, -0.070);
  }
  part(g, box(0.044, 0.008, 0.016), MAT.black, 0, 0.030, -0.138);
  return g;
}

function makeSawnoff() {
  const g = new THREE.Group();
  // --- two barrels with a rib between them: the silhouette of a sawn-off is
  // entirely in that pair, and the old build's two square boxes read as a
  // ladder
  for (const s of [-1, 1]) part(g, tube(0.0125, 0.360, 10), MAT.steel, s * 0.017, 0.054, 0.170);
  part(g, box(0.016, 0.012, 0.350), MAT.steel, 0, 0.070, 0.170);        // top rib
  part(g, box(0.040, 0.008, 0.340), MAT.steel, 0, 0.064, 0.170);        // the cut face between them
  // chamber ends, so the barrels are not open pipes
  for (const s of [-1, 1]) part(g, cyl(0.015, 0.015, 0.010, 10), MAT.steel, s * 0.017, 0.054, 0.348, Math.PI / 2);
  // --- breech: a solid block the barrels grow out of
  part(g, box(0.052, 0.048, 0.086), MAT.black, 0, 0.048, -0.020);
  part(g, box(0.056, 0.010, 0.050), MAT.steel, 0, 0.072, -0.020);       // top strap
  // --- wooden forend, wrapped round both barrels
  const fend = part(g, box(0.062, 0.048, 0.150), MAT.woodDark, 0, 0.040, 0.140);
  checkering(fend, 0.064, 0.044, 0.150, 0, 0, 0, 5);
  // --- the cut-off lever, on the left: the detail that says "this barrel used
  // to be longer"
  part(g, box(0.008, 0.014, 0.042), MAT.steel, -0.030, 0.036, 0.030, 0, 0, 0.25);
  part(g, cyl(0.008, 0.008, 0.008, 8), MAT.steel, -0.030, 0.030, 0.050, 0, 0, Math.PI / 2);
  // --- pistol grip
  const grip = part(g, wedge(0.036, 0.105, 0.092, 0.050), MAT.woodDark, 0, -0.052, -0.052);
  grip.rotation.x = -0.32;
  checkering(grip, 0.038, 0.092, 0.052, 0, -0.042, 0.002, 4);
  // --- trigger, guard, and the bead sight on the rib
  part(g, box(0.010, 0.026, 0.007), MAT.steel, 0, 0.014, 0.004);
  part(g, box(0.026, 0.010, 0.042), MAT.black, 0, 0.000, 0.006);
  part(g, box(0.026, 0.022, 0.008), MAT.black, 0, 0.010, -0.016);
  part(g, cyl(0.005, 0.005, 0.007, 8), MAT.brass, 0, 0.080, 0.330);
  return g;
}

function makeDeerRifle() {
  const g = new THREE.Group();
  // --- barrel: a real cylinder, octagonal at the muzzle the way a hunting
  // barrel is, and heavy under the forend
  part(g, tube(0.0125, 0.560, 10), MAT.steel, 0, 0.048, 0.320);
  part(g, cyl(0.016, 0.016, 0.070, 8), MAT.steel, 0, 0.048, 0.585, Math.PI / 2);   // muzzle crown
  // --- receiver
  part(g, box(0.044, 0.046, 0.190), MAT.steel, 0, 0.036, -0.010);
  part(g, box(0.046, 0.010, 0.150), MAT.black, 0, 0.060, -0.010);      // top of the receiver
  // the bolt handle, sticking out to the right: the single part that says
  // "bolt action" from any angle
  part(g, cyl(0.008, 0.008, 0.042, 8), MAT.steel, 0.030, 0.044, 0.048, 0, 0, Math.PI / 2);
  part(g, cyl(0.011, 0.011, 0.016, 8), MAT.steel, 0.050, 0.044, 0.048, 0, 0, Math.PI / 2);
  // --- stock: wrist, comb, then a butt that tapers. A rifle stock is not a
  // box, and the comb under the cheek is what makes it fit a shoulder.
  const wrist = part(g, wedge(0.044, 0.070, 0.058, 0.150), MAT.wood, 0, 0.022, -0.140);
  wrist.rotation.x = 0.10;
  const comb = part(g, box(0.042, 0.030, 0.170), MAT.wood, 0, 0.040, -0.230);
  comb.rotation.x = 0.06;
  part(g, taper(0.026, 0.030, 0.090, 8), MAT.wood, 0, 0.010, -0.345, Math.PI / 2);  // butt
  part(g, box(0.052, 0.070, 0.010), MAT.woodDark, 0, 0.008, -0.390);   // butt plate
  // --- forend under the barrel, tapered to the muzzle
  const fend = part(g, taper(0.021, 0.026, 0.230, 8), MAT.wood, 0, 0.020, 0.175, Math.PI / 2);
  // --- the magazine, floor plate proud of the stock
  part(g, box(0.034, 0.030, 0.070), MAT.steel, 0, -0.014, 0.030);
  part(g, box(0.036, 0.008, 0.072), MAT.black, 0, -0.030, 0.030);
  // --- trigger and guard
  part(g, box(0.010, 0.026, 0.007), MAT.steel, 0, 0.004, -0.036);
  part(g, box(0.026, 0.010, 0.044), MAT.wood, 0, -0.010, -0.036);
  // --- sights: a notch rear, a post front, and the front one on a little base
  part(g, box(0.022, 0.012, 0.008), MAT.black, 0, 0.068, -0.070);
  part(g, box(0.006, 0.010, 0.006), MAT.black, 0, 0.068, -0.066);
  part(g, box(0.010, 0.010, 0.010), MAT.black, 0, 0.062, 0.560);
  part(g, box(0.005, 0.010, 0.005), MAT.brass, 0, 0.070, 0.560);
  return g;
}

/**
 * The procedural models, exported so a test can build one and MEASURE it.
 *
 * Every builder is a contract, not just a function: the origin is the grip, +Z
 * is the muzzle, and the front of the barrel has to land on the weapon's
 * `muzzleOffset` — that node is where tracers, muzzle flash and shell ejection
 * start, so a model whose barrel overshoots it puts every effect in midair.
 * None of that is visible in a source read, which is why it is worth a test.
 */
export const BUILDERS = {
  bat: { build: makeBat },
  pistol: { build: makePistol },
  tec9: { build: makeTec9 },
  sawnoff: { build: makeSawnoff },
  deerRifle: { build: makeDeerRifle },
};

// ------------------------------------------------------------------ the GLB
// The gangster-rifle glTF still stands in for the deer rifle when it loads
// (assets/models/weapons/gangster_rifle). Its raw bounding box is ~0.70 × 3.79 ×
// 14.33 units, so it has to be measured rather than guessed at — the old
// hardcoded `scale 0.05` was luck, not a fit — and, because the file does not
// come with a grip marker, it is then shifted so that the point a hand would
// hold (about a third of the way back from the muzzle) lands on the origin, the
// same place the procedural models put their grip.
// Authored GLB stand-ins for the procedural builds below. `gripAt` is where
// along the model's long axis (0 = tail, 1 = muzzle) the hand actually closes —
// measured, not guessed, the same way the deer rifle's was — so the model lands
// grip-at-origin like every procedural build does.
// The deer rifle has a measured, long-approved authored model. The Styloo
// shotgun asset is currently unverified/broken, so the sawed-off remains on its
// original procedural steel-and-wood model in both first- and third-person.
export const GLB_SKINS = {
  // These authored assets already point down +Z; unlike the procedural builds,
  // they must not get the old guessed 180° flip that aimed them back at the player.
  //
  // ...which is true of the rifle and was ASSUMED of the MAC-10, which is why the
  // Tec-9 came out held backwards (human report, 2026-10-01: receiver to the
  // right of the muzzle, magazine on the wrong side). Measured from the files
  // rather than assumed: the rifle's extents are 0.70 x 3.79 x 14.33 — its long
  // axis is Z, so rotY 0 is right — while mac10.glb is 0.22 x 0.29 x 0.03 with
  // the barrel node (`mac10bt_low`) at +x and the receiver (`mac10derriere_low`)
  // at -x, so the gun arrives lying on its side across the hand. A quarter turn
  // puts the barrel back down +Z. Re-measure with tools/qa/probe_mac10.mjs if
  // either asset is ever replaced.
  deerRifle: { url: "assets/models/weapons/gangster_rifle/scene.gltf", length: 0.95, gripAt: 0.34, rotY: 0 },
  tec9: { url: "assets/models/weapons/styloo/mac10.glb", length: 0.5, gripAt: 0.4, rotY: -Math.PI / 2 },
};
const _glbSkins = new Map();     // id -> loaded THREE.Object3D
let _glbSkinsLoading = false;

function loadGlbSkins() {
  // A page-relative GLTF/GLB URL is meaningful in the game browser, but Node's
  // fetch-based GLTFLoader cannot resolve it. Keep the procedural weapon there;
  // the game browser still upgrades it to the authored asset when available.
  if (typeof document === "undefined" || !document.baseURI) return;
  const loader = new GLTFLoader();
  for (const [id, spec] of Object.entries(GLB_SKINS)) {
    loader.load(spec.url, (gltf) => {
      const model = gltf.scene;
      const bbox = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const longest = Math.max(size.x, size.y, size.z) || 1;
      model.scale.setScalar(spec.length / longest);
      model.rotation.y = spec.rotY || 0;                 // asset axis correction, MEASURED per asset above (see GLB_SKINS)
      bbox.setFromObject(model);
      bbox.getCenter(size);
      model.position.sub(size);                          // centred on the origin
      model.position.z -= (0.5 - spec.gripAt) * spec.length;  // then grip-forward onto it
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.frustumCulled = false;
        o.userData.noBatch = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m) continue;
          if (m.map) m.map.colorSpace = SRGBColorSpace;   // three r152+: encoding became colorSpace
          m.userData.gtbRealized = true;
        }
      });
      _glbSkins.set(id, model);
      if (rig.id === id && rig.model) swapInGlbSkin(rig.model, model);
    }, undefined, () => { /* offline / 404: the procedural build stays */ });
  }
}

/** Replace a procedural weapon's parts with its loaded GLB skin, in place. */
function swapInGlbSkin(model, glb) {
  if (!glb) return;
  for (const child of [...model.children]) {
    if (child.name === "muzzle") continue;
    model.remove(child);
  }
  model.add(glb);
}

// ---------------------------------------------------------------- the config
/**
 * How each weapon sits in the hand. `hold` is the only field weapons.js also
 * carries, because it is the one the character rig has to agree on.
 *
 * `foregrip` is where the SUPPORT hand goes, in grip-node space — i.e. along the
 * barrel, measured from the grip. Its distance up the weapon is what makes a
 * Tec-9 and a deer rifle hold differently without either being special-cased
 * anywhere: the left arm is solved onto that point whatever it is.
 */
export const WEAPON_RIGS = Object.freeze({
  bat: {
    // `orient: "melee"` gives the bat its own angle instead of sighting it down
    // the camera (see `meleeAim` below): cocked back over the shoulder at rest,
    // swept down and through on the strike. It is deliberately NOT aimed at the
    // crosshair — a bat is not a sighting device — and NOT left rigid in the
    // wrist either, because the wrist tumbles through every walk and dance clip
    // and a bat bolted to it would wave around on its own. rotationOffset is
    // identity: the model's +z IS the bat, so the solved direction is the bat.
    type: "melee", hold: "melee", orient: "melee", twoHanded: false,
    handOffset: [0, 0.005, 0.01], gripOffset: [0, 0, 0], rotationOffset: [0, 0, 0],
    scale: 1, muzzleOffset: [0, 0, 0.78], foregrip: null,
    recoil: { pitch: 0.5, yaw: 0.1, kick: 0.03, time: 0.3 }, layer: 2,
  },
  pistol: {
    type: "pistol", hold: "pistol", orient: "aim", twoHanded: false,
    // the front of the slide / dust cover, measured on the built model
    handOffset: [0, 0.0, 0.0], gripOffset: [0, 0, 0], rotationOffset: [0, 0, 0],
    scale: 1, muzzleOffset: [0, 0.038, 0.170], foregrip: null,
    recoil: { pitch: 0.34, yaw: 0.08, kick: 0.035, time: 0.2 }, layer: 1,
  },
  tec9: {
    type: "smg", hold: "long", orient: "aim", twoHanded: true,
    handOffset: [0, 0.0, -0.02], gripOffset: [0, 0, 0], rotationOffset: [0, 0, 0],
    // foregrip is the FOREGRIP/forend modelled in the build above, measured from
    // the grip — and it is also the one distance the support arm has to be able
    // to reach across to, so it is kept near the weapon's actual forend rather
    // than slid forward for looks. weapon_hold_test.mjs measures that reach.
    // the muzzle node is the front of the muzzle cap, measured on the built
    // model (0.368 + half its 12 mm length). It was 0.35, which is 24 mm short,
    // so every tracer and flash started in midair behind the gun.
    scale: 1, muzzleOffset: [0, 0.044, 0.374], foregrip: [0, -0.012, 0.205],
    recoil: { pitch: 0.22, yaw: 0.14, kick: 0.03, time: 0.12 }, layer: 1,
  },
  sawnoff: {
    type: "shotgun", hold: "long", orient: "aim", twoHanded: true,
    handOffset: [0, 0.0, -0.03], gripOffset: [0, 0, 0], rotationOffset: [0, 0, 0],
    // the front of the chamber ends, measured on the built model
    scale: 1, muzzleOffset: [0, 0.054, 0.353], foregrip: [0, 0.040, 0.140],
    recoil: { pitch: 0.6, yaw: 0.1, kick: 0.075, time: 0.4 }, layer: 1,
  },
  deerRifle: {
    type: "rifle", hold: "long", orient: "aim", twoHanded: true,
    handOffset: [0, 0.0, -0.03], gripOffset: [0, 0, 0], rotationOffset: [0, 0, 0],
    // measured on the built model: the muzzle crown's front face
    scale: 1, muzzleOffset: [0, 0.048, 0.62], foregrip: [0, 0.020, 0.175],
    recoil: { pitch: 0.5, yaw: 0.08, kick: 0.06, time: 0.5 }, layer: 1,
  },
});

const FALLBACK = "pistol";
const rigFor = (id) => WEAPON_RIGS[id] || WEAPON_RIGS[FALLBACK];

// ------------------------------------------------------------ the melee arc
// Where a bat points, through the swing. Measured in the BODY's vertical plane
// as an elevation off horizontal-forward: positive is up. ~125° is up and behind
// the shoulder (cocked); the strike carries it down to ~+20°, level and forward,
// which is the point in a swing that actually connects.
//
// This lives here rather than in characters.js because it is the WEAPON's angle,
// the same as a gun's barrel direction — the arm only decides where the fist is.
// The two are animated to the same clock (`attack`), so they read as one swing.
const MELEE_REST = 2.44;      // rad, ~140°: laid back over the shoulder
const MELEE_SWEEP = 1.92;     // rad, ~110° of arc, down to ~30° above horizontal
// The bat also leans OUT of the body's sagittal plane, on the side the gun hand
// is on. Without it the bat is coplanar with the spine, and a 0.78 m handle
// resting on a shoulder passes through the head on its way back. (Every
// character in the game is right-handed: `side` +1 is the support arm and the
// weapon hangs off the −x shoulder — see characters.js.)
const MELEE_OUT = -0.28;

// ---------------------------------------------------------------- the rig
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qIdent = new THREE.Quaternion();
const _m4 = new THREE.Matrix4();
const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3();
const _goal = new THREE.Vector3(), _tmp = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

const rig = {
  scene: null,
  actor: null,
  hand: null,
  grip: null,          // child of the hand: position = handOffset, orientation = solved
  recoil: null,        // recoil / reload: rotates about the GRIP, never about the model centre
  model: null,         // the current weapon model, grip at its origin
  muzzle: null,        // Object3D at muzzleOffset, for effect origins
  id: null,
  def: null,
  anim: { type: "idle", time: 0, duration: 0 },
};

/**
 * `scene` is accepted and unused: weapons are parented to the actor, so nothing
 * belongs in the scene graph at boot. Keeping the signature means main.js's
 * existing call site does not have to change, and keeping weapons OUT of the
 * scene until they are held matters — the parish-wide static batcher runs at
 * boot, and a mesh it cannot see is a mesh it cannot merge into a batch.
 */
export function initWeapons3D(scene) {
  rig.scene = scene || rig.scene;
  if (!_glbSkinsLoading) { _glbSkinsLoading = true; loadGlbSkins(); }
}

function buildModel(id) {
  const spec = BUILDERS[id] || BUILDERS[FALLBACK];
  const model = new THREE.Group();
  model.name = `weapon:${id}`;
  model.add(spec.build());
  // if this weapon's GLB skin has arrived, it stands in for the procedural one
  const glb = _glbSkins.get(id);
  if (glb) swapInGlbSkin(model, glb);
  return model;
}

function applyModelTransform() {
  const def = rig.def;
  rig.model.position.set(def.gripOffset[0], def.gripOffset[1], def.gripOffset[2]);
  rig.model.rotation.set(def.rotationOffset[0], def.rotationOffset[1], def.rotationOffset[2]);
  rig.model.scale.setScalar(def.scale);
  rig.model.renderOrder = def.layer;
  rig.model.traverse((o) => { if (o.isMesh) o.renderOrder = def.layer; });
  rig.muzzle.position.set(def.muzzleOffset[0], def.muzzleOffset[1], def.muzzleOffset[2]);
}

function selectModel(id) {
  if (rig.id === id && rig.def) return;
  const def = rigFor(id);
  rig.def = def;
  rig.id = id;
  if (rig.model && rig.model.parent) rig.model.parent.remove(rig.model);
  rig.model = buildModel(id);
  rig.muzzle = new THREE.Object3D();
  rig.muzzle.name = "muzzle";
  rig.model.add(rig.muzzle);
  applyModelTransform();
  rig.recoil.add(rig.model);
  rig.anim = { type: "idle", time: 0, duration: 0 };
}

/** Weld the rig to an actor's right hand. Rebuilt whenever the actor changes. */
function attachTo(actor) {
  detach();
  const hand = actor && actor.rightArm && actor.rightArm.hand;
  if (!hand) return false;
  const grip = new THREE.Group(); grip.name = "weaponGrip";
  const recoil = new THREE.Group(); recoil.name = "weaponRecoil";
  grip.add(recoil);
  hand.add(grip);
  rig.actor = actor; rig.hand = hand; rig.grip = grip; rig.recoil = recoil;
  rig.id = null;
  return true;
}

function detach() {
  if (rig.grip && rig.grip.parent) rig.grip.parent.remove(rig.grip);
  rig.actor = null; rig.hand = null; rig.grip = null; rig.recoil = null; rig.model = null; rig.muzzle = null;
  rig.id = null; rig.def = null;
}

/**
 * Point the weapon somewhere in the world, and convert that into the hand's
 * local frame. This is the whole of requirement (2) above:
 *
 *   gripLocal = handWorld⁻¹ · desiredWorld
 *
 * The basis is built from the direction plus world up, so the weapon has no roll
 * however the character is leaning, and it stays the right way up while the
 * wrist tumbles underneath it.
 */
function solveGrip(actor, wantDir) {
  _fwd.copy(wantDir);
  if (_fwd.lengthSq() < 1e-8) _fwd.set(0, 0, 1);
  _fwd.normalize();
  _right.crossVectors(WORLD_UP, _fwd);
  if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);          // aiming straight up or down
  _right.normalize();
  _up.crossVectors(_fwd, _right).normalize();
  _m4.makeBasis(_right, _up, _fwd);                            // +z = muzzle
  _q1.setFromRotationMatrix(_m4);                              // desiredWorld
  // It has to be the HAND's world rotation, not the actor's: the grip is a
  // child of the hand, and the hand carries the whole arm's rotation too. Using
  // the body here is off by the shoulder and elbow angles, which is the same
  // class of mistake as positioning the weapon off the player instead of the
  // hand — right answer for a T-pose, wrong for every frame since.
  rig.hand.getWorldQuaternion(_q2).invert();                   // handWorld⁻¹
  rig.grip.quaternion.copy(_q2).multiply(_q1);
}

/** Kick the muzzle, not the whole weapon: the rotation happens at the grip. */
function applyRecoil(dt) {
  const a = rig.anim, r = rig.def.recoil;
  if (a.time <= 0) {
    rig.recoil.position.set(0, 0, 0);
    rig.recoil.rotation.set(0, 0, 0);
    a.type = "idle";
    return;
  }
  a.time -= dt;
  const p = 1 - Math.max(0, a.time) / a.duration;              // 0 → 1
  if (a.type === "swing") {
    // A melee attack is animated by the ARM (characters.js applyWeaponHold),
    // and the bat is rigid in the fist that arm ends in — so there is nothing
    // to add on this node. The weapon moves because the hand moves, which is
    // the entire point of welding it there instead of positioning it.
    rig.recoil.position.set(0, 0, 0);
    rig.recoil.rotation.set(0, 0, 0);
    return;
  }
  if (a.type === "reload") {
    // A dip out of the aim and back, on the same node, so the grip never moves
    const k = Math.sin(Math.min(1, p) * Math.PI);
    rig.recoil.rotation.set(-0.55 * k, 0.18 * k, 0);
    rig.recoil.position.set(0, -0.05 * k, -0.04 * k);
    return;
  }
  // Recoil: snap out and settle, oscillating. `pitch` is how far the muzzle
  // climbs, `kick` how far the weapon rides back toward the shoulder.
  const rMul = a.recoilMul || 1;
  const k = Math.exp(-p * 5.5) * Math.cos(p * Math.PI * 1.6);
  rig.recoil.rotation.set(-r.pitch * rMul * k, r.yaw * rMul * k, 0);
  rig.recoil.position.set(0, 0, -r.kick * rMul * Math.max(0, k));
}

/**
 * Per-frame update. Call from the main tick AFTER the player's own update, so
 * the arm pose and the hand's world matrix are current — the weapon hangs off
 * the hand, so placing it before the pose would put it a frame behind the body.
 *
 * `hidden` (driving, cutscenes) drops the rig and clears the hold, which is what
 * leaves the character posed normally instead of frozen mid-aim.
 */
export function updateWeapon3D(actor, playerPos, aimDir, stateWeapon, dt, aiming, hidden = false, firing = false) {
  if (hidden || !actor) {
    if (rig.grip) rig.grip.visible = false;
    if (actor) actor.weaponHold = null;
    return;
  }
  if (rig.actor !== actor) { if (!attachTo(actor)) return; }
  selectModel(stateWeapon);
  rig.grip.visible = true;

  // 1. tell the character what it is holding, and let it pose the gun arm. The
  //    weapon then hangs off a hand that already knows where it is going.
  //    `attack` is the melee swing's progress (0 when not swinging): the arm
  //    plays the swing and the bat comes along, welded to the fist.
  const attack = rig.anim.type === "swing" && rig.anim.duration > 0
    ? 1 - Math.max(0, rig.anim.time) / rig.anim.duration : 0;
  const hold = { kind: rig.def.hold, aim: !!aiming, support: null, attack };
  actor.weaponHold = hold;
  actor.applyWeaponHold(dt);
  actor.updateMatrixWorld(true);

  // 2. into the hand
  rig.grip.position.set(rig.def.handOffset[0], rig.def.handOffset[1], rig.def.handOffset[2]);
  if (rig.def.orient === "melee") {
    // The bat's own arc, in the body's vertical plane, so it swings with the
    // torso and cannot be waved about by the wrist.
    const u = attack;
    const windUp = Math.sin(Math.min(1, u / 0.28) * Math.PI);
    const strike = u <= 0.28 ? 0 : Math.sin(((u - 0.28) / 0.72) * Math.PI);
    const th = MELEE_REST + 0.18 * windUp - MELEE_SWEEP * strike;
    const yaw = actor.rotation.y, sy = Math.sin(yaw), cy = Math.cos(yaw);
    // body-local direction, then rotated by the body's yaw
    const lx = MELEE_OUT, ly = Math.sin(th), lz = Math.cos(th);
    _goal.set(lx * cy + lz * sy, ly, -lx * sy + lz * cy);
  } else {
    _goal.copy(aimDir);
    if (!aiming && !firing) {
      // Not aiming or shooting: point along the body rather than the camera, so
      // the weapon does not swing around when the player looks about while
      // walking. On the trigger it follows the true aim, because a muzzle that
      // disagrees with the shot is the one thing a player always notices.
      _goal.set(Math.sin(actor.rotation.y), 0, Math.cos(actor.rotation.y));
    }
  }
  solveGrip(actor, _goal);
  applyRecoil(dt);

  // 3. the support hand. Solved onto the weapon's actual foregrip, which needs
  //    the weapon's world matrix — so this is the one thing that has to happen
  //    after the weapon is up.
  if (rig.def.twoHanded && rig.def.foregrip) {
    rig.grip.updateWorldMatrix(true, false);
    _tmp.set(rig.def.foregrip[0], rig.def.foregrip[1], rig.def.foregrip[2]);
    _tmp.applyMatrix4(rig.grip.matrixWorld);
    hold.support = _tmp.clone();
    // dt = 0: this pass only poses the SUPPORT arm onto the point we just
    // computed. It must not advance the carry→aim blend a second time, and it
    // must leave the gun arm exactly as it was — the grip's orientation was
    // solved against that hand's world rotation above, so moving it here would
    // invalidate the solve it already used.
    actor.applyWeaponHold(0);
  }
}

/**
 * A free-standing copy of a weapon's model for the first-person view (fpsview.js): the same
 * grip-at-origin build the character holds, barrel down +Z, at the rig's scale, with its muzzle
 * node — but parented to nothing, and drawn on top of the world (no depth test) so it never
 * sinks into a wall you are standing against.
 */
export function createViewmodel(id, { skinColor = 0xb07a5a, sleeveColor = 0x2b3a3a } = {}) {
  const def = rigFor(id);
  const model = buildModel(BUILDERS[id] ? id : FALLBACK);
  model.scale.setScalar(def.scale);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(def.muzzleOffset[0], def.muzzleOffset[1], def.muzzleOffset[2]);
  model.add(muzzle);
  // hands and a sleeve, so it is a gun someone is HOLDING and not one floating at the edge of the screen
  const skin = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.8, name: "viewmodel skin" });
  const sleeve = new THREE.MeshStandardMaterial({ color: sleeveColor, roughness: 0.9, name: "viewmodel sleeve" });
  const part = (w, h, d, m, x, y, z, rx = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.x = rx; model.add(b); return b; };
  if (def.type === "melee") {
    part(0.07, 0.07, 0.08, skin, 0, 0, 0);                                    // the fist round the handle
    part(0.06, 0.06, 0.34, sleeve, 0, -0.03, -0.2, 0.1);
  } else {
    part(0.04, 0.07, 0.06, skin, 0, -0.04, -0.01);                         // the firing hand on the grip
    part(0.05, 0.05, 0.34, sleeve, 0, -0.075, -0.2, 0.16);                 // forearm, running back under the eye
    if (def.twoHanded && def.foregrip) part(0.04, 0.04, 0.07, skin, def.foregrip[0], def.foregrip[1] - 0.04, def.foregrip[2]);   // the support hand on the forend
  }
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; o.renderOrder = 1000;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m) continue;
      m.depthTest = false; m.depthWrite = false;
      if (m.userData) m.userData.gtbRealized = true;
    }
  });
  return { model, muzzle, def };
}

/** The muzzle in world space, or null when nothing is held. */
export function getWeaponMuzzle(out) {
  if (!rig.muzzle || !rig.grip || !rig.grip.visible) return null;
  rig.muzzle.updateWorldMatrix(true, false);
  return out.setFromMatrixPosition(rig.muzzle.matrixWorld);
}

/** Where the barrel is pointing, in world space. */
export function getWeaponMuzzleDir(out) {
  if (!rig.muzzle || !rig.grip || !rig.grip.visible) return null;
  rig.muzzle.updateWorldMatrix(true, false);
  _fwd.set(0, 0, 1).applyQuaternion(_q1.setFromRotationMatrix(rig.muzzle.matrixWorld)).normalize();
  return out.copy(_fwd);
}

export function playFireAnim3D(weaponId, isMelee, recoilMul = 1) {
  const def = rigFor(weaponId);
  // Melee matches main.js's attackTimer (0.42 s) so the arm's swing and the
  // player clip end together instead of the pose popping off mid-swing.
  const t = isMelee ? 0.42 : def.recoil.time;
  rig.anim = { type: isMelee ? "swing" : "fire", time: t, duration: t, recoilMul };
  return rig.anim.type;
}

/** Called when a reload starts, so the weapon dips and comes back up. */
export function notifyReload3D(weaponId, seconds) {
  const def = rigFor(weaponId);
  if (!def || def.type === "melee") return;
  // The duration is the weapon's own reloadTime (weapons.js), passed in by the
  // arsenal's onReload hook, so the dip lasts exactly as long as the reload.
  const t = Math.max(0.3, seconds || 1);
  rig.anim = { type: "reload", time: t, duration: t };
}

/**
 * QA: the live rig, for a headless pass to interrogate.
 *
 * `state` is the presentation state named in one word, derived from the same
 * fields the game sets — so a test (or a debug HUD) can assert that what the
 * character LOOKS like is what the weapon IS doing:
 *
 *   idle | aiming | firing | reloading | melee_attacking
 *
 * It is derived, never assigned: `aiming` comes from the pose blend, `firing`
 * and `melee_attacking` and `reloading` from the animation the gameplay layer
 * started. There is no second copy of the state to fall out of sync.
 */
export function weaponRigState() {
  const aiming = rig.actor && rig.actor.weaponHold ? !!rig.actor.weaponHold.aim : false;
  const state = rig.anim.type === "reload" ? "reloading"
    : rig.anim.type === "swing" ? "melee_attacking"
      : rig.anim.type === "fire" ? "firing"
        : aiming ? "aiming" : "idle";
  return {
    id: rig.id, attached: !!(rig.actor && rig.grip), hidden: !!(rig.grip && !rig.grip.visible),
    anim: rig.anim.type, state,
    muzzleOffset: rig.def ? rig.def.muzzleOffset.slice() : null,
    handOffset: rig.def ? rig.def.handOffset.slice() : null,
    foregrip: rig.def && rig.def.foregrip ? rig.def.foregrip.slice() : null,
    twoHanded: !!(rig.def && rig.def.twoHanded),
  };
}

/** The muzzle in the weapon's own frame — the point effects should start from. */
export function weaponMuzzleOffset() {
  return rig.def ? rig.def.muzzleOffset.slice() : null;
}


export class RemoteWeaponRig {
  constructor(actor) {
    this.actor = actor;
    this.hand = actor.getObjectByName("mixamorigRightHand") || actor.arms[1].hand;
    this.grip = new THREE.Group();
    this.recoil = new THREE.Group();
    this.grip.add(this.recoil);
    this.hand.add(this.grip);
    this.model = null;
    this.muzzle = new THREE.Object3D();
    this.recoil.add(this.muzzle);
    this.id = null;
    this.def = null;
    this.anim = { type: "idle", time: 0, duration: 0 };
  }

  update(aimDir, stateWeapon, dt, aiming, firing) {
    if (!stateWeapon) {
      this.grip.visible = false;
      this.actor.weaponHold = null;
      return;
    }
    this.grip.visible = true;
    if (this.id !== stateWeapon) {
      this.id = stateWeapon;
      this.def = rigFor(stateWeapon);
      if (this.model) {
        this.recoil.remove(this.model);
        this.model = null;
      }
      this.model = buildModel(stateWeapon);      // (this said `builders[...]`, which does not exist: the remote rig threw on its first frame)
      this.recoil.add(this.model);
      if (this.def.rotationOffset) {
        this.model.rotation.set(this.def.rotationOffset[0], this.def.rotationOffset[1], this.def.rotationOffset[2]);
      }
      if (this.def.scale) {
        this.model.scale.setScalar(this.def.scale);
      }
      this.muzzle.position.set(this.def.muzzleOffset[0], this.def.muzzleOffset[1], this.def.muzzleOffset[2]);
    }

    const attack = this.anim.type === "swing" && this.anim.duration > 0 ? 1 - Math.max(0, this.anim.time) / this.anim.duration : 0;
    const hold = { kind: this.def.hold, aim: !!aiming, support: null, attack };
    this.actor.weaponHold = hold;
    this.actor.applyWeaponHold(dt);
    this.actor.updateMatrixWorld(true);

    this.grip.position.set(this.def.handOffset[0], this.def.handOffset[1], this.def.handOffset[2]);

    if (this.def.orient === "melee") {
      const u = attack;
      const windUp = Math.sin(Math.min(1, u / 0.28) * Math.PI);
      const strike = u <= 0.28 ? 0 : Math.sin(((u - 0.28) / 0.72) * Math.PI);
      const th = MELEE_REST + 0.18 * windUp - MELEE_SWEEP * strike;
      const yaw = this.actor.rotation.y, sy = Math.sin(yaw), cy = Math.cos(yaw);
      const lx = MELEE_OUT, ly = Math.sin(th), lz = Math.cos(th);
      _goal.set(lx * cy + lz * sy, ly, -lx * sy + lz * cy);
    } else {
      _goal.copy(aimDir);
      if (!aiming && !firing) {
        _goal.set(Math.sin(this.actor.rotation.y), 0, Math.cos(this.actor.rotation.y));
      }
    }

    // inline solveGrip
    this.hand.getWorldQuaternion(_q1);
    this.grip.quaternion.setFromUnitVectors(WORLD_UP, _goal);
    this.hand.getWorldQuaternion(_q2).invert();
    this.grip.quaternion.copy(_q2).multiply(this.grip.quaternion);
    
    // inline applyRecoil
    const a = this.anim, r = this.def.recoil;
    if (firing && a.time <= 0) {
      const t = this.def.type === "melee" ? 0.42 : r.time;
      this.anim = { type: this.def.type === "melee" ? "swing" : "fire", time: t, duration: t };
    }
    if (a.time <= 0) {
      this.recoil.position.set(0, 0, 0);
      this.recoil.rotation.set(0, 0, 0);
      a.type = "idle";
    } else {
      a.time -= dt;
      const p = 1 - Math.max(0, a.time) / a.duration;
      if (a.type !== "swing" && a.type !== "reload") {
        const k = Math.exp(-p * 5.5) * Math.cos(p * Math.PI * 1.6);
        this.recoil.rotation.set(-r.pitch * k, r.yaw * k, 0);
        this.recoil.position.set(0, 0, -r.kick * Math.max(0, k));
      } else {
        this.recoil.position.set(0, 0, 0);
        this.recoil.rotation.set(0, 0, 0);
      }
    }

    if (this.def.twoHanded && this.def.foregrip) {
      this.grip.updateWorldMatrix(true, false);
      _tmp.set(this.def.foregrip[0], this.def.foregrip[1], this.def.foregrip[2]);
      _tmp.applyMatrix4(this.grip.matrixWorld);
      hold.support = _tmp.clone();
      this.actor.applyWeaponHold(0);
    }
  }
}
