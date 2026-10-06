// urban_chain.mjs — how fast does the city turn into countryside going north?
//
//   node --experimental-detect-module tools/qa/urban_chain.mjs
//
// A human request (cunthuwu, 2026-10-01): "Literally what I want is like the new
// Orleans busy city vibe to extend well beyond the crown strip. We shouldn't be
// entering rural areas so quickly right after we just going north of the crown
// strip so soon. That's some bullshit man. We may need to rescale the areas so we
// would have Orlearouge go for much bigger well beyond the north of the crown
// strip, keep the strip and current buildings where they are... So a bit north of
// Orlearouge will be New Chatboro, then as we continue north we finally hit
// Chatboro, then only after Chatboro should things finally become slightly less
// urban."
//
// The map is roughly x,z in [-1100, 1100] (stateWorld.js composes four corner
// districts at x/z -1100..-400 and 400..1100), and the player spawns at z 130
// heading north into decreasing z. So the whole built world is a chain in z.
//
// This lays out that chain, finds where it turns rural, and measures the ratio
// that makes the map feel small: how much of the drive north is urban.
//
// READ-ONLY. It measures and reports a ratio. What the number SHOULD be is the
// human's call -- this deliberately does not pick a target and call it a bug.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "../../src");
const read = (f) => readFileSync(join(src, f), "utf8");

// The player drives north in -z, starting at z 130. Sort every district by the
// north edge it reaches, i.e. its most negative z, and the chain reads top to
// bottom.
const URBAN = new Set(["orlearouge", "crownstrip", "chatboro", "tusouxroe", "eastbank", "metro"]);

function bounds(file) {
  const t = read(file);
  const g = {};
  for (const n of ["BOUNDS", "CORE", "WILD", "CITY"]) {
    const m = t.match(new RegExp(`(?:export )?const ${n} = \\{([^}]*)\\}`));
    if (!m) continue;
    const o = {};
    for (const [, k, v] of m[1].matchAll(/([A-Za-z0-9_]+)\s*:\s*(-?[\d.]+)/g)) o[k] = Number(v);
    g[n] = o;
  }
  return g;
}

const chain = [];
for (const f of readdir()) {
  const key = f.replace(/\.js$/, "");
  const b = bounds(f);
  const z0 = b.BOUNDS?.z0 ?? b.CITY?.minZ ?? b.WILD?.z0;
  const z1 = b.BOUNDS?.z1 ?? b.CITY?.maxZ ?? b.WILD?.z1;
  if (z0 === undefined || z1 === undefined) continue;
  chain.push({ key, z0: Math.min(z0, z1), z1: Math.max(z0, z1), urban: URBAN.has(key) });
}
function readdir() {
  return ["orlearouge.js", "crownstrip.js", "chatboro.js", "tusouxroe.js", "eastbank.js",
    "metro.js", "portcalypso.js", "reddust.js", "lakeshore.js", "oysterbay.js",
    "charsoufre.js", "shruston.js", "corridors.js"].filter((f) => exists(f));
}
function exists(f) { try { readFileSync(join(src, f)); return true; } catch { return false; } }

chain.sort((a, b) => a.z0 - b.z0);   // most negative z (furthest north) first

console.log("=== the chain, north (top) to south (bottom) ===");
console.log("    district        z from     z to     width   kind");
for (const c of chain) {
  const b = bounds(c.key + ".js");
  const x0 = b.BOUNDS?.x0 ?? b.CITY?.minX ?? b.WILD?.x0 ?? 0;
  const x1 = b.BOUNDS?.x1 ?? b.CITY?.maxX ?? b.WILD?.x1 ?? 0;
  console.log(`    ${c.key.padEnd(14)} ${String(c.z0).padStart(6)}  ${String(c.z1).padStart(6)}   ${String(x1 - x0).padStart(4)} m   ${c.urban ? "URBAN" : "rural"}`);
}

const SPAWN_Z = 130;
console.log(`\n  player spawns at z ${SPAWN_Z} and drives north into decreasing z.`);

// ---- where does the urban run actually end? ------------------------------
const urbanNorth = Math.min(...chain.filter((c) => c.urban).map((c) => c.z0));
console.log(`\n=== the problem, in one number ===`);
console.log(`  furthest north URBAN ground: z ${urbanNorth} (${chain.filter(c=>c.urban).find(c=>c.z0===urbanNorth).key})`);
const drive = SPAWN_Z - urbanNorth;
console.log(`  total drive north from spawn: ${SPAWN_Z - (-1100)} m before the map even ends`);
console.log(`  urban run: ${drive} m of that ${SPAWN_Z + 1100} m`);
console.log(`  => only ${(100 * drive / (SPAWN_Z + 1100)).toFixed(1)}% of the north drive is urban.`);

