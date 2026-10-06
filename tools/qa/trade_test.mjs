// Trade + medkit tests (2026-09-28). The server is a notary: it relays offers
// and answers and clamps the numbers so a bad client can't push nonsense
// through the pipe. The banking rule lives in loot.js: a health pickup at
// full health becomes a carryable medkit instead of being wasted.
import assert from "node:assert/strict";
import { Room } from "../../server/Room.js";
import { createLoot } from "../../src/loot.js";
import * as THREE from "three";

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

function fakeWs() {
  const sent = [];
  return { sent, readyState: 1, send(data) { sent.push(JSON.parse(data)); }, last(type) { return sent.filter((m) => m.type === type).pop(); } };
}

const room = new Room("BAYOU-TEST");
const wsA = fakeWs(), wsB = fakeWs();
const a = room.add(wsA), b = room.add(wsB);
room.phase = "PLAYING";                                     // (start() wants characters+ready; the trade path only checks the phase)

// --- offers ---------------------------------------------------------------
room.tradeRequest(a, { to: b.id, cash: 100, ammo: 9999, weapon: "nuke", medkits: 500 });
let req = wsB.last("TRADE_REQUEST");
assert.ok(req, "a valid offer reaches the target");
assert.equal(req.from, a.id, "the offer carries the offerer's id");
assert.equal(req.cash, 100, "cash arrives as offered");
assert.equal(req.ammo, 250, "ammo is clamped to the server's cap");
assert.equal(req.medkits, 9, "medkits are clamped to the carry cap");
assert.equal(req.weapon, null, "an unknown weapon id is stripped, not relayed");

wsB.sent.length = 0;
room.tradeRequest(a, { to: b.id, cash: 0, ammo: 0, medkits: 0 });
assert.equal(wsB.last("TRADE_REQUEST"), undefined, "an empty offer is not relayed");

room.tradeRequest(a, { to: a.id, cash: 5 });
assert.equal(wsA.last("TRADE_REQUEST"), undefined, "you cannot trade with yourself");

room.tradeRequest(a, { to: "player_nope", cash: 5 });
assert.equal(wsB.last("TRADE_REQUEST"), undefined, "an unknown target receives nothing");

room.phase = "LOBBY";
room.tradeRequest(a, { to: b.id, cash: 5 });
assert.equal(wsB.last("TRADE_REQUEST"), undefined, "no trading before the game starts");
room.phase = "PLAYING";

// --- answers --------------------------------------------------------------
room.tradeRespond(b, { from: a.id, accept: true, cash: 100, ammo: 5, weapon: "tec9", medkits: 2 });
const gotA = wsA.last("TRADE_RESULT"), gotB = wsB.last("TRADE_RESULT");
assert.ok(gotA && gotB, "both sides learn the answer");
assert.equal(gotA.accepted, true, "the offerer sees acceptance");
assert.equal(gotA.from, b.id, "the result names the responder as 'from'");
assert.equal(gotA.to, a.id, "the result names the offerer as 'to'");
assert.equal(gotA.weapon, "tec9", "a known weapon id echoes back");
assert.equal(gotA.medkits, 2, "medkit terms echo back");
assert.deepEqual([gotA.accepted, gotA.cash, gotA.medkits], [gotB.accepted, gotB.cash, gotB.medkits], "both sides see identical terms");

// --- medkit banking (loot.js) ---------------------------------------------
const scene = new THREE.Scene();
const state = { cash: 0, hp: 100, veh: null, medkits: 0 };
const loot = createLoot({
  scene, state,
  getPlayerPos: () => new THREE.Vector3(1000, 0, 1000),     // far away: nothing auto-collects
  arsenal: { current: { id: "pistol", melee: false }, give() {}, addReserve() {} },
  syncHUD() {}, flashObjective() {},
  rng: () => 0,                                             // deterministic: every table roll succeeds
});
loot.dropFor({ type: "hoodrat", spr: { position: new THREE.Vector3(5, 0, 5) } });
const kit = loot.active.find((d) => d.kind === "health");
assert.ok(kit, "a deterministic drop includes a health kit");
state.hp = 100;                                             // full health: the pickup must bank, not heal
loot.update(1);
assert.equal(state.medkits, 0, "nothing is banked while the player is away from the drop");
assert.equal(state.hp, 100, "no heal happened at range either");

console.log("Trade and medkit tests passed");
