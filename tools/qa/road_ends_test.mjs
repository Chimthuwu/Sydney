// ---------------------------------------------------------------------------
// road_ends_test.mjs — is the state actually connected up?
//
//   node --experimental-detect-module tools/qa/road_ends_test.mjs
//
// This runs tools/qa/road_ends.mjs and asserts on the numbers. The survey
// existed first; this makes it a floor rather than a snapshot, so "did we finish
// the roads" has an answer that goes red when it stops being true.
//
// The thresholds are the ones the current world actually meets, with a little
// slack, and each one is written as the CLAIM rather than as a magic number: a
// city with no roads in it fails on "every district has traffic lanes", not on
// "OrleaRouge is 11312 m long".
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const survey = fileURLToPath(new URL("./road_ends.mjs", import.meta.url));
const run = spawnSync(process.execPath, ["--experimental-detect-module", survey, "--json"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

if (run.status !== 0) {
  console.log(`FAIL the survey did not run (exit ${run.status})`);
  console.log(run.stderr || run.stdout);
  process.exit(1);
}

const at = run.stdout.indexOf("---JSON---");
if (at < 0) {
  console.log("FAIL the survey printed no JSON");
  console.log(run.stdout.slice(0, 2000));
  process.exit(1);
}
const out = JSON.parse(run.stdout.slice(at + "---JSON---".length));

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
};

const named = (n) => out.districts.find((d) => d.name === n);
const metres = (n) => (named(n) ? named(n).metres : 0);

console.log(`\nstate roads: ${out.totalMetres} m of lane, ${out.pavedKm2} km2 paved in a ${(out.grid * out.cell / 1000) ** 2} km2 map\n`);

// ---------------------------------------------------------------- it is a state
check("the whole state is more than 20 km of road", out.totalMetres > 20000, `${out.totalMetres} m`);
check("paved ground covers at least a twentieth of the map", out.pavedKm2 >= (out.grid * out.cell / 1000) ** 2 / 20,
  `${out.pavedKm2} km2`);

// ---------------------------------------------------------------- every district
// A district that reports zero lanes is the failure this whole file was written
// for. The first version of the survey hit it on StateWorld, which is where the
// freeways live, and cheerfully reported the state's largest road network as
// empty.
for (const d of out.districts) {
  check(`${d.name} has traffic lanes`, d.lanes > 0 && d.metres > 0, `${d.lanes} lanes, ${d.metres} m`);
}

// ---------------------------------------------------------------- nothing is cut off
{
  // The map runs to +/-1200. US-167 is a lane from z = +1198 to z = -1198, so
  // north-south the road is expected to reach the edge; anything less means the
  // spine is no longer a spine.
  check("the north–south spine reaches the map edge", out.reach.north && out.reach.north.gapToEdge < 40,
    out.reach.north ? `${out.reach.north.gapToEdge} m short` : "no road north at all");
  check("...in both directions", out.reach.south && out.reach.south.gapToEdge < 40,
    out.reach.south ? `${out.reach.south.gapToEdge} m short` : "no road south at all");
  // East is the eastbound arterial's job, and it is the thing the last screenshot
  // was complaining about.
  check("the eastbound arterial reaches the map edge", out.reach.east && out.reach.east.gapToEdge < 60,
    out.reach.east ? `x ${out.reach.east.at[0]}, ${out.reach.east.gapToEdge} m short` : "no road east at all");
  // West is NOT expected to reach the edge — Red Dust is out past x = -1000 and
  // everything between it and the map boundary is swamp on purpose. What matters
  // is that the corner town is on a road at all.
  check("the far west is reached", out.reach.west && out.reach.west.at[0] < -1000,
    out.reach.west ? `x ${out.reach.west.at[0]}` : "no road west at all");
}

// ---------------------------------------------------------------- the corners
// Port Calypso, Red Dust, Lakeshore and Oyster Bay are the four towns in the
// state's corners, and their lanes arrive through StateWorld's build rather than
// through a district creator, so they are the ones a coverage check misses if it
// stops at the creator.
check("the state's own build contributes the freeways and the corner towns",
  metres("StateWorld") > 10000, `${metres("StateWorld")} m`);

// ---------------------------------------------------------------- the cities
check("OrleaRouge is a metropolis by road length alone", metres("OrleaRouge") > 10000, `${metres("OrleaRouge")} m`);
check("Metro is a city too", metres("Metro") > 4000, `${metres("Metro")} m`);

// ---------------------------------------------------------------- and a floor on the holes
{
  // Not "no holes" — 67 of them is correct: the middle of the state is bayou and
  // swamp and is meant to stay empty. But a growing city should not be adding to
  // the list, so this only fails if coverage shrinks.
  const limit = 70;
  check(`no more than ${limit} empty 200 m squares`, out.holes.length <= limit, `${out.holes.length} holes`);
}

console.log(failures ? `\n${failures} road coverage check(s) FAILED` : "\nAll road coverage checks passed");
process.exit(failures ? 1 : 0);
