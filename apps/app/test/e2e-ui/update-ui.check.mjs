/**
 * Drives the BUILT desktop page in headless Chromium (no window is shown) against a scripted stand-in for the shell, and checks
 * the update interface: the first-run notice, every banner, the countdown and its Cancel, the Settings card, the Privacy block,
 * the narrow and wide layouts in light and dark, and that text from an export cannot become part of the update banner.
 *
 *   PLAYWRIGHT_DIR=<folder with node_modules/playwright> node apps/app/test/e2e-ui/update-ui.check.mjs <index.html> [hostile.zip] [screenshots folder]
 *
 * The stand-in answers `window.__TAURI_INTERNALS__.invoke`, which is what @tauri-apps/api's `invoke` calls. Nothing here talks to
 * a network: the page is opened from a file. It exits 1 on the first failed check.
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [, , indexHtml, hostileZip, shots] = process.argv;
if (!indexHtml || !process.env.PLAYWRIGHT_DIR) {
  console.error("usage: PLAYWRIGHT_DIR=<dir> node update-ui.check.mjs <index.html> [hostile.zip] [screenshots dir]");
  process.exit(2);
}
const { chromium } = createRequire(path.join(process.env.PLAYWRIGHT_DIR, "package.json"))("playwright");
if (shots) mkdirSync(shots, { recursive: true });

const BASE = { state: "idle", percent: 0, version: null, current: "0.1.0-beta.2", auto: true, last_checked_unix: 0, notice_pending: false, link_enabled: false, supported: true, error: null, updated_to: null };
const URL_OF = pathToFileURL(path.resolve(indexHtml)).href;
let failures = 0;
const ok = (cond, name, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : ` ${extra}`}`);
  if (!cond) failures++;
};

const browser = await chromium.launch({ headless: true });

/** A fresh page with the stand-in shell. `status` is what update_status answers; `calls` records every command. */
async function open(status, { hash = "#/start", width = 900, height = 800, scheme = "light" } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36" });
  await context.addInitScript(
    ({ base, status: first }) => {
      const shell = { status: { ...base, ...first }, calls: [], afterCheck: null, rejectInstall: false };
      window.__shell = shell;
      // A page whose clock can be moved forward, to be past the first minute after launch (when the page polls on its own).
      const realNow = Date.now.bind(Date);
      window.__skew = 0;
      Date.now = () => realNow() + window.__skew;
      window.__TAURI_INTERNALS__ = {
        transformCallback: () => 0,
        invoke: async (command, args) => {
          shell.calls.push({ command, args: args ?? {} });
          if (command === "update_status") {
            const out = { ...shell.status };
            if (shell.status.updated_to) shell.status.updated_to = null; // shown once, like the real shell
            return out;
          }
          if (command === "update_set_auto") Object.assign(shell.status, { auto: args.auto, notice_pending: false }); // like the real shell
          if (command === "update_check" && shell.afterCheck) shell.afterCheck(shell);
          if (command === "update_install" && shell.rejectInstall) throw "busy";
          return null;
        },
      };
    },
    { base: BASE, status },
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${URL_OF}${hash}`);
  await page.waitForSelector(".site-header");
  await page.waitForTimeout(250);
  page.errors = errors;
  return page;
}
const refresh = async (page, patch) => {
  if (patch) await page.evaluate((p) => Object.assign(window.__shell.status, p), patch);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(250);
};
const calls = (page) => page.evaluate(() => window.__shell.calls.map((c) => c.command + (Object.keys(c.args).length ? JSON.stringify(c.args) : "")));
const banner = (page) => page.locator(".update-slot").innerText();
const shot = async (page, name, full = false) => shots && (await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: full }));

// ---------------------------------------------------------------------------------------------- first-run notice
{
  const page = await open({ notice_pending: true });
  ok((await banner(page)).includes("Snappy checks GitHub for updates when it opens. Change this in Settings."), "the first-run notice is shown");
  ok((await calls(page)).includes('update_set_auto{"auto":true}'), "showing it tells the shell it was shown, with the current value", JSON.stringify(await calls(page)));
  ok(await page.locator('.update-slot [role="status"], .update-slot[role="status"]').first().isVisible(), "the banner area is a polite live region");
  ok((await page.locator(".update-slot").getAttribute("aria-live")) === "polite", "aria-live is polite");
  await refresh(page, { notice_pending: false });
  ok((await banner(page)).includes("Snappy checks GitHub"), "the notice stays until it is answered, though the shell stops reporting it");
  await shot(page, "notice-wide-light");
  await page.getByRole("button", { name: "OK" }).click();
  ok((await banner(page)).trim() === "", "OK closes it");
  ok(!(await calls(page)).includes('update_set_auto{"auto":false}'), "OK does not turn the check off");
  await page.close();
  const off = await open({ notice_pending: true });
  await off.getByRole("button", { name: "Turn off" }).click();
  ok((await calls(off)).includes('update_set_auto{"auto":false}'), "Turn off switches the check off");
  await off.context().close();
}

// ---------------------------------------------------------------------------------------------- progress, ready, countdown
{
  const page = await open({ state: "downloading", percent: 42, version: "0.2.0" });
  ok((await banner(page)).includes("Downloading… 42%"), "download progress is shown");
  ok((await page.locator(".update-bar-fill").count()) === 1, "with a bar");
  await shot(page, "progress-wide-light");
  await page.context().close();

  // The bar is a progress bar, and a new percent changes it in place: the live region is not rebuilt, so it is not read again.
  const dl = await open({ state: "downloading", percent: 40, version: "0.2.0" });
  const bar = dl.locator(".update-bar");
  ok((await bar.getAttribute("role")) === "progressbar", "the download bar is a progress bar");
  ok((await bar.getAttribute("aria-valuemin")) === "0" && (await bar.getAttribute("aria-valuemax")) === "100" && (await bar.getAttribute("aria-valuenow")) === "40", "with a range and the current value");
  ok((await bar.getAttribute("aria-label")) === "Downloading update", "named for what is downloading, with no percent in the name");
  ok((await dl.locator(".update-slot .sr-only").innerText()) === "Downloading update", "the words read out when the banner appears are static");
  ok((await dl.locator(".update-percent").getAttribute("aria-hidden")) === "true", "the changing percent text is hidden from assistive technology");
  await dl.evaluate(() => {
    window.__slotMutations = 0;
    window.__bannerNode = document.querySelector(".update-banner");
    new MutationObserver((records) => (window.__slotMutations += records.filter((r) => r.type === "childList" && !r.target.closest('[aria-hidden="true"]')).length)).observe(document.querySelector(".update-slot"), { childList: true, subtree: true });
    document.getElementById("live-polite").textContent = "";
  });
  await refresh(dl, { percent: 43 });
  await refresh(dl, { percent: 44 });
  ok((await bar.getAttribute("aria-valuenow")) === "44", "the bar's value moves with the download");
  ok((await dl.locator(".update-percent").innerText()) === "Downloading… 44%", "and so does the text you see");
  ok((await dl.evaluate(() => window.__slotMutations)) === 0, "without changing anything inside the live region that assistive technology can reach");
  ok(await dl.evaluate(() => window.__bannerNode === document.querySelector(".update-banner")), "the banner is the same element");
  ok((await dl.evaluate(() => document.getElementById("live-polite").textContent)) === "", "and nothing is announced below half");
  await refresh(dl, { percent: 55 });
  await dl.waitForTimeout(150);
  ok((await dl.evaluate(() => document.getElementById("live-polite").textContent)) === "Update is half downloaded.", "half way is announced once");
  await dl.evaluate(() => (document.getElementById("live-polite").textContent = ""));
  await refresh(dl, { percent: 70 });
  await dl.waitForTimeout(150);
  ok((await dl.evaluate(() => document.getElementById("live-polite").textContent)) === "", "and not again");
  await refresh(dl, { state: "staged", percent: 100 });
  ok((await banner(dl)).includes("Updating now.") && !(await banner(dl)).includes("Downloading"), "the finished download is announced by the next banner appearing in the live region");
  await dl.context().close();

  const late = await open({ state: "downloading", percent: 80, version: "0.2.0" });
  await late.waitForTimeout(150);
  ok((await late.evaluate(() => document.getElementById("live-polite").textContent)) === "", "a download first seen past half says nothing about half way");
  await late.context().close();

  const ready = await open({ state: "staged", percent: 100, version: "0.2.0" }, { hash: "#/overview" });
  const text = await banner(ready);
  ok(text.includes("Update ready. Restart to finish.") && text.includes("Restarting closes Snappy. Results aren’t saved unless history is saved."), "ready shows the caution when the page is not idle");
  ok((await ready.locator(".update-slot .btn").allInnerTexts()).join("|") === "Restart now|Later", "with Restart now and Later");
  await ready.getByRole("button", { name: "Restart now" }).click();
  ok((await calls(ready)).includes('update_install{"idle":false}'), "Restart now passes the page's own idle claim (not idle)");
  await ready.getByRole("button", { name: "Later" }).click().catch(() => undefined);
  await refresh(ready);
  ok((await banner(ready)).trim() === "", "Later hides it for this version");
  await ready.context().close();

  const countdown = await open({ state: "staged", percent: 100, version: "0.2.0" }, { hash: "#/start" });
  ok((await banner(countdown)).includes("Updating now."), "an idle page gets the countdown");
  ok(!(await calls(countdown)).some((c) => c.startsWith("update_install")), "nothing is installed yet");
  await shot(countdown, "countdown-wide-light");
  await countdown.waitForTimeout(5400);
  ok((await calls(countdown)).includes('update_install{"idle":true}'), "after five seconds it installs, saying idle");
  await countdown.context().close();

  const cancelled = await open({ state: "staged", percent: 100, version: "0.2.0" }, { hash: "#/start" });
  await cancelled.getByRole("button", { name: "Cancel" }).click();
  await cancelled.waitForTimeout(5400);
  ok(!(await calls(cancelled)).some((c) => c.startsWith("update_install")), "Cancel stops the countdown");
  ok((await banner(cancelled)).includes("Update ready. Restart to finish."), "and the ready banner takes over");
  await cancelled.context().close();

  const left = await open({ state: "staged", percent: 100, version: "0.2.0" }, { hash: "#/start" });
  await left.evaluate(() => (location.hash = "#/overview"));
  await left.waitForTimeout(5400);
  ok(!(await calls(left)).some((c) => c.startsWith("update_install")), "leaving the quiet pages during the countdown stops it");
  await left.context().close();

  const pw = await open({ state: "staged", percent: 100, version: "0.2.0" }, { hash: "#/start" });
  await pw.evaluate(() => {
    const field = document.createElement("input");
    field.type = "password";
    document.body.append(field);
  });
  await pw.evaluate(() => (location.hash = "#/settings"));
  await pw.evaluate(() => (location.hash = "#/start"));
  await refresh(pw);
  ok((await banner(pw)).includes("Update ready."), "a passphrase prompt on screen makes the page not idle");
  await pw.context().close();
}

// ---------------------------------------------------------------------------------------------- failure, link, unsupported, updated
{
  const failed = await open({ state: "failed", version: "0.2.0", error: "install" });
  ok((await banner(failed)).includes("Couldn’t update. Try again."), "a failure says so");
  ok((await failed.locator(".update-slot .btn").allInnerTexts()).join("|") === "Update now", "with Update now as the retry");
  await failed.getByRole("button", { name: "Update now" }).click();
  ok((await calls(failed)).includes("update_check"), "Update now asks the shell to check and stage again");
  await refresh(failed, { link_enabled: true });
  await failed.getByRole("button", { name: "Download from GitHub" }).click();
  ok((await calls(failed)).includes("update_open_releases"), "after repeated failures the quiet link opens the fixed releases page through the shell");
  await shot(failed, "failed-wide-light");
  await failed.context().close();

  const unsupported = await open({ supported: false, version: "0.2.0", error: "unsupported", link_enabled: true });
  ok((await banner(unsupported)).includes("Snappy 0.2.0 is available. This copy can’t update itself."), "a copy that cannot update itself says so");
  await unsupported.context().close();

  const updated = await open({ updated_to: "0.2.0" });
  ok((await banner(updated)).includes("Updated to 0.2.0."), "the short Updated to message is shown after a relaunch");
  await refresh(updated);
  ok((await banner(updated)).includes("Updated to 0.2.0."), "and stays for its few seconds although the shell reports it once");
  await updated.waitForTimeout(6300);
  ok((await banner(updated)).trim() === "", "then goes away");
  await updated.context().close();

  const quiet = await open({ state: "idle", error: "offline" });
  ok((await banner(quiet)).trim() === "", "an offline check shows nothing unprompted");
  await quiet.context().close();
}

// ---------------------------------------------------------------------------------------------- Settings card, Privacy block
{
  const page = await open({ last_checked_unix: 1794000000 }, { hash: "#/settings" });
  const card = page.locator(".update-card");
  ok((await card.count()) === 1, "the Updates card is in Settings");
  const text = await card.innerText();
  ok(text.includes("Updates") && text.includes("Version 0.1.0-beta.2") && text.includes("Last checked") && text.includes("Check for updates on launch"), "with the version, the last check and the switch", text);
  ok(text.includes("Asks github.com for the newest version. Sends no ID and none of your data."), "and the one-line note");
  ok(await card.locator("#update-auto").isChecked(), "the switch shows the shell's value");
  const order = await page.locator(".cols > section > h2").allInnerTexts();
  ok(order.indexOf("Updates") >= 0 && order.indexOf("Updates") < order.indexOf("About"), "the card sits before About", order.join(","));
  await page.locator("#update-auto").uncheck();
  ok((await calls(page)).includes('update_set_auto{"auto":false}'), "switching it off tells the shell");
  await page.evaluate(() => {
    window.__shell.afterCheck = (s) => {
      s.status.state = "checking";
      setTimeout(() => Object.assign(s.status, { state: "idle", error: "offline" }), 1200);
    };
  });
  await page.getByRole("button", { name: "Check now" }).click();
  ok((await calls(page)).includes("update_check"), "Check now asks the shell");
  await page.waitForTimeout(400);
  ok((await card.innerText()).includes("Checking…"), "it shows that it is checking");
  await page.waitForTimeout(2600);
  ok((await card.innerText()).includes("Can’t reach GitHub."), "and says Can’t reach GitHub. when the shell reports an offline error");
  await page.evaluate(() => {
    window.__shell.afterCheck = (s) => void (s.status.last_checked_unix += 1); // a completed check moves "last checked"
    Object.assign(window.__shell.status, { error: null, state: "idle" });
  });
  await page.getByRole("button", { name: "Check now" }).click();
  await page.waitForTimeout(1500);
  ok((await card.innerText()).includes("You’re up to date."), "and says You’re up to date. otherwise");
  await page.locator("#update-auto").check();
  await shot(page, "settings-wide-light", true);
  ok((await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth)), "no horizontal scroll at the wide size");
  await page.context().close();

  const privacy = await open({}, { hash: "#/privacy" });
  const block = privacy.locator(".update-privacy");
  ok((await block.count()) === 1, "the Privacy page has the Update check block");
  ok((await block.innerText()).includes("GitHub can see your IP address, the time, and that a Snappy app asked."), "with what GitHub can see");
  ok((await privacy.locator("body").innerText()).includes("This page cannot connect to the internet."), "next to the existing notice that the page cannot connect");
  await shot(privacy, "privacy-wide-light", true);
  await privacy.context().close();

  const other = await open({}, { hash: "#/overview" });
  ok((await other.locator(".update-card, .update-privacy").count()) === 0, "neither is added to any other page");
  await other.context().close();
}

// ---------------------------------------------------------------------------------------------- review fixes: feedback, race, stale result
{
  // "Update now" shows that it is working at once and follows the shell to the end, long after the launch minute.
  const page = await open({ state: "idle", version: "0.2.0" }, { hash: "#/overview" });
  ok((await banner(page)).includes("Snappy 0.2.0 is available."), "the available banner is shown");
  await page.evaluate(() => {
    window.__skew = 120_000; // two minutes after launch: the page no longer polls on its own
    window.__shell.afterCheck = (s) => {
      setTimeout(() => (s.status.state = "checking"), 600);
      setTimeout(() => Object.assign(s.status, { state: "downloading", percent: 40 }), 1200);
      setTimeout(() => Object.assign(s.status, { state: "staged", percent: 100 }), 1800);
    };
  });
  await page.getByRole("button", { name: "Update now" }).click();
  await page.waitForTimeout(80);
  ok((await banner(page)).includes("Checking…") && !(await banner(page)).includes("Update now"), "Update now answers at once with a working label", await banner(page));
  await page.waitForTimeout(2600);
  ok((await banner(page)).includes("Update ready. Restart to finish."), "the banner follows the shell to the staged state without a focus event", await banner(page));
  await page.context().close();

  // The same from a failed banner.
  const failed = await open({ state: "failed", version: "0.2.0", error: "install" }, { hash: "#/overview" });
  await failed.evaluate(() => {
    window.__skew = 120_000;
    window.__shell.afterCheck = (s) => {
      setTimeout(() => Object.assign(s.status, { state: "checking", error: null }), 500);
      setTimeout(() => Object.assign(s.status, { state: "staged", percent: 100 }), 1300);
    };
  });
  await failed.getByRole("button", { name: "Update now" }).click();
  await failed.waitForTimeout(2200);
  ok((await banner(failed)).includes("Update ready."), "a failed banner's Update now also ends on the new state", await banner(failed));
  await failed.context().close();

  // Check now: a shell that only reports "checking" 700 ms after the request, and ends with an error.
  const card = await open({}, { hash: "#/settings" });
  await card.evaluate(() => {
    window.__shell.afterCheck = (s) => {
      setTimeout(() => (s.status.state = "checking"), 700);
      setTimeout(() => Object.assign(s.status, { state: "idle", error: "offline" }), 1900);
    };
  });
  await card.getByRole("button", { name: "Check now" }).click();
  await card.waitForTimeout(1100);
  const midway = await card.locator(".update-card").innerText();
  ok(!midway.includes("You’re up to date."), "the card does not claim up to date before the check ran", midway);
  await card.waitForTimeout(2200);
  ok((await card.locator(".update-card").innerText()).includes("Can’t reach GitHub."), "and ends on the real result", await card.locator(".update-card").innerText());
  ok(!(await card.locator(".update-card").innerText()).includes("You’re up to date."), "never up to date for a failed check");
  await card.context().close();

  // A known newer version and "You’re up to date." never appear together.
  const known = await open({ version: "0.2.0" }, { hash: "#/settings" });
  await known.getByRole("button", { name: "Check now" }).click();
  await known.waitForTimeout(5600);
  ok(!(await known.locator(".update-card").innerText()).includes("You’re up to date."), "no up-to-date note beside an available-version banner", await known.locator(".update-card").innerText());
  ok((await banner(known)).includes("Snappy 0.2.0 is available."), "the banner still says it is available");
  await known.context().close();
}

// ---------------------------------------------------------------------------------------------- focus after a banner action
{
  const press = async (page, name) => {
    await page.getByRole("button", { name }).focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    return page.evaluate(() => {
      const a = document.activeElement;
      return { tag: a?.tagName, inBody: a === document.body, cls: a?.className ?? "", id: a?.id ?? "" };
    });
  };
  const notBody = (f) => !f.inBody && f.tag !== "HTML";
  const later = await open({ state: "staged", percent: 100, version: "0.2.0" }, { hash: "#/overview" });
  ok(notBody(await press(later, "Later")), "after Later focus stays in the page (not the top of the document)");
  await later.context().close();
  const notice = await open({ notice_pending: true });
  ok(notBody(await press(notice, "OK")), "after OK focus stays in the page");
  await notice.context().close();
  const off = await open({ notice_pending: true });
  ok(notBody(await press(off, "Turn off")), "after Turn off focus stays in the page");
  await off.context().close();
  const update = await open({ state: "idle", version: "0.2.0" }, { hash: "#/overview" });
  const f = await press(update, "Update now");
  ok(notBody(f) && f.cls.includes("update-slot"), "after Update now focus moves to the banner's place, where the progress shows", JSON.stringify(f));
  await update.context().close();
  const settings = await open({ last_checked_unix: 1794000000 }, { hash: "#/settings" });
  await settings.evaluate(() => (window.__shell.afterCheck = (s) => void (s.status.last_checked_unix += 1)));
  await settings.getByRole("button", { name: "Check now" }).focus();
  await settings.keyboard.press("Enter");
  await settings.waitForTimeout(300);
  ok((await settings.evaluate(() => document.activeElement?.getAttribute("data-key"))) === "update:check-now", "Check now keeps focus while it is checking (aria-disabled, not disabled)");
  ok((await settings.evaluate(() => document.querySelector('[data-key="update:check-now"]').getAttribute("aria-disabled"))) === "true", "and says it is busy");
  await settings.waitForTimeout(1500);
  ok((await settings.evaluate(() => document.activeElement?.getAttribute("data-key"))) === "update:check-now", "and still has it when the check ends");
  ok((await settings.evaluate(() => document.querySelector('[data-key="update:check-now"]').getAttribute("aria-disabled"))) === null, "no longer busy");
  await settings.context().close();
}

// ---------------------------------------------------------------------------------------------- narrow, dark, wide
for (const [width, scheme] of [[320, "light"], [320, "dark"], [1400, "dark"], [768, "light"]]) {
  const page = await open({ state: "staged", percent: 100, version: "0.2.0", last_checked_unix: 1794000000 }, { hash: "#/overview", width, height: 700, scheme });
  const fits = async (name) => {
    const over = await page.evaluate(() => {
      const w = innerWidth;
      return [...document.querySelectorAll(".update-slot *, .update-card *, .update-privacy *")].filter((el) => el.getBoundingClientRect().right > w + 0.5).length;
    });
    ok(over === 0 && (await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth)), `${name}: nothing runs past the edge at ${width}px ${scheme}`);
  };
  await fits("banner");
  await shot(page, `ready-${width}-${scheme}`);
  await refresh(page, { state: "failed", version: "0.2.0", error: "signature", link_enabled: true });
  ok((await page.locator(".update-slot .btn").count()) === 2, `the failed banner has both buttons at ${width}px ${scheme}`);
  await fits("failed banner with both buttons");
  await shot(page, `failed-link-${width}-${scheme}`);
  await refresh(page, { state: "staged", percent: 100, error: null, link_enabled: false });
  const buttons = await page.locator(".update-slot .btn").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  ok(buttons.every((h) => h >= 36), `buttons are at least 36px tall at ${width}px`, buttons.join(","));
  await page.evaluate(() => (location.hash = "#/settings"));
  await page.waitForTimeout(300);
  await fits("settings card");
  await shot(page, `settings-${width}-${scheme}`);
  await page.evaluate(() => (location.hash = "#/privacy"));
  await page.waitForTimeout(300);
  await fits("privacy block");
  await shot(page, `privacy-${width}-${scheme}`);
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------- focus and keyboard
{
  const page = await open({ state: "staged", percent: 100, version: "0.2.0" }, { hash: "#/overview" });
  const active = await page.evaluate(() => document.activeElement?.tagName);
  ok(active === "BODY", "the banner does not take focus", active);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  // The banner's buttons are reachable from the keyboard (they are ordinary buttons in the page's tab order).
  const reachable = await page.locator(".update-slot .btn").evaluateAll((els) => els.every((e) => e.tabIndex >= 0 && !e.disabled));
  ok(reachable, "the banner's buttons are focusable");
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------- text from an export
if (hostileZip) {
  const page = await open({}, { hash: "#/start" });
  await page.setInputFiles('input[type="file"]', path.resolve(hostileZip));
  await page.waitForTimeout(2500);
  let shownAsText = false;
  let created = 0;
  // The pages that list usernames, plus the main ones. The first friend of the export is named like markup.
  for (const route of ["#/overview", "#/cleanup", "#/requests", "#/quiet", "#/memories", "#/tools/friends-table", "#/tools/lookalike-usernames", "#/tools/closest-fading", "#/tools/reach-out-first"]) {
    await page.evaluate((r) => (location.hash = r), route);
    await page.waitForTimeout(400);
    const seen = await page.evaluate(() => ({
      text: document.body.innerText.includes('<div id="update-banner">'),
      made: document.querySelectorAll("#update-banner").length + (document.querySelector(".update-slot")?.children.length ?? 0) + [...document.querySelectorAll("button")].filter((b) => b.textContent === "Update now").length,
    }));
    shownAsText ||= seen.text;
    created += seen.made;
  }
  ok(shownAsText, "the markup-like username is on screen, as plain text (so the check below is not empty)");
  ok(created === 0, 'a username like <div id="update-banner"> in an export creates no element, no banner and no update button', String(created));
  await page.context().close();
}

await browser.close();
console.log(failures === 0 ? "ALL PASSED" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
