// ---------------------------------------------------------------------------
// spawn_barrier_test.mjs — what is the green wall west of the spawn?
//
//   node --experimental-detect-module tools/qa/spawn_barrier_test.mjs
//
// A human report (2026-10-03), free roam, standing at the spawn on US-167 at
// (-6, 130) facing north: "some weird green barrier on the left side of the
// road there that player cant jump over."
//
// This drives the REAL built world in Chromium (the source-reading skills are
// explicit that a live-world claim needs a live world), walks the pavement
// west of the spawn, and reports every collider the player cannot clear:
//   * a blocker whose radius exceeds the player's own is a wall, whatever it
//     is called — jump height is JUMP_HEIGHT 3.0 m, so anything meaningfully
//     taller than the player is not a thing you jump
//   * its colour, so "green" is checked rather than assumed
//   * the ground truth is printed whether or not it passes: if the barrier
//     turns out to be legitimate (a treeline you are meant to be stopped by),
//     that is a finding for the player, not a bug to be papered over
//
// The probe must be able to FAIL LOUDLY: a scan that read no meshes reports
// zero findings and looks exactly like a clean street.
// ---------------------------------------------------------------------------

import puppeteer from "puppeteer";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { autoAcknowledge } from "./lib/agegate.mjs";

const PORT = 8912;
const ROAD_X = -6, ROAD_HALF = 5, SPAWN_Z = 130;

