// faction_wiring_test.mjs — prove the reputation system is actually WIRED, not
// just present.
//
//   node --experimental-detect-module tools/qa/faction_wiring_test.mjs
//
// faction_reputation_test.mjs exercises the LEDGER in factions.js and passes
// happily. It never proves the ledger reaches the game. Three ways that silently
// breaks, all of which leave every unit test green:
//
//   1. main.js never calls notePlayerKill, so kills change nothing.
//   2. main.js never calls npcs.setStanding, so npc.js asks nobody and every gang
//      member stays neutral forever.
//   3. factionWar is built but update() is never called, so the decay never ticks.
//
// Static checks over the source, deliberately: these are connection facts, and a
// runtime harness that boots all 7039 lines of main.js to observe one call would
// be far more fragile than reading for the call itself.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(here, "../../src/main.js"), "utf8");
const npc = readFileSync(join(here, "../../src/npc.js"), "utf8");
const fac = readFileSync(join(here, "../../src/factions.js"), "utf8");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

console.log("=== 1. main.js reports player kills to the ledger ===");
check(/notePlayerKill\s*\(/.test(main), "main.js calls notePlayerKill");
check(/factionWar && !killer/.test(main),
  "and only for kills the PLAYER made — a turf kill must not move the ledger");
check(/resetReputation\s*\(/.test(main), "main.js calls resetReputation");
check(/factionWar && factionWar\.resetReputation\(\)/.test(main),
  "and calls it on the respawn path");

console.log("\n=== 2. npc.js asks factions.js how its faction feels ===");
check(/setStanding\s*\(fn\)/.test(npc), "npc.js exposes setStanding");
check(/standingFn\s*\(e\.type\)/.test(npc), "npc.js reads standingFn for the type");
check(/npcs\.setStanding\(getStanding\)/.test(main), "main.js injects it");
check(/let factionWar = null/.test(main) && /factionWar = createFactionWar/.test(main),
  "factionWar is late-bound through a thunk, so the two-way dependency is not a cycle");

console.log("\n=== 3. the two factions never import each other directly ===");
// factions.js imports npc.js for MAX_HOSTILE; npc.js must not import factions.js,
// or the module graph is circular and one of them silently gets a partial module.
check(/from "\.\/factions\.js"/.test(npc) === false,
  "npc.js does NOT import factions.js (would be a cycle)");
check(/from "\.\/npc\.js"/.test(fac), "factions.js does import npc.js (one direction only)");

console.log("\n=== 4. standing() is derived from the score, never from the flags ===");
const standingFn = fac.match(/function standing\(faction\) \{[\s\S]*?\n  \}/);
check(!!standingFn, "factions.js has a standing()");
if (standingFn) {
  check(/REPUTATION\[faction\]\s*<=\s*-ENEMY_TIER/.test(standingFn[0]),
    "enemy tier is derived from the score");
  check(/REPUTATION\[faction\]\s*>=\s*PROTECTOR_TIER/.test(standingFn[0]),
    "protector tier is derived from the score");
  check(!/ENEMY_FLAG\[faction\]\s*\)\s*return/.test(standingFn[0]),
    "and NOT from the sticky announcement flags (that made standing() lie at -3)");
}

console.log("\n=== 5. police shoot gang members who are hostile ===");
check(/shootPlayer: \(e, dmg\) => \{[\s\S]*?e\.state !== "hostile"\) return;/.test(main),
  "the shootPlayer hook checks the target is ACTIVELY hostile");
check(/COP_GANG_DAMAGE/.test(main), "and applies COP_GANG_DAMAGE");
check(/killEnemy\(e, \{ turf: true \}\)/.test(main),
  "a gang member killed by police is a turf kill, so it does not move the player's own reputation");

console.log("\n=== 6. zombie violence is never a crime ===");
const crimeFn = main.match(/function crime\([\s\S]*?\n\}/);
check(!!crimeFn, "main.js has crime()");
if (crimeFn) {
  check(/if \(forZombie \|\| state\.zombieMode\) return;/.test(crimeFn[0]),
    "crime() refuses heat for zombie kills — at the choke point, not per call site");
}
// every crime() call that can involve a zombie must pass the flag
const zombieAware = (main.match(/crime\([^)]*zombie/g) || []).length;
check(zombieAware >= 2, `both kill paths pass the zombie flag (${zombieAware} call sites)`);
check(/crime\(0\.06, aimingAtZombie\(gun\.range\)\)/.test(main),
  "gunfire aimed at a zombie is not a witnessed crime (range passed in: gun is local to fire())");
check(/function aimingAtZombie\(range\)/.test(main),
  "aimingAtZombie takes the range as an argument");
check(/aimingAtZombie\s*\(/.test(npc) === false,
  "aimingAtZombie lives in main.js, which owns the enemy list npc.js does not have");

console.log(`\n${fails ? fails + " FAILURES" : "reputation is wired end to end"}`);
process.exit(fails ? 1 : 0);