// The 18+ gate, enforced on the rig rather than trusted to the venues.
//
// Background, because the fix is only interesting if you know what it fixed.
// `franchiseClubs.js` used to stamp `userData.age = Math.max(25, userData.age
// || 25)` on every performer, and `debug` reported `allAdults` by testing
// `userData.age >= 18`. Nothing anywhere READ `opts.age`, so the left-hand side
// was always 25 for every actor that had not been stamped already, and the check
// was evaluating 25 >= 18 — true for any character at all, or none. It was a
// rubber stamp, and it was the only thing standing between this game and an
// adult clip playing on whoever happened to be nearest a pole.
//
// So: the age is a fact about the model now, the adult clips are a named set,
// and `play()` refuses them unless the rig is past the floor AND the 18+ gate
// has been answered. This test is the proof that all three hold.
import { readFileSync } from "node:fs";

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

const chars = await import("../../src/characters.js");
const { makeStripper, makeHoodrat, ADULT_CLIPS, ADULT_CLIP_MIN_AGE, setAdultGate, adultGateInstalled } = chars;

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
};

// ---- 1. the age is a fact about the model, not a claim made about it --------
{
  const plain = makeStripper({ sex: "f", seed: 1, age: 25 });
  const minor = makeStripper({ sex: "f", seed: 1, age: 17 });
  const unspecified = makeStripper({ sex: "f", seed: 1 });
  check("the rig keeps the age it was cast with", plain.userData.age === 25 && minor.userData.age === 17,
    `25 -> ${plain.userData.age}, 17 -> ${minor.userData.age}`);
  check("...and defaults the unspecified cast to an adult, not to nothing",
    unspecified.userData.age === 25, `${unspecified.userData.age}`);
  check("the floor is the one we think it is", ADULT_CLIP_MIN_AGE === 18);
}

// ---- 2. the gate fails CLOSED ----------------------------------------------
// An unwired gate is not an open gate. This is the state the game is in for the
// few milliseconds between module load and adultContent.js constructing, and it
// is the state every QA sandbox is in by default.
{
  setAdultGate(null);
  const a = makeStripper({ sex: "f", seed: 1, age: 25 });
  check("with no gate installed at all, an adult clip is refused", !adultGateInstalled() && !a.allowsAdultClip());
  a.play("stripTease", { force: true });
  check("...and the refusal holds through play(), not just the predicate", a.anim !== "stripTease",
    `she is on "${a.anim}"`);
}

// ---- 3. refused for each of the right reasons ------------------------------
{
  setAdultGate(() => true);
  const adult = makeStripper({ sex: "f", seed: 1, age: 25 });
  const minor = makeStripper({ sex: "f", seed: 1, age: 17 });
  const lying = makeStripper({ sex: "f", seed: 1 });
  lying.userData.age = undefined;                    // age lost in transit
  const notNumeric = makeStripper({ sex: "f", seed: 1 });
  notNumeric.userData.age = "25";                    // a string is not an age

  check("an adult, with the gate answered, may play an adult clip", adult.allowsAdultClip());
  check("a minor may not", !minor.allowsAdultClip(), "cast at 17");
  check("an actor whose age is missing may not", !lying.allowsAdultClip());
  check("...nor one whose age is a string", !notNumeric.allowsAdultClip(), 'age === "25"');

  for (const [who, actor] of [["a minor", minor], ["an unknown age", lying], ["a stringy age", notNumeric]]) {
    actor.play("twerk", { force: true });
    actor.play("missionary", { force: true });
    check(`${who} cannot be put on an adult clip by play()`, actor.anim === "twerk" && actor.adultClipRefused === "missionary",
      `anim "${actor.anim}", refused "${actor.adultClipRefused}"`);
  }
}

// ---- 4. refused before the 18+ gate is answered, on an adult ----------------
{
  setAdultGate(() => false);
  const a = makeStripper({ sex: "f", seed: 1, age: 25 });
  check("a 25-year-old is refused while the gate is unanswered", !a.allowsAdultClip());
  a.play("dance", { force: true });
  a.play("sixtyNine", { force: true });
  check("...and stays on what she was doing", a.anim === "dance", `anim "${a.anim}"`);
  setAdultGate(() => true);
  a.play("sixtyNine", { force: true });
  check("answering the gate releases it, with no rebuild", a.anim === "sixtyNine");
  setAdultGate(() => false);
  a.play("assToMouth", { force: true });
  check("...and taking it away again works too", a.anim === "sixtyNine");
  setAdultGate(null);
}

