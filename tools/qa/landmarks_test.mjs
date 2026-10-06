// The places you can name (nolalandmarks.js).
//
//   node --experimental-detect-module tools/qa/landmarks_test.mjs
//
// "Make sure we have covered all the landmarks that would be present in New
// Orleans. Famous locations, historical locations, all need to be recognizable."
//
// Recognisable is measurable here in a way "it built something" is not, and the
// difference is the whole point. St. Louis Cathedral is three steeples with a
// tall one in the middle — a cathedral with one spire is a church, and the
// three-with-one-taller is the thing the whole city is recognised by. Jackson
// Square is the Cathedral PLUS the two Spanish colonial wings PLUS an
// equestrian statue: remove the wings and it is a church on a lawn.
//
// Every landmark here is therefore checked for the specific feature that makes
// it that landmark, and for the superblock it needs, because a Superdome placed
// on a 26 m plot is a drum poking through a car park.

import * as THREE from "three";
import { readFileSync } from "node:fs";
import { RESERVES, CITY } from "../../src/orlearouge.js";
import { createNewOrleansLandmarks, SITES } from "../../src/nolalandmarks.js";

let seed = 99;
Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const ctx2d = () => ({
  fillRect() {}, clearRect() {}, fillText() {}, strokeText() {}, drawImage() {},
  beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, save() {}, restore() {},
  translate() {}, rotate() {}, scale() {}, putImageData() {}, stroke() {},
  createRadialGradient: () => ({ addColorStop() {} }),
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  set fillStyle(v) {}, get fillStyle() { return "#000"; },
  set strokeStyle(v) {}, get strokeStyle() { return "#000"; },
  set font(v) {}, get font() { return ""; },
  set textAlign(v) {}, set textBaseline(v) {}, set lineWidth(v) {}, set globalAlpha(v) {},
});
globalThis.document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: ctx2d }) };

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL " } ${label}${detail ? `  — ${detail}` : ""}`);
};

const scene = new THREE.Scene();
const pois = [], occluders = [], blockers = [], signs = [];
const matFor = (color) => { const m = new THREE.MeshBasicMaterial({ color }); m.userData.gtbRealized = true; return m; };
const kit = {
  P: null,                                     // filled in below from cityparts
  mesh: (geo, mat, x, y, z, o = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (o.ry) m.rotation.y = o.ry;
    if (o.parent) o.parent.add(m); else scene.add(m);
    return m;
  },
  std: (color, name, extra = {}) => { const m = new THREE.MeshStandardMaterial({ name, color, ...extra }); m.userData.gtbRealized = true; return m; },
  basic: (c) => matFor(c),
  pois, occluders,
  sign: (text, w, h, x, y, z, ry, ink, bg) => signs.push({ text, x, y, z }),
};
const { createCityParts } = await import("../../src/cityparts.js");
kit.P = createCityParts({ addBlocker: (x, z, r) => blockers.push({ x, z, r }) }, { occluders: kit.occluders });

const L = createNewOrleansLandmarks({ scene, addBlocker: (x, z, r) => blockers.push({ x, z, r }), addLitSpot() {} }, kit);

