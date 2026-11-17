import { spawn, type ChildProcess } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { dialog } from 'electron';
import type { FileInfo } from '@shared/ipc';
import type { MainContext } from '../context';

/**
 * Speech & audio feature (main process side):
 *  - Windows text-to-speech through PowerShell + System.Speech (voices, synthesis to WAV),
 *  - writing generated audio (denoised clips, speech) into userData/speech/<kind>/,
 *  - saving and opening SRT / WebVTT subtitle files.
 *
 * User text never reaches a command line: it is written to a temp file, and the fixed script
 * receives only the path of a JSON request file as its single argument.
 */

export interface TtsVoice {
  name: string;
  culture: string;
  gender: string;
  age: string;
}

export interface TtsRequest {
  text: string;
  voice?: string;
  /** -10 (slow) … 10 (fast). */
  rate?: number;
  /** 0 … 100. */
  volume?: number;
  /** 'preview' files are overwritten; 'clip' files are kept for the project. */
  purpose?: 'preview' | 'clip';
}

const SCRIPT = `param([Parameter(Mandatory=$true)][string]$RequestPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$req = [System.IO.File]::ReadAllText($RequestPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  if ($req.mode -eq 'voices') {
    $list = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object {
      $v = $_.VoiceInfo
      [pscustomobject]@{ name = [string]$v.Name; culture = [string]$v.Culture.Name; gender = [string]$v.Gender; age = [string]$v.Age }
    })
    Write-Output (ConvertTo-Json -InputObject $list -Compress)
    return
  }
  if ($req.voice) { $synth.SelectVoice([string]$req.voice) }
  $synth.Rate = [int]$req.rate
  $synth.Volume = [int]$req.volume
  $text = [System.IO.File]::ReadAllText([string]$req.textPath, [System.Text.Encoding]::UTF8)
  $fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(44100, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $synth.SetOutputToWaveFile([string]$req.out, $fmt)
  $synth.Speak($text)
  $synth.SetOutputToNull()
  Write-Output 'ok'
} finally {
  $synth.Dispose()
}
`;

const powershellExe = (): string => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

const KINDS = new Set(['tts', 'denoise', 'audio']);
const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.min(max, Math.max(min, n));
};

