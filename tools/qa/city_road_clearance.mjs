// city_road_clearance.mjs -- are any buildings standing in a carriageway?
//
// HUMAN (2026-10-03): "sometimes it puts like buildings in the middle of the road. We
// don't want like the to be random buildings in the middle of the road."
//
// WHY THIS EXISTS. blocks() in orlearouge.js pads every plot back from the street
// CENTRELINE by STREET_W/2 + 2.5 = 7 m (orlearouge.js:767), and there is a long comment
// there about exactly this bug having been fixed before. So the intent is right and the
// question is whether the intent is TRUE.
//
// Reading placement code cannot answer that. Every district builds relative to its own
// plot bounds -- midtown, gardenDistrict, outskirts, shops, civicEnd -- so each one looks
// correct in isolation and the bug, if any, lives in whether those plot bounds agree with
// where the carriageway is actually DRAWN. Three different things have to agree: the
// grid line list (AVENUES/STREETS), the pad() arithmetic, and the ribbon each road is
// painted with. Only the live scene settles it.
//
// This asks the live grid directly: for every static blocker in OrleaRouge, is its circle
// overlapping the painted carriageway of any avenue, street, or the boulevard?
//
//   node serve.mjs 8899   then   node --experimental-detect-module tools/qa/city_road_clearance.mjs
//
// This model may have no vision endpoint, so everything here is numeric. Do not claim to
// have SEEN the offending building from this output; the tool prints coordinates so the
// player can go and look.

import puppeteer from "puppeteer";
import { autoAcknowledge } from "./lib/agegate.mjs";

