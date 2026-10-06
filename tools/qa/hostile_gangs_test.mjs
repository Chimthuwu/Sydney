// ---------------------------------------------------------------------------
// hostile_gangs_test.mjs — are the parish's gangs actually hostile, and does
// the population show up?
//
//   node --experimental-detect-module tools/qa/hostile_gangs_test.mjs
//
// A human report (2026-10-01): "we needed more NPCs in the game. There used to
// be a lot of NPCs, now there's hardly any. And they seem to be way too afraid
// of stuff, like gunshots. There was meant to be some kind of hostile NPCs, like
// we had the hood rats and the rednecks, that were also meant to be hostile. But
// they're all just kind of running around like pussies."
//
// Three separate causes, none of which throws, which is why the file exists:
//
//   * commit daec1e6 (2026-09-27) cut npc.js's AMBUSHERS to `new Set(["hog"])`,
//     so hoodrats and rednecks stopped attacking on sight. Restored.
//   * npc.js's temperament() rolled redneck 50% brave and everyone else 35%,
//     so most of the parish fled when you shot at it. The gangs are now mostly
//     brave; civilians are deliberately untouched.
//   * main.js's ENEMY_CAP was 90 on a map five times the size it was when the
//     cap was 48. Raised, with CIV_CULL widened to hold the drawn density
//     constant.
//
// This asserts the BEHAVIOUR by driving the real decide() loop, not by reading
// the constants back — a test that greps for `AMBUSHERS` would still pass if
// the ambush branch were unreachable.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import { createNpcSystem } from "../../src/npc.js";
import { MAX_HOSTILE } from "../../src/npc.js";
import * as THREE from "three";

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
};

const MAP = { minX: -200, maxX: 200, minZ: -200, maxZ: 200 };
const T = { speed: 4.2, aggro: 22, melee: 1.8, dmg: 7, atkGap: 1.2, hp: 4 };

function mkNpc(npcs, type, x, z) {
  const spr = new THREE.Group();
  spr.position.set(x, 0, z);
  spr.setFlip = () => {};
  spr.play = () => {};
  spr.anim = "idle";
  // act() (npc.js:802) reads spr.userData.legs, and only on the hog branch. The old
  // assertions drove hoodrats exclusively, so the fixture shipped without legs and
  // never hit that line; the hog case added below does, and crashed on
  // `legs.length`. Note the path is userData.legs, not T.legs -- the first attempt
  // put them on T and failed identically.
  spr.userData.legs = [{ position: new THREE.Vector3() }, { position: new THREE.Vector3() }];
  const rec = { type, T: { ...T, label: type }, spr, hp: T.hp, t: 0,
                atkCd: 0, dead: false, fade: 1, charge: 0, chargeCd: 0 };
  npcs.init(rec);
  return rec;
}

/** Drive the real decide() loop for `secs`, with the player standing at (px,pz). */
function run(npcs, recs, secs, player, env = {}) {
  const dt = 1 / 30;
  const e = { player: { x: player.x, z: player.z }, others: recs, stealth: 1, ...env };
  for (let t = 0; t < secs; t += dt) {
    npcs.beginFrame(dt);
    for (const r of recs) npcs.update(r, dt, e);
  }
}

