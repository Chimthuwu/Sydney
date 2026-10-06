// npc_panic_test.mjs — does a bystander actually stop running?
//
// "all NPCs seem to constantly be in a state of panic"
//
// The cause was a re-entrant flee in npc.js's decide(). Two branches fled on
// gunfire. The first set `e.panic = true`; the second called flee() WITHOUT it,
// and its guard was `e.state !== "flee"` — which its own flee() had just made
// false. So a bystander who fled through that branch re-entered it on the very
// next frame and drew a fresh `stateT` of rand(8,12) every frame, for as long as
// the noise event was alive and then some. A run could not end.
//
// This drives the real decide() — through the real createNpcSystem, so the fix
// cannot rot here without the game changing — and asserts what the player sees: a
// bystander startled by one shot runs, then STOPS, with no further shots.
//
// The actor is a bare Object3D with a position, because that is all decide()
// reads off `e.spr`. The meshes and the character builders are not what is under
// test and they want a renderer this harness does not have.
import { installBrowserStub } from "./lib/browser_stub.mjs";
installBrowserStub();
globalThis.addEventListener = () => {};

import * as THREE from "three";
import { createNpcSystem } from "../../src/npc.js";

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "  ok  " : "  FAIL"} ${m}`); if (!c) fails++; };

// init() puts every ped at its nearest hangout and sets e.home to it. With an
// empty poi list nearestPoi() returns undefined, e.home is undefined, and
// pickGoal() throws on the first idle frame — so the hangouts are not optional
// scaffolding here, they are what the wandering branch reads.
const POIS = [
  { x: 6, z: 0, r: 20 }, { x: 20, z: 0, r: 20 }, { x: -6, z: 0, r: 20 },
];

const npcs = createNpcSystem({
  pois: POIS,
  resolveCollision: (_c, n) => n,  // nothing collides in a headless count
  hitPlayer: () => {},
  bounds: { minX: -400, maxX: 800, minZ: 100, maxZ: 520 },
  worldTime: { isNight: () => false, hour: () => 12 },
});

// npc.js's act() drives the animation through spr.play / spr.pose and walks the
// walk cycle through `e.legs`, so the stub carries the few methods and fields a
// real characters.js view has. Without them act() throws on the first frame and
// the test measures nothing at all.
function stubView(x, z) {
  const v = new THREE.Object3D();
  v.position.set(x, 0, z);
  v.play = () => {};
  v.pose = () => {};
  v.stop = () => {};
  v.setFlip = () => {};
  v.setTint = () => {};
  // a hog is four legs: act() walks them through spr.userData.legs
  v.userData.legs = [{ position: new THREE.Vector3() }, { position: new THREE.Vector3() }];
  v.anim = "";
  v.finished = false;
  v.visible = true;
  return v;
}

// act() reads its speed, damage and range off `e.T`, the per-archetype stats
// table main.js attaches at spawn. The numbers here are not the game's — nothing
// under test depends on them — they only have to exist so act() can move the ped.
const STATS = { speed: 1.5, dmg: 10, range: 1.6, aggro: 20, hp: 100 };

function pedIn(sys, type, x, z) {
  const e = {
    type, T: { ...STATS }, spr: stubView(x, z), t: 0, hp: 100,
    atkCd: 0, chargeCd: 0, stateT: 1, think: 0,
    // pickGoal() walks an idle ped to `e.goal` around `e.home`; init() fills both
    // in, so they are left off here rather than guessed at.
    goal: new THREE.Vector3(x, 0, z),
  };
  sys.init(e);
  return e;
}

function ped(type, x, z) { return pedIn(npcs, type, x, z); }

const env = {
  player: { x: 0, z: 0 }, playerSafe: false, veh: null, stealth: 1,
  state: { cinematic: false }, onSolicit: () => {}, others: [],
};
function stepIn(sys, es, dt = 0.1) { sys.beginFrame(dt); for (const e of es) sys.update(e, dt, env); }
const step = (es, dt = 0.1) => stepIn(npcs, es, dt);

// ---- calm to begin with
const a = ped("suit", 6, 0);
step([a]);
ok(a.state !== "flee", `an uneventful bystander is not fleeing (state "${a.state}")`);

// ---- one shot: they bolt
npcs.noise(4, 0, 26);
let sawFlee = false;
for (let i = 0; i < 30; i++) { a.think = 0; step([a]); if (a.state === "flee") sawFlee = true; }
ok(sawFlee, `one nearby shot makes them run (state "${a.state}")`);

// ---- and then the run ENDS. This is the assertion that fails without the fix.
let fleeingFrames = 0;
const totalFrames = 400;
for (let i = 0; i < totalFrames; i++) {          // 40 s, nothing else happening
  a.think = 0; step([a]);
  if (a.state === "flee") fleeingFrames++;
}
ok(fleeingFrames < totalFrames * 0.6,
  `the run ends on its own — fleeing ${fleeingFrames}/${totalFrames} frames after ONE shot`);

// ---- a whole street, not just one ped
const crowd = [];
for (let i = 0; i < 12; i++) crowd.push(ped(i % 2 ? "tourist" : "suit", 7 + i * 1.4, (i % 4) - 2));
npcs.noise(3, 0, 30);
for (let i = 0; i < 30; i++) { for (const e of crowd) e.think = 0; step(crowd); }
const atPeak = crowd.filter((e) => e.state === "flee").length;
ok(atPeak >= 6, `a shot scatters the street (${atPeak}/12 running)`);
for (let i = 0; i < 500; i++) { for (const e of crowd) e.think = 0; step(crowd); }
const stuck = crowd.filter((e) => e.state === "flee").length;
ok(stuck === 0, `and the street calms again — ${stuck}/12 still running 50s later`);

// ---- a NEW shot still works: the guard is one-shot, not permanent immunity.
// Walk them back first. Five hundred flee frames carry them past npc.js's FAR=110
// cull, past which update() skips decide() entirely, so a ped left out there can
// never be startled again no matter how the fix is written. That is the LOD, not
// a panic bug — so the test brings them back into range first.
const bringBack = (e) => { e.spr.position.set(7, 0, 0); e.goal.set(7, 0, 0); e.home = { x: 7, z: 0, r: 12 }; };

bringBack(crowd[0]);
npcs.noise(5, 0, 26);
let restarted = 0;
for (let i = 0; i < 30; i++) { crowd[0].think = 0; step([crowd[0]]); if (crowd[0].state === "flee") restarted++; }
ok(restarted > 0, "a NEW shot still sends them running");

// ---- and it can still happen more than once, so this is not "panic once, ever"
for (let round = 0; round < 3; round++) {
  bringBack(crowd[1]);
  npcs.noise(5, 0, 26);
  let n = 0;
  for (let i = 0; i < 30; i++) { crowd[1].think = 0; step([crowd[1]]); if (crowd[1].state === "flee") n++; }
  ok(n > 0, `they can be startled again (round ${round + 1})`);
  for (let i = 0; i < 500; i++) { crowd[1].think = 0; step([crowd[1]]); }
  ok(crowd[1].state !== "flee", `...and settle again (round ${round + 1})`);
}

// ---- THE ACTUAL BUG: a bystander pinned in earshot of sustained gunfire.
//
// Every scenario above lets the ped RUN, and a ped that runs leaves the noise
// radius in a second or two — so the panic branch is entered once and the
// runaway never shows. The runaway needs the two conditions a real firefight
// supplies and a ped walking away does not:
//
//   1. the ped cannot leave — resolveCollision holds it in place, which is what
//      being cornered in an alley looks like, and
//   2. the event keeps being refreshed — gunfire is not one noise, it is a
//      burst, so a new event is posted on many consecutive frames and
//      panicEvent() never returns null.
//
// Under those, the unguarded branch re-enters on EVERY frame: flee() sets state
// to "flee", the guard only tested `pev`, the branch re-fires, and stateT is
// reassigned rand(8,12) sixty times a second. The run can never expire. That is
// "all NPCs seem to constantly be in a state of panic" — a ped that sprints
// forever because the state machine is being restarted before it can count down.
//
// So: count how many separate flee RUNS this ped gets. With the bug it is in the
// dozens; with the guard it is one. This is the assertion that fails on the
// unfixed code, and it is the reason this test exists.
const pinned = createNpcSystem({
  pois: POIS,
  // The ped cannot walk out of earshot. resolveCollision is how act() moves it,
  // so returning a fixed point holds it where it stands — being cornered in an
  // alley is exactly this. Note it must return the PED's own spot, not the
  // origin: returning {x:0,z:0} teleports the ped 103 m away instead of pinning
  // it, and then the panic branch is never re-entered and the bug hides.
  resolveCollision: () => ({ x: 3, z: 0 }),
  hitPlayer: () => {},
  bounds: { minX: -400, maxX: 800, minZ: 100, maxZ: 520 },
  worldTime: { isNight: () => false, hour: () => 12 },
});
const cornered = pedIn(pinned, "suit", 3, 0);
// Watch stateT, not the state. The runaway is not the ped entering "flee" over
// and over — once it is in "flee" it stays there either way. The runaway is that
// stateT, the countdown that ends the run, is reassigned rand(8,12) on EVERY
// frame while the fright is live. So stateT never falls, the flee can never
// expire, and the ped sprints for as long as the shooting lasts and then some.
// Counting runs cannot see that; holding stateT near 12 can.
let minStateT = Infinity, resets = 0, lastStateT = cornered.stateT;
for (let i = 0; i < 600; i++) {              // 60 s of sustained fire
  if (i % 6 === 0) pinned.noise(3, 0, 26);   // a burst at the ped, refreshed every 0.6 s
  cornered.think = 0;
  stepIn(pinned, [cornered]);
  if (cornered.state === "flee") {
    minStateT = Math.min(minStateT, cornered.stateT);
    if (cornered.stateT > lastStateT + 1) resets++;   // thrown back to the top
  }
  lastStateT = cornered.stateT;
}
// One reset per completed flee cycle is CORRECT: the ped runs for its 8-12 s,
// calms, and the next burst in the burst-train frightens them again. Over 60 s of
// gunfire that is a handful of resets. The bug resets stateT on EVERY frame, so
// the counts are tens apart, not a couple of units.
ok(resets <= 12, `the flee countdown is not restarted every frame — ${resets} resets in 60 s of sustained gunfire`);
ok(minStateT < 6, `stateT actually counts down while the fright is live (bottomed out at ${minStateT.toFixed(1)}s)`);
// They do NOT sit in "flee" forever either: once the countdown runs out the ped
// calms, clears `panic`, and the next burst in the burst-train frightens them
// again. That is the settled behaviour — an oscillation of short runs, not one
// endless sprint — so it is asserted as "it calms down at some point", not as a
// state at the final frame.
let calmed = false;
for (let i = 0; i < 600; i++) {
  if (i % 6 === 0) pinned.noise(3, 0, 26);
  cornered.think = 0;
  stepIn(pinned, [cornered]);
  if (cornered.state !== "flee") calmed = true;
}
ok(calmed, "a cornered bystander does calm down between bursts, and can be re-frightened");

// ---- the fighters never panic. That was the whole point of STANDS_GROUND.
const hog = ped("hog", 9, 0);
const hood = ped("hoodrat", 9.5, 0);
npcs.noise(4, 0, 26);
for (let i = 0; i < 30; i++) { hog.think = 0; hood.think = 0; step([hog, hood]); }
ok(hog.state !== "flee", `a hog does not flee from gunfire (state "${hog.state}")`);
ok(hood.state !== "flee", `a hoodrat does not flee from gunfire (state "${hood.state}")`);

// ---- and being provoked is not the same as being panicked.
// These last two run in a FRESH system. The provoke branch goes through
// becomeHostile(), which is capped by npc.js's maxHostile budget — and by now a
// dozen peds from the street tests have already spent it, so on a shared system
// a provoked ped silently fails to turn hostile and flees instead. That is the
// cap doing its job, not the provoke path misbehaving. Provoke and panic are
// also separate flags on separate code paths: stacking noise() on top of
// provoke() makes the assertion depend on which branch wins a race.
//
// The mood is forced rather than rolled: temperament() is seeded from
// Math.random, so a civilian is timid or skittish some of the time, and a timid
// ped running when provoked is correct — it is the other half of the assertion
// below, not a failure.
const fresh = () => createNpcSystem({
  pois: POIS, resolveCollision: (_c, n) => n, hitPlayer: () => {},
  bounds: { minX: -400, maxX: 800, minZ: 100, maxZ: 520 },
  worldTime: { isNight: () => false, hour: () => 12 },
});

const sysA = fresh();
const provoked = pedIn(sysA, "suit", 3, 0);
provoked.mood = "brave";
sysA.provoke(provoked);
// Assert the transition, not the drift. A hostile ped charges the player, ends
// up past e.T.aggro + 18, and after 6 s of that npc.js correctly calms it back
// to "wander" — so a 30-frame loop reads "wander" for a ped that did turn
// hostile. Two frames is the transition and nothing more.
let everHostile = false;
for (let i = 0; i < 2; i++) { provoked.think = 0; stepIn(sysA, [provoked]); if (provoked.state === "hostile") everHostile = true; }
ok(everHostile, `a provoked brave ped fights instead of running (state "${provoked.state}")`);
ok(sysA.hostileCount === 1, `...and counts against the hostile budget (${sysA.hostileCount})`);

// ---- a timid civilian still runs when provoked: the panic fix did not flatten
// the temperament roll into "everything fights".
const sysB = fresh();
const skittish = pedIn(sysB, "suit", 3, 0);
skittish.mood = "timid";
sysB.provoke(skittish);
for (let i = 0; i < 4; i++) { skittish.think = 0; stepIn(sysB, [skittish]); }
ok(skittish.state === "flee", `a timid civilian still runs when provoked (state "${skittish.state}")`);

console.log(fails ? `\n${fails} FAILURES` : "\nall npc panic checks passed");
process.exit(fails ? 1 : 0);