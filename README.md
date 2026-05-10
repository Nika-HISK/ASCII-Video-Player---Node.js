# ASCII Video Player — Node.js

A terminal ASCII art video player. Converts any video file into real-time ASCII art rendered directly in your terminal, with optional ANSI 24-bit true color.

> Ported from a Python/OpenCV implementation. No OpenCV required — uses ffmpeg to pipe raw RGB frames directly into Node.js.

---

## Features

- **True color mode** — ANSI 24-bit RGB per character (`--color`)
- **Grayscale mode** — 92-character ASCII ramp, faster rendering
- **Delta rendering** — only rewrites lines that changed between frames, eliminating flicker
- **Drift-free timing** — absolute frame deadlines, no timing drift over long videos
- **Color deduplication** — skips redundant ANSI escape codes for neighboring pixels of the same color
- **Auto-clamp** — width and height are automatically clamped to your terminal size so lines never wrap
- **Frame skip** — skip every N frames to reduce CPU load on slower machines
- **Loop mode** — repeat video until Ctrl+C
- **Live FPS counter** — status bar shows actual measured render fps
- **Interactive mode** — run with no arguments for guided prompts

---

## Requirements

- **Node.js** v16 or newer
- **ffmpeg** + **ffprobe** (see installation below)

---

## ffmpeg Setup

### Option A — Place in project folder (recommended for Windows)

1. Download from **https://www.gyan.dev/ffmpeg/builds/** → `ffmpeg-release-essentials.zip`
2. Extract it into your project folder
3. The folder name should match what's in the script:
   ```
   ASCII/
   ├── main.js
   ├── ffmpeg-8.1.1-essentials_build/
   │   └── bin/
   │       ├── ffmpeg.exe
   │       └── ffprobe.exe
   └── video.mp4
   ```

### Option B — Add to system PATH

1. Extract ffmpeg anywhere, e.g. `C:\ffmpeg\`
2. Add `C:\ffmpeg\bin` to your system PATH
3. Update the two path constants at the top of `main.js`:
   ```js
   const FFMPEG  = 'ffmpeg';
   const FFPROBE = 'ffprobe';
   ```

---

## Installation

```bash
npm install
```

This installs the only dependency: [`commander`](https://github.com/tj/commander.js) for CLI argument parsing.

---

## Usage

```bash
# Interactive mode — prompts for everything
node main.js

# Basic playback (grayscale)
node main.js video.mp4

# Color mode
node main.js video.mp4 --color

# Color, custom width
node main.js video.mp4 --color --width 100

# Faster on slow machines (render every 2nd frame)
node main.js video.mp4 --color --skip 2

# Grayscale, wide, looped
node main.js video.mp4 --no-color --width 160 --loop

# Show video info only
node main.js video.mp4 --info
```

---

## Options

| Flag | Short | Default | Description |
|---|---|---|---|
| `--color` | `-c` | off | ANSI 24-bit true color output |
| `--no-color` | | on | Grayscale ASCII (faster) |
| `--width <n>` | `-w` | auto | Output width in characters (auto-clamped to terminal) |
| `--skip <n>` | `-s` | `1` | Render every Nth frame — `--skip 2` = half frame rate, half CPU load |
| `--loop` | `-l` | off | Loop video until Ctrl+C |
| `--info` | `-i` | off | Print video metadata and exit |

---

## Tips

- **Best terminal for color mode:** Windows Terminal (free on Microsoft Store). The classic PowerShell window renders ANSI slowly.
- **Best font:** Cascadia Mono, Consolas, or Courier New at size 6–8pt. Monospace fonts with near-square characters look best.
- **Video is choppy?** Try `--skip 2`. The player will render at half the frame rate but use half the CPU.
- **Image looks squished?** Your font's character height/width ratio may differ. Try adjusting `--width` up or down until proportions look right.
- **Width default** is automatically set to your terminal column count minus 1, so lines never wrap.

---

## How It Works

```
ffmpeg -i video.mp4 -f rawvideo -pix_fmt rgb24 -vf scale=W:H pipe:1
          │
          └─► raw RGB24 byte stream (W × H × 3 bytes per frame)
                    │
                    ▼
          Per-pixel BT.601 luminance → index into 92-char ASCII table
          + optional ANSI \x1b[38;2;R;G;Bm color escape per pixel
                    │
                    ▼
          Delta renderer: compare to previous frame,
          only write terminal escape sequences for changed lines
                    │
                    ▼
          process.stdout.write() with drift-free absolute frame timing
```

### Why ffmpeg instead of OpenCV?

- No native module compilation (`node-gyp` free)
- Supports every codec ffmpeg supports — H.264, H.265, AV1, VP9, and more
- The `scale=W:H` filter handles resizing natively
- Raw RGB24 pipe is the fastest possible interface between ffmpeg and Node

---

## Project Structure

```
ASCII/
├── main.js              # Player — all logic in one file
├── package.json
├── node_modules/
├── ffmpeg-x.x.x-essentials_build/
│   └── bin/
│       ├── ffmpeg.exe
│       └── ffprobe.exe
└── video.mp4            # Your video file
```

---
