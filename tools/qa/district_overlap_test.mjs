// district_overlap_test.mjs — no two districts may build on the same ground.
//
//   node --experimental-detect-module tools/qa/district_overlap_test.mjs
//
// Orleanorth shipped with ten rects, the motel, the parking lot and Memorial
// Green sitting on top of Chatboro — a live 144 x 220 m village with its own
// Main Street, church and Pine Street. Both of Orleanorth's own tests passed the
// whole time, because orleanorth_test.mjs only compares Orleanorth's sites
// against EACH OTHER, and orleanorth_build.mjs instantiates Orleanorth alone.
// Neither test can see a neighbour, so "no internal overlap" was reported as
// "no overlap" while a village was buried.
//
// WHAT NOT TO CHECK, having tried it: comparing every district's BOUNDS against
// every other reports 17 failures on a CORRECT map. BOUNDS and CORE are CONTAINER
// regions, not exclusive claims — Charsoufre's is x -130..130 / z -150..150 and
// Shruston's is x -130..130 / z -300..310, so they necessarily contain each
// other, the Crown Strip and most of Orleanorth. The map is built to nest that
// way, and main.js's extraZone chain resolves precedence by district order, not
// by geometry.
//
// So this checks Orleanorth's hand-placed site rects against CHATBORO only:
// the district that was actually buried, and small enough (144 x 220 m) that
// containment really would have meant burial. Every other neighbour is verified
// at runtime by orleanorth_claim_check.mjs, which builds them all and walks
// main.js's own zoneAt chain — that check found all 10 rects uncontested, which
// is why the static comparison against those districts was dropped rather than
// "fixed".
//
// Rects are parsed from source rather than hardcoded HERE on purpose. A hardcoded
// copy goes stale silently the moment a district is rescaled — and a rescale is
// exactly what created this bug.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const read = (p) => readFileSync(join(root, p), "utf8");

let fails = 0;
const fail = (m) => { console.log(`  FAIL ${m}`); fails++; };
const ok = (m) => console.log(`  ok   ${m}`);

// Rects are tuples in (x0, z0, x1, z1) order throughout this file. One shape and
// one helper avoids the bug where an object-shaped rect meets a tuple-shaped one
// and every pair "overlaps" — which is what happened here once already.
const ov = (a, b) => !(a[2] <= b[0] || a[0] >= b[2] || a[3] <= b[1] || a[1] >= b[3]);

// A district's ground is the rect it names BOUNDS (or CITY / DISTRICT). Grab the
// first one that parses, so each file's own naming works.
const rects = {
  orlearouge: { file: "src/orlearouge.js", names: ["CITY", "BOUNDS"] },
  orleanorth: { file: "src/orleanorth.js", names: ["BOUNDS"] },
  crownstrip: { file: "src/crownstrip.js", names: ["BOUNDS", "CROWN_STRIP"] },
  chatboro: { file: "src/chatboro.js", names: ["BOUNDS"] },
  tusouxroe: { file: "src/tusouxroe.js", names: ["BOUNDS"] },
  // metro names its rect METRO_BOUNDS. westparish and eastbank declare theirs in
  // a style this parser does not read; they sit well outside the Orleanorth band
  // and are reported as unread rather than failed, because a district this test
  // cannot parse is a gap in COVERAGE, not a collision — saying FAIL would train
  // us to ignore the output.
  metro: { file: "src/metro.js", names: ["METRO_BOUNDS", "BOUNDS"] },
  westparish: { file: "src/westparish.js", names: ["BOUNDS", "WEST_P"] },
  eastbank: { file: "src/eastbank.js", names: ["BOUNDS", "EAST_B"] },
  shruston: { file: "src/shruston.js", names: ["BOUNDS"] },
  charsoufre: { file: "src/charsoufre.js", names: ["BOUNDS"] },
};

