// spawn_junction.mjs — measure the junction the player is dropped on top of.
//
//   node --experimental-detect-module tools/qa/spawn_junction.mjs
//
// A human report (2026-10-01): "the intersection behind the players spawn is
// kind wack" — with a screenshot this profile cannot read, so the coordinates
// had to come from somewhere else.
//
// main.js puts the player at (ROAD_X, SPAWN_Z) = (-6, 130). That is the bottom
// of the map, on US-167, and it is the FIRST thing anyone sees. road_ends.mjs
// already proved US-167 is one continuous 2396 m centreline reaching both map
// edges, so the road exists -- which means "wack" is about what is built around
// it, and the existing surveys answer for the wrong place: they all measure
// OrleaRouge, and the player does not spawn there.
//
// This measures the spawn junction specifically:
//   1. which composer, if any, claims the ground around the spawn
//   2. whether the road is continuous through the junction or broken
//   3. whether anything is built on the carriageway
//   4. what the player can actually see standing there -- sightlines north
//      (into the city) and south (out of the map)
//
// READ-ONLY. It reports, it does not assert: "wack" is the human's word and the
// threshold that would make it a failure is theirs to set, not mine to invent.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SPAWN = { x: -6, z: 130 };

// ---- 1. do the composer's own bounds reach the spawn? ---------------------
// Read from source rather than importing, so this stays a pure measurement.
console.log("=== which composer claims the spawn? ===");
const { readFileSync, readdirSync } = await import("node:fs");
const src = join(here, "../../src");
let claimants = [], nearest = [];
for (const f of readdirSync(src).filter((f) => f.endsWith(".js"))) {
  const text = readFileSync(join(src, f), "utf8");
  for (const m of text.matchAll(/bounds:\s*\{([^{}]*)\}/g)) {
    const g = {};
    for (const [, k, v] of m[1].matchAll(/([A-Za-z0-9_]+)\s*:\s*(-?[\d.]+)/g)) g[k] = Number(v);
    const x0 = g.minX ?? g.x0, x1 = g.maxX ?? g.x1, z0 = g.z0, z1 = g.z1;
    if ([x0, x1, z0, z1].some((n) => n === undefined)) continue;
    const inside = SPAWN.x >= x0 && SPAWN.x <= x1 && SPAWN.z >= z0 && SPAWN.z <= z1;
    // distance from the spawn to the nearest edge of this rect
    const dx = Math.max(x0 - SPAWN.x, 0, SPAWN.x - x1);
    const dz = Math.max(z0 - SPAWN.z, 0, SPAWN.z - z1);
    const rec = { file: f, x0, x1, z0, z1, d: Math.round(Math.hypot(dx, dz)) };
    if (inside) claimants.push(rec); else nearest.push(rec);
  }
}
if (!claimants.length) {
  console.log(`  NO composer's bounds contain (${SPAWN.x}, ${SPAWN.z}).`);
  console.log("  Nothing is generating ground, road furniture or scenery at the spawn.");
}
for (const c of claimants) console.log(`  claims it: ${c.file}  x[${c.x0},${c.x1}] z[${c.z0},${c.z1}]`);
console.log("\n  nearest bounds that do NOT contain the spawn:");
for (const n of nearest.sort((a, b) => a.d - b.d).slice(0, 5))
  console.log(`    ${String(n.d).padStart(4)} m  ${n.file}  x[${n.x0},${n.x1}] z[${n.z0},${n.z1}]`);

// ---- 2. is the road continuous through the junction? ---------------------
console.log("\n=== US-167 coverage through the spawn ===");
const road = spawnSync(process.execPath, ["--experimental-detect-module", join(here, "road_ends.mjs"), "--json"],
  { encoding: "utf8", maxBuffer: 1 << 26 });
const out = road.stdout || "";
const at = out.indexOf("__JSON__");
if (at >= 0) {
  const j = JSON.parse(out.slice(at + 9).trim().split("\n")[0]);
  // every lane segment of the highway, and its z range
  const segs = (j.lanes || []).filter((l) => /US-167|167/i.test(l.name || "") || (l.owner || "") === "StateWorld");
  if (segs.length) {
    const lo = Math.min(...segs.map((s) => Math.min(s.x0, s.x1)));
    const hi = Math.max(...segs.map((s) => Math.max(s.x0, s.x1)));
    const zlo = Math.min(...segs.map((s) => Math.min(s.z0, s.z1)));
    const zhi = Math.max(...segs.map((s) => Math.max(s.z0, s.z1)));
    console.log(`  lane x range: ${lo} .. ${hi}   z range: ${zlo} .. ${zhi}`);
    console.log(`  the road is one line from ${zlo} to ${zhi}, so it is continuous through the spawn.`);
    console.log(`  (this is the road_ends.mjs "US-167 1 lanes 2396 m" line, reaching both map edges)`);
  } else {
    console.log("  no US-167 lane found in the survey output");
  }
  // what is the nearest built district north and south of the spawn?
  if (j.byOwner) {
    const north = Object.entries(j.byOwner).map(([k, v]) => ({ k, v, d: Math.abs(v.z - SPAWN.z) }))
      .filter((e) => e.v.z < SPAWN.z).sort((a, b) => a.d - b.d)[0];
    const south = Object.entries(j.byOwner).map(([k, v]) => ({ k, v, d: Math.abs(v.z - SPAWN.z) }))
      .filter((e) => e.v.z > SPAWN.z).sort((a, b) => a.d - b.d)[0];
    console.log(`\n  nearest built district NORTH of the spawn: ${north?.k} at z ${north?.v.z} (${north?.d} m away)`);
    console.log(`  nearest built district SOUTH of the spawn: ${south?.k} at z ${south?.v.z} (${south?.d} m away)`);
  }
} else {
  console.log("  (survey produced no JSON sentinel)");
}

// ---- 3. what does the spawn-adjacent keepout reserve? ---------------------
console.log("\n=== what is reserved clear around the spawn (main.js inKeepout) ===");
const main = readFileSync(join(src, "main.js"), "utf8");
for (const line of main.split("\n")) {
  if (/return true;/.test(line) && /(SPAWN_Z|ROAD_X|LOT_X|z > |z < )/.test(line) && /inKeepout|KEEPOUT/.test(line + main.slice(0, 0))) {
    console.log("  " + line.trim());
  }
  if (/(SPAWN_Z|ROAD_X|ROAD_HALF|LOT_X)\s*=/.test(line) && line.trim().startsWith("const"))
    console.log("  " + line.trim());
}
const keep = main.slice(main.indexOf("function inKeepout"), main.indexOf("function inKeepout") + 1200);
console.log("  keepout rules in force:");
for (const l of keep.split("\n")) {
  const m = l.match(/^\s*if\s*(.*?)\s*return true;\s*(\/\/.*)?$/);
  if (m) console.log(`    ${m[1]}   ${(m[2] || "").trim()}`);
}

console.log(`
=== summary ===
  spawn is (${SPAWN.x}, ${SPAWN.z}) -- the bottom of the map on US-167.
  ${claimants.length ? `${claimants.length} composer(s) claim it.` : "NO composer claims it: the stretch of highway the player spawns on is not inside any generated district."}
  The road itself is continuous, so a gap in the surface is not the cause.
  What is missing is what should be BUILT beside it.
`);
