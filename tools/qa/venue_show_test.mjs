// The clubs' actual SHOW (human request, 2026-09-30): the bounce, the grind and
// the eight-count, the billing, and the lighting the rooms hang off them.
//
// The first half is about the three clips characters.js grew for this: that they
// are dance and not a wobble, that each has the shape it is supposed to have,
// and — the one that is actually hard — that `sync` really does put a whole cast
// in lockstep off a clock somebody else owns.
//
// The second half is that the rigs and the fixtures exist and are wired: the
// new interiors.js lightRig / laserBar fixtures hand their moving parts to the
// venue's spin list, and the franchise branches carry a floor, a bar and a
// light rig.
import { readFileSync } from "node:fs";

// The same no-op 2D context stripper_test.mjs stubs: characters.js's materials
// go through graphics.js, which wants a canvas for its micro-surface maps.
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
};
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => context2d }),
  head: { appendChild() {} }, body: { appendChild() {} },
  getElementById: () => null, addEventListener() {},
};

const THREE = await import("three");
const { makeStripper, makeHog, randomHoodrat } = await import("../../src/characters.js");

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
};

const dancer = (opts = {}) => makeStripper({ sex: "f", seed: 4242, height: 1.8, ...opts });
/** Every joint the clips drive, flattened — so two actors can be compared. */
const poseOf = (a) => [
  a.hips.position.y, a.hips.rotation.x, a.hips.rotation.z,
  a.torso.rotation.x, a.torso.rotation.y, a.torso.rotation.z,
  a.head.rotation.x, a.head.rotation.y,
  ...a.arms.flatMap((x) => [x.pivot.rotation.x, x.pivot.rotation.z, x.elbow.rotation.x]),
  ...a.legs.flatMap((l) => [l.pivot.rotation.x, l.knee.rotation.x, l.foot.rotation.x]),
  a.position.y,
];
const run = (a, seconds, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) a.update(dt); };
/** Run a clip and report what the joints actually did over the window. */
function measure(a, seconds = 12, dt = 1 / 60) {
  a.play(a.anim, { force: true, loop: true });
  // the key order here IS the sample order in `v` below
  const spans = { hipZ: [Infinity, -Infinity], hipY: [Infinity, -Infinity], torsoX: [Infinity, -Infinity], armX: [Infinity, -Infinity], yaw: [Infinity, -Infinity], armZ: [Infinity, -Infinity] };
  let bad = 0, prevHipZ = null, prevDir = 0, turns = 0, agreement = 0, samples = 0;
  for (let t = 0; t < seconds; t += dt) {
    const prevTorso = a.torso.rotation.x;
    const hipZ = a.hips.rotation.z;
    a.update(dt);
    const v = [hipZ, a.hips.position.y, a.torso.rotation.x, a.arms[0].pivot.rotation.x, a.rotation.y, a.arms[0].pivot.rotation.z];
    if (v.some((n) => !Number.isFinite(n))) bad++;
    const keys = Object.keys(spans);
    v.forEach((n, i) => { spans[keys[i]][0] = Math.min(spans[keys[i]][0], n); spans[keys[i]][1] = Math.max(spans[keys[i]][1], n); });
    // how fast the hips travel side to side: a change of direction is a beat
    if (prevHipZ != null) {
      const dir = Math.sign(hipZ - prevHipZ);
      if (dir && prevDir && dir !== prevDir) turns++;
      if (dir) prevDir = dir;
      // and whether the chest moves WITH the hips or against them: a real
      // isolation is the two travelling in opposite directions
      const dTorso = Math.sign(a.torso.rotation.x - prevTorso);
      if (dir && dTorso) { samples++; if (dir !== dTorso) agreement++; }
    }
    prevHipZ = hipZ;
  }
  return {
    bad, turns, samples,
    opposite: samples ? agreement / samples : 0,
    span: (k) => spans[k][1] - spans[k][0], min: (k) => spans[k][0], max: (k) => spans[k][1],
  };
}

// ---- 1. the three house clips ----------------------------------------------
for (const clip of ["twerk", "grind", "sync"]) {
  const a = dancer();
  a.play(clip, { force: true, loop: true });
  const m = measure(a, 20);
  check(`${clip}: runs clean`, m.bad === 0, `${m.bad} bad frames in 20 s`);
  check(`${clip}: it moves`, m.span("hipZ") > 0.05 && m.span("torsoX") > 0.05,
    `hips sweep ${m.span("hipZ").toFixed(3)} rad, torso ${m.span("torsoX").toFixed(3)} rad`);
}

// the bounce: a deep drop, hips and chest working against each other, and arms
// that are not welded to one pose
{
  const a = dancer();
  a.play("twerk", { force: true, loop: true });
  const m = measure(a, 8);
  check("twerk: the drop is deep", m.min("hipY") < 0.5 && m.span("hipY") > 0.08,
    `hips fall to ${m.min("hipY").toFixed(3)} m and come back up ${m.span("hipY").toFixed(3)} m`);
  check("twerk: the hips and the chest work against each other", m.opposite > 0.8,
    `${(m.opposite * 100).toFixed(0)}% of frames the chest travels opposite the hips`);
  check("twerk: the arms are not welded in one pose", m.span("armX") > 0.3 && m.span("armZ") > 0.2,
    `shoulder ${m.span("armX").toFixed(2)} rad, spread ${m.span("armZ").toFixed(2)} rad`);
}