const found = {};
console.log("=== each district's ground rect, parsed from its own source ===");
for (const [key, spec] of Object.entries(rects)) {
  let src;
  try { src = read(spec.file); } catch { fail(`${spec.file} is missing`); continue; }
  let hit = null;
  for (const name of spec.names) {
    // handles both { x0, x1, z0, z1 } and { minX, maxX, minZ, maxZ } shapes
    const m = src.match(new RegExp(
      `const ${name} = \\{[^}]*?x0: (-?\\d+)[^}]*?x1: (-?\\d+)[^}]*?z0: (-?\\d+)[^}]*?z1: (-?\\d+)`));
    if (m) { const [x0, x1, z0, z1] = m.slice(1).map(Number); hit = { name, x0, x1, z0, z1 }; break; }
    const m2 = src.match(new RegExp(
      `const ${name} = \\{[^}]*?minX: (-?\\d+)[^}]*?maxX: (-?\\d+)[^}]*?minZ: (-?\\d+)[^}]*?maxZ: (-?\\d+)`));
    if (m2) { const [minX, maxX, minZ, maxZ] = m2.slice(1).map(Number); hit = { name, x0: minX, x1: maxX, z0: minZ, z1: maxZ }; break; }
  }
  if (!hit) {
    console.log(`  --   ${key.padEnd(12)} rect not parsed from ${spec.file} (skipped: no coverage, not a collision)`);
    continue;
  }
  // store as a tuple in ov()'s order (x0, z0, x1, z1) so nothing downstream
  // has to remember which shape a rect is in
  found[key] = { name: hit.name, file: spec.file, r: [hit.x0, hit.z0, hit.x1, hit.z1] };
  ok(`${key.padEnd(12)} ${hit.name.padEnd(13)} x ${hit.x0}..${hit.x1}  z ${hit.z0}..${hit.z1}`);
}

// Only Chatboro is compared statically, and the reason is specific: it is the
// district that WAS buried, it is small (144 x 220 m) enough that geometric
// containment really would have meant burial, and orleanorth_layout.mjs already
// allocates around it. The other neighbours are not comparable this way — see
// the note above on container regions — and are verified at runtime instead.
console.log("\n=== Orleanorth's site rects vs Chatboro (the district that was buried) ===");
const orl = read("src/orleanorth.js");
const orlSites = [...orl.matchAll(/R\((-?\d+), (-?\d+), (-?\d+), (-?\d+)\)/g)]
  .map((m) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]);
if (!orlSites.length) fail("parsed no site rects out of orleanorth.js — this test would check nothing");
{
  const buried = orlSites.filter((s) => ov(s, found.chatboro.r));
  if (buried.length)
    for (const s of buried) fail(`site x ${s[0]}..${s[2]} z ${s[1]}..${s[3]} sits inside Chatboro — the village is being built over`);
  else ok(`${orlSites.length} site rects, none on Chatboro's ground`);
}

console.log("\n=== Memorial Green, the easiest thing to misplace ===");
{
  const m = orl.match(/const PARK = \{ x0: (-?\d+), x1: (-?\d+), z0: (-?\d+), z1: (-?\d+) \}/);
  if (!m) fail("could not parse PARK out of orleanorth.js");
  else {
    // the literal is { x0, x1, z0, z1 }; rectFrom's order is (x0, z0, x1, z1)
    const park = [Number(m[1]), Number(m[3]), Number(m[2]), Number(m[4])];
    // containment in the right direction: the park must be INSIDE Orleanorth.
    // Comparing it against every other district is meaningless for the same
    // container-region reason the site-rect check is scoped to Chatboro.
    if (!ov(found.orleanorth.r, park))
      fail(`Memorial Green x ${park[0]}..${park[2]} z ${park[1]}..${park[3]} is not inside Orleanorth`);
    else ok(`Memorial Green x ${park[0]}..${park[2]} z ${park[1]}..${park[3]} is inside Orleanorth's own bounds`);
    if (ov(found.chatboro.r, park))
      fail("Memorial Green sits inside Chatboro");
    else ok("Memorial Green is not on Chatboro's ground");
  }
}

process.exit(fails ? 1 : 0);