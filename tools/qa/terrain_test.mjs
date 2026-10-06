// terrain.js: relief only where nothing is built; flat elsewhere; deterministic; cheap to sample.
import { terrain } from "../../src/terrain.js";

let failed = 0;
const ok = (c, m) => { console.log(`${c ? "✓ PASS" : "❌ FAIL"}: ${m}`); if (!c) failed++; };

ok(terrain.at(100, 100) === 0 && !terrain.ready, "before init the ground is flat and at() is safe");

// a made-up world: a road along z = 0, a town block, everything else open
const blocked = (x, z) => Math.abs(z) < 12 || (x > 300 && x < 420 && z > -100 && z < 100);
const info = terrain.init({ blocked });
ok(terrain.ready && info.max > 8, `hills rise in open country (max ${info.max.toFixed(1)} m)`);

let worstRoad = 0, worstTown = 0;
for (let x = -900; x <= 900; x += 7) { worstRoad = Math.max(worstRoad, terrain.at(x, 0), terrain.at(x, 8), terrain.at(x, -8)); }
for (let x = 300; x <= 420; x += 6) for (let z = -100; z <= 100; z += 6) worstTown = Math.max(worstTown, terrain.at(x, z));
ok(worstRoad === 0, `the road is dead flat (max ${worstRoad.toFixed(3)} m within 8 m of the centreline)`);
ok(worstTown === 0, `the town block is flat (max ${worstTown.toFixed(3)} m)`);

// smooth: no cliffs between neighbouring samples
let steepest = 0;
for (let x = -800; x < 800; x += 4) for (let z = 200; z < 800; z += 4) steepest = Math.max(steepest, Math.abs(terrain.at(x + 4, z) - terrain.at(x, z)) / 4, Math.abs(terrain.at(x, z + 4) - terrain.at(x, z)) / 4);
ok(steepest < 1.6, `no sheer cliffs: steepest slope ${steepest.toFixed(2)} (rise over run)`);

// never below the flat ground plane; the map edge stays flat
let minH = 0, edge = 0;
for (let x = -1200; x <= 1200; x += 20) for (let z = -1200; z <= 1200; z += 20) { minH = Math.min(minH, terrain.at(x, z)); if (Math.abs(x) > 1150 || Math.abs(z) > 1150) edge = Math.max(edge, terrain.at(x, z)); }
ok(minH >= 0, "hills only ever rise above the flat ground (valleys are the low ground between)");
ok(edge < 0.5, `the last stretch before the map edge stays flat (${edge.toFixed(2)} m)`);

const t0 = performance.now(); let s = 0;
for (let i = 0; i < 200000; i++) s += terrain.at((i * 7) % 2000 - 1000, (i * 13) % 2000 - 1000);
const per = (performance.now() - t0) / 200000 * 1000;
ok(per < 3, `sampling is cheap (${per.toFixed(2)} µs per call)`);

console.log(failed ? `\n${failed} FAILED` : "\nAll terrain checks passed");
process.exit(failed ? 1 : 0);
