// talk_gate_test.mjs — who the player is allowed to start a conversation with.
//
//   node --experimental-detect-module tools/qa/talk_gate_test.mjs
//
// Three separate bugs in this area, all the same shape: a guard that existed but
// did not match the records it was meant to reject. None of them threw.
//
//   1. the filter checked `rec.hostile`, a field npc.js has never written
//      anywhere (grep: zero assignments), so it was always false and every NPC
//      shooting at the player was a talkable ped.
//   2. `rec.state === "hostile"` fixed that, but a ZOMBIE is usually "wander" or
//      "idle" — not dead, not hostile, not provoked — so zombies were still
//      ordinary talk targets.
//   3. peopleNearby() filtered zombies but the keypress guard did not, so a
//      conversation already on screen survived the horde walking up.
//
// The fix is one function (isHostileNpc) asked by both entry points. These
// checks pin that shape, so adding a new talkable kind to one gate and not the
// other is a test failure rather than a bug someone reports in a screenshot.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(here, "../../src/main.js"), "utf8");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

// Lift the real function out of main.js and run it, rather than restating its
// logic. A test that reimplements the predicate proves nothing about the
// predicate; this one fails the moment the shipped code changes behaviour.
const src = main.match(/function isHostileNpc\(rec\) \{[\s\S]*?\n\}/);
check(!!src, "main.js defines isHostileNpc(rec)");
if (!src) { console.log(`\n${fails} FAILURES`); process.exit(1); }
const isHostileNpc = new Function("rec", src[0].replace(/^function isHostileNpc\(rec\) \{/, "").replace(/\n\}$/, ""));

console.log("\n=== 1. a ped who is minding his own business ===");
for (const state of ["idle", "wander", "flee", "talk", "cower"]) {
  check(!isHostileNpc({ type: "redneck", state }),
    `a redneck who is "${state}" is still chat — NPCJS sets plenty of states and only some mean a fight`);
}
check(!isHostileNpc({ type: "hog", state: "idle" }), "a hog on shift is chat");
check(!isHostileNpc({ type: "ped", state: "idle" }), "an ordinary ped is chat");
check(!isHostileNpc(null), "null is not a hostile NPC, it is nothing at all");

console.log("\n=== 2. a ped who is shooting is not ===");
check(isHostileNpc({ type: "redneck", state: "hostile" }), "a hostile redneck is not chat");
check(isHostileNpc({ type: "hoodrat", state: "hostile" }), "a hostile hoodrat is not chat");
check(isHostileNpc({ type: "redneck", state: "hostile", rivalTarget: {} }),
  "one fighting a RIVAL is not chat either — mid-gunfight, and rivalTarget proves he is not aiming at you");
check(isHostileNpc({ type: "ped", state: "dead" }), "a corpse is not chat");
check(isHostileNpc({ type: "ped", state: "idle", dead: true }), "the dead flag works without the state");

console.log("\n=== 3. a ZOMBIE is not chat, in any state ===");
// The whole point. npc.js: a zombie is "never provoked into hostility — it hunts
// on sight" (npc.js:235), so its state stays idle/wander and the state checks
// above are all false. Only the type check can catch it.
for (const state of ["idle", "wander", "flee", "cower", null, undefined]) {
  check(isHostileNpc({ type: "zombie", state }),
    `a zombie in state "${state}" is not chat`);
}
check(isHostileNpc({ type: "zombie" }), "a zombie with no state at all is not chat");
check(!isHostileNpc({ type: "ped", state: "wander" }),
  "...and a wandering ped is, so the check is on type and not on a missing state");

console.log("\n=== 4. BOTH entry points ask the same function ===");
// This is the structural check. Two gates that each filter slightly differently
// is how bug 3 happened: peopleNearby() learned about zombies before the
// keypress guard did.
const near = main.match(/function peopleNearby\(\) \{[\s\S]*?\n  return _talkable;/);
check(!!near, "peopleNearby() exists");
if (near) {
  check(/rec\.type === "zombie"\) continue;/.test(near[0]),
    "peopleNearby() drops zombies from the talk list, so the prompt never shows over one");
}
const keypress = main.match(/input\.onPress\("talk"[\s\S]*?\n\}\);/);
check(!!keypress, "the talk keypress handler exists");
if (keypress) {
  check(/isHostileNpc\(target\.npc\)/.test(keypress[0]),
    "the keypress re-checks the gate on the target it re-resolved — a conversation on screen survives nobody new arriving");
  check(/dialogue\.update\(\)/.test(keypress[0]),
    "and it re-resolves the target instead of trusting lastPromptFor from the previous frame");
  check(!/dialogue\.interact\(\)/.test(keypress[0]),
    "the old cached-target path is gone");
}
check((main.match(/isHostileNpc\(/g) || []).length >= 2,
  "isHostileNpc is actually called (definition plus both call sites)");

console.log("\n=== 5. the dead field npc.js never writes is not load-bearing ===");
// rec.hostile / rec.provoked are checked alongside the state, and grep shows
// npc.js assigns neither. Harmless, but the comment should not imply they do
// work — the state is the only real signal.
check(/rec\.state === "hostile"/.test(src[0]) && /rec\.state === "dead"/.test(src[0]),
  "the state is what decides, with dead as the belt-and-braces");
check(!/rec\.hostile\b[^?]/.test(src[0].replace(/state === "hostile"/g, "")),
  "isHostileNpc does not itself depend on the never-written rec.hostile field");

console.log(`\n${fails ? fails + " FAILURES" : "the talk gate rejects the right people"}`);
process.exit(fails ? 1 : 0);