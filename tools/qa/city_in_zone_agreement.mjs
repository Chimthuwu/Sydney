// city_in_zone_agreement.mjs — the three "is this inside the city" tests must agree.
//
//   node tools/qa/city_in_zone_agreement.mjs
//
// WHY THIS EXISTS. orlea.inCity() is EXCLUSIVE on the city's south edge: it tests
// z > CITY.minZ, and the city starts at z = 130. The spawn point is exactly z = 130.
// So the spawn corridor is "not the city" by arithmetic, and three separate readers
// needed to know that -- and needed to be told about it independently.
//
//   1. spawnzones.js zoneAt()      -- the classification. Everything downstream reads it.
//   2. spawnzones.js pick()        -- where an NPC gets a hangout POI vs a highway verge.
//   3. main.js `busy`              -- the population cap and the respawn cooldown.
//
// The first spawn-density fix (3ecfde9) widened the margin in readers 2 and 3 and LEFT
// READER 1 ON THE STRICT CALL. The regression was invisible, and that is the point: the
// fix was verified by looking at NPC counts on the roads, which had genuinely improved,
// so the suite stayed green and the fix was considered done. Four commits later
// tools/qa/city_vegetation_probe.mjs reported 165 hogs inside OrleaRouge -- the exact
// bug fe0f848 had fixed -- because a 40 m band around the city's south edge still
// classified as forest through zoneAt().
//
// A GREEN SUITE IS NOT EVIDENCE THAT A FIX LANDED. This gate is the evidence: it
// compares the three tests numerically instead of trusting that whoever edited last
// remembered all of them. It is a static check and asserts nothing about the running
// game, per the gtb-perf-audit rule about framing-independent tools.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, "../../src", f), "utf8");
const zones = read("spawnzones.js");
const main = read("main.js");
const orlea = read("orlearouge.js");

let fails = 0;
const check = (c, m) => { console.log(`  ${c ? "ok  " : "FAIL"} ${m}`); if (!c) fails++; };

console.log("\n=== there must be ONE canonical definition ===");
// A duplicated margin constant inside spawnzones.js is how this drifts: one definition
// serving both readers means an edit can only be right or wrong, never half-applied.
const marginDecls = (zones.match(/const SPAWN_MARGIN_Z\s*=/g) || []).length;
check(marginDecls === 1, `SPAWN_MARGIN_Z is declared exactly once in spawnzones.js (found ${marginDecls})`);
const predDecls = (zones.match(/function inCityWide\s*\(/g) || []).length;
check(predDecls === 1, `inCityWide() is declared exactly once in spawnzones.js (found ${predDecls})`);

const margin = Number((zones.match(/const SPAWN_MARGIN_Z\s*=\s*(\d+)/) || [])[1]);
console.log(`  SPAWN_MARGIN_Z = ${margin} m`);

console.log("\n=== all three readers must use the canonical test ===");
check(/if \(orlea && x >= coreMinX && inCityWide\(x, z\)\) return "urban";/.test(zones),
  "zoneAt() classifies via inCityWide()");
check(/if \(orlea && x >= coreMinX && inCityWide\(x, z\)\) \{/.test(zones),
  "pick() offers a city POI via the same inCityWide()");

// main.js cannot import spawnzones.js's helper (import cycle), so it keeps its own
// constants. Those must MATCH, and this is the check that would have caught 3ecfde9.
const mainMargin = Number((main.match(/const CITY_MARGIN_Z\s*=\s*(\d+)/) || [])[1]);
const mainMin = Number((main.match(/const CITY_MIN_Z\s*=\s*(-?\d+)/) || [])[1]);
// main.js declares both bounds on ONE line (`const CITY_MIN_Z = 130, CITY_MAX_Z = 500;`),
// so CITY_MAX_Z must not be anchored to a `const` of its own. My first version did,
// matched neither, and printed NaN plus a spurious "the readers disagree" -- a gate that
// cries drift when the numbers agree is worse than no gate, because it teaches you to
// ignore it.
const mainMax = Number((main.match(/CITY_MAX_Z\s*=\s*(-?\d+)/) || [])[1]);
check(Number.isFinite(mainMin) && Number.isFinite(mainMax),
  `both rect constants parsed out of main.js (minZ=${mainMin}, maxZ=${mainMax})`);
check(mainMargin === margin, `main.js CITY_MARGIN_Z (${mainMargin}) === spawnzones.js SPAWN_MARGIN_Z (${margin})`);

console.log("\n=== and the rect itself must match orlearouge.js ===");
// orlearouge.js is the district; the other two duplicated numbers must equal its own.
const CITY = (orlea.match(/CITY\s*=\s*\{[^}]*\}/) || [])[0] || "";
const orleaMin = Number((CITY.match(/minZ:\s*(-?\d+)/) || [])[1]);
const orleaMax = Number((CITY.match(/maxZ:\s*(-?\d+)/) || [])[1]);
console.log(`  orlearouge.js CITY: minZ=${orleaMin} maxZ=${orleaMax}`);
check(orleaMin === mainMin, `main.js CITY_MIN_Z (${mainMin}) === orlearouge CITY.minZ (${orleaMin})`);
check(orleaMax === mainMax, `main.js CITY_MAX_Z (${mainMax}) === orlearouge CITY.maxZ (${orleaMax})`);

console.log("\n=== the margin is a STRIP, not a half-plane ===");
// Both copies shipped testing z ONLY, which made "inside the city" true at every x on
// the map -- a strip as wide as the city and as long as the world. It read correctly
// because z was the axis that was broken. Now asserted explicitly, on both copies.
const wideBody = (zones.match(/function inCityWide[\s\S]*?\n}/) || [])[0] || "";
check(/x < c\.minX \|\| x > c\.maxX/.test(wideBody),
  "inCityWide() rejects x outside CITY (the half-plane bug)");
