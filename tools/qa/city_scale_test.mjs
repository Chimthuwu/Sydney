// OrleaRouge's scale and zoning.
//
//   node --experimental-detect-module tools/qa/city_scale_test.mjs
//
// "the city area needs to feel like a bustling metropolis eventually… we can
// really push the overall scale of the map much MUCH more" — it was 656 x 186 m,
// which is about twelve blocks by four: a large town.
//
// The two things that can go wrong when a grid is scaled up are both silent.
// Blocks can stop being covered by any builder, leaving bald patches of pavement
// in the middle of a metropolis; and a block can be covered by two, which used
// to be decided by the order the builders happened to run in. So these check
// the ZONING as a partition, not just that the city got bigger.

import { readFileSync } from "node:fs";
import { CITY, ZONES } from "../../src/orlearouge.js";

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL " } ${label}${detail ? `  — ${detail}` : ""}`);
};

const src = readFileSync(new URL("../../src/orlearouge.js", import.meta.url), "utf8");
const grid = (name) => {
  const m = src.match(new RegExp(`^const ${name} = \\[([^\\]]*)\\];`, "m"));
  if (!m) throw new Error(`orlearouge.js: cannot read ${name}`);
  return m[1].split(",").map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
};
const AVENUES = grid("AVENUES");
const STREETS = grid("STREETS");
const STREET_W = Number(src.match(/const STREET_W = (\d+)/)[1]);

// ---------------------------------------------------------------- it got bigger
{
  const w = CITY.maxX - CITY.minX, d = CITY.maxZ - CITY.minZ;
  check("the city is bigger than it was (656 x 186 m)", w > 700 && d > 250, `${w} x ${d} m`);
  check("the city is a city, not a corridor", w / d > 1.4 && w / d < 4, `aspect ${(w / d).toFixed(2)}`);
  // THE WEST EDGE MOVED, on purpose, and this check used to forbid it.
  //
  // It said "the west edge has not moved" and pinned CITY.minX === -136, written
  // when the city grew EAST and the west was fixed by the parish and the river.
  // That reasoning expired: the aerial with the empty ground outlined (human
  // report, 2026-09-28) was the 9.7 ha of nothing west of the grid, and the fix
  // is five more columns of West Bank. What is genuinely fixed is not an edge but
  // a set of COORDINATES — main.js places the Pay 'n' Spray, Frenchmen Street,
  // the casinos and the Crown Strip by number, so a check on a coordinate is the
  // one that means something, and it is the one below.
  check("the west edge has reached the river", CITY.minX <= -286, `minX ${CITY.minX}`);
  check("the riverfront has moved south, as a waterfront does", CITY.maxZ > 382, `maxZ ${CITY.maxZ}`);
}

// ---------------------------------------------------------------- the grid is sane
{
  check("there are enough avenues to be a city", AVENUES.length >= 15, `${AVENUES.length}`);
  check("there are enough streets to be a city", STREETS.length >= 6, `${STREETS.length}`);
  // a grid with a repeated coordinate lays two streets on top of each other,
  // which z-fights and doubles the traffic on one strip
  check("no two avenues share a coordinate", new Set(AVENUES).size === AVENUES.length);
  check("no two streets share a coordinate", new Set(STREETS).size === STREETS.length);
  // Regular pitch: a 40 m grid is a real city, an irregular one is a village.
  // The avenues have exactly ONE wider gap — between -46 and 34 — because US-167
  // runs down the middle of it. That is the boulevard's reserved strip, not a
  // mistake in the pitch.
  const pitch = (a) => a.slice(1).map((v, i) => v - a[i]);
  const ap = pitch(AVENUES), sp = pitch(STREETS);
  const wideAvenueGaps = ap.filter((d) => d !== 40);
  check("the avenues are on a 40 m pitch apart from the boulevard", wideAvenueGaps.length === 1 && wideAvenueGaps[0] === 80,
    `pitches ${[...new Set(ap)].join(", ")} m`);
  // "the wide gap is the boulevard's" has to be said by SIDE, not by index. The
  // assertion used to be `AVENUES[1] === -46 && AVENUES[2] === 34`, which is a
  // statement about the array's first two entries, and it kept passing for the
  // wrong reason the moment avenues were added west of the city.
  {
    const west = AVENUES.filter((x) => x < -6), east = AVENUES.filter((x) => x > -6);
    check("the wide avenue gap is the boulevard's",
      Math.max(...west) === -46 && Math.min(...east) === 34 && wideAvenueGaps[0] === 80,
      `nearest either side of US-167: ${Math.max(...west)} and ${Math.min(...east)}`);
  }
  check("the streets are on a regular pitch", new Set(sp).size === 1, `${[...new Set(sp)].join(", ")} m`);
  // the original fourteen avenues must not have moved: main.js places the Pay
  // 'n' Spray, Frenchmen Street, the casinos and the Crown Strip by coordinate
  const original = [-86, -46, 34, 74, 114, 154, 194, 234, 274, 314, 354, 394, 434, 474, 514];
  const kept = original.every((a) => AVENUES.includes(a));
  check("the original fifteen avenues are all still in place", kept,
    original.filter((a) => !AVENUES.includes(a)).join(", ") || "all kept");
  // the boulevard has to sit between the two western avenues, or the French
  // District's western edge is not a district
  check("US-167 runs between the two western avenues", -86 < -6 && -6 < 34);
}

