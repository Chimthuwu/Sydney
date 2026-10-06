// The 18+ acknowledgement race (adultContent.js).
//
//   node --experimental-detect-module tools/qa/adult_gate_race_test.mjs
//
// The bug this guards: index.html paints a STATIC 18+ gate inline and its
// button sets `window.__GTB_AGE_GATE_ACKNOWLEDGED = true` on click, while
// adultContent.js latched that same global ONCE at module-evaluation time
// (`let acknowledged = win?.__GTB_AGE_GATE_ACKNOWLEDGED === true`). The two
// run in parallel, so whenever the module graph evaluated before the player
// clicked "yes", `acknowledged` was stuck false for the rest of the session —
// `enabled()` could never be true, and every back-room prompt read
// "Back rooms disabled · adult opt-in required". mountLaunchGate(), the
// function meant to adopt that click, was never called from src/.
//
// It only failed *sometimes*, which is why it looked like "I don't know if
// it was working". This loads the module FIRST and clicks the gate after,
// which is the losing order, and requires the gate to be honoured.
import assert from "node:assert/strict";

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
};

function fakeElement(tag) {
  const listeners = {};
  return {
    tagName: tag.toUpperCase(), style: {}, children: [], dataset: {}, hidden: false, disabled: false, checked: false,
    append(...els) { this.children.push(...els); },
    appendChild(el) { this.children.push(el); },
    replaceChildren(...els) { this.children.length = 0; this.children.push(...els); },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    dispatch(type, event = {}) { for (const fn of listeners[type] || []) fn({ type, target: this, preventDefault() {}, stopImmediatePropagation() {}, ...event }); },
    setAttribute() {}, remove() { this.removed = true; }, focus() {},
    click() {
      if (this.tagName === "INPUT" && this.type === "checkbox") { this.checked = !this.checked; this.dispatch("change"); }
      this.dispatch("click");
    },
  };
}

// The module reads `globalThis` for its window, and touches the DOM through
// these. Nothing is clicked until AFTER the module has evaluated.
const body = fakeElement("body");
globalThis.document = { body, createElement: fakeElement };
globalThis.window = { addEventListener() {}, removeEventListener() {} };
const data = new Map();
globalThis.localStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };

const { createAdultContent } = await import("../../src/adultContent.js");
const content = createAdultContent({ document: globalThis.document, win: globalThis.window });

// ---- the losing order: module evaluated BEFORE the click -------------------
check("before the gate is clicked, nothing is enabled", content.enabled() === false,
  "not 18+ yet");
check("...and it is not acknowledged yet", content.acknowledged() === false);

// now the player clicks "yes" on the static first-paint gate
globalThis.window.__GTB_AGE_GATE_ACKNOWLEDGED = true;

check("the click is honoured even though the module loaded first",
  content.acknowledged() === true, "this is the bug: the flag was latched at load time");
check("...and that is all it takes now — no second box to tick",
  content.enabled() === true, "the 18+ gate is the only gate");

// ---- the night scene is what the back room actually calls ------------------
// franchiseClubs.js reaches for these two, so they are the contract.
const okOpen = content.openNightScene({
  venue: "HAPPY HOGS", price: 250, performerName: "Porkchop",
  perks: { text: "", pay: () => true, grant: () => ({ healed: 50, heat: 90 }) },
  onFinish: () => {},
});
check("openNightScene now runs instead of bailing out", okOpen === true);

// ---- and the winning order still works -------------------------------------
const data2 = new Map();
globalThis.localStorage = { getItem: (k) => data2.get(k) ?? null, setItem: (k, v) => data2.set(k, String(v)) };
globalThis.window.__GTB_AGE_GATE_ACKNOWLEDGED = true;      // clicked BEFORE the module
const content2 = createAdultContent({ document: globalThis.document, win: globalThis.window });
check("the ordinary order (click, then load) is unaffected", content2.enabled() === true);

// ---- and there is no second switch any more (2026-10-01) -------------------
// The pause-menu "ADULT CONTENT · 18+" checkbox was removed outright, so the
// removed API must actually be gone rather than left dormant: a control that is
// merely hidden but still callable is not a removed consent step.
const data3 = new Map();
globalThis.localStorage = { getItem: (k) => data3.get(k) ?? null, setItem: (k, v) => data3.set(k, String(v)) };
globalThis.window.__GTB_AGE_GATE_ACKNOWLEDGED = true;
const content3 = createAdultContent({ document: globalThis.document, win: globalThis.window });
check("answering the age question is the only gate", content3.enabled() === true);
check("the opt-in setter is gone", content3.setOptIn === undefined);
check("...and the opt-in control is gone", content3.createOptInControl === undefined);
check("...and nothing about it is written to storage", data3.size === 0, `${data3.size} key(s) written`);

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll adult-gate checks passed");
process.exit(failures ? 1 : 0);
