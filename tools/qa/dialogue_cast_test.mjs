// ---------------------------------------------------------------------------
// dialogue_cast_test.mjs — can you talk to everybody who should be talkable?
//
//   node --experimental-detect-module tools/qa/dialogue_cast_test.mjs
//
// A human report (2026-09-28): "now that we have this speech system we cant
// interact with some NPCs need the E key to engage. We need those E
// interactions in the speech machine now."
//
// The system was not broken. dialogue.js already knew what to say to a
// barkeep, a bouncer, a dealer, a hog or a club dancer — roleFamily(),
// stockFor() and FLIRT_ROLES all had those roles in them. Nobody was putting
// those people in front of it. main.js's peopleNearby() listed three sources
// and the two biggest concentrations of people in the state were not among
// them: the Crown Strip (four venues, a couple of hundred people) and
// nightlife.js's Frenchmen Street clubs (dancers, bar, room). You could walk
// into either, stand next to somebody, press E, and get nothing.
//
// So the failure is an absence, and an absence is invisible to a test that
// checks what dialogue.js does with the people it is given. These checks
// therefore count bodies: an audience that silently stops being reachable must
// fail here, not show up as a player walking past an empty E prompt.
//
// Two things this deliberately does NOT gate on, because they are judgement
// calls and a threshold on them would be a guess dressed as a check:
//   * how many topics a barkeep offers
//   * whether the strip is still fun to talk to
// ---------------------------------------------------------------------------

import { installBrowserStub } from "./lib/browser_stub.mjs";
installBrowserStub();
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.innerWidth = 1920;
globalThis.innerHeight = 1080;
process.on("unhandledRejection", () => {});

import * as THREE from "three";
import { surface } from "../../src/graphics.js";
const characters = await import("../../src/characters.js");

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
};

const noop = () => {};
const scene = new THREE.Scene();
const playerPos = new THREE.Vector3(0, 0, 300);
const state = { cash: 500, hp: 100, paused: false, cinematic: false, veh: null, wanted: 0 };
const ctx = new Proxy({
  scene, surface, state, playerPos,
  addBlocker: noop, addLitSpot: noop, poolLight: noop, flashObjective: noop,
  addService: noop, makeBillboard: noop, makeFence: noop, makeBarrel: noop, makePallet: noop,
  makeNeonSign: () => new THREE.MeshStandardMaterial({ color: 0xff4fb3 }),
  roadMaterial: () => new THREE.MeshStandardMaterial({ color: 0x2b2b30 }),
  getSheriffProto: () => ({}), lots: [], services: [], pois: [], props: [],
  makeHoodrat: (o) => characters.makeHoodrat(o),
  getPlayer: () => null, setPlayerPos: noop, syncHUD: noop, bark: noop,
  get cine() { return null; }, get camera() { return null; },
  worldTime: { isNight: () => false, hour: () => 22, dusk: 1 },
  document: globalThis.document, window: globalThis,
  resolveCollision: (_c, n) => n,
  loadDsCar: () => new Promise(() => {}), loadGLB: () => new Promise(() => {}),
  loadModel: () => new Promise(() => {}), loadVehicle: () => new Promise(() => {}),
  loadCharacter: () => new Promise(() => {}), loadKit: () => new Promise(() => {}),
}, {
  get: (t, k) => {
    if (k in t) return t[k];
    if (typeof k === "string" && /(lots|services|pois|props|occluders|blockers|lanes|people|actors|venues|clubs|performers|patrons)$/.test(k)) return [];
    return noop;
  },
  set: (t, k, v) => { t[k] = v; return true; },
});

const { createCrownStrip, CROWN_STRIP } = await import("../../src/crownstrip.js");
const { createNightlife } = await import("../../src/nightlife.js");
const { createDialogue } = await import("../../src/dialogue.js");

const crown = createCrownStrip(ctx);
crown.buildSet();