// ------------------------------------------------- 1. gangs: hostile when provoked
//
// WAS: "gangs attack on sight", asserting a hoodrat turns hostile on an
// UNPROVOKED player inside aggro range. That assertion is stale, and reverting
// src/npc.js to satisfy it would undo a deliberate fix.
//
// 1e915c7 (2026-10-02, one day AFTER this test was written) responded to the
// human report "YEAH NAH HOODRATS N REDNECKS STILL ATTACK WITHOUT BEING
// PROVOKED". hoodrat and redneck were in TWO sets: FIGHTERS, which had been made
// to respect faction standing, and AMBUSHERS, an UNCONDITIONAL on-sight attack
// with no standing check -- so fixing the first left the reported symptom fully
// live. AMBUSHERS is now hogs only. So the CURRENT, intended behaviour is:
//
//   hog        -> attacks on sight (territorial), unchanged
//   hoodrat /  -> civilians until provoked; FIGHTERS handles them once the
//   redneck       player's faction standing makes them hostile
//
// This asserts that, rather than the superseded rule. The staleness was possible
// because nothing ran this gate: the npm test chain died at gate #2 (see
// tools/qa/run_all.mjs), so this file had not executed since 2026-10-01.
{
  const pois = [{ x: 0, z: 0, r: 10 }];

  // (a) A territorial HOG still attacks on sight -- the unconditional branch
  //     still exists and still works, so the fix narrowed it rather than
  //     deleting the behaviour.
  const npcsHog = createNpcSystem({ pois, resolveCollision: () => {}, hitPlayer: () => {}, bounds: MAP });
  const hog = mkNpc(npcsHog, "hog", 0, 0);
  hog.mood = "territorial";
  run(npcsHog, [hog], 2, { x: 0, z: 8 });
  check("a territorial hog attacks an unprovoked player inside its aggro range",
    hog.state === "hostile", `state after 2 s: ${hog.state}`);

  // (b) An unprovoked hoodrat does NOT -- this is 1e915c7's whole point.
  const npcs = createNpcSystem({ pois, resolveCollision: () => {}, hitPlayer: () => {}, bounds: MAP });
  const rec = mkNpc(npcs, "hoodrat", 0, 0);
  rec.mood = "brave";
  run(npcs, [rec], 2, { x: 0, z: 8 });         // 8 m away, aggro is 22
  check("an unprovoked hoodrat does NOT attack on sight (1e915c7)",
    rec.state !== "hostile", `state after 2 s: ${rec.state}`);

  // (c) ...and a crowd of them still cannot all pile on at once.
  const npcs2 = createNpcSystem({ pois, resolveCollision: () => {}, hitPlayer: () => {}, bounds: MAP });
  const mob = [];
  for (let i = 0; i < 30; i++) {
    const r = mkNpc(npcs2, i % 2 ? "hoodrat" : "redneck", (i % 6) - 2, ((i / 6) | 0) - 2);
    r.mood = "brave";
    mob.push(r);
  }
  run(npcs2, mob, 4, { x: 0, z: 3 });
  const hostile = mob.filter((r) => r.state === "hostile").length;
  check("a crowd of 30 unprovoked gangs cannot pile on at once",
    hostile <= MAX_HOSTILE && hostile === 0,
    `${hostile} hostile of 30, MAX_HOSTILE ${MAX_HOSTILE}`);
}

// ---------------------------------------------------------------- 2. they fight back
{
  // The "too afraid of gunshots" half. Provoke a gang member and see whether it
  // stands its ground or bolts. Measured over a sample, because temperament is
  // a random roll — the point is the ratio, not any one NPC.
  const pois = [{ x: 0, z: 0, r: 10 }];
  const N = 400;
  for (const type of ["hoodrat", "redneck"]) {
    let fled = 0;
    for (let i = 0; i < N; i++) {
      const npcs = createNpcSystem({ pois, resolveCollision: () => {}, hitPlayer: () => {}, bounds: MAP });
      const rec = mkNpc(npcs, type, 0, 0);
      run(npcs, [rec], 0.5, { x: 0, z: 30 });   // start calm and far
      npcs.provoke(rec);                          // the player hits them
      rec.think = 0;
      run(npcs, [rec], 1.0, { x: 0, z: 30 });
      if (rec.state === "flee") fled++;
    }
    const braveness = (1 - fled / N) * 100;
    // Was 50% (redneck) / 35% (hoodrat). Assert we are now clearly majority
    // fight-back, while still leaving a minority who run.
    check(`${type}s mostly fight back when provoked`,
      braveness >= 70, `${braveness.toFixed(1)}% stood their ground (was 50%/35%)`);
    check(`${type}s still include some who run`,
      braveness < 100, `${(100 - braveness).toFixed(1)}% still bolt`);
  }

  // Civilians must NOT have been made fearless by the gang change — they are the
  // people who are supposed to run when a shot goes off.
  const npcs = createNpcSystem({ pois, resolveCollision: () => {}, hitPlayer: () => {}, bounds: MAP });
  let civFled = 0;
  for (let i = 0; i < 200; i++) {
    const rec = mkNpc(npcs, "tourist", 0, 0);
    run(npcs, [rec], 0.5, { x: 0, z: 30 });
    npcs.provoke(rec);
    rec.think = 0;
    run(npcs, [rec], 1.0, { x: 0, z: 30 });
    if (rec.state === "flee") civFled++;
  }
  check("civilians still scatter rather than turn and fight",
    civFled / 200 > 0.5, `${(civFled / 200 * 100).toFixed(0)}% of tourists ran`);
}

