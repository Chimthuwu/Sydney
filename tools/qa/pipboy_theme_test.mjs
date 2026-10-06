// pipboy_theme_test.mjs — the Pip-Boy has two real skins, and they are remembered.
//
// The old Pip-Boy was a cyan-to-magenta gradient glass panel with an RGB scanline
// wash. That is a synthwave screen; it is not a Pip-Boy. The user asked for the
// Fallout look back, and for two of them so the New Vegas flavour is available
// alongside the Fallout 3 one.
//
// This drives the real module: switches skins, checks the phosphor actually
// changes, and checks the choice survives a fresh read of localStorage.
import { installBrowserStub } from "./lib/browser_stub.mjs";
installBrowserStub();

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "  ok  " : "  FAIL"} ${m}`); if (!c) fails++; };

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

// pipboy.js paints its skins as CSS custom properties on <html>, and the shared
// browser stub's documentElement really does store them, so cssVar() below reads
// back exactly what the module painted. If setProperty were never called, or were
// called with the wrong value, the Pip-Boy would be showing the wrong phosphor
// and this test would see it.
const { pipboyTheme, cyclePipboyTheme, applyPipboyTheme } = await import("../../src/pipboy.js");
const cssVar = (k) => document.documentElement.style.getPropertyValue(k);

// ---- default is Fallout 3, not Vegas and not nothing
ok(pipboyTheme() === "fo3", `the Pip-Boy defaults to Fallout 3 (got "${pipboyTheme()}")`);

// ---- the two skins are genuinely different colour schemes, not one with a rename
applyPipboyTheme("fo3");
const fo3 = ["--pip-fg", "--pip-screen", "--pip-glow", "--pip-bar"].map(cssVar);
applyPipboyTheme("vegas");
const vegas = ["--pip-fg", "--pip-screen", "--pip-glow", "--pip-bar"].map(cssVar);
ok(fo3.every(Boolean) && vegas.every(Boolean), `both skins define every colour they need (fo3 ${fo3[0]}, vegas ${vegas[0]})`);
ok(fo3.join("|") !== vegas.join("|"), "the two skins are different colours, not the same panel renamed");
ok(document.documentElement.dataset.pipTheme === "vegas", "the active skin is recorded on <html>");

// ---- Fallout 3 is amber; New Vegas is green. That is the whole point.
const isAmber = (c) => { const m = c.match(/^#(\w\w)(\w\w)(\w\w)$/); return m && parseInt(m[1], 16) > 150 && parseInt(m[3], 16) < 120; };
const isGreen = (c) => { const m = c.match(/^#(\w\w)(\w\w)(\w\w)$/); return m && parseInt(m[2], 16) > 120 && parseInt(m[1], 16) < 130; };
applyPipboyTheme("fo3");
ok(isAmber(cssVar("--pip-fg")), "Fallout 3 is amber/gold phosphor");
applyPipboyTheme("vegas");
ok(isGreen(cssVar("--pip-fg")), "New Vegas is green phosphor");

// ---- toggling flips it, and the choice is remembered
store.delete("gtb.pipboy.theme");
ok(pipboyTheme() === "fo3", "clearing the saved skin falls back to Fallout 3");
const first = cyclePipboyTheme();
ok(first === "vegas", `one toggle switches to New Vegas (got "${first}")`);
ok(pipboyTheme() === "vegas", "and it is remembered, not just applied");
ok(cyclePipboyTheme() === "fo3", "toggling again goes back to Fallout 3");
ok(pipboyTheme() === "fo3", "that choice is remembered too");

// ---- a nonsense saved value must not brick the Pip-Boy
store.set("gtb.pipboy.theme", "neon-hyperdrive");
ok(pipboyTheme() === "fo3", `an unknown saved skin falls back safely (got "${pipboyTheme()}")`);
ok(applyPipboyTheme("neon-hyperdrive") === "fo3", "and painting an unknown skin does not throw");

console.log(fails ? `\n${fails} FAILURES` : "\nall Pip-Boy theme checks passed");
process.exit(fails ? 1 : 0);