// The city must not grow a forest through it.
//
//   node --experimental-detect-module tools/qa/urban_ground_test.mjs
//
// Reported: "on the outskirts of OrleaRouge there are all these trees randomly
// popping up on the road, and it randomly seems to become rural right near the
// Bayou State Penitentiary."
//
// The cause is a gap between two lists that both think they own the ground.
// stateWorld.js scatters its wilderness bands with three questions — is a
// composer holding it, is it inside a KEEPOUT, is it near a lane — and answers
// them from data that predates the two biggest cities on the map:
//
//   1. KEEPOUTS (districts.js) has entries for Tusouxroe, Chatboro, Shruston,
//      Charsoufre and the four Delta Road set pieces. It has NO entry for
//      OrleaRouge or Metro, because both are built by main.js out of modules
//      that never registered themselves as districts.
//   2. `held()` walks stateWorld's OWN composers. OrleaRouge and Metro are not
//      among them — that is stated in the comment on the check and is the
//      reason `inKeepout` was supposed to cover them.
//   3. `nearLane` does see every district's lanes, but only 7 m either side of
//      a centreline: it keeps pines off the tarmac and does nothing about the
//      block behind the kerb.
//
// So the two checks that were supposed to protect the city protect nothing,
// and the East band (x 400..1050, z -350..350) reaches straight across
// OrleaRouge's eastern downtown. The band keeps the roads clear, which is
// exactly why it reads as a rural strip: trees in the verges and behind the
// buildings, never on the asphalt.
//
// A city needs an URBAN FOOTPRINT that scatter respects, and one that is owned
// by the city module rather than duplicated in a list that can fall behind it.

import { readFileSync } from "node:fs";
import { KEEPOUTS, inKeepout, inProtected } from "../../src/districts.js";
import { CITY as ORLEA_CITY, CAUSEWAY } from "../../src/orlearouge.js";
import { METRO_BOUNDS } from "../../src/metro.js";

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL " } ${label}${detail ? `  — ${detail}` : ""}`);
};

// ---------------------------------------------------------------- the ground
// OrleaRouge: the grid, plus the causeway approach that leads into it. Metro:
// its own bounds. Both are the two biggest urban footprints in the state.
const URBAN = [
  {
    label: "OrleaRouge",
    x0: ORLEA_CITY.minX - 8, x1: ORLEA_CITY.maxX + 8,
    z0: CAUSEWAY.minZ - 4, z1: ORLEA_CITY.maxZ + 8,
  },
  {
    label: "Metro",
    x0: METRO_BOUNDS.x0 - 6, x1: METRO_BOUNDS.x1 + 6,
    z0: METRO_BOUNDS.z0 - 6, z1: METRO_BOUNDS.z1 + 6,
  },
];

// ---------------------------------------------------------------- 1. it is registered
// The check that matters is not "is there a rect" but "does the rect cover the
// city". A keepout that stops 40 m short is the same bug with extra steps.
for (const u of URBAN) {
  // sample the whole footprint, not just its corners: the failure was a band
  // clipping the MIDDLE of downtown while every corner read clear
  let covered = 0, total = 0;
  const misses = [];
  // Sample the INTERIOR. inKeepout is a strict inequality, so the padded edge of
  // the rect is legitimately outside it by a couple of metres — that is what the
  // padding is FOR (a tree on the verge is fine; a tree on the pavement is not).
  // What matters is that no ground a district actually occupies is unclaimed, so
  // the sample starts 3 m in and the expectation is 100%, not 99.5.
  for (let x = u.x0 + 3; x <= u.x1 - 3; x += 20) {
    for (let z = u.z0 + 3; z <= u.z1 - 3; z += 20) {
      total++;
      if (inKeepout(x, z, 0)) covered++;
      else if (misses.length < 4) misses.push(`(${x}, ${z})`);
    }
  }
  const pct = (covered / total) * 100;
  check(`${u.label} is registered as state keepout ground`, covered === total,
    `${pct.toFixed(1)}% covered, uncovered e.g. ${misses.join(" ")}`);
}

// ---------------------------------------------------------------- 2. the reported spot
// The east band reaches x 400..1050 at z -350..350. OrleaRouge's downtown runs
// to x 520 at z 196..382, so the band overlaps it. Every point of the eastern
// downtown must be refused.
{
  const inside = [];
  for (let x = 400; x <= ORLEA_CITY.maxX; x += 10) {
    for (let z = 220; z <= 370; z += 10) inside.push([x, z]);
  }
  const bad = inside.filter(([x, z]) => !inKeepout(x, z, 8));
  check("the eastern downtown is refused by the band scatter's keepout test", bad.length === 0,
    `${bad.length}/${inside.length} points would take a tree, e.g. ${bad[0] || ""}`);
}

// ---------------------------------------------------------------- 3. the prison
// "It randomly seems to become rural right near the Bayou State Penitentiary."
//
// The prison was a set piece at x 542..801 — 22 m east of the city's old edge.
// It has since been moved out to the Delta Road, which is both true to life
// (Angola is a hundred miles from New Orleans) and necessary now the grid grows
// east past where it used to sit. The invariant worth keeping is the one that
// was silently violated for a commit: THE CITY MUST NOT REACH THE PRISON.
// Angola is a walled farm in the middle of a hundred thousand acres of nothing.
{
  const p = KEEPOUTS.filter((k) => k.label === "Bayou State Penitentiary");
  check("the penitentiary keepout still exists", p.length === 2, `${p.length} rects`);
  if (p.length === 2) {
    const px0 = Math.min(...p.map((k) => k.x0)), px1 = Math.max(...p.map((k) => k.x1));
    check("the prison is well east of downtown", ORLEA_CITY.maxX < px0,
      `city reaches x ${ORLEA_CITY.maxX}, prison starts at x ${px0}`);
    check("there is real ground between them, not a seam", px0 - ORLEA_CITY.maxX > 100,
      `${px0 - ORLEA_CITY.maxX} m apart`);
    // and the two rects must still bracket the same site — the pair exists so a
    // road across the compound does not turn half of it into buildable ground
    check("the prison's two rects are paired across the same site",
      Math.abs(p[0].x0 - p[1].x0) < 1 && Math.abs(p[0].x1 - p[1].x1) < 1);
  }
}

// ---------------------------------------------------------------- 4. protected still protected
// Adding urban ground must not weaken the prologue's protected set: the hog pen
// is at x -20..100, z -915..-790 and is far from both cities, but the
// registration change touches the same list.
check("the prologue's ground is still protected", inProtected(40, -850, 3));
check("the prologue's ground is not inside a city", !inKeepout(40, -850, 0));

// ---------------------------------------------------------------- 5. still a state
// The keepouts have to stay a minority of the map or the wilderness is gone and
// the state is a parking lot. The wilderness bands that are the point of the
// rest of the map need what is left.
{
  const covered = KEEPOUTS.reduce((a, k) => a + (k.x1 - k.x0) * (k.z1 - k.z0), 0);
  const MAP_AREA = 2400 * 2400;
  const pct = (covered / MAP_AREA) * 100;
  check("urban + set-piece ground stays under a quarter of the state", pct < 25,
    `${pct.toFixed(1)}% claimed`);
}

if (failures) { console.error(`urban_ground_test: ${failures} failure(s)`); process.exit(1); }
console.log("urban_ground_test: all checks passed");
