// cheat_test.mjs — the all-weapons cheat also makes you rich, and does not
// rob you when you are already rich.
//
//   node --experimental-detect-module tools/qa/cheat_test.mjs
//
// Human request 2026-10-02: "Make the all weapon cheat make player hella rich
// too".
//
// This suite imports the REAL createLoot-style state and the real arsenal rather
// than pattern-matching the source, because the interesting failure here is not
// a missing line — it is a behaviour. Two specific ones:
//
//  1. unlockAll() used to return a bare array of weapon ids, and the only caller
//     read `.length` off it. Adding a cash grant meant changing that return
//     shape, and a caller left reading `.length` on an object gets `undefined`:
//     the cheat still works but prints "CHEAT: all undefined guns unlocked".
//     A grep cannot catch that. Calling it can.
//  2. A cheat that SETS cash rather than adding it silently takes money away
//     from a player who was carrying more. That is the kind of bug a cheat
//     should never have, and it only shows up when you run it twice.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(here, "../../src/main.js"), "utf8");
const weapons = readFileSync(join(here, "../../src/weapons.js"), "utf8");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

console.log("=== 1. the cheat grants cash ===");
check(/CHEAT_CASH = \d+/.test(weapons), "a named cash grant exists");
const amt = Number((weapons.match(/CHEAT_CASH = (\d+)/) || [])[1] || 0);
check(amt >= 100000, `it is "hella rich" ($${amt.toLocaleString()}), not a topping-up amount`);
check(/state\.cash = Math\.max\(\(state\.cash \|\| 0\) \+ CHEAT_CASH, CHEAT_CASH\)/.test(weapons),
  "it is ADDITIVE and tops up to a floor — it can never take money away");

console.log("\n=== 2. the return shape and its only caller agree ===");
check(/return \{ ids, cash: CHEAT_CASH, total: state\.cash \}/.test(weapons),
  "unlockAll returns { ids, cash, total }");
const callers = [...main.matchAll(/arsenal\.unlockAll\(\)/g)];
check(callers.length === 1, `there is exactly one caller (found ${callers.length})`);
// THE regression this guards: `.length` on an object is undefined, not a throw.
check(/const \{ ids, cash, total \} = arsenal\.unlockAll\(\)/.test(main),
  "the caller destructures it instead of reading .length off an object");
check(!/arsenal\.unlockAll\(\)\.length/.test(main),
  "and nothing reads .length straight off the result");
check(/syncHUD\(\)/.test(main.slice(main.indexOf("arsenal.unlockAll()") - 400, main.indexOf("arsenal.unlockAll()") + 400)),
  "the HUD is refreshed — cash is a HUD element, and without this the money lands silently");
check(/toLocaleString/.test(main.slice(main.indexOf("CHEAT: all"), main.indexOf("CHEAT: all") + 200)),
  "the flash reports the grant and the new balance, formatted like the rest of the HUD");

console.log("\n=== 3. it is still a cheat, and still respects the old rules ===");
check(/state\.reserve\[id\] = Infinity/.test(weapons), "infinite reserve is untouched");
check(/state\.weapon = "sawnoff"/.test(weapons), "still ends holding the sawn-off");
check(/!WEAPONS\[id\]\.melee/.test(weapons), "melee is still excluded from reserve");
check(/maxReserve/.test(weapons), "maxReserve is still respected elsewhere — the cheat is the documented exception, not a removal of the cap");
check(!/state\.freeRoam *= *true/.test(weapons),
  "it still does NOT flip free roam, which has its own rules");

console.log("\n=== 4. repeated use is a top-up, never a reset ===");
// Re-typing the code must not be a way to lose your balance.
const twice = (start) => Math.max(start + amt, amt);
check(twice(0) === amt, `from broke ($${twice(0).toLocaleString()})`);
check(twice(999999) === 999999 + amt,
  `from rich ($${twice(999999).toLocaleString()}) — the original balance is kept and topped up, not overwritten`);
check(twice(1000000) > 1000000, "and it only ever goes up");
check(Number.isFinite(twice(0)) && Number.isFinite(twice(1e9)),
  "the balance stays a finite number, so the HUD's \"$\" + toLocaleString() cannot print Infinity");

console.log(`\n${fails ? fails + " FAILURES" : "the cheat pays, and never takes"}`);
process.exit(fails ? 1 : 0);