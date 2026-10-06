// The private scenes and the explicit stage business, end to end.
//
// This is the test that would have caught a scene that silently did nothing:
// every clip is run on a real rig for a real stretch of time, the garment
// actually comes off and actually goes back on, the two halves of a position are
// actually in agreement, and the whole thing is refused by the gate when the gate
// says no.
import { readFileSync } from "node:fs";

const noop = () => {};
const gradient = { addColorStop: noop };
const context2d = {
  fillStyle: "", font: "", textAlign: "", textBaseline: "", globalAlpha: 1,
  fillRect: noop, fillText: noop, save: noop, restore: noop, translate: noop,
  rotate: noop, scale: noop, beginPath: noop, closePath: noop, moveTo: nooop(),
  lineTo: noop, arc: noop, rect: noop, fill: noop, stroke: noop, clip: noop,
  clearRect: noop, drawImage: noop, createLinearGradient: () => gradient,
  createRadialGradient: () => gradient, getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  putImageData: noop, measureText: () => ({ width: 10 }),
  createImageData: () => ({ data: new Uint8ClampedArray(4) }),
  setLineDash: noop, setTransform: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
};
function nooop() { return noop; }
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => context2d }),
  head: { appendChild() {} }, body: { appendChild() {} },
  getElementById: () => null, addEventListener() {},
};

const THREE = await import("three");
const chars = await import("../../src/characters.js");
const { makeStripper, makeHoodrat, makeDancer, setAdultGate, ADULT_CLIPS } = chars;
const { createAct, beginStageAct, SCENES, STAGE_ACT } = await import("../../src/act.js");

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
};
const STAGE_CLIPS = ["stripTease", "flash", "spreadTease", "stageRub"];
const COUPLE_CLIPS = ["missionary", "doggystyle", "oral", "roughOral", "sixtyNine", "assToMouth"];

// the gate is answered for the whole of this file; the refusal paths have their
// own test (adult_clip_gate_test.mjs) and mixing them here would only make every
// check below conditional on a global
setAdultGate(() => true);

const joints = (a) => {
  const v = [
    a.hips.position.y, a.hips.rotation.x, a.hips.rotation.z,
    a.waist.rotation.x, a.waist.rotation.y,
    a.torso.rotation.x, a.torso.rotation.y, a.torso.rotation.z,
    a.head.rotation.x, a.head.rotation.y, a.head.rotation.z,
  ];
  for (const x of [...a.arms, ...a.legs]) v.push(x.pivot.rotation.x, x.pivot.rotation.y, x.pivot.rotation.z,
    (x.elbow || x.knee).rotation.x, (x.hand || x.foot).rotation.x);
  return v;
};
const run = (a, seconds, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) a.update(dt); };
const finite = (a) => joints(a).every(Number.isFinite);

/** How much a clip actually moves the body, over a window. */
function travel(a, seconds = 8, dt = 1 / 60) {
  a.play(a.anim, { force: true, loop: true });
  let lo = Infinity, hi = -Infinity, bad = 0;
  const first = joints(a).slice();
  for (let t = 0; t < seconds; t += dt) {
    a.update(dt);
    const j = joints(a);
    if (j.some((n) => !Number.isFinite(n))) bad++;
    j.forEach((n, i) => { lo = Math.min(lo, n - first[i]); hi = Math.max(hi, n - first[i]); });
  }
  return { bad, travel: hi - lo, lo, hi };
}

