// ---------------------------------------------------------------------------
// sydney_browser_test.mjs — Sydney has to load in a real browser.
//
// The headless lane test proves the network is drivable in the abstract. This
// proves the other half: that ?sydney=1 boots, builds the city, and puts the
// player on a road - in the actual game, with the actual renderer, through the
// actual access gate.
//
// Run: node tools/qa/sydney_browser_test.mjs
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { readFile } from "node:fs/promises";
import puppeteer from "puppeteer";

const root = process.cwd();
const html = await readFile(path.join(root, "index.html"), "utf8");
const accessHash = html.match(/var GTB_ACCESS_HASH = "([a-f0-9]+)"/)?.[1];
assert.ok(accessHash, "private access hash is present in the page");

const probe = net.createServer();
await new Promise((r, j) => probe.listen(0, "127.0.0.1", r).once("error", j));
const port = probe.address().port;
await new Promise((r, j) => probe.close((e) => (e ? j(e) : r())));

const app = spawn(process.execPath, ["serve.mjs", String(port)], { cwd: root, stdio: "ignore" });
let browser;
let failed = 0;
const check = (label, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${detail ? `  (${detail})` : ""}`);
};

try {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }

  browser = await puppeteer.launch({
    ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
    protocolTimeout: 300000,
    headless: true,
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio", "--no-sandbox"],
  });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  // The private-access gate shows unless localStorage already holds the hash
  // (index.html: `if (localStorage.getItem(REMEMBER_KEY) === GTB_ACCESS_HASH)
  // gate.remove()`). Seeding it is how a returning device gets in, and it means
  // the screenshot below is the game rather than a password box over the game -
  // which is what stubbing crypto.subtle alone produces, because the game still
  // boots behind the gate but the gate stays painted on top of it.
  const rememberKey = html.match(/var REMEMBER_KEY = "([^"]+)"/)?.[1] || "gtb.access.ok";
  await page.evaluateOnNewDocument((key, hash) => {
    try { localStorage.setItem(key, hash); } catch {}
    const bytes = Uint8Array.from(hash.match(/../g), (p) => parseInt(p, 16));
    Object.defineProperty(window, "crypto", {
      configurable: true,
      value: { subtle: { digest: () => Promise.resolve(bytes.buffer) } },
    });
  }, rememberKey, accessHash);

  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  const logs = [];
  page.on("console", (m) => { if (m.text().startsWith("[sydney]")) logs.push(m.text()); });

  await page.goto(`http://127.0.0.1:${port}/?sydney=1`, { waitUntil: "domcontentloaded", timeout: 120000 });

  // Wait for the game to report that it built Sydney, rather than a fixed sleep.
  let stats = null;
  const built = Date.now() + 180000;
  while (Date.now() < built) {
    stats = await page.evaluate(() => window.__sydneyStats || null);
    if (stats) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  check("the page boots with no uncaught errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
  check("the Sydney world is built", !!stats, stats ? "" : "window.__sydneyStats never appeared");

  if (stats) {
    console.log(`\n  Sydney built: ${stats.roadKm} km of tarmac in ${stats.drawCalls} draw calls,`);
    console.log(`  ${stats.lanes} traffic lanes over ${stats.laneKm} km, ${stats.laneLinks} junction links.\n`);
    check("there is a city to drive", stats.roadKm > 100, `${stats.roadKm} km`);
    check("the road mesh is cheap", stats.drawCalls <= 4, `${stats.drawCalls} draw calls`);
    check("traffic has a network to drive", stats.lanes > 1000 && stats.laneLinks > 1000,
      `${stats.lanes} lanes, ${stats.laneLinks} links`);
  }

  const spawn = await page.evaluate(() => window.__sydneySpawn || null);
  check("the player spawns on a real road", !!spawn && spawn.onRoad,
    spawn ? `(${Math.round(spawn.x)}, ${Math.round(spawn.z)}) on ${spawn.street || "a Sydney street"}` : "no spawn reported");

  // There are two gates between the page and the game: the private-access
  // password and the 18+ age confirmation. Both are static markup in index.html
  // and both stay painted over the canvas until dismissed, so a screenshot taken
  // without this photographs a dialog rather than the city. The age gate asks
  // again on every start, so it cannot be pre-seeded the way the access one can.
  await page.evaluate(() => document.getElementById("gtbAgeYes")?.click());
  await new Promise((r) => setTimeout(r, 2000));

  const gatesGone = await page.evaluate(() =>
    !document.getElementById("gtbAccessGate") && !document.getElementById("gtbAdultGate"));
  check("both gates are dismissed, so the view is the game", gatesGone);

  // ...and then the menu. Two clicks, and the timing matters:
  //   [data-menu=start]  "Start Game"  -> opens the mode submenu
  //   #freeBtn           "Free Roam"   -> calls confirmCharacter() DIRECTLY and
  //                                       launches the game (main.js: freeBtn's
  //                                       handler does not open character select)
  //
  // FREE ROAM, not Story. Story deliberately teleports the player to
  // PROLOGUE_START in Chatboro, Louisiana and plays the opening cutscene there
  // (confirmCharacter) - so selecting it in Sydney mode would move the player
  // out of the city this test exists to photograph. The campaign is not ported
  // yet, and this is the honest way to find that out.
  //
  // The wait is not decoration. The menu buttons stay `disabled` until loading
  // finishes and `beginGame` is assigned (main.js, near the end of boot), and a
  // disabled button silently ignores .click(). Clicking as soon as the world
  // reports itself built - which happens much earlier - does nothing at all, and
  // the run then quietly photographs the title screen with every other check
  // passing.
  await page.waitForFunction(() => {
    const b = document.getElementById("freeBtn");
    return !!b && !b.disabled;
  }, { timeout: 180000, polling: 400 });
  check("the menu becomes ready", true);

  const click = async (sel) => {
    const ok = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el || el.disabled) return false;
      el.click();
      return true;
    }, sel);
    await new Promise((r) => setTimeout(r, 1500));
    return ok;
  };
  check("the title menu opens", await click('[data-menu="start"]'));
  check("Free Roam starts the game", await click("#freeBtn"));

  // The world is already built (stats above), so this is letting the first
  // frames run.
  await new Promise((r) => setTimeout(r, 10000));

  const running = await page.evaluate(() => !!window.__sydneyRender?.running);
  check("the game is actually running", running);

  // state.running is the game's own "we are in the world" flag. Reading it beats
  // guessing from the DOM, which is three panels deep and easy to get wrong.
  const inWorld = await page.evaluate(() => {
    const vis = (id) => { const e = document.getElementById(id); if (!e) return "absent";
      if (e.hidden) return "hidden"; const s = getComputedStyle(e);
      return s.display === "none" || s.visibility === "hidden" || s.opacity === "0" ? "hidden" : "VISIBLE"; };
    return {
      overlay: vis("overlay"), introPanel: vis("introPanel"), characterSelect: vis("characterSelect"),
      canvas: (() => { const c = document.querySelector("canvas"); return c ? `${c.width}x${c.height}` : "none"; })(),
    };
  });
  console.log("  panels:", JSON.stringify(inWorld));

  // The overlay is UI painted OVER the world, and it is the overlay that holds
  // the menu - not the renderer. Hide it so the screenshot is the city, which is
  // the thing worth looking at. The canvas size is the evidence that the
  // renderer is live and drawing into a real framebuffer.
  check("the renderer has a real framebuffer", inWorld.canvas !== "none" && !/^0x/.test(inWorld.canvas), inWorld.canvas);
  await page.evaluate(() => {
    // The menu is a set of .menu-list / .menu-panel navs plus the overlay that
    // holds them, not one #overlay element - hiding the wrong one leaves the
    // title screen painted over the city while every check passes.
    for (const sel of ["#overlay", ".menu-list", ".menu-panel", "#menuRoot", "#introPanel", "#characterSelect"]) {
      for (const e of document.querySelectorAll(sel)) e.style.display = "none";
    }
  });
  await new Promise((r) => setTimeout(r, 1500));

  // Pin the clock to midday before the screenshot. A Sydney frame shot at
  // whatever hour the load happened to finish at is not evidence of anything:
  // a night frame and a noon frame are both "the renderer is drawing", and
  // only one of them can show whether the city is actually lit and visible.
  await page.evaluate(() => window.__game && window.__setHour && window.__setHour(12));
  await new Promise((r) => setTimeout(r, 1200));

  // What is actually painted at the centre of the screen? Asking beats guessing
  // which selector covers the menu, and two rounds of guessing were already wrong.
  const onTop = await page.evaluate(() => {
    const e = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    const chain = [];
    let n = e;
    while (n && n !== document.documentElement) {
      const cls = typeof n.className === "string" ? n.className.split(/\s+/).filter(Boolean).join(".") : "";
      chain.push(`${n.tagName}${n.id ? "#" + n.id : ""}${cls ? "." + cls : ""}`);
      n = n.parentElement;
    }
    return chain;
  });
  console.log("  topmost at screen centre:", onTop.slice(0, 5).join("  ->  "));

  // THE check that matters: is anything actually being drawn? A canvas can be
  // present, correctly sized, and topmost in the DOM while rendering nothing at
  // all, in which case the screenshot shows the CSS background behind it - which
  // is a picture of the title screen that looks, to a careless eye, like a
  // rendered city. perf.calls is the game's own count of draw calls last frame.
  const render = await page.evaluate(() => window.__sydneyRender || null);
  console.log("  renderer:", JSON.stringify(render));
  check("the renderer is actually drawing the world", !!render && render.calls > 0,
    render ? `${render.calls} draw calls, ${render.tris} triangles, player at (${Math.round(render.x)}, ${Math.round(render.z)})` : "no render info");

  await page.screenshot({ path: path.join(root, "sydney-qa.png") });
  console.log("\n  wrote sydney-qa.png");

  // NOT photographed from above, deliberately. Lifting the player to look down
  // on the street grid is the obvious way to show the roads, and it does not
  // work: first person puts the camera at the player's head so it stares at the
  // horizon, the orbit camera (V) keeps its pitch, and the city is unlit at the
  // game's default hour. Every attempt produced a picture of sky that a reader
  // would take for a broken renderer. The road surface is verified by its
  // geometry instead - 149.5 km in 2 draw calls - and by the headless test,
  // which walks the lanes. A misleading screenshot is worse than none.
} finally {
  await browser?.close();
  app.kill();
}

console.log(failed ? `\n${failed} check(s) FAILED\n` : "\nall checks passed\n");
process.exit(failed ? 1 : 0);
