# Voice lines

The game speaks with pre-rendered German clips in `public/voice/` (Ogg/Opus, mono, ~40 kbps, about -20 LUFS) plus `public/voice/manifest.json`
(`{ "<line text>": "voice/<id>-<n>.ogg" }`). They are generated offline and committed; the browser's speech synthesis is not used.
`src/audio/voice.js` looks the text up in the manifest. Text that is not in the manifest is shown as a caption only.

Each variant of every line in `src/audio/lines.js` is rendered with Piper, then ffmpeg applies a seeded random pitch (0.82-1.3, rubberband) and the
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
`npm test` checks that every catalog variant has a manifest entry and every manifest file exists.

## Licenses

- Voice: Thorsten (de_DE, high), dataset by Thorsten Mueller, CC0 (public domain). Model hosted in `rhasspy/piper-voices` on Hugging Face.
- Engine: Piper, `piper-tts` 1.8.0 (OHF-Voice/piper1-gpl) is GPL-3.0-or-later. It is only used as an external tool at generation time and is not part
  of the shipped game; the generated audio is not a derivative of the engine's code.
- ffmpeg is invoked as an external program.
