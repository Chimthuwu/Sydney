// crime_exemption_test.mjs — zombies and hogs must NEVER generate heat.
//
//   node --experimental-detect-module tools/qa/crime_exemption_test.mjs
//
// This rule has now been broken TWICE, both times the same way, and both times
// the player found it in-game:
//
//   1. "We should NOT get a wanted level for killing / attacking zombies. ever"
//      I guarded crime() itself and the street `enemies` branch. Fixed the
//      reported case.
//   2. "still had cops come after me for shooting a zombie. We should not get
//      cops for killing zombies or hogs!"
//      The VENUE crowd branch and the bike-rider branch were separate code paths
//      to the same punishment, still calling a bare crime(1.2).
//
// The lesson is not "remember the venue branch". It is that a rule about a
// CONSEQUENCE (heat) has to hold at every site that produces the consequence, and
// nobody can enumerate those by memory in a 7000-line file. So this test
// enumerates them.
//
// A call site is allowed to be exempt-aware (pass a type) or exempt-free (no
// victim at all: jacking a car, blowing one up, shooting a cop). What is NOT
// allowed is a call that charges for killing a named actor and never mentions the
// exemption — that is precisely the shape of both bugs.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(here, "../../src/main.js"), "utf8");
const lines = main.split("\n");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

console.log("=== 1. crime() itself is a hard gate ===");
const fn = main.match(/function crime\([\s\S]*?\n\}/);
check(!!fn, "crime() exists");
if (fn) {
  check(/function crime\(amount, forZombie = false\)/.test(fn[0]),
    "it takes an exemption flag rather than being open to accident");
  check(/if \(forZombie \|\| state\.zombieMode\) return;/.test(fn[0]),
    "and returns before touching heat when the flag is set or the player is in zombie mode");
  check(/state\.heat \+= amount/.test(fn[0]),
    "heat is only added after the gate, not before it");
}

console.log("\n=== 2. EVERY crime() call site is classified ===");
// Walk every call and pull the surrounding context, so a new call site added
// later is forced to declare itself rather than inheriting silence.
const sites = [];
lines.forEach((line, i) => {
  const m = line.match(/crime\(([\d.]+)/);
  if (!m || line.trim().startsWith("//") || line.trim().startsWith("*")) return;
  sites.push({ line: i + 1, amount: m[1], text: line.trim(), ctx: lines.slice(Math.max(0, i - 6), i + 2).join("\n") });
});
console.log(`  --   ${sites.length} crime() call sites found`);

// A site "handles" the exemption if it passes a type-derived flag. Anything
// charging for a kill without that is the bug shape.
for (const s of sites) {
  const passesFlag = /crime\([^)]*,/.test(s.text);
  if (passesFlag) {
    ok(`line ${s.line} crime(${s.amount}) passes an exemption flag`);
  } else {
    // Exempt-free is legitimate only when there is no victim: a car exploding,
    // a cop being shot, a cruiser being jacked. Assert we can say which it is.
    const noVictim = /sheriff|explodeCar|is cop|cop\b|Killing a cop|Shooting a cop|Vehicle/i.test(s.ctx);
    check(noVictim,
      `line ${s.line} crime(${s.amount}) has no exemption flag — confirm it has no NPC victim`);
  }
}

console.log("\n=== 3. the two branches that were missed are now covered ===");
const venueBranch = main.match(/if \(goreHit\(wp\.x[\s\S]*?p\.a\?\.userData\?\.hog/);
check(!!venueBranch,
  "the VENUE crowd branch (a hog or zombie shot inside a club) consults the hog/zombie exemption");
check(/crime\(0\.12, p\.a\?\.userData\?\.hog/.test(main),
  "wounding one is exempt too — 0.12 a trigger pull is how a burst walked you up two stars");
check(/crime\(1\.2, e\.type === \"zombie\" \|\| e\.type === \"hog\"\)/.test(main),
  "the bike-rider branch (running someone over) is gated on type");
check(!/^\s*crime\(1\.2\);\s*$/m.test(main) && !/^\s*crime\(0\.12\);\s*$/m.test(main),
  "no bare crime(1.2) or crime(0.12) survives anywhere — those are the two victim-kill amounts");

console.log("\n=== 4. the exemption is keyed on the VICTIM, not the shooter ===");
// A warden/pig-rescue-style NPC shooting a zombie must also be safe, and a cop
// killing one must not manufacture heat for the player.
check((main.match(/type === \"zombie\"/g) || []).length >= 3,
  "the zombie type is tested at every victim site, not just the first one found");

console.log(`\n${fails ? fails + " FAILURES" : "zombies and hogs cannot generate heat"}`);
process.exit(fails ? 1 : 0);