// ---------------------------------------------------------------- the audience
// The whole point. If a venue's cast stops reaching peopleNearby, this is the
// number that moves, and nothing else in the codebase would notice.
{
  const venues = CROWN_STRIP.venues;
  check("the strip has venues to cast for", venues.length >= 4, `${venues.length} venues`);

  // audit the whole district first, the way the dialogue system will: ask each
  // venue for its own cast from its own frontage
  let total = 0;
  const roles = new Map();
  for (const v of CROWN_STRIP.venues) {
    const near = crown.castNear(v.x, v.cz, 200);
    total += near.length;
    for (const c of near) roles.set(c.role, (roles.get(c.role) || 0) + 1);
  }
  check("every venue on the strip returns its cast", total > 100,
    `${total} people across ${venues.length} venues`);
  check("the strip's cast is cast as more than one thing", roles.size >= 8,
    `${roles.size} distinct roles: ${[...roles].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([r, n]) => `${r}×${n}`).join(", ")}`);

  // ...and a standing player gets a prompt, not a stadium. castNear is polled
  // every frame, so the radius has to actually be a radius.
  //
  // Measured from where somebody is STANDING rather than from the venue's
  // middle: a 56 m casino has its bar, its tables and its tellers against the
  // walls, and the middle of the floor is 13 m from the nearest person, which
  // would have made a correct implementation look like a cull bug.
  const venue = CROWN_STRIP.venues[0];
  const anyone = crown.castNear(venue.x, venue.cz, 300)[0];
  check("the strip has somebody to stand next to", !!anyone);
  const near = crown.castNear(anyone.x, anyone.z, 6);
  check("standing next to somebody puts them in reach",
    near.some((c) => c.seed === anyone.seed),
    `${near.length} within 6 m of a ${anyone.role} in ${anyone.venue}`);
  check("a standing player gets a handful of people, not the whole strip",
    near.length > 0 && near.length < 40, `${near.length} people`);
  check("everyone returned is within the radius asked for",
    near.every((c) => Math.hypot(c.x - anyone.x, c.z - anyone.z) <= 6.001));
  check("nobody returned is a wall",
    near.every((c) => Number.isFinite(c.x) && Number.isFinite(c.z)));
  check("the cast carries a role dialogue.js can use a name for",
    near.every((c) => typeof c.role === "string" && c.role.length > 0));
  check("the cast carries a stable seed per person, not per frame",
    near.every((c) => c.seed != null) && new Set(near.map((c) => c.seed)).size === near.length,
    `${new Set(near.map((c) => c.seed)).size} distinct seeds for ${near.length} people`);

  // a second call from the same spot must be the same people: a seed that
  // changed per frame would reroll a barkeep's rumours every time the player
  // shifted their weight, and he would never repeat himself
  const again = crown.castNear(anyone.x, anyone.z, 6);
  check("the same spot returns the same people", JSON.stringify(again.map((c) => c.seed)) === JSON.stringify(near.map((c) => c.seed)));

  // the door staff are the one part whose pickpocket is refused, and the reason
  // is in the data rather than in a threshold somewhere else
  const door = crown.castNear(venue.x, venue.cz, 300).filter((c) => c.role === "bouncer" || c.role === "valet");
  check("the bouncer and the valet are marked as watching the door",
    door.length > 0 && door.every((c) => c.witnesses === true),
    `${door.length} door staff, all witnesses: ${door.every((c) => c.witnesses === true)}`);

  // and the cull: the strip is in North Tusouxroe, so a player at the spawn
  // point in the south of the state must get nothing at all
  check("the cast is culled outside the district", crown.castNear(-6, 130, 6).length === 0);
}

// ---------------------------------------------------------------- the clubs
const nightlife = createNightlife({ ...ctx, get cine() { return null; }, get camera() { return null; } });
{
  // one OrleaRouge block, laid out the way main.js hands it over
  const b = { x0: -40, x1: -12, z0: 256, z1: 284 };
  nightlife.buildBlock(b);
  const clubs = nightlife.clubs;
  check("the Frenchmen Street clubs built", clubs.length >= 4, `${clubs.length} clubs`);

  const near = nightlife.castNear(clubs[0].x, clubs[0].z, 6);
  check("standing in a club puts its people in reach", near.length > 0,
    `${near.length} within 6 m of ${clubs[0].name}`);
  check("the club casts dancers and staff, not one crowd",
    new Set(near.map((c) => c.role)).size >= 2,
    [...new Set(near.map((c) => c.role))].join(", "));
  check("a dancer is billed as a performer", near.some((c) => c.role === "performer"));
  check("the dancers are the ones with names",
    near.filter((c) => c.role === "performer").every((c) => !!c.name),
    near.filter((c) => c.role === "performer").map((c) => c.name || "?").join(", ") || "none in reach");
  check("the cast is culled when the player is across town",
    nightlife.castNear(0, 900, 6).length === 0);
}

