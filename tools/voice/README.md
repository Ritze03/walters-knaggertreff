# Voice lines

The game speaks with pre-rendered German clips in `public/voice/` (Ogg/Opus, mono, ~40 kbps, about -20 LUFS) plus `public/voice/manifest.json`
(`{ "<line text>": "voice/<id>-<n>.ogg" }`). They are generated offline and committed; the browser's speech synthesis is not used.
`src/audio/voice.js` looks the text up in the manifest. Text that is not in the manifest is shown as a caption only.

Each variant of every line in `src/audio/lines.js` **and of every `src/minigames/*/lines.js`** is rendered with Piper, then ffmpeg applies a seeded random pitch (0.82-1.3, rubberband) and the
Piper `length_scale` (0.85-1.1) for the comedic wobble, trims silence, normalises to -20 LUFS (two-pass loudnorm) and encodes Opus.

## Regenerate (only needed when lines.js texts change)

Needs `ffmpeg` (with libopus, rubberband, loudnorm), `node` and `python3`. Keep the venv and the model outside the repo.

```sh
python3 -m venv ~/voice/venv && ~/voice/venv/bin/pip install piper-tts      # tested with piper-tts 1.8.0, Python 3.14
mkdir -p ~/voice/model && cd ~/voice/model
B=https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/high
curl -fLO $B/de_DE-thorsten-high.onnx && curl -fLO $B/de_DE-thorsten-high.onnx.json   # sha256 of the .onnx: 9df1c43c61149ef9b39e618e2b861fbe41e1fcea9390b2dac62e8761573ea4f1
cd <repo> && node tools/voice/generate.mjs --python ~/voice/venv/bin/python --model ~/voice/model/de_DE-thorsten-high.onnx
```

Existing clips whose text is unchanged are kept (Piper samples noise, so a re-render would sound slightly different); only new or edited lines are
rendered, and clips no longer in `lines.js` are deleted. `--force` re-renders everything, `--only id,id` re-renders those ids.
`npm test` (`src/audio/lines.test.js`) checks that every core and minigame line has a manifest entry whose file exists, that the manifest has no stale
texts or orphan clips, and that no file under `src/` mentions the browser speech API.

## Ids and minigame lines

`tools/voice/collect.mjs` (shared by `generate.mjs` and the test) lists all lines. It globs `src/minigames/<game>/lines.js` (default export: object of
string arrays, see `src/contracts.js` section 10) and ignores game folders without one.

- Core line: `voice/<lineId>-<n>.ogg` (n = variant index).
- Minigame line: `voice/mg-<game>-<key>-<n>.ogg`, e.g. `voice/mg-pfand-junk-1.ogg`. Game folder must match `[a-z0-9]+`, keys `[A-Za-z0-9_]+`.
- The text is the manifest key, so identical text is rendered once. Core lines come first, then games sorted by folder name; the first occurrence
  names the clip (so pfand's "Leergut wird nicht angenommen!" reuses `voice/jam-0.ogg`). Moving a text to an earlier id re-renders it; use `--only`
  with the id (`mg-<game>-<key>`) to force a single line.
- A new minigame line only needs to be added to its `lines.js`; run the generator and commit `public/voice/`. The test fails until you do.

## Licenses

- Voice: Thorsten (de_DE, high), dataset by Thorsten Mueller, CC0 (public domain). Model hosted in `rhasspy/piper-voices` on Hugging Face.
- Engine: Piper, `piper-tts` 1.8.0 (OHF-Voice/piper1-gpl) is GPL-3.0-or-later. It is only used as an external tool at generation time and is not part
  of the shipped game; the generated audio is not a derivative of the engine's code.
- ffmpeg is invoked as an external program.
