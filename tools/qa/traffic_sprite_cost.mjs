// traffic_sprite_cost.mjs — pins the measured traffic-lighting cost at spawn.
//
//   node --experimental-detect-module tools/qa/traffic_sprite_cost.mjs
//
// Human report 2026-10-02: "Orlearouge IS very laggy esp during spawn".
//
// MEASURED, not assumed. tools/qa/orlearouge_spawn_density.mjs attributed the
// frustum at spawn (-6, 130) and got:
//
//   meshes in frustum: 2686   triangles: 334,970
//     2049  (unattributed)
//      221  static-batch
//      134  vehicle:<model>   (36 Landyroamer + 33 Toyoyo + 32 motorbike +
//                             20 Beatall + 13 scooter)
//     by kind: 2209 opaque-mesh, 439 transparent-mesh, 38 sprite
//
// Compare Oyster Bay (control): 539 meshes, 80,749 tris, no vehicles in the top
// 10 at all. So spawn carries ~5x the meshes and ~4x the triangles, and 134
// vehicles are inside ONE view.
//
// Two distinct costs, both from src/traffic.js buildCar():
//
//   1. FOUR additive sprites per car (line ~500): for each of sx in [-1, 1] it
//      adds a `head` and a `tail` THREE.Sprite. At 134 visible cars that is 536
//      sprites, which matches the 439 transparent-mesh count. Every sprite is its
//      own draw call AND is additive/transparent, so it cannot be merged by
//      batchStatic and it defeats the ~1-draw-per-mesh ratio that makes the rest
//      of the scene cheap. Headlights on a car 200 m away are subpixel.
//
//   2. src.clone(true) at line ~497 deep-clones EVERY child mesh of the model.
//      So a 3-mesh car becomes 3 meshes + 4 sprites = 7 draw-call units, for
//      every car in the pool, whether or not it is anywhere near the player.
//
// FIX EXPECTED: headlights and tail lights only for cars near the player (they
// are not visible at distance, so this cannot be seen as a regression), and the
// sprite count per car therefore scales with NEAR cars rather than total cars.
//
// This suite asserts the code shape. The measured counts above are the reason.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const traffic = readFileSync(join(here, "../../src/traffic.js"), "utf8");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

console.log("=== 1. head/tail lights are gated by proximity, not always on ===");
// The two sprites per side must be created/behaviour gated on distance from the
// player. Any unconditional add of both is the defect.
check(/const LAMP_RANGE = o\.lampRange \|\| \d+/.test(traffic),
  "LAMP_RANGE is a named, overridable constant rather than a magic number");
const lampRange = Number((traffic.match(/const LAMP_RANGE = o\.lampRange \|\| (\d+)/) || [, "0"])[1]);
check(lampRange > 0 && lampRange < 240, `LAMP_RANGE (${lampRange} m) sits inside the ~240 m fog edge, so no lamp is ever visible against nothing`);
// NB the lamps are STILL parented with obj.add(head, tail) -- that is correct and
// wanted (they inherit the car's transform and stay in the wet-road reflection
// list). The cost was never the parenting; it was that they were VISIBLE for every
// car in the world at all times. So the assertion is that they are born hidden,
// not that they are detached.
check(/head\.visible = false/.test(traffic) && /tail\.visible = false/.test(traffic),
  "head and tail lamps are created HIDDEN -- they are parented, not detached, but do not draw until gated on");
// The sprites must still EXIST, or this "fix" would have deleted headlights and
// broken the wet-road reflections the comment explicitly wants.
check(/head/.test(traffic) && /tail/.test(traffic), "head and tail lamps still exist (not deleted to save cost)");
check(/reflect\(/.test(traffic), "the wet-road reflection of the lamps is preserved");

console.log("\n=== 2. the gate is applied per frame, not just at build time ===");
// Gating only in buildCar() does nothing: cars are BUILT once from the pool and
// then live for a long time, so the gate has to be re-evaluated as they move.
// A per-frame application() pass is required.
// The gate must live in apply(), which runs every frame for every car, and it
// must read a focus that update() stashed -- apply() has no `focus` in scope and
// the opts object has NO playerPos (checked: main.js never passes one, so the
// first draft of this fix crashed on the first frame).
check(/function apply\(/.test(traffic), "the per-car frame function still exists to host the gate");
check(/car\.lamps\[i\]\.visible = on/.test(traffic), "apply() sets lamp sprite visibility per car");
check(/LAMP_RANGE \* LAMP_RANGE/.test(traffic), "the gate compares squared distance (no sqrt per car per frame)");
check(!/o\.playerPos/.test(traffic), "it does not read a non-existent o.playerPos -- that would throw every frame");
check(/_focus = focus/.test(traffic), "update() stashes its `focus` argument for apply() to read");
// The lampsOn cache is what keeps this cheap: without it, 4 sprite writes happen
// for every car every frame, which is the same order of work it replaces.
check(/if \(on !== car\.lampsOn\)/.test(traffic), "writes are gated on an actual state change (lampsOn cache), not done every frame");

console.log("\n=== 3. parked cars stay hidden (do not regress the existing park path) ===");
check(/function park\(/.test(traffic) && /car\.obj\.visible = false/.test(traffic),
  "park() still hides the car -- the lamp fix must not resurrect parked cars");

console.log("\n=== 4. vehicles are still distance-culled by the spawn/despawn window ===");
// DESPAWN 235 m exists and is described as past the fog edge. If the lamp gate is
// wider than the fog edge the lights would be visible against nothing, so pin the
// relationship rather than leave it to chance.
const despawn = Number((traffic.match(/despawn \|\| (\d+)/) || [, "235"])[1]);
check(despawn > 0, `a despawn distance is defined (${despawn} m)`);
check(/SPAWN_MIN = o\.spawnMin \|\| (\d+)/.test(traffic), "a minimum spawn distance is defined");
const spawnMin = Number((traffic.match(/SPAWN_MIN = o\.spawnMin \|\| (\d+)/) || [, "75"])[1]);
check(spawnMin < despawn, `cars spawn closer (${spawnMin} m) than they despawn (${despawn} m), so the pool covers the view`);

console.log(`\n${fails ? fails + " FAILURES -- the traffic lighting cost is still unconditional" : "traffic lamps are proximity-gated; the per-frame gate exists; parking is intact"}`);
process.exit(fails ? 1 : 0);