// ---- 1. the wardrobe can actually come off, and go back on ------------------
{
  const a = makeStripper({ sex: "f", seed: 3, height: 1.8, bust: 1.5 });
  a.update(0.001);
  const countOf = () => { let n = 0; a.traverse((o) => { if (o.isMesh && o.visible) n++; }); return n; };
  const dressed = countOf();
  const took = a.setGarment("all", false);
  a.update(0.001);
  const bare = countOf();
  check("a stripper has something to take off", took > 0, `${took} merged meshes hidden`);
  check("...and taking it off removes geometry rather than just recolouring it", bare < dressed,
    `${dressed} -> ${bare} visible meshes`);
  check("...and the body is still there underneath", bare > 0, `${bare} meshes left`);
  a.restoreWardrobe();
  check("...and it all goes back on", countOf() === dressed, `${countOf()} vs ${dressed}`);
}
{
  // A rig whose chest IS skin has no top to remove, and the whole cast shares
  // one skin material — so registering skin as clothing would hide the body
  // along with the clothes. What matters is not "did it change anything" but
  // "is the body still there afterwards", so that is what this checks.
  const bare = makeDancer({ sex: "f", seed: 3, topless: true });
  bare.update(0.001);
  let skinVisible = 0, skinTotal = 0;
  bare.traverse((o) => {
    if (!o.isMesh) return;
    skinTotal++;
    if (o.visible) skinVisible++;
  });
  bare.setGarment("all", false);
  let after = 0;
  bare.traverse((o) => { if (o.isMesh && o.visible) after++; });
  check("taking everything off a topless rig does not take the body with it",
    after > skinTotal * 0.6 && after > 0,
    `${after} of ${skinTotal} meshes still visible (the chest was never a garment; only her leggings came off)`);
}

// ---- 2. the four stage clips run, and actually pose -------------------------
for (const clip of STAGE_CLIPS) {
  const a = makeStripper({ sex: "f", seed: 3, height: 1.8, bust: 1.5 });
  a.play(clip, { force: true, loop: true });
  if (a.anim !== clip) { check(`${clip} plays on an adult with the gate answered`, false, `got "${a.anim}"`); continue; }
  const m = travel(a, 12);
  check(`${clip}: runs clean`, m.bad === 0 && finite(a), `${m.bad} bad frames in 12 s`);
  check(`${clip}: it is a pose and not a wobble`, m.travel > 0.4, `${m.travel.toFixed(2)} rad of travel`);
}

// stripTease has a shape the other three do not: the costume comes off partway
// through and is still off at the end of the number
{
  const a = makeStripper({ sex: "f", seed: 3, height: 1.8, bust: 1.5 });
  a.play("stripTease", { force: true, loop: true });
  const visible = () => { let n = 0; a.traverse((o) => { if (o.isMesh && o.visible) n++; }); return n; };
  const before = visible();
  run(a, 1.0);
  const early = visible();
  run(a, 12);
  const late = visible();
  check("stripTease: the costume is on at the top of the number", early === before, `${early} of ${before}`);
  check("...and off by the end of it", late < early, `${early} -> ${late} visible meshes`);
  a.restoreWardrobe();
  check("...and the routine puts it back", visible() === before);
}

// the bounce is still the bounce, now that the waist and neck are real joints
{
  const a = makeStripper({ sex: "f", seed: 3, height: 1.8 });
  a.play("twerk", { force: true, loop: true });
  let headMoved = 0, last = a.head.rotation.y;
  for (let i = 0; i < 240; i++) { a.update(1 / 60); if (a.head.rotation.y !== last) headMoved++; last = a.head.rotation.y; }
  check("twerk: the look over the shoulder is a real motion now", headMoved > 200, `${headMoved}/240 frames`);
}

