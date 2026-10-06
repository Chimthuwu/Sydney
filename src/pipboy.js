// ---------------------------------------------------------------------------
// pipboy.js — the character screens, drawn the way Fallout: New Vegas draws them: green phosphor on
// black, a header of tabs, a list on the left, the description of whatever you are pointing at below.
//
//   pipboy.create()          -> Promise<build | null>   character creation (SPECIAL + Zomboid-style traits)
//   pipboy.open(character)   the STAT / SPECIAL / SKILLS / PERKS / TRAITS screen (Tab); spends skill points
//   pipboy.close()  pipboy.isOpen
//   pipboy.hud(character)    the little level / XP readout under the health bars, and the level-up flag
//
// All state lives in stats.js; this file only draws it and passes the player's clicks back.
// ---------------------------------------------------------------------------

import { SPECIAL, SKILLS, TRAITS, PERKS, BACKGROUNDS, creationBudget, validateBuild, DEFAULT_BUILD } from "./stats.js";

// Two skins, both of them actually Fallout:
//   "fo3"    Fallout 3 — amber/gold phosphor, the warm monochrome of the 2008 Pip-Boy
//   "vegas"  New Vegas — the cooler green-on-near-black of the 2009 rebuild
// The old styling was cyan-to-magenta gradient glass with an RGB-ish scanline
// wash: a synthwave screen, not a Pip-Boy. Both themes keep the SAME class names,
// so switching is a single attribute flip on <html> and nothing else in this file
// changes. Defaults to "fo3" — the user asked for the Pip-Boy look back, and FO3
// is the one that reads as "Pip-Boy" at a glance.
const THEMES = {
  fo3: {
    label: "Fallout 3",
    vars: {
      "--pip-fg": "#ffb638", "--pip-dim": "#b8791f", "--pip-hot": "#ffd98a",
      "--pip-screen": "#141006", "--pip-screen2": "#0d0a04",
      "--pip-head": "#1d1508", "--pip-line": "rgba(255,182,56,.38)",
      "--pip-glow": "255,182,56", "--pip-sel": "rgba(255,182,56,.22)",
      "--pip-bar": "#ffcf6e", "--pip-barbg": "#2a1f0b",
      "--pip-ink": "#1a1206",
    },
  },
  vegas: {
    label: "New Vegas",
    vars: {
      "--pip-fg": "#4ce07a", "--pip-dim": "#2a9c4c", "--pip-hot": "#a6ffbe",
      "--pip-screen": "#04140a", "--pip-screen2": "#020c05",
      "--pip-head": "#07200f", "--pip-line": "rgba(76,224,122,.34)",
      "--pip-glow": "76,224,122", "--pip-sel": "rgba(76,224,122,.20)",
      "--pip-bar": "#8dffb0", "--pip-barbg": "#0b2a15",
      "--pip-ink": "#04140a",
    },
  },
};

const THEME_KEY = "gtb.pipboy.theme";

/** The player's chosen skin, remembered between sessions. Unknown values fall back to FO3. */
export function pipboyTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "vegas" ? "vegas" : "fo3";
  } catch { return "fo3"; }
}

/** Flip to the other skin. Returns the new theme id. */
export function cyclePipboyTheme() {
  const next = pipboyTheme() === "fo3" ? "vegas" : "fo3";
  try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode: just this session */ }
  applyPipboyTheme(next);
  return next;
}

/** Paint the active skin onto <html>, so both the Pip-Boy and the small HUD inherit it. */
export function applyPipboyTheme(id = pipboyTheme()) {
  // An unknown id must not throw, and must not paint a screen whose label does
  // not exist. Fall back before touching the DOM, and report what was actually
  // painted rather than what was asked for.
  const t = THEMES[id] ? id : "fo3";
  const root = document.documentElement;
  for (const [k, v] of Object.entries(THEMES[t].vars)) root.style.setProperty(k, v);
  root.dataset.pipTheme = t;
  return t;
}