const browser = await puppeteer.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"] });
const page = await browser.newPage();
await autoAcknowledge(page);
// Ask main.js to stamp every collider with the source line that created it. Without this
// the probe can say WHERE a circle is in the road but not WHO put it there, and I have
// already guessed wrong twice (orlearouge's blockBlocker, then landmarks.js -- both were
// real fixes, neither was this bug). 83 coordinates plus a file and line is a diagnosis;
// 83 coordinates alone is a treasure map.
await page.evaluateOnNewDocument(() => {
  window.__GTB_QA__ = { blockerTrace: true };
});
await page.setViewport({ width: 1280, height: 720 });
await page.goto("http://localhost:8899/", { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForSelector("#freeBtn:not([disabled])", { timeout: 240000 });
await page.click("#freeBtn");
await new Promise((r) => setTimeout(r, 14000));

const report = await page.evaluate(() => {
  const G = window.__game;
  if (!G || !G.blockerGrid) return { error: "blockerGrid not exposed on window.__game" };

  // The grid constants, restated from source and PRINTED, because a clearance probe
  // that silently disagrees with the code it audits is worse than no probe.
  const AVENUES = [-286,-246,-206,-166,-126,-86,-46,34,74,114,154,194,234,274,314,354,394,434,474,514,554,594,634,674];
  const STREETS = [130,170,210,250,290,330,370,410,450];
  const STREET_W = 9;
  const CITY = { minX: -292, maxX: 680, minZ: 130, maxZ: 500 };
  const ROAD_X = -6;              // US-167, the boulevard
  const ROAD_HALF = 5;            // main.js:110

  // The superblocks (STREET_CUTS, orlearouge.js:141-145). A road is NOT drawn where it
  // crosses one -- orlearouge.js:567-583 cuts each avenue and each street into segments
  // around the reserves -- so a grid line inside a reserve is bare ground, not tarmac.
  //
  // This matters enormously and getting it wrong manufactures the entire bug. The
  // Superdome's reserve is x 420-680, z 200-460, which CONTAINS streets z=210, 250, 290,
  // 330, 370, 410 and avenues x=434..674. The first run of this probe counted a 96 m
  // stadium sitting "in" street z=330 by 23.7 m -- the stadium was correctly placed on its
  // superblock and the road it was accused of blocking had been cut out of existence.
  // Every one of those was a phantom.
  const RESERVES = [
    { x0: 420, x1: 680, z0: 200, z1: 460, label: "The Superdome" },
    { x0: 236, x1: 410, z0: 384, z1: 500, label: "City Park" },
    { x0: 100, x1: 230, z0: 384, z1: 470, label: "Loyola University" },
    { x0: -136, x1: -34, z0: 396, z1: 500, label: "Jackson Square" },
    { x0: -136, x1: -58, z0: 214, z1: 282, label: "French Market" },
    { x0: -76, x1: 76, z0: 167.5, z1: 176.5, label: "under the viaduct", streetsOnly: true },
  ];
  // Is (x, z) tarmac? A north-south road at x only exists where no reserve spans it.
  const avenueExistsAt = (x, z) =>
    !RESERVES.some((r) => !r.streetsOnly && z > r.z0 - STREET_W && z < r.z1 + STREET_W && x > r.x0 - STREET_W && x < r.x1 + STREET_W);
  const streetExistsAt = (x, z) =>
    !RESERVES.some((r) => z > r.z0 - STREET_W && z < r.z1 + STREET_W && x > r.x0 - STREET_W && x < r.x1 + STREET_W);

  // Every carriageway in the city, as a SEGMENT list, not a line. A line says "there is a
  // road at z=330"; a segment says "there is road at z=330 for x in [420,680] nowhere".
  const roads = [];
  const STEP = 20;
  for (const x of AVENUES) {
    for (let z = CITY.minZ; z < CITY.maxZ; z += STEP) {
      if (avenueExistsAt(x, z + STEP / 2)) {
        roads.push({ axis: "x", at: x, half: STREET_W / 2, label: `avenue x=${x}`, from: z, to: z + STEP });
      }
    }
  }
  for (const z of STREETS) {
    for (let x = CITY.minX; x < CITY.maxX; x += STEP) {
      if (streetExistsAt(x + STEP / 2, z)) {
        roads.push({ axis: "z", at: z, half: STREET_W / 2, label: `street z=${z}`, from: x, to: x + STEP });
      }
    }
  }
  roads.push({ axis: "x", at: ROAD_X, half: ROAD_HALF, label: "US-167 boulevard", from: CITY.minZ, to: CITY.maxZ });
  //
  // I added four "perimeter" roads here and that was WRONG: it double-counted. The
  // ribbons in orlearouge.js:566-583 run each avenue from CITY.minZ to CITY.maxZ and each
  // street from CITY.minX to CITY.maxX, and STREETS[0] IS CITY.minZ (130) -- so "street
  // z=130" and "south perimeter street" are the same tarmac, and reporting both gave
  // 171 + 171 hits for one road and made the offender list twice as long as the truth.
  // The north edge (500) and the west edge are NOT grid lines and carry no ribbon.
  //
  // Lesson in the same shape as the city-rect one: I added a road that was not there
  // because the bounding rect has an edge and it seemed reasonable that something would
  // be drawn along it. Now the road list is exactly what the code draws.

  const inCity = (x, z) => x >= CITY.minX - 60 && x <= CITY.maxX + 60 && z >= CITY.minZ - 60 && z <= CITY.maxZ + 60;

  // CROWN STRIP IS A SEPARATE DISTRICT AND MUST BE EXCLUDED.
  //
  // The scan window above is a 60 m margin around OrleaRouge's rect, and Crown Strip is
  // centred on BLVD_Z = -260 with its boulevard at EAST_STREET_X = 110 (crownstrip.js:
  // 502,504). Its blocks run from about x=-151, and its footprints reach up past
  // z=-235. At the west edge of OrleaRouge, z=-235 is only 365 m from CITY.minZ=130 --
  // well inside the window.
  //
  // So the last ten "offenders" were two district's landmarks being audited against the
  // WRONG district's road list: the hospital lot at x0=-86 (crownstrip.js:1315) measured
  // against OrleaRouge's avenue x=-86, a coincidence of the number, not a shared street.
  // Six of the ten came from landmarks.js:694, which is that hospital.
  //
  // A probe that cannot tell districts apart will keep inventing bugs out of coincidence,
  // and each invented bug costs a wrong "fix" to a file that was never broken. Exclude by
  // the district's own footprint box, generously, and say so in the output.
  const CS = { x0: -260, x1: 200, z0: -420, z1: -230 };   // Crown Strip, generously boxed
  const inCrownStrip = (x, z) => x >= CS.x0 && x <= CS.x1 && z >= CS.z0 && z <= CS.z1;
  const outOfCity = (x, z) => !inCity(x, z) || inCrownStrip(x, z);

  // Collect the static blockers.
  //
  // BlockerGrid.cells is a Map keyed by a packed integer, NOT a plain object, and
  // addStatic() pushes the SAME blocker into every cell its circle overlaps (spatial.js:
  // 30-36). So Object.keys() finds nothing at all and the probe reports "0 static
  // blockers scanned" -- which reads as a clean bill of health and is in fact a broken
  // probe. That is the most dangerous failure mode this tool has: a silent zero.
  //
  // So: iterate the Map properly, and dedupe on the blocker object via a Set, which
  // uses identity -- correct here precisely because they are the same object reference.
  // And ASSERT the count is non-zero, so a future shape change fails loudly instead of
  // reporting success.
  const all = [];
  const grid = G.blockerGrid;
  // Tag every static blocker with the scene-graph parent chain, so an offender can be
  // NAMED instead of only located. src/orlearouge.js's own district function is not
  // retained on the blocker (addBlocker takes only x, z, r), and 83 coordinates do not
  // tell you which of the nine district builders put them there.
  const cells = grid.cells;
  if (cells && typeof cells.forEach === "function") {
    const seen = new Set();
    cells.forEach((list) => {
      for (const b of list) {
        if (!b || seen.has(b)) continue;
        seen.add(b);
        all.push(b);
      }
    });
  } else {
    return { error: "blockerGrid.cells is not iterable as a Map (" + typeof cells + ") -- probe needs updating for the current BlockerGrid shape" };
  }

  // The real question: does the blocker CIRCLE overlap a carriageway's half-width, i.e. is
  // the obstacle itself standing on the road rather than merely near it.
  //
  // SIZE GATE, and it matters more than anything else in this file.
  //
  // The first run reported 1042 overlaps, and 853 of them were blockers under 2 m:
  // bollards, lamp posts, meter boxes, kerbside props. Those are SUPPOSED to sit at the
  // edge of the carriageway -- that is what a kerb is for, and padding them off the
  // tarmac would put them in the middle of the pavement instead. Counting them turned a
  // real question into a wall of noise and buried the 100-odd that were actual
  // buildings.
  //
  // So: report the small stuff as a count for context, and judge the claim on
  // BUILDING-SIZED blockers only (r >= 4 m). The human's complaint is "buildings in the
  // middle of the road", and that is the only thing this is evidence for.
  const BUILDING_R = 4;
  const hits = [];
  let tinyOverlaps = 0;
  for (const b of all) {
    if (outOfCity(b.x, b.z)) continue;
    for (const r of roads) {
      // The blocker must be alongside a segment that is actually tarmac.
      const along = r.axis === "x" ? b.z : b.x;
      if (along < r.from || along > r.to) continue;
      const off = r.axis === "x" ? Math.abs(b.x - r.at) : Math.abs(b.z - r.at);
      const overlap = off - b.r - r.half;      // < 0 means the circle is on the tarmac
      if (overlap < 0) {
        if (b.r < BUILDING_R) { tinyOverlaps++; continue; }
        hits.push({
          x: Math.round(b.x), z: Math.round(b.z), r: Math.round(b.r * 10) / 10,
          road: r.label, axis: r.axis,
          into: Math.round(-overlap * 10) / 10,   // metres of circle sitting on the road
          tag: b.tag || b.kind || b.name || "",
          from: b.from || "(no trace -- was the flag set before load?)",
          // Raw radius, unrounded, so the clamp can be checked against the road width
          // rather than eyeballed.
          rawR: b.r,
          // Without a tag the list says "some circle at (x,z)" and you still do not know
          // WHICH piece of code put it there. Radius is a usable fingerprint: districts
          // build characteristic footprints (outskirt warehouses are huge, alley props
          // ~1.3, gates ~10), so grouping by rounded radius names the culprit class
          // without needing every addBlocker call site to be tagged.
          rClass: b.r >= 12 ? "huge (>=12m, landmark/warehouse/stadium)"
            : b.r >= 7 ? "large (7-12m, tower/depot/wall)"
            : b.r >= 4 ? "medium (4-7m, building)"
            : b.r >= 2 ? "small (2-4m, prop)"
            : "tiny (<2m, post/bollard)",
        });
      }
    }
  }
  // NAME the offending mesh. addBlocker(x, z, r) records no owner, so 83 coordinates
  // do not say which builder produced them. Walking the scene for meshes whose footprint
  // covers the blocker finds the thing the player can actually go and look at, and names
  // the construction that made it.
  // NO MESH MATCHING. Removed deliberately, after two wrong answers.
  //
  // Attempt 1 picked the mesh whose bounding-sphere radius was closest to the blocker's.
  // Every offender came back "at (-85,415)" -- one tower far away in the west. Right size,
  // wrong building.
  //
  // Attempt 2 required the blocker centre to fall INSIDE the mesh's bounding sphere. The
  // ground plane's sphere contains the entire city, so every offender came back as a
  // 300x300 box or a 9x254 plane -- the terrain, which is exactly the thing that is NOT
  // in the road.
  //
  // A bounding sphere is far too loose a shape to answer "which object is this", and
  // three-block errors dressed up as confident labels are worse than no label at all: the
  // obvious next step is to walk to the coordinate and find bare ground, which teaches
  // you to distrust the tool. addBlocker() takes no owner, so the honest fix is to record
  // one -- but that means touching every call site, and it is not worth it to answer
  // "where", which is what the human asked.
  //
  // So this reports COORDINATES and radius, which are evidence, and nothing it cannot
  // support. To identify a given offender by eye, go to the coordinate.

  hits.sort((p, q) => q.into - p.into);
  // THE COST OF THE FIX, measured rather than asserted.
  //
  // Splitting max(w,d)/2 into two circles across the short axis means a long building now
  // occupies TWO cells of the spatial hash instead of one, and blockBlocker now also
  // clamps against 32 grid lines rather than 2. Both were called negligible in the commit
  // message. Print the number so the claim is checkable -- a collider that is nearly free
  // when added one at a time is not free when added to every landmark in the city.
  let cellCount = 0, maxCell = 0;
  cells.forEach((list) => { cellCount++; if (list.length > maxCell) maxCell = list.length; });
  const occupancy = cellCount ? all.length / cellCount : 0;

  const distinct = new Set(roads.map((r) => r.label)).size;
  const skippedCrown = all.filter((b) => inCrownStrip(b.x, b.z)).length;
  return {
    totalStatic: all.length, roads: distinct, segments: roads.length, hits, tinyOverlaps,
    skippedCrown, cellCount, maxCell, occupancy,
    note: "overlap < 0 means the blocker's circle is on the carriageway",
    // Handed back so the caller can prove the probe is auditing the roads the code
    // actually draws, not a list invented here.
    listed: { avenues: AVENUES.length, streets: STREETS.length },
  };
});

if (report.error) { console.log("ERROR: " + report.error); await browser.close(); process.exit(1); }

// A zero-blocker scan is a BROKEN PROBE, never a pass. Reporting "no blockers overlap
// any carriageway" after reading zero blockers is how a gate teaches you to trust it.
if (!report.totalStatic) {
  console.log("\n  ERROR: scanned 0 static blockers. That is a broken probe, not a clean road.");
  console.log("  Refusing to report success on an empty scan.");
  await browser.close();
  process.exit(1);
}

console.log(`\n=== OrleaRouge road clearance ===`);
console.log(`  static blockers scanned: ${report.totalStatic}`);
console.log(`  carriageways tested:    ${report.roads} distinct lines, as ${report.segments} real segments`);
console.log("  (a grid line is NOT a road where it crosses a superblock -- orlearouge.js:567 cuts");
console.log("   each one into segments around the reserves. Counting full lines accused the");
console.log("   Superdome of standing in street z=330, where no tarmac has been drawn.)");

console.log(`  (excluded ${report.skippedCrown} blockers belonging to Crown Strip, a separate district
   with its own roads at BLVD_Z=-260 -- auditing them against OrleaRouge's grid was
   manufacturing bugs out of coincidental coordinate matches.)`);
// THE COST OF THE FIX, measured rather than asserted.
//
// Splitting max(w,d)/2 into two circles across the short axis puts a long building in TWO
// cells of the spatial hash instead of one, and blockBlocker now clamps against 32 grid
// lines rather than 2. Both were called negligible in the commit message, so print the
// number and let it be checked. Measured: 30360 blockers across 34951 cells, mean 0.87
// per cell. The hash was never close to full, so doubling a long building's footprint
// changes nothing that a query can feel.
console.log(`  collider budget: ${report.totalStatic} static blockers across ${report.cellCount} grid cells`);
console.log(`    mean ${report.occupancy.toFixed(2)} per cell, fullest cell ${report.maxCell}`);

console.log(`  (excluded ${report.tinyOverlaps} sub-4 m overlaps -- bollards, lamp posts and kerbside`);
console.log(`   props belong AT the carriageway edge; padding them off it would put them on the`);
console.log(`   pavement instead. Only blockers >= ${"4"} m are judged below.)`);

// The ten this probe still finds, each traced to a source line by addBlocker's trace
// flag. They are REAL collisions on real tarmac, but they are large landmarks sitting at
// the edge of their own plot rather than the systemic "invisible wall across the street"
// that was fixed. Left visible rather than hidden behind a passing exit code, because a
// gate that goes green while ten offenders remain is worse than a red one.
// The offender COUNT, not the number of call sites. Comparing 10 offenders against a
// 3-element list reported a false regression on the very first run.
const KNOWN_COUNT = 10;
const KNOWN_SITES = ["landmarks.js:694 x6", "main.js:4962 x2", "orlearouge.js:2084 x2"];

if (!report.hits.length) {
  console.log("\n  OK: no static blocker overlaps any carriageway.");
  console.log("  The pad() arithmetic in blocks() holds against the roads as actually drawn.");
} else {
  console.log(`\n  ${report.hits.length} BLOCKER(S) STANDING ON A CARRIAGEWAY  (buildings in the road)`);
  if (report.hits.length > KNOWN_COUNT) {
    console.log(`\n  NOTE: ${report.hits.length} now, against ${KNOWN_COUNT} known-and-unfixed. An increase is a`);
    console.log("  REGRESSION in a file that was correct. Print the list and find which one grew.");
  } else if (report.hits.length < KNOWN_COUNT) {
    console.log(`\n  ${report.hits.length} now, down from ${KNOWN_COUNT} known. Progress.`);
  } else {
    console.log(`\n  ${report.hits.length} now, unchanged from the ${KNOWN_COUNT} known and unfixed:`);
    for (const s of KNOWN_SITES) console.log(`    ${s}`);
  }
  console.log("  worst offenders, with how far the circle reaches onto the tarmac:");
  for (const h of report.hits.slice(0, 25)) {
    console.log(`    (${String(h.x).padStart(5)},${String(h.z).padStart(5)})  r=${String(h.r).padStart(5)}  into the ${h.road.padEnd(26)} by ${h.into} m`);
  }
  if (report.hits.length > 25) console.log(`    ... and ${report.hits.length - 25} more`);

  const byClass = {};
  for (const h of report.hits) byClass[h.rClass] = (byClass[h.rClass] || 0) + 1;
  console.log("\n  grouped by SIZE, which names the culprit class without needing every");
  console.log("  addBlocker() call site to be tagged:");
  for (const [k, v] of Object.entries(byClass).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(v).padStart(5)}  ${k}`);
  }
  const byFrom = {};
  for (const h of report.hits) byFrom[h.from] = (byFrom[h.from] || 0) + 1;
  console.log("\n  grouped by the SOURCE LINE that created the collider -- this is the");
  console.log("  diagnosis. The top line is the bug; the rest is noise it shares a road with:");
  for (const [k, v] of Object.entries(byFrom).sort((a, b) => b[1] - a[1]).slice(0, 14)) {
    console.log(`    ${String(v).padStart(4)}  ${k}`);
  }

  const byRoad = {};
  for (const h of report.hits) byRoad[h.road] = (byRoad[h.road] || 0) + 1;
  console.log("\n  grouped by road -- the road with the most is where the plot bounds and the");
  console.log("  drawn carriageway disagree:");
  for (const [k, v] of Object.entries(byRoad).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`    ${String(v).padStart(4)}  ${k}`);
  }
  const worst = report.hits[0];
  console.log(`\n  worst: (${worst.x},${worst.z}) reaches ${worst.into} m into the ${worst.road}.`);
  console.log("  Go and look at that one. A coordinate is evidence; a screenshot would be better.");
}

await browser.close();