// ---- 3. every couple clip runs, in both halves, for a long time ------------
{
  const clock = { t: 0 };
  let worstNaN = 0, tightest = Infinity, loosest = 0;
  for (const clip of COUPLE_CLIPS) {
    for (const [role, sex] of [["lead", "f"], ["partner", "m"]]) {
      const a = sex === "f" ? makeStripper({ sex: "f", seed: 5, height: 1.8, bust: 1.4 })
        : makeDancer({ sex: "m", seed: 5, height: 1.82 });
      a.coupleRole = role;
      a.beatRef = clock;
      a.play(clip, { force: true, loop: true });
      for (let i = 0; i < 1800; i++) {                      // 30 s
        clock.t += 1 / 60;
        a.update(1 / 60);
        if (!finite(a)) worstNaN++;
      }
    }
    // the two halves of a position must actually differ, or it is one person.
    // sixtyNine is the exception and legitimately so: it is two people folded
    // head to head, and its two halves are meant to be the same shape.
    if (clip === "sixtyNine") continue;
    const [l, p] = ["lead", "partner"].map((role) => {
      const a = makeStripper({ sex: "f", seed: 5, height: 1.8 });
      a.coupleRole = role; a.beatRef = clock;
      a.play(clip, { force: true, loop: true });
      a.update(1 / 60);
      return joints(a);
    });
    const diff = Math.max(...l.map((n, i) => Math.abs(n - p[i])));
    tightest = Math.min(tightest, diff);
    loosest = Math.max(loosest, diff);
  }
  check("every couple clip runs clean in both halves, 30 s each", worstNaN === 0, `${worstNaN} bad frames`);
  check("...and the two halves of a position are different bodies", tightest > 0.05,
    `closest pair differs by ${tightest.toFixed(3)} rad, furthest ${loosest.toFixed(2)} (sixtyNine is symmetric by design)`);
}

// ---- 4. the scene module places a pair, and takes them apart again ---------
{
  const scene = new THREE.Scene();
  const home = new THREE.Group();
  const lead = makeStripper({ sex: "f", seed: 9, height: 1.8, bust: 1.5 });
  const partner = makeDancer({ sex: "m", seed: 9, height: 1.82 });
  for (const a of [lead, partner]) { home.add(a); a.play("twerk", { force: true, loop: true }); a.update(0.001); }
  const wasParent = lead.parent, wasPos = lead.position.clone(), wasAnim = lead.anim;

  const act = createAct({ lead, partner, scene, name: "doggystyle", at: new THREE.Vector3(3, 0, -4), yaw: 1.2 });
  check("the scene group is placed at construction, before it is asked to run",
    act.group.position.equals(new THREE.Vector3(3, 0, -4)) && Math.abs(act.group.rotation.y - 1.2) < 1e-9);
  check("a scene is registered with the scene it was given", act.group.parent === scene);
  act.start();
  check("both rigs are told which half of the position they are",
    lead.coupleRole === "lead" && partner.coupleRole === "partner");
  check("both are on the same clock, so the two halves breathe together", lead.beatRef === partner.beatRef);
  check("both are playing the one name", lead.anim === "doggystyle" && partner.anim === "doggystyle");
  check("doggystyle stands them both up", Math.abs(lead.rotation.x) < 0.01 && Math.abs(partner.rotation.x) < 0.01);
  check("...and puts a gap between them", Math.abs(lead.position.z - partner.position.z) > 0.3,
    `${Math.abs(lead.position.z - partner.position.z).toFixed(2)} m`);

  // 30 s of the thing running
  for (let i = 0; i < 1800; i++) act.update(1 / 60);
  check("a scene runs 30 s with no NaN in either body", finite(lead) && finite(partner));

  act.stop();
  check("stop() puts the rig back where it found it",
    lead.parent === wasParent && lead.position.equals(wasPos) && lead.anim === wasAnim,
    `parent ${lead.parent === wasParent}, anim "${lead.anim}"`);
  check("...and takes the shared clock back off both", lead.beatRef === null && partner.beatRef === null);
}
{
  // the laid-down positions really are laid down
  const scene = new THREE.Scene();
  const lead = makeStripper({ sex: "f", seed: 9, height: 1.8 });
  const partner = makeDancer({ sex: "m", seed: 9, height: 1.82 });  const act = createAct({ lead, partner, scene, name: "missionary" });
  act.start();
  check("missionary lays them down", Math.abs(lead.rotation.x) > 1.4 && Math.abs(partner.rotation.x) > 1.4,
    `roots rolled to ${lead.rotation.x.toFixed(2)} rad`);
  act.update(1 / 60);
  check("...and they STAY down, which is what the root reset used to undo", Math.abs(lead.rotation.x) > 1.4,
    `after one frame: ${lead.rotation.x.toFixed(2)} rad`);
  act.stop();
  check("...and getting up again is somebody else's problem", lead.rotation.x < 0.05 && lead.lie === false);
}

