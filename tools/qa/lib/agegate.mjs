// The game opens with an "I am over 18 years of age" gate (src/adultContent.js) that covers the page and swallows keys and clicks until it is
// answered. QA scripts drive the page with the keyboard and mouse, so they answer it exactly the way a player does — by pressing the button —
// the moment it appears. (There is deliberately no bypass in the game itself.)
export async function autoAcknowledge(page) {
  await page.evaluateOnNewDocument(() => {
    const press = () => { const b = document.querySelector('#gtbAdultGate button'); if (b && /OVER 18/.test(b.textContent)) b.click(); };
    new MutationObserver(press).observe(document, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', press);
  });
}
