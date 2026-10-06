import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer";

const root = process.cwd();
const html = await readFile(path.join(root, "index.html"), "utf8");
const accessHash = html.match(/var GTB_ACCESS_HASH = "([a-f0-9]+)"/)?.[1];
assert.ok(accessHash, "private-access verifier hash exists");

function makeModuleGate() {
  let markRequested, release;
  return {
    requested: new Promise((resolve) => { markRequested = resolve; }),
    markRequested: () => markRequested(),
    wait: new Promise((resolve) => { release = resolve; }),
    release: () => release(),
  };
}
const moduleGates = { yes: makeModuleGate(), no: makeModuleGate(), touch: makeModuleGate() };

// Serve the real access and age gates, delaying the age module until each browser
// scenario has clicked a first-paint button. Avoid booting the full game here.
const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url, "http://localhost");
  const pathname = requestUrl.pathname;
  const requestedScenario = requestUrl.searchParams.get("scenario");
  const scenario = Object.hasOwn(moduleGates, requestedScenario) ? requestedScenario : "yes";
  if (pathname === "/" || pathname === "/index.html") {
    const testHtml = html.replace(
      '<script type="module" src="./src/main.js"></script>',
      `<script type="module" src="/src/adultContent.js?scenario=${scenario}"></script>`,
    );
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(testHtml);
  } else if (pathname === "/src/adultContent.js") {
    const gate = moduleGates[scenario];
    gate.markRequested();
    await gate.wait;
    const moduleText = await readFile(path.join(root, "src/adultContent.js"), "utf8");
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" })
      .end(`${moduleText}\nwindow.__GTB_ADULT_MODULE_ACKNOWLEDGED = adultContent.acknowledged();\nwindow.__GTB_ADULT_MODULE_DECLINED = window.__GTB_AGE_GATE_DECLINED === true;\nwindow.__GTB_ADULT_MODULE_LOADED = true;`);
  } else {
    res.writeHead(404).end("Not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const localUrl = `http://127.0.0.1:${address.port}/`;
const browser = await puppeteer.launch({
  ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
  headless: true,
  args: ["--allow-file-access-from-files", "--no-sandbox"],
});
try {
  // Unsupported file:// feedback should be actionable and accessible.
  const unsupportedPage = await browser.newPage();
  await unsupportedPage.evaluateOnNewDocument(() => {
    Object.defineProperty(window, "crypto", { configurable: true, value: {} });
  });
  await unsupportedPage.goto(pathToFileURL(path.join(root, "index.html")).href, { waitUntil: "domcontentloaded" });
  await unsupportedPage.waitForSelector("#gtbAccessInput");
  const before = await unsupportedPage.$eval("#gtbAccessError", (error) => ({
    hidden: error.hidden,
    role: error.getAttribute("role"),
    live: error.getAttribute("aria-live"),
  }));
  const inputSemantics = await unsupportedPage.$eval("#gtbAccessInput", (input) => ({
    describedBy: input.getAttribute("aria-describedby"),
    label: input.labels[0]?.textContent.trim(),
    autocomplete: input.autocomplete,
    autocapitalize: input.getAttribute("autocapitalize"),
    autocorrect: input.getAttribute("autocorrect"),
    enterKeyHint: input.enterKeyHint,
    fontSize: getComputedStyle(input).fontSize,
  }));
  assert.deepEqual(before, { hidden: true, role: "alert", live: "polite" }, "error region starts hidden and is announced accessibly");
  assert.deepEqual(inputSemantics, {
    describedBy: "gtbAccessError",
    label: "Access password",
    autocomplete: "off",
    autocapitalize: "off",
    autocorrect: "off",
    enterKeyHint: "go",
    fontSize: "16px",
  }, "password field has an accessible label and mobile-appropriate input hints");
  await unsupportedPage.focus("#gtbAccessInput");
  await unsupportedPage.keyboard.press("Enter");
  await unsupportedPage.waitForFunction(() => !document.querySelector("#gtbAccessError").hidden);
  const unsupported = await unsupportedPage.$eval("#gtbAccessError", (error) => ({
    text: error.textContent,
    invalid: document.querySelector("#gtbAccessInput").getAttribute("aria-invalid"),
  }));
  assert.match(unsupported.text, /opened as a file/i, "file:// gets specific guidance");
  assert.match(unsupported.text, /start-game\.cmd|npm start/i, "instructions explain how to start the local server");
  assert.equal(unsupported.invalid, "true", "unsupported verification marks the password field invalid");
  await unsupportedPage.type("#gtbAccessInput", "x");
  const cleared = await unsupportedPage.$eval("#gtbAccessError", (error) => ({
    hidden: error.hidden,
    text: error.textContent,
    invalid: document.querySelector("#gtbAccessInput").getAttribute("aria-invalid"),
  }));
  assert.deepEqual(cleared, { hidden: true, text: "", invalid: null }, "editing the password clears stale feedback and invalid state");

  await unsupportedPage.evaluate(() => window.__GTB_SHOW_LOAD_ERROR(new Error("simulated module load failure")));
  const localRecovery = await unsupportedPage.$eval("#loadError", (panel) => ({
    visible: !panel.hidden,
    fileInstructions: !document.getElementById("loadErrorLocal").hidden,
    genericStepsHidden: document.getElementById("loadErrorSteps").hidden,
    detail: document.getElementById("loadErrorDetail").textContent,
    reloadButton: document.getElementById("loadErrorReload").textContent,
  }));
  assert.equal(localRecovery.visible, true, "startup error panel is visible from a file URL");
  assert.equal(localRecovery.fileInstructions, true, "file:// error displays exact local-server recovery instructions");
  assert.equal(localRecovery.genericStepsHidden, true, "file:// hides irrelevant generic troubleshooting");
  assert.match(localRecovery.detail, /simulated module load failure/, "file error panel shows a diagnostic");
  assert.match(localRecovery.reloadButton, /reload game/i, "file error panel offers reload");

  // Adult choice: the button must work even before adultContent.js has loaded.
  const adultContext = await browser.createBrowserContext();
  const adultPage = await adultContext.newPage();
  await adultPage.evaluateOnNewDocument((hash) => {
    const bytes = Uint8Array.from(hash.match(/../g), (pair) => parseInt(pair, 16));
    Object.defineProperty(window, "crypto", {
      configurable: true,
      value: { subtle: { digest: () => Promise.resolve(bytes.buffer) } },
    });
  }, accessHash);
  const adultNavigation = adultPage.goto(`${localUrl}?scenario=yes`, { waitUntil: "domcontentloaded" });
  await adultPage.waitForSelector("#gtbAgeYes");
  await moduleGates.yes.requested;
  await adultPage.type("#gtbAccessInput", "browser-test-password");
  await adultPage.click("#gtbAccessSubmit");
  await adultPage.waitForSelector("#gtbAccessGate", { hidden: true });
  await adultPage.click("#gtbAgeYes");
  await adultPage.waitForSelector("#gtbAdultGate", { hidden: true });
  assert.equal(await adultPage.evaluate(() => window.__GTB_AGE_GATE_ACKNOWLEDGED), true, "adult choice is recorded before module load");
  moduleGates.yes.release();
  await adultPage.waitForFunction(() => window.__GTB_ADULT_MODULE_LOADED === true);
  assert.equal(await adultPage.evaluate(() => window.__GTB_ADULT_MODULE_ACKNOWLEDGED), true, "late module preserves adult confirmation");
  assert.equal(await adultPage.$("#gtbAdultGate"), null, "late module does not reopen a confirmed gate");
  await adultNavigation;
  await adultContext.close();

  // First launch on a phone-sized touch viewport: type the password, tap ENTER,
  // then tap 18+ while the module request is still deliberately held back.
  const touchContext = await browser.createBrowserContext();
  const touchPage = await touchContext.newPage();
  await touchPage.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await touchPage.evaluateOnNewDocument((hash) => {
    const bytes = Uint8Array.from(hash.match(/../g), (pair) => parseInt(pair, 16));
    Object.defineProperty(window, "crypto", {
      configurable: true,
      value: { subtle: { digest: () => Promise.resolve(bytes.buffer) } },
    });
  }, accessHash);
  const touchNavigation = touchPage.goto(`${localUrl}?scenario=touch`, { waitUntil: "domcontentloaded" });
  await touchPage.waitForSelector("#gtbAgeYes");
  await moduleGates.touch.requested;
  assert.equal(await touchPage.evaluate(() => matchMedia("(pointer: coarse)").matches), true, "browser is using a coarse touch pointer");
  await touchPage.type("#gtbAccessInput", "browser-test-password");
  const tap = async (selector) => {
    const box = await touchPage.$eval(selector, (element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    });
    assert.ok(box.width > 0 && box.height > 0, `${selector} has a visible tap target`);
    await touchPage.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  };
  await tap("#gtbAccessSubmit");
  await touchPage.waitForSelector("#gtbAccessGate", { hidden: true });
  await tap("#gtbAgeYes");
  await touchPage.waitForSelector("#gtbAdultGate", { hidden: true });
  assert.equal(await touchPage.evaluate(() => window.__GTB_AGE_GATE_ACKNOWLEDGED), true, "touch confirmation is recorded before module load");
  moduleGates.touch.release();
  await touchNavigation;
  await touchPage.waitForFunction(() => window.__GTB_ADULT_MODULE_LOADED === true);
  assert.equal(await touchPage.evaluate(() => window.__GTB_ADULT_MODULE_ACKNOWLEDGED), true, "late module preserves touch confirmation");
  await touchContext.close();

  // Under-18 choice: immediately replace the gate with a notice and remain
  // locked, including after the delayed module initializes.
  const leaveContext = await browser.createBrowserContext();
  const leavePage = await leaveContext.newPage();
  await leavePage.evaluateOnNewDocument((hash) => {
    const bytes = Uint8Array.from(hash.match(/../g), (pair) => parseInt(pair, 16));
    Object.defineProperty(window, "crypto", {
      configurable: true,
      value: { subtle: { digest: () => Promise.resolve(bytes.buffer) } },
    });
  }, accessHash);
  const leaveNavigation = leavePage.goto(`${localUrl}?scenario=no`, { waitUntil: "domcontentloaded" });
  await leavePage.waitForSelector("#gtbAgeNo");
  await moduleGates.no.requested;
  await leavePage.type("#gtbAccessInput", "browser-test-password");
  await leavePage.click("#gtbAccessSubmit");
  await leavePage.waitForSelector("#gtbAccessGate", { hidden: true });
  await leavePage.click("#gtbAgeNo");
  await leavePage.waitForFunction(() => /only for adults aged 18 and over/i.test(document.querySelector("#gtbAdultGate").textContent));
  assert.equal(await leavePage.evaluate(() => window.__GTB_AGE_GATE_DECLINED), true, "under-18 choice is recorded before module load");
  assert.notEqual(await leavePage.evaluate(() => window.__GTB_AGE_GATE_ACKNOWLEDGED), true, "under-18 choice never acknowledges age");
  assert.equal(await leavePage.$("#gtbAgeYes"), null, "under-18 choice removes the confirmation controls");
  const gameplayKeyPrevented = await leavePage.evaluate(() => {
    const event = new KeyboardEvent("keydown", { key: "w", bubbles: true, cancelable: true });
    return !window.dispatchEvent(event);
  });
  assert.equal(gameplayKeyPrevented, true, "under-18 choice keeps gameplay keyboard input blocked");
  moduleGates.no.release();
  await leavePage.waitForFunction(() => window.__GTB_ADULT_MODULE_LOADED === true);
  assert.equal(await leavePage.evaluate(() => window.__GTB_ADULT_MODULE_ACKNOWLEDGED), false, "late module remains unacknowledged after under-18 choice");
  assert.equal(await leavePage.evaluate(() => window.__GTB_ADULT_MODULE_DECLINED), true, "late module preserves under-18 decision");
  assert.match(await leavePage.$eval("#gtbAdultGate", (gate) => gate.textContent), /Please close this page/, "notice remains after module initialization");
  await leaveNavigation;
  await leaveContext.close();

  console.log("Password-gate feedback and delayed age-gate choice browser tests passed");
} finally {
  moduleGates.yes.release();
  moduleGates.no.release();
  moduleGates.touch.release();
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