// the grind: slower than the bounce, and it arches BACK rather than folding down
{
  const tw = dancer(), gr = dancer();
  tw.play("twerk", { force: true, loop: true });
  gr.play("grind", { force: true, loop: true });
  const a = measure(tw, 8), b = measure(gr, 8);
  check("grind: slower than the bounce", b.turns < a.turns,
    `${b.turns} direction changes over 8 s against the bounce's ${a.turns}`);
  check("grind: the chest arches back", b.min("torsoX") < -0.05,
    `torso reaches ${b.min("torsoX").toFixed(3)} rad (negative is the arch)`);
}

// ---- 2. THE NUMBER: one clock, one cast, eight counts -----------------------
{
  // Two dancers who are NOT on the same clock of their own — one was just told to
  // start a new number, the other has been on it for a while — sharing one beat.
  const beat = { t: 0 };
  const a = dancer({ seed: 1 }), b = dancer({ seed: 2 });
  a.beatRef = beat; b.beatRef = beat;
  a.play("sync", { force: true, loop: true });
  b.play("dance", { force: true, loop: true });
  b.play("sync", { force: true, loop: true });
  for (let i = 0; i < 12; i++) a.update(1 / 60);          // a is 0.2 s "ahead"
  let worst = 0, bad = 0;
  for (let i = 0; i < 600; i++) {
    beat.t += 1 / 60;
    a.update(1 / 60); b.update(1 / 60);
    const pa = poseOf(a), pb = poseOf(b);
    if (pa.some((n) => !Number.isFinite(n))) bad++;
    for (let k = 0; k < pa.length; k++) worst = Math.max(worst, Math.abs(pa[k] - pb[k]));
  }
  check("sync: no NaN over a full number", bad === 0, `${bad} bad frames`);
  check("sync: two dancers on one clock are the same dancer", worst < 1e-9,
    `worst joint difference ${worst.toExponential(2)} rad over 10 s`);
}
// ...and without a shared clock they are NOT, which is the whole reason for it
{
  const a = dancer({ seed: 1 }), b = dancer({ seed: 2 });
  a.play("sync", { force: true, loop: true });
  b.play("sync", { force: true, loop: true });
  a.update(0.5);                                           // a is half a second in
  let worst = 0;
  for (let i = 0; i < 60; i++) {
    a.update(1 / 60); b.update(1 / 60);
    for (let k = 0; k < poseOf(a).length; k++) worst = Math.max(worst, Math.abs(poseOf(a)[k] - poseOf(b)[k]));
  }
  check("sync: ...and out of step without one, so the clock is doing the work", worst > 0.05,
    `worst joint difference ${worst.toFixed(3)} rad`);
}
// the eight counts, and the turn on the seventh
{
  const beat = { t: 0 };
  const a = dancer();
  a.beatRef = beat;
  a.play("sync", { force: true, loop: true });
  const COUNT = 1.15;                       // characters.js SYNC_COUNT
  const seen = new Set();
  let turns = 0, lastYaw = a.rotation.y;
  for (let i = 0; i < Math.ceil(8 * COUNT * 60) + 10; i++) {
    beat.t += 1 / 60;
    a.update(1 / 60);
    seen.add(Math.floor(beat.t / COUNT) % 8);
    if (Math.abs(a.rotation.y - lastYaw) > 0.05) turns++;
    lastYaw = a.rotation.y;
  }
  check("sync: eight distinct counts to the number", seen.size === 8, `${seen.size} counts`);
  check("sync: the turn is on the seventh, once per number", turns > 8 && turns < 40,
    `${turns} moving frames — one whole revolution on count 7`);
}

// ---- 3. the billing ---------------------------------------------------------
// chest depth at bust height, measured off real vertices (stripper_test's probe)
const bustDepth = (a) => {
  const v = new THREE.Vector3();
  let best = -Infinity;
  a.updateMatrixWorld(true);
  a.traverse((m) => {
    if (!m.isMesh) return;
    const pos = m.geometry && m.geometry.attributes && m.geometry.attributes.position;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      m.localToWorld(v);
      if (v.y < 1.12 || v.y > 1.38) continue;
      if (Math.abs(v.x) > 0.17) continue;
      if (v.z > best) best = v.z;
    }
  });
  return best;
};
const sheet = dancer({ bust: 1.0 });
const pole = dancer({ bust: 1.62 });
const hog = makeHog({ variant: "dancer", sex: "f", seed: 7, height: 1.8 });
check("a pole dancer is billed well past the sheet", bustDepth(pole) > bustDepth(sheet) + 0.05,
  `${bustDepth(sheet).toFixed(3)} -> ${bustDepth(pole).toFixed(3)} m of chest`);
