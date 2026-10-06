// The franchise clubs' back rooms — can you actually get to them, and does the
// night scene start when you do?
//
//   node tools/qa/franchise_clubs_test.mjs checks the annex *exists* (a bed, a
//   host, a stand point). This checks the thing that actually matters to a
//   player: that the floor is walkable from the club door to the back room, and
//   that standing there raises the prompt and charges you. A back room behind a
//   wall is a feature that reads as broken, and nothing else in the suite would
//   have caught it.
import assert from "node:assert/strict";
import * as THREE from "three";
import { createFranchiseClubs } from "../../src/franchiseClubs.js";

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
};

// The cast is faked: this is about the ROOM, not the rigging, and the real
// characters.js rig wants a 2D canvas for its micro-surface maps.
const actors = [];
const fakeActor = (opts, extra = {}) => {
  const a = new THREE.Group();
  a.userData = { age: opts.age || 25, adult: true, fictional: true, outfit: null, ...extra };
  a.anim = "idle";
  a.play = (anim) => { a.anim = anim; };
  a.update = () => {};
  a.outfitOptions = opts;
  actors.push(a);
  return a;
};

const scene = new THREE.Scene();
const state = { running: true, veh: null, cash: 1000, hp: 50 };
const messages = [];
const blockers = [];
let nightOffers = 0;
const doc = { body: { appendChild() {} }, createElement: () => ({ style: {}, hidden: false, textContent: "" }) };
const clubs = createFranchiseClubs({
  scene, state, document: doc,
  addBlocker: (x, z, r = 0.8) => blockers.push({ x, z, r }),
  adultContent: { acknowledged: () => true, enabled: () => true,
    openNightScene: () => { nightOffers++; return true; } },
  flashObjective: (m) => messages.push(m),
  syncHUD: () => {},
  makeAdultHog: (o) => fakeActor(o, { hog: true }),
  makeAdultDancer: (o) => fakeActor(o),
  makePatron: (rng, h) => fakeActor({ height: h, patron: true }),
});

// A club at the origin, unrotated, so local and world axes line up and the
// geometry below is readable.
const club = clubs.register({ kind: "hogs", x: 0, z: 0, rot: 0 });
assert.ok(club, "the club registers");
const rec = clubs.debug[0];
check("the annex is built (bed, host, stand point)", rec.backRoomReady);

// ---- 1. no wall standing in the middle of the floor -------------------------
// Regression guard. The rear wall was once built with the SIDE wall's
// dimensions at x = 0, which put a 3.4 m wall down the centre of the room,
// through the stage and in front of the corridor mouth.
const blockersInRoom = (() => {
  let worst = null;
  club.root.traverse((o) => {
    if (!o.isMesh) return;
    const sx = Math.abs(o.scale.x) || 1;
    const sy = Math.abs(o.scale.y) || 1;
    const sz = Math.abs(o.scale.z) || 1;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    const h = (bb.max.y - bb.min.y) * sy;
    const wide = (bb.max.x - bb.min.x) * sx;
    const deep = (bb.max.z - bb.min.z) * sz;
    // a wall: tall, thin on one horizontal axis, long on the other
    if (h < 2.5) return;
    const thinX = wide < 0.8, thinZ = deep < 0.8;
    if (!thinX && !thinZ) return;
    const across = thinX ? deep : wide;              // how far it runs
    const at = o.position.x;
    if (Math.abs(at) < 0.4 && across > 6 && o.position.y < 2) {
      if (!worst || across > worst.across) worst = { across, at, h, o };
    }
  });
  return worst;
})();
check("no full-height wall stands down the middle of the floor",
  blockersInRoom === null,
  blockersInRoom ? `a ${blockersInRoom.h.toFixed(1)} m wall ${blockersInRoom.across.toFixed(1)} m long at x=${blockersInRoom.at.toFixed(2)}` : "floor is open front to back");

