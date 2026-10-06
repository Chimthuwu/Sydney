// The New Orleans building stock (cityparts.js).
//
//   node --experimental-detect-module tools/qa/nola_parts_test.mjs
//
// "It needs to look AND feel like New Orleans" — and the reason that needs
// testing is that every one of these parts is a SHAPE claim, not a decoration.
// A Creole townhouse is only Creole if the upper floor projects over the street
// on brackets; a shotgun is only a shotgun if it is narrow and deep; the
// Superdome is only the Superdome if it is a drum under a shallow lid and not
// another tower. All of that is assertable from the geometry, and all of it is
// the sort of thing that quietly stops being true when someone tunes a number.
//
// So these measure what was built. The triangle budget is checked too: a
// metropolis made of parts that each cost 40k triangles is not shippable, and
// the whole point of the block-clusters culling by distance is that a block's
// parts are only paid for when you can see them.

import * as THREE from "three";
import { readFileSync } from "node:fs";

// cityparts.js draws window textures on a canvas at construction time.
let seed = 12345;
Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
globalThis.document = {
  createElement: () => ({
    width: 0, height: 0, style: {},
    getContext: () => ({
      fillRect: () => {}, clearRect: () => {}, fillText: () => {}, strokeText: () => {},
      beginPath: () => {}, closePath: () => {}, moveTo: () => {}, lineTo: () => {}, arc: () => {}, save: () => {}, restore: () => {},
      createRadialGradient: () => ({ addColorStop: () => {} }),
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {}, drawImage: () => {}, translate: () => {}, rotate: () => {}, scale: () => {},
      set fillStyle(v) {}, get fillStyle() { return "#000"; },
      set strokeStyle(v) {}, get strokeStyle() { return "#000"; },
      set font(v) {}, get font() { return ""; },
      set textAlign(v) {}, set textBaseline(v) {}, set lineWidth(v) {},
    }),
  }),
};

const { createCityParts } = await import("../../src/cityparts.js");

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL " } ${label}${detail ? `  — ${detail}` : ""}`);
};

const occluders = [];
const blockers = [];
const P = createCityParts({ addBlocker: (x, z, r) => blockers.push({ x, z, r }) }, { occluders });

/**
 * True world extents, from the vertices.
 *
 * Box3.setFromObject is NOT good enough here: for a rotated mesh it transforms
 * the geometry's axis-aligned LOCAL bounding box, which is the box around the
 * rotated box rather than the rotated box itself. A 45-degree hipped roof reads
 * as 1.27x too wide, which is enough to make a correctly-fitted roof look like
 * it is overhanging the street by four metres.
 */
const trueBox = (obj) => {
  obj.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  obj.traverse((m) => {
    if (!m.isMesh) return;
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      min.min(v); max.max(v);
    }
  });
  return { min, max, width: max.x - min.x, depth: max.z - min.z, height: max.y - min.y };
};

const build = (fn) => {
  const g = new THREE.Group();
  const before = { occluders: occluders.length, blockers: blockers.length };
  const out = fn(g);
  let tris = 0, meshes = 0;
  const b = trueBox(out || g);
  (out || g).traverse((m) => {
    if (!m.isMesh) return;
    meshes++;
    const idx = m.geometry.index;
    tris += (idx ? idx.count : m.geometry.attributes.position.count) / 3;
  });
  return { g, out, tris, meshes, box: { min: b.min, max: b.max }, width: b.width, depth: b.depth, height: b.height, grew: (n) => n > before[n] };
};

// ---------------------------------------------------------------- exported
for (const name of ["creole", "gothic", "shotgun", "midrise", "garage", "stadium", "statue", "fountain", "bandstand", "park"]) {
  check(`cityparts exports ${name}()`, typeof P[name] === "function");
}

