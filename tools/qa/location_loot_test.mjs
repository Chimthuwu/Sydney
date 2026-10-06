// Focused checks for TASK-080 contextual search loot.
// Run: node tools/qa/location_loot_test.mjs

import * as THREE from "three";
import { createLoot, LOCATION_LOOT, LOOT_TABLES } from "../../src/loot.js";

// Loot's pooled glow textures need a canvas; rendering is outside this unit test.
globalThis.document = {
  createElement() {
    return {
      width: 0, height: 0,
      getContext() {
        return { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, set fillStyle(_v) {} };
      },
    };
  },
};

let failures = 0;
function assert(condition, message) {
  if (condition) console.log(`✓ PASS: ${message}`);
  else { failures++; console.error(`✗ FAIL: ${message}`); }
}

const expectedKinds = ["gas_station", "restaurant", "hospital", "general_store", "residential"];
assert(Object.keys(LOCATION_LOOT).join(",") === expectedKinds.join(","), "only the five specified real location kinds are present");
assert(Object.values(LOCATION_LOOT).every((entry) =>
  Object.keys(entry).every((k) => ["cash", "weapon", "ammo", "health"].includes(k)) && Object.values(entry).every((p) => p >= 0 && p <= 1)),
"location odds use only bounded cash, weapon, ammo, and health probabilities (health optional)");
assert(LOCATION_LOOT.hospital.health >= 0.5, "a hospital search is the reliable source of health packs");
assert(Object.values(LOCATION_LOOT).every((entry) => !("health" in entry) || typeof entry.health === "number"), "every health entry is a number");
assert(!!LOOT_TABLES.hoodrat && !!LOOT_TABLES.zombie, "existing NPC-keyed loot tables remain available");

const scene = new THREE.Scene();
const state = { cash: 0, hp: 100, veh: null };
const loot = createLoot({
  scene,
  state,
  getPlayerPos: () => new THREE.Vector3(1000, 0, 1000),
  arsenal: { current: { id: "pistol", melee: false }, give() {}, addReserve() {} },
  syncHUD() {},
  flashObjective() {},
  rng: () => 0,
});
const drops = loot.dropAtLocation("restaurant", 12, -4);
assert(drops.length === 3, `deterministic restaurant search creates its three eligible categories (got ${drops.length})`);
assert(drops.map((drop) => drop.kind).sort().join(",") === "ammo,cash,weapon", "search drops reuse the existing cash/weapon/ammo pickup pool");
const hospDrops = loot.dropAtLocation("hospital", -3, 7);
assert(hospDrops.some((drop) => drop.kind === "health" && drop.amount === 35), "a hospital search can drop a health pack (35 HP)");
assert(drops.every((drop) => Number.isFinite(drop.x) && Number.isFinite(drop.z) && drop.obj.parent === scene), "all search drops are positioned in the world and added to the scene");
assert(loot.dropAtLocation("not_a_place", 0, 0).length === 0, "unknown search locations safely produce no drops");

console.log(failures === 0 ? "\n=== location_loot_test: ALL PASS ===" : `\n=== location_loot_test: ${failures} FAILURE(S) ===`);
process.exit(failures === 0 ? 0 : 1);