// ---------------------------------------------------------------- superblocks
// A superblock is emitted ONCE per reserve. This is a real bug that happened:
// the 260 m Superdome reserve covers sixteen grid cells and each of them
// reported its midpoint as inside it, so the stadium was built sixteen times
// inside itself.
{
  const names = RESERVES.map((r) => r.label);
  check("reserves have unique names", new Set(names).size === names.length, names.join(", "));
  for (const r of RESERVES) {
    check(`${r.label} is a real superblock, not a plot`, (r.x1 - r.x0) > 60 && (r.z1 - r.z0) > 60,
      `${r.x1 - r.x0} x ${r.z1 - r.z0} m`);
    check(`${r.label} is inside the city`, r.x0 >= CITY.minX && r.x1 <= CITY.maxX && r.z0 >= CITY.minZ && r.z1 <= CITY.maxZ,
      `${r.x0}..${r.x1}, ${r.z0}..${r.z1}`);
  }
  const src = readFileSync(new URL("../../src/orlearouge.js", import.meta.url), "utf8");
  check("reserves are emitted once, not once per grid cell", /const emitted = new Set\(\)/.test(src) && /if \(emitted\.has\(reserve\.label\)\) continue;/.test(src));
  // STREET_CUTS is RESERVES plus the seam and the viaduct plaza, so cutting by it still cuts every reserve
  check("streets are cut around reserves, not drawn through them",
    /const STREET_CUTS = Object\.freeze\(\[\s*\.\.\.RESERVES,/.test(src) && /STREET_CUTS\.filter\(\(r\) => !r\.streetsOnly && x > r\.x0 - STREET_W/.test(src));
  // every landmark needs a reserve of its own, matched by name
  for (const s of SITES) check(`${s.label} has a superblock to stand on`, names.includes(s.label));
  check("every superblock has a landmark, or is deliberately spare", names.length >= SITES.length);
}

// ---------------------------------------------------------------- build them
const blockFor = (label) => {
  const r = RESERVES.find((x) => x.label === label);
  return { x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1, cx: (r.x0 + r.x1) / 2, cz: (r.z0 + r.z1) / 2, reserve: true, label };
};
const claims = new Set();
const built = L.build(RESERVES.map((r) => blockFor(r.label)), claims);
check("every landmark built", L.missing.length === 0, L.missing.join(", "));
check("every landmark claimed its block", claims.size === SITES.length, `${claims.size} of ${SITES.length}`);

// Every measurement below reads a world matrix, and a freshly-built scene has
// not computed one: a mesh placed at (-85, 13, 440) still has an identity
// matrixWorld until something asks for it, so every bounding box comes back as
// the raw geometry at the origin. That is not a subtle wrong answer — the
// Cathedral measures as 30 m wide sitting on 0,0.
scene.updateMatrixWorld(true);

// true world extents, from the vertices
const trueBox = (obj) => {
  obj.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  obj.traverse((m) => {
    if (!m.isMesh) return;
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); min.min(v); max.max(v); }
  });
  return { min, max, w: max.x - min.x, d: max.z - min.z, h: max.y - min.y };
};
/** Is anything of this material inside the landmark's block? */
const hasPart = (label, matName) => {
  const b = blockFor(label);
  let found = false;
  scene.traverse((m) => {
    if (!m.isMesh || m.material?.name !== matName) return;
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
    if (bb.max.x > b.x0 && bb.min.x < b.x1 && bb.max.z > b.z0 && bb.min.z < b.z1) found = true;
  });
  return found;
};
const countParts = (label, matName) => {
  const b = blockFor(label); let n = 0;
  scene.traverse((m) => {
    if (!m.isMesh || m.material?.name !== matName) return;
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
    if (bb.max.x > b.x0 && bb.min.x < b.x1 && bb.max.z > b.z0 && bb.min.z < b.z1) n++;
  });
  return n;
};

// ---------------------------------------------------------------- the Cathedral
{
  const b = blockFor("Jackson Square");
  check("the Cathedral stands", hasPart("Jackson Square", "cathedral stucco"));
  // THREE steeples, and the middle one much taller. This is the silhouette the
  // whole city is recognised by; one spire is a church. Counted, not asserted:
  // a cathedral that lost one of its steeples would still pass any check that
  // only asked whether something tall was there.
  const bb = trueBox(scene);
  // The cross is a 0.22 x 3.0 x 0.22 post. Matching on height alone also caught
  // the twelve arcade openings in the Spanish wings, which are 3.0 m tall too.
  const golds = [];
  scene.traverse((m) => {
    const p = m.geometry?.parameters;
    if (!m.isMesh || m.geometry?.type !== "BoxGeometry" || p.width !== 0.22 || p.height !== 3.0) return;
    m.geometry.computeBoundingBox();
    const bb2 = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
    if (bb2.max.x > b.x0 && bb2.min.x < b.x1 && bb2.max.z > b.z0 && bb2.min.z < b.z1) golds.push(m);
  });
  check("the Cathedral has three steeples, each with a cross", golds.length === 3, `${golds.length} crosses on the square`);
  // and the middle one is the tall one: sort the three by height
  const spireTops = golds.map((m) => {
    m.geometry.computeBoundingBox();
    return m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld).max.y;
  }).sort((a, b) => b - a);
  check("the central steeple is much the tallest", spireTops[0] > spireTops[1] * 1.4,
    `${spireTops[0].toFixed(0)} m vs ${spireTops[1].toFixed(0)} m`);
  check("St. Louis Cathedral is the tallest thing on the square", bb.h > 80, `${bb.h.toFixed(0)} m`);

  // THE STEEPLES HAVE TO BE ATTACHED. Every check above counts crosses and
  // compares heights, and every one of them passed while the towers were in the
  // air: the shaft was built as BoxGeometry(shaft, shaft, shaft) — a CUBE of the
  // tower's WIDTH — with the spire placed on top of where a full-height shaft
  // would have ended. So the middle steeple had 25.5 m of nothing between its
  // cube and its spire, and the two end ones 14.5 m, and the skyline read as
  // three spires hovering over a church. (photographed, 2026-09-28)
  //
  // Counting was never going to find that. This measures the joint: for each
  // spire, does the tower beneath it start at the roof and end where the spire
  // begins?
  {
    const cones = [];
    scene.traverse((m) => {
      if (!m.isMesh || m.geometry?.type !== "ConeGeometry") return;
      m.geometry.computeBoundingBox();
      const q = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
      if (q.max.x > b.x0 && q.min.x < b.x1 && q.max.z > b.z0 && q.min.z < b.z1) cones.push(q);
    });
    check("the Cathedral has three spires to stand on", cones.length === 3, `${cones.length} spires`);

    // the tower shafts: stucco boxes that reach up past the roofline
    const shafts = [];
    scene.traverse((m) => {
      if (!m.isMesh || m.material?.name !== "cathedral stucco") return;
      const p = m.geometry?.parameters;
      if (!p || p.width !== p.depth) return;              // a shaft, not the nave
      m.geometry.computeBoundingBox();
      const q = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
      if (q.max.y > 40) shafts.push(q);
    });
    check("...and three tower shafts under them", shafts.length === 3, `${shafts.length} shafts`);

    if (cones.length === 3 && shafts.length === 3) {
      // The roofline: the top of the body/roof the shafts have to start from.
      const roofTop = 30.4;
      for (const cone of cones) {
        // the shaft this spire belongs to is the one under the same x/z
        const sx = (cone.min.x + cone.max.x) / 2, sz = (cone.min.z + cone.max.z) / 2;
        const sh = shafts.filter((s) => Math.abs((s.min.x + s.max.x) / 2 - sx) < 1
          && Math.abs((s.min.z + s.max.z) / 2 - sz) < 1);
        check(`the spire at (${sx.toFixed(0)}, ${sz.toFixed(0)}) has a tower under it`, sh.length === 1);
        if (sh.length !== 1) continue;
        const s = sh[0];
        check("  ...that starts on the roof", Math.abs(s.min.y - roofTop) < 1.5,
          `shaft base y ${s.min.y.toFixed(1)}, roof y ${roofTop}`);
        check("  ...and ends where the spire begins", Math.abs(s.max.y - cone.min.y) < 1.0,
          `shaft top y ${s.max.y.toFixed(1)}, spire base y ${cone.min.y.toFixed(1)}`,
        );
      }
    }
  }
  // the two wings, which are half of what the square looks like
  check("the Cabildo is there", signs.some((s) => s.text === "THE CABILDO"));
  check("the Presbytère is there", signs.some((s) => s.text === "THE PRESBYTÈRE"));
  check("the square has its Spanish colonial arcades", hasPart("Jackson Square", "spanish colonial stucco"));
  check("the square has paving", hasPart("Jackson Square", "square paving"));
  check("the square has its iron railing to the river", hasPart("Jackson Square", "wrought iron railing"));
  check("Andrew Jackson is on a horse in the middle of it", hasPart("Jackson Square", "bronze"));
}

