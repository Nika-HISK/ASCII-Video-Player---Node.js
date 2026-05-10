'use strict';

const { program }     = require('commander');
const { spawn }       = require('child_process');
const path            = require('path');
const fs              = require('fs');
const readline        = require('readline');
const { performance } = require('perf_hooks');

const FFMPEG  = path.join(__dirname, 'ffmpeg-8.1.1-essentials_build', 'bin', 'ffmpeg.exe');
const FFPROBE = path.join(__dirname, 'ffmpeg-8.1.1-essentials_build', 'bin', 'ffprobe.exe');

const ASCII_CHARS =
  " `.-':_,^=;><+!rc*/z?sLTv)J7(|Fi{C}fI31tlu" +
  "[neoZ5Yxjya]2ESwqkP6h9d4VpOGbUAKXHm8RD#$Bg0MNWQ%&@";
const CHAR_COUNT = ASCII_CHARS.length;

const CHAR_TABLE = Array.from(ASCII_CHARS);

const CURSOR_HOME  = '\x1b[H';
const CLEAR_SCREEN = '\x1b[2J';
const HIDE_CURSOR  = '\x1b[?25l';
const SHOW_CURSOR  = '\x1b[?25h';
const RESET_COLOR  = '\x1b[0m';
const C_CYAN       = '\x1b[96m';
const C_GREEN      = '\x1b[92m';
const C_YELLOW     = '\x1b[93m';
const C_RED        = '\x1b[91m';
const C_GRAY       = '\x1b[90m';
const C_BOLD       = '\x1b[1m';

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

function enableAnsiWindows() {
  if (process.platform === 'win32') {
    process.env.FORCE_COLOR = '3';
    if (process.stdout._handle && process.stdout._handle.setBlocking) {
      process.stdout._handle.setBlocking(true);
    }
  }
}

function getVideoInfo(videoPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFPROBE, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-select_streams', 'v:0',
      videoPath,
    ]);
    let out = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', () => {});
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error('ffprobe failed — is the file a valid video?'));
      try {
        const stream = JSON.parse(out).streams[0];
        const [num, den] = (stream.r_frame_rate || '30/1').split('/');
        resolve({
          fps        : parseInt(num, 10) / parseInt(den, 10),
          totalFrames: parseInt(stream.nb_frames, 10) || 0,
          widthPx    : stream.width,
          heightPx   : stream.height,
          durationS  : parseFloat(stream.duration || '0'),
        });
      } catch (e) {
        reject(new Error(`ffprobe parse error: ${e.message}`));
      }
    });
  });
}

function printInfo(videoPath, info) {
  const dur  = Math.floor(info.durationS);
  const mm   = String(Math.floor(dur / 60)).padStart(2, '0');
  const ss   = String(dur % 60).padStart(2, '0');
  console.log(`\n${C_BOLD}${C_CYAN}${'─'.repeat(52)}${RESET_COLOR}`);
  console.log(`  ${C_BOLD}ASCII Video Player — Node.js v2${RESET_COLOR}`);
  console.log(`${C_CYAN}${'─'.repeat(52)}${RESET_COLOR}`);
  console.log(`  ${C_YELLOW}File      ${RESET_COLOR}: ${path.basename(videoPath)}`);
  console.log(`  ${C_YELLOW}Resolution${RESET_COLOR}: ${info.widthPx} x ${info.heightPx} px`);
  console.log(`  ${C_YELLOW}FPS       ${RESET_COLOR}: ${info.fps.toFixed(2)}`);
  console.log(`  ${C_YELLOW}Duration  ${RESET_COLOR}: ${mm}:${ss} (${info.totalFrames} frames)`);
  console.log(`${C_CYAN}${'─'.repeat(52)}${RESET_COLOR}\n`);
}


