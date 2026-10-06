// ---------------------------------------------------------------------------
// audio_weapons_test.mjs — headless checks for the car audio + 3D weapons
// wiring (TASK-040).
//
// Verifies:
//   A. weapons_3d.js — the module contract around attachment: boot puts nothing
//      in the scene, an absent actor is a safe no-op (menu / between states),
//      every weapon the game can hold has a rig, and the muzzle only exists for
//      a weapon that is actually held.
//
//      This section used to assert the old VIEW MODEL: one pivot added to the
//      scene, moved around the player's world position, holstered by writing
//      `position.y` and a rotation onto it. That design is exactly what made a
//      weapon read as an image parked next to the character, so it is gone.
//      The geometry — grip in the fist, muzzle down the aim, support hand on the
//      foregrip — is measured in weapon_hold_test.mjs against a real rig.
//   B. audio.js — car audio is lazy and gesture-safe: createCarAudio before
//      initAudio returns a usable no-op object, audio only builds for the
//      active car, deactivating it stops and tears down, destroy() cleans up,
//      and resumeAudio() resumes the suspended context.
//   C. vehicles.js — collisionResponse() reports the first-frame impact as
//      v.impact (the hook drivingUpdate turns into crash damage).
//
// Run: node tools/qa/audio_weapons_test.mjs
// (uses the installed Three.js r160 package in Node)
// ---------------------------------------------------------------------------

import * as THREE from "three";

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log(`✓ PASS: ${msg}`); return; }
  failures++;
  console.error(`✗ FAIL: ${msg}`);
}
function section(name) { console.log(`\n--- ${name} ---`); }

const { initAudio, createCarAudio, resumeAudio, startZombieAmbience, stopZombieAmbience } = await import("../../src/audio.js");
const { initWeapons3D, updateWeapon3D, getWeaponMuzzle, playFireAnim3D, notifyReload3D, weaponRigState, WEAPON_RIGS, GLB_SKINS, createViewmodel } = await import("../../src/weapons_3d.js");
const { WEAPONS } = await import("../../src/weapons.js");
const { collisionResponse, stepArcadeVehicle } = await import("../../src/vehicles.js");

// ===========================================================================
section("A. weapons_3d — attachment contract");
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.3, 420);
// Three's AudioListener expects the browser Web Audio API. Keep this unit test
// headless with a minimal context; no sound is rendered or auditioned here.
const audioParam = () => ({ value: 0, setTargetAtTime() {}, linearRampToValueAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
const audioNode = () => ({ connect() {}, disconnect() {}, gain: audioParam() });
const oscillators = [];
const bufferPlays = [];  // audio buffers actually played (the recorded zombie SFX path)
const realTimerForFlush = globalThis.setTimeout;   // captured before section C stubs it
const flushAudio = () => new Promise((resolve) => realTimerForFlush(resolve, 20));  // let THREE's loader promises settle
const audioFilter = () => ({ connect() {}, disconnect() {}, frequency: audioParam(), Q: { value: 0 } });
const audioContext = {
  state: "suspended", currentTime: 0, destination: {},
  listener: { setPosition() {}, setOrientation() {} },
  createGain: audioNode,
  createPanner: () => ({ connect() {}, disconnect() {}, setPosition() {}, setOrientation() {} }),
  createBufferSource: () => {
    const src = { connect() {}, start() {}, stop() {}, playbackRate: audioParam(), detune: audioParam() };
    bufferPlays.push(src);
    return src;
  },
  createBiquadFilter: audioFilter,
  createOscillator: () => {
    const oscillator = { connect() {}, start() {}, stop() {}, frequency: audioParam(), detune: audioParam(), type: "sine" };
    oscillators.push(oscillator);
    return oscillator;
  },
  createStereoPanner: () => ({ connect() {}, disconnect() {}, pan: { value: 0 } }),
  decodeAudioData: (data, ok) => ok({ duration: 0.8 }),   // recorded-SFX loads succeed with a stub buffer
  resume() { this.state = "running"; return Promise.resolve(); },
};
globalThis.window = { AudioContext: class { constructor() { return audioContext; } } };
// Three's FileLoader accepts browser-relative URLs; resolve them for Node and
// return a 404 so the normal missing-audio fallback is exercised without I/O.
const NativeRequest = globalThis.Request;
globalThis.Request = class extends NativeRequest {
  constructor(input, init) { super(new URL(input, "http://localhost/"), init); }
};
// Node lacks ProgressEvent, which THREE's FileLoader constructs on every fetch
// (success AND error paths) — both the 404-fallback and the loaded-SFX paths
// below need it. Section C2 saves/restores the shim around its own stubs.
const NativeProgressEvent = globalThis.ProgressEvent;
if (!NativeProgressEvent) {
  globalThis.ProgressEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init || {}); } };
}
globalThis.fetch = async () => new Response("", { status: 404 });
initWeapons3D(scene);                    // browser-only rifle loader leaves the procedural fallback in Node
assert(scene.children.length === 0,
  "initWeapons3D adds nothing to the scene (weapons hang off the character, not the world)");

