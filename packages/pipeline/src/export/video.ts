// MP4 export: deterministic frames from the player (no screen recording), narration laid on one track,
// encoded with ffmpeg. Question beats show the card, then the answer.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Project } from '../project/index.js';
import { loadPlaywright } from '../qa/check.js';
import { serveStatic } from './serve.js';
import { exportSite } from './site.js';

export interface VideoOptions {
  lang: string;
  out?: string;
  fps?: number;
  /** Seconds a question card stays before its answer is shown. */
  thinkTime?: number;
  /** Seconds the answer stays on screen. */
  answerTime?: number;
  onProgress?: (e: { beat: number; beats: number; frame: number; frames: number }) => void;
}

export function hasFfmpeg(): boolean {
  return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
}

interface BeatPlan {
  id: string;
  ask: boolean;
  /** Narration length. */
  speech: number;
  /** Seconds this beat occupies in the video. */
  len: number;
  audio?: string;
}

/** Render a lesson to MP4 (needs ffmpeg and Playwright Chromium). */
export async function exportVideo(project: Project, lessonId: string, opts: VideoOptions): Promise<string> {
  if (!hasFfmpeg()) throw new Error('video export needs ffmpeg on the PATH');
  const fps = opts.fps ?? 20;
  const think = opts.thinkTime ?? 4;
  const answer = opts.answerTime ?? 4;
  const work = project.path('cache', 'video', `${lessonId}-${opts.lang}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const site = exportSite(project, { out: join(work, 'site'), lessons: [lessonId] });
  const { server, url } = await serveStatic(site.out, 0);
  const pw = await loadPlaywright();
  const browser = await pw.chromium.launch();
  const out = opts.out ?? project.path(`${lessonId}.${opts.lang}.mp4`);
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 956 }, deviceScaleFactor: 1 });
    await page.goto(`${url}${lessonId}/index.html?lang=${opts.lang}&beat=0&t=0`);
    await page.waitForFunction(() => !!(window as unknown as { warqa?: unknown }).warqa);
    const beats = (await page.evaluate(
      `window.warqa.compiled.beats.map(b => ({ id: b.id, ask: b.ask, speech: b.timing.dur, end: b.end }))`,
    )) as { id: string; ask: boolean; speech: number; end: number }[];
    const audioDir = project.audioDir(lessonId, opts.lang);
    const files = project.audioFiles(lessonId, opts.lang);
    const plan: BeatPlan[] = beats.map((b) => ({
      id: b.id,
      ask: b.ask,
      speech: b.speech,
      len: b.ask ? Math.max(b.speech, 1.5) + think + answer : b.end,
      ...(files[b.id] ? { audio: join(audioDir, files[b.id]!) } : {}),
    }));
    const total = plan.reduce((a, b) => a + b.len, 0);

    // 1. audio: each clip padded with silence to its beat length, concatenated
    const audioOut = join(work, 'audio.m4a');
    const inputs: string[] = [];
    const filters: string[] = [];
    plan.forEach((b, i) => {
      if (b.audio && existsSync(b.audio)) inputs.push('-i', b.audio);
      else inputs.push('-f', 'lavfi', '-t', b.len.toFixed(3), '-i', 'anullsrc=r=24000:cl=mono');
      filters.push(
        `[${i}:a]aresample=24000,aformat=channel_layouts=mono,apad=whole_dur=${b.len.toFixed(3)},atrim=0:${b.len.toFixed(3)}[a${i}]`,
      );
    });
    filters.push(`${plan.map((_, i) => `[a${i}]`).join('')}concat=n=${plan.length}:v=0:a=1[out]`);
    const a = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        ...inputs,
        '-filter_complex',
        filters.join(';'),
        '-map',
        '[out]',
        '-c:a',
        'aac',
        '-b:a',
        '96k',
        audioOut,
      ],
      { encoding: 'utf8' },
    );
    if (a.status !== 0) throw new Error(`ffmpeg (audio): ${a.stderr.slice(-400)}`);

    // 2. frames piped into ffmpeg together with the audio
    const ff = spawn(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'image2pipe',
        '-framerate',
        String(fps),
        '-i',
        '-',
        '-i',
        audioOut,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '22',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'copy',
        '-shortest',
        '-movflags',
        '+faststart',
        out,
      ],
      { stdio: ['pipe', 'ignore', 'pipe'] },
    );
    let ffErr = '';
    ff.stderr.on('data', (d) => (ffErr += d));
    const done = new Promise<void>((ok, fail) =>
      ff.on('close', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg (video): ${ffErr.slice(-400)}`)))),
    );
    const frameEl = page.locator('.wq-frame');
    const totalFrames = Math.ceil(total * fps);
    let frame = 0;
    for (let i = 0; i < plan.length; i++) {
      const b = plan[i]!;
      const n = Math.round(b.len * fps);
      let revealed = false;
      for (let k = 0; k < n; k++) {
        const t = k / fps;
        await page.evaluate(`window.warqa.freeze(${i}, ${b.ask ? Math.min(t, b.speech) : t})`);
        if (b.ask && !revealed && t >= b.len - answer) {
          await page.evaluate('window.warqa.revealAnswers()');
          revealed = true;
        }
        const jpg = await frameEl.screenshot({ type: 'jpeg', quality: 88 });
        if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
        opts.onProgress?.({ beat: i, beats: plan.length, frame: ++frame, frames: totalFrames });
      }
    }
    ff.stdin.end();
    await done;
  } finally {
    await browser.close();
    server.close();
  }
  return out;
}
