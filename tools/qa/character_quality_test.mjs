// The character rig's roundness pass. Reads the real geometry rather than
// trusting the source: are the boxes chamfered, are the limbs round, is there a
// hand with fingers, and is the triangle bill still one we can pay?
import * as THREE from "three";

const noop = () => {};
const gradient = { addColorStop: noop };
const context2d = {
  fillStyle: "", font: "", textAlign: "", textBaseline: "", globalAlpha: 1,
  fillRect: noop, fillText: noop, save: noop, restore: noop, translate: noop,
  rotate: noop, scale: noop, beginPath: noop, closePath: noop, moveTo: noop,
  lineTo: noop, arc: noop, rect: noop, fill: noop, stroke: noop, clip: noop,
  clearRect: noop, drawImage: noop, createLinearGradient: () => gradient,
  createRadialGradient: () => gradient, getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  putImageData: noop, measureText: () => ({ width: 10 }),
  createImageData: () => ({ data: new Uint8ClampedArray(4) }),
  setLineDash: noop, setTransform: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
  ellipse: noop, arcTo: noop, strokeRect: noop, strokeText: noop,
  lineCap: "", lineJoin: "", strokeStyle: "", lineWidth: 0, shadowColor: "", shadowBlur: 0,
};
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => context2d }),
  head: { appendChild() {} }, body: { appendChild() {} },
  getElementById: () => null, addEventListener() {},
};

const { randomHoodrat, makeStripper, makeHog } = await import("../../src/characters.js");

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
};

const tris = (o) => {
  let n = 0;
  o.traverse((m) => {
    if (m.isMesh && m.geometry) {
      const g = m.geometry;
      n += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
  });
  return Math.round(n);
};
const geometries = (o) => {
  const set = new Set();
  o.traverse((m) => { if (m.isMesh && m.geometry && m !== o.blob) set.add(m.geometry); });
  return [...set];
};

const man = randomHoodrat(() => 0.5, 1.85);
const woman = makeStripper({ sex: "f", seed: 5, height: 1.8 });

// ---- 1. no razor edges left -------------------------------------------------
// Two things make this fiddly and both are worth knowing:
//   * roundedBox() deliberately falls back to a plain box when the chamfer
//     would be sub-pixel: it uses min(CHAMFER, smallest/7) and declines below
//     MIN_USEFUL (0.005), so anything thinner than 0.035 m never gets a bevel.
//     A brow, a buckle and a bandana staying raw is the contract working.
//   * mergeRigid's OUTPUT also reports geometry.type "BoxGeometry" with 1x1x1
//     parameters (it is a merged BufferGeometry that kept the tag), so type
//     alone flags the merge targets. A real un-chamfered box is exactly 24
//     vertices; the merged meshes carry thousands.
for (const [name, who] of [["male", man], ["female", woman]]) {
  const raw = [];
  who.traverse((m) => {
    if (!m.isMesh || !m.geometry || m === who.blob) return;
    if (m.geometry.type !== "BoxGeometry") return;
    if ((m.geometry.attributes.position || {}).count !== 24) return;      // a merge target
    const p = m.geometry.parameters;
    // geo.js only bevels above smallest/7 > 0.005, i.e. smallest > 0.035
    if (Math.min(p.width, p.height, p.depth) > 0.035) raw.push(p);
  });
  check(`${name}: no un-chamfered box thick enough to bevel`, raw.length === 0,
    raw.length ? raw.map((p) => `${p.width}x${p.height}x${p.depth}`).join(", ") : "all raw boxes are too thin to bevel");
}

// ---- 2. the limbs are round, not octagonal ----------------------------------
const segs = (who) => {
  const out = [];
  geometries(who).forEach((g) => {
    if (g.type !== "CylinderGeometry") return;
    const p = g.parameters;
    out.push(p.radialSegments);
  });
  return out;
};
for (const [name, who] of [["male", man], ["female", woman]]) {
  const s = segs(who);
  const limb = s.filter((n) => n >= 10);
  // These are UNIQUE geometries, so a figure whose two legs are the same
  // taper counts one, not two. The count is a smoke test; the segment floor is
  // the real assertion.
  check(`${name}: limbs are round (>=10 sides)`, limb.length >= 2 && Math.min(...limb) >= 10,
    `${limb.length} distinct limb cylinders, ${Math.min(...limb)}-${Math.max(...limb)} sides`);
  check(`${name}: nothing on a limb is still an octagon`, !s.some((n) => n === 8),
    `segments in use: ${[...new Set(s)].sort((a, b) => a - b).join(", ")}`);
}

// ---- 3. a hand with fingers, not a fist -------------------------------------
// mergeRigid folds every hand part into one mesh per material, so the parts
// cannot be counted. Count VERTICES below the grip instead: a bare fist is one
// 0.045 sphere, which contributes a couple of dozen, and four fingers plus a
// thumb contribute far more and spread across four distinct columns.
for (const [name, who] of [["male", man], ["female", woman]]) {
  const socketY = who.arms[0].hand.getWorldPosition(new THREE.Vector3()).y;
  who.updateMatrixWorld(true);
  let verts = 0;
  const columns = new Set();
  who.arms[0].elbow.traverse((m) => {
    if (!m.isMesh) return;
    const pos = m.geometry.attributes.position;
    if (!pos) return;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      m.localToWorld(v);
      if (v.y > socketY - 0.012) continue;
      verts++;
      columns.add(Math.round(v.x * 40) / 40);        // 2.5 cm buckets across the hand
    }
  });
  check(`${name}: the hand has fingers, not a fist`, verts > 60 && columns.size >= 4,
    `${verts} verts below the grip across ${columns.size} columns`);
}

// ---- 4. joints: the limb does not break at the elbow/knee ------------------
for (const [name, who] of [["male", man], ["female", woman]]) {
  check(`${name}: an elbow joint and a knee joint exist`,
    who.arms[0].elbow.children.length > 1 && who.legs[0].knee.children.length > 1,
    `elbow ${who.arms[0].elbow.children.length} parts, knee ${who.legs[0].knee.children.length} parts`);
}

// ---- 5. the bill ------------------------------------------------------------
// GTA III's characters are ~1-2k triangles. We spent to remove the blockout
// look; if this has run away past ~3x that, the crowd on the Crown Strip (a
// hundred people on one stage block) will not hold frame rate.
for (const [name, who] of [["male", man], ["female", woman]]) {
  const t = tris(who);
  check(`${name}: triangle bill is sane`, t > 800 && t < 6000, `${t} triangles`);
}

// ---- 6. it still animates, and nothing went NaN -----------------------------
let bad = 0;
for (const clip of ["idle", "walk", "dance", "pole", "attack", "sit"]) {
  for (const who of [man, woman]) {
    who.play(clip, { force: true, loop: true });
    for (let i = 0; i < 90; i++) {
      who.update(1 / 60);
      if (!Number.isFinite(who.position.x) || !Number.isFinite(who.hips.position.y)) bad++;
    }
  }
}
check("every clip runs clean on the new rig", bad === 0, `${bad} NaN frames across 6 clips x 2 rigs`);

console.log(`\ntriangle bill: male ${tris(man)}, female ${tris(woman)}`);
console.log(failures ? `${failures} check(s) FAILED` : "All character-quality checks passed");
process.exit(failures ? 1 : 0);
