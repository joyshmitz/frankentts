// Voice-preview controls, in a real browser over the real site — WITHOUT the model.
//
// Run:  node site/harness/preview.test.mjs [--headed]
//
// browser.mjs proves the engine path and needs the 1.8 GB model on disk; this proves the one
// thing previews promise that the engine path cannot — that a ▶ press answers BEFORE any
// download — so it must run with no model at all. Real Chromium, real static serving with the
// shipped headers and CSP (media-src 'self' is what lets the clips play), real <audio>.
//
// What it asserts:
//   1. one ▶ per preset card plus one beside the picker, each a real <button> with a label
//   2. a press fetches that preset's clip (HTTP 200, audio/mpeg, within the size budget) and the
//      control reports itself pressed while the clip is loading or playing
//   3. pressing a second preview releases the first (one preview at a time)
//   4. pressing the live control again stops it
//   5. the picker's control follows the selection, and is disabled for the (absent) cloned voice
//   6. no console errors or page errors along the way

import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { PRESETS, PREVIEW_CLIP_DIR, PREVIEW_CLIP_MAX_BYTES } from "../voices.js";

const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HEADED = process.argv.includes("--headed");

let failures = 0;
function check(condition, message) {
  if (condition) return;
  failures += 1;
  console.error(`FAIL: ${message}`);
}

const { server, port } = await serve({ siteDir, modelFiles: {} });
const origin = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: !HEADED });
const page = await browser.newPage();
const problems = [];
page.on("console", (message) => {
  if (message.type() === "error") problems.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
const clipRequests = [];
page.on("response", (response) => {
  if (response.url().includes(`/${PREVIEW_CLIP_DIR}/`)) clipRequests.push(response);
});

try {
  await page.goto(`${origin}/`, { waitUntil: "load" });
  await page.waitForSelector("#voice-cards .pg-preview");

  // 1. controls exist and are labelled
  const cardButtons = page.locator("#voice-cards .pg-preview");
  check((await cardButtons.count()) === PRESETS.length, `expected ${PRESETS.length} card preview controls, found ${await cardButtons.count()}`);
  for (const preset of PRESETS) {
    const button = page.locator(`#voice-cards button[aria-label="Preview ${preset.name}"]`);
    check((await button.count()) === 1, `no labelled preview control for ${preset.name}`);
  }
  const picker = page.locator("#voice-preview");
  check((await picker.getAttribute("aria-label")) === "Preview matt", "the picker's control previews the default voice");

  // 2. a press fetches the clip and lights the control
  // Located by the stable data attribute: the label itself changes while a preview is live.
  const first = page.locator('#voice-cards button[data-preview-label="aria"]');
  const box = await first.boundingBox();
  // Armed before the press: a static clip answers faster than a listener registered after.
  const clipResponse = page.waitForResponse((r) => r.url().includes(`/${PREVIEW_CLIP_DIR}/aria.mp3`));
  await first.click();
  await page.waitForFunction(() => document.querySelector('#voice-cards button[data-preview-label="aria"]')?.getAttribute("aria-pressed") === "true");
  const response = await clipResponse;
  check(response.status() === 200, `aria clip returned ${response.status()}`);
  check((response.headers()["content-type"] ?? "").startsWith("audio/mpeg"), `aria clip served as ${response.headers()["content-type"]}`);
  check((await response.body()).length <= PREVIEW_CLIP_MAX_BYTES, "aria clip over the size budget");
  check((await first.boundingBox()).width === box.width, "the control changed width when pressed (layout shift)");
  check((await first.getAttribute("aria-label")) === "Stop the preview of aria", "the live control offers to stop");

  // 3. a second preview releases the first
  const second = page.locator('#voice-cards button[data-preview-label="judy"]');
  await second.click();
  await page.waitForFunction(() => document.querySelector('#voice-cards button[data-preview-label="judy"]')?.getAttribute("aria-pressed") === "true");
  check((await first.getAttribute("aria-pressed")) === "false", "starting judy did not release aria");
  check((await page.evaluate(() => document.querySelectorAll('.pg-preview[aria-pressed="true"]').length)) === 1, "more than one preview is live");

  // 4. pressing the live control stops it
  check((await second.getAttribute("aria-label")) === "Stop the preview of judy", "the live control offers to stop");
  await second.click();
  await page.waitForFunction(() => document.querySelectorAll('.pg-preview[aria-pressed="true"]').length === 0);
  check((await second.getAttribute("aria-label")) === "Preview judy", "a stopped control returns to idle");

  // 5. the picker's control follows the selection; the cloned voice needs a clone + engine
  await page.selectOption("#voice", "ember");
  check((await picker.getAttribute("aria-label")) === "Preview ember", "the picker's control did not follow the selection");
  check(!(await picker.isDisabled()), "a preset's preview must never be disabled");
  await page.evaluate(() => {
    const option = [...document.querySelector("#voice").options].find((o) => o.value === "__cloned__");
    option.disabled = false;
    document.querySelector("#voice").value = "__cloned__";
    document.querySelector("#voice").dispatchEvent(new Event("change"));
  });
  check(await picker.isDisabled(), "with no clone and no engine, the cloned preview must be disabled");
  check((await picker.getAttribute("title") ?? "").includes("model must be loaded"), "the disabled control must say why");
  await page.keyboard.press("Tab"); // the disabled control is skipped, nothing throws

  // 6. keyboard: a card control activates from the keyboard like any button
  await page.locator('#voice-cards button[data-preview-label="leo"]').focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector('#voice-cards button[data-preview-label="leo"]')?.getAttribute("aria-pressed") === "true");

  check(clipRequests.every((r) => r.status() === 200), `a clip request failed: ${clipRequests.filter((r) => r.status() !== 200).map((r) => `${r.url()} ${r.status()}`).join(", ")}`);
  for (const problem of problems) check(false, problem);
} finally {
  await browser.close();
  server.close();
}

if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log(`ok: ${PRESETS.length} preset previews, picker control, stop-others, keyboard`);