// ---------------------------------------------------------------- the Superdome
{
  const b = blockFor("The Superdome");
  const box = trueBox(scene);
  check("the Superdome is built", hasPart("The Superdome", "stadium precast"));
  check("the Superdome has a roof", hasPart("The Superdome", "stadium roof"));
  check("the Superdome is enormous", (b.x1 - b.x0) > 200, `${b.x1 - b.x0} m of superblock`);
  // a drum under a lid, standing in parking — the thing that makes it read as
  // the Superdome and not as a very wide tower
  check("the Superdome has floodlight masts", hasPart("The Superdome", "light mast"));
  check("the Superdome stands in a car park", hasPart("The Superdome", "surface parking"));
  check("there are cars in it", countParts("The Superdome", "parked car") > 20, `${countParts("The Superdome", "parked car")}`);
  // it must fit INSIDE its superblock, or the plaza runs over the street.
  // A Box3, not a Vector3: `Vector3.min(someBox3)` reads `.x` off a Box3, gets
  // undefined, and quietly returns NaN for every axis.
  const roofBox = new THREE.Box3();
  let roofs = 0;
  scene.traverse((m) => {
    if (!m.isMesh || m.material?.name !== "stadium roof") return;
    m.geometry.computeBoundingBox();
    roofBox.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld));
    roofs++;
  });
  check("the Superdome's roof was measured", roofs === 1, `${roofs} roof meshes`);
  check("the Superdome fits inside its superblock",
    roofBox.max.x - roofBox.min.x < (b.x1 - b.x0) && roofBox.max.z - roofBox.min.z < (b.z1 - b.z0),
    `${(roofBox.max.x - roofBox.min.x).toFixed(0)} x ${(roofBox.max.z - roofBox.min.z).toFixed(0)} m in a ${b.x1 - b.x0} x ${b.z1 - b.z0} m block`);
  check("the Superdome is centred on its superblock",
    Math.abs((roofBox.max.x + roofBox.min.x) / 2 - b.cx) < 2 && Math.abs((roofBox.max.z + roofBox.min.z) / 2 - b.cz) < 2,
    `roof at ${((roofBox.max.x + roofBox.min.x) / 2).toFixed(0)},${((roofBox.max.z + roofBox.min.z) / 2).toFixed(0)} vs block ${b.cx},${b.cz}`);
  check("the Superdome is signed", signs.some((s) => s.text === "SUPERDOME"));
}

