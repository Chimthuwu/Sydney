import assert from "node:assert/strict";
import * as THREE from "three";
import { createFranchiseClubs } from "../../src/franchiseClubs.js";

function makeFakeActor(opts, { hog = false } = {}) {
  const actor = new THREE.Group();
  actor.userData = { age: opts.age || 25, adult: false, fictional: false, hog, outfit: null };
  actor.anim = "idle";
  actor.torso = { rotation: { x: 0, y: 0, z: 0 } };
  actor._last = { copy() {} };
  actor.baseY = 0;
  actor.play = (anim) => { actor.anim = anim; };
  actor.update = () => {};
  actor.outfitOptions = opts;
  return actor;
}
const actors = [];
const makeActor = (opts, extra) => { const actor = makeFakeActor(opts, extra); actors.push(actor); return actor; };
const scene = new THREE.Scene();
const state = { running: true, veh: null, cash: 200 };
const messages = [];
const mockGate = {
  acknowledged: () => true,
  enabled: () => optedIn,
  openRhythmGame(options) { rhythmOptions = options; return true; },
};
let optedIn = false, rhythmOptions = null, hudSyncs = 0;
const doc = { body: { appendChild() {} }, createElement() { return { style: {}, addEventListener() {} }; } };
const clubs = createFranchiseClubs({
  scene, state, adultContent: mockGate, document: doc,
  flashObjective: (message) => messages.push(message),
  syncHUD: () => hudSyncs++,
  makeAdultHog: (opts) => makeActor(opts, { hog: true }),
  makeAdultDancer: (opts) => makeActor(opts),
  makePatron: (rng, h) => makeActor({ height: h, patron: true }),
});
const hogClub = clubs.register({ kind: "hogs", x: 100, z: 100, rot: 0 });
const billyClub = clubs.register({ kind: "billy", x: 200, z: 200, rot: 0 });
const stoogeClub = clubs.register({ kind: "stoogelets", x: 300, z: 300, rot: 0 });
assert.ok(hogClub && billyClub && stoogeClub, "all three franchise types register");
assert.equal(hogClub.performers.length, 3, "Happy Hogs has a stage trio");
assert.equal(billyClub.performers.length, 2, "Billy Jeans has a stage pair");
assert.ok(clubs.debug.every((club) => club.allAdults && club.allFictional), "all performers are fictional adults");
// The three identities: Hogs dance in the mask, Billys are shirtless men, Stoogelets are the house bikini.
const hogsDb = clubs.debug[0], billyDb = clubs.debug[1], stoogeDb = clubs.debug[2];
assert.ok(hogsDb.costumes.every((o) => o.hogMask === true && o.bikini === true), "Happy Hogs: the mask stays ON over the house bikini");
assert.ok(billyDb.costumes.every((o) => o.shirtless === true && o.bikini === false), "Billy Jeans: the billys are shirtless men");
assert.ok(stoogeDb.costumes.every((o) => o.bikini === true && !o.hogMask && !o.shirtless), "Stoogelets: the house stage costume, no theme gear");
assert.ok(clubs.debug.every((club) => club.allStageCostume), "nobody in a franchise branch is fully dressed");
assert.ok(actors.filter((a) => a.outfitOptions.patron !== true)
    .every((a) => a.outfitOptions.stripper === (a.outfitOptions.sex !== "m")),
  "the women wear the stripper rig (bikini + gstring + bare legs) and the men do not");
assert.ok(stoogeDb.stageNames.every((n) => n), "every performer carries a marquee stage name");
assert.ok(actors.filter((a) => a.outfitOptions.patron !== true).every((actor) => actor.outfitOptions.shoe === "heels"), "heels stay on across every franchise");
assert.ok(actors.filter((a) => a.outfitOptions.patron !== true).every((actor) => actor.outfitOptions.top != null && actor.outfitOptions.skirt != null), "performers still carry a costume palette (skirt colour)");
assert.ok(actors.filter((a) => a.outfitOptions.patron !== true && a.outfitOptions.sex !== "m")
    .every((a) => a.outfitOptions.bust >= 1.6), "every woman on a stage is billed well past the sheet's own chest");
assert.equal(hogsDb.hogDancers, 4, "Happy Hogs: three stage hogs + the back-room host, all hogs");
assert.ok(clubs.debug.every((club) => club.backRoomReady), "every club has the back-room annex (bed, host, stand point)");

// A club with nobody in it is a set (human request 2026-09-30): the branches
// carry a floor, a bar and a light rig now.
for (const db of clubs.debug) {
  assert.ok(db.patrons >= 12, `${db.name} is full: ${db.patrons} on the floor`);
  assert.ok(db.dancing >= 5, `${db.name} has people out dancing — ${db.dancing}`);
  assert.ok(db.atBar >= 2, `${db.name} has a bar crowd — ${db.atBar}`);
  assert.ok(db.lights && db.lights.cans >= 4 && db.lights.fanBeams >= 5, `${db.name} has par cans and a laser fan`);
  assert.ok(db.sharedClock, `${db.name} hands every performer the same clock`);
  assert.ok(db.synchronized, `${db.name} changes routine on the club's beat, not each dancer's`);
  assert.ok(db.routinesUsed.includes("sync") && db.routinesUsed.includes("grind"),
    `${db.name} runs the grind and the eight-count — ${db.routinesUsed.join(", ")}`);
  if (db.name !== "BILLY JEANS") {
    assert.ok(db.routinesUsed.includes("twerk"), `${db.name} runs the bounce — ${db.routinesUsed.join(", ")}`);
  }
}

// Inside the room, normal floor routines progress through the available dance clips.
clubs.update(0, { x: 100, z: 100 });
assert.equal(hogClub.root.visible, true);
const initialRoutines = hogClub.performers.map((p) => p.actor.anim);
clubs.update(3.5, { x: 100, z: 100 });
assert.ok(hogClub.performers.every((p) => p.routineChanges > 0), "stage routines rotate over time");
assert.ok(hogClub.performers.some((p, i) => p.actor.anim !== initialRoutines[i]), "the cast displays changing routine poses");

// The player must ask for an encore. A voluntary tip pauses normal choreography briefly.
clubs.update(0, { x: 100, z: 100.55 });
assert.equal(clubs.interact(), true, "the nearby encore interaction is handled");
assert.equal(state.cash, 190, "an encore deducts only its stated tip");
assert.equal(hogClub.encores, 1);
assert.equal(hogClub.encoreWasActive, true);
assert.ok(hogClub.performers.every((p) => p.actor.anim === "twerk"), "the encore changes the stage routine");
assert.ok(messages.some((m) => m.includes("encore requested")));
assert.ok(hudSyncs > 0);

// Private activity remains separately opt-in and is not charged until START.
optedIn = false;
clubs.update(0, { x: 100 - 6.8, z: 100 - 2.8 });
assert.match(clubs.debug[0].name, /HAPPY HOGS/);
clubs.interact();
assert.equal(rhythmOptions, null, "private activity stays unavailable while opted out");
optedIn = true;
clubs.update(0, { x: 100 - 6.8, z: 100 - 2.8 });
clubs.interact();
assert.ok(rhythmOptions, "opted-in player can open the private rhythm activity");
assert.equal(state.cash, 190, "opening the activity does not charge before its explicit START");
assert.equal(rhythmOptions.onBegin(), true);
assert.equal(state.cash, 110, "the stated private-dance price is charged at START, not on approach");
assert.equal(hogClub.plays, 1);
rhythmOptions.onFinish(null);

console.log("Franchise club performer and interaction tests passed");
