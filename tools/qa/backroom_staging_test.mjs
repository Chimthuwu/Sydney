// The back rooms, and the six positions behind them.
//
// act.js and characters.js could be perfect and the player would never see any of
// it, because nothing called them: the night minigame was four buttons that
// printed a line of text and a censor gag. This is the test for the wiring —
// that a finale with a `pose` really does put two rigs on the bed, that every
// one of the six positions is reachable from the minigame, and that a scene is
// torn down on every path out of the overlay.
import { readFileSync } from "node:fs";

const noop = () => {};
const gradient = { addColorStop: noop };
const context2d = {
  fillStyle: "", font: "", textAlign: "", textBaseline: "", globalAlpha: 1,
  fillRect: noop, fillText: noop, save: noop, restore: noop, translate: noop,
  rotate: noop, scale: noop, beginPath: noop, closePath: noop, moveTo: noop,
  lineTo: noop, arc: noop, rect: noop, fill: noop, stroke: noop, clip: noop,
  clearRect: noop, drawImage: noop, createLinearGradient: () => gradient,
  createRadialGradient: () => gradient, getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  putImageData: noop, measureText: () => ({ width: 10 }),
  createImageData: () => ({ data: new Uint8ClampedArray(4) }),
  setLineDash: noop, setTransform: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
};
const el = () => ({ style: {}, hidden: false, textContent: "", className: "", id: "", children: [],
  append: (...k) => { this.children.push(...k); }, appendChild(k) { this.children.push(k); },
  replaceChildren() { this.children.length = 0; }, remove() {}, addEventListener() {},
  setAttribute() {}, removeAttribute() {}, scrollTop: 0, scrollHeight: 0, removeAttribute() {} });
globalThis.document = {
  createElement: () => Object.assign(el(), { getContext: () => context2d, width: 0, height: 0 }),
  head: { appendChild() {} }, body: { appendChild() {}, children: [], contains: () => false },
  getElementById: () => null, addEventListener() {},
};
globalThis.window = { addEventListener() {}, removeEventListener() {} };

const THREE = await import("three");
const { makeStripper, makeDancer, makeHog, setAdultGate } = await import("../../src/characters.js");
const { SCENES } = await import("../../src/act.js");
const { createFranchiseClubs } = await import("../../src/franchiseClubs.js");

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
};
setAdultGate(() => true);
const src = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8");

// ---- 1. the minigame offers every position ---------------------------------
{
  const ac = src("adultContent.js");
  const code = ac.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const POSES = Object.keys(SCENES);
  check("every position in act.js is offered by the night minigame",
    POSES.every((p) => new RegExp(`pose: "${p}"`).test(code)),
    POSES.join(", "));
  // ...and none of them is offered to somebody who cannot be cast: they are all
  // behind the same opt-in the whole scene is behind
  check("the deeper set is gated on the heat meter, not available at the start",
    /heat >= 100/.test(code) && /NIGHT_DEEPER/.test(code),
    "four more at full heat");
  check("a finale with a pose calls the club's staging", /stage\(f\.pose\)/.test(code));
  check("...and says something when it could not be staged", /Not tonight, sugar/.test(code));
}

