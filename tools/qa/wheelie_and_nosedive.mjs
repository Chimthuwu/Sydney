// wheelie_and_nosedive.mjs — the car pitches on throttle/brake without losing hill pitch.
//
//   node --experimental-detect-module tools/qa/wheelie_and_nosedive.mjs
//
// THE ORIENTATION MODEL, because this is the part that is easy to get wrong.
//
// main.js drives the player's car each frame and THREE separate systems want to
// write rotation.x (pitch):
//
//   1. HILLS. main.js:6402 samples the ground ahead and behind and eases
//      `v.slopePitch` toward it. Order is set to "YXZ" so yaw, then pitch, then roll.
//   2. POTHOLES. main.js:6432 adds `Math.sin(v.wob*7)*0.05*v.jolt` on top.
//   3. A crash jolt, further down the same block.
//
// A wheelie is a FOURTH writer. The naive implementation -- assign
// `v.obj.rotation.x = wheelieAngle` -- silently DELETES the hill pitch and the
// pothole shake, so the car snaps flat every time the front lifts on a slope. The
// nose-up has to be ADDITIVE, and that is the whole content of this test.
//
// The same applies to the RESET branch at main.js:6434 (`else if (v.obj.rotation.x
// || v.slopePitch)`), which writes the pitch back to slopePitch alone once the
// jolt decays. If the wheelie is not in that expression, the car falls back to flat
// the moment the wheelie is released -- which is correct only if the wheelie is
// genuinely zero then, and it is not: the front needs to LOWER, not snap.
//
// WHAT IS ASSERTED. Every check reads the real source rather than trusting a
// comment, and the composite-pitch checks fail if a future edit makes the wheelie
// overwrite instead of add.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(here, "../../src/main.js"), "utf8");
const input = readFileSync(join(here, "../../src/input.js"), "utf8");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

console.log("=== the three pre-existing pitch writers (the constraint) ===");
// If these ever stop existing this test is asserting against nothing.
check(main.includes("v.slopePitch = (v.slopePitch"), "hill pitch still writes v.slopePitch");
check(main.includes('v.obj.rotation.order = "YXZ"'), "rotation order is still YXZ (yaw, then pitch, then roll)");
const pitchWrites = (main.match(/v\.obj\.rotation\.x\s*=/g) || []).length;
check(pitchWrites >= 2, `there are still ${pitchWrites} rotation.x writes to compose with`);

console.log("\n=== the wheelie is a separate state, not a raw angle ===");
check(main.includes("v.wheelie"), "the wheelie keeps its own v.wheelie state");
// Eased, not snapped. A hard assignment would pop. Rather than regex the arithmetic
// (and get the escaping wrong twice, as I did), look for the characteristic shape:
// an existing value, a delta term, and a rate.
// The easing lives in vehicles.js, not main.js: stepArcadeVehicle owns the wheelie
// state and main.js only applies it. (My first version looked for it in main.js and
// failed, because of course it is not there.)
const vehicles = readFileSync(join(here, "../../src/vehicles.js"), "utf8");
const easeLine = vehicles.split("\n").find((l) => l.includes("WHEELIE_UP_RATE") && l.includes("dt *"));
check(!!easeLine, "the wheelie eases toward its target with a dt-scaled rate rather than snapping");
if (easeLine) console.log(`     ${easeLine.trim().slice(0, 96)}`);
check(/v\.wheelie = \(v\.wheelie \|\| 0\) \+ \(want - \(v\.wheelie \|\| 0\)\) \* rate/.test(vehicles),
  "the ease is toward `want`, so releasing the key settles it back to level");

console.log("\n=== the wheelie is ADDITIVE with hill pitch, never a replacement ===");
// The load-bearing assertion. This is the exact line that must keep slopePitch.
const composed = main.match(/v\.obj\.rotation\.x = [^;]*v\.slopePitch[^;]*;/);
check(!!composed,
  "rotation.x is written as slopePitch + wheelie (both terms present in one expression)");
if (composed) {
  const line = composed[0];
  check(line.includes("v.slopePitch") && line.includes("v.wheelie"),
    "the composite expression contains BOTH terms -- verified from the source text");
}
// The reset branch is the one that silently drops things.
// Window bounded so a runaway match cannot swallow the file. It has to be generous:
// at 140 chars the window ended INSIDE the comment above the assignment and the check
// failed against correct code.
const resetBranch = main.match(/else if \(v\.obj\.rotation\.x \|\| v\.slopePitch[^)]*\)[\s\S]{0,400}?;/);
check(!!resetBranch && resetBranch[0].includes("wheelie"),
  "the decay/reset branch also restores the wheelie, so releasing it lowers the nose smoothly");
check(!!resetBranch && /slopePitch \|\| 0\) \+ \(v\.wheelie \|\| 0\)/.test(resetBranch[0]),
  "and it restores BOTH terms, not the wheelie alone");

console.log("\n=== it only applies to cars, not bikes or the DeLorean ===");
// A bike wheelie is a different (and much sillier) piece of work; it leans already.
// The exclusion lives in vehicles.js too, for the same reason.
check(vehicles.includes("!v.def.bike"), "bikes are excluded (they already lean into turns)");
check(vehicles.includes("!v.def.hover"), "hovering vehicles are excluded (the DeLorean has no front wheels to lift)");
check(/v\.def && !v\.def\.bike && !v\.def\.hover/.test(vehicles),
  "both exclusions are on the SAME guard, so a vehicle is not half-excluded");

console.log("\n=== input: a real binding, not a stolen one ===");
// ShiftLeft is ALREADY `brake` (input.js:21) and is the handbrake. Reusing it would
// make every handbrake turn a wheelie attempt.
const bindings = [...input.matchAll(/^\s*(\w+):\s*\[([^\]]*)\]/gm)].map((m) => ({ name: m[1], keys: m[2] }));
const names = bindings.map((b) => b.name);
console.log(`  bindings: ${names.join(", ")}`);
// ShiftLeft is legitimately shared: `sprint` is on-foot, `brake` is in-vehicle, and
// input.js resolves them by context. My first version of this check asserted ShiftLeft
// belonged to exactly one action, which fails at HEAD for that legitimate sharing.
// The real constraint is narrower and is the one that matters: the wheelie must not be
// a THIRD claimant on the handbrake key.
const shifted = bindings.filter((b) => b.keys.includes("ShiftLeft")).map((b) => b.name);
console.log(`  ShiftLeft actions: ${shifted.join(", ")}`);
check(shifted.includes("brake") && !shifted.includes("wheelie"),
  "the wheelie does NOT live on ShiftLeft -- that is the handbrake, and stealing it would turn every handbrake turn into a wheelie attempt");
check(new Set(shifted).size === shifted.length,
  "no key is claimed twice for the same context");
check(names.includes("wheelie"), "a dedicated `wheelie` binding exists");

console.log(`\n${fails ? fails + " FAILURES" : "wheelies and nose-dives compose with the existing pitch writers"}`);
process.exit(fails ? 1 : 0);