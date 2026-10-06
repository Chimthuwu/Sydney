// The Crown Strip's club venues (crownstrip.js) and the franchise clubs they
// register into themselves.
//
// The three flagships (BILLY JEANS / STOOGELETS / HAPPY HOGS) build their own
// rooms, crowd and stage; franchiseClubs.js only supplies the back-room annex
// and the games, via `register({ host })`. This checks that mode: the annex is
// hung off the VENUE's rear wall (not the branch's), the prompts land in the
// venue's own frame, the games still open, and no second branch shell/cast is
// dropped inside the room.
import assert from "node:assert/strict";
import * as THREE from "three";
import { createFranchiseClubs } from "../../src/franchiseClubs.js";

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
};

const fakeActor = (opts, extra = {}) => {
  const a = new THREE.Group();
  a.userData = { age: opts.age || 25, adult: true, fictional: true, outfit: null, ...extra };
  a.anim = "idle";
  a.play = (anim) => { a.anim = anim; };
  a.update = () => {};
  a.outfitOptions = opts;
  return a;
};

const els = [];
const doc = { body: { appendChild() {} }, createElement: () => { const e = { style: {}, hidden: true, textContent: "" }; els.push(e); return e; } };
const state = { running: true, veh: null, cash: 1000, hp: 50 };
let nightOpts = null, nightOffers = 0;
const clubs = createFranchiseClubs({
  scene: new THREE.Scene(), state, document: doc,
  addBlocker: () => {},
  adultContent: { acknowledged: () => true, enabled: () => true,
    openNightScene: (o) => { nightOpts = o; nightOffers++; return true; } },
  flashObjective: () => {}, syncHUD: () => {},
  makeAdultHog: (o) => fakeActor(o, { hog: true }),
  makeAdultDancer: (o) => fakeActor(o),
  makePatron: () => fakeActor({ height: 1.8 }),
});

// A stand-in for a Crown Strip club hall: 52 m wide, rear wall 15 m behind the
// centre, a stage off-centre, and a dance floor point in front of it.
const B = 26, FZ = 15;
const club = clubs.register({
  kind: "stoogelets", x: 62, z: -300, rot: Math.PI,
  host: { halfW: B, frontZ: FZ, backZ: -FZ, privateDance: { lx: 19, lz: -7 } },
});
check("the club registers in host mode", !!club);
check("...and carries its host geometry", !!club.hostGeom, JSON.stringify(club.hostGeom));
check("...at the venue's own dimensions", club.hostGeom && club.hostGeom.halfW === B && club.hostGeom.backZ === -FZ);

// ---- 1. the annex hangs off the VENUE's rear wall --------------------------
check("the corridor mouth is the venue's rear wall", club.hostGeom && club.hostGeom.mouthZ === -FZ);
check("the night stand point is BEHIND the rear wall",
  club.backStandLocal.lz < -FZ, `stand lz ${club.backStandLocal.lz.toFixed(2)} vs wall ${-FZ}`);
check("the bed is behind the rear wall too",
  club.bedLocal.lz < -FZ, `bed lz ${club.bedLocal.lz.toFixed(2)}`);

// the annex floor is real geometry, and it is past the wall
const annexFloor = (() => { let hit = null; club.root.traverse((o) => { if (o.isMesh && o.name === "backroom floor") hit = o; }); return hit; })();
check("the annex floor exists and sits behind the wall",
  !!annexFloor && annexFloor.position.z < -FZ, annexFloor ? `floor z ${annexFloor.position.z.toFixed(2)}` : "no floor");

// ---- 2. the host waits in the back room, not the middle of the floor --------
check("the host stands on the room's spot",
  Math.abs(club.host.position.z - club.backSpotLocal.lz) < 1e-6 && Math.abs(club.host.position.x) < 1e-6,
  `host at (${club.host.position.x.toFixed(2)}, ${club.host.position.z.toFixed(2)})`);

// ---- 3. no second branch is dropped inside the venue ------------------------
check("no branch cast is added on top of the venue's own dancers", club.performers.length === 0,
  `${club.performers.length} extra performers`);
check("no branch patrons are added either", (club.patrons || []).length === 0);
check("and the branch's own light rig is not built", !club.lights);

// ---- 4. the prompts fire in the venue's own frame ---------------------------
const promptAt = (x, z) => { clubs.update(0.016, { x, z }); const el = els.find((e) => e.id === "franchiseClubPrompt"); return (el?.textContent || "").trim(); };

const atStand = promptAt(club.backStand.x, club.backStand.z);
check("the night prompt appears at the annex stand point", /Go back with/.test(atStand), atStand || "(no prompt)");

// the private-dance point, mapped to world through the club's own rotation
const ly = Math.cos(club.rot), sy = Math.sin(club.rot);
const pd = club.hostGeom.privateDance;
const pdWorld = { x: club.x + ly * pd.lx + sy * pd.lz, z: club.z - sy * pd.lx + ly * pd.lz };
const atFloor = promptAt(pdWorld.x, pdWorld.z);
check("the private-dance prompt appears on the venue floor", /Private dance/.test(atFloor), atFloor || "(no prompt)");

// out in the alley, past the annex, there must be nothing
const off = promptAt(club.backStand.x + ly * 12, club.backStand.z - sy * 12);
check("...and nothing fires out in the alley", !/Go back with|Private dance/.test(off), off || "(no prompt)");

// ---- 5. the games still open through the shared door ------------------------
clubs.update(0.016, { x: club.backStand.x, z: club.backStand.z });
const handled = clubs.interact();
check("pressing E opens the night scene", handled && nightOffers === 1, `openNightScene called ${nightOffers}x`);
check("...at the flat rate, in the venue's own name", nightOpts && nightOpts.price === 250 && nightOpts.venue === "STOOGELETS",
  nightOpts ? `$${nightOpts.price} at ${nightOpts.venue}` : "no options");

// ---- 6. the branch venues are unchanged ------------------------------------
const branch = clubs.register({ kind: "hogs", x: 0, z: 0, rot: 0 });
check("a normal branch still builds its own cast", branch.performers.length > 0, `${branch.performers.length} performers`);
check("...its own players and lights", (branch.patrons || []).length > 0 && !!branch.lights);
check("...with no host geometry", !branch.hostGeom);

console.log(failures ? `\n${failures} Crown franchise check(s) FAILED` : "\nAll Crown franchise checks passed");
process.exit(failures ? 1 : 0);
