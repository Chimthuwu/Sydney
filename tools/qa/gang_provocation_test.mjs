// gang_provocation_test.mjs — gangs are civilians until provoked, except by reputation.
//
//   node --experimental-detect-module tools/qa/gang_provocation_test.mjs
//
// Human report 2026-10-02: "YEAH NAH HOODRATS N REDNECKS STILL ATTACK WITHOUT
// BEING PROVOKED".
//
// This was a REGRESSION against a fix that had already shipped and been
// announced as done. The earlier change made the FIGHTERS branch respect
// faction standing, so a neutral gang is a civilian until hit — and its own
// comment at npc.js:411 claimed "Hoodrats and rednecks no longer do: they are
// civilians until provoked."
//
// The comment was true of one branch and false of the game. hoodrat and redneck
// were members of TWO sets:
//
//   FIGHTERS   — gated on faction standing, correct
//   AMBUSHERS  — unconditional on-sight attack, NO standing check
//
// An earlier edit fixed the first list and never touched the second, so every
// hoodrat and redneck still turned on the player on sight. The code contradicted
// its own comment three lines above the branch that was doing the damage.
//
// The lesson is that a rule about a TYPE's behaviour has to hold across every
// set that type appears in. So this asserts the overlap directly: no gang type
// may be in both lists. A future edit that adds a type to FIGHTERS for
// reputation-driven aggression cannot silently also leave it in an ungated list.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const npc = readFileSync(join(here, "../../src/npc.js"), "utf8");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

// Parse the real sets rather than restating them.
const setOf = (name) => {
  const m = npc.match(new RegExp(`${name} = new Set\\(\\[([^\\]]*)\\]\\)`));
  if (!m) return null;
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
};
const FIGHTERS = setOf("FIGHTERS");
const AMBUSHERS = setOf("AMBUSHERS");
check(!!FIGHTERS && !!AMBUSHERS, `parsed FIGHTERS (${FIGHTERS}) and AMBUSHERS (${AMBUSHERS})`);

console.log("\n=== 1. THE OVERLAP THAT CAUSED IT ===");
// This is the whole test. If a type is in both, the ungated branch wins for a
// neutral faction and the "civilians until provoked" rule is a lie.
const overlap = FIGHTERS.filter((t) => AMBUSHERS.includes(t));
check(overlap.length === 0,
  `no type is in both FIGHTERS and AMBUSHERS${overlap.length ? ` — ${overlap.join(", ")} attack on sight regardless of standing` : ""}`);

console.log("\n=== 2. the specific gangs the player named ===");
for (const t of ["hoodrat", "redneck"]) {
  check(!AMBUSHERS.includes(t), `${t} does not attack on sight`);
  check(FIGHTERS.includes(t), `${t} is governed by faction standing instead`);
}
check(AMBUSHERS.includes("hog"), "a feral hog still attacks on sight — territorial, and it reads as an animal");

console.log("\n=== 3. the ungated branch really is ungated ===");
// Guards against a future "fix" that makes the AMBUSHERS branch consult
// standing, which would look correct and would quietly remove the GTA2-style
// reputation aggression the player asked for.
const amb = npc.match(/if \(AMBUSHERS\.has\(e\.type\)[\s\S]*?\n    \}/);
check(!!amb, "the AMBUSHERS branch exists");
if (amb) {
  check(!/standingFn/.test(amb[0]),
    "the AMBUSHERS branch does not consult standing — reputation aggression lives in FIGHTERS, not here");
  check(/becomeHostile\(e\)/.test(amb[0]), "and it does call becomeHostile, so the set still means something");
}
const fig = npc.match(/if \(FIGHTERS\.has\(e\.type\)\)[\s\S]*?\n    \}\n/);
check(!!fig && /standingFn/.test(fig[0]),
  "the FIGHTERS branch DOES consult standing — that is the gated path");

console.log("\n=== 4. gang-v-gang violence is untouched ===");
// The player did NOT ask for gangs to stop fighting each other; only the
// unprovoked attacks on the PLAYER. factions.js and klan.js call becomeHostile
// directly and must keep working.
const factions = readFileSync(join(here, "../../src/factions.js"), "utf8");
const klan = readFileSync(join(here, "../../src/klan.js"), "utf8");
check(/becomeHostile\(/.test(factions), "factions.js still turns rivals on each other");
check(/becomeHostile\(/.test(klan), "klan.js still turns rivals on each other");
const forced = klan.match(/becomeHostile\([^)]*,\s*true\)/g) || [];
check(forced.length > 0, `klan.js can still force hostility past the budget (${forced.length} sites)`);

console.log("\n=== 5. provoked gangs still fight back ===");
// "Until provoked" must not have become "never". A gang member who is hurt
// still turns on the attacker.
check(/if \(e\.provoked\)[\s\S]{0,220}becomeHostile\(e\)/.test(npc),
  "a provoked gang member becomes hostile — timid and skittish flee instead");

console.log(`\n${fails ? fails + " FAILURES" : "gangs are civilians until provoked"}`);
process.exit(fails ? 1 : 0);