const mainWide = (main.match(/const inCityHere[\s\S]*?inCity\(playerPos\.x, playerPos\.z\)[\s\S]*?\);/) || [])[0] || "";
check(/playerPos\.x >= CITY_MIN_X/.test(mainWide),
  "main.js's copy rejects x outside CITY too");
const orleaMinX = Number((CITY.match(/minX:\s*(-?\d+)/) || [])[1]);
const orleaMaxX = Number((CITY.match(/maxX:\s*(-?\d+)/) || [])[1]);
const mainMinX = Number((main.match(/CITY_MIN_X\s*=\s*(-?\d+)/) || [])[1]);
const mainMaxX = Number((main.match(/CITY_MAX_X\s*=\s*(-?\d+)/) || [])[1]);
check(mainMinX === orleaMinX && mainMaxX === orleaMaxX,
  `main.js x bounds (${mainMinX}..${mainMaxX}) === orlearouge CITY (${orleaMinX}..${orleaMaxX})`);

console.log("\n=== the spawn point must classify as city, and so must its surroundings ===");
// The behavioural assertion, evaluated against the real constants. SPAWN_Z is 130 and
// ROAD_X is -6; if either drifts, the margin is sized wrong and the probe that found
// this (city_vegetation_probe.mjs) goes red again.
const spawnZ = Number((main.match(/const SPAWN_Z\s*=\s*(-?\d+)/) || [])[1]);
const roadX = Number((main.match(/const ROAD_X\s*=\s*(-?\d+)/) || [])[1]);
console.log(`  spawn = (${roadX}, ${spawnZ}), city = z ${orleaMin}..${orleaMax}, margin ${margin} m`);
const spawnInCity = spawnZ >= orleaMin - margin && spawnZ <= orleaMax + margin;
check(spawnInCity, "the spawn point is inside the widened city band");
// Strict inCity() excludes it -- this is the arithmetic that caused the whole thing,
// asserted so the reason is written down where the next editor will see it.
const spawnInStrict = spawnZ > orleaMin;
check(!spawnInStrict,
  "the spawn point is NOT inside strict inCity() -- confirming the margin is load-bearing, not redundant");

// A grid sweep: the band that regressed must be urban, not forest, at several depths.
const band = [];
for (const z of [orleaMin - 20, orleaMin, orleaMin + 20, orleaMin + 40]) {
  band.push(`z=${z}:${z >= orleaMin - margin && z <= orleaMax + margin ? "urban" : "NOT-CITY"}`);
}
console.log(`  band: ${band.join("  ")}`);
check(!band.some((s) => s.includes("NOT-CITY")),
  "the whole 20 m band either side of the south edge classifies as city (this is where the hogs came back)");

console.log(`\n${fails ? fails + " FAILURE(S) -- the readers disagree" : "all three readers agree: one margin, one rect, spawn is inside the city"}`);
process.exit(fails ? 1 : 0);