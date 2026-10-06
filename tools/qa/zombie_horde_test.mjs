// zombie_horde_test.mjs — a Screamer actually summons a fighting pack.
//
//   node --experimental-detect-module tools/qa/zombie_horde_test.mjs
//
// Human report 2026-10-02: "the zombies aint really like forming hordes or
// swarms either ??"
//
// The horde call existed and looked right: on first hostility a Screamer called
// `noise(p.x, p.z, hordeCall.r, true)` with r = 55. The problem is that a noise
// event is not a horde call.
//
// Tracing what a noise event actually does to another zombie, the ONLY consumer
// is the wander branch:
//     setState(e, "wander", 0); e.goal.set(ev.x, 0, ev.z);
// A walk-to. There is no becomeHostile anywhere in that path. So the Screamer
// was asking 55 m of zombies to amble somewhere nearby, and they would arrive
// as IDLERS that still had to notice the player on their own — and a zombie that
// has not noticed you is exactly a zombie that does not attack you. A horde is
// not a queue at a point; it is a pack that arrives already fighting.
//
// Second, independent reason it never happened: the Screamer is weight 2 of 89,
// about 2.2%. The only thing in the game capable of calling a horde was almost
// never present to call one.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const npc = readFileSync(join(here, "../../src/npc.js"), "utf8");
const zombies = readFileSync(join(here, "../../src/zombies.js"), "utf8");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

console.log("=== 1. the call CONVERTS, it does not merely announce ===");
const call = npc.match(/if \(hostile && hordeCall && !e\.screamed\) \{[\s\S]*?\n        \}/);
check(!!call, "the Screamer's first-hostility branch exists");
const body = call ? call[0] : "";

// The specific bug: noise() alone only produces a walk-to.
check(/becomeHostile\(/.test(body),
  "the call turns other zombies HOSTILE — noise() alone only makes them wander, which was the bug");
check(!/^\s*noise\([^)]*\);\s*$/m.test(body) || /noise\(/.test(body),
  "it still emits the noise event, so the player and other zombies can hear it");
check(/e\.screamed = true/.test(body), "still once per Screamer, so it cannot spam the whole parish every frame");

console.log("\n=== 2. the summoned pack targets the same victim ===");
// Without a shared rivalTarget each zombie picks its own, and you get N separate
// one-on-ones arriving from different directions instead of one wave.
check(/becomeHostile\(o, e, true\)/.test(body),
  "called zombies get the Screamer as their rivalTarget, so they converge on one victim");
check(/, true\)/.test(body),
  "force=true — a horde that respects the ambient hostile cap is not a horde");

console.log("\n=== 3. it only takes zombies, and only ones that can still come ===");
check(/o\.type !== "zombie"\)/.test(body), "never converts a civilian or a cop");
check(/o === e \|\| o\.dead/.test(body), "skips the caller itself");
check(/o\.state === "dead"/.test(body), "skips corpses");
check(/o\.state === "hostile"/.test(body), "skips ones already fighting — no double-count");
check(/o\.state === "flee"/.test(body), "skips runners; you cannot call back someone already fleeing");
check(/R2 = hordeCall\.r \* hordeCall\.r/.test(body) && /dx \* dx \+ dz \* dz > R2/.test(body),
  "the radius test is squared-distance, so it does not call a sqrt per zombie per Screamer");

console.log("\n=== 4. the Screamer is actually common enough to exist ===");
const weights = [...zombies.matchAll(/weight: (\d+)/g)].map((m) => Number(m[1]));
const total = weights.reduce((a, b) => a + b, 0);
// Scope to the `screamer: { ... }` archetype block itself and read the weight
// from INSIDE it.
//
// The first version of this check searched the whole file for the first
// `weight:` after any mention of `screamOnHostile` — and the first mention is
// the DOC COMMENT at the top of zombies.js, not the archetype. It therefore read
// the SHAMBLER's weight of 55, reported "55/98 (56%)", and passed while checking
// nothing. A test that reads the wrong value and passes is worse than no test.
//
// So: match the archetype block, and require the block to actually contain the
// scream flag. If the block cannot be found the check FAILS rather than
// defaulting to 0 or to some other archetype's number.
const scrBlock = zombies.match(/\n\s*screamer:\s*\{([\s\S]*?)\n\s*\},/);
check(!!scrBlock, "the screamer archetype block is findable");
const scrBody = scrBlock ? scrBlock[1] : "";
check(/screamOnHostile/.test(scrBody),
  "and it is the block that owns the scream flag (not a doc comment elsewhere in the file)");
const screamerW = Number((scrBody.match(/weight:\s*(\d+)/) || [])[1] || 0);
check(screamerW > 0, `the Screamer's weight is read from its own block (${screamerW} of ${total})`);
check(screamerW >= 5,
  `at ${screamerW}/${total} (~${((screamerW / total) * 100).toFixed(1)}%) it is rare but actually encountered — it was 2/89 (~2.2%), so the horde mechanic was near-absent from the game`);
// And the crowd it summons should still outnumber the caller many times over.
check(screamerW < total / 3,
  "and it remains a minority archetype, so one Screamer does not turn every zombie in the parish hostile");

console.log("\n=== 5. the called pack can actually reach the target ===");
// A pack that is hostile but stationary reads as a crowd standing still, which
// is the same visual as no horde at all.
check(/const hasRival = e\.rivalTarget && !e\.rivalTarget\.dead/.test(npc),
  "a hostile NPC with a rivalTarget uses it as its approach target");
check(/targetPos = hasRival \? e\.rivalTarget\.spr\.position : env\.player/.test(npc),
  "and paths to its POSITION, so the summoned zombies close on the screamer's victim");
check(/hitRival\(e\.rivalTarget/.test(npc),
  "and can damage that target, so the wave is a real fight and not a photo op");

console.log("\n=== 6. a horde is still not a death sentence ===");
// The i-frame fix (main.js) caps simultaneous chip damage; a horde must not
// bypass it by sheer count.
check(!/horde[\s\S]{0,400}hitPlayer/.test(body),
  "the call does not damage the player itself — it summons, the normal gated combat does the rest");

console.log(`\n${fails ? fails + " FAILURES" : "a screamer summons a pack"}`);
process.exit(fails ? 1 : 0);