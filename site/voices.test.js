// Roster and preview-clip contract test for site/voices.js, in plain Node.
//
// Run: node site/voices.test.js   (exit 0 = pass, 1 = fail)
//
// The roster is written down in four places that cannot import each other — the wasm module's
// PRESET_VOICES (the vectors), the CLI's table, the page's PRESETS (what the picker shows), and
// the directory of pre-rendered preview clips — and the sentence those clips speak is written
// down in three (voices.js, the render script, the CLI's `voices --preview`). This test is what
// holds them together: a preset added to the engine without a clip, a clip for a voice that no
// longer exists, or a sentence edited in one place, all fail here rather than on the live site.
// The heading check exists because the voices section said "Seven Built-in Voices" for two
// releases after there were eighteen.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRESETS,
  PREVIEW_SENTENCE,
  PREVIEW_CLIP_DIR,
  PREVIEW_CLIP_MAX_BYTES,
  isPresetName,
  previewClipUrl,
} from "./voices.js";

const siteDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(siteDir, "..");
const read = (relative) => fs.readFileSync(path.join(repoDir, relative), "utf8");

let failures = 0;
function check(condition, message) {
  if (condition) return;
  failures += 1;
  console.error(`FAIL: ${message}`);
}

/// Preset names from a Rust `PRESET_VOICES` table, in table order.
function rustRoster(source) {
  const table = /const PRESET_VOICES[^=]*=\s*&\[([\s\S]*?)\n\];/.exec(source);
  if (!table) return null;
  return [...table[1].matchAll(/\(\s*"([a-z0-9_-]+)",\s*"/g)].map((m) => m[1]);
}

// ── roster ─────────────────────────────────────────────────────────────────────────────────
const names = PRESETS.map((preset) => preset.name);
check(names.length > 0, "the roster is empty");
check(new Set(names).size === names.length, `duplicate preset names: ${names.join(", ")}`);
for (const preset of PRESETS) {
  check(/^[a-z][a-z0-9_-]*$/.test(preset.name), `preset name is not a safe path segment: ${preset.name}`);
  check(typeof preset.character === "string" && preset.character.length > 0, `preset ${preset.name} has no character line`);
}

const wasmRoster = rustRoster(read("crates/ftts-wasm/src/lib.rs"));
check(wasmRoster !== null, "could not find PRESET_VOICES in crates/ftts-wasm/src/lib.rs");
if (wasmRoster) {
  check(
    JSON.stringify(wasmRoster) === JSON.stringify(names),
    `site PRESETS differ from the wasm PRESET_VOICES table (order matters; the picker mirrors it)\n  wasm: ${wasmRoster.join(", ")}\n  site: ${names.join(", ")}`,
  );
}
const cliRoster = rustRoster(read("crates/ftts-cli/src/lib.rs"));
check(cliRoster !== null, "could not find PRESET_VOICES in crates/ftts-cli/src/lib.rs");
if (cliRoster) {
  const cliSet = new Set(cliRoster);
  check(
    cliSet.size === names.length && names.every((name) => cliSet.has(name)),
    `site PRESETS and the CLI PRESET_VOICES table are different sets\n  cli: ${[...cliSet].sort().join(", ")}\n  site: ${[...names].sort().join(", ")}`,
  );
}

// ── the sentence ───────────────────────────────────────────────────────────────────────────
check(PREVIEW_SENTENCE.length > 0 && PREVIEW_SENTENCE.length <= 120, "the preview sentence must be short");
const cliSentence = /const PREVIEW_SENTENCE: &str =\s*"([^"]*)";/.exec(read("crates/ftts-cli/src/lib.rs"));
check(cliSentence !== null, "could not find PREVIEW_SENTENCE in crates/ftts-cli/src/lib.rs");
if (cliSentence) {
  check(cliSentence[1] === PREVIEW_SENTENCE, `the CLI's PREVIEW_SENTENCE differs from the site's:\n  cli:  ${cliSentence[1]}\n  site: ${PREVIEW_SENTENCE}`);
}
const renderScript = read("site/scripts/render-voice-previews.sh");
check(
  renderScript.includes("PREVIEW_SENTENCE") && renderScript.includes("voices.js"),
  "the render script must read the sentence and roster from site/voices.js, not carry its own copies",
);

// ── the clips ──────────────────────────────────────────────────────────────────────────────
const clipDir = path.join(siteDir, PREVIEW_CLIP_DIR);
check(fs.existsSync(clipDir), `preview clip directory missing: ${clipDir}`);
const present = fs.existsSync(clipDir)
  ? fs.readdirSync(clipDir).filter((file) => file.endsWith(".mp3"))
  : [];
for (const name of names) {
  const file = path.join(clipDir, `${name}.mp3`);
  if (!fs.existsSync(file)) {
    check(false, `no preview clip for ${name}: run site/scripts/render-voice-previews.sh ${name}`);
    continue;
  }
  const bytes = fs.readFileSync(file);
  check(bytes.length <= PREVIEW_CLIP_MAX_BYTES, `${name}.mp3 is ${bytes.length} bytes, over the ${PREVIEW_CLIP_MAX_BYTES}-byte budget`);
  check(bytes.length >= 4096, `${name}.mp3 is only ${bytes.length} bytes — a silent or truncated render`);
  // A bare MPEG audio stream begins with a frame sync (11 set bits); the render script strips
  // ID3, so a tag here means the clip did not come from the script.
  const framed = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  check(framed, `${name}.mp3 does not start with an MPEG frame sync (found ${bytes.subarray(0, 3).toString("hex")})`);
}
for (const file of present) {
  const stem = file.slice(0, -".mp3".length);
  check(isPresetName(stem), `orphan preview clip for a voice not on the roster: ${file}`);
}

// ── the URL builder ────────────────────────────────────────────────────────────────────────
check(previewClipUrl("matt") === `${PREVIEW_CLIP_DIR}/matt.mp3`, "previewClipUrl builds the clip path");
check(previewClipUrl("matt", "abc 1") === `${PREVIEW_CLIP_DIR}/matt.mp3?v=abc%201`, "previewClipUrl appends the encoded deploy stamp");
check(previewClipUrl("__cloned__") === null, "the cloned voice has no clip");
check(previewClipUrl("../index") === null, "a non-roster name never becomes a path");
check(previewClipUrl("") === null && previewClipUrl(undefined) === null, "empty names have no clip");
check(!isPresetName("Matt"), "names are exact (case-sensitive), like the engine's lookup");

// ── the page ───────────────────────────────────────────────────────────────────────────────
const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
  "nineteen", "twenty", "twenty-one", "twenty-two", "twenty-three", "twenty-four",
];
const html = read("site/index.html");
const voicesSection = /<section id="voices"[\s\S]*?<\/h2>/.exec(html)?.[0] ?? "";
const heading = voicesSection.replace(/<[^>]+>/g, " ").toLowerCase();
const word = NUMBER_WORDS[names.length];
check(word !== undefined, `add a number word for ${names.length} presets`);
check(
  heading.includes(`${word} `) && heading.includes("built-in"),
  `the voices heading must count ${word} (${names.length}) built-in voices; found: ${heading.trim().replace(/\s+/g, " ")}`,
);
check(html.includes('id="voice-preview"'), "the picker's preview control is missing from index.html");

if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log(`ok: ${names.length} presets, ${names.length} preview clips, one sentence`);
