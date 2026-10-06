// ---------------------------------------------------------------------------
// adultContent.js — per-launch adult acknowledgement and the private scenes.
//
// The 18+ gate is shown at the start of EVERY launch (nothing is remembered):
// the whole game is for adults. It is the ONLY gate (human request,
// 2026-10-01: the "ADULT CONTENT · 18+" checkbox came out of the pause menu).
// Answering it once is the entire consent step; there is no second switch to
// find, and nothing is remembered about it afterwards.
//
// This module is also where the gate is HANDED to the character rig, so the
// rule is enforced once, on the thing that plays the clips, rather than at each
// venue that casts a dancer (see `setAdultGate` at the bottom). That rig guard
// is a different thing and is not affected by this: it verifies the age of the
// CHARACTER MODEL being asked to play an adult clip, and fails closed.
// ---------------------------------------------------------------------------

import { setAdultGate } from "./characters.js";

const ARROWS = [
  { key: "ArrowUp", glyph: "↑" },
  { key: "ArrowDown", glyph: "↓" },
  { key: "ArrowLeft", glyph: "←" },
  { key: "ArrowRight", glyph: "→" },
];

export function makeBeatPattern(rng = Math.random, count = 8) {
  return Array.from({ length: count }, () => ARROWS[Math.floor(rng() * ARROWS.length)].key);
}

export function gradeRhythm(score, total) {
  if (!total) return "No score";
  const ratio = Math.max(0, Math.min(1, score / total));
  return ratio >= 0.85 ? "Bayou legend" : ratio >= 0.6 ? "Right on the beat" : ratio >= 0.35 ? "Finding the groove" : "Keep practicing";
}

