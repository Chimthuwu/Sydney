// input_binding_test.mjs — the controls match what the player was told.
//
//   node --experimental-detect-module tools/qa/input_binding_test.mjs
//
// Human instruction 2026-10-02: "E should be interact, we dont need no camera
// orbit... make the numpad do that shit. F is for Flashlight and for stealing
// cars".
//
// This is a regression test for a decision with a specific history. E was
// originally `interact`, and was BANNED from the game entirely because it was
// also `orbitRightMod` — press it to get in a car and the camera nudged too. F
// took over. That ban is why the on-screen prompts all came to read "F ·", and
// why a whole agent's worth of work went into changing "E ·" to "F ·".
//
// So this pins the CAUSE, not just the outcome: if the camera ever goes back on
// a gameplay key, the collision comes back with it, and interact silently
// becomes a two-action key again. Asserting "interact is KeyE" alone would not
// catch that; asserting "no key is bound to two actions" would.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const input = readFileSync(join(here, "../../src/input.js"), "utf8");
const main = readFileSync(join(here, "../../src/main.js"), "utf8");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

// Parse the real table rather than restating it.
const body = input.slice(input.indexOf("DEFAULT_BINDINGS"), input.indexOf("const CTRL_CHORDS"));
const bindings = {};
for (const m of body.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
  bindings[m[1]] = [...m[2].matchAll(/"(\w+)"/g)].map((k) => k[1]);
}
check(Object.keys(bindings).length > 20, `parsed ${Object.keys(bindings).length} actions from the real table`);

console.log("\n=== 1. the two headline bindings ===");
check(bindings.interact?.includes("KeyE"), "E is interact — every door, machine, venue and station");
check(!bindings.interact?.includes("KeyF"), "interact is NOT also F (one key, one meaning)");
check(bindings.driveOrTorch?.includes("KeyF"), "F is the driver's key: get in a car, jack a cruiser, else the torch");
check(!bindings.driveOrTorch?.includes("KeyE"), "F does not also trigger interact");
check(Array.isArray(bindings.flashlight) && bindings.flashlight.length === 0,
  "the torch has no key of its own — it is F's fallthrough, so it cannot drift onto a second key");

console.log("\n=== 2. the camera is off the gameplay keys ===");
// The whole reason E was banned. If the camera is on E, Z, X, F or T again, the
// collision that started this is back.
for (const k of ["KeyE", "KeyF", "KeyT", "KeyQ", "KeyW", "KeyA", "KeyS", "KeyD"]) {
  const orbit = ["orbitLeft", "orbitRight", "orbitLeftMod", "orbitRightMod"]
    .filter((a) => bindings[a]?.includes(k));
  check(orbit.length === 0, `${k} is not a camera-orbit key${orbit.length ? ` (it is ${orbit.join(", ")})` : ""}`);
}
check(bindings.orbitLeft?.includes("Numpad4") && bindings.orbitRight?.includes("Numpad6"),
  "the numpad orbits — Numpad4 / Numpad6, as asked");
check(bindings.orbitLeft?.includes("ArrowLeft") && bindings.orbitRight?.includes("ArrowRight"),
  "the arrow keys still orbit as a second option");

console.log("\n=== 3. E collides with nothing at all ===");
// Stronger than "not an orbit key": E must be a single-action key, so it cannot
// acquire a second meaning later.
const owner = (code) => Object.entries(bindings).filter(([, ks]) => ks.includes(code)).map(([a]) => a);
check(owner("KeyE").length === 1 && owner("KeyE")[0] === "interact",
  `E belongs to interact alone (found: ${owner("KeyE").join(", ") || "nothing"})`);
check(owner("KeyF").length === 1 && owner("KeyF")[0] === "driveOrTorch",
  `F belongs to driveOrTorch alone (found: ${owner("KeyF").join(", ") || "nothing"})`);

console.log("\n=== 4. main.js honours the split ===");
check(/input\.onPress\("interact"/.test(main), "main.js handles interact");
check(/input\.onPress\("driveOrTorch"/.test(main), "main.js handles driveOrTorch");
const iHandler = main.match(/input\.onPress\("interact"[\s\S]*?\n\}\);/);
check(!!iHandler && !/enterExitVehicle/.test(iHandler[0]),
  "interact does NOT also enter a vehicle — that is F's job now");
const fHandler = main.match(/input\.onPress\("driveOrTorch"[\s\S]*?\n\}\);/);
check(!!fHandler && /enterExitVehicle/.test(fHandler[0]), "driveOrTorch does enter a vehicle");
check(!!fHandler && /toggleFlashlight/.test(fHandler[0]), "and falls through to the torch");
check(!!fHandler && !/nightlife\.interact/.test(fHandler[0]),
  "and does NOT reach for venues — pressing F at a club door must not open it");

console.log("\n=== 5. E is in the ctrl-chord set ===");
// CTRL_CHORDS is preventDefault'd so the browser does not act on the key behind
// the game's back. Ctrl+E is the browser's own shortcut, so it must be listed.
check(/const CTRL_CHORDS = new Set\(\[[^\]]*"KeyE"/.test(input),
  "Ctrl+E is swallowed by the game rather than hitting the browser");

console.log(`\n${fails ? fails + " FAILURES" : "the controls are what you were told"}`);
process.exit(fails ? 1 : 0);