export default function register(ctx: MainContext): void {
  const root = (): string => path.join(ctx.userData(), 'speech');
  let running: ChildProcess | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let voicesCache: TtsVoice[] | null = null;

  async function scriptPath(): Promise<string> {
    const dir = path.join(root(), 'tts');
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'kinora-tts.ps1');
    // UTF-8 with BOM so Windows PowerShell 5.1 reads the script as Unicode.
    await fsp.writeFile(file, '\ufeff' + SCRIPT, 'utf8');
    return file;
  }

  /** Run the TTS script with a JSON request; resolves with its stdout. */
  function runScript(request: Record<string, unknown>, timeoutMs: number): Promise<string> {
    const job = queue.then(async () => {
      if (process.platform !== 'win32') throw new Error('Text to speech uses the voices built into Windows.');
      const script = await scriptPath();
      const reqFile = path.join(root(), 'tts', `request-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
      await fsp.writeFile(reqFile, JSON.stringify(request), 'utf8');
      try {
        return await new Promise<string>((resolve, reject) => {
          const child = spawn(powershellExe(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-RequestPath', reqFile], {
            windowsHide: true,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          running = child;
          let out = '';
          let err = '';
          child.stdout.setEncoding('utf8');
          child.stderr.setEncoding('utf8');
          child.stdout.on('data', (d: string) => (out += d));
          child.stderr.on('data', (d: string) => (err += d));
          const timer = setTimeout(() => child.kill(), timeoutMs);
          child.on('error', (e) => {
            clearTimeout(timer);
            reject(new Error(`PowerShell could not be started: ${e.message}`));
          });
          child.on('close', (code, signal) => {
            clearTimeout(timer);
            if (running === child) running = null;
            if (signal) reject(new Error('Speech synthesis was cancelled.'));
            else if (code !== 0) reject(new Error(cleanError(err) || `Speech synthesis failed (exit code ${code}).`));
            else resolve(out.trim());
          });
        });
      } finally {
        await fsp.unlink(reqFile).catch(() => undefined);
      }
    });
    queue = job.catch(() => undefined);
    return job;
  }

  ctx.handle('x:speech:voices', async (): Promise<TtsVoice[]> => {
    if (voicesCache) return voicesCache;
    const out = await runScript({ mode: 'voices' }, 30000);
    const parsed = JSON.parse(out.split(/\r?\n/).filter(Boolean).pop() ?? '[]') as TtsVoice[] | TtsVoice;
    voicesCache = (Array.isArray(parsed) ? parsed : [parsed]).filter((v) => v && typeof v.name === 'string');
    return voicesCache;
  });

  ctx.handle('x:speech:synthesize', async (req: TtsRequest): Promise<FileInfo> => {
    const text = typeof req?.text === 'string' ? req.text.replace(/\u0000/g, '').trim() : '';
    if (!text) throw new Error('Type something to say first.');
    if (text.length > 20000) throw new Error('The text is too long (20,000 characters at most).');
    const dir = path.join(root(), 'tts');
    await fsp.mkdir(dir, { recursive: true });
    const preview = req.purpose === 'preview';
    if (preview) {
      // Keep only the latest preview.
      for (const f of await fsp.readdir(dir).catch(() => [] as string[])) if (f.startsWith('preview-')) await fsp.unlink(path.join(dir, f)).catch(() => undefined);
    }
    const base = ctx.sanitizeName(text.split(/\s+/).slice(0, 5).join(' ')).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'speech';
    const out = path.join(dir, `${preview ? 'preview' : base}-${Date.now()}.wav`);
    const textFile = path.join(dir, `text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
    await fsp.writeFile(textFile, text, 'utf8');
    try {
      const voices = voicesCache ?? [];
      const voice = typeof req.voice === 'string' && req.voice && (voices.length === 0 || voices.some((v) => v.name === req.voice)) ? req.voice : '';
      await runScript({ mode: 'speak', textPath: textFile, out, voice, rate: clampInt(req.rate, -10, 10, 0), volume: clampInt(req.volume, 0, 100, 100) }, 30000 + text.length * 300);
    } finally {
      await fsp.unlink(textFile).catch(() => undefined);
    }
    const info = await ctx.statFile(out);
    if (!info.exists || info.size <= 44) throw new Error('No audio was produced. Try another voice.');
    return info;
  });

  ctx.handle('x:speech:cancelSynthesis', () => {
    running?.kill();
  });

  /** Write generated audio (WAV bytes) to userData/speech/<kind>/ and return the file. */
  ctx.handle('x:speech:saveAudio', async (kind: string, name: string, data: Uint8Array): Promise<FileInfo> => {
    if (!KINDS.has(kind)) throw new Error('Unknown audio kind.');
    if (!(data instanceof Uint8Array) || data.byteLength < 44) throw new Error('No audio data.');
    const dir = path.join(root(), kind);
    await fsp.mkdir(dir, { recursive: true });
    const base = ctx.sanitizeName(String(name ?? '').replace(/\.[^.]+$/, '')).slice(0, 60) || kind;
    const file = path.join(dir, `${base}-${Date.now()}.wav`);
    await fsp.writeFile(file, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    return ctx.statFile(file);
  });

  /** Ask where to save subtitles (SRT / VTT) and write them. Returns the path or null. */
  ctx.handle('x:speech:saveSubtitles', async (defaultName: string, format: 'srt' | 'vtt', text: string): Promise<string | null> => {
    const ext = format === 'vtt' ? 'vtt' : 'srt';
    const name = `${ctx.sanitizeName(String(defaultName ?? '')).replace(/\.(srt|vtt)$/i, '') || 'captions'}.${ext}`;
    let file: string | null = null;
    if (ctx.e2eDir) {
      file = path.join(ctx.e2eDir, name);
    } else {
      const win = ctx.window();
      const opts = {
        title: 'Export captions',
        defaultPath: path.join(ctx.settings.get<string>('lastExportDir') ?? '', name),
        filters: [ext === 'vtt' ? { name: 'WebVTT subtitles', extensions: ['vtt'] } : { name: 'SubRip subtitles', extensions: ['srt'] }],
      };
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (res.canceled || !res.filePath) return null;
      file = res.filePath;
    }
    // Windows players expect a BOM for UTF-8 SRT; WebVTT is UTF-8 by definition.
    await fsp.writeFile(file, (ext === 'srt' ? '\ufeff' : '') + String(text ?? '').replace(/\r?\n/g, '\r\n'), 'utf8');
    return file;
  });

  /** Pick an SRT / VTT file and return its text. `testPath` is only honoured during automated tests. */
  ctx.handle('x:speech:openSubtitles', async (testPath?: string): Promise<{ path: string; name: string; text: string } | null> => {
    let file: string | null = null;
    if (ctx.e2eDir && typeof testPath === 'string') {
      const resolved = path.resolve(testPath);
      if (!resolved.toLowerCase().startsWith(path.resolve(ctx.e2eDir).toLowerCase() + path.sep)) throw new Error('Not allowed.');
      file = resolved;
    } else {
      const win = ctx.window();
      const opts = { title: 'Import captions', properties: ['openFile' as const], filters: [{ name: 'Subtitles', extensions: ['srt', 'vtt'] }] };
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      if (res.canceled || !res.filePaths[0]) return null;
      file = res.filePaths[0];
    }
    const stat = await fsp.stat(file);
    if (stat.size > 8 * 1024 * 1024) throw new Error('This subtitle file is too large.');
    return { path: file, name: path.basename(file), text: await fsp.readFile(file, 'utf8') };
  });
}

/** Turn a PowerShell error dump into one readable line. */
function cleanError(stderr: string): string {
  const line = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('At ') && !l.startsWith('+') && !l.startsWith('CategoryInfo') && !l.startsWith('FullyQualifiedErrorId'));
  return (line ?? '').replace(/^Exception calling "\w+" with "\d+" argument\(s\): /, '').replace(/^"|"$/g, '').slice(0, 300);
}
