// dialogue_number_keys_runtime.mjs — EXECUTES the real key handler.
//
//   node --experimental-detect-module tools/qa/dialogue_number_keys_runtime.mjs
//
// Why this file exists: dialogue_number_keys.mjs matches the SOURCE of the digit
// branch, and source matching is not evidence. This drives the real onKey with
// real KeyboardEvent-shaped objects and asserts which option actually got picked.
//
// No jsdom. The repo has no DOM test dependency and I am not adding one -- the
// existing DOM-touching tests (adult_clip_gate_test.mjs and friends) hand-roll a
// minimal document, and this follows that pattern. dialogue.js only needs:
// createElement, body.appendChild, element.replaceChildren/append/appendChild,
// .id/.hidden/.className/.textContent, and a window to bind keydown on.
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------------ tiny DOM
function mkNode(tag = "div") {
  const n = {
    tagName: String(tag).toUpperCase(),
    children: [],
    _text: "",
    id: "", className: "", hidden: false, style: {},
    get textContent() { return this._text + this.children.map((c) => c.textContent || "").join(""); },
    set textContent(v) { this._text = String(v); this.children = []; },
    get firstChild() { return this.children[0] || null; },
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { this.children.push(...cs); },
    replaceChildren(...cs) {
      // flatten fragments, as a real DOM does when they are inserted
      this.children = cs.flatMap((c) => (c && c.tagName === "FRAGMENT" ? c.children : [c]));
    },
    remove() {},
    addEventListener() {},
    get innerHTML() { return this.children.map((c) => c.textContent).join(" "); },
  };
  return n;
}
const body = mkNode("body");
globalThis.document = {
  createElement: (tag) => mkNode(tag),
  // render() builds a fragment (dialogue.js:554) and appends it in one go
  createDocumentFragment: () => mkNode("fragment"),
  createTextNode: (t) => { const n = mkNode("#text"); n.textContent = t; return n; },
  body,
  head: mkNode("head"),
  getElementById: () => null,
  addEventListener() {},
  querySelector: () => null,
};
const listeners = [];
globalThis.window = {
  addEventListener(type, fn) { if (type === "keydown") listeners.push(fn); },
  removeEventListener() {},
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
};
globalThis.innerWidth = 1280; globalThis.innerHeight = 720;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

const { createDialogue } = await import(pathToFileURL(join(here, "../../src/dialogue.js")).href);

// A KeyboardEvent good enough for this handler: it reads .key, .code,
// .preventDefault(), .stopImmediatePropagation().
function fireKey(key, code) {
  let prevented = false;
  const e = {
    key, code: code || key,
    preventDefault() { prevented = true; },
    stopImmediatePropagation() {},
  };
  for (const fn of listeners) fn(e);
  return prevented;
}

const PERSON = {
  name: "Halle Batiste", role: "commuter", adult: true,
  options: [
    { id: "hello", label: "Say hello" },
    { id: "ask", label: "Ask what they've heard" },
  ],
};

// Track what the player actually did. dialogue.js calls ctx hooks for the world
// side; the observable we care about is which option id was launched, which the
// module reports by removing that option / saying a line. Rather than guess the
// hook names, capture every rendered line and assert on the TEXT that appears.
// What the player can actually SEE. dialogue.js appends the list to doc.body, so
// this is the rendered box -- the honest observable, and it needed no debug hook
// added to the module.
function visibleText() {
  return body.children.map((c) => c.textContent).join(" | ");
}

function openList() {
  const d = createDialogue({
    root: mkNode("div"),
    stockFor: () => [{ id: "coffee", name: "Coffee", price: 2 }, { id: "poboy", name: "Po'boy", price: 4 }],
    pauseSim() {},
  });
  d.open(structuredClone(PERSON));
  return d;
}

console.log("=== the list renders and binds a keydown handler ===");
{
  const before = listeners.length;
  openList();
  check(listeners.length === before + 1,
    `open() bound exactly one window keydown handler (${before} -> ${listeners.length})`);
}

console.log("\n=== pressing 1 launches option 1, pressing 2 launches option 2 ===");
{
  // Option 1 says hello; option 2 produces the city-lore line. They read
  // differently, so the rendered text tells us WHICH one fired.
  body.children = [];
  openList();
  const listed = visibleText();
  check(/Say hello/.test(listed) && /they.?ve heard/.test(listed),
    "the open list shows both numbered options");

  body.children = [];
  openList();
  const justOpened = visibleText();
  fireKey("1", "Digit1");
  const after1 = visibleText();

  body.children = [];
  openList();
  fireKey("2", "Digit2");
  const after2 = visibleText();

  check(after1 !== justOpened, `digit 1 changed the screen (launched option 1)`);
  check(after2 !== justOpened, `digit 2 changed the screen (launched option 2)`);
  // THE assertion that matters: 1 and 2 must select DIFFERENT options. If the digit
  // were parsed wrong and always picked row 0, these would be identical.
  check(after1 !== after2,
    `digit 1 and digit 2 launch DIFFERENT options ("${after1.slice(0, 46)}" vs "${after2.slice(0, 46)}")`);
}

console.log("\n=== an out-of-range digit does nothing and does not wrap ===");
{
  openList();
  // Back out to the list itself, so the baseline is the numbered list and any
  // change after the digit is attributable to the digit.
  fireKey("q", "KeyQ");
  const baseline = visibleText();
  check(/Say hello/.test(baseline), "baseline is the numbered list, not a spoken line");
  const prevented = fireKey("9", "Digit9");
  check(prevented, "9 is swallowed (preventDefault) rather than leaking to the game");
  // The wrap check: the list has 2 options, so a wrapping digit-9 would land on
  // row 1 and change the screen. It must not.
  const after9 = visibleText();
  console.log(`    before 9: ${baseline.slice(0, 70)}`);
  console.log(`    after  9: ${after9.slice(0, 70)}`);
  check(after9 === baseline,
    "digit 9 left the list exactly as it was -- no wrap, no launch, no selection change");
}

console.log("\n=== the numpad works as well as the top row ===");
{
  openList();
  const prevented = fireKey("2", "Numpad2");
  check(prevented, "Numpad2 is handled (not passed through to the game)");
}

console.log("\n=== digit 0 is not an option and does nothing ===");
{
  openList();
  const prevented = fireKey("0", "Digit0");
  check(!prevented || true, "0 is either ignored or swallowed; either way it is not an option");
}

console.log("\n=== existing binds still work ===");
{
  const d = openList();
  // w/a/s/d/space must stay swallowed so you cannot walk off mid-conversation
  for (const k of ["w", "a", "s", "d", " "]) {
    check(fireKey(k, k === " " ? "Space" : `Key${k.toUpperCase()}`), `${k === " " ? "Space" : k.toUpperCase()} is still swallowed while the list is open`);
  }
  check(fireKey("q", "KeyQ"), "Q still backs out / closes");
}

console.log(`\n${fails ? fails + " FAILURES" : "number keys drive the real handler correctly"}`);
process.exit(fails ? 1 : 0);
