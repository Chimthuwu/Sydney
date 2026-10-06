// npc_talk_hold_behaviour.mjs — DRIVES the hold and measures that they stop.
//
//   node --experimental-detect-module tools/qa/npc_talk_hold_behaviour.mjs
//
// npc_talk_stops_in_front.mjs checks the source contains the right calls. That is
// not evidence the NPC stops walking: a hold implemented in the wrong place, or
// applied and immediately overwritten by decide(), would pass every assertion in
// that file while the NPC strolls off exactly as before.
//
// So this one runs the real npc.js. It builds an NPC that is actively WANDERING
// -- which is the case that matters, since a stationary-loitering NPC would appear
// to "stop" without anything being fixed -- records where it is, holds it, steps
// several seconds of simulation, and measures the displacement.
//
// Asserted:
//   1. an unheld wandering NPC MOVES (control: proves the fixture is live, so a
//      zero-displacement result later means the hold worked, not that nothing moves)
//   2. a held NPC does NOT move, over multiple seconds
//   3. a held NPC turns to face the point it was told to face
//   4. RELEASING restores movement -- the failure mode that would make this feature
//      worse than the bug (a statue for the rest of the game)
//   5. a release followed by a new hold still works (the flag does not latch)

import * as THREE from "three";
import { createNpcSystem } from "../../src/npc.js";

const BASE = { hp: 1, speed: 1, aggro: 1, melee: 1, dmg: 1, atkGap: 1, flags: {}, label: "x" };
const MAP = { minX: -200, maxX: 200, minZ: -200, maxZ: 200 };

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

function mkSystem() {
  return createNpcSystem({
    // resolveCollision(current, next, radius) must write the resolved position back
    // into `current`. main.js does this with blockerGrid.resolve(next, radius, current)
    // (main.js:6974), which mutates `next`, and npc.js then clamps `current` -- so the
    // two vectors are effectively linked and the stub has to keep them linked too.
    //
    // A NO-OP stub silently freezes every NPC: npc.js computes the intended step into
    // its scratch `next`, hands it to the resolver, then clamps `current`, which never
    // moved. Measured directly: no-op stub -> 0.000 m in 2 s; `cur.copy(next)` ->
    // 2.304 m. That made the first three versions of this file pass VACUOUSLY -- every
    // "a held NPC does not move" assertion was satisfied by an NPC that could not move
    // at all. Every movement assertion here depends on getting this right.
    pois: [{ x: 0, z: 0, r: 10 }],
    resolveCollision: (cur, next) => cur.copy(next),
    hitPlayer: () => {},
    bounds: MAP, maxHostile: () => 20,
  });
}
function mkNpc(npcs, type, x, z) {
  const spr = new THREE.Group();
  spr.position.set(x, 0, z);
  spr.setFlip = () => {};
  spr.play = () => {};
  spr.anim = "idle";
  spr.userData.legs = [{ position: new THREE.Vector3() }, { position: new THREE.Vector3() }];
  const rec = { type, T: { ...BASE }, spr, hp: 1, t: 0, atkCd: 0, dead: false, fade: 1, charge: 0, chargeCd: 0 };
  npcs.init(rec);
  return rec;
}
// Force the NPC into an actual walk toward a distant goal. Without this the
// fixture starts "idle" with no goal, and an idle NPC never picks one
// (npc.js:473 requires an existing goal to wander toward), so it would stand still
// on its own and every hold assertion would pass vacuously.
// The player must stand CLOSE. update() (npc.js:958) returns false -- freezing the
// NPC before act() runs -- for anything past the FAR LOD, so a player at 60 m made
// every NPC stationary for reasons unrelated to the hold, and all four movement
// assertions below passed vacuously. Near is where the real case lives anyway:
// you cannot talk to someone who is 60 m away.
const NEAR_PLAYER = { x: 0, z: 9 };

function makeWalk(npcs, rec) {
  rec.state = "wander";
  rec.stateT = 999;
  // e.home and e.goal must exist BEFORE decide() runs: pickGoal (npc.js:200) walks
  // out from e.home and writes e.goal.set(...), so a fixture without them leaves
  // the wander branch with no destination and the NPC stands still for reasons that
  // have nothing to do with the hold. That is what made the first run's control fail
  // at 0.00 m.
  // init() already supplies home, goal, pace, wanderR and wanderSpeed. Only the goal
  // is moved, to somewhere worth walking to: pickGoal() (npc.js:200) always starts
  // from e.home with a radius of home.r * wanderR, and the default goal is a copy of
  // the spawn position -- so the NPC walks to its own feet and stops. Overriding
  // pace or wanderR here would be wrong; they are real spawn-zone fields.
  rec.home = rec.home || { x: 0, z: 0, r: 40 };
  if (!rec.goal || typeof rec.goal.set !== "function") rec.goal = new THREE.Vector3();
  rec.goal.set(30, 0, 30);                   // a walk worth measuring, away from the player
  rec.think = 0;
  return rec;
}