check("the hog dancers are billed past a pole dancer", bustDepth(hog) > bustDepth(pole),
  `${bustDepth(pole).toFixed(3)} -> ${bustDepth(hog).toFixed(3)} m`);

// ---- 4. the fixtures and the wiring -----------------------------------------
const src = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8");
const interiors = src("interiors.js"), crown = src("crownstrip.js");
const franchises = src("franchiseClubs.js");
check("interiors.js grows a moving-head rig", /^\s{2}lightRig\(b, s\)/m.test(interiors));
check("...and a laser fan", /^\s{2}laserBar\(b, s\)/m.test(interiors));
check("both hand their moving parts to the venue's spin list",
  (interiors.match(/b\.spin\(/g) || []).length >= 2);
check("the beams are additive and never write depth", /AdditiveBlending/.test(interiors) && /depthWrite: false/.test(interiors));
check("crownstrip ticks the rigs, and only while the room is drawn",
  /sp\.fn\(sp\.obj, dt, crownLightT\)/.test(crown) && /if \(r\.crowdIn\.group\.visible \|\| isIn\)/.test(crown));
check("STOOGELETS hangs two trusses and a laser fan",
  /id: "stoogelets"[\s\S]*?lightRig[\s\S]*?lightRig[\s\S]*?laserBar/.test(crown));
check("HAPPY HOGS hangs a rig and a laser fan too",
  /id: "happy-hogs"[\s\S]*?lightRig[\s\S]*?laserBar/.test(crown));
// a full house, not a stage with a floor
const castCounts = [...crown.matchAll(/cast: \{ crowd: (\d+)/g)].map((m) => +m[1]);
check("every Crown hall is cast fuller than it was", castCounts.length === 4 && Math.min(...castCounts) >= 20,
  `${castCounts.join(", ")} bodies on the floor`);
check("the branches carry a floor, a bar and a light rig",
  /function buildPatrons/.test(franchises) && /function buildLightRig/.test(franchises) && /const PATRONS = (\d+)/.test(franchises)
    && +franchises.match(/const PATRONS = (\d+)/)[1] >= 12,
  `${franchises.match(/const PATRONS = (\d+)/)[1]} patrons per branch`);
// the branch cast is on one clock, which is what the numbers need
check("every performer in a branch is handed the club's clock",
  /actor\.beatRef = rec\.beat/.test(franchises) && /host\.beatRef = rec\.beat/.test(franchises));
check("...and the whole cast changes routine on the club's beat, not its own",
  /c\.routineIndex = \(c\.routineIndex \+ steps\) % c\.routine\.length/.test(franchises)
    // `[\s\S]*?` between the loop header and the assignment, not `\s*\n\s*`: a
    // guard clause (skip the dead, skip the culled) inside the loop body is
    // good code and used to read as a failure of this check.
    && /for \(const p of c\.performers\) \{[\s\S]*?p\.routineIndex = c\.routineIndex/.test(franchises));

// ---- 5. the beams point the right way ---------------------------------------
// A THREE.ConeGeometry's APEX is its +y end, which is the opposite of what a
// light beam wants: every one of these hangs a cone off a lens and has to get
// the apex onto the lens and the wide end into the room. Getting the roll sign
// wrong does not throw — it throws THROUGH THE WALL, or up through the ceiling,
// and nothing in the build test would ever see it. So: the transform, measured.
const beamEnds = (rx, reach) => {
  const g = new THREE.ConeGeometry(0.2, reach, 6, 1, true);
  const apex = new THREE.Vector3(0, reach / 2, 0).applyEuler(new THREE.Euler(rx, 0, 0));
  const base = new THREE.Vector3(0, -reach / 2, 0).applyEuler(new THREE.Euler(rx, 0, 0));
  return { apex, base, g };
};
// interiors.js laserBar: rolled -90° about x, offset +reach/2 along z
{
  const { apex, base } = beamEnds(-Math.PI / 2, 16);
  const apexZ = apex.z + 8, baseZ = base.z + 8;
  check("a laser beam's apex lands on the lens", Math.abs(apexZ) < 1e-9,
    `apex at z=${apexZ.toFixed(3)} (the projector)`);
  check("...and the fan throws out over the floor", baseZ > 15, `base at z=${baseZ.toFixed(2)} m`);
  check("interiors.js rolls its beams the same way", /beam\.rotation\.x = -Math\.PI \/ 2/.test(interiors));
  check("nightlife.js rolls its beams the same way", /beam\.rotation\.x = -Math\.PI \/ 2/.test(src("nightlife.js")));
  check("the branches hang their fan below the lens instead",
    /beam\.position\.set\(0, -2\.7, 0\)/.test(franchises), "cone dropped half its length, apex up at the projector");
}

console.log(failures ? `\n${failures} venue-show check(s) FAILED` : "\nAll venue-show checks passed");
process.exit(failures ? 1 : 0);