// ---- the honest failure: if the page never came up, say so and exit non-zero
let server;
const startServer = () => new Promise((resolve, reject) => {
  server = spawn(process.execPath, ["serve.mjs", String(PORT)], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  const t = setTimeout(() => reject(new Error(`server did not report ready in 20s. Output:\n${out}`)), 20000);
  server.stdout.on("data", (d) => {
    out += d;
    if (/listening|localhost|127\.0\.0\.1|http:\/\//i.test(out)) { clearTimeout(t); resolve(out); }
  });
  server.stderr.on("data", (d) => { out += d; });
});

let browser, page;
let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
};

try {
  await startServer();
  // Puppeteer's pinned Chrome (131) is not what is installed on this machine
  // (154, under the user cache). Launching by path is the fix; letting it search
  // for its own pinned build is how this probe died before reading a single
  // mesh, which is the exact failure mode it was written to avoid.
  const CHROME = process.env.GTB_CHROME
    || `${process.env.USERPROFILE || process.env.HOME}\\.cache\\puppeteer\\chrome\\win64-154.0.8037.57\\chrome-win64\\chrome.exe`;
  const fs = await import("node:fs");
  if (!fs.existsSync(CHROME)) {
    console.log(`\n FAIL  no Chrome at ${CHROME}. Set GTB_CHROME to a chrome.exe.`);
    failures++;
    throw new Error("no chrome binary");
  }
  console.log(`  chrome: ${CHROME}`);
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader", "--window-size=1280,720"],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  // The "I am over 18" gate covers the page and eats every click until it is
  // answered. Without this the freeBtn click below lands on the gate and the
  // game never starts — which reads exactly like a broken probe.
  await autoAcknowledge(page);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  console.log(`loading the world from :${PORT} ...`);
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle2", timeout: 120000 });
  // Free roam: the button the player pressed. Wait for the world to finish
  // building rather than a fixed sleep — a fixed sleep is how a probe reads an
  // empty scene and calls it a street.
  await page.waitForFunction(() => {
    const b = document.getElementById("freeBtn");
    return b && !b.disabled;
  }, { timeout: 180000, polling: 500 });
  console.log("  world ready, entering free roam ...");
  await page.evaluate(() => document.getElementById("freeBtn").click());
  await page.waitForFunction(() => window.__game && window.__game.playerPos, { timeout: 60000, polling: 500 });
  await sleep(6000);   // let a few population ticks run

  // ---------------------------------------------------------------- survey
  const survey = await page.evaluate((ROAD_X, ROAD_HALF, SPAWN_Z) => {
    const g = window.__game;
    if (!g) return { error: "no __game handle" };
    const scene = g.scene, camera = g.camera;
    if (!scene) return { error: "no scene" };

    // Walk the pavement west of the spawn: from just off the west shoulder out
    // to 60 m west, over the 40 m of road the player is looking along.
    const X0 = ROAD_X - ROAD_HALF - 2, X1 = ROAD_X - 65;
    const Z0 = SPAWN_Z - 20, Z1 = SPAWN_Z + 20;

    // Meshes in that box, with their bounding box and their base colour.
    const found = [];
    scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      o.updateWorldMatrix(true, false);
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      if (bb.max.x < X0 || bb.min.x > X1 || bb.max.z < Z0 || bb.min.z > Z1) return;
      const h = bb.max.y - bb.min.y;
      const w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
      const c = o.material && o.material.color ? o.material.color : null;
      found.push({
        name: o.name || o.type,
        x: +(bb.min.x + bb.max.x) / 2, y: +(bb.min.y + bb.max.y) / 2, z: +(bb.min.z + bb.max.z) / 2,
        h: +h.toFixed(2), w: +w.toFixed(2),
        top: +bb.max.y.toFixed(2),
        color: c ? `#${c.getHexString()}` : "none",
        r: c ? +c.r.toFixed(3) : 0, g: c ? +c.g.toFixed(3) : 0, b: c ? +c.b.toFixed(3) : 0,
        instanced: o.isInstancedMesh ? o.count : 0,
      });
    });

    // The colliders the player actually collides with — the thing that decides
    // whether he can get past it.
    const blockers = [];
    if (g.blockers) {
      for (const bl of g.blockers) {
        if (bl._grid !== "static") continue;
        if (bl.x < X0 - 8 || bl.x > X1 + 8 || bl.z < Z0 || bl.z > Z1) continue;
        blockers.push({ x: +bl.x.toFixed(1), z: +bl.z.toFixed(1), r: +bl.r.toFixed(2), y0: bl.y0, y1: bl.y1 });
      }
    }

    // NPCs, for the same box — the other half of the report.
    let npcs = 0, nearestNpc = Infinity;
    if (g.enemies) {
      for (const e of g.enemies) {
        if (e.dead) continue;
        const p = e.spr && e.spr.position;
        if (!p) continue;
        const d = Math.hypot(p.x - g.playerPos.x, p.z - g.playerPos.z);
        nearestNpc = Math.min(nearestNpc, d);
        if (p.x > X0 - 30 && p.x < X1 + 30 && p.z > Z0 && p.z < Z1) npcs++;
      }
    }

    return {
      meshCount: found.length, meshes: found, blockers, npcs,
      nearestNpc: Number.isFinite(nearestNpc) ? +nearestNpc.toFixed(1) : null,
      playerPos: { x: +g.playerPos.x.toFixed(1), z: +g.playerPos.z.toFixed(1) },
      camPos: camera ? { x: +camera.position.x.toFixed(1), y: +camera.position.y.toFixed(1), z: +camera.position.z.toFixed(1) } : null,
    };
  }, ROAD_X, ROAD_HALF, SPAWN_Z);

  if (survey.error) {
    console.log(`\n FAIL  the probe could not read the world: ${survey.error}`);
    failures++;
  } else {
    console.log(`\n--- the world answered ---`);
    console.log(`  player at (${survey.playerPos.x}, ${survey.playerPos.z}) · camera y ${survey.camPos?.y}`);
    console.log(`  page errors: ${errors.length}`);
    if (errors.length) errors.slice(0, 5).forEach((e) => console.log(`    ${e.slice(0, 160)}`));

    check("the probe actually read the world (a zero-mesh scene is a broken probe, not a clean street)",
      survey.meshCount > 0, `${survey.meshCount} meshes in the west box`);
    check("and it read colliders, not just decoration",
      survey.blockers.length > 0, `${survey.blockers.length} static colliders in the west box`);

    // ---- the barrier itself
    console.log(`\n--- colliders west of the spawn road ---`);
    const TALL = 1.6;   // a thing taller than this at the player's own radius is not jumpable (JUMP_HEIGHT 3.0 m)
    const wall = survey.blockers.filter((b) => b.r > 0.9 && b.y0 === undefined);
    wall.sort((a, b) => b.r - a.r);
    for (const b of wall.slice(0, 15)) {
      console.log(`    r=${String(b.r).padStart(6)}  at (${b.x}, ${b.z})  dist from spawn ${Math.hypot(b.x - ROAD_X, b.z - SPAWN_Z).toFixed(1)} m`);
    }
    console.log(`  ${wall.length} colliders wider than 0.9 m in that box (a person is ~0.4 m)`);

    // What is green among the meshes, and how tall is it?
    console.log(`\n--- green meshes in that box ---`);
    const green = survey.meshes.filter((m) => m.g > m.r * 1.15 && m.g > m.b * 1.15 && m.g > 0.12);
    green.sort((a, b) => b.top - a.top);
    for (const m of green.slice(0, 20)) {
      console.log(`    ${m.color}  h=${String(m.h).padStart(7)}  top=${String(m.top).padStart(7)}  w=${String(m.w).padStart(7)}  at (${m.x}, ${m.z})  ${m.name}${m.instanced ? ` x${m.instanced}` : ""}`);
    }
    console.log(`  ${green.length} green meshes`);

    const greenTall = green.filter((m) => m.top > 2.0 && m.w > 6);
    check("no tall green wall stands west of the spawn road",
      greenTall.length === 0,
      greenTall.length ? `${greenTall.length} green meshes over 2 m tall and 6 m wide: ${greenTall.slice(0, 4).map((m) => `${m.color} h${m.h} at (${m.x},${m.z})`).join("; ")}` : "");

    // ---- the population half
    console.log(`\n--- people near the spawn ---`);
    console.log(`  ${survey.npcs} NPCs in the west box · nearest anywhere ${survey.nearestNpc} m`);
    check("there are people near the spawn, not an empty road",
      survey.npcs > 0 || (survey.nearestNpc !== null && survey.nearestNpc < 120),
      `${survey.npcs} in box, nearest ${survey.nearestNpc} m`);
  }
} catch (e) {
  console.log(`\n FAIL  the probe threw: ${e.message}`);
  failures++;
} finally {
  try { await browser?.close(); } catch {}
  try { server?.kill(); } catch {}
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
