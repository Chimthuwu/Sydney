// police_spawn_pacing.mjs — pins the spawn PACING, which is the part of the
// response that never got tuned.
//
//   node --experimental-detect-module tools/qa/police_spawn_pacing.mjs
//
// Human report 2026-10-02: "police are faaaar faaaar too overpowered now....
// wanted level goes up way too fast, they spawn way too quickly they fuckin suck"
//
// IMPORTANT CONTEXT, because this file must not be mistaken for a fix to the
// whole complaint. The WANTED LADDER was already retuned earlier the same day, in
// response to a near-identical report (see the long comment above
// WANTED_THRESHOLDS in src/main.js: "[0, 1.2, 4.0, 8.5, 15.0, 24.0, 36.0]").
// That fixed how FAST you gain stars. It did not touch how fast UNITS ARRIVE, and
// that is the half of the complaint still standing.
//
// THE DEFECT, from src/main.js updateSheriffs():
//
//     const footWant = state.wanted === 1 ? 1
//       : state.wanted === 2 ? Math.min(4, state.wanted + 1)
//       : Math.min(8, state.wanted + 2);
//
//     footSpawnCd = placed ? 2.5 + Math.random() * 1.5 : 0.4;
//
// Two problems, both independent of the star ladder:
//
//   1. THE CADENCE IS FLAT. `footWant` scales with stars but the gap between
//      deputies does not: 2.5-4.0 s per deputy whether that is the second
//      deputy at one star or the eighth at six. So the response RATE is constant
//      and only the CEILING moves. Star 6 fills to 8 deputies in about the same
//      wall-clock time as star 2 fills to 3, and 8 deputies is a lot of gunfire
//      arriving inside a few seconds with no ramp.
//
//   2. THE FAILED-PLACEMENT RETRY IS 0.4 s. When all ten probes on the 14-30 m
//      ring land on blocked ground -- which is most of the time in a dense
//      district like OrleaRouge -- `placed` is false and the very next line is
//      `footSpawnCd = 0.4`. That is a 6x faster retry than a successful spawn,
//      so the harder the map is to place on, the HARDER the system hammers it.
//      Exactly backwards, and it is why this reads as oppressive downtown: the
//      city is the place placement fails most, so the city is where you get
//      spawn-attempted 6x more often.
//
// The fix scales the cadence with the star count and stops the failure path from
// being the fastest one. It does NOT touch crime(), heat, or WANTED_THRESHOLDS --
// those were already dealt with and re-tuning them again would be guesswork.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(here, "../../src/main.js"), "utf8");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

// Pull the live values out of the source so the numbers in the messages are real.
const footWant = (main.match(/const footWant =[\s\S]{0,220}?;/)[0] || "");
const footCd = (main.match(/footSpawnCd = placed \?([^:;]+):\s*([^;]+);/) || []);
// Anchor on the ASSIGNMENT with a real value. A loose /sheriffSpawnCd = ([^;]+);/
// matched the declaration `let sheriffSpawnCd = 0;` and reported "0".
const sheriffCd = (main.match(/sheriffSpawnCd = ([^;]+);(?![\s\S]*sheriffSpawnCd = )/) || []);
const sheriffAll = [...main.matchAll(/sheriffSpawnCd = ([^;]+);/g)].map((m) => m[1]);
const footGapDef = (main.match(/const footGap = ([^;]+);/) || []);
const sheriffGapDef = (main.match(/sheriffSpawnCd = (4 \+ [^;]+);/) || []);

console.log("=== 1. the wanted LADDER is left alone ===");
// This change is about pacing. If someone re-tunes the ladder here, the earlier
// deliberate fix is being undone silently.
check(/WANTED_THRESHOLDS = \[0, 1\.2, 4\.0, 8\.5, 15\.0, 24\.0, 36\.0\]/.test(main),
  "WANTED_THRESHOLDS still holds the retuned [0, 1.2, 4.0, 8.5, 15.0, 24.0, 36.0]");
check(!/const WANTED_THRESHOLDS = \[0, 1\.4, 3\.2/.test(main),
  "the old brutal ladder [0, 1.4, 3.2, 5.8, ...] has not come back");

console.log("\n=== 2. the deputy cadence scales with the wanted level ===");
check(/footSpawnCd/.test(main), "the foot spawn cadence is still assigned in updateSheriffs");
check(/footWant/.test(footGapDef.join(" ")),
  `the deputy gap is derived from the star count (footGap = ${(footGapDef[1] || "(not found)").trim()})`);
check(!/Math\.random\(\) \* 1\.5/.test(footGapDef.join(" ").replace(/Math\.random\(\) \* 1\.5(?![^;]*footWant)/, "")) || /footWant/.test(footGapDef.join(" ")),
  "the deputy gap is no longer a flat random 2.5-4.0 s");
check(!/footSpawnCd = placed \? 2\.5 \+ Math\.random\(\) \* 1\.5 : 0\.4;/.test(main),
  "the flat 2.5-4.0 s / 0.4 s pair is gone");

console.log("\n=== 3. a failed placement is not the fastest path ===");
// The bug: `placed ? <slow> : 0.4` made failing 6x faster than succeeding.
check(!/: 0\.4;/.test(footCd.join("")),
  `there is no bare 0.4 s retry left (currently: ${(footCd.join(" : ") || "(not found)").trim()})`);
check(/placed \?/.test(footCd.join("")),
  "the success and failure paths are still distinguished, so a blocked ring is handled deliberately");

console.log("\n=== 4. the ceilings are still sane ===");
check(/Math\.min\(8,/.test(footWant) || /FOOT_MAX/.test(footWant) || /FOOT_MAX/.test(main),
  "there is still a hard cap on simultaneous deputies");
check(/const want = state\.wanted >= 2 \? Math\.min\(5, state\.wanted - 1\) : 0;/.test(main),
  "cruisers still wait for two stars and stay capped at 5");

console.log("\n=== 5. cruisers are paced too ===");
check(sheriffCd.length > 0, `the cruiser cadence is assigned (currently: ${(sheriffCd[1] || "(not found)").trim()})`);
// The gap that governs arrival rate is the assignment immediately after
// spawnSheriff() -- the other sheriffSpawnCd writes are the declaration and the
// initial "call out" stagger. Check that one.
const gapAfterSpawn = (main.match(/spawnSheriff\(\);\s*\n\s*\/\/[^;]*?\n?\s*sheriffSpawnCd = ([^;]+);/) || []);
const sheriffGap = (gapAfterSpawn[1] || "").trim();
check(/want/.test(sheriffGap) && /Math\.min/.test(sheriffGap),
  `the cruiser cadence also scales with the star count (currently: ${sheriffGap || "(not found) next to spawnSheriff())"})`);

console.log(`\n${fails ? fails + " FAILURES -- police units still arrive at a flat rate, and blocked ground retries fastest" : "police spawn pacing scales with the wanted level, and a failed placement is not the fastest path"}`);
process.exit(fails ? 1 : 0);