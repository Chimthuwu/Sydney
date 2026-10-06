// Both doors, for the QA scripts that drive a real page.
//
// index.html paints two gates before any script runs: PRIVATE ACCESS (a
// password) and then the 18+ gate. A headless run has to get through both or it
// sits on a dialog until it times out.
//
// The 18+ gate is answered the way a player answers it — by pressing the
// button. There is deliberately no bypass for it in the game (see
// lib/agegate.mjs, which does the same thing for the scripts that only need
// that one).
//
// The access gate is NOT answered with the password, and this file does not
// contain it. index.html already remembers a correct answer by writing the
// password's own SHA-256 into localStorage under "gtb.access.ok", and that hash
// is a public constant sitting in the page source. So: read the hash out of the
// page, write the remember key, reload. Change the password and this keeps
// working, because it never knew the password in the first place.
export const ACCESS_KEY = "gtb.access.ok";

/**
 * Get past both gates and leave the page loaded and ready.
 * Safe to call when neither gate is present.
 * @param {import("playwright").Page} page  already navigated to the game
 */
export async function openTheDoors(page) {
  // 18+: click it whenever it turns up, including after the reload below
  await page.addInitScript(() => {
    const press = () => {
      const b = document.querySelector("#gtbAdultGate button");
      if (b && /OVER 18/.test(b.textContent || "")) b.click();
    };
    new MutationObserver(press).observe(document, { childList: true, subtree: true });
    document.addEventListener("DOMContentLoaded", press);
  });

  // PRIVATE ACCESS: take the hash the page already publishes and remember it
  const hash = await page.evaluate(() => {
    const m = document.documentElement.innerHTML.match(/GTB_ACCESS_HASH\s*=\s*"([0-9a-f]{64})"/);
    return m ? m[1] : null;
  });
  const gated = await page.$("#gtbAccessGate");
  if (hash && gated) {
    await page.evaluate(([k, v]) => {
      try { localStorage.setItem(k, v); } catch (e) {}
    }, [ACCESS_KEY, hash]);
    await page.reload({ waitUntil: "domcontentloaded" });
  }

  // and press the 18+ button now, for the load that is already on screen
  await page.evaluate(() => {
    const b = document.querySelector("#gtbAdultGate button");
    if (b && /OVER 18/.test(b.textContent || "")) b.click();
  });
  return { accessGate: !!gated, hashFound: !!hash };
}
