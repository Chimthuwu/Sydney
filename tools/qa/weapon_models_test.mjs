// Every procedural weapon, measured.
//
//   node --experimental-detect-module tools/qa/weapon_models_test.mjs
//
// Each builder in weapons_3d.js is a CONTRACT, not just a function:
//   - the origin is the point a hand closes on
//   - +Z is the muzzle direction
//   - the front of the barrel lands on the weapon's `muzzleOffset`
//
// The third one is the reason this test exists. `muzzle` is a real node, and
// tracers, muzzle flash and shell ejection all start there — so a model whose
// barrel overshoots it puts every effect in midair behind the gun, which looks
// like a rendering bug and is actually a data one. The Tec-9 and the deer rifle
// were both 20-25 mm short before this was measured.
//
// The other thing checked here is SIZE, because a weapon that is the right
// shape and the wrong size reads as wrong in the hand in a way no amount of
// detail fixes. These are the real dimensions of the things they stand in for.
import assert from "node:assert/strict";
import * as THREE from "three";

const noop = () => {};
const grad = { addColorStop: noop };
const ctx2d = {
  fillStyle: "", font: "", textAlign: "", textBaseline: "", globalAlpha: 1,
  fillRect: noop, fillText: noop, strokeText: noop, save: noop, restore: noop, translate: noop,
  rotate: noop, scale: noop, beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
  arc: noop, ellipse: noop, arcTo: noop, rect: noop, fill: noop, stroke: noop, clip: noop,
  clearRect: noop, drawImage: noop, strokeRect: noop,
  createLinearGradient: () => grad, createRadialGradient: () => grad,
  getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData: noop,
  measureText: () => ({ width: 10 }), createImageData: () => ({ data: new Uint8ClampedArray(4) }),
  setLineDash: noop, setTransform: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
};
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx2d }),
  head: { appendChild() {} }, body: { appendChild() {} },
  getElementById: () => null, addEventListener() {},
};

const { BUILDERS, WEAPON_RIGS } = await import("../../src/weapons_3d.js");

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
};

// Real-world overall lengths, in metres. A 9 mm service pistol is 185 mm from
// butt to muzzle; the guns in this game are allowed to be a little longer than
// life because they are read at arm's length in third person, and the ranges
// below are those, not the catalogue ones.
const EXPECT = {
  pistol: { minLen: 0.16, maxLen: 0.30, label: "9 mm pistol" },
  tec9: { minLen: 0.40, maxLen: 0.62, label: "MAC-10" },
  sawnoff: { minLen: 0.35, maxLen: 0.55, label: "sawed-off" },
  deerRifle: { minLen: 0.90, maxLen: 1.20, label: "bolt-action rifle" },
  bat: { minLen: 0.70, maxLen: 0.95, label: "baseball bat" },
};

for (const [id, spec] of Object.entries(BUILDERS)) {
  const m = spec.build();
  m.updateMatrixWorld(true);
  const def = WEAPON_RIGS[id];
  const want = EXPECT[id];
  console.log(`\n${id}  (${want ? want.label : "?"})`);

  // ---- the contract
  const bb = new THREE.Box3().setFromObject(m);
  const len = bb.max.z - bb.min.z;
  check("the model exists and has parts", m.children.length > 0, `${m.children.length} parts`);

  // the grip is the origin: the model must straddle z = 0, with more of it in
  // FRONT of the fist than behind (a gun is held near its back)
  check("the grip is at the origin — the model straddles it",
    bb.min.z < 0 && bb.max.z > 0, `z ${bb.min.z.toFixed(3)} .. ${bb.max.z.toFixed(3)}`);
  check("...and most of the gun is in front of the fist",
    bb.max.z > -bb.min.z, `${(bb.max.z).toFixed(3)} forward vs ${(-bb.min.z).toFixed(3)} back`);

  // the muzzle node must be at the barrel tip, or every effect draws in midair
  check("the muzzle node is at the barrel tip",
    Math.abs(bb.max.z - def.muzzleOffset[2]) < 0.01,
    `tip z ${bb.max.z.toFixed(3)}, node z ${def.muzzleOffset[2].toFixed(3)}`);

  // ---- the size
  check("the weapon is a believable length", len >= want.minLen && len <= want.maxLen,
    `${(len * 100).toFixed(0)} cm (expected ${(want.minLen * 100).toFixed(0)}-${(want.maxLen * 100).toFixed(0)} cm)`);

  // ---- the detail budget
  // A bat is a bat: it is a tapered stick, and hanging furniture on it would be
  // inventing a weapon that does not exist. The guns are held to the higher bar.
  const minParts = id === "bat" ? 8 : 14;
  let tris = 0;
  m.traverse((o) => {
    if (!o.isMesh) return;
    tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    // every part rides a moving actor, so it must be excluded from both
    // systems that assume static geometry
    if (o.userData.noBatch !== true) check("every part is excluded from the static batcher", false, o.name || "(unnamed)");
    if (o.frustumCulled !== false) check("no part is frustum-culled", false, o.name || "(unnamed)");
  });
  check("there is enough of it to read as a weapon, not a silhouette",
    m.children.length >= minParts, `${m.children.length} parts, ${Math.round(tris)} tris`);

  // ---- the guns are made of cylinders, not cubes
  // The single strongest cue that reads "gun" is a round barrel and its
  // highlight; a box barrel reads as a box however much detail is hung on it.
  if (id !== "bat") {
    let round = 0;
    m.traverse((o) => { if (o.isMesh && o.geometry.type === "CylinderGeometry") round++; });
    check("the barrel is round", round >= 1, `${round} cylindrical part(s)`);
  }
}

// ---- the two-handers can be held with both hands
{
  // `foregrip` is where the support arm is solved onto. If it is not in front
  // of the grip, the support hand crosses the firing hand.
  for (const id of ["tec9", "sawnoff", "deerRifle"]) {
    const f = WEAPON_RIGS[id].foregrip;
    check(`${id}'s support hand has somewhere to go, in front of the grip`,
      Array.isArray(f) && f[2] > 0.08, f ? `foregrip z ${f[2]}` : "none");
  }
}

console.log(failures ? `\n${failures} weapon model check(s) FAILED` : "\nAll weapon model checks passed");
process.exit(failures ? 1 : 0);
