#!/usr/bin/env bash
# Renders the playground's voice-preview clips: one small MP3 per built-in preset, every one
# speaking PREVIEW_SENTENCE from site/voices.js — the sentence the ▶ controls play, the first
# one-click sample text, and what `ftts voices --preview` says.
#
# Usage: site/scripts/render-voice-previews.sh [--ftts PATH] [--out DIR] [NAME ...]
#
#   --ftts PATH   the ftts binary to synthesize with (default: $FTTS, else `ftts` on PATH).
#                 It must know every preset, so build it from THIS tree
#                 (`cargo build -p ftts-cli --release`) rather than trusting an installed release:
#                 an older binary fails on the first name it has never heard of, which is the
#                 right outcome — a roster with silent gaps is worse than no clips.
#   --out DIR     where the clips go (default: site/assets/audio/previews)
#   NAME ...      render only these presets (default: every entry of PRESETS in site/voices.js)
#
# Needs the model (`ftts pull`, or FTTS_MODEL_DIR pointing at it) and an MP3 encoder: ffmpeg
# (preferred) or lame. Synthesis is seeded (--seed 0), so re-rendering with an unchanged engine
# and voice reproduces the same audio; a changed engine is exactly when to re-run this.
#
# Why MP3, 48 kb/s, mono, 24 kHz: the engine's native rate and channel count, every browser's
# <audio> plays it, and a four-second sentence lands near 25 KB — under the PREVIEW_CLIP_MAX_BYTES
# budget that site/voices.test.js enforces, so a preview is one small fetch that starts at once.
# Metadata is stripped and no ID3 tag is written: the bytes are the audio and nothing else.
set -euo pipefail

SITE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VOICES_JS="$SITE_DIR/voices.js"
OUT_DIR="$SITE_DIR/assets/audio/previews"
FTTS_BIN="${FTTS:-ftts}"
BITRATE_KBPS=48

names=()
while [ $# -gt 0 ]; do
  case "$1" in
    --ftts) FTTS_BIN="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    -h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --*) echo "unknown option: $1" >&2; exit 2 ;;
    *) names+=("$1"); shift ;;
  esac
done

# The sentence and the roster are read from the file the page itself imports, so the clips can
# never drift from what the ▶ controls expect. voices.test.js checks the result the same way.
sentence="$(sed -n 's/^export const PREVIEW_SENTENCE = "\(.*\)";$/\1/p' "$VOICES_JS")"
max_bytes="$(sed -n 's/^export const PREVIEW_CLIP_MAX_BYTES = \(.*\);$/\1/p' "$VOICES_JS")"
if [ -z "$sentence" ] || [ -z "$max_bytes" ]; then
  echo "cannot read PREVIEW_SENTENCE / PREVIEW_CLIP_MAX_BYTES from $VOICES_JS" >&2
  exit 1
fi
max_bytes=$((max_bytes))
if [ ${#names[@]} -eq 0 ]; then
  while IFS= read -r name; do names+=("$name"); done \
    < <(grep -o '{ name: "[a-z0-9_-]*"' "$VOICES_JS" | cut -d'"' -f2)
fi
if [ ${#names[@]} -eq 0 ]; then
  echo "no preset names found in $VOICES_JS" >&2
  exit 1
fi

if ! command -v "$FTTS_BIN" >/dev/null 2>&1 && [ ! -x "$FTTS_BIN" ]; then
  echo "ftts binary not found: $FTTS_BIN (build one: cargo build -p ftts-cli --release; then --ftts PATH)" >&2
  exit 1
fi
if command -v ffmpeg >/dev/null 2>&1; then
  encoder=ffmpeg
elif command -v lame >/dev/null 2>&1; then
  encoder=lame
else
  echo "no MP3 encoder found: install ffmpeg (preferred) or lame" >&2
  exit 1
fi

encode() { # encode WAV MP3
  case "$encoder" in
    ffmpeg)
      ffmpeg -nostdin -hide_banner -loglevel error -y -i "$1" \
        -ac 1 -ar 24000 -c:a libmp3lame -b:a "${BITRATE_KBPS}k" \
        -map_metadata -1 -id3v2_version 0 "$2"
      ;;
    lame)
      lame --quiet --noreplaygain -m m -b "$BITRATE_KBPS" --resample 24 "$1" "$2"
      ;;
  esac
}

WORK="$(mktemp -d "${TMPDIR:-/tmp}/ftts-previews.XXXXXX")"
mkdir -p "$OUT_DIR"
echo "rendering ${#names[@]} preview clip(s) with $FTTS_BIN via $encoder into $OUT_DIR"
echo "sentence: $sentence"

failed=()
for name in "${names[@]}"; do
  wav="$WORK/$name.wav"
  mp3="$OUT_DIR/$name.mp3"
  # `say` emits its NDJSON event stream on stdout when piped; errors also arrive as events, so
  # keep stdout in the work dir for a post-mortem rather than discarding it.
  if ! "$FTTS_BIN" say --voice "$name" --seed 0 -o "$wav" "$sentence" >"$WORK/$name.events.ndjson"; then
    echo "  $name: synthesis FAILED (see $WORK/$name.events.ndjson)" >&2
    failed+=("$name")
    continue
  fi
  encode "$wav" "$mp3"
  size=$(wc -c <"$mp3" | tr -d ' ')
  if [ "$size" -gt "$max_bytes" ]; then
    echo "  $name: $size bytes exceeds the $max_bytes-byte budget; lower BITRATE_KBPS or shorten the sentence" >&2
    failed+=("$name")
    continue
  fi
  echo "  $name: $((size / 1024)) KB"
done

echo "work files left in $WORK (temp dir; not auto-deleted)"
if [ ${#failed[@]} -gt 0 ]; then
  echo "FAILED: ${failed[*]}" >&2
  exit 1
fi
echo "done: ${#names[@]} clip(s) in $OUT_DIR"