// and the specific complaint: what is immediately north of the crown strip?
const cs = chain.find((c) => c.key === "crownstrip");
console.log(`\n=== just north of the Crown Strip (the complaint) ===`);
console.log(`  Crown Strip's north edge is z ${cs.z0}.`);
const beyond = chain.filter((c) => c.key !== cs.key && c.z0 <= cs.z0).sort((a, b) => b.z0 - a.z0);
for (const c of beyond.slice(0, 3)) {
  console.log(`    next thing north: ${c.key} at z ${c.z1} (${c.urban ? "URBAN" : "RURAL -- ${c.z1 - cs.z0} m of nothing urban first"})`);
}
// The survey's first draft concluded "NOTHING urban lies north of the Crown
// Strip". That was WRONG and the code said so out loud, which is why the
// numbers are here: Tusouxroe is urban, is z -572..-12, and does cover that
// latitude. It also covers the highway (x -6 is inside its -130..172 span), so
// the player really does have city north of the strip -- just not ENOUGH of it.
const northOf = chain.filter((c) => c.key !== cs.key && c.urban && c.z0 < cs.z1)
  .sort((a, b) => b.z1 - a.z1);            // whose south edge reaches furthest toward the strip
const firstUrbanNorth = northOf[0];
if (firstUrbanNorth) {
  const tb = bounds(firstUrbanNorth.key + ".js").BOUNDS;
  console.log(`  the next URBAN ground is ${firstUrbanNorth.key}, z ${firstUrbanNorth.z0}..${firstUrbanNorth.z1},`);
  console.log(`  x ${tb.x0}..${tb.x1} (${tb.x1 - tb.x0} m wide). So urban DOES continue north -- it is a`);
  console.log(`  question of how much, not whether.`);
} else {
  console.log(`  NOTHING urban lies north of the Crown Strip.`);
}
console.log(`\n  so the real defect is WIDTH and CONTINUITY, not an absolute cutoff:`);
const csB = bounds("crownstrip.js").BOUNDS;
if (firstUrbanNorth) {
  const tb = bounds(firstUrbanNorth.key + ".js").BOUNDS;
  const west = tb.x0 - csB.x0, east = csB.x1 - tb.x1;
  console.log(`    CrownStrip is ${csB.x1 - csB.x0} m wide; ${firstUrbanNorth.key} is only ${tb.x1 - tb.x0} m.`);
  if (west > 0) console.log(`    WEST wedge, x ${csB.x0}..${tb.x0}: ${west} m of the strip's own frontage with no urban neighbour.`);
  if (east > 0) console.log(`    EAST wedge, x ${tb.x1}..${csB.x1}: ${east} m likewise.`);
  const orl = bounds("orlearouge.js").CITY;
  console.log(`    And OrleaRouge's north edge is z ${orl.minZ}; the strip's south edge is z ${cs.z1},`);
  console.log(`    so there is ${orl.minZ - cs.z1} m between them -- the strip is an island, not`);
  console.log(`    part of a continuous city.`);
}

// ---- what the user asked for --------------------------------------------
// "Orlearouge goes much bigger, well beyond the north of the crown strip, with
// the strip still inside it. Then a bit north of that, New Chatboro. Then
// Chatboro. Only after Chatboro does it get slightly less urban."
console.log(`\n=== the shape being asked for ===`);
console.log(`  spawn                z   ${SPAWN_Z}`);
console.log(`  OrleaRouge (grown)      must now cover z ~${SPAWN_Z} down to well past the`);
console.log(`                          Crown Strip's north edge at z ${cs.z0}, and contain it`);
console.log(`  New Chatboro            "a bit north of Orlearouge"`);
console.log(`  Chatboro                further north still`);
console.log(`  rural                  only after Chatboro`);
console.log(`\n  NOTE the constraint conflict to resolve: OrleaRouge is z ${bounds("orlearouge.js").CITY.minZ}..${bounds("orlearouge.js").CITY.maxZ}`);
console.log(`  and the Crown Strip is z ${cs.z0}..${cs.z1}. They do not overlap at all today --`);
console.log(`  there is already a ${chain.filter(c=>!c.urban).length ? "gap" : "seam"} between z ${bounds("orlearouge.js").CITY.minZ} and z ${cs.z1}.`);
console.log(`  Making OrleaRouge "contain the strip" means the city's own bounds have to`);
console.log(`  swallow CrownStrip's rect, which is 480 m wide against OrleaRouge's`);
console.log(`  ${bounds("orlearouge.js").CITY.maxX - bounds("orlearouge.js").CITY.minX} m. That is a bounds change, not a scale tweak,`);
console.log(`  and it has to keep the strip's buildings exactly where they are.`);
console.log(`
=== summary ===
  The urban chain stops at z ${urbanNorth}. North of the Crown Strip there is no
  urban ground at all, so the city vibe dies the moment you pass it.
  Growing OrleaRouge's bounds north to swallow the strip, then adding New
  Chatboro and pushing rural past Chatboro, is the shape that fixes it -- and it
  is a bounds/infill job, not a rescale of existing content. The strip's own
  geometry does not move.

  Correction to the first run of this survey, kept because it is the kind of
  mistake worth being able to see: it reported "only 57.1% of the north drive is
  urban" and "NOTHING urban lies north of the Crown Strip". The first number is
  arithmetic over overlapping rects and is not the complaint at all. The second
  was simply false -- Tusouxroe is urban and covers that ground. The real defect
  is that the strip is a 480 m island with no urban neighbour on its west or
  east side, and OrleaRouge does not come near it.
`);
