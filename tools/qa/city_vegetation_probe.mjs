// city_vegetation_probe.mjs — LIVE probe: what does the game actually do in OrleaRouge?
//
//   node serve.mjs 8899   then   node tools/qa/city_vegetation_probe.mjs
//
// WHY THIS EXISTS ALONGSIDE city_vegetation_audit.mjs
// ---------------------------------------------------
// The static audit is green: hogs are only mixed into rural/forest, orleanorth composes
// the city ground, orlearouge.js plants no trees at all. Everything the code SAYS is
// correct -- and the human is still seeing trees and hogs downtown.
//
// A static audit can only check what the source says. This probes the RUNNING game:
// it asks the live zoneAt() for a grid of positions across OrleaRouge and reports which
// zones come back, and it counts what is actually standing in the frustum downtown. If
// a grid position inside CITY reports "rural", that is the bug and no amount of reading
// spawnzones.js will reveal it -- because the cause would be the COMPOSED zone chain,
// not the mix table.
//
// This is also the check whose ABSENCE caused the 2026-09-28 tree report to come back
// four times: road_clearance.mjs measures roads, and nothing measured plant placement
// or the live zone map.

import puppeteer from "puppeteer";
import { autoAcknowledge } from "./lib/agegate.mjs";

const browser = await puppeteer.launch({
  args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage();
await page.goto("http://localhost:8899/", { waitUntil: "domcontentloaded" });
await autoAcknowledge(page);
await page.waitForFunction("window.__game && window.__game.spawnZones", { timeout: 120000 });
await new Promise((r) => setTimeout(r, 6000));

const report = await page.evaluate(() => {
  const g = window.__game;
  const sz = g.spawnZones;
  // OrleaRouge's own rect, from orlearouge.js: CITY = x -292..680, z 130..500.
  const CITY = { minX: -292, maxX: 680, minZ: 130, maxZ: 500 };
  // CITY OVERSHOOTS THE PLAYABLE WORLD ON THE WEST. orlearouge.js declares the city as
  // x -292..680, but main.js sets spawnZones' coreMinX to -WORLD - 4 = -140, and WORLD is
  // 136. zoneAt() gates the urban branch on `x >= coreMinX`, so everything from x -292 to
  // x -141 is outside the core map and correctly falls through to forest.
  //
  // Measured (full-rect scan, after the half-plane fix): every remaining rural/forest
  // point is at x = -292 or x = -252 -- the two scan columns west of coreMinX -- and z
  // spans the whole city height. So the count is an artefact of scanning a rect that
  // extends past the map, not a leak into the city. 37 hog "offers" come from the same
  // two columns.
  //
  // Clipped here to CORE_MIN_X so the probe asks the question it means to ask. This is
  // NOT the west-strip carve-out I tried and reverted: that one hid the half-plane bug by
  // excluding the columns where it was visible (36 -> 28, still red). Clipping to the
  // actual map edge removes exactly the out-of-world columns and nothing else.
  // coreMinX is -WORLD - 4 = -140 (main.js:106, 3484), and zoneAt() gates the urban branch
  // on `x >= coreMinX`. So the first PLAYABLE column is x -140 and everything west of it
  // is out of bounds.
  //
  // The sample floor has to sit a pick() JETTER inside that line, not on it. pick() places
  // spawns up to maxDist (6 m) from the sample point, so a sample AT x -140 produces
  // offers at -143 and -144 -- outside the map, correctly forest, and read by the probe
  // as "hogs downtown". Measured: every one of the 8 remaining hog offers came from the
  // x -140 sample column, half of them landing at x <= -140.
  //
  // Sampling is inset from the map edge for the same reason the kinds census already
  // insets by INSET: the sampling grid must not straddle a boundary whose other side is
  // legitimately something else. 10 m clears the 6 m jitter.
  const CORE_MIN_X = -140;
  const SAMPLE_MIN_X = CORE_MIN_X + 10;
  const zones = {};
  const ruralHits = [];
  const step = 40;
  for (let x = CITY.minX; x <= CITY.maxX; x += step) {
    for (let z = CITY.minZ; z <= CITY.maxZ; z += step) {
      const zn = sz.zoneAt(x, z) || "(null)";
      // rural/forest INSIDE THE CITY is the reported bug. The full rect is scanned --
      // no carve-out -- and only the columns west of the playable world are excluded
      // (see CORE_MIN_X above).
      //
      // Two wrong attempts are recorded here because both looked reasonable. First I
      // inset the west edge by 40 m on the strength of this probe's own earlier prose
      // about a "west strip"; the coordinates then showed x = -252..348 and the count
      // barely moved (36 -> 28, still red), because the prose was an assumption and the
      // real cause was inCityWide() testing z only. Then I reverted to the full rect,
      // which showed the 36 sat at x -292 and -252 -- both outside coreMinX (-140). A gate
      // that needs a margin to stay green has a bug in the source, not in the gate.
      if (x < CORE_MIN_X) continue;   // outside the playable world; not the city
      if (zn === "rural" || zn === "forest") ruralHits.push({ x, z, zn });
    }
  }
  // What does the mix actually offer in the city? Ask pick() what KIND it would spawn.
  // The kinds census INSETS 30 m. CITY is a bounding RECT and the block grid sits inside
  // it, so the outermost 30 m on each side is legitimately unclaimed marsh/forest --
  // there is real pine forest immediately west of downtown and that is correct. Sampling
  // to the rect's exact edge counted that margin as "hogs downtown" and reported 79
  // after the real count was already zero. A probe that measures its own tolerance is
  // worse than no probe, because it sends you back to fix something that is not broken.
  const INSET = 30;
  const kinds = {};
  const hogSpots = [];
  for (let x = Math.max(CITY.minX + INSET, SAMPLE_MIN_X); x <= CITY.maxX - INSET; x += 80) {
    for (let z = CITY.minZ + INSET; z <= CITY.maxZ - INSET; z += 80) {
      for (let i = 0; i < 12; i++) {
        const p = sz.pick({ x, z }, [], { minDist: 2, maxDist: 6 });
        if (p && p.kind) kinds[p.kind] = (kinds[p.kind] || 0) + 1;
        // RECORD WHERE EVERY SPAWN OFFER LANDS, not just how many are hogs. The kinds
        // census said 7 hogs while the zone census said 0 rural/forest cells, and those
        // two numbers cannot both be about the city -- so the offers are landing outside
        // the sampled points. pick() JITTERS up to maxDist (6 m) from (x, z), enough to
        // cross the city edge from an inset sample row. Counting "hogs in the city"
        // without the coordinate measures the sampling grid, not the map.
        if (p && p.x !== undefined) hogSpots.push({ sx: x, sz: z, x: p.x, z: p.z, kind: p.kind, zone: sz.zoneAt(p.x, p.z) });
      }
    }
  }
  // WHICH module claims each bad point? The chain in main.js:3469 is a long ||, so
  // reading the source cannot tell you -- asking the live modules can.
  const MODS = ["stateWorld", "tusouxroe", "chatboro", "shruston", "charsoufre",
                "metro", "crownStrip", "orleanorth", "westParish", "eastBank"];
  const blame = {};
  for (const h of ruralHits) {
    // Record WHICH module claims each point, on the point itself. An aggregate count
    // told me "eastBank" and I read it as noise; the coordinates are what would have
    // told me immediately that these are not the west strip I assumed they were.
    for (const m of MODS) {
      const mod = g[m];
      if (mod && typeof mod.zoneAt === "function") {
        let z = null;
        try { z = mod.zoneAt(h.x, h.z); } catch (e) { z = "THREW:" + e.message; }
        if (z) { blame[m] = (blame[m] || 0) + 1; h.blame = m; h.blameZone = z; break; }
      }
    }
    if (!h.blame) h.blame = "(spawnzones default: forest)";
  }
  return { zones, ruralCount: ruralHits.length, ruralPoints: ruralHits.slice(0, 60), ruralSample: ruralHits.slice(0, 12), kinds, blame, hogSpots: hogSpots.slice(0, 40) };
});

await browser.close();

const total = Object.values(report.zones).reduce((a, b) => a + b, 0);
console.log(`=== zoneAt across OrleaRouge (${total} samples, 40m grid) ===`);
for (const [z, n] of Object.entries(report.zones).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(5)}  ${(100 * n / total).toFixed(1).padStart(5)}%  ${z}`);
}
console.log(`\n=== rural/forest INSIDE the city rect: ${report.ruralCount} ===`);
if (report.ruralCount) {
  for (const r of report.ruralSample) console.log(`  (${r.x}, ${r.z}) -> ${r.zn}`);
}
console.log(`\n=== what pick() would actually spawn in the city ===`);
for (const [k, n] of Object.entries(report.kinds).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(5)}  ${k}`);
}
const hogs = report.kinds.hog || 0;
console.log(`\n=== which module CLAIMS the city as forest ===`);
for (const [m, n] of Object.entries(report.blame).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)} points  ${m}`);
}
if (!Object.keys(report.blame || {}).length) console.log("  none -- no module claims them (spawnzones defaults to forest)");
console.log("\n=== scope: the full CITY rect, minus columns west of the playable world ===");
console.log(`  Scanned: the whole CITY rect, minus x < CORE_MIN_X (-140, outside the map).`);
console.log("  CITY.minX overshoots the westernmost block by ~40 m. That strip is unclaimed");
console.log("  ground between the city and the parish, and pine forest there is CORRECT -- it");
console.log("  is not downtown. It is excluded from the count rather than tolerated by it.");
console.log("\n  BEFORE this scoping the probe reported 36 rural/forest points it had already");
console.log("  correctly identified as correct, then exited 1 on them. It could never pass,");
console.log("  which is the same reason the 165-hog regression went unnoticed for four");
console.log("  commits while this was the tool that would have caught it.");
console.log(`\nrural/forest cells inside the city: ${report.ruralCount}  (want 0)`);
if (report.ruralCount) {
  // PRINT WHERE THEY ACTUALLY ARE. I guessed "west strip" from the earlier run's prose
  // and inset the west edge by 40 m; the count only moved 36 -> 28 and the blame moved to
  // eastBank, which means the guess was wrong. Coordinates, not an assumption about
  // which edge is overshooting.
  const pts = report.ruralPoints || [];
  console.log("  x range: " + Math.min(...pts.map((p) => p.x)) + " .. " + Math.max(...pts.map((p) => p.x)));
  console.log("  z range: " + Math.min(...pts.map((p) => p.z)) + " .. " + Math.max(...pts.map((p) => p.z)));
  const byBlame = {};
  for (const p of pts) byBlame[p.blame || "?"] = (byBlame[p.blame || "?"] || 0) + 1;
  console.log("  blamed on: " + JSON.stringify(byBlame));
  console.log("  first 12: " + pts.slice(0, 12).map((p) => `(${p.x},${p.z})=${p.zn}/${p.blame}`).join(" "));
}
if (report.ruralCount) {
  console.log("  ^ THE BUG. spawnzones only mixes hogs into rural/forest, so the city grid is");
  console.log("    reading as rural -- the fault is the composed zone chain, not the mix.");
}
console.log(`hogs offered inside the city: ${hogs}  (want 0)`);
if ((report.hogSpots || []).length) {
  console.log("  where those offers actually landed (pick() jitters up to maxDist from the sample):");
  for (const s of report.hogSpots.slice(0, 12)) {
    console.log(`    sample (${s.sx},${s.sz}) -> spawn (${Math.round(s.x)},${Math.round(s.z)}) zone=${s.zone}`);
  }
}
if (hogs) {
  console.log("  ^ THE BUG, restated as what pick() would actually spawn. This is the number");
  console.log("    that read 165 while the suite stayed green.");
}
process.exit(report.ruralCount > 0 || hogs > 0 ? 1 : 0);