const CSS = `
/* Every colour below is a --pip-* custom property set by applyPipboyTheme() from
   the THEMES table, so both skins are pure data and the two never diverge. */
#pip, #pipCreate, #xpHud, #stealthHud {
  --fg: var(--pip-fg); --acc: var(--pip-fg); --line: var(--pip-line);
  --grad: var(--pip-fg);
}
#pip, #pipCreate { position: fixed; inset: 0; z-index: 40; display: none; align-items: center; justify-content: center;
  background: radial-gradient(ellipse at 50% 40%, color-mix(in srgb, var(--pip-screen) 88%, transparent), color-mix(in srgb, var(--pip-screen2) 96%, transparent) 78%);
  font-family: "Courier New", ui-monospace, monospace; color: var(--fg); user-select: none; }
#pip.on, #pipCreate.on { display: flex; }
.pipScreen { position: relative; width: min(1120px, 96vw); height: min(680px, 92vh);
  border: 3px solid var(--pip-fg); border-radius: 10px;
  background: linear-gradient(180deg, var(--pip-screen) 0%, var(--pip-screen2) 100%);
  box-shadow: 0 0 30px rgba(var(--pip-glow), .22), inset 0 0 70px rgba(0,0,0,.6);
  display: flex; flex-direction: column; overflow: hidden;
  text-shadow: 0 0 5px rgba(var(--pip-glow), .45); }
/* the CRT scanline — the thing that makes it a Pip-Boy and not a web form */
.pipScreen::after { content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 2;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,.30) 0 1px, transparent 1px 3px); }
/* slow phosphor bloom, very subtle: enough to feel lit, not enough to strobe */
.pipScreen::before { content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 1;
  background: radial-gradient(ellipse at 50% 30%, rgba(var(--pip-glow), .10), transparent 70%); }
.pipHead { position: relative; z-index: 3; display: flex; align-items: center; gap: 20px; padding: 10px 18px;
  border-bottom: 2px solid var(--pip-line); background: var(--pip-head); font-size: 18px; letter-spacing: 2px; }
.pipHead .title { font-size: 22px; font-weight: bold; margin-right: auto; color: var(--pip-hot); }
.pipTab { padding: 2px 10px; cursor: pointer; opacity: .6; border: 1px solid transparent; border-radius: 3px; }
.pipTab.on { opacity: 1; border: 1px solid var(--pip-fg); background: var(--pip-sel); }
.pipBody { position: relative; z-index: 3; flex: 1; display: flex; min-height: 0; }
.pipCol { flex: 1; padding: 12px 18px; overflow-y: auto; min-width: 0; }
.pipCol + .pipCol { border-left: 1px solid var(--pip-line); }
.pipCol h3 { margin: 0 0 8px; font-size: 15px; letter-spacing: 2px; border-bottom: 1px dashed var(--pip-line); padding-bottom: 4px; color: var(--pip-hot); }
.pipRow { display: flex; align-items: center; gap: 8px; padding: 3px 6px; font-size: 16px; cursor: default; border-radius: 3px; }
.pipRow:hover, .pipRow.sel { background: var(--pip-sel); }
.pipRow .grow { flex: 1; }
.pipRow .val { min-width: 34px; text-align: right; }
.pipBtn { border: 1px solid var(--pip-fg); border-radius: 3px; background: var(--pip-sel); color: var(--fg);
  font: inherit; padding: 0 8px; cursor: pointer; text-shadow: inherit; }
.pipBtn:hover:not(:disabled) { background: rgba(var(--pip-glow), .38); }
.pipBtn:disabled { opacity: .3; cursor: default; }
.pipFoot { position: relative; z-index: 3; border-top: 2px solid var(--pip-line); background: var(--pip-head);
  padding: 10px 18px; min-height: 64px; font-size: 15px; display: flex; gap: 20px; align-items: center; }
.pipFoot .desc { flex: 1; }
.pipSkin { border: 1px solid var(--pip-line); border-radius: 3px; background: transparent; color: var(--pip-dim);
  font: inherit; font-size: 13px; letter-spacing: 1px; padding: 2px 8px; cursor: pointer; white-space: nowrap; }
.pipSkin:hover { color: var(--pip-hot); border-color: var(--pip-fg); }
.bad { color: #ff7a6a; text-shadow: 0 0 6px rgba(255,122,106,.5); }
.dim { opacity: .55; }
.pipBar { height: 12px; border: 1px solid var(--pip-fg); border-radius: 6px; overflow: hidden; }
.pipBar > i { display: block; height: 100%; background: var(--pip-bar); }
#xpHud { position: fixed; left: 14px; top: 112px; z-index: 12; font: bold 12px "Courier New", monospace;
  color: var(--pip-fg); text-shadow: 0 0 5px rgba(var(--pip-glow), .5);
  background: var(--pip-head); border: 1px solid var(--pip-line); border-radius: 4px;
  padding: 3px 8px; display: none; pointer-events: none; min-width: 226px; }
#xpHud .bar { height: 5px; margin-top: 3px; border: 1px solid var(--pip-line); border-radius: 3px; overflow: hidden; }
#xpHud .bar i { display: block; height: 100%; background: var(--pip-bar); }
#xpHud.up { animation: xpUp 1s ease-in-out infinite; }
@keyframes xpUp { 50% { box-shadow: 0 0 14px rgba(var(--pip-glow), .7); } }
#stealthHud { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 39;
  font: bold 13px "Courier New", monospace; letter-spacing: 3px; color: var(--pip-fg);
  background: var(--pip-head); border: 1px solid var(--pip-line); border-radius: 4px;
  padding: 3px 14px; display: none; pointer-events: none; text-shadow: 0 0 6px rgba(var(--pip-glow), .5); }
#stealthHud.caution { color: #ffd23a; border-color: #ffd23a; }
#stealthHud.danger { color: #ff5a4a; border-color: #ff5a4a; }
`;

