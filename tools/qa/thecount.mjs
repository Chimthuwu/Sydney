import { openTheDoors } from "./lib/gates.mjs";
// Headless walkthrough of ACT TWO "THE COUNT" (theCount.js) in the real game:
// free roam, start the mission by hook (as the night ride's end would), then
// visit two stops — the penitentiary and Belle Plantation — and the finale's
// first beat. Screenshots mid-scene; phases, tally and objective in the log.
//
//   node <browser-automation>/browser.mjs http://localhost:8899/ --script tools/qa/thecount.mjs
//
// SHOT_PREFIX sets the screenshot path prefix (default: ./count).
async function inPage(page, body) {
  await page.addScriptTag({
    content: `try { document.body.dataset.r = JSON.stringify((function(){ ${body} })()); }
              catch (e) { document.body.dataset.r = JSON.stringify({ error: String(e && e.stack || e) }); }`,
  });
  return JSON.parse(await page.evaluate(() => document.body.dataset.r || "null"));
}

const SNAP = `
  const g = window.__game, T = g.theCount;
  const sub = document.querySelector("#cineSub"), card = document.querySelector("#cineCard");
  return {
    phase: T && T.phase, total: T && T.total, counted: T && T.counted, busy: T && T.busy,
    cinematic: g.state.cinematic,
    objective: document.getElementById("objective").textContent,
    subtitle: sub.classList.contains("on") ? sub.textContent.trim().slice(0, 120) : null,
    card: card.classList.contains("on") ? card.textContent.trim().replace(/\\s+/g, " ").slice(0, 120) : null,
    player: [Math.round(g.playerPos.x), Math.round(g.playerPos.z)],
  };
`;

export default async function run(page) {
  await openTheDoors(page);
  const out = process.env.SHOT_PREFIX || "count";
  const log = { steps: [], seen: [] };
  const check = (expr) => inPage(page, `const g = window.__game; return !!(${expr});`);
  async function pressUntil(key, expr, label, { every = 700, timeout = 90000 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if ((await check(expr)) === true) { log.steps.push(`${label}: ok in ${Date.now() - t0} ms`); return true; }
      if (key) await page.keyboard.press(key);
      await page.waitForTimeout(every);
    }
    log.steps.push(`${label}: TIMED OUT`);
    return false;
  }
  /** Let a scene play for `ms`, collecting every subtitle and card it shows. */
  async function watch(ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const s = await inPage(page, SNAP);
      for (const t of [s.card, s.subtitle]) if (t && log.seen[log.seen.length - 1] !== t) log.seen.push(t);
      await page.waitForTimeout(400);
    }
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForFunction(() => { const b = document.getElementById("freeBtn"); return b && !b.disabled; }, null, { timeout: 240000 });
  await page.click("#freeBtn");                     // the main menu IS the mode list now (d50ced3)
  // a character select may or may not come up first, depending on the mode
  await pressUntil(null, `(() => { const s = document.getElementById("characterSelect"); return (s && !s.hidden) || g.state.running; })()`, "menu -> game or character select", { timeout: 240000 });
  if (await page.$("#characterSelect:not([hidden]) #confirmCharacter")) await page.click("#confirmCharacter");
  await pressUntil(null, `g.state.running && g.theCount && g.theCount.phase === "idle" && !g.state.cinematic`, "free roam, mission waiting", { timeout: 240000 });

  await inPage(page, `return window.__game.theCount.start();`);
  await watch(6000);
  await pressUntil("Escape", `g.theCount.phase === "count" && !g.state.cinematic`, "opening -> count");
  log.afterOpening = await inPage(page, SNAP);

  for (const [id, x, z, shot] of [["penitentiary", 1095, 302, "-1-penitentiary.png"], ["belle", 571, -258, "-2-belle.png"]]) {
    await inPage(page, `window.__game.teleport(${x}, ${z}, 0); return true;`);
    await pressUntil(null, `g.theCount.busy`, `${id}: scene starts`, { every: 250, timeout: 20000 });
    await watch(9000);
    await page.screenshot({ path: out + shot });
    await watch(7000);
    await pressUntil("Escape", `g.theCount.counted.includes("${id}") && !g.state.cinematic`, `${id}: counted`);
    log[id] = await inPage(page, SNAP);
  }
  log.final = await inPage(page, SNAP);
  return log;
}
