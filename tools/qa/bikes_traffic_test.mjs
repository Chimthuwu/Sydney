// Focused regression checks for TASK-060: NPCs ride pooled bikes, release
// detaches the visual rider, and push-bike pedal throttle coasts on release.
// Run: node tools/qa/bikes_traffic_test.mjs

import * as THREE from "three";
import { createTraffic } from "../../src/traffic.js";
import { buildMotorbike, buildPushBike, buildScooter } from "../../src/bikes.js";
import { VEHICLE_DEFS, normalizeVehicleModel, stepArcadeVehicle } from "../../src/vehicles.js";

// traffic's head/tail glow sprite is a canvas texture; supply a tiny 2D stub.
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

// All three procedural two-wheelers are buildable, and the motorbike enters
// traffic carrying the same vehicle definition used by normal driving.
const motorbike = normalizeVehicleModel(buildMotorbike(), VEHICLE_DEFS.motorbike);
const scooter = buildScooter();
const pushbike = buildPushBike();
assert(motorbike.userData.vehicleDef === VEHICLE_DEFS.motorbike, "motorbike builder normalizes with its vehicle definition");
assert(scooter.children.length > 0 && pushbike.children.length > 0, "scooter and push-bike models contain their procedural parts");

const scene = new THREE.Scene();
const registered = [];
const createdRiders = [];
function registerVehicle(obj, radius, options = {}) {
  const v = {
    obj, radius, hp: options.hp ?? 40, dead: false, speed: 0, heading: 0,
    blocker: { x: 0, z: 0 }, seats: [{ occupant: null }],
    def: obj.userData.vehicleDef,
  };
  registered.push(v);
  return v;
}
function makeRider() {
  const rider = new THREE.Group();
  rider.anim = null;
  rider.poseUpdates = 0;
  rider.play = (name) => { rider.anim = name; };
  rider.update = () => { rider.poseUpdates++; };
  createdRiders.push(rider);
  return rider;
}
const traffic = createTraffic({
  scene,
  registerVehicle,
  models: [motorbike],
  lanes: [{ name: "bike-lane", points: [[-200, 0], [200, 0]], cruise: [10, 12] }],
  perLane: 1,
  maxCars: 1,
  spawnMin: 20,
  spawnMax: 30,
  makeRider,
});
traffic.update(0.05, { x: 0, z: 0 }, [], null);
const car = traffic.cars[0];
assert(!!car && car.active, "traffic pool spawns a bike on a nearby lane");
assert(!!car?.v.def?.bike && car.v.radius === 1.05, "traffic recognizes the bike definition and bike-sized collision radius");
assert(car?.rider === createdRiders[0] && car.rider.parent === car.obj, "pooled bike carries its NPC rider as a child");
assert(car?.rider.anim === "ride" && car.rider.poseUpdates > 0, "pooled rider is posed as seated, not left standing");
assert(car?.v.seats[0].occupant === "npc", "traffic bike has an NPC driver occupant");

if (car) {
  const rider = car.rider;
  traffic.releaseVehicle(car.v);
  assert(traffic.cars.length === 0 && car.v.traffic === null, "released bike leaves the traffic pool");
  assert(rider.parent === null && car.v.riderView === rider && car.rider === null, "release detaches the rider and exposes the same view for dismount");
}

assert(VEHICLE_DEFS.pushbike.pedal === true, "push-bike definition uses the pedal drive model");
{
  const v = { def: VEHICLE_DEFS.pushbike, speed: 0, heading: 0 };
  stepArcadeVehicle(v, { throttle: 1, steer: 0, brake: false }, 0.25);
  const poweredSpeed = v.speed;
  stepArcadeVehicle(v, { throttle: 0, steer: 0, brake: false }, 0.25);
  assert(poweredSpeed > 0 && v.speed >= 0 && v.speed < poweredSpeed, "push bike gains speed while pedalled and coasts down when released");
}

console.log(failures === 0 ? "\n=== bikes_traffic_test: ALL PASS ===" : `\n=== bikes_traffic_test: ${failures} FAILURE(S) ===`);
process.exit(failures === 0 ? 0 : 1);
