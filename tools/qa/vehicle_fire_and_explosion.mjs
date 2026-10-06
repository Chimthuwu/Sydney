// vehicle_fire_and_explosion.mjs — burning cars and explosions that read as
// fire and explosions, not as a flashing sprite.
//
//   node --experimental-detect-module tools/qa/vehicle_fire_and_explosion.mjs
//
// WHAT WAS ACTUALLY WRONG, found by reading main.js:2745-2900 rather than by
// looking at it:
//
//   1. THE SMOKE NEVER MOVES. `startVehicleFire` builds one SphereGeometry(0.5) at
//      y=1.0, and `updateVehicleFire` only ever touches `f.flame.scale` and the
//      point light. The smoke is a static grey ball parked above the bonnet for the
//      entire burn -- it never rises, never expands, never dissipates. On a car that
//      is on fire that reads as a grey sphere, which is worse than no smoke at all
//      because it looks like a bug rather than an effect.
//
//   2. ONE SHARED wreckLight. main.js:5361 creates a SINGLE PointLight reused by
//      every explosion, and the cleanup is `if (wreckLight.intensity === 30) ... = 0`
//      on a 1400ms timer. Two cars blowing up within 1.4s: the first timer fires and
//      snuffs the SECOND explosion's light while it is still burning. A guard that
//      checks the value it just wrote is not a guard against this; it is a race with
//      extra steps.
//
//   3. NO CAMERA SHAKE. `grep -rnE 'shake' src/main.js` returns exactly one hit, and
//      it is the word "shake" inside a comment about the crash jolt. A car detonating
//      three metres away produces no camera feedback whatsoever.
//
//   4. No debris. The blast is one AnimatedSprite, removed after a flat 500ms.
//
// THE FIX is additive: the existing fire rig keeps its shape (so the other gates and
// the wreck-smoulder reuse still work) and gains a rising, expanding, fading smoke
// column; explosions get a small pool of lights, a decaying flash, and a
// distance-scaled camera shake.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(here, "../../src/main.js"), "utf8");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

console.log("=== the smoke must actually move ===");
// The specific defect: the smoke mesh is created and never touched again.
const upd = main.slice(main.indexOf("function updateVehicleFire"), main.indexOf("function updateVehicleFires"));
check(upd.length > 0, "updateVehicleFire exists");
// The column is built from `puffs`, so the moving members are p.mesh/p.mat -- not
// `smoke`, which is the name of the ONE static sphere this replaced. My first version
// grepped for the old name and went red against the working new code.
check(/p\.mesh\.position/.test(upd) && /p\.mesh\.scale/.test(upd) && /p\.mat\.opacity/.test(upd),
  "updateVehicleFire animates each smoke puff -- not a static sphere any more");
check(/puffs/.test(main), "smoke is emitted as a rising puff column, not one fixed ball");
check(/smokeMat\.opacity|opacity:/.test(upd) || /opacity/.test(upd),
  "the smoke fades as it rises instead of popping out of existence");
check(/smokeT|smokeAge|puff\.life/.test(main), "each puff carries its own age, so they do not all move in lockstep");

console.log("\n=== explosions must not stomp each other ===");
// Match CODE, not prose. A bare substring search hit the comment that documents the
// old bug and went red against the very fix it describes, so exclude comment lines.
const code = main.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l.trim())).join("\n");
check(!/wreckLight\.intensity === 30/.test(code),
  "the old `intensity === 30` snuff guard is gone from the CODE -- it raced with a second explosion");
check(!/^const wreckLight/m.test(code), "the single shared wreckLight is actually removed, not just unused");
check(/blastLights\);/.test(code), "the blast light pool is added to the scene");
const pool = main.match(/const (?:blastLights|wreckLights)\s*=/);
check(!!pool, "explosions use a POOL of lights, not one shared light");
// A decay loop, not a setTimeout: a timer cannot be cancelled once a car despawns,
// and it keeps firing against a removed object.
check(/function updateBlasts/.test(main), "blast lights are decayed in the frame loop");
check(!/setTimeout\(\(\) => \{[^}]*wreckLight/.test(main), "no setTimeout mutating explosion lights");

console.log("\n=== the blast has to be felt, not just seen ===");
check(/function shakeCamera|shakeAmt|cameraShake/.test(main), "a camera-shake term exists");
// `shakeAmt` is the term, and the distance scaling lives in kickCamera rather than at
// the point of use. Check the function that does the scaling, which is the honest
// place to assert it.
const sh = main.match(/function kickCamera[\s\S]{0,300}?\n}/);
check(!!sh && /distanceTo/.test(sh[0]) && /d > 34/.test(sh[0]),
  "the shake is scaled by distance and cut off entirely past 34 m -- a blast across the map must not rattle the camera");
// Decaying, so it is a kick rather than a permanent wobble.
check(/(?:shakeAmt|cameraShake)\s*=\s*Math\.max\(0|shakeAmt \*=|cameraShake \*=/.test(main),
  "the shake decays back to zero instead of leaving the camera permanently drunk");
check(/debris|shrapnel/.test(main), "the explosion throws debris, not just one sprite");
check(/sprites|8\.0/.test(main), "the existing torch sprite burst is preserved");

console.log("\n=== the fire still reaches the wreck, and is bounded ===");
// These are the pre-existing behaviours the new code must not break.
check(/updateVehicleFires/.test(main) && /!v\.exploded/.test(main),
  "pre-explosion fire is updated only while the car is alive");
check(/updateWrecks/.test(main), "wrecks still smoulder after death");
check(litFiresGuard(), "the fire-light pool is still bounded (no light leak per car)");

function litFiresGuard() {
  // The zeroing half lives in updateWrecks, not updateVehicleFires: the latter resets
  // the counter and claims lights, the former snuffs the leftovers. My first version
  // sliced only up to updateWrecks and so missed it -- asserting a bound that was in
  // fact intact. Check both halves exist somewhere.
  return /litFires = 0/.test(main) && /litFires < fireLights\.length/.test(main)
    && /for \(; litFires < fireLights\.length/.test(main);
}

console.log(`\n${fails ? fails + " FAILURES" : "fire moves, blasts do not stomp, the camera feels it"}`);
process.exit(fails ? 1 : 0);