// ---------------------------------------------------------------- 3. gangs hold their turf
{
  // A gang member must not flee from a nearby gunshot — they were the one group
  // STANDS_GROUND was written for, and losing that is what "running around like
  // pussies" looks like from the street.
  const pois = [{ x: 0, z: 0, r: 10 }];
  const npcs = createNpcSystem({ pois, resolveCollision: () => {}, hitPlayer: () => {}, bounds: MAP });
  const rec = mkNpc(npcs, "hoodrat", 0, 0);
  rec.mood = "timid";                 // worst case: even the cowards hold the line
  rec.think = 0;
  npcs.update(rec, 1 / 30, { player: { x: 200, z: 200 }, others: [rec], stealth: 1 });
  npcs.noise(0, 0, 22);              // a pistol, right beside them
  run(npcs, [rec], 2, { x: 300, z: 300 });   // player far away, so this is pure noise
  check("a gang member does not bolt from a nearby gunshot",
    rec.state !== "flee", `state: ${rec.state}`);
}

// ---------------------------------------------------------------- 4. the caps
{
  // main.js is the game and cannot be imported headlessly, so the caps are read
  // from its source — and the read fails loudly if a refactor moves them.
  const src = fs.readFileSync(new URL("../../src/main.js", import.meta.url), "utf8");
  const g = (re) => { const m = src.match(re); return m ? Number(m[1]) : null; };
  const cap = g(/const ENEMY_CAP\s*=\s*(\d+)/);
  const busy = g(/const ENEMY_CAP_BUSY\s*=\s*(\d+)/);
  const cull = g(/const CIV_CULL\s*=\s*(\d+)/);
  check("main.js still declares ENEMY_CAP", cap != null);
  check("...and ENEMY_CAP_BUSY", busy != null);
  check("...and CIV_CULL", cull != null);
  check("the ambient cap reflects a populated parish (was 90)",
    cap >= 140, `${cap} ambient NPCs`);
  check("the downtown bonus is still a named constant",
    busy > 0, `+${busy} downtown`);
  check("the cull ring is wide enough to hold them (was 180 m)",
    cull >= 220, `${cull} m`);
  if (cap && busy && cull) {
    // The drawn density must not become a mob: population_test.mjs guards the
    // same band, this is the gangs test's own copy of that arithmetic.
    const d = (cap + busy) / (Math.PI * Math.pow(cull / 1000, 2));
    check("...at a street's worth of density, not a mob",
      d > 400 && d < 1400, `${Math.round(d)} people per km2 downtown`);
  }
  // ...and the initial seed, which is what the player sees before moving.
  const seeds = [...src.matchAll(/placed < (\d+) && tries/g)].map((m) => Number(m[1]));
  check("the starting seed is bigger than the old 40/22",
    seeds.length >= 2 && Math.min(...seeds) >= 40, `seeds ${seeds.join(" / ")}`);
}

console.log(failures ? `\n${failures} hostile-gang check(s) FAILED` : "\nAll hostile-gang checks passed");
process.exit(failures ? 1 : 0);