const pos = new THREE.Vector3(0, 0, 0);
const aim = new THREE.Vector3(0, 0, 1);
// Between states there is no actor. That has to be a no-op, for every id, on
// every frame — it is the menu, the cutscene and the load path all at once.
for (const id of Object.keys(WEAPONS)) {
  updateWeapon3D(null, pos, aim, id, 1 / 60, true);
  updateWeapon3D(undefined, pos, aim, id, 1 / 60, false);
}
assert(weaponRigState().attached === false, "no actor (menu / between states) is a safe no-op");
assert(getWeaponMuzzle(new THREE.Vector3()) === null, "no muzzle while nothing is held");
// an object that is not a character (no hand socket) must also be refused, not
// half-attached to
const notAnActor = new THREE.Group();
updateWeapon3D(notAnActor, pos, aim, "pistol", 1 / 60, true);
assert(weaponRigState().attached === false, "an object with no hand socket is refused");
// the fire/reload hooks are safe with nothing attached (a queued input can land
// in the same frame a weapon is dropped)
playFireAnim3D("pistol", false);
playFireAnim3D("bat", true);
notifyReload3D("pistol", 1.1);
notifyReload3D("bat", 1);
assert(true, "fire / reload hooks do not throw with nothing held");

// Every weapon the arsenal can hold needs a rig entry, or it silently falls
// back to the pistol — carried like a 9mm, which is how a new weapon ends up
// looking wrong instead of failing.
for (const id of Object.keys(WEAPONS)) {
  assert(!!WEAPON_RIGS[id], `weapon "${id}" has a rig entry (hold pose, grip, muzzle)`);
}
assert(Object.keys(WEAPON_RIGS).length >= Object.keys(WEAPONS).length,
  "no rig entry exists for a weapon the game cannot hold");
assert(!GLB_SKINS.sawnoff, "sawed-off has no imported skin override and stays on its procedural model");
assert(GLB_SKINS.tec9.rotY === 0, "Tec-9 imported model keeps its forward-facing authored orientation");
assert(GLB_SKINS.deerRifle.rotY === 0, "deer-rifle imported model keeps its forward-facing authored orientation");
const sawnoffView = createViewmodel("sawnoff");
const sawnoffBounds = new THREE.Box3().setFromObject(sawnoffView.model);
const sawnoffSize = sawnoffBounds.getSize(new THREE.Vector3());
assert(Math.max(sawnoffSize.x, sawnoffSize.y, sawnoffSize.z) < 1,
  "sawed-off first-person model stays human-sized (not an oversized imported skin)");
let sawnoffWeaponMeshes = 0, sawnoffBrightMeshes = 0, sawnoffEmissiveMeshes = 0;
sawnoffView.model.getObjectByName("weapon:sawnoff").traverse((o) => {
  if (!o.isMesh || !o.userData.noBatch) return;
  sawnoffWeaponMeshes++;
  const materials = Array.isArray(o.material) ? o.material : [o.material];
  if (materials.some((m) => m && m.color && m.color.getHex() > 0xaaaaaa)) sawnoffBrightMeshes++;
  if (materials.some((m) => m && m.emissive && m.emissive.getHex() !== 0)) sawnoffEmissiveMeshes++;
});
assert(sawnoffWeaponMeshes > 0 && sawnoffBrightMeshes === 0,
  "sawed-off falls back to its dark steel-and-wood procedural skin");
assert(sawnoffEmissiveMeshes === 0, "sawed-off material is not self-illuminated white in first person");
for (const [id, def] of Object.entries(WEAPON_RIGS)) {
  assert(Array.isArray(def.muzzleOffset) && def.muzzleOffset.length === 3 && def.muzzleOffset.some((v) => v !== 0),
    `[${id}] has a real muzzle offset (effects start at the barrel)`);
  assert(def.handOffset.length === 3 && def.rotationOffset.length === 3,
    `[${id}] carries its attachment config (hand / rotation offsets)`);
  assert(["pistol", "long", "melee"].includes(def.hold),
    `[${id}] names a hold pose the character rig implements`);
}

