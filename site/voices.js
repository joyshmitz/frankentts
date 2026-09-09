// The built-in voice roster and its preview clips. DOM-free on purpose: app.js imports it for
// the page, and site/voices.test.js imports it in plain Node.

// Mirrors PRESET_VOICES in crates/ftts-wasm/src/lib.rs (names and characters only; the
// vectors stay inside the wasm module). Static so the voice UI renders instantly and the
// voices section works even before the worker finishes booting. The test asserts this list
// and the wasm roster agree, which is how the site said "Seven Built-in Voices" for two
// releases after there were eighteen.
export const PRESETS = [
  { name: "matt", character: "warm, easy, masculine; the out-of-box default" },
  { name: "james", character: "natural, conversational, masculine" },
  { name: "leo", character: "relaxed, resonant, masculine" },
  { name: "robert", character: "steady, measured, masculine" },
  { name: "judy", character: "bright, articulate, feminine" },
  { name: "aria", character: "clear, warm, feminine" },
  { name: "ember", character: "aria's character, a few semitones deeper" },
  { name: "liam", character: "thoughtful, engaging, masculine" },
  { name: "anthony", character: "authoritative, articulate, masculine" },
  { name: "russell", character: "rich, warm, masculine" },
  { name: "steve", character: "direct, energetic, masculine" },
  { name: "daniel", character: "clear, calm, masculine" },
  { name: "meryl", character: "expressive, poised, feminine" },
  { name: "laurence", character: "deep, measured, masculine" },
  { name: "jack", character: "crisp, confident, masculine" },
  { name: "michael", character: "warm, dynamic, masculine" },
  { name: "jodie", character: "warm, expressive, feminine" },
  { name: "denzel", character: "commanding, charismatic, masculine" },
];

// The one sentence every voice preview speaks: the pre-rendered preset clips, a cloned
// voice's live preview, and `ftts voices --preview`. It is also the first one-click sample
// text, so pressing Synthesize right after a preview reproduces what was just heard.
// Change it here, re-run site/scripts/render-voice-previews.sh, and keep the CLI's copy
// (PREVIEW_SENTENCE in crates/ftts-cli/src/lib.rs) identical; the test holds the three together.
export const PREVIEW_SENTENCE = "Now is the time for all good men to come to the aid of the agents.";

// Where the pre-rendered clips live, relative to the site root. One `<name>.mp3` per preset,
// written by site/scripts/render-voice-previews.sh. MP3 because every browser's <audio>
// plays it and the page already speaks it (the MP3 download uses the same codec).
export const PREVIEW_CLIP_DIR = "assets/audio/previews";

// A preview has to feel instant, so a clip stays well under the page's own scripts.
export const PREVIEW_CLIP_MAX_BYTES = 60 * 1024;

export function isPresetName(name) {
  return PRESETS.some((preset) => preset.name === name);
}

/// URL of a preset's preview clip, or null for anything that is not on the roster — the cloned
/// voice, or a name arriving from a share fragment. The name becomes a path segment, so only
/// roster members may build one. `version` is the deploy stamp, so a re-rendered clip is
/// never served from a stale browser cache.
export function previewClipUrl(name, version = "") {
  if (!isPresetName(name)) return null;
  const url = `${PREVIEW_CLIP_DIR}/${name}.mp3`;
  return version ? `${url}?v=${encodeURIComponent(version)}` : url;
}