// ---- 2. the back room is reachable on foot ----------------------------------
// Flood fill over the club's own collision, with a player-sized body, from the
// middle of the public floor to the stand point in the back room.
const PLAYER_R = 0.45;
const solid = (x, z) => blockers.some((b) => Math.hypot(x - b.x, z - b.z) < b.r + PLAYER_R);

const STEP = 0.25;
const X0 = -11, X1 = 11, Z0 = -18, Z1 = 6;
const cols = Math.round((X1 - X0) / STEP) + 1;
const rows = Math.round((Z1 - Z0) / STEP) + 1;
const idx = (c, r) => r * cols + c;
const cellOf = (x, z) => [Math.round((x - X0) / STEP), Math.round((z - Z0) / STEP)];

const start = cellOf(0, 2);                       // open floor, in front of the stage
const goal = cellOf(club.backStand.x, club.backStand.z);
const seen = new Uint8Array(cols * rows);
const queue = [idx(start[0], start[1])];
seen[queue[0]] = 1;
let reached = false;
while (queue.length) {
  const cur = queue.pop();
  const c = cur % cols, r = (cur - c) / cols;
  if (c === goal[0] && r === goal[1]) { reached = true; break; }
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nc = c + dc, nr = r + dr;
    if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
    const ni = idx(nc, nr);
    if (seen[ni]) continue;
    if (solid(X0 + nc * STEP, Z0 + nr * STEP)) continue;
    seen[ni] = 1;
    queue.push(ni);
  }
}
check("you can walk from the club floor into the back room", reached,
  reached ? "path clear through the corridor mouth" : "the corridor mouth is walled off");

// ---- 3. standing there raises the prompt and charging starts the night ------
const els = [];
const doc2 = { body: { appendChild() {} }, createElement: () => { const e = { style: {}, hidden: true, textContent: "" }; els.push(e); return e; } };
const state2 = { running: true, veh: null, cash: 1000, hp: 50 };
let opened = 0, nightOpts = null;
const clubs2 = createFranchiseClubs({
  scene: new THREE.Scene(), state: state2, document: doc2,
  addBlocker: (x, z, r = 0.8) => blockers.push({ x, z, r }),
  adultContent: { acknowledged: () => true, enabled: () => true,
    openNightScene: (opts) => { opened++; nightOpts = opts; return true; } },
  flashObjective: () => {}, syncHUD: () => {},
  makeAdultHog: (o) => fakeActor(o, { hog: true }),
  makeAdultDancer: (o) => fakeActor(o),
  makePatron: (rng, h) => fakeActor({ height: h, patron: true }),
});
const club2 = clubs2.register({ kind: "hogs", x: 0, z: 0, rot: 0 });
const promptEl = els.find((e) => e.id === "franchiseClubPrompt");

// out on the public floor first: no back-room prompt there
clubs2.update(0.016, { x: 0, z: 2 });
const away = promptEl?.textContent || "";
// then at the stand point in the back room
clubs2.update(0.016, { x: club2.backStand.x, z: club2.backStand.z });
const at = promptEl?.textContent || "";
check("no night prompt out on the club floor", !/Go back with/.test(away), away || "(no prompt)");
check("the night prompt appears in the back room", /Go back with/.test(at), at);

const before = state2.cash;
const handled = clubs2.interact();
check("pressing E takes the night scene", handled && opened === 1, `openNightScene called ${opened}x`);
// The money is not taken on E: openNightScene opens the door scene, and the
// player confirms inside it, which is what calls perks.pay(). Drive that here.
check("the door scene is priced at the flat rate", nightOpts && nightOpts.price === 250,
  nightOpts ? `$${nightOpts.price} for ${nightOpts.performerName}` : "no options");
const paid = nightOpts && nightOpts.perks.pay();
check("confirming at the door charges the flat rate", paid === true && before - state2.cash === 250,
  `$${before} -> $${state2.cash}`);

