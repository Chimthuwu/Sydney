import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { readFile } from "node:fs/promises";
import puppeteer from "puppeteer";

const root = process.cwd();
const mobileProfile = process.argv.includes("--mobile-profile");
const html = await readFile(path.join(root, "index.html"), "utf8");
const accessHash = html.match(/var GTB_ACCESS_HASH = "([a-f0-9]+)"/)?.[1];
assert.ok(accessHash, "private access hash is present in the page");

const portServer = net.createServer();
await new Promise((resolve, reject) => portServer.listen(0, "127.0.0.1", resolve).once("error", reject));
const port = portServer.address().port;
await new Promise((resolve, reject) => portServer.close((error) => error ? reject(error) : resolve()));
const appServer = spawn(process.execPath, ["serve.mjs", String(port)], { cwd: root, stdio: "ignore" });
let browser;
try {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  browser = await puppeteer.launch({
    ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
    protocolTimeout: 300000,
    headless: true,
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio", "--no-sandbox"],
  });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(mobileProfile
    ? { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
    : { width: 1280, height: 720 });
  if (mobileProfile) {
    const cdp = await page.createCDPSession();
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: 4 * 1024 * 1024 / 8,
      uploadThroughput: 1 * 1024 * 1024 / 8,
      connectionType: "cellular4g",
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
  await page.evaluateOnNewDocument((hash, recordPerformance) => {
    if (recordPerformance) {
      window.__GTB_MOBILE_PROFILE = { stages: [], longTasks: [] };
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__GTB_MOBILE_PROFILE.longTasks.push({
              startMs: Math.round(entry.startTime),
              durationMs: Math.round(entry.duration),
            });
          }
        }).observe({ type: "longtask", buffered: true });
      } catch {}
    }
    const bytes = Uint8Array.from(hash.match(/../g), (pair) => parseInt(pair, 16));
    Object.defineProperty(window, "crypto", {
      configurable: true,
      value: { subtle: { digest: () => Promise.resolve(bytes.buffer) } },
    });
  }, accessHash, mobileProfile);

  const pageErrors = [];
  const failedRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push(`${request.url()}: ${request.failure()?.errorText || "failed"}`));

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const mobileStageRecording = mobileProfile ? page.evaluate(() => new Promise((resolve) => {
    const stages = [];
    let lastName = "", lastPercent = "", timer = null;
    const poll = () => {
      const note = document.getElementById("loadNote");
      const name = note?.textContent.trim() || "";
      const percent = document.getElementById("loadPct")?.textContent.trim() || "";
      if (name && (name !== lastName || percent !== lastPercent)) {
        stages.push({ name, percent, atMs: Math.round(performance.now()) });
        lastName = name;
        lastPercent = percent;
      }
      const free = document.getElementById("freeBtn");
      if (free && !free.disabled) {
        clearInterval(timer);
        resolve(stages);
      }
    };
    poll();
    timer = setInterval(poll, 50);
  })) : Promise.resolve([]);
  await page.waitForSelector("#gtbAccessInput", { timeout: 15000 });
  await page.type("#gtbAccessInput", "browser-startup-test");
  await page.click("#gtbAccessSubmit");
  await page.waitForSelector("#gtbAccessGate", { hidden: true, timeout: 10000 });
  await page.click("#gtbAgeYes");
  await page.waitForSelector("#gtbAdultGate", { hidden: true, timeout: 10000 });

  try {
    await page.waitForFunction(() => {
      const button = document.getElementById("freeBtn");
      return button && !button.disabled;
    }, { timeout: 300000 });
  } catch (error) {
    const status = await page.evaluate(() => ({
      note: document.getElementById("loadNote")?.textContent,
      percent: document.getElementById("loadPct")?.textContent,
      accessGate: !!document.getElementById("gtbAccessGate"),
      ageGate: !!document.getElementById("gtbAdultGate"),
      freeDisabled: document.getElementById("freeBtn")?.disabled,
    }));
    throw new Error(`Game did not finish startup: ${JSON.stringify(status)}\nPage errors: ${pageErrors.slice(0, 10).join(" | ")}\nFailed requests: ${failedRequests.slice(0, 10).join(" | ")}\n${error.message}`);
  }

  assert.equal(await page.$("#gtbAccessGate"), null, "private access gate is removed");
  assert.equal(await page.$("#gtbAdultGate"), null, "18+ gate is removed");
  assert.equal(await page.$eval("#freeBtn", (button) => button.disabled), false, "game startup enables Free Roam");
  assert.equal(pageErrors.length, 0, `startup has no uncaught browser errors: ${pageErrors.join(" | ")}`);
  const mobileStages = await mobileStageRecording;

  if (mobileProfile) {
    const profile = await page.evaluate((MOBILE_STAGES) => {
      const navigation = performance.getEntriesByType("navigation")[0];
      const resources = performance.getEntriesByType("resource").map((entry) => ({
        name: entry.name.split("/").slice(-3).join("/"),
        durationMs: Math.round(entry.duration),
        bytes: entry.transferSize || entry.encodedBodySize || 0,
      })).sort((a, b) => b.bytes - a.bytes);
      return {
        screen: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, coarsePointer: matchMedia("(pointer: coarse)").matches },
        navMs: Math.round(navigation?.domContentLoadedEventEnd || 0),
        startupMs: Math.round(performance.now()),
        transferredBytes: resources.reduce((sum, item) => sum + item.bytes, 0),
        resourceCount: resources.length,
        largestResources: resources.slice(0, 12),
        stages: MOBILE_STAGES,
        stageDurations: MOBILE_STAGES.map((stage, index) => ({
          name: stage.name,
          percent: stage.percent,
          durationMs: Math.max(0, (MOBILE_STAGES[index + 1]?.atMs ?? Math.round(performance.now())) - stage.atMs),
        })),
        longTasks: window.__GTB_MOBILE_PROFILE.longTasks,
      };
    }, mobileStages);
    console.log("Mobile-emulated launch profile (4x CPU, 4 Mbps down, 150 ms RTT):");
    console.log(JSON.stringify(profile, null, 2));
  }

  await page.evaluate(() => window.__GTB_SHOW_LOAD_ERROR(new Error("simulated asset fetch failure")));
  const recovery = await page.$eval("#loadError", (panel) => ({
    visible: !panel.hidden,
    role: panel.getAttribute("role"),
    heading: panel.querySelector("h2")?.textContent,
    steps: [...panel.querySelectorAll("#loadErrorSteps li")].map((item) => item.textContent),
    detail: panel.querySelector("#loadErrorDetail")?.textContent,
    reload: panel.querySelector("#loadErrorReload")?.textContent,
  }));
  assert.equal(recovery.visible, true, "startup failures show a visible recovery panel");
  assert.equal(recovery.role, "alert", "recovery is announced to assistive technology");
  assert.match(recovery.heading, /couldn’t finish loading/i);
  assert.ok(recovery.steps.some((step) => /internet connection/i.test(step)), "panel suggests checking connectivity");
  assert.ok(recovery.steps.some((step) => /browser|assets/i.test(step)), "panel suggests checking browser or blocked assets");
  assert.match(recovery.detail, /simulated asset fetch failure/, "panel includes the underlying diagnostic");
  assert.match(recovery.reload, /reload game/i, "panel offers a reload action");

  console.log("Full-game first-launch and visible load-recovery browser test passed");
  await context.close();
} finally {
  if (browser) await browser.close();
  appServer.kill();
}