// ---------------------------------------------------------------- the E key
// The one place dialogue must NOT win. The tip rail is a 0.9 m ring and the
// dialogue prompt reaches 2.6 m, so without an explicit hand-off the
// conversation swallows the key press that pays for the lap dance.
{
  const b = { x0: -40, x1: -12, z0: 256, z1: 284 };
  const nl2 = createNightlife({ ...ctx, get cine() { return null; }, get camera() { return null; } });
  nl2.buildBlock(b);
  const club = nl2.clubs[0];
  const rail = nl2.debug.spot(0, "rail");

  const mk = (talkable) => createDialogue({
    document: globalThis.document, window: globalThis,
    state, character: null, sneaking: () => false,
    adultContent: { enabled: () => false },
    playerPos: { x: rail.x, z: rail.z },
    nearbyPeople: () => nl2.castNear(rail.x, rail.z, 6).map((c) => ({ ...c, talkable })),
  });

  const onRail = mk(true);
  const away = mk(false);
  // `eOwner` reads what update() last decided, so the player has to actually be
  // standing on the ring and a frame has to have gone by — the exact sequence
  // the game runs, and the sequence a getter answering from a remembered club
  // would not.
  state.veh = null; state.cinematic = false;
  playerPos.set(rail.x, 0, rail.z);
  nl2.update(0.016);
  const owner = nl2.eOwner;
  check("standing on the rail, the venue claims E for itself", owner === club.name,
    owner == null ? "the rail reported no owner from the rail's own spot" : String(owner));

  // and stepping off it hands the key straight back
  playerPos.set(rail.x + 3, 0, rail.z + 3);
  nl2.update(0.016);
  check("stepping off the rail hands E back to dialogue", nl2.eOwner == null,
    nl2.eOwner == null ? "" : `still claimed by ${nl2.eOwner}`);

  // the whole point of the claim: dialogue must not offer somebody the venue is
  // standing on, or E buys a conversation instead of a lap dance
  onRail.update();
  const hidden = away.update();
  check("a person the venue has claimed is not offered to dialogue", hidden == null,
    hidden ? `dialogue offered ${hidden.role} on the rail` : "no prompt, as intended");
  check("the same person IS offered everywhere else in the room", onRail.update() != null,
    "the claim lifts the moment the player is off the ring");
}

// ---------------------------------------------------------------- talking
// The last mile, and the bug this found on the way: most of the cast has no
// name of its own, and open() read `p.name` straight off the actor. Every
// street walker, patron and forecourt bouncer in the state was greeted with
// "You talk to null."
{
  // The greeting does not go into the overlay — `say()` hands it to
  // flashObjective, which is the banner across the top of the screen. So this
  // is where "You talk to null." was actually visible: on the HUD, every time
  // you spoke to a street walker, a patron or a forecourt bouncer.
  const said = [];
  const base = {
    document: globalThis.document, window: globalThis,
    state, character: null, sneaking: () => false,
    adultContent: { enabled: () => false },
    flashObjective: (m) => said.push(m),
    playerPos: { x: 0, z: 0 },
  };
  const d = createDialogue({ ...base, nearbyPeople: () => [{ role: "barkeep", x: 1, z: 0, name: null, seed: "nobody" }] });
  d.open({ role: "barkeep", x: 1, z: 0, name: null, seed: "nobody" });
  const line = said.find((m) => /^You talk to /.test(m)) || "(no greeting)";
  check("an unnamed person is given a name, not the word null",
    !/null/.test(line) && /You talk to [A-Z][a-z]+ [A-Z]/.test(line), line);

  // a named one keeps its own name, and the same seed gets the same person back
  const d2 = createDialogue({ ...base, nearbyPeople: () => [] });
  d2.open({ role: "performer", x: 2, z: 0, name: "Mercedes", seed: "m1" });
  check("a stage name is not overwritten by an invented one",
    (said.find((m) => /Mercedes/.test(m)) || "(no greeting)").includes("Mercedes"),
    said.filter((m) => /Mercedes/.test(m))[0] || "not greeted by name");
  d2.open({ role: "performer", x: 2, z: 0, name: "Mercedes", seed: "m1" });
  const twice = said.filter((m) => /^You talk to /.test(m));
  check("the same person is greeted by the same name twice",
    twice.length >= 2 && twice[twice.length - 1] === twice[twice.length - 2], twice.slice(-2).join(" / "));

  // and the person the venue owns refuses to open at all
  const refused = createDialogue({ ...base, nearbyPeople: () => [] });
  const before = said.length;
  check("open() refuses a person the caller marked untalkable",
    refused.open({ role: "performer", x: 0, z: 0, talkable: false }) === false);
  check("a refused conversation says nothing at all", said.length === before,
    said.length > before ? said.slice(before).join(" / ") : "silent");
  check("open() still accepts an ordinary person",
    refused.open({ role: "performer", x: 0, z: 0, seed: "ok" }) === true);
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