const h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v; else if (k === "text") el.textContent = v; else if (k.startsWith("on")) el.addEventListener(k.slice(2), v); else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
};

/** The skin toggle. Clicking it flips the phosphor and repaints whatever is on screen. */
function skinButton(redraw) {
  const b = h("button", {
    class: "pipSkin", type: "button",
    title: "Switch Pip-Boy skin — remembered between sessions",
    text: (THEMES[pipboyTheme()] || THEMES.fo3).label.toUpperCase(),
  });
  b.addEventListener("click", () => {
    b.textContent = THEMES[cyclePipboyTheme()].label.toUpperCase();
    redraw?.();
  });
  return b;
}

export function createPipboy({ host = document.body, onOpen = () => {}, onClose = () => {} } = {}) {
  applyPipboyTheme();
  const style = h("style", { text: CSS });
  document.head.append(style);
  const overlay = h("div", { id: "pip" });
  const create = h("div", { id: "pipCreate" });
  host.append(overlay, create);
  const xpHud = h("div", { id: "xpHud" });
  const stealthHud = h("div", { id: "stealthHud" });
  host.append(xpHud, stealthHud);

  // ================================================================ creation
  let creationResolve = null;
  function openCreation() {
    return new Promise((resolve) => {
      creationResolve = resolve;
      const build = { name: "Survivor", special: { ...DEFAULT_BUILD.special }, traits: [], tagged: [], background: "none" };
      let hint = "Pick a point to read about it. Bad traits and low attributes give points back; good ones spend them.";
      const render = () => {
        const { attrPoints, traitPoints } = creationBudget(build);
        const errors = validateBuild(build);
        const setHint = (t) => { const d = create.querySelector(".desc"); if (d) d.textContent = t; };
        create.replaceChildren(h("div", { class: "pipScreen" },
          h("div", { class: "pipHead" }, h("span", { class: "title", text: "CHARACTER CREATION" }), skinButton(render),
            h("span", { class: attrPoints < 0 ? "bad" : "", text: `ATTRIBUTE POINTS ${attrPoints}` }),
            h("span", { class: traitPoints < 0 ? "bad" : "", text: `TRAIT POINTS ${traitPoints}` })),
          h("div", { class: "pipBody" },
            // ---- S.P.E.C.I.A.L.
            h("div", { class: "pipCol" }, h("h3", { text: "S.P.E.C.I.A.L." }),
              SPECIAL.map((s) => h("div", { class: "pipRow", onmouseenter: () => setHint(`${s.name}: ${s.blurb}`) },
                h("span", { class: "grow", text: s.name }),
                h("button", { class: "pipBtn", text: "−", disabled: build.special[s.id] <= 1, onclick: () => { build.special[s.id]--; render(); } }),
                h("span", { class: "val", text: String(build.special[s.id]) }),
                h("button", { class: "pipBtn", text: "+", disabled: build.special[s.id] >= 10 || attrPoints <= 0, onclick: () => { build.special[s.id]++; render(); } }))),
              h("p", { class: "dim", text: "5 is average. Take an attribute below 5 to earn points for another." }),
              h("h3", { text: "BACKGROUND" }),
              BACKGROUNDS.map((b) => h("div", { class: "pipRow" + (build.background === b.id ? " sel" : ""), onmouseenter: () => setHint(`${b.name}: ${b.blurb} ${Object.entries(b.skills).map(([k, v]) => `+${v} ${k}`).join(", ")}`), onclick: () => { build.background = b.id; render(); } },
                h("span", { class: "grow", text: (build.background === b.id ? "▶ " : "  ") + b.name })))),
            // ---- traits
            h("div", { class: "pipCol" }, h("h3", { text: "TRAITS  (good ones cost, bad ones pay)" }),
              TRAITS.map((t) => h("div", { class: "pipRow pipTrait" + (build.traits.includes(t.id) ? " taken" : ""), onmouseenter: () => setHint(`${t.name}: ${t.blurb}`),
                onclick: () => { const i = build.traits.indexOf(t.id); if (i >= 0) build.traits.splice(i, 1); else build.traits.push(t.id); render(); } },
                h("span", { class: "pipTag", text: build.traits.includes(t.id) ? "■" : "□" }),
                h("span", { class: "grow" + (t.cost < 0 ? " bad" : ""), text: t.name }),
                h("span", { class: "val" + (t.cost < 0 ? "" : ""), text: t.cost > 0 ? `−${t.cost}` : `+${-t.cost}` })))),
            // ---- skills, name, go
            h("div", { class: "pipCol" }, h("h3", { text: `TAG 3 SKILLS  (${build.tagged.length}/3)  +15 each` }),
              SKILLS.map((k) => h("div", { class: "pipRow" + (build.tagged.includes(k.id) ? " sel" : ""), onmouseenter: () => setHint(`${k.name}: ${k.blurb}`),
                onclick: () => { const i = build.tagged.indexOf(k.id); if (i >= 0) build.tagged.splice(i, 1); else if (build.tagged.length < 3) build.tagged.push(k.id); render(); } },
                h("span", { class: "pipTag", text: build.tagged.includes(k.id) ? "★" : "☆" }), h("span", { class: "grow", text: k.name }))),
              h("h3", { text: "NAME" }),
              h("input", { value: build.name, maxlength: 20, style: "width:100%;background:#0c0826;color:#e4e0ff;border:1px solid #9d8cff;font:inherit;padding:4px;", oninput: (e) => { build.name = e.target.value; } }),
              h("p", { class: errors.length ? "bad" : "dim", text: errors.length ? errors[0] : "Ready when you are." }))),
          h("div", { class: "pipFoot" }, h("div", { class: "desc", text: hint }),
            h("button", { class: "pipBtn", text: "BACK", onclick: () => { create.classList.remove("on"); creationResolve && creationResolve(null); creationResolve = null; } }),
            h("button", { class: "pipBtn", text: "RESET", onclick: () => { build.special = { ...DEFAULT_BUILD.special }; build.traits = []; build.tagged = []; build.background = "none"; render(); } }),
            h("button", { class: "pipBtn", text: "BEGIN", disabled: errors.length > 0, onclick: () => { if (errors.length) return; create.classList.remove("on"); const b = { ...build, name: (build.name || "Survivor").trim() || "Survivor" }; creationResolve && creationResolve(b); creationResolve = null; } }))));
      };
      render();
      create.classList.add("on");
    });
  }

  // ================================================================ the in-game screen
  let tab = "STATUS", ch = null, isOpen = false;
  const TABS = ["STATUS", "SPECIAL", "SKILLS", "PERKS", "TRAITS"];
  function draw() {
    if (!ch) return;
    const setDesc = (t) => { const d = overlay.querySelector(".desc"); if (d) d.textContent = t; };
    const bar = (f) => h("div", { class: "pipBar" }, h("i", { style: `width:${Math.round(Math.max(0, Math.min(1, f)) * 100)}%` }));
    let body;
    if (tab === "STATUS") {
      body = [
        h("div", { class: "pipCol" }, h("h3", { text: ch.name.toUpperCase() }),
          h("div", { class: "pipRow" }, h("span", { class: "grow", text: "Level" }), h("span", { class: "val", text: String(ch.level) })),
          h("div", { class: "pipRow" }, h("span", { class: "grow", text: `XP  ${ch.xp} / ${ch.xpToNext}` })), bar(ch.xpFrac),
          h("div", { class: "pipRow" }, h("span", { class: "grow", text: "Skill points" }), h("span", { class: "val" + (ch.skillPoints ? "" : " dim"), text: String(ch.skillPoints) })),
          h("div", { class: "pipRow" }, h("span", { class: "grow", text: "Perks to choose" }), h("span", { class: "val" + (ch.perkPoints ? "" : " dim"), text: String(ch.perkPoints) })),
          h("div", { class: "pipRow" }, h("span", { class: "grow", text: "Kills" }), h("span", { class: "val", text: String(ch.kills) })),
          h("div", { class: "pipRow" }, h("span", { class: "grow", text: "Background" }), h("span", { text: ch.background.name }))),
        h("div", { class: "pipCol" }, h("h3", { text: "EFFECTS" }),
          ...[
            ["Damage taken", `${Math.round(ch.mods.damageTakenMul() * 100)}%`], ["Firearm damage", `${Math.round(ch.mods.gunMul() * 100)}%`], ["Melee damage", `${Math.round(ch.mods.meleeMul() * 100)}%`],
            ["Crit chance", `${Math.round(ch.mods.critChance() * 100)}%`], ["Noticed by the dead", `${Math.round(ch.mods.stealthMul() * 100)}%`], ["Stamina", `${Math.round(ch.mods.staminaMul() * 100)}%`],
            ["Jump height", `${Math.round(ch.mods.jumpMul() * 100)}%`], ["Prices", `${Math.round(ch.mods.priceMul() * 100)}%`], ["Healing", `${Math.round(ch.mods.healMul() * 100)}%`], ["Loot", `${Math.round(ch.mods.lootMul() * 100)}%`],
          ].map(([k, v]) => h("div", { class: "pipRow" }, h("span", { class: "grow", text: k }), h("span", { class: "val", text: v })))),
      ];
    } else if (tab === "SPECIAL") {
      body = [h("div", { class: "pipCol" }, h("h3", { text: "S.P.E.C.I.A.L." }),
        SPECIAL.map((s) => h("div", { class: "pipRow", onmouseenter: () => setDesc(`${s.name}: ${s.blurb}`) }, h("span", { class: "grow", text: s.name }), h("span", { class: "val", text: String(ch.special[s.id]) }))))];
    } else if (tab === "SKILLS") {
      body = [h("div", { class: "pipCol" }, h("h3", { text: `SKILLS   points: ${ch.skillPoints}` }),
        SKILLS.map((k) => h("div", { class: "pipRow", onmouseenter: () => setDesc(`${k.name}: ${k.blurb}`) },
          h("span", { class: "pipTag", text: ch.tagged.includes(k.id) ? "★" : " " }), h("span", { class: "grow", text: k.name }),
          h("button", { class: "pipBtn", text: "+", disabled: !ch.skillPoints || ch.skill(k.id) >= 100, onclick: () => { if (ch.buySkill(k.id)) draw(); } }),
          h("span", { class: "val", text: String(ch.skill(k.id)) })))) ];
    } else if (tab === "PERKS") {
      body = [h("div", { class: "pipCol" }, h("h3", { text: `PERKS   to choose: ${ch.perkPoints}` }),
        PERKS.map((p) => {
          const has = ch.perks.includes(p.id), can = ch.canTakePerk(p);
          return h("div", { class: "pipRow" + (has ? " sel" : ""), onmouseenter: () => setDesc(`${p.name}: ${p.blurb}`) },
            h("span", { class: "pipTag", text: has ? "■" : "□" }), h("span", { class: "grow" + (has || can ? "" : " dim"), text: p.name }),
            h("button", { class: "pipBtn", text: "TAKE", disabled: !can, onclick: () => { if (ch.takePerk(p.id)) draw(); } }));
        }))];
    } else {
      body = [h("div", { class: "pipCol" }, h("h3", { text: "TRAITS" }),
        ch.traits.length ? ch.traits.map((id) => { const t = TRAITS.find((x) => x.id === id); return h("div", { class: "pipRow", onmouseenter: () => setDesc(`${t.name}: ${t.blurb}`) }, h("span", { class: "grow" + (t.cost < 0 ? " bad" : ""), text: t.name })); }) : h("p", { class: "dim", text: "None." }))];
    }
    overlay.replaceChildren(h("div", { class: "pipScreen" },
      h("div", { class: "pipHead" }, h("span", { class: "title", text: "PIP-BOY" }), TABS.map((t) => h("span", { class: "pipTab" + (t === tab ? " on" : ""), text: t, onclick: () => { tab = t; draw(); } })), skinButton(draw)),
      h("div", { class: "pipBody" }, body),
      h("div", { class: "pipFoot" }, h("div", { class: "desc", text: "Tab or Q to close." }), h("button", { class: "pipBtn", text: "CLOSE", onclick: () => api.close() }))));
  }

  // ================================================================ HUD
  let lastLevel = 0;
  const api = {
    create: openCreation,
    open(character) { if (!character) return; ch = character; isOpen = true; overlay.classList.add("on"); draw(); onOpen(); },
    close() { if (!isOpen) return; isOpen = false; overlay.classList.remove("on"); onClose(); },
    get isOpen() { return isOpen; },
    toggle(character) { if (isOpen) api.close(); else api.open(character); },
    /** Level / XP under the health bars, pulsing while there is something to spend. */
    hud(character) {
      if (!character) { xpHud.style.display = "none"; return; }
      xpHud.style.display = "block";
      const spend = character.skillPoints + character.perkPoints;
      xpHud.classList.toggle("up", spend > 0);
      xpHud.replaceChildren(document.createTextNode(`${character.name.toUpperCase()}  LVL ${character.level}${spend ? `   ▲ ${spend} to spend (Tab)` : ""}`),
        h("div", { class: "bar" }, h("i", { style: `width:${Math.round(character.xpFrac * 100)}%` })));
      lastLevel = character.level;
    },
    /** The stealth read-out: HIDDEN / CAUTION / DETECTED, with the stance. */
    stealth(text, level) { stealthHud.style.display = text ? "block" : "none"; stealthHud.textContent = text || ""; stealthHud.className = level || ""; },
    get level() { return lastLevel; },
  };
  return api;
}