// ---- 5. the scene refuses to cast a pair it should not --------------------
{
  const scene = new THREE.Scene();
  const minor = makeStripper({ sex: "f", seed: 9, age: 17 });
  const adult = makeDancer({ sex: "m", seed: 9, age: 25 });
  const act = createAct({ lead: minor, partner: adult, scene, name: "missionary" });
  let threw = false;
  try { act.start(); } catch { threw = true; }
  check("a scene will not cast a minor", threw, "start() throws rather than half-running");

  const minor2 = makeStripper({ sex: "f", seed: 9, age: 25 });
  const adult2 = makeDancer({ sex: "m", seed: 9, age: 25 });
  setAdultGate(() => false);
  const act2 = createAct({ lead: minor2, partner: adult2, scene, name: "missionary" });
  let threw2 = false;
  try { act2.start(); } catch { threw2 = true; }
  check("...nor cast anyone before the 18+ gate is answered", threw2);
  setAdultGate(() => true);

  let threwName = false;
  try { createAct({ lead: adult2, partner: minor, scene, name: "thereIsNoSuchScene" }); } catch { threwName = true; }
  check("...nor invent a position that does not exist", threwName);
  check("every name in ADULT_CLIPS that is a scene has a layout for it",
    COUPLE_CLIPS.every((c) => SCENES[c] && STAGE_ACT[c] === undefined), "and is not also a stage act");
}

// ---- 6. the stage act is bounded, and undoes itself ------------------------
{
  const a = makeStripper({ sex: "f", seed: 3, height: 1.8, bust: 1.5 });
  a.update(0.001);
  const visible = () => { let n = 0; a.traverse((o) => { if (o.isMesh && o.visible) n++; }); return n; };
  const before = visible(), wasAnim = a.anim;
  const handle = beginStageAct(a, "stripTease");
  check("beginStageAct starts a bounded number", handle && handle.seconds > 0, `${handle && handle.seconds}s`);
  check("...which is longer than a routine step, so it is not cut in half", handle.seconds > 3.4,
    `${handle.seconds}s against a ${3.4}s routine`);
  run(a, handle.seconds + 1);
  check("...and it leaves something off while it runs", visible() < before, `${visible()} of ${before}`);
  handle.end();
  check("ending a number puts the costume back and the dance back", visible() === before && a.anim === wasAnim,
    `"${a.anim}"`);
  setAdultGate(() => false);
  check("beginStageAct declines outright when the gate is unanswered", beginStageAct(a, "stripTease") === null);
  setAdultGate(() => true);
}

// ---- 7. the stage routines actually reach these clips ----------------------
{
  const src = readFileSync(new URL("../../src/franchiseClubs.js", import.meta.url), "utf8");
  check("the branch routines schedule the explicit half of the house",
    STAGE_CLIPS.some((c) => src.includes(`"${c}"`)), "at least one appears in a routine");
  check("...and every stage act is reachable from a schedule",
    STAGE_CLIPS.every((c) => src.includes(`"${c}"`)),
    STAGE_CLIPS.join(", "));
  check("a number is ended per performer, not per room", /function endStageAct\(p\)/.test(src));
  check("...and put the costume back when it ends", /p\.act\.end\(\); p\.act = null/.test(src));
}

console.log(failures ? `\n${failures} act check(s) FAILED` : "\nAll act checks passed");
process.exit(failures ? 1 : 0);