// ---------------------------------------------------------------- City Park
{
  check("City Park has lawn", hasPart("City Park", "park lawn"));
  check("City Park has a bandstand", hasPart("City Park", "bandstand roof"));
  check("City Park has a lagoon", hasPart("City Park", "lagoon water"));
  check("City Park has live oaks", hasPart("City Park", "live oak bark"));
  check("City Park has spanish moss, which is the Louisiana detail", hasPart("City Park", "spanish moss"));
  check("City Park has a monument", hasPart("City Park", "bronze") || hasPart("City Park", "granite plinth"));
  const b = blockFor("City Park");
  check("City Park is big enough to be a park", (b.x1 - b.x0) * (b.z1 - b.z0) > 15000,
    `${((b.x1 - b.x0) * (b.z1 - b.z0) / 1000).toFixed(0)}k m2`);
}

// ---------------------------------------------------------------- the rest
{
  check("the French Market has its iron sheds", hasPart("French Market", "market ironwork"));
  check("the French Market has produce on the trestles", hasPart("French Market", "market produce"));
  check("the French Market is signed", signs.some((s) => s.text === "FRENCH MARKET"));
  check("Loyola has a cloister of ranges", hasPart("Loyola University", "campus brick"));
  check("Loyola has a chapel spire", hasPart("Loyola University", "chapel slate roof"));
  check("Loyola has a quad", hasPart("Loyola University", "park lawn"));
  check("Loyola is signed", signs.some((s) => s.text === "LOYOLA UNIVERSITY"));
}

// ---------------------------------------------------------------- named places
{
  const wanted = ["St. Louis Cathedral", "Jackson Square", "The Superdome", "City Park", "French Market", "Loyola University", "THE CABILDO", "THE PRESBYTÈRE"];
  for (const w of wanted) check(`"${w}" is a named place in the world`, pois.some((p) => p.label === w));
  check("every place you can name is reachable", pois.filter((p) => wanted.includes(p.label)).every((p) => p.r >= 6),
    "a POI the player cannot walk into is not a place");
}

if (failures) { console.error(`landmarks_test: ${failures} failure(s)`); process.exit(1); }
console.log("landmarks_test: all checks passed");