// ---------------------------------------------------------------- proportions
// These are the claims. Each is a number the real building has and a generic
// one does not.
{
  const s = build((g) => P.shotgun(g, 0, 0, 1, 3));
  check("a shotgun house is narrow and deep", s.width < 5 && s.depth > 15, `${s.width.toFixed(1)} x ${s.depth.toFixed(1)} m`);
  check("a shotgun is low", s.height < 8, `${s.height.toFixed(1)} m tall`);
}
{
  const c = build((g) => P.creole(g, 0, 0, 8, 1, 1));
  // The upper floor projects over the street. Measure the two STOREY BLOCKS —
  // the widest mesh in each band — rather than the frontmost thing at that
  // height, which is a 0.12 m bracket and says nothing about the storey.
  const frontOfStorey = (minY, maxY) => {
    let best = -Infinity, bestArea = 0;
    c.out.traverse((m) => {
      if (!m.isMesh || m.position.y < minY || m.position.y > maxY) return;
      const p = m.geometry.parameters;
      if (!p || !p.depth) return;
      const area = (p.width || 0) * p.depth;
      if (area <= bestArea) return;
      bestArea = area;
      best = m.position.z + p.depth / 2;
    });
    return best;
  };
  const ground = frontOfStorey(0, 4.5), upper = frontOfStorey(4.5, 8);
  check("a Creole upper floor projects over the street", upper > ground + 0.4,
    `ground floor front ${ground.toFixed(2)} m, upper ${upper.toFixed(2)} m`);
  check("a Creole house is two storeys", c.height > 6 && c.height < 12, `${c.height.toFixed(1)} m`);
}
{
  const go = build((g) => P.gothic(g, 0, 0, 14, 1, 2));
  const s = build((g) => P.shotgun(g, 0, 0, 1, 3));
  // the Garden District is the opposite of a shotgun in every dimension, and
  // putting them on one street is the point of the district
  check("a Garden District house is much wider than a shotgun", go.width > s.width * 3, `${go.width.toFixed(1)} m vs ${s.width.toFixed(1)} m`);
  check("a Garden District house is much shallower than a shotgun", go.depth < s.depth * 0.75, `${go.depth.toFixed(1)} m vs ${s.depth.toFixed(1)} m`);
  // The roof must sit ON the house. A 4-sided cone's radius is its corner-to-
  // corner distance, so scaling one by the footprint's larger dimension gives a
  // roof several metres wider than the walls on every side.
  check("a Garden District roof does not overhang its walls", go.width < 14 + 1.0, `${go.width.toFixed(1)} m for a 14 m house`);
  check("a Creole roof does not overhang its walls", build((g) => P.creole(g, 0, 0, 8, 1, 1)).width < 8 + 1.0);
}
{
  const m = build((g) => P.midrise(g, 0, 0, 20, 16, 24, 4));
  check("a midrise stands 24 m", Math.abs(m.height - 25) < 4, `${m.height.toFixed(1)} m`);
  check("a midrise blocks movement", blockers.length > 0);
}
{
  const ga = build((g) => P.garage(g, 0, 0, 30, 18, 4, 5));
  check("a garage is as tall as its floors say", ga.height > 10 && ga.height < 20, `${ga.height.toFixed(1)} m for 4 floors`);
}

// ---------------------------------------------------------------- the Superdome
{
  const st = build((g) => P.stadium(g, 0, 0, 96));
  check("the stadium is enormous", st.width > 200, `${st.width.toFixed(0)} m across`);
  // Measured to the LID. The real Superdome is 187 m across and about 107 m to
  // the top of the roof; a sphere segment taken from its pole rises by its own
  // radius instead, which put 100 m of balloon on a 32 m drum.
  let lid = 0, mast = 0;
  st.out.traverse((m) => {
    if (!m.isMesh) return;
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
    if (m.material?.name === "stadium roof") lid = Math.max(lid, bb.max.y);
    if (m.material?.name === "light mast" || m.material?.name === "floodlight bank") mast = Math.max(mast, bb.max.y);
  });
  check("the stadium is a drum, not a tower", st.height < st.width * 0.4, `${st.height.toFixed(0)} m tall vs ${st.width.toFixed(0)} m wide`);
  check("the roof is a shallow lid", lid > 40 && lid < st.width * 0.3, `lid tops out at ${lid.toFixed(0)} m`);
  check("the lid is the silhouette, not the floodlights", lid > mast, `lid ${lid.toFixed(0)} m vs masts ${mast.toFixed(0)} m`);
  check("the stadium occludes the camera", occluders.some((o) => o.maxY > 40));
  const mid = build((g) => P.midrise(g, 0, 0, 30, 20, 20, 1));
  check("nothing else in the stock is that big", st.width > mid.width * 4);
}