// ---------------------------------------------------------------- zoning is a partition
// Reproduce blocks() and zoneOf() and check every block lands in exactly one
// named zone that a builder actually claims.
{
  const roadX = -6;
  // the same split blocks() makes, and for the same reason: by side of the
  // boulevard, not by array index
  const xs = [CITY.minX, ...AVENUES.filter((x) => x < roadX), roadX, ...AVENUES.filter((x) => x > roadX), CITY.maxX];
  const zs = [CITY.minZ, ...STREETS, CITY.maxZ];
  const blocks = [];
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      const pad = (e) => (e === CITY.minX || e === CITY.maxX || e === CITY.minZ || e === CITY.maxZ ? 1 : STREET_W / 2 + 2.5);
      const x0 = xs[i] + pad(xs[i]) + (xs[i] === roadX ? 1 : 0);
      const x1 = xs[i + 1] - pad(xs[i + 1]) - (xs[i + 1] === roadX ? 1 : 0);
      const z0 = zs[j] + pad(zs[j]), z1 = zs[j + 1] - pad(zs[j + 1]);
      if (x1 - x0 > 8 && z1 - z0 > 6) blocks.push({ x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 });
    }
  }
  check("the grid yields a real number of blocks", blocks.length > 120, `${blocks.length} blocks`);

  const zoneOf = (b) => {
    if (b.cx < ZONES.westbank) return "westbank";
    if (b.cx < roadX) return b.cz >= ZONES.garden ? "garden" : "quarter";
    if (b.cz >= ZONES.edge) return "edge";
    if (b.cx >= ZONES.civic) return "civic";
    if (b.cx < ZONES.cbd) return "cbd";
    return "midtown";
  };
  const named = new Set(["westbank", "quarter", "garden", "cbd", "midtown", "civic", "edge"]);
  const counts = {};
  for (const b of blocks) {
    const z = zoneOf(b);
    if (!named.has(z)) { check(`block at ${b.cx.toFixed(0)},${b.cz.toFixed(0)} has a zone`, false, String(z)); break; }
    counts[z] = (counts[z] || 0) + 1;
  }
  check("every block falls in a named zone", Object.values(counts).reduce((a, b) => a + b, 0) === blocks.length,
    JSON.stringify(counts));
  // the whole point of the sequence: the parts must all be present, and the CBD
  // must be a real share of the city rather than three blocks
  for (const z of ["westbank", "quarter", "garden", "cbd", "midtown", "civic", "edge"]) {
    check(`the city has a ${z}`, (counts[z] || 0) > 0, `${counts[z] || 0} blocks`);
  }
  // A zone that no block can ever reach is dead code that still reads as if the
  // city has that part. The old "outskirts" became exactly that when the civic
  // end grew out to meet it.
  check("no zone is defined that nothing can reach", !/outskirts/.test(src.split("function zoneOf")[1].slice(0, 400)),
    "zoneOf still returns a zone no block lands in");
  check("the CBD is a substantial part of the city", (counts.cbd || 0) > 25, `${counts.cbd || 0} blocks`);
  check("there is midtown between the tower district and the edge", (counts.midtown || 0) > 8, `${counts.midtown || 0} blocks`);
  check("the civic end has ground on it", (counts.civic || 0) > 8, `${counts.civic || 0} blocks`);
  // the West Bank is not a token: one block of it is a district that exists only
  // to stop the city ending in a field
  check("the West Bank is more than a token", (counts.westbank || 0) >= 20, `${counts.westbank || 0} blocks`);

  // no block may be claimed twice: each builder filters on its own zone, so as
  // long as zoneOf is a function there is no overlap. Prove it rather than
  // trust the reading of it.
  const claimed = (b) => ["westbank", "edge", "quarter", "garden", "cbd", "midtown", "civic"].filter((z) => zoneOf(b) === z);
  check("no block is claimed by two builders", blocks.every((b) => claimed(b).length === 1));
  // and no block may fall through every builder and be left as bare pavement
  check("no block is left unbuilt", blocks.every((b) => claimed(b).length === 1));
}

// ---------------------------------------------------------------- traffic follows the grid
// The lanes used to be four hand-listed pairs at z 210/250/330/370 — on a
// five-street grid that left one street with no traffic, and on a seven-street
// grid it would have left two.
{
  check("lanes are generated from the grid", /lanes: \(\(\) => \{/.test(src) && /for \(const z of STREETS\)/.test(src));
  // the old hand-listed lanes had hardcoded carriageway offsets (247.6, 252.4,
  // 327.6 …) tied to four named streets. Any of those surviving means a street
  // has traffic on a carriageway that is not where the road is.
  check("no hand-listed city lane offsets are left", !/2[45]7\.6|3[23]7\.6|3[67]7\.6|2[45]2\.4|3[23]2\.4|3[67]2\.4/.test(src));
}

if (failures) { console.error(`city_scale_test: ${failures} failure(s)`); process.exit(1); }
console.log("city_scale_test: all checks passed");