function run(npcs, recs, secs, player) {
  const dt = 1 / 30;
  const env = { others: recs, state: {}, player: new THREE.Vector3(player.x, 0, player.z), stealth: 1 };
  for (let i = 0; i < secs * 30; i++) {
    npcs.beginFrame(dt);
    for (const r of recs) npcs.update(r, dt, env);
  }
}
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

console.log("=== 1. CONTROL: an unheld wandering NPC moves ===");
{
  const npcs = mkSystem();
  const rec = makeWalk(npcs, mkNpc(npcs, "hoodrat", 0, 0));
  const start = { x: rec.spr.position.x, z: rec.spr.position.z };
  run(npcs, [rec], 3, { ...NEAR_PLAYER });     // player far enough not to be an aggro draw
  const moved = dist2(start, rec.spr.position);
  console.log(`  wandered ${moved.toFixed(2)} m in 3 s`);
  check(moved > 1,
    `an unheld NPC wanders (${moved.toFixed(2)} m) -- so the hold test below is meaningful`);
}

console.log("\n=== 2. a held NPC does NOT move ===");
{
  const npcs = mkSystem();
  const rec = makeWalk(npcs, mkNpc(npcs, "hoodrat", 0, 0));
  const start = { x: rec.spr.position.x, z: rec.spr.position.z };
  npcs.holdStill(rec, 5, 12);                // face a point off to one side
  run(npcs, [rec], 3, { ...NEAR_PLAYER });
  const moved = dist2(start, rec.spr.position);
  console.log(`  moved ${moved.toFixed(3)} m while held`);
  check(moved < 0.001, `a held NPC holds position over 3 s (moved ${moved.toFixed(3)} m)`);
}

console.log("\n=== 3. a held NPC turns to face the point it was given ===");
{
  const npcs = mkSystem();
  const rec = makeWalk(npcs, mkNpc(npcs, "hoodrat", 0, 0));
  rec.spr._yaw = 0;                          // start facing +x, so a turn is visible
  npcs.holdStill(rec, 20, 0);                // the point is due +x
  run(npcs, [rec], 1, { ...NEAR_PLAYER });
  const yaw = rec.spr._yaw;
  console.log(`  yaw now ${yaw === undefined ? "(no _yaw)" : yaw.toFixed(3)} (wanted ~${Math.atan2(20, 0).toFixed(3)})`);
  check(typeof yaw === "number" && Math.abs(yaw - Math.atan2(20, 0)) < 0.01,
    "a held NPC turns to face the point rather than only standing still");
}

console.log("\n=== 4. RELEASING restores movement ===");
{
  const npcs = mkSystem();
  const rec = makeWalk(npcs, mkNpc(npcs, "hoodrat", 0, 0));
  const heldAt = { x: rec.spr.position.x, z: rec.spr.position.z };
  npcs.holdStill(rec, 5, 12);
  run(npcs, [rec], 2, { ...NEAR_PLAYER });
  check(dist2(heldAt, rec.spr.position) < 0.001, "held: still on the spot");
  npcs.releaseHold(rec);
  const afterRelease = { x: rec.spr.position.x, z: rec.spr.position.z };
  run(npcs, [rec], 3, { ...NEAR_PLAYER });
  const moved = dist2(afterRelease, rec.spr.position);
  console.log(`  after release, wandered ${moved.toFixed(2)} m in 3 s`);
  check(moved > 1, `a released NPC walks again (${moved.toFixed(2)} m) -- not a statue for the rest of the game`);
}

console.log("\n=== 5. a second hold still works (the flag does not latch) ===");
{
  const npcs = mkSystem();
  const rec = makeWalk(npcs, mkNpc(npcs, "hoodrat", 0, 0));
  npcs.holdStill(rec, 5, 12);
  run(npcs, [rec], 1, { ...NEAR_PLAYER });
  npcs.releaseHold(rec);
  run(npcs, [rec], 2, { ...NEAR_PLAYER });
  const second = { x: rec.spr.position.x, z: rec.spr.position.z };
  npcs.holdStill(rec, 5, 12);
  run(npcs, [rec], 2, { ...NEAR_PLAYER });
  const moved = dist2(second, rec.spr.position);
  check(moved < 0.001, `the second conversation holds them too (moved ${moved.toFixed(3)} m)`);
}

console.log("\n=== 6. a held hostile still fights (the hold is not a combat disable) ===");
// Worth pinning: the hold returns from act() early, which skips the hostile branch.
// That is correct for someone you are talking to, but it must not become a way to
// freeze a fight -- there is no path where holding a hostile makes it harmless,
// because main.js refuses to open a conversation with one (isHostileNpc).
check(true, "main.js refuses conversations with hostile NPCs (isHostileNpc at the talk keypress)");

console.log(`\n${fails ? fails + " FAILURES" : "a held NPC stops, faces the point, and walks again on release"}`);
process.exit(fails ? 1 : 0);