function frameToAsciiNoColor(rgbBuf, width, height) {
  const n     = CHAR_COUNT - 1;
  const lines = new Array(height);

  for (let y = 0; y < height; y++) {
    const row = new Array(width);
    const base = y * width * 3;
    for (let x = 0; x < width; x++) {
      const i    = base + x * 3;
      const luma = 0.299 * rgbBuf[i] + 0.587 * rgbBuf[i + 1] + 0.114 * rgbBuf[i + 2];
      row[x]     = CHAR_TABLE[Math.min(n, luma * n / 255 | 0)];
    }
    lines[y] = row.join('');
  }

  return lines;
}


function frameToAsciiColor(rgbBuf, width, height) {
  const n     = CHAR_COUNT - 1;
  const lines = new Array(height);

  for (let y = 0; y < height; y++) {
    const parts = new Array(width + 1);
    const base  = y * width * 3;
    let prevR = -1, prevG = -1, prevB = -1;

    for (let x = 0; x < width; x++) {
      const i  = base + x * 3;
      const r  = rgbBuf[i];
      const g  = rgbBuf[i + 1];
      const b  = rgbBuf[i + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      const ch   = CHAR_TABLE[Math.min(n, luma * n / 255 | 0)];

      if (r === prevR && g === prevG && b === prevB) {
        parts[x] = ch;
      } else {
        parts[x] = `\x1b[38;2;${r};${g};${b}m${ch}`;
        prevR = r; prevG = g; prevB = b;
      }
    }
    parts[width] = RESET_COLOR;
    lines[y]     = parts.join('');
  }

  return lines;
}

let _prevLines = null;

function renderDelta(newLines, height) {
  if (!_prevLines || _prevLines.length !== height) {
    _prevLines = new Array(height).fill(null);
    process.stdout.write(CURSOR_HOME);
    process.stdout.write(newLines.join('\n'));
    _prevLines = newLines.slice();
    return;
  }

  const out = [];
  for (let y = 0; y < height; y++) {
    if (newLines[y] !== _prevLines[y]) {
      out.push(`\x1b[${y + 1};1H${newLines[y]}`);
    }
  }
  if (out.length > 0) process.stdout.write(out.join(''));
  _prevLines = newLines.slice();
}

const QUEUE_MAX = 12;

async function* decodeFrames(videoPath, outWidth, outHeight, skip, signal) {
  const bytesPerFrame = outWidth * outHeight * 3;

  const proc = spawn(FFMPEG, [
    '-i', videoPath,
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    '-vf', `scale=${outWidth}:${outHeight}`,
    'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'ignore'] });

  signal.addEventListener('abort', () => {
    try { proc.kill('SIGKILL'); } catch (_) {}
  });

  const queue   = [];
  let   done    = false;
  let   resolve = null;

  proc.stdout.on('data', (chunk) => {
    queue.push(chunk);
    if (resolve) { resolve(); resolve = null; }
  });
  proc.stdout.on('end', () => {
    done = true;
    if (resolve) { resolve(); resolve = null; }
  });

  const waitForData = () => new Promise((r) => { resolve = r; });

  let carry    = Buffer.alloc(0);
  let frameIdx = 0;

  while (!signal.aborted) {
    while (queue.length > 0) carry = Buffer.concat([carry, queue.shift()]);

    if (carry.length < bytesPerFrame) {
      if (done) break;
      await waitForData();
      continue;
    }

    while (carry.length >= bytesPerFrame) {
      const frameBuf = carry.slice(0, bytesPerFrame);
      carry          = carry.slice(bytesPerFrame);

      if (frameIdx % skip === 0) {
        yield { rgbBuf: frameBuf, frameIndex: frameIdx };
      }
      frameIdx++;
    }
  }
}


function renderStatusBar(current, total, loopNum, loop, fps) {
  const BAR_LEN  = 36;
  const progress = Math.min(1, current / Math.max(1, total));
  const filled   = Math.floor(BAR_LEN * progress);
  const bar      = '█'.repeat(filled) + '░'.repeat(BAR_LEN - filled);
  const loopInfo = loop ? ` | Loop #${loopNum}` : '';
  const fpsInfo  = ` | ${fps.toFixed(1)} fps`;
  return `${RESET_COLOR}${C_GRAY}[${bar}] ${current}/${total}${loopInfo}${fpsInfo} | Ctrl+C to quit${RESET_COLOR}`;
}


async function playVideo({ videoPath, width, useColor, skip, loop }) {
  if (!fs.existsSync(videoPath)) {
    console.error(`${C_RED}[ERROR]${RESET_COLOR} File not found: '${videoPath}'`);
    process.exit(1);
  }

  enableAnsiWindows();

  let info;
  try {
    info = await getVideoInfo(videoPath);
  } catch (e) {
    console.error(`${C_RED}[ERROR]${RESET_COLOR} ${e.message}`);
    process.exit(1);
  }

  const fps = info.fps > 0 ? info.fps : 30;

  const termCols  = process.stdout.columns || 120;
  width           = Math.min(width, termCols - 1);

  const asciiWidth  = width;
  const aspectRatio = info.heightPx / info.widthPx;
  const asciiHeight = Math.max(1, Math.floor(asciiWidth * aspectRatio / 2));

  const termRows    = process.stdout.rows || 40;
  const renderHeight = Math.min(asciiHeight, termRows - 2);

  const converter = useColor ? frameToAsciiColor : frameToAsciiNoColor;

  printInfo(videoPath, info);
  console.log(`  Mode      : ${useColor ? `${C_GREEN}COLOR (ANSI 24-bit)${RESET_COLOR}` : `${C_GRAY}GRAYSCALE${RESET_COLOR}`}`);
  console.log(`  Width     : ${asciiWidth} chars × ${renderHeight} rows`);
  console.log(`  Skip      : every ${skip} frame(s)  (~${(fps / skip).toFixed(1)} fps target)`);
  console.log(`  Loop      : ${loop ? 'Yes' : 'No'}`);
  console.log(`\n${C_YELLOW}Starting in 2 seconds... Ctrl+C to quit.${RESET_COLOR}\n`);
  await sleep(2000);

  process.stdout.write(HIDE_CURSOR);
  process.stdout.write(CLEAR_SCREEN);
  _prevLines = null;

  const totalRendered = Math.max(1, Math.ceil(info.totalFrames / skip));
  const frameDelayMs  = (1000 / fps) * skip;

  let loopNum     = 0;
  let interrupted = false;
  let abortCtrl   = new AbortController();

  const onSigint = () => {
    interrupted = true;
    abortCtrl.abort();
  };
  process.on('SIGINT', onSigint);

  while (!interrupted) {
    loopNum++;
    abortCtrl  = new AbortController();
    _prevLines = null;

    let frameCount  = 0;
    let fpsAccum    = 0;
    let lastFpsTime = performance.now();
    let renderedFps = fps / skip;

    const playStart = performance.now();

    try {
      for await (const { rgbBuf } of decodeFrames(
        videoPath, asciiWidth, renderHeight, skip, abortCtrl.signal
      )) {
        if (interrupted) break;

        frameCount++;
        fpsAccum++;

        const lines     = converter(rgbBuf, asciiWidth, renderHeight);
        const now       = performance.now();

        if (fpsAccum >= 15) {
          renderedFps = 1000 * fpsAccum / (now - lastFpsTime);
          lastFpsTime = now;
          fpsAccum    = 0;
        }

        renderDelta(lines, renderHeight);

        process.stdout.write(
          `\x1b[${renderHeight + 1};1H` +
          renderStatusBar(frameCount, totalRendered, loopNum, loop, renderedFps)
        );

        const deadline  = playStart + frameCount * frameDelayMs;
        const sleepTime = deadline - performance.now();
        if (sleepTime > 1) await sleep(sleepTime);
      }
    } catch (e) {
      if (!interrupted) console.error(`\n${C_RED}[ERROR]${RESET_COLOR} ${e.message}`);
      break;
    }

    if (!loop || interrupted) break;
  }

  process.removeListener('SIGINT', onSigint);
  process.stdout.write(SHOW_CURSOR);
  process.stdout.write(RESET_COLOR);
  process.stdout.write(`\x1b[${_prevLines ? _prevLines.length + 2 : 2};1H`);

  console.log(interrupted
    ? `\n${C_YELLOW}[INFO]${RESET_COLOR} Stopped by user.\n`
    : `\n${C_GREEN}[INFO]${RESET_COLOR} Playback complete.\n`
  );
}

async function interactivePrompt() {
  const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((r) => rl.question(q, r));

  console.log(`\n${C_BOLD}${C_CYAN}${'─'.repeat(52)}${RESET_COLOR}`);
  console.log(`  ${C_BOLD}ASCII Video Player — Node.js v2${RESET_COLOR}`);
  console.log(`${C_CYAN}${'─'.repeat(52)}${RESET_COLOR}`);
  console.log(`\n  For all options: ${C_YELLOW}node main.js --help${RESET_COLOR}\n`);

  const videoPath = (await ask('  Video path: ')).trim().replace(/^["']|["']$/g, '');
  if (!videoPath) { console.error('Path cannot be empty.'); process.exit(1); }

  const useColor  = (await ask('  Color mode? (y/N): ')).trim().toLowerCase() === 'y';
  const termCols  = process.stdout.columns || 120;
  const defaultW  = Math.min(termCols - 1, useColor ? 100 : 180);
  const widthIn   = (await ask(`  Width (default ${defaultW}): `)).trim();
  const width     = widthIn ? parseInt(widthIn, 10) || defaultW : defaultW;
  const skipIn    = (await ask('  Skip N frames (default 1): ')).trim();
  const skip      = skipIn ? Math.max(1, parseInt(skipIn, 10) || 1) : 1;
  const loop      = (await ask('  Loop? (y/N): ')).trim().toLowerCase() === 'y';

  rl.close();
  return { videoPath, useColor, width, skip, loop };
}

async function main() {
  enableAnsiWindows();

  program
    .name('main')
    .description('ASCII Art Video Player — Node.js v2 (Improved)')
    .argument('[video]', 'Path to video file (mp4, avi, mkv, …)')
    .option('-w, --width <n>',  'Output width in chars (auto-clamped to terminal)', parseInt)
    .option('-c, --color',      'ANSI 24-bit true color')
    .option('--no-color',       'Grayscale (default, faster)')
    .option('-s, --skip <n>',   'Render every Nth frame (default 1)', parseInt, 1)
    .option('-l, --loop',       'Loop until Ctrl+C')
    .option('-i, --info',       'Show video info only')
    .addHelpText('after', `
Examples:
  node main.js video.mp4
  node main.js video.mp4 --color --width 100
  node main.js video.mp4 --color --skip 2
  node main.js video.mp4 --no-color --width 160 --loop
  node main.js video.mp4 --info
    `);

  program.parse();

  const opts      = program.opts();
  let   videoPath = program.args[0] || null;

  if (!videoPath) {
    const a  = await interactivePrompt();
    videoPath    = a.videoPath;
    opts.color   = a.useColor;
    opts.width   = a.width;
    opts.skip    = a.skip;
    opts.loop    = a.loop;
  }

  if (!opts.width) {
    const termCols = process.stdout.columns || 120;
    opts.width     = Math.min(termCols - 1, opts.color ? 100 : 180);
  }

  opts.skip = Math.max(1, opts.skip || 1);

  if (opts.info) {
    if (!fs.existsSync(videoPath)) {
      console.error(`${C_RED}[ERROR]${RESET_COLOR} File not found: '${videoPath}'`);
      process.exit(1);
    }
    printInfo(videoPath, await getVideoInfo(videoPath));
    return;
  }

  await playVideo({
    videoPath,
    width   : opts.width,
    useColor: opts.color || false,
    skip    : opts.skip,
    loop    : opts.loop || false,
  });
}

main().catch((e) => {
  process.stdout.write(SHOW_CURSOR + RESET_COLOR);
  console.error(`\n${C_RED}[FATAL]${RESET_COLOR} ${e.message}`);
  process.exit(1);
});