// ---- 2. a finale really does put two rigs on the bed ------------------------
{
  const scene = new THREE.Scene();
  const player = makeDancer({ sex: "m", seed: 4, height: 1.82 });
  player.play("idle", { force: true });
  const home = new THREE.Group();
  home.add(player);
  const playerHome = { pos: player.position.clone(), parent: player.parent };

  let stagedCalls = 0, stagedEnd = 0;
  let stageFn = null, nightOpts = null;
  const clubs = createFranchiseClubs({
    scene, state: { running: true, veh: null, cash: 1000, hp: 50, cinematic: false },
    adultContent: { acknowledged: () => true, enabled: () => true,
      openNightScene: (opts) => { stageFn = opts.stage; nightOpts = opts; return true; } },
    getPlayer: () => player,
    document: { body: { appendChild() {} }, createElement: () => el() },
    flashObjective: () => {}, syncHUD: () => {},
    // real rigs, not stubs: the whole point is to exercise the actual cast, and
    // assertAdult rightly refuses a stub with no age on it
    makeAdultHog: (o) => makeHog({ ...o, age: o.age != null ? o.age : 25 }),
    makeAdultDancer: (o) => makeStripper({ sex: "f", ...o, age: o.age != null ? o.age : 25 }),
    makePatron: () => makeDancer({ sex: "m", seed: 1 }),
  });
  const club = clubs.register({ kind: "hogs", x: 0, z: 0, rot: 0 });
  check("the club registered", !!club);
  check("it has a host to stage with", !!club.host);

  // open the night, then take a finale that names a position
  clubs.update(0, { x: 0, z: -9.5 });
  clubs.interact();
  check("the night scene is handed a staging hook", typeof stageFn === "function");
  const act = stageFn ? stageFn("doggystyle") : null;
  check("a finale with a position stages it", !!act && act.running === true,
    act ? `running "${act.group.name}"` : "nothing was staged");
  if (act) {
    stagedCalls++;
    check("the player is inside the scene, not standing next to it",
      player.parent === act.group, `parent is ${player.parent === act.group ? "the scene" : "the world"}`);
    check("...and is in a couple position", player.anim === "doggystyle" && player.coupleRole === "partner",
      `"${player.anim}" as ${player.coupleRole}`);
    check("...on the bed's side of the room, not at the origin",
      Math.abs(act.group.position.z + 14.2) < 0.01, `z ${act.group.position.z.toFixed(2)} (the bed is at local -14.2)`);
    check("the world is told the player is being driven", club.staged != null);
    // tick it
    for (let i = 0; i < 120; i++) clubs.update(1 / 60, { x: 0, z: -9.5 });
    check("the scene runs while the overlay is up", act.elapsed > 1, `${act.elapsed.toFixed(2)}s of scene`);
  }

  // closing the night must put the player back
  if (act) {
    const onStageEnd = nightOpts && nightOpts.onStageEnd;
    check("the club hands the overlay a way to take the scene down", typeof onStageEnd === "function");
    if (typeof onStageEnd === "function") {
      onStageEnd();
      stagedEnd++;
      check("...and doing so puts the player back in the world",
        player.parent === playerHome.parent && player.position.equals(playerHome.pos),
        `anim "${player.anim}", parent restored`);
      check("...and leaves nobody on a bed in the next scene", club.staged == null);
    }
  }
  check("the wiring actually happened", stagedCalls === 1 && stagedEnd === 1, `${stagedCalls} staged, ${stagedEnd} ended`);
}

// ---- 3. the staging refuses rather than half-running ----------------------
{
  const scene = new THREE.Scene();
  const player = makeDancer({ sex: "m", seed: 4, age: 17 });      // a minor as the player rig
  const home = new THREE.Group(); home.add(player);
  const flashes = [];
  let stageFn = null;
  const clubs = createFranchiseClubs({
    scene, state: { running: true, veh: null, cash: 1000, hp: 50 },
    adultContent: { acknowledged: () => true, enabled: () => true,
      openNightScene: (o) => { stageFn = o.stage; return true; } },
    getPlayer: () => player,
    document: { body: { appendChild() {} }, createElement: () => el() },
    flashObjective: (m) => flashes.push(m), syncHUD: () => {},
    makeAdultHog: (o) => makeHog({ ...o, age: 25 }),
    makeAdultDancer: (o) => makeStripper({ sex: "f", ...o, age: 25 }),
    makePatron: () => makeDancer({ sex: "m", seed: 1 }),
  });
  const club = clubs.register({ kind: "hogs", x: 0, z: 0, rot: 0 });
  clubs.update(0, { x: 0, z: -9.5 });
  clubs.interact();
  const act = stageFn ? stageFn("missionary") : null;
  check("a position will not be staged with a minor in it", act === null, "returned null");
  check("...and says why, in the player's own terms", flashes.some((m) => /stays dressed/i.test(m)),
    flashes.join(" | "));
  check("...and leaves the player where they were", player.parent === home);
  void club;
}

// ---- 4. the plumbing reaches every layer ----------------------------------
{
  check("main.js hands the player rig to the state world", /getPlayer: \(\) => player/.test(src("main.js")));
  check("stateWorld passes it to the clubs", /getPlayer: ctx\.getPlayer/.test(src("stateWorld.js")));
  check("franchiseClubs takes it and imports createAct",
    /getPlayer = \(\) => null/.test(src("franchiseClubs.js"))
    && /import \{ beginStageAct, createAct \} from "\.\/act\.js"/.test(src("franchiseClubs.js")));
  check("...and stages on the bed, where the annex put one",
    /c\.bedLocal = \{ lx: 0, lz: z\(-14\.2\) \}/.test(src("franchiseClubs.js"))
    && /worldAt\(c\.x, c\.z, c\.bedLocal/.test(src("franchiseClubs.js")));
  check("closeGame takes a staged scene down on every exit", /active\.onStageEnd/.test(src("adultContent.js")));
  check("the scene is ticked on the club's own clock, not the paused sim",
    /c\.staged\.update\(Math\.max\(dt, 1 \/ 120\)\)/.test(src("franchiseClubs.js")));
}

console.log(failures ? `\n${failures} back-room staging check(s) FAILED` : "\nAll back-room staging checks passed");
process.exit(failures ? 1 : 0);
