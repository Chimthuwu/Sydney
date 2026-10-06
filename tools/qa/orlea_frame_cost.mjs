// orlea_frame_cost.mjs — frame time and draw calls at the three districts.
//
//   node --experimental-detect-module tools/qa/orlea_frame_cost.mjs
//
// The numbers the OrleaRouge lag was first reported in: 1495 ms/frame and 4519
// draw calls at the spawn, against ~662 ms / 2082 at Crown Strip and ~674 / 2000 at
// Oyster Bay. `orlearouge_spawn_density.mjs` measures mesh COUNTS, not cost, so it
// cannot answer "did this get faster" -- only this can.
//
// Same spawn points, same measurement method, before and after the cullGroups fix,
// so the comparison is real rather than a different camera angle.
//
// What it reports per district:
//   ms/frame   median over N frames, after a warmup that excludes shader compile
//   draw calls renderer.info.render.calls
//   triangles   renderer.info.render.triangles
//
// The warmup matters more than it looks: the first frames after a teleport compile
// shaders and upload textures, which is hundreds of milliseconds that has nothing to
// do with the geometry under test. Reporting a cold first frame made OrleaRouge look
// far worse than it is.

import puppeteer from "puppeteer";
import { autoAcknowledge } from "./lib/agegate.mjs";

// The same three points orlearouge_spawn_density.mjs uses, so the two tools describe
// the same places and their numbers can be compared. The first guess here at
// (-180, 60) was invented and would have measured empty swamp.
const POINTS = [
  { name: "SPAWN (OrleaRouge)", x: -6, z: 130 },
  { name: "spawn+40m", x: -6, z: 170 },
  { name: "Oyster Bay (control)", x: 640, z: 590 },
];

const browser = await puppeteer.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"], protocolTimeout: 300000 });
const page = await browser.newPage();
await autoAcknowledge(page);
const gfxLines = [];
page.on("console", (m) => { if (/\[gfx\]|batching/i.test(m.text())) gfxLines.push(m.text()); });
page.on("pageerror", (e) => console.log("  pageerror:", e.message));

// Port 8899, matching orlearouge_spawn_density.mjs -- which is the port the dev
// server is already running on in this environment. The first version of this file
// used 8123 and failed with ERR_CONNECTION_REFUSED.
await page.goto("http://localhost:8899/", { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForSelector("#freeBtn:not([disabled])", { timeout: 240000 });
await page.evaluate(() => document.getElementById("freeBtn").click());
{
  const deadline = Date.now() + 420000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    ready = await page.evaluate(() => !!(window.__game && window.__game.renderer && window.__game.camera)).catch(() => false);
    if (!ready) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!ready) { console.log("  ERROR: __game never appeared; aborting rather than reporting fiction."); await browser.close(); process.exit(1); }
}
console.log("booted; letting the late batch passes run\n");

const rows = [];
for (const pt of POINTS) {
  const r = await page.evaluate(async ({ x, z }) => {
    const g = window.__game;
    // g.teleport(), not a bare playerPos.set: it moves the camera and the mesh too.
    // And step the districts by hand so their props are placed before we measure --
    // otherwise this reads the frame before OrleaRouge's scenery exists.
    g.teleport(x, z);
    for (let k = 0; k < 2; k++) {
      for (const d of [g.westParish, g.eastBank, g.tusouxroe, g.chatboro, g.shruston, g.charsoufre, g.crownStrip, g.stateWorld, g.orlea]) {
        if (d && d.update) d.update(1, g.playerPos);
      }
    }
    await new Promise((res) => setTimeout(res, 1200));
    // warmup: shader compile and texture upload are not what we are measuring
    for (let i = 0; i < 12; i++) await new Promise((res) => requestAnimationFrame(res));
    const times = [];
    let calls = 0, tris = 0;
    const N = 24;
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      await new Promise((res) => requestAnimationFrame(res));
      times.push(performance.now() - t0);
      // __game.renderer IS published (this was the other wrong guess in v1).
    const info = g.renderer && g.renderer.info && g.renderer.info.render;
      if (info) { calls = info.calls; tris = info.triangles; }
    }
    times.sort((a, b) => a - b);
    return {
      median: times[N >> 1],
      p90: times[Math.floor(N * 0.9)],
      calls, tris,
    };
  }, pt);
  rows.push({ ...pt, ...r });
  console.log(`  ${pt.name.padEnd(20)} ${r.median.toFixed(1)} ms/frame (p90 ${r.p90.toFixed(1)})  calls ${r.calls}  tris ${r.tris}`);
}

const gfx = gfxLines.filter((l) => /static batching/.test(l));
if (gfx.length) { console.log("\n  batcher:"); for (const l of gfx) console.log(`    ${l}`); }

const spawn = rows[0], others = rows.slice(1);
const avgOther = others.reduce((a, r) => a + r.median, 0) / others.length;
const ratio = spawn.median / avgOther;
console.log(`\n  OrleaRouge vs the other two: ${ratio.toFixed(2)}x`);
// Report, do not gate. This tool's value is the before/after number, and swiftshader
// timings are not the timings a real GPU sees -- a hard threshold here would be
// measuring the software rasteriser, not the game.
console.log("  (baseline before the cullGroups fix: OrleaRouge 1495 ms vs ~662/674 ms elsewhere, 2.3x)");
console.log("  swiftshader timings are indicative only -- read the RATIO, not the absolute ms");

await browser.close();