// ===========================================================================
section("B. audio — lazy, gesture-safe, gated to the player's car");
const car = new THREE.Group();
// BEFORE initAudio: the pre-fix bug was `undefined` here (cars registered
// before any gesture got nothing forever). Now it's a usable no-op object.
const preAudio = createCarAudio(car);
assert(!!preAudio && typeof preAudio.update === "function", "createCarAudio before initAudio still returns a usable object");
preAudio.update(50, false, true);        // must not throw without a listener
assert(car.children.length === 0, "no audio nodes attached before initAudio");

initAudio(camera);
assert(camera.children.some(c => c.type === "AudioListener"), "initAudio put an AudioListener on the camera");
resumeAudio();
await Promise.resolve();                  // resumeAudio is async
assert(camera.children[0].context.state === "running", "resumeAudio() resumes the suspended context");

const audio = createCarAudio(car);
audio.update(50, false, true);           // listener exists now → builds (buffers still loading)
const group = car.children.find(c => c.type === "Group");
assert(!!group, "active car gets an audio group attached");
assert(audio.started === true, "audio marks itself started once activated");

// traffic car: active=false never builds, and deactivating tears down
const trafficCar = new THREE.Group();
const trafficAudio = createCarAudio(trafficCar);
trafficAudio.update(80, false, false);
assert(trafficCar.children.length === 0, "inactive (traffic) car builds no audio");
audio.update(0, false, false);           // player got out
assert(car.children.length === 0, "deactivating the player's car removes the audio group");
assert(audio.started === false, "deactivated audio resets to unstarted");
audio.update(30, false, true);           // back in
assert(!!car.children.find(c => c.type === "Group"), "re-entering the car rebuilds audio");
audio.destroy();
assert(car.children.length === 0, "destroy() removes the audio group (explodeCar path)");
audio.destroy();                          // idempotent
assert(true, "destroy() is safe to call twice");
assert(audio.engine === null && audio.squeal === null, "destroy() drops the engine and squeal nodes");

// ===========================================================================
section("C. zombie ambience — silent gaps, nearby scaling, safe stop (TASK-081)");
{
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const timers = new Map();
  const realRandom = Math.random;
  let nextTimerId = 1;
  const runNextTimer = () => {
    const entry = timers.entries().next().value;
    if (!entry) return null;
    const [id, timer] = entry;
    timers.delete(id);
    timer.fn();
    return timer.ms;
  };
  // pre-section baselines, captured before this section can attempt any play
  const buffersBefore0 = () => (buffersBefore0.n ??= bufferPlays.length);
  const oscBefore0 = () => (oscBefore0.n ??= oscillators.length);
  buffersBefore0(); oscBefore0();
  try {
    Math.random = () => 0.5;
    globalThis.setTimeout = (fn, ms) => {
      const id = nextTimerId++;
      timers.set(id, { fn, ms });
      return id;
    };
    globalThis.clearTimeout = (id) => timers.delete(id);
    let nearby = 8;
    const playerPos = { x: 0, z: 0 };
    audioContext.state = "suspended";
    startZombieAmbience(() => playerPos, () => nearby);
    startZombieAmbience(() => playerPos, () => nearby); // idempotent
    assert(timers.size === 1, "starting zombie ambience is idempotent");
    runNextTimer();
    assert(oscillators.length === 0, "suspended AudioContext remains silent without throwing");
    stopZombieAmbience();
    assert(timers.size === 0, "stopZombieAmbience clears the pending callback");

    audioContext.state = "running";
    startZombieAmbience(() => playerPos, () => nearby);
    assert(runNextTimer() === 2000, "ambience waits before its first groan");
    await flushAudio();   // the recorded-SFX load fails (404 here) — that voice is simply silent
    assert(bufferPlays.length === buffersBefore0(), "a failed SFX load plays no buffer");
    assert(oscillators.length === oscBefore0(), "no synthesised voice substitutes for a failed load (the synth was retired)");
    const nextGap = [...timers.values()][0]?.ms;
    assert(nextGap >= 4000 && nextGap <= 22000, "groans are separated by a randomized quiet interval");
    Math.random = () => 0; // minimum crowd interval multiplied by minimum jitter used to undershoot 4 s
    runNextTimer();
    await flushAudio();
    const lowerGap = [...timers.values()][0]?.ms;
    assert(lowerGap >= 4000 && lowerGap <= 22000, "minimum cadence jitter stays within the documented silence bounds");
    Math.random = () => 1; // maximum crowd interval multiplied by maximum jitter used to exceed 22 s
    runNextTimer();
    await flushAudio();
    const upperGap = [...timers.values()][0]?.ms;
    assert(upperGap >= 4000 && upperGap <= 22000, "maximum cadence jitter stays within the documented silence bounds");
    nearby = 0;
    runNextTimer();
    await flushAudio();
    assert(bufferPlays.length === buffersBefore0(), "zero nearby zombies produces silence, not a looping bed");
    assert([...timers.values()][0]?.ms === 3000, "quiet ambience only schedules a later population check");
    stopZombieAmbience();
    assert(timers.size === 0, "stopping ambience cancels its next population check");
    assert(oscillators.length === oscBefore0(), "no synthesised zombie voice ever fires (retired 2026-09-27)");
  } finally {
    stopZombieAmbience();
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    Math.random = realRandom;
  }
}

