// Focused headless integration checks for the freeway/terrain contract.
// Run: node tools/qa/freeway_test.mjs
import * as THREE from "three";
import { terrain } from "../../src/terrain.js";
import { buildFreeway, corridorSpecs, DECK_HALF, FREEWAYS } from "../../src/freeway.js";

let failures = 0;
function check(condition, message) {
  if (condition) console.log(`✓ PASS: ${message}`);
  else { failures++; console.error(`✗ FAIL: ${message}`); }
}

// Tunnel portals only need the small Canvas API methods used by freeway.js.
globalThis.document = {
  createElement(tag) {
    if (tag !== "canvas") throw new Error(`Unexpected element: ${tag}`);
    return {
      width: 0,
      height: 0,
      getContext() {
        return {
          fillRect() {}, strokeRect() {}, fillText() {},
          createRadialGradient() { return { addColorStop() {} }; },
        };
      },
    };
  },
};

const specs = corridorSpecs();
check(specs.length === FREEWAYS.length && specs.every((spec) => spec.pts.length >= 2),
  "every freeway exports a terrain corridor from its XY control points");
check(specs.every((spec) => spec.half === DECK_HALF && spec.noBore.length > 0),
  "terrain corridor width and raised-deck no-bore ranges are explicit");

const terrainInfo = terrain.init({ blocked: () => false, roads: specs });
check(terrain.ready && terrainInfo.max >= 0 && terrain.corridors.length === specs.length,
  "terrain initializes each freeway corridor");
const corridor = terrain.corridors[0];
check(corridor.bores.every((b) => b.s1 > b.s0 && b.minX < b.maxX && b.roofY > 0),
  "generated tunnel bores have ordered extents and bounded world-space culling boxes");

const scene = new THREE.Scene();
const blockers = [];
const litSpots = [];
const existingLanes = [];
const freeway = buildFreeway({
  lanes: existingLanes,
  ctx: {
    scene,
    addBlocker: (x, z, r) => blockers.push({ x, z, r }),
    addLitSpot: (spot) => litSpots.push(spot),
    roadMaterial: () => new THREE.MeshStandardMaterial({ color: 0x35383a }),
    allLanes: () => existingLanes,
  },
});

check(scene.children.includes(freeway.group), "freeway geometry is attached to the scene");
check(freeway.decks > 0 && freeway.segments === freeway.decks,
  "raised deck segments are built and registered for the height query");
check(freeway.lanes.length === FREEWAYS.length * 4,
  "each freeway creates two traffic lanes per direction");
check(freeway.lanes.every((lane) => lane.points.length === lane.ys.length && lane.points.length >= 2
  && lane.ys.every(Number.isFinite)), "traffic lane coordinates and height profiles stay aligned and finite");
check(freeway.lanes.some((lane) => lane.ys.some((y) => y > 1)),
  "at least one traffic lane climbs onto the elevated deck");
check(freeway.tunnels.length === corridor.bores.length,
  "each terrain bore builds a corresponding tunnel and pair of portals");
check(blockers.length === freeway.pillars && freeway.pillars > 0,
  "support pillars contribute matching collision blockers");
check(freeway.occluders.length > freeway.tunnels.length,
  "raised decks and tunnels provide camera occluders");
check(litSpots.length > 0, "tunnel and portal lighting spots are registered");

const deckPoint = FREEWAYS[0].points.find((p) => p[2] > 0.5);
const deckY = terrain.surface(deckPoint[0], deckPoint[1], deckPoint[2] + 2);
check(deckY > 0 && deckY <= deckPoint[2] + 2,
  "terrain.surface selects the traversable raised deck below the query height");
const belowDeck = terrain.surface(deckPoint[0], deckPoint[1], 0);
check(belowDeck === terrain.at(deckPoint[0], deckPoint[1]),
  "an object below the deck stays on the ground surface");

console.log(failures ? `\n${failures} freeway check(s) failed` : "\nAll freeway checks passed");
process.exit(failures ? 1 : 0);