// ---- 5. ordinary clips are never gated -------------------------------------
{
  setAdultGate(() => true);
  const minor = makeStripper({ sex: "f", seed: 1, age: 17 });
  for (const clip of ["walk", "run", "idle", "twerk", "grind", "sync", "cheer", "pole"]) {
    minor.play(clip, { force: true });
    if (minor.anim !== clip) { check(`an ordinary clip (${clip}) plays on anyone`, false, `got "${minor.anim}"`); break; }
  }
  check("every ordinary clip plays on a minor — only the adult set is gated", true,
    "walk, run, idle, twerk, grind, sync, cheer, pole");
  setAdultGate(null);
}

// ---- 6. the whole named set is actually refused -----------------------------
{
  setAdultGate(() => true);
  const minor = makeStripper({ sex: "f", seed: 1, age: 17 });
  const leaked = [...ADULT_CLIPS].filter((c) => { minor.play("idle", { force: true }); minor.play(c, { force: true }); return minor.anim === c; });
  check("no name in ADULT_CLIPS escapes the guard", leaked.length === 0,
    leaked.length ? `leaked: ${leaked.join(", ")}` : `${ADULT_CLIPS.size} clips, all refused`);
  check("...and the set is not empty — a guard over nothing guards nothing", ADULT_CLIPS.size >= 8,
    `${ADULT_CLIPS.size} adult clips`);
  setAdultGate(null);
}

// ---- 7. the franchise stage no longer stamps its own age --------------------
{
  // The old line was `userData.age = Math.max(25, userData.age || 25)`, which
  // assigned 25 to anything. It has to be a check now, not an assignment, and a
  // cast with no age has to be a loud failure rather than a quiet pass.
  const src = readFileSync(new URL("../../src/franchiseClubs.js", import.meta.url), "utf8");
  // strip comments first: the old expression is quoted verbatim in the note
  // explaining why it went, and prose about a bug is not the bug
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check("the self-certifying stamp is gone", !/Math\.max\(\s*25\s*,/.test(code));
  check("...and nothing assigns an age to a performer any more", !/userData\.age\s*=/.test(code));
  check("...replaced by a check that throws", /function assertAdult/.test(code) && /throw new Error/.test(code));
  // and prove it throws. `fake` deliberately DROPS the age the module passes it,
  // which is the exact case the old line papered over: a factory that does not
  // carry the option through, so the performer arrives with no age at all.
  const THREE = await import("three");
  const scene = new THREE.Scene();
  const { createFranchiseClubs } = await import("../../src/franchiseClubs.js");
  const fake = () => {
    const g = new THREE.Group();
    g.userData = { age: undefined, stageName: "Nobody" };
    g.play = () => {}; g.update = () => {}; g.torso = { rotation: { x: 0, y: 0, z: 0 } };
    g._last = { copy() {} };
    return g;
  };
  const clubs = createFranchiseClubs({
    scene, state: { running: true, veh: null, cash: 100 },
    document: { body: { appendChild() {} }, createElement: () => ({ style: {}, hidden: false, textContent: "" }) },
    flashObjective: () => {}, syncHUD: () => {},
    makeAdultHog: (o) => fake(o), makeAdultDancer: (o) => fake(o), makePatron: () => fake({ age: 25 }),
  });
  let threw = false;
  try {
    clubs.register({ kind: "hogs", x: 0, z: 0, rot: 0 });
  } catch { threw = true; }
  check("casting a performer with no age throws instead of quietly passing", threw,
    "the check the old tautology could never fail");

  // ...and a cast that DOES carry its age goes through, so the check is not just
  // a wall: a stage with properly-aged performers still registers.
  const aged = (opts) => { const g = fake(); g.userData.age = opts.age; return g; };
  const clubs2 = createFranchiseClubs({
    scene: new THREE.Scene(), state: { running: true, veh: null, cash: 100 },
    document: { body: { appendChild() {} }, createElement: () => ({ style: {}, hidden: false, textContent: "" }) },
    flashObjective: () => {}, syncHUD: () => {},
    makeAdultHog: (o) => aged(o), makeAdultDancer: (o) => aged(o), makePatron: () => aged({ age: 25 }),
  });
  let ok = false;
  try { ok = !!clubs2.register({ kind: "hogs", x: 0, z: 0, rot: 0 }); } catch { ok = false; }
  check("...and a properly-aged cast still goes on", ok);
}

console.log(failures ? `\n${failures} adult-clip-gate check(s) FAILED` : "\nAll adult-clip-gate checks passed");
process.exit(failures ? 1 : 0);