// ...and the night itself heals, and makes you a regular (the discount next time)
state2.hp = 40;
nightOpts.perks.grant(90);
check("the night heals you", state2.hp === 90, `40 -> ${state2.hp} HP`);
check("...and you are a regular afterwards", clubs2.debug[0].coffeeStays >= 1);
check("...so the next night is discounted", clubs2.debug[0].nightCd > 0,
  `she is busy for ${Math.round(clubs2.debug[0].nightCd)}s`);

// ---- 4. the prompt fires at ANY rotation -----------------------------------
// Regression guard (human report, 2026-10-01: "the back room is unreachable,
// and you can only see it from behind the building").
//
// The test above only ever stood the player at `backStand.x/backStand.z` — the
// stand point in WORLD axes — and compared the player's LOCAL coordinates
// (lx/lz) against it. Those are the same axes only when the club faces due
// north, so the check passed for a rot:0 club and the bug survived: every real
// club, which sits at some angle in a street, compared a local position against
// a world position and raised the prompt off to one side of the corridor.
//
// So: build a club turned 90 degrees, and stand the player at the world point
// the club itself publishes. If the frame maths is right, the prompt appears.
function promptAt(clubsApi, els, x, z) {
  clubsApi.update(0.016, { x, z });
  const el = els.find((e) => e.id === "franchiseClubPrompt");
  return (el?.textContent || "").trim();
}

for (const rot of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7, 2.4]) {
  const blockersRot = [];
  const elsRot = [];
  const docR = { body: { appendChild() {} }, createElement: () => { const e = { style: {}, hidden: true, textContent: "" }; elsRot.push(e); return e; } };
  const clubsR = createFranchiseClubs({
    scene: new THREE.Scene(), state: { running: true, veh: null, cash: 1000, hp: 50 }, document: docR,
    addBlocker: (x, z, r = 0.8) => blockersRot.push({ x, z, r }),
    adultContent: { acknowledged: () => true, enabled: () => true, openNightScene: () => true },
    flashObjective: () => {}, syncHUD: () => {},
    makeAdultHog: (o) => fakeActor(o, { hog: true }),
    makeAdultDancer: (o) => fakeActor(o),
    makePatron: (rng, h) => fakeActor({ height: h, patron: true }),
  });
  const rotLabel = `rot=${rot.toFixed(2)}`;
  const clubR = clubsR.register({ kind: "hogs", x: 40, z: -30, rot });

  // the stand point, in the club's own frame, must be the point the world
  // point maps back to — that round trip is the whole bug
  const lx = Math.cos(rot) * (clubR.backStand.x - 40) - Math.sin(rot) * (clubR.backStand.z - (-30));
  const lz = Math.sin(rot) * (clubR.backStand.x - 40) + Math.cos(rot) * (clubR.backStand.z - (-30));
  check(`the stand point round-trips into the club's own frame (${rotLabel})`,
    Math.abs(lx - clubR.backStandLocal.lx) < 1e-6 && Math.abs(lz - clubR.backStandLocal.lz) < 1e-6,
    `world -> local (${lx.toFixed(2)}, ${lz.toFixed(2)}), expected (${clubR.backStandLocal.lx}, ${clubR.backStandLocal.lz})`);

  // and standing there, in world space, must raise the prompt
  const atStand = promptAt(clubsR, elsRot, clubR.backStand.x, clubR.backStand.z);
  check(`the night prompt appears at the stand point (${rotLabel})`,
    /Go back with/.test(atStand), atStand || "(no prompt)");

  // Four metres to the side is outside the annex altogether (the room is
  // |x| < 2.9, and the corridor mouth is flanked by blockers at 2.2): a prompt
  // that fires anywhere at all is no better than one that fires nowhere.
  const offToSide = promptAt(clubsR, elsRot,
    clubR.backStand.x + Math.cos(rot) * 4, clubR.backStand.z - Math.sin(rot) * 4);
  check(`...and not four metres out in the alley (${rotLabel})`,
    !/Go back with/.test(offToSide), offToSide || "(no prompt, correct)");
}

console.log(failures ? `\n${failures} back-room check(s) FAILED` : "\nAll back-room checks passed");
process.exit(failures ? 1 : 0);

