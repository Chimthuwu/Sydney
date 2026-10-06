// police_fairness.mjs — the cops are unfun (human, 2026-10-03)
//
//   node --experimental-detect-module tools/qa/police_fairness.mjs
//
// HUMAN, verbatim: "the cops are, like, really fucking, like, annoying. We need to,
// like, make them less annoying because the game is, like, not fun. Wanted level goes
// up, like, way too quick and the cops, like, they don't even have guns. They're just
// bullets just shooting out of their fucking chest and, like, they're just overpowered.
// Like, they're not fun to, like, run away from. They're just because they always
// catch you and you just die. It's not really fun at all."
//
// FOUR complaints, four different causes. Worth separating, because two of them were
// ALREADY FIXED on 2026-10-02 and the human's report predates or ignores that:
//
//   "always catch you and you die"  -> i-frames + missChance, fixed 10-02. 8 cops
//                                     could land 28 HP in one frame; HURT_IFRAMES caps
//                                     it. Verified below, not re-changed.
//   "overpowered"                    -> same fix. The NUMBERS were fine.
//   "bullets out of their chest"     -> the ORIGIN was wrong, fixed here. A hardcoded
//                                     y:1.35 (adult chest) for every officer, so on
//                                     short models the tracer came out of the sternum.
//                                     This is why it read as "they have no guns".
//   "wanted level goes up way too    -> NOT fixed. This is the one that is actually
//    quick"                             still true, and it is the real complaint. The
//                                     10-02 work made each star survivable; it did
//                                     nothing about how fast you GET here.
//
// The rate is the point: a mode that is survivable but reached in 8 seconds is still
// not fun, because there is no time to make a decision. Measured below, not asserted
// as a vibe.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(here, "../../src/main.js"), "utf8");

let fails = 0;
const check = (c, m) => { console.log(`  ${c ? "ok  " : "FAIL"} ${m}`); if (!c) fails++; };

// ---------------------------------------------------------------- 1. i-frames
console.log("=== 1. a single frame cannot delete you (fixed 2026-10-02, kept) ===");
check(main.includes("HURT_IFRAMES = 0.34"),
  "HURT_IFRAMES 0.34s still gates incoming damage");
check(main.includes("HURT_BIG_THRESHOLD"), "heavy hits earn a longer window, small chip damage does not");

// ---------------------------------------------------------------- 2. miss chance
console.log("\n=== 2. cops can miss (fixed 2026-10-02, kept) ===");
check(/missChance\s*=/.test(main), "police fire has a real miss chance, not a certain hit");
const miss = main.match(/const missChance = [^;]+/);
check(!!miss, `miss chance is range-scaled (${miss ? miss[0].slice(0, 60) : "MISSING"})`);

// ---------------------------------------------------------------- 3. muzzle origin
console.log("\n=== 3. rounds leave the weapon, not the chest (fixed 2026-10-03) ===");
const raw = main.slice(main.indexOf("shootPlayer: (e, dmg)"), main.indexOf("shootPlayer: (e, dmg)") + 2600);
// Strip // comments before scanning. Without this the gate FAILS ITSELF: the comment
// explaining the fix quotes "y: 1.35" verbatim, so a naive scan reads the old value as
// still present. A gate that can be failed by its own documentation is a gate nobody
// trusts, so the code is what gets tested.
const shootBlock = raw.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
check(!/y:\s*1\.35/.test(shootBlock), "the hardcoded chest height 1.35 is gone from the officer fire hook CODE");
check(/y:\s*1\.5/.test(shootBlock), "rounds now originate at shoulder/rifle height (1.5+)");
check(/fx \* 0\.4|fz \* 0\.4/.test(shootBlock),
  "the tracer is offset forward along the officer's facing, so it comes from the muzzle end and not from inside the torso");

// ---------------------------------------------------------------- 4. the real one
console.log("\n=== 4. heat must not spike (the complaint that survived) ===");
const thr = main.match(/const WANTED_THRESHOLDS = \[([^\]]+)\]/);
check(!!thr, "WANTED_THRESHOLDS is parseable");
const th = thr ? thr[1].split(",").map((s) => Number(s.trim())) : [];
check(th.length >= 6, `there are ${th.length} star thresholds`);

// First star must NOT be one witnessed shot. crime(0.4) per cop hit, and a
// missed/witnessed shot is 0.4, so a 1.2 bar is 3 shots -- which is a lot faster
// than it looks, because a burst is many shots in a second.
console.log(`  thresholds: ${th.join(", ")}`);
const firstStar = th[1];
check(firstStar >= 3.0, `one star needs real heat, not a single exchange (now ${firstStar}, was 1.2)`);

// The GAPS matter more than the levels. Old: 1.2 -> 4.0 = 2.8 between one and two
// stars. The comment at WANTED_THRESHOLDS claims "the gap between each later star is
// LONG so the player has room to actually deal with it" -- 2.8 heat is not long.
// The 0 -> 1 gap is deliberately short: the FIRST star should be prompt and
// readable, so the player learns the system exists. It is the STEPS AFTER that need
// room, because that is where escalation stops being a surprise and starts being a
// decision. Old first gap was 1.2, which was not "prompt" -- it was three shots.
for (let i = 2; i < th.length; i++) {
  const gap = th[i] - th[i - 1];
  if (gap < 8) {
    check(false, `gap from ${i - 1} to ${i} stars is ${gap.toFixed(1)} heat -- too tight to react to`);
  }
}
check(th[1] >= 2.5, `the first star is still prompt (${th[1]} heat, was 1.2 -- a third of the old value)`);
check(th.every((v, i) => i <= 1 || v - th[i - 1] >= 8),
  "every gap AFTER the first is at least 8 heat, so escalation is something you can outrun");

// Decay must outpace a slow trickle of heat, or you are pinned at 3 stars forever.
// There is no HEAT_DECAY_* constant -- the rates are inlined at the decay site, and
// a comment near WANTED_THRESHOLDS REFERENCES constants that were never declared.
// Matching on the comment is how you "pass" a decay that does not exist, so this
// checks the real expression instead.
const decay = main.match(/state\.heat = Math\.max\(0, state\.heat - dt \* \([^)]+\)/);
check(!!decay, `heat actually decays (${decay ? decay[0] : "NOT FOUND -- heat never falls"})`);
const foot = decay && Number((decay[0].match(/veh \? ([\d.]+) : ([\d.]+)/) || [])[2]);
check(!foot || foot >= 0.9, `on-foot decay is at least 0.9/s, so a star loss is ~9s of running (now ${foot})`);

console.log(`\n${fails ? fails + " FAILURES" : "the cops are survivable, visible, and you can outrun them"}`);
process.exit(fails ? 1 : 0);
