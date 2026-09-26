/**
 * Load before `@discordjs/voice`: sets `FFMPEG_PATH` from env or `ffmpeg-static`.
 * prism-media normally ignores env; `postinstall` patches it to honour `FFMPEG_PATH` first.
 * Also centralises yt-dlp path resolution (youtube-dl-exec postinstall often skipped / blocked).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { childLogger } from './core/logger.js';

const log = childLogger('media');

const nodeRequire = createRequire(import.meta.url);

export const FFMPEG_STATIC_BIN = nodeRequire('ffmpeg-static') as string | null;

function configureFfmpegPathForVoice(): void {
  const envRaw = process.env.FFMPEG_PATH?.trim();
  if (envRaw) {
    const normalized = path.normalize(envRaw);
    if (existsSync(normalized)) {
      process.env.FFMPEG_PATH = normalized;
      return;
    }
    log.warn(`FFMPEG_PATH points to a missing file (${normalized}). Ignoring it and trying ffmpeg-static.`);
  }

  if (FFMPEG_STATIC_BIN) {
    const normalized = path.normalize(FFMPEG_STATIC_BIN);
    if (existsSync(normalized)) {
      process.env.FFMPEG_PATH = normalized;
      return;
    }
    log.warn(`ffmpeg-static path has no file (${normalized}). Often: antivirus, or npm install not from monorepo root. Try: winget install Gyan.FFmpeg and set FFMPEG_PATH to ffmpeg.exe.`);
    process.env.FFMPEG_PATH = normalized;
    return;
  }

  log.warn('ffmpeg-static not found — run `npm install` from the monorepo root. Then restart the bot.');
}

configureFfmpegPathForVoice();

let cachedYtdlp: string | undefined;

function bundledYtdlpPath(): string {
  const { YOUTUBE_DL_PATH } = nodeRequire('youtube-dl-exec').constants as {
    YOUTUBE_DL_PATH: string;
  };
  return path.normalize(YOUTUBE_DL_PATH);
}

/** Path to yt-dlp for `spawn` (YouTube / Spotify→YouTube). */
export function resolveYtDlpSpawnPath(): string {
  if (cachedYtdlp !== undefined) {
    return cachedYtdlp;
  }

  const envPath = process.env.YTDLP_PATH?.trim();
  if (envPath) {
    const n = path.normalize(envPath);
    if (existsSync(n)) {
      cachedYtdlp = n;
      return n;
    }
    log.warn(`YTDLP_PATH is set but file missing: ${n}`);
  }

  const bundled = bundledYtdlpPath();
  if (existsSync(bundled)) {
    cachedYtdlp = bundled;
    return bundled;
  }

  log.error(`yt-dlp missing at ${bundled}. Fixes: (1) Repo root: npm run rebuild:ytdlp -w discord-bot  (2) Or: winget install yt-dlp  then set YTDLP_PATH to yt-dlp.exe  (3) npm must not use --ignore-scripts (postinstall downloads the binary).`);
  cachedYtdlp = bundled;
  return bundled;
}

void resolveYtDlpSpawnPath();

/** Extra yt-dlp CLI args from `YTDLP_EXTRA_ARGS` (whitespace-separated), e.g. `--js-runtimes node` in Docker. */
export function ytdlpExtraArgs(): string[] {
  return (process.env.YTDLP_EXTRA_ARGS ?? '').split(/\s+/).filter(Boolean);
}

function runYtDlp(args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const proc = spawn(resolveYtDlpSpawnPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      stderr += `\n(timed out after ${timeoutMs} ms)`;
      done(null);
    }, timeoutMs);
    function done(code: number | null): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    }
    proc.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
    proc.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    proc.once('error', (err) => {
      stderr += err.message;
      done(null);
    });
    proc.once('close', (code) => done(code));
  });
}

export type YtDlpCheck = { ok: true; version: string } | { ok: false; error: string };

type StartupLogger = {
  info: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
};

/**
 * Startup self-test: `yt-dlp --version` must run inside the image (catches a missing python3 or binary).
 * With `YTDLP_AUTO_UPDATE=1` a release binary is updated in the background afterwards (YouTube breaks old versions).
 */
export async function checkYtDlpAtStartup(log: StartupLogger): Promise<YtDlpCheck> {
  const bin = resolveYtDlpSpawnPath();
  const res = await runYtDlp(['--version'], 15_000);
  if (res.code !== 0 || !res.stdout) {
    const error = res.stderr || `exit code ${res.code}`;
    log.error({ bin, error }, 'yt-dlp self-test failed; YouTube/Spotify playback will not work');
    return { ok: false, error };
  }
  log.info({ bin, version: res.stdout, extraArgs: ytdlpExtraArgs() }, 'yt-dlp self-test ok');
  if (process.env.YTDLP_AUTO_UPDATE === '1') {
    void runYtDlp(['--update'], 120_000).then((u) => {
      const line = (u.stdout || u.stderr).split('\n').filter(Boolean).pop() ?? '';
      log.info({ code: u.code, result: line.slice(0, 300) }, 'yt-dlp auto-update finished');
    });
  }
  return { ok: true, version: res.stdout };
}
