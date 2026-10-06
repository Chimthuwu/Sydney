// orleanorth_overlaps.mjs — which claimed road is each Orleanorth site colliding with?
//
//   node --experimental-detect-module tools/qa/orleanorth_overlaps.mjs
//
// The build test reports "site X overlaps something already placed" but composer
// only tells you THAT, never what. Every guess at the cause so far has been
// wrong: the frontage row spans x -30..18 and the four sites are all outside it;
// the cross streets were moved into the gaps and the warning did not change.
// So stop guessing and ask the grid directly — rebuild the district with a
// composer whose site() records what each rect actually contains.
import { installBrowserStub } from "./lib/browser_stub.mjs";
installBrowserStub();
globalThis.addEventListener = () => {};
process.on("unhandledRejection", () => {});

import * as THREE from "three";
import { surface } from "../../src/graphics.js";
import { createComposer } from "../../src/composer.js";

const noop = () => {};
const scene = new THREE.Scene();
const C = createComposer(new Proxy({
  scene, surface, addBlocker: noop, addLitSpot: noop,
  roadMaterial: () => new THREE.MeshStandardMaterial(),
}, { get: (t, k) => (k in t ? t[k] : noop) }),
  { name: "probe", bounds: { x0: -248, x1: 122, z0: -140, z1: 134 }, zones: {}, seed: 1 });

// Lay exactly the roads orleanorth.js lays, then dump the grid under each site.
const ROAD_X = -6;
C.road("US-167 Orleanorth", [[ROAD_X, -140], [ROAD_X, 134]], { width: 10, paved: false, lampEvery: 40 });
for (const [name, x, zEnd] of [["Millrace", -193, 120], ["Foundry", -139, 120], ["Tannery", -58, 130], ["Bayou", 14, 130], ["Carondelet", 112, 128]])
  C.road(name, [[x, -138], [x, zEnd]], { width: 8, sidewalk: 1.5, stage: "sideStreets", lampEvery: 44 });
C.road("Memorial Green drive", [[-118, -12], [-76, -12]], { width: 6, sidewalk: 1 });

// The frontage is what fills the grid with BUILDING. Reproduce it minimally.
C.frontage("US-167 Orleanorth", {
label: "highway frontage", setback: 14, spacing: 26, footprint: { w: 20, d: 16 },
startAt: 0, endAt: 0, build: (s) => C.claim(s.rect),
});

const SITES = {
  motel: { x0: 26, z0: -132, x1: 84, z1: -100 },
  diner: { x0: 90, z0: -132, x1: 116, z1: -106 },
  parking: { x0: -244, z0: -60, x1: -200, z1: -20 },
  "Memorial Green": { x0: -120, z0: -8, x1: -74, z1: 34 },
};

// Ask each rect what fraction of its cells are already taken.
console.log("=== what is under each site ===");
for (const [name, r] of Object.entries(SITES)) {
  let taken = 0, total = 0;
  const who = new Map();
  for (let z = r.z0 + 1; z < r.z1; z += 2) {
    for (let x = r.x0 + 1; x < r.x1; x += 2) {
      total++;
      // composer exposes no raw grid reader; `occupiedAt` is the public one.
      // To say WHAT is there rather than just that something is, use
      // builtAt (road/building/water/site) versus isFreeAt.
      if (C.occupiedAt(x, z)) {
        taken++;
        who.set(C.builtAt(x, z) ? "built" : "other", (who.get(C.builtAt(x, z) ? "built" : "other") || 0) + 1);
      }
    }
  }
  const detail = [...who].map(([v, n]) => `${v}:${((100 * n) / total).toFixed(0)}%`).join("  ");
  console.log(`  ${name.padEnd(14)} ${String(taken).padStart(4)}/${total} cells taken   ${detail || "all free"}`);
}

// And print the road half-widths so the numbers are checkable by hand.
console.log("\n=== road extents (half width + sidewalk) ===");
for (const [nm, x, z1, w, sw] of [["US-167", -6, 134, 10, 0], ["Millrace", -193, 120, 8, 1.5],
  ["Foundry", -139, 120, 8, 1.5], ["Tannery", -58, 130, 8, 1.5], ["Bayou", 14, 130, 8, 1.5], ["Carondelet", 112, 128, 8, 1.5]]) {
  console.log(`  ${nm.padEnd(10)} x ${x} .. ${x + w / 2 + sw}  (and ${x - w / 2 - sw} .. ${x})  z -138..${z1}`);
}