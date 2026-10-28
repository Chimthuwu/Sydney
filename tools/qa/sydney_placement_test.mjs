import { placeBuildings } from "../../src/sydney/placeBuildings.js";
import { SYDNEY_BUILDINGS } from "../../src/sydney/cityData.js";

let failures = 0;
function check(label, ok, detail) { if (!ok) failures++; console.log(`${ok?"  ok  ":"FAIL  "}${label}${detail?`  (${detail})`:""}`); }

const placements = placeBuildings(SYDNEY_BUILDINGS);
check("every footprint got a placement", placements.length === SYDNEY_BUILDINGS.length, `${placements.length}/${SYDNEY_BUILDINGS.length}`);
check("deterministic (two runs identical)", JSON.stringify(placeBuildings(SYDNEY_BUILDINGS)) === JSON.stringify(placements));

// height buckets sanity: tall buildings in tall bucket
const tall = placements.filter(p => p.height >= 50);
check("all >=50m buildings use tall models", tall.every(p => p.bucket === 'tall'), `${tall.length}`);

// no dropped
check("no null model", placements.every(p => p.model));

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);