// ---------------------------------------------------------------- civic pieces
{
  for (const kind of ["soldier", "bronze", "pelican"]) {
    const s = build((g) => P.statue(g, 0, 0, kind, 7));
    check(`a ${kind} statue stands up`, s.height > 5, `${s.height.toFixed(1)} m`);
    check(`a ${kind} statue is solid`, s.height < 30);
  }
}
{
  const f = build((g) => P.fountain(g, 0, 0, 5));
  check("a fountain has water and a jet", f.meshes > 3);
}
{
  const b = build((g) => P.bandstand(g, 0, 0));
  check("a bandstand is a round pavilion", b.width < 14, `${b.width.toFixed(1)} m across`);
  check("a bandstand is walk-into", b.height > 4, `${b.height.toFixed(1)} m`);
}
{
  const p = build((g) => P.park(g, 0, 0, 60, 40, 11));
  // A live oak in City Park is 15-20 m; these are deliberately on the short side
  // so the park reads as open ground you can see across. The assertion is that
  // the GROUND is flat — nothing but planting may stand above head height.
  check("a park is flat ground with trees on it", p.height < 12, `${p.height.toFixed(1)} m to the top of the canopy`);
  check("a park plants several trees", p.meshes > 8, `${p.meshes} meshes`);
  const lawn = p.out.children.find((m) => m.isMesh && m.material?.name === "park lawn");
  check("a park has lawn", !!lawn && lawn.position.y < 0.2, lawn ? `at y ${lawn.position.y}` : "no lawn");
  check("a park has crossing paths", p.out.children.some((m) => m.isMesh && m.material?.name === "park path"));
  check("a park has live oaks with spanish moss", p.out.children.some((m) => m.isMesh && m.material?.name === "spanish moss"));
}

// ---------------------------------------------------------------- collision + occlusion
// A building you can walk through is worse than a building that is missing,
// because the player discovers it by bumping into it.
{
  blockers.length = 0; occluders.length = 0;
  P.midrise(new THREE.Group(), 10, 10, 20, 16, 24, 1);
  P.creole(new THREE.Group(), 40, 10, 8, 1, 1);
  P.garage(new THREE.Group(), 80, 10, 30, 18, 4, 2);
  P.shotgun(new THREE.Group(), 120, 10, 1, 3);
  check("every solid part registers a blocker", blockers.length > 8, `${blockers.length} blockers`);
  check("the solids register occluders for the camera", occluders.length >= 3, `${occluders.length}`);
  check("no blocker sits at the origin by accident", blockers.every((b) => Math.hypot(b.x, b.z) > 1));
}

// ---------------------------------------------------------------- cost
// A metropolis has to be affordable. These are per-instance, and a block holds
// two or three, so the number that matters is roughly three times the worst.
for (const [name, fn, budget] of [
  ["creole", (g) => P.creole(g, 0, 0, 8, 1, 1), 4000],
  ["gothic", (g) => P.gothic(g, 0, 0, 14, 1, 2), 5000],
  ["shotgun", (g) => P.shotgun(g, 0, 0, 1, 3), 2000],
  ["midrise", (g) => P.midrise(g, 0, 0, 20, 16, 24, 4), 6000],
  ["garage", (g) => P.garage(g, 0, 0, 30, 18, 4, 5), 6000],
  ["stadium", (g) => P.stadium(g, 0, 0, 96), 12000],
  ["park", (g) => P.park(g, 0, 0, 60, 40, 11), 20000],
]) {
  const b = build(fn);
  check(`${name} costs under ${budget} triangles`, b.tris < budget, `${Math.round(b.tris)} triangles, ${b.meshes} meshes`);
}

if (failures) { console.error(`nola_parts_test: ${failures} failure(s)`); process.exit(1); }
console.log("nola_parts_test: all checks passed");
