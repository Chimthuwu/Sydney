// cop_loot_test.mjs — killing a cop pays, and pays more than killing a civilian.
//
//   node --experimental-detect-module tools/qa/cop_loot_test.mjs
//
// Human request 2026-10-02: "do cops even drop anything ?? They should drop
// hella money and/or guns..."
//
// They dropped NOTHING, and not because of a tuning mistake: dropFor() returns
// an empty array for any type with no LOOT_TABLES entry, and there was no `cop`
// entry at all. So the most dangerous person on the street was a strictly worse
// kill than a civilian.
//
// Two things this pins that a table alone would not:
//
// 1. A cash drop is a SINGLE bill from CASH_NOTES, which tops out at $50. So
//    "hella money" is not achievable by raising the cash chance — even 1.0
//    spawns one note. The table needs a `notes` range and dropFor needs to
//    honour it, or the request is only half met.
// 2. There are TWO ways a cop dies (killEnemy, and the vehicle/ram path) and
//    both must roll. A table wired into only one is invisible in play.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LOOT_TABLES, CASH_NOTES } from "../../src/loot.js";

const here = dirname(fileURLToPath(import.meta.url));
const lootSrc = readFileSync(join(here, "../../src/loot.js"), "utf8");
const main = readFileSync(join(here, "../../src/main.js"), "utf8");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

console.log("=== 1. a cop has a loot table at all ===");
check(!!LOOT_TABLES.cop, "LOOT_TABLES.cop exists — this was the actual bug: no entry meant dropFor returned []");
check(LOOT_TABLES.cop.cash > 0, "a cop always drops cash");
check(LOOT_TABLES.cop.weapon > 0, "and usually their weapon");
check(LOOT_TABLES.cop.ammo > 0, "and ammo for it");
check(LOOT_TABLES.cop.health > 0, "and sometimes a first-aid kit, like everyone else");

console.log("\n=== 2. a cop out-earns a civilian ===");
const avg = (tbl) => (tbl.cash * (CASH_NOTES.reduce((a, [amt, w]) => a + amt * w, 0)
  / CASH_NOTES.reduce((a, [, w]) => a + w, 0)));
const copCash = avg(LOOT_TABLES.cop) * (LOOT_TABLES.cop.notes
  ? (LOOT_TABLES.cop.notes[0] + LOOT_TABLES.cop.notes[1]) / 2 : 1);
for (const t of ["hoodrat", "redneck", "prostitute"]) {
  check(copCash > avg(LOOT_TABLES[t]),
    `a cop beats a ${t} ($${copCash.toFixed(0)} vs $${avg(LOOT_TABLES[t]).toFixed(0)} expected)`);
}
check(LOOT_TABLES.cop.weapon > LOOT_TABLES.hoodrat.weapon
  && LOOT_TABLES.cop.weapon > LOOT_TABLES.redneck.weapon,
  "and is the more reliable gun on the street — a cop is armed, that is the point");

console.log("\n=== 3. 'hella money' needs the notes range, not just a chance ===");
// A single CASH_NOTES bill maxes out at $50, so cash: 1 alone could never
// deliver. This is the assertion that stops someone 'simplifying' notes away.
check(Array.isArray(LOOT_TABLES.cop.notes), "the cop table declares a notes range");
check(LOOT_TABLES.cop.notes[0] >= 3, `at least 3 bills (${LOOT_TABLES.cop.notes[0]})`);
check(LOOT_TABLES.cop.notes[1] > LOOT_TABLES.cop.notes[0],
  `and a range, not a fixed count (${LOOT_TABLES.cop.notes.join("-")})`);
check(LOOT_TABLES.cop.notes[1] * 50 >= 250,
  `the top of the range is worth real money ($${LOOT_TABLES.cop.notes[1] * 50}+)`);
check(/table\.notes/.test(lootSrc), "dropFor actually honours the notes range");
check(/for \(let i = 0; i < count; i\+\+\)/.test(lootSrc), "it loops to spawn more than one bill");
// NOTE: normalised whitespace before matching. The first version of this check
// was missing a space after `${amount:` and so could never match — an assertion
// that fails to match looks identical to a real failure, which is exactly the
// trap this suite exists to avoid.
const flat = lootSrc.replace(/\s+/g, " ");
check(flat.includes("amount: weighted(CASH_NOTES, rng)"),
  "each bill is still a legal CASH_NOTES value, not an invented number");
// A drop is capped/recycled elsewhere, so many notes must not leak.
check(/MAX_ACTIVE/.test(lootSrc), "pickups stay capped and recycled, so extra bills cannot leak forever");

console.log("\n=== 4. both ways a cop dies roll loot ===");
const calls = (main.match(/loot\.dropFor\(/g) || []).length;
check(calls >= 2, `${calls} dropFor call sites in main.js`);
check(/Killing a cop/.test(main), "the vehicle/ram cop-kill path exists");
check(/loot\.dropFor\(c\)/.test(main), "and that path rolls loot — not just the shooting path");
check(/loot\.dropFor\(e\)/.test(main), "the shooting path rolls loot");
// The trap: a cop entry added but only reachable via one death path.
check(!/LOOT_TABLES\s*=\s*Object\.freeze\(\{[\s\S]*?cop[\s\S]*?\}\s*;/.test(lootSrc) === false,
  "the cop table is in the real frozen export, not a copy");

console.log("\n=== 5. nothing else was quietly emptied ===");
check(LOOT_TABLES.hog.cash === 0, "a feral hog still drops nothing — it has no wallet");
check(LOOT_TABLES.zombie.cash === 0, "a zombie still drops no cash");
check(!!LOOT_TABLES.zombie, "but a zombie still drops its carried ammo");

console.log(`\n${fails ? fails + " FAILURES" : "cops are worth killing"}`);
process.exit(fails ? 1 : 0);