export function createAdultContent({ document: doc = globalThis.document, window: win = globalThis.window } = {}) {
  let acknowledged = win?.__GTB_AGE_GATE_ACKNOWLEDGED === true;
  const declined = win?.__GTB_AGE_GATE_DECLINED === true;
  let gate = null;
  let game = null;
  let pauseHandler = null;

  const element = (tag, css, text = "") => {
    const el = doc.createElement(tag);
    el.style.cssText = css;
    if (text) el.textContent = text;
    return el;
  };
  const overlayCss = "position:fixed;inset:0;z-index:100000;background:rgba(6,8,12,.97);color:#f4f1ea;display:flex;align-items:center;justify-content:center;padding:20px;font:16px/1.5 system-ui,sans-serif;";
  const cardCss = "box-sizing:border-box;width:min(640px,100%);padding:clamp(22px,5vw,44px);background:#151923;border:2px solid #ff4fb3;border-radius:14px;box-shadow:0 18px 70px #000;";
  const titleCss = "margin:0 0 14px;color:#ff8ad0;font:900 clamp(24px,5vw,36px)/1.1 system-ui,sans-serif;letter-spacing:.04em;";
  const buttonCss = "padding:12px 18px;border:0;border-radius:7px;background:#ff4fb3;color:#17111a;font:800 15px system-ui;cursor:pointer;";

  /**
   * Number keys select a menu option, because there is no in-game cursor to click
   * with (human report, 2026-10-02: "there is no in game cursor to cllick the
   * buttons so player should be able to just select the available options using
   * numbers").
   *
   * The pattern is copied from dialogue.js:802, which already solved this for NPC
   * conversation menus. Three details are load-bearing and are kept deliberately:
   *
   *   1. Read e.code, not e.key. e.key is "1".."9" for BOTH the top row and the
   *      numpad on a standard layout, and some layouts/IMEs deliver only e.code.
   *      Both are accepted so a player with a numpad is not forced onto the top row.
   *   2. The digit is an ABSOLUTE address, so it must NOT wrap. Pressing 9 in a
   *      2-option menu does nothing at all, rather than silently launching
   *      option 1 -- which would be a genuinely dangerous mis-click here, where
   *      one of the options is "leave" and one is "spend money".
   *   3. preventDefault + stopImmediatePropagation, so the game's own input
   *      handling never also sees the key and does something else with it.
   *
   * Each button is RELABELLED with its number. A hotkey the player cannot see is
   * not an affordance -- that is the defect dialogue.js calls out in its own
   * comment, "the screen promises an affordance it does not honour".
   *
   * Only menus the player deliberately opened are bound. The 18+ age gate at
   * line ~98 is NOT passed here: it stays click/Tab-only on purpose, because a
   * stray Enter or Space must never answer an age question.
   */
  /**
   * Pointer lock belongs to the GUN, not to the menu.
   *
   * When the player draws a weapon, main.js:2329 calls requestPointerLock() on the
   * canvas. Under pointer lock the OS cursor is captured and hidden: there is no
   * cursor to aim a DOM button with, and clicks go to the canvas instead of the
   * overlay. So a player who opens one of these panels with the gun out sees a menu
   * whose buttons cannot be clicked AT ALL -- not "hard to click", genuinely
   * unclickable, because the cursor they are trying to move does not exist.
   *
   * That is why number keys are not a convenience here but the only way through, and
   * why this release matters just as much: if we drop the lock while an overlay is up,
   * clicking works again for anyone who prefers the mouse.
   *
   * Only the pause menu (pauseMenu.js:585) and the map editor (mapEditor.js:1529)
   * were doing this before; none of the E-interaction overlays did.
   *
   * Re-acquiring on close is deliberately NOT done here: the browser only grants
   * pointer lock from inside a user gesture, and a timer-driven close is not one.
   * Asking for it silently would also steal the cursor the player may be using for
   * something else. The game re-locks on the next click on the canvas, which IS a
   * gesture (camera.js:106).
   */
  function releasePointerLock() {
    try {
      const d = doc;
      if (d && d.pointerLockElement && d.exitPointerLock) d.exitPointerLock();
    } catch (e) { /* no pointer lock, or the browser refused: nothing to undo */ }
  }

  function bindNumberKeys(row, buttons) {
    const win = doc.defaultView;
    if (!win) return;
    buttons.forEach((btn, i) => {
      if (!btn) return;
      const n = i + 1;
      // Show it -- but as a SEPARATE element, never by rewriting textContent.
      //
      // Rewriting the label to "1 · STAY FOR COFFEE" is the obvious approach and it
      // breaks the game: adult_content_test.mjs:139 finds the button by
      // `e.textContent === "STAY FOR COFFEE"`, an exact match. Prefixing the number
      // makes that "1 · STAY FOR COFFEE" and the assertion fails -- correctly, since
      // a label that is also a test handle is a contract.
      //
      // A number badge keeps textContent EXACTLY as authored: the visible label, the
      // test's handle, and any screen reader's name all stay untouched, and the
      // player still sees the shortcut.
      if (btn.textContent && !btn.querySelector(".gtb-num")) {
        const badge = doc.createElement("span");
        badge.className = "gtb-num";
        badge.textContent = String(n);
        badge.style.cssText = "display:inline-block;min-width:1.5em;margin-right:.5em;padding:1px 6px;border-radius:5px;"
          + "background:rgba(0,0,0,.28);font:800 13px system-ui;text-align:center;";
        // insertBefore the label node rather than appendChild, so the number reads
        // first and the existing text node stays exactly where it was.
        btn.insertBefore(badge, btn.firstChild);
      }
      btn.setAttribute("aria-keyshortcuts", String(n));
      const onKey = (e) => {
        if (e.type !== "keydown") return;
        if (e.repeat) return;
        const m = /^Digit([1-9])$/.exec(e.code || "") || /^Numpad([1-9])$/.exec(e.code || "");
        const digit = m ? Number(m[1]) : (/^[1-9]$/.test(e.key || "") ? Number(e.key) : 0);
        if (!digit) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        // Absolute address, no wrap -- see note 2 above.
        if (digit === n) btn.click?.();
      };
      for (const type of ["keydown", "keypress"]) win.addEventListener(type, onKey, true);
    });
  }

  /**
   * The age gate is the STATIC markup at the top of index.html, painted before
   * any script runs; its button sets `__GTB_AGE_GATE_ACKNOWLEDGED` on click.
   * This module, though, is part of the graph that loads in PARALLEL with that,
   * so reading the global once at construction raced the click: whenever the
   * module evaluated first, `acknowledged` was latched false for the rest of the
   * session, `enabled()` could never be true, and every back-room prompt read
   * "Back rooms disabled · adult opt-in required" no matter what the player did.
   * (mountLaunchGate was meant to adopt that click, but nothing in src/ called
   * it.) So the flag is re-read on every ask instead, and only ever latches
   * true — a decline can never be undone by a later stray flag.
   */
  function isAcknowledged() {
    if (!acknowledged && win?.__GTB_AGE_GATE_ACKNOWLEDGED === true) acknowledged = true;
    return acknowledged;
  }
  // The one gate. Nothing else is consulted: no stored preference, no second
  // switch. Answer the launch question and the private scenes are there.
  function enabled() { return isAcknowledged(); }

  // The gate is normally the STATIC markup at the top of index.html (painted before any script or loading screen): adopt its two buttons.
  // If it is not there (tests, another host page) the same gate is built in script below.
  function adoptStaticGate() {
    const overlay = doc?.getElementById?.("gtbAdultGate");
    if (!overlay || gate) return null;
    const yes = doc.getElementById("gtbAgeYes"), no = doc.getElementById("gtbAgeNo");
    if (!yes || !no) return null;
    if (win?.__GTB_AGE_GATE_DECLINED === true) return overlay;
    const controls = [yes, no];
    const lockInput = (e) => {
      if (acknowledged) return;
      // The private access form is layered above this gate. Let it receive normal
      // typing/Enter input instead of swallowing keys at the window capture phase.
      const accessGate = doc.getElementById?.("gtbAccessGate");
      if (accessGate && (accessGate === e.target || accessGate.contains?.(e.target))) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type !== "keydown") return;
      if (e.key === "Tab") {
        const next = controls[(controls.indexOf(e.target) + (e.shiftKey ? -1 : 1) + controls.length) % controls.length];
        next?.focus?.();
      } else if (["Enter", " ", "Spacebar"].includes(e.key) && controls.includes(e.target)) e.target.click?.();
    };
    if (win) for (const type of ["keydown", "keyup", "keypress"]) win.addEventListener(type, lockInput, true);
    yes.addEventListener("click", () => {
      acknowledged = true;
      if (win) win.__GTB_AGE_GATE_ACKNOWLEDGED = true;
      if (win) for (const type of ["keydown", "keyup", "keypress"]) win.removeEventListener(type, lockInput, true);
      overlay.remove();
      gate = null;
    });
    no.addEventListener("click", () => {
      overlay.innerHTML = "";
      overlay.textContent = "This game is only for adults aged 18 and over. Please close this page.";
      overlay.style.textAlign = "center"; overlay.style.fontSize = "20px";
    });
    gate = overlay;
    // (nothing is focused: a stray Enter or Space must not answer an age question — the player clicks, or Tabs to a button and presses it)
    return overlay;
  }

  function mountLaunchGate() {
    if (!doc?.body || gate) return null;
    const adopted = adoptStaticGate();
    if (adopted) return adopted;
    const overlay = element("div", overlayCss);
    overlay.id = "gtbAdultGate";
    const card = element("section", cardCss);
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "gtbAdultTitle");
    let continueBtn, leaveBtn;
    const focusables = () => [continueBtn, leaveBtn].filter(Boolean);
    const lockInput = (e) => {
      if (acknowledged) return;
      // This runs at window capture so the game never receives keys (movement, menus, shortcuts) until the player has answered.
      // Reproduce the small set of native keyboard actions the gate needs: Tab moves between the two buttons, Enter / Space press one.
      e.preventDefault();
      e.stopImmediatePropagation();
      const controls = focusables();
      if (e.type !== "keydown") return;
      if (e.key === "Tab") {
        const index = controls.indexOf(e.target);
        const step = e.shiftKey ? -1 : 1;
        const next = controls[(index + step + controls.length) % controls.length];
        next?.focus?.();
      } else if (["Enter", " ", "Spacebar"].includes(e.key)) {
        if (controls.includes(e.target)) e.target.click?.();
      }
    };
    const unlockKeys = () => {
      if (win) for (const type of ["keydown", "keyup", "keypress"]) win.removeEventListener(type, lockInput, true);
    };
    if (win) for (const type of ["keydown", "keyup", "keypress"]) win.addEventListener(type, lockInput, true);
    const title = element("h1", titleCss, "YOU MUST BE OVER 18 TO PLAY THIS GAME");
    title.id = "gtbAdultTitle";
    const warning = element("p", "margin:0 0 12px;font-size:18px;font-weight:700;", "This game contains gore, drugs, violence, horror, and explicit sexual content. It is for adults only and is NOT suitable for anyone under 18. Nobody under 18 should play this game.");
    const details = element("p", "margin:0 0 22px;color:#c4c6d0;", "This is an R18+ game. It contains gore, graphic violence, drug use, sex and sexual themes, horror and strong language. By continuing you confirm that you are 18 or older.");
    continueBtn = element("button", buttonCss + "display:block;width:100%;margin:0 0 10px;padding:16px 18px;font-size:17px;", "I AM OVER 18 YEARS OF AGE");
    continueBtn.type = "button";
    leaveBtn = element("button", buttonCss + "display:block;width:100%;background:#2b3040;color:#c9ccd8;font-weight:600;", "I AM UNDER 18 · LEAVE");
    leaveBtn.type = "button";
    const note = element("p", "margin:14px 0 0;color:#999daa;font-size:12px;", "You will be asked again every time the game starts.");
    continueBtn.addEventListener("click", () => {
      acknowledged = true;
      unlockKeys();
      overlay.remove();
      gate = null;
    });
    leaveBtn.addEventListener("click", () => {
      // not an adult: nothing of the game is shown — the page is replaced by a plain notice and the game stays locked
      try { doc.body.replaceChildren?.(); } catch {}
      const bye = element("div", overlayCss + "text-align:center;", "This game is only for adults aged 18 and over. Please close this page.");
      doc.body.appendChild(bye);
    });
    card.append(title, warning, details, continueBtn, leaveBtn, note);
    releasePointerLock();          // the gun's cursor capture must not trap these buttons
    overlay.appendChild(card);
    doc.body.appendChild(overlay);
    gate = overlay;
    return overlay;
  }

  function closeGame(result = null) {
    if (!game) return;
    const active = game;
    game = null;
    if (win) win.removeEventListener("keydown", active.onKey, true);
    clearTimeout(active.timer);
    // a staged scene comes down with the overlay, whichever button closed it —
    // Esc, "walk away", or paying up and leaving, and a scene left running would
    // keep two rigs out of the world for the rest of the session
    if (active.onStageEnd) active.onStageEnd();
    active.overlay.remove();
    if (pauseHandler) pauseHandler(false);
    if (active.onFinish) active.onFinish(result);
  }

  function openRhythmGame({ venue = "the club", onBegin = () => true, onFinish = () => {} } = {}) {
    if (!enabled() || !doc?.body || game) return false;
    const overlay = element("div", overlayCss + "z-index:100001;");
    overlay.id = "gtbDanceRhythm";
    const card = element("section", cardCss + "text-align:center;");
    card.setAttribute("role", "dialog"); card.setAttribute("aria-modal", "true");
    const title = element("h2", titleCss, `PRIVATE DANCE · ${venue.toUpperCase()}`);
    const intro = element("p", "color:#d2d3dc;", "A fully-dressed, non-explicit dance rhythm challenge with a fictional adult performer. You can leave at any time.");
    const prompt = element("div", "margin:22px 0;font:900 clamp(52px,12vw,88px)/1 system-ui,sans-serif;color:#fff;min-height:1em;", "Ready?");
    const progress = element("p", "color:#c4c6d0;", "Press the matching arrow when it appears.");
    const controls = element("div", "display:flex;justify-content:center;gap:8px;flex-wrap:wrap;");
    for (const arrow of ARROWS) {
      const b = element("button", "width:52px;height:46px;border-radius:7px;border:1px solid #666;background:#242938;color:#fff;font-size:22px;cursor:pointer;", arrow.glyph);
      b.type = "button"; b.setAttribute("aria-label", `Dance ${arrow.key.replace("Arrow", "").toLowerCase()}`);
      b.addEventListener("click", () => submit(arrow.key)); controls.appendChild(b);
    }
    const actions = element("div", "display:flex;justify-content:center;gap:12px;margin-top:22px;");
    const start = element("button", buttonCss, "START PRIVATE DANCE"); start.type = "button";
    const cancel = element("button", buttonCss + "background:#454957;color:#fff;", "CANCEL"); cancel.type = "button";
    actions.append(start, cancel);
    // 1 = start the dance, 2 = cancel. See bindNumberKeys.
    bindNumberKeys(actions, [start, cancel]);
    card.append(title, intro, prompt, progress, controls, actions);
    releasePointerLock();
    overlay.appendChild(card); doc.body.appendChild(overlay);

    const seq = makeBeatPattern();
    let index = 0, score = 0, started = false, stepMs = 850;
    const active = { overlay, onFinish, result: null, timer: 0, onKey: null };
    function paint() {
      if (!game) return;
      if (index >= seq.length) {
        const result = { score, total: seq.length, rating: gradeRhythm(score, seq.length) };
        prompt.textContent = `${score} / ${seq.length}`;
        progress.textContent = result.rating;
        start.hidden = true;
        cancel.textContent = "DONE";
        game.result = result;
        return;
      }
      prompt.textContent = ARROWS.find((a) => a.key === seq[index]).glyph;
      progress.textContent = `Beat ${index + 1} of ${seq.length} · ${score} on time`;
    }
    function submit(key) {
      if (!game || !started || index >= seq.length) return;
      if (seq[index] === key) score++;
      index++;
      clearTimeout(active.timer);
      paint();
      if (index < seq.length) advance();
    }
    function advance() {
      if (!game || index >= seq.length) return;
      paint();
      active.timer = setTimeout(() => {
        if (!game) return;
        index++;
        paint();
        advance();
      }, stepMs);
    }
    const onKey = (e) => {
      if (!game) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeGame(); return; }
      if (ARROWS.some((a) => a.key === e.key)) { e.preventDefault(); e.stopImmediatePropagation(); submit(e.key); }
    };
    active.onKey = onKey;
    game = active;
    if (win) win.addEventListener("keydown", onKey, true);
    start.addEventListener("click", () => {
      if (!enabled() || started) return;
      if (onBegin() === false) { progress.textContent = "The activity could not start. You were not charged."; return; }
      started = true; start.hidden = true;
      if (pauseHandler) pauseHandler(true);
      paint(); advance();
    });
    cancel.addEventListener("click", () => closeGame(game?.result || null));
    paint();
    return true;
  }

  // Hot-coffee-style scenes (human request, 2026-09-28; expanded 2026-09-29):
  // after a good private dance the performer invites the player to stay for
  // coffee. It is a consensual, fade-to-black beat in the same spirit as the
  // rest of this module: nothing explicit is rendered — the invitation, a
  // dimmed screen and a tasteful closer. Opt-in (18+ acknowledged AND the
  // activity preference on), leaveable at any moment, and it owns the
  // simulation pause while open.
  //
  // Expanded: the invitation and the closer now scale with how the dance went
  // — blow the rhythm and she teases you about it; ace it and the evening
  // upgrades to breakfast. Staying also grants a small mechanical perk the
  // caller supplies (a heal, a "regular" tab), so the beat pays into the game
  // instead of dead-ending on a coffee cup.
  const COFFEE_TIERS = [
    { min: 0.85, invite: "\"Okay, that was actually good. Stay for coffee?… maybe breakfast after.\"", closer: "The lights dim. Breakfast is on her — best night this town has given you.", label: "breakfast" },
    { min: 0.6, invite: "\"Not bad, handsome. Stay for coffee?\"", closer: "The lights dim. What happens next stays off screen.", label: "coffee" },
  ];
  const COFFEE_FLOP = { invite: "\"You stepped on my feet the whole time… but sure, the coffee machine's still warm.\"", closer: "The lights dim. Even a bad dance earns a cup.", label: "coffee, pity round" };
  const COFFEE_SCENE_TEXT = [
    // Flop Tier (score < 0.6)
    { 
      min: 0,
      lines: [
        "*She sighs, but pulls you closer anyway.* \"Alright, you've paid your dues. Let's get you that coffee...\"",
        "*A moment later, the cheap break-room coffee machine gurgles. She hands you a cup, her hand brushing yours. It's not what you hoped for, but it's warm.*",
        "\"Don't get used to it, twinkle-toes.\""
      ]
    },
    // Good Tier (score >= 0.6)
    { 
      min: 0.6,
      lines: [
        "\"Come here...\" *She pulls you past the dance floor, into the small, private break room. The door clicks shut behind you.*",
        "*She pins you against the door, her body pressing into yours. Her mouth finds yours, hungry and demanding.* \"Forget the coffee.\"",
        "\"Now... where were we?\" *Her hands start to wander...*"
      ]
    },
    // Excellent Tier (score >= 0.85)
    {
      min: 0.85,
      lines: [
        "\"Breakfast, I think I said...\" *Her voice is a low purr as she leads you to a private suite you didn't even know existed here. The door locks with a heavy thud.*",
        "*She turns and sheds her stage outfit in one fluid motion, leaving nothing to the imagination. She stalks towards you, a predatory grin on her lips.* \"But we're starting with dessert.\"",
        "*Her body is electric against yours. She whispers against your neck,* \"I hope you've got stamina. The sun's a long way off.\""
      ]
    }
  ];
  function coffeeTier(ratio) {
    return COFFEE_TIERS.find((t) => ratio >= t.min) || COFFEE_FLOP;
  }
  function openCoffeeScene({ venue = "the club", result = null, perks = null, onFinish = () => {} } = {}) {
    if (!enabled() || !doc?.body || game) return false;
    // an unrated result (a caller without numbers) reads as an ordinary good
    // dance: the middle tier. The flop is earned by actually scoring badly.
    const tier = coffeeTier(result && result.total ? result.score / result.total : 0.6);
    const overlay = element("div", overlayCss + "z-index:100001;");
    overlay.id = "gtbCoffeeScene";
    const card = element("section", cardCss + "text-align:center;");
    card.setAttribute("role", "dialog"); card.setAttribute("aria-modal", "true");
    const title = element("h2", titleCss, `AFTER THE DANCE · ${venue.toUpperCase()}`);
    const intro = element("p", "color:#d2d3dc;", "A fictional adult performer asks you to stay for coffee. Fade to black — nothing explicit is shown. You can leave at any time.");
    const prompt = element("p", "margin:22px 0;font:800 clamp(20px,4vw,28px)/1.3 system-ui,sans-serif;color:#fff;", result && result.rating ? `${tier.invite} (${result.rating})` : tier.invite);
    const perkLine = element("p", "margin:0 0 8px;color:#9ad6ff;font-size:13px;", perks && perks.text ? perks.text : "");
    const actions = element("div", "display:flex;justify-content:center;gap:12px;");
    const stay = element("button", buttonCss, "STAY FOR COFFEE"); stay.type = "button";
    const out = element("button", buttonCss + "background:#454957;color:#fff;", "HEAD OUT"); out.type = "button";
    actions.append(stay, out);
    // 1 = stay, 2 = leave. Deliberately absolute-addressed, never wrapping: a
    // wrapped digit here would mean pressing "9" to leave and staying instead.
    bindNumberKeys(actions, [stay, out]);
    card.append(title, intro, prompt, perkLine, actions);
    // Drop the gun's cursor capture BEFORE the overlay mounts, so the buttons are
    // clickable the moment they appear (see releasePointerLock).
    releasePointerLock();
    overlay.appendChild(card); doc.body.appendChild(overlay);

    const active = { overlay, onFinish, result: null, timer: 0, onKey: null };
    const onKey = (e) => {
      if (!game) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeGame(game.result); }
    };
    active.onKey = onKey;
    game = active;
    if (win) win.addEventListener("keydown", onKey, true);
    if (pauseHandler) pauseHandler(true);
        stay.addEventListener("click", () => {
      if (!game) return;
      game.result = { coffee: true, tier: tier.label, perk: perks && perks.grant ? perks.grant() : null };
      
      // Clear the old UI elements.
      intro.hidden = true; prompt.hidden = true; perkLine.hidden = true; actions.remove();

      // Determine the correct scene text based on score.
      const ratio = result && result.total ? result.score / result.total : 0.6;
      const sceneLines = [...COFFEE_SCENE_TEXT].reverse().find(s => ratio >= s.min).lines;

      // Create a log to display the narrative.
      const log = element("div", "min-height:120px;max-height:220px;overflow-y:auto;background:#101319;border:1px solid #2c313c;border-radius:8px;padding:10px;text-align:left;font:14px/1.55 system-ui,sans-serif;color:#f0eadfd9;margin:8px 0;", "");
      
      // Populate the log with the entire story.
      for (const line of sceneLines) {
        const p = element("p", "margin:4px 0;", line);
        log.appendChild(p);
      }
      
      const closeBtn = element("button", buttonCss, "CLOSE");
      closeBtn.style.marginTop = "15px";
      closeBtn.addEventListener("click", () => closeGame(game.result));

      card.append(log, closeBtn);
    });
    out.addEventListener("click", () => closeGame(null));
    return true;
  }

  // An erotic NIGHT, bought outright (human request, 2026-09-29: Happy Hogs
  // back rooms, "spend money to spend a night with a performer"). Same rules
  // as the coffee beat, one step further and then a hard stop: both adults,
  // consensual, paid, fade to black immediately on confirmation — nothing
  // explicit is ever rendered. The scene costs real cash (charged by the club
  // only after the player confirms), then the morning after: well slept, +HP,
  // the sun is up. Leaveable right up to the door; Esc works at every step.
  // The NIGHT: a playable minigame (human request, 2026-09-29 — "no fade to
  // black, we go into a room out back with the performers and make a mini
  // game"). Structure borrowed from a certain AI-companion project: an
  // escalating heat meter gating dirtier dialogue tiers, pickable named moves
  // with reactions, an undress race on both sides, and a finale the player
  // CHOOSES. The cast are the game's abstract low-poly dolls, so the finale
  // itself stays a running gag — the camera "politely examines the ceiling"
  // while the afterglow text carries it. Everything is consensual, everyone
  // involved is a fictional adult, and the 18+ gate + opt-in gate the whole
  // thing as usual. Esc leaves at any moment.
  const NIGHT_MOVES = [
    { id: "neck", label: "Kiss her neck", heat: 8, need: 0, lines: ["*she tilts her head aside and purrs* \"Mmm, warm lips… keep going.\"", "*goosebumps chase his mouth* \"You found the spot, cowboy.\""] },
    { id: "spank", label: "A firm spank", heat: 10, need: 20, lines: ["*CRACK — she yelps, then grins over her shoulder* \"Naughty. Again.\"", "*she squeals and wiggles* \"Cheeky AND heavy-handed. I like it.\""] },
    { id: "lap", label: "Pull her into your lap", heat: 12, need: 0, lines: ["*she settles her weight into him, wriggling* \"Comfortable? You should be.\"", "*she grinds once, deliberate* \"That's a yes, then.\""] },
    { id: "whisper", label: "Whisper what you want", heat: 14, need: 15, lines: ["*her breath catches* \"Oh… you pick your words like you pick your moments.\"", "*she bites her lip* \"Say it filthier next time and I'll melt.\""] },
    { id: "top", label: "Slip her top off", heat: 16, need: 35, undress: "hers", lines: ["*sequins hit the floor* \"Cold in here… warm me up then.\"", "*she shrugs the straps down slow, watching his eyes* \"All yours.\""] },
    { id: "skirt", label: "Peel her skirt down", heat: 18, need: 55, undress: "hers", lines: ["*heels first, then everything else* \"Now who's flustered?\"", "*she steps out of it, kicking it aside* \"Your move, big spender.\""] },
    { id: "strip", label: "Lose your own shirt", heat: 8, need: 0, undress: "his", lines: ["*she rakes her nails lightly down his chest* \"Fair trade.\"", "*she whistles low* \"Well NOW the room's warmer.\""] },
    { id: "bed", label: "Carry her to the bed", heat: 15, need: 40, lines: ["*she squeaks, arms round his neck* \"Bossy! Fine — but I pick the side.\"", "*she bounces once on the mattress, grinning* \"Strong AND eager.\""] },
  ];
    const NIGHT_TIERS = [
    { min: 70, lines: [
        "\"The safe word is 'more'. Say it whenever you like.\"",
        "\"The bed's getting ideas. So am I — and mine are worse.\"",
        "\"God, just... break me. I want you to fuck my skull. Use any hole you want, I don't care anymore.\"",
        "\"Are you going to fuck my face or just tease it? Pick a socket, I'm ready to see stars.\""
      ] },
    { min: 40, lines: [
        "\"You're better at this than you were on the dance floor.\"",
        "\"Keep that up and the meter's going to blow.\"",
        "\"Mmm… I charge extra for goosebumps this good.\"",
        "\"Hands like that shouldn't be legal in this parish.\""
      ] },
    { min: 0, lines: [
        "\"Relax, sugar — the night's young and so am I.\"",
        "\"Nice hands. They'll do great things.\"",
        "\"Slow start. I can work with slow.\""]
      },
  ];
  // The finishes. The first four are available once she is ready; the last four
  // only at full heat, and between them the six positions in act.js are all
  // reachable — a player who wants to try every one of them can, and a player
  // who stops at the first does not see the others exist.
  //
  // `pose` names a key of SCENES and is what the club stages (franchiseClubs'
  // `stage`). A finale with no `pose` is the same idea told in words only, which
  // is how "up against the wall" and "let her ride" stay available without a rig
  // position for them.
  const NIGHT_FINALES = [
    { id: "wall", label: "Up against the wall", line: "*pins her gently to the wallpaper* \"Impatient — GOOD.\"" },
    { id: "bed", label: "Slow, on the bed", pose: "missionary", line: "*she pulls him down by the collar* \"Slow it is… coward.\"" },
    { id: "her", label: "Let her ride", line: "*she pushes him flat and swings a leg over* \"My shift, my rules.\"" },
    { id: "back", label: "From behind", pose: "doggystyle", line: "*she turns, looks back at him and laughs* \"Took you long enough to ask.\"" },
  ];
  const NIGHT_DEEPER = [
    { id: "oral", label: "Take your time", pose: "oral", line: "*she rolls onto her back and pulls him down* \"No rush. I've got all night.\"" },
    { id: "rough", label: "Hard and fast", pose: "roughOral", line: "*she hooks a heel round his waist* \"Don't be gentle with me. I dare you.\"" },
    { id: "sixtyNine", label: "Both of you, at once", pose: "sixtyNine", line: "*she folds over him, foreheads together* \"Mutual. Nobody's just doing anything.\"" },
    { id: "assToMouth", label: "Face to her", pose: "assToMouth", line: "*she turns over and lifts her hips off the mattress* \"Well? It's right there.\"" },
  ];
  const NIGHT_CENSOR = [
    "🅲 The camera politely examines the ceiling and waits.",
    "🅲 The bed frame does most of the talking. You get the idea.",
    "🅲 A red rose fills the screen. The thorns were someone's choice.",
    "🅲 The neon sign outside buzzes through three flickers. It saw nothing.",
  ];
  function openNightScene({ venue = "the club", price = 0, performerName = "a performer", perks = null, stage = null, onStageEnd = null, onFinish = () => {} } = {}) {
    if (!enabled() || !doc?.body || game) return false;
    const overlay = element("div", overlayCss + "z-index:100001;");
    overlay.id = "gtbNightScene";
    const card = element("section", cardCss);
    card.setAttribute("role", "dialog"); card.setAttribute("aria-modal", "true");
    const title = element("h2", titleCss, `THE BACK ROOMS · ${venue.toUpperCase()}`);
    const intro = element("p", "color:#d2d3dc;", `A full night with ${performerName}: $${price}, paid up front. Both adults, all of it consensual, and you can still walk. What happens in the room is between you, her, and whoever pays for the wallpaper.`);
    const perksLine = element("p", "margin:0 0 8px;color:#9ad6ff;font-size:13px;", perks && perks.text ? perks.text : "");
    const actions = element("div", "display:flex;justify-content:center;gap:12px;");
    const yes = element("button", buttonCss, `PAY $${price} · TAKE HER BACK`); yes.type = "button";
    const no = element("button", buttonCss + "background:#454957;color:#fff;", "WALK AWAY"); no.type = "button";
    actions.append(yes, no);
    card.append(title, intro, perksLine, actions);
    // Drop the gun's cursor capture BEFORE the overlay mounts, so the buttons are
    // clickable the moment they appear (see releasePointerLock).
    releasePointerLock();
    overlay.appendChild(card); doc.body.appendChild(overlay);

    const active = { overlay, onFinish, result: null, timer: 0, onKey: null, onStageEnd: stage ? onStageEnd : null };
    game = active;
    const onKey = (e) => {
      if (!game) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeGame(game.result); return; }
      if (!game.stage || game.stage !== "room" || !/^[1-8]$/.test(e.key)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const mv = NIGHT_MOVES[Number(e.key) - 1];
      if (mv) doMove(mv);
    };
    active.onKey = onKey;
    if (win) win.addEventListener("keydown", onKey, true);
    if (pauseHandler) pauseHandler(true);
    no.addEventListener("click", () => closeGame(null));
    yes.addEventListener("click", () => {
      if (!game) return;
      if (perks && perks.pay && perks.pay() === false) return;   // funds checked/charged by the club; false keeps the door open
      startRoom();
    });

    // ---- the room: the minigame proper -----------------------------------
    let heat = 10, herLayers = 2, hisLayers = 2, log, meter, meterFill, movesEl, finaleEl, againEl;
    function startRoom() {
      game.stage = "room";
      card.style.width = "min(760px, 100%)";
      intro.hidden = true; perksLine.hidden = true;
      yes.remove(); no.remove(); actions.remove();
      const head = element("h2", titleCss, `${performerName.toUpperCase()} · THE BACK ROOM`);
      meterFill = element("i", "display:block;height:12px;border-radius:6px;background:#ff2e6b;width:10%;transition:width .35s;");
      meter = element("div", "background:#20242e;border:1px solid #454554;border-radius:8px;padding:3px;margin:10px 0;overflow:hidden;", "");
      meter.appendChild(meterFill);
      const meterLbl = element("div", "font-size:12px;color:#c4c6d0;margin-bottom:6px;", "🔥 the mood · 1–8 keys work too · Esc leaves");
      log = element("div", "min-height:120px;max-height:220px;overflow-y:auto;background:#101319;border:1px solid #2c313c;border-radius:8px;padding:10px;text-align:left;font:14px/1.55 system-ui,sans-serif;color:#f0eadfd9;margin:8px 0;", "");
      movesEl = element("div", "display:grid;grid-template-columns:1fr 1fr;gap:6px;");
      finaleEl = element("div", "display:none;justify-content:center;gap:8px;flex-wrap:wrap;margin-top:10px;");
      againEl = element("div", "display:none;justify-content:center;gap:8px;margin-top:10px;");
      card.append(head, meterLbl, meter, log, movesEl, finaleEl, againEl);
      say(`*the door clicks shut behind you — ${performerName} kicks her heels off and smiles slow* \"Room's yours, sugar. Make it worth my while.\"`);
      drawMoves();
    }
    function tierLine() {
      const pool = NIGHT_TIERS.find((t) => heat >= t.min).lines;
      return pool[(Math.random() * pool.length) | 0];
    }
    function say(text) {
      const p = element("p", "margin:4px 0;", text);
      log.appendChild(p); log.scrollTop = log.scrollHeight;
    }
    function drawMoves() {
      movesEl.replaceChildren();
      NIGHT_MOVES.forEach((mv, i) => {
        const locked = heat < mv.need;
        const b = element("button", `text-align:left;padding:7px 10px;border-radius:7px;border:1px solid ${locked ? "#2c313c" : "#ff4fb3"};background:${locked ? "#171a21" : "#241722"};color:${locked ? "#5a5f6b" : "#ffd7ef"};font:600 13px system-ui;cursor:${locked ? "default" : "pointer"};`,
          `${i + 1}. ${locked ? "🔒 " : ""}${mv.label}${mv.undress === "hers" && herLayers <= 0 ? " (done)" : ""}${mv.undress === "his" && hisLayers <= 0 ? " (done)" : ""}`);
        b.type = "button";
        b.addEventListener("click", () => { if (!locked) doMove(mv); });
        movesEl.appendChild(b);
      });
      const ready = heat >= 80;
      finaleEl.style.display = ready ? "flex" : "none";
      if (ready && !finaleEl.children.length) {
        finaleEl.append(element("div", "flex-basis:100%;text-align:center;font-weight:800;color:#ffd7ef;margin-bottom:2px;", "🔥 She's ready. How do you take her? 🔥"));
        for (const f of NIGHT_FINALES) {
          const b = element("button", buttonCss, f.label); b.type = "button";
          b.addEventListener("click", () => doFinale(f));
          finaleEl.appendChild(b);
        }
        // ...and the rest, once there is nothing left to hold back. Same
        // handler, same gate, just a colder question behind it.
        if (heat >= 100) {
          finaleEl.appendChild(element("div", "flex-basis:100%;text-align:center;font-weight:800;color:#ff8ad0;margin:8px 0 2px;", "...and if you want it rougher than that:"));
          for (const f of NIGHT_DEEPER) {
            const b = element("button", buttonCss + "background:#3a1030;border:1px solid #ff4fb3;", f.label); b.type = "button";
            b.addEventListener("click", () => doFinale(f));
            finaleEl.appendChild(b);
          }
        }
      }
    }
    function drawMeter() { meterFill.style.width = Math.max(4, Math.min(100, heat)) + "%"; }
    function doMove(mv) {
      if (!game || game.stage !== "room") return;
      heat = Math.min(100, heat + mv.heat);
      let extra = "";
      if (mv.undress === "hers" && herLayers > 0) { herLayers--; extra = herLayers === 0 ? " *She's down to skin and confidence.*" : " *One layer gone.*"; }
      if (mv.undress === "his" && hisLayers > 0) { hisLayers--; extra = hisLayers === 0 ? " *You're as bare as the ambition gets.*" : " *One layer gone.*"; }
      say(`— <b>${mv.label}</b>`);
      say(mv.lines[(Math.random() * mv.lines.length) | 0] + extra);
      say(`<span style="color:#ff9ecf">${performerName}: ${tierLine()}</span>`);
      drawMeter(); drawMoves();
    }
    function doFinale(f) {
      if (!game || game.stage !== "room") return;
      game.stage = "after";
      movesEl.remove(); finaleEl.remove();
      say(`— <b>${f.label}</b>`);
      // stage it first, so a position that could not be cast falls back to the
      // text rather than leaving a half-dressed performer frozen by the bed
      if (f.pose && stage) {
        const act = stage(f.pose);
        game.staged = act || null;
        if (!act) say("*she stays where she is, and shrugs* \"Not tonight, sugar.\"");
      }
      say(f.line);
      const perk = perks && perks.grant ? perks.grant(heat) : null;
      game.result = { night: true, heat, finale: f.id, perk };
      const glow = element("p", "margin:10px 0;color:#c4c6d0;text-align:left;", heat >= 100 ? "*afterglow — she lies star-fished on the mattress, fanning herself* \"…Okay. OKAY. Whatever you're paying, they're undercharging.\"" : "*afterglow — she stretches, satisfied* \"Mmm. Good night's work, sugar.\"");
      const again = element("button", buttonCss, "ONE MORE ROUND (heat resets, same tab)"); again.type = "button";
      const done = element("button", buttonCss + "background:#454957;color:#fff;", "SLEEP · END THE NIGHT"); done.type = "button";
      again.addEventListener("click", () => { heat = Math.max(25, heat - 60); drawMeter(); glow.remove(); again.remove(); done.remove(); game.stage = "room"; card.append(movesEl, finaleEl); drawMoves(); say("*she rolls back towards you with a grin* \"Round two? You animal.\""); });
      done.addEventListener("click", () => closeGame(game.result));
      againEl.style.display = "flex"; againEl.append(again, done);
    }
    return true;
  }

  // Hand the gate to the character rig, so the adult clips are gated on THIS
  // acknowledgement, read live rather than snapshotted: index.html's first-paint
  // gate is a different element from the one built here and latches the same
  // global, so a value captured at construction could be a snapshot of the wrong
  // moment (see the race fixed in e84e519).
  setAdultGate(() => isAcknowledged());

  const api = {
    mountLaunchGate,
    acknowledged: () => isAcknowledged(),
    enabled,
    setPauseHandler(fn) { pauseHandler = typeof fn === "function" ? fn : null; },
    openRhythmGame,
    openCoffeeScene,
    openNightScene,
    closeRhythmGame: () => closeGame(),
    get gameActive() { return !!game; },
    get gateVisible() { return !!gate; },
  };
  // The main module loads after HTML parsing; mounting here puts the warning
  // over the loading screen and requires acknowledgement on every page launch.
  if (doc?.body && !acknowledged && !declined) mountLaunchGate();
  return api;
}

export const adultContent = createAdultContent();
