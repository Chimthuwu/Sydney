// menu_test.mjs — the main menu is the mode list, and it goes fullscreen.
//
// The root menu used to be "Start Game" -> a second panel listing Story /
// Free Roam / Zombie Survival Nightmare / Multiplayer, which put an extra click
// between the player and the game and made the two free-roam modes look like
// two different games. The user asked for the root menu to BE the list, with
// Free Roam starting the game directly, Story marked as new, and Load, Options
// and Exit on top level.
//
// index.html and main.js are both large and this cannot import them (main.js
// boots a whole game), so this reads the two files and checks the structure and
// the wiring that can silently rot: a menu item whose element no longer exists
// is a null dereference during boot.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "  ok  " : "  FAIL"} ${m}`); if (!c) fails++; };

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../../index.html"), "utf8");
const js = readFileSync(join(here, "../../src/main.js"), "utf8");

const rootNav = html.slice(html.indexOf('id="menuRoot"'), html.indexOf("</nav>", html.indexOf('id="menuRoot"')));
const items = [...rootNav.matchAll(/>([^<>]+)</g)].map((m) => m[1].trim()).filter((t) => t && t !== "Back");
console.log(`  root menu reads: ${items.join(" | ")}\n`);

// ---- the four things the user asked to be on the top level ----------------
ok(items.length >= 4, `the root menu is the mode list, not a "Start Game" step (${items.length} items)`);
ok(items[0] === "Free Roam", `Free Roam is the first entry and starts the game (got "${items[0]}")`);
ok(/^Story/i.test(items[1]) && /New/i.test(items[1]), `the second entry is Story, marked New (got "${items[1]}")`);
ok(items.some((t) => /^Load/i.test(t)), "Load is on the top level");
ok(items.some((t) => /^Options/i.test(t)), "Options is on the top level and enters the options panel");
ok(items.some((t) => /^Exit/i.test(t)), "Exit is on the top level and closes the game");

// ---- the old two-step "Start Game" panel is gone -------------------------
ok(!/data-menu="start"/.test(rootNav), "there is no Start Game submenu to click through any more");
ok(!/id="menuStartSub"/.test(html), "the old start sub-panel markup is removed");
ok(!/menuStartSub/.test(js), "and nothing in main.js still looks it up");

// ---- Zombie Survival is no longer its own entry --------------------------
ok(!/id="zombieBtn"/.test(html), "Zombie Survival Nightmare has no menu button any more");
ok(!/zombieBtn/.test(js), "and no code dereferences the removed button");
ok(!/zombieBtn/.test(rootNav), "it is not hiding in the root list either");

// ---- but zombie SAVES still work ----------------------------------------
ok(/d\.mode === "zombie"/.test(js),
  "a loaded zombie save still dispatches on its own mode, so old saves are not orphaned");
ok(/zombieMode/.test(js), "and the mode's own code is untouched");

// ---- the options and load panels still have somewhere to go back to -----
ok(/data-panel="options"/.test(html), "the options panel still exists");
ok(/data-panel="load"/.test(html), "the load panel still exists");
ok(/data-panel="exit"/.test(html), "the exit panel still exists (with its confirm)");
// One Back per sub-panel: options, load, and the exit confirm's "No".
const backCount = (html.match(/data-back="root"/g) || []).length;
const panelCount = (html.match(/data-panel="(?!root)[a-z]+"/g) || []).length;
ok(backCount >= panelCount, `every sub-panel has a way back to the root list (${backCount} back buttons, ${panelCount} sub-panels)`);

// ---- Multiplayer is kept: it is real work, not a duplicate mode ----------
ok(/id="multiplayerBtn"/.test(html), "Multiplayer is still reachable from the menu");

// ---- fullscreen ---------------------------------------------------------
ok(/goFullscreenOnMenu/.test(js), "the menu asks for fullscreen");
ok(/requestFullscreen/.test(js), "via the real requestFullscreen API, not a CSS fake");
ok(/navigationUI:\s*"hide"/.test(js), "with the navigation UI hidden");
// the request returns a promise that rejects when the document is not visible;
// an unhandled rejection here would surface as a console error on every load
ok(/\.catch\(/.test(js), "the request's rejection is caught -- browsers refuse it when the tab is hidden");
ok(/if \(fullscreenAsked\) return/.test(js), "and it only asks once, so it cannot re-trigger on every menu visit");
ok(/document\.fullscreenElement/.test(js), "and it does nothing if already fullscreen");
// The three events are bound in one `for (const ev of [...])` loop, so the
// listener line appears once and the count comes from the array literal.
const evList = js.match(/for \(const ev of \[([^\]]*)\]\)/);
const listenerCount = evList ? evList[1].split(",").filter((s) => s.trim()).length : 0;
ok(listenerCount >= 3, `bound to the first real interaction (${listenerCount} events), which is the user gesture browsers require`);
ok(/once: true/.test(js), "each is { once: true }, so the menu cannot re-request fullscreen on every visit");

// ---- Free Roam starts the game without a second click --------------------
ok(/freeBtn\.onclick = \(\) => \{ pendingLaunch = "free"/.test(js),
  "Free Roam launches immediately rather than opening another screen");
ok(!/freeBtn\.onclick[\s\S]{0,80}openCharacterSelect/.test(js),
  "and it does not detour through the character select first");

console.log(fails ? `\n${fails} FAILURES` : "\nall main-menu checks passed");
process.exit(fails ? 1 : 0);