// ===========================================================================
section("C2. zombie ambience — recorded groans play when files load (no scream asset loaded)");
{
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const realRandom = Math.random;
  const realNow = Date.now;
  const realFetch = globalThis.fetch;
  const timers = new Map();
  let nextTimerId = 1;
  const runNextTimer = () => {
    const entry = timers.entries().next().value;
    if (!entry) return null;
    const [id, timer] = entry;
    timers.delete(id);
    timer.fn();
    return timer.ms;
  };
  globalThis.setTimeout = (fn, ms) => { const id = nextTimerId++; timers.set(id, { fn, ms }); return id; };
  globalThis.clearTimeout = (id) => timers.delete(id);
  const RealProgressEvent = globalThis.ProgressEvent;
  try {
    Math.random = () => 0.5;
    Date.now = () => 1_000_000;
    // Serve bytes so THREE's loader decodes the "files" successfully — the
    // recorded assets in assets/audio/zombie/ take over from the synth.
    const requestedAudio = [];
    globalThis.fetch = async (input) => {
      requestedAudio.push(String(input));
      return new Response(new ArrayBuffer(8), { status: 200 });
    };
    const nearby = 8;
    const playerPos = { x: 0, z: 0 };
    const buffersBefore = bufferPlays.length;
    const oscBefore = oscillators.length;
    audioContext.state = "running";
    startZombieAmbience(() => playerPos, () => nearby);
    assert(runNextTimer() === 2000, "recorded ambience starts its groan schedule");
    await flushAudio();
    assert(bufferPlays.length === buffersBefore + 1, "a loaded zombie file plays as a buffer");
    assert(oscillators.length === oscBefore, "the synth stays silent while recorded audio is available");
    assert(!requestedAudio.some((url) => url.includes("scream0.mp3")), "the loud scream recording is never requested");
    stopZombieAmbience();
    assert(timers.size === 0, "stopping the recorded ambience cancels its schedule");
  } finally {
    stopZombieAmbience();
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    Math.random = realRandom;
    Date.now = realNow;
    globalThis.fetch = realFetch;
    if (RealProgressEvent === undefined) globalThis.ProgressEvent = undefined; else globalThis.ProgressEvent = RealProgressEvent;
  }
}

// ===========================================================================
section("D. vehicles — v.impact contract (crash damage source)");
{
  const v = { heading: Math.PI / 2, speed: 20, jolt: 0, inContact: false };   // heading east
  const intendedX = 20, intendedZ = 0;
  const resolvedX = 18, resolvedZ = 0;                                        // wall pushed it 2 m back
  const touching = collisionResponse(v, intendedX, intendedZ, resolvedX, resolvedZ, 1 / 60);
  assert(touching === true, "head-on contact reported as touching");
  assert(v.impact > 0, `first frame sets v.impact (${v.impact && v.impact.toFixed(1)} m/s)`);
  assert(v.speed < 20, "head-on hit lost speed");
  const impact = v.impact;
  collisionResponse(v, intendedX, intendedZ, resolvedX + 0.01, resolvedZ, 1 / 60);
  assert(v.impact === impact, "impact does not stack on later frames of the same contact");
}
{
  // glancing scrape must NOT set impact (that's a slide, not a crash)
  const v = { heading: 0, speed: 15, jolt: 0, inContact: false };             // moving +z
  const intendedX = 0, intendedZ = 15;
  const resolvedX = 0.5, resolvedZ = 15;                                      // tiny sideways push only
  collisionResponse(v, intendedX, intendedZ, resolvedX, resolvedZ, 1 / 60);
  assert(!v.impact, "a sideways scrape sets no impact (not crash damage)");
}
{
  // stepping a car normally leaves impact untouched
  const v = { heading: Math.PI, speed: 10 };
  stepArcadeVehicle(v, { throttle: 1, steer: 0, brake: false }, 1 / 60);
  assert(!v.impact, "ordinary driving leaves v.impact untouched");
}

